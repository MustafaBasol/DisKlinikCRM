# F0-009-S1 — SecurityIncident Raw-SQL Tenant Ownership Verification

Baseline: `origin/main` @ `23db9c3f1c93a564e094ae5f13be71ca3daa81ce`.
Branch: `fix/f0-009-s1-security-incident-tenant-ownership`.

Follow-up to F0-009 (R-054 in [RISK_REGISTER.md](../RISK_REGISTER.md)), which
flagged that `services/security/securityIncidentService.ts`'s
`escalateSeverityAtomic()` executes a `$executeRawUnsafe` UPDATE scoped only
by `id` (no `clinicId`/`organizationId` predicate in the `WHERE` clause) and
noted the upstream tenant-ownership guarantee had not been verified. This
task traces the complete call path to determine whether a real gap exists.

## 1. The raw SQL

`server/src/services/security/securityIncidentService.ts:130-146`:

```ts
async function escalateSeverityAtomic(
  tx: Prisma.TransactionClient,
  incidentId: string,
  incomingSeverity: string,
  now: Date,
): Promise<boolean> {
  const RANK_CASE = `CASE severity WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'critical' THEN 4 ELSE 1 END`;
  const incomingRank = SEVERITY_RANK[incomingSeverity] ?? 1;
  const affected = await tx.$executeRawUnsafe(
    `UPDATE "SecurityIncident" SET severity = $1, "updatedAt" = $2 WHERE id = $3 AND (${RANK_CASE}) < $4`,
    incomingSeverity,
    now,
    incidentId,
    incomingRank,
  );
  return affected > 0;
}
```

Confirmed as described: the `WHERE` clause is `id = $3 AND (<rank case>) < $4`
— no `clinicId`/`organizationId` predicate. All four bound values
(`incomingSeverity`, `now`, `incidentId`, `incomingRank`) are passed as
positional parameters, never string-interpolated — the only text
interpolated into the query is `RANK_CASE`, a fixed literal with no
caller-supplied content, so there is no SQL-injection surface regardless of
the tenant-ownership question.

## 2. Complete call-path inventory

`escalateSeverityAtomic` is a **module-private function — never exported**.
Grep across `server/src/**/*.ts` for `escalateSeverityAtomic` returns exactly
two matches: its own declaration and exactly one call site, both in the same
file:

`server/src/services/security/securityIncidentService.ts:236` (inside
`upsertIncidentFromSignal`, itself running inside `prisma.$transaction`):

```ts
const severityEscalated = !created && (await escalateSeverityAtomic(tx, upserted.id, input.severity, now));
```

`incidentId` is always `upserted.id` — the id of the row this **same
transaction** just found-or-created a few lines earlier via:

```ts
const upserted = await tx.securityIncident.upsert({
  where: { incidentKey: targetKey },
  create: { incidentKey: targetKey, organizationId: input.organizationId ?? null, clinicId: input.clinicId ?? null, ... },
  update: { occurrenceCount: { increment: 1 }, lastDetectedAt: now },
});
```

`targetKey` is `buildIncidentKey(input)` (or a date-suffixed variant after a
terminal-status recurrence) — a SHA-256 hash of
`sourceRule|organizationId|clinicId|affectedResourceType|affectedResourceId`.
Two different tenants calling with the same `sourceRule`/resource shape but
different `organizationId`/`clinicId` deterministically hash to **different**
`incidentKey` values and therefore always resolve to different rows.

`upsertIncidentFromSignal` (the only exported entry point that reaches
`escalateSeverityAtomic`) has exactly one class of caller:
`server/src/services/security/securityDetectionRules.ts` (6 call sites —
`evaluateAuthLoginFailureSignal`, `evaluateCrossTenantDenialSignal`,
`evaluateExportStepUpLockoutSignal`, `evaluateExportTokenReplaySignal`, the
export-generation-integrity-failure rule, and the export-artifact-cleanup
rule). Every one of these is system-triggered detection-rule code invoked
from existing request-handling paths with `organizationId`/`clinicId` already
resolved server-side (e.g. `ctx.organizationId`, `params.actorOrganizationId`)
— none accepts a raw incident id from a request body/param, because at the
point these rules run, no `SecurityIncident` row is known to exist yet; the
incident is discovered/created by the upsert itself.

`server/src/routes/platformSecurityIncidents.ts` (the only HTTP surface for
`SecurityIncident`) imports and calls `acknowledgeIncident`,
`startInvestigation`, `assignIncident`, `containIncident`, `resolveIncident`,
`closeIncident`, `markFalsePositive`, `reopenIncident`, `addIncidentNote`,
`listIncidents`, `getIncidentById`, `getIncidentActivity`,
`getDashboardSummary` — **none of which call `escalateSeverityAtomic`**.
Those lifecycle mutations use `tx.securityIncident.updateMany({ where: { id,
status: existing.status }, ... })` (a Prisma-generated, fully parameterized
statement, not raw SQL) with their own compare-and-set concurrency control;
they are a structurally separate code path from the escalation logic this
task investigates. (Every route in that file requires
`authenticatePlatformAdmin`, a global/cross-tenant-by-design role per that
file's own header comment — expected and intentional for a Platform Admin
incident-response console, not a gap in this raw-SQL vector.)

No job/cron/worker path calls `securityIncidentService.ts` — confirmed by
grepping `server/src` for `securityIncidentService` (3 files total: the
service itself, `platformSecurityIncidents.ts`, and
`securityDetectionRules.ts`; no `server/src/jobs` file references it).

## 3. Conclusion — A. SECURE AS-IS

`escalateSeverityAtomic` is system-only with an explicit trusted boundary:
it is never exported, has exactly one call site, and that call site always
supplies the id of the row the *same* transaction just resolved via a
tenant-derived deterministic key — never an externally/request-supplied
incident id. There is no reachable path (route, job, or otherwise) through
which an actor of any kind — clinic user, platform admin, or attacker —
can cause this raw UPDATE to target an incident id it did not itself just
establish. The absence of a `clinicId`/`organizationId` predicate in the raw
SQL's `WHERE` clause is therefore not a tenant-ownership gap: tenant
isolation for this write is enforced one layer up, by the `incidentKey`
construction and the same-transaction `upsert`, not by the raw SQL's
predicate.

This resolves R-054's specific raw-SQL vector. It does **not** resolve or
speak to R-055 (the broader nullable-`organizationId`/`clinicId` RLS design
question across 5 models, deferred to F5) — that is a distinct, wider
question this narrow task does not attempt to answer.

## 4. Fix applied

**No runtime code changed.** Per task fix principles for the secure-as-is
outcome, only regression tests were added:
`server/src/tests/securityIncident.test.ts`, tests 55-57 (new section "L.
Raw-SQL tenant-ownership proof (F0-009-S1)"):

- **55** — source inspection: `escalateSeverityAtomic` stays unexported,
  has exactly one call site, and that call site passes `upserted.id`.
- **56** — source inspection: the raw UPDATE binds `incidentId` (and all
  other values) as positional parameters, never string-interpolated.
- **57** — real-DB: escalating one organization's incident severity never
  mutates a different organization's identically-shaped incident (same
  `sourceRule`/resource, different `organizationId`/`clinicId`).

These pin the invariant this evidence relies on so a future refactor that
reintroduces an external caller, or exports the function, fails the test
suite rather than silently reopening the gap.

## 5. Test execution

Full file run against a disposable, task-scoped Postgres 16 container
(`docker run postgres:16-alpine`, `prisma migrate deploy` — all 61
migrations applied cleanly, matching the same disposable-Postgres pattern
documented in this file's own section G):

```
npx tsx src/tests/securityIncident.test.ts
```

Result: **55 passed, 0 failed** (57 individual `assert` groups across 55
named test cases — tests 9-10, 11-12 are combined). All pre-existing tests
in this file (1-54) pass unchanged, confirming no regression from the added
section.

`npx tsc --noEmit` (server): clean, no errors.

## 6. Scope boundaries respected

No migration created or modified. No schema change. No RLS, Prisma
`$extends`, or generic system-context framework introduced. No change to
platform-admin authorization. No change to any runtime behavior — this is a
test-and-documentation-only follow-up, consistent with the "secure as-is"
outcome and this task's narrow authorization.
