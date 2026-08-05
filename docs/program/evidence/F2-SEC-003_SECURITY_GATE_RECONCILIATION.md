# F2-SEC-003 — Security Blocker Closure, Deployment Readiness, and Guardrail Authorization Reconciliation

**Task type:** Documentation, repository verification, deployment-readiness analysis, and explicit program-owner authorization recommendation. No guardrail CI implemented. No Stage 2 Imaging work performed. No runtime code changed (no verified blocking defect was discovered). No deployment performed. No production verification claimed.

**Branch:** `docs/f2-sec-003-security-gate-reconciliation`
**Baseline:** freshly-fetched `origin/main` @ `be72eb9b44829c4e6ad9d88e6bd80bcfe88c8fdd` (PR #320's own merge commit, `mergedAt 2026-08-05T08:36:17Z`) — no drift observed at task start (`git status --short` clean before the worktree was created).

---

## 1. Baseline verification (independently re-run, not assumed from the assigning prompt)

| Fact | Assigned prompt value | Independently re-verified | Match |
|---|---|---|---|
| PR #318 head | `0bb832baf78be430cfdfd428382084b14b042fae` | `gh pr view 318 --json headRefOid` → `0bb832baf78be430cfdfd428382084b14b042fae` | ✅ |
| PR #318 merge commit | `2452b8c4a4fcd963878bbc0fbc37045d9cef170c` | `gh pr view 318 --json mergeCommit` → `2452b8c4a4fcd963878bbc0fbc37045d9cef170c` | ✅ |
| PR #318 state | `MERGED` | `gh pr view 318 --json state` → `MERGED`, `mergedAt: 2026-08-04T08:18:03Z` | ✅ |
| PR #318 PR CI | `success` | `statusCheckRollup`: 9/9 `ci-layers` jobs `SUCCESS` (run `30890764142`) | ✅ |
| PR #318 post-merge main CI | run `30891381612`, `success` | `gh run view 30891381612` → `headSha 2452b8c4a4fcd963878bbc0fbc37045d9cef170c`, `status completed`, `conclusion success`, `workflowName ci-main-and-nightly` | ✅ |
| PR #319 head | `fb4e23766478db413f9e34f009302d4f4f0948f7` | `gh pr view 319 --json headRefOid` → match | ✅ |
| PR #319 merge commit | `09ee20b7f1f655a4025a32927a8e81e596e1bb97` | `gh pr view 319 --json mergeCommit` → match | ✅ |
| PR #319 state | `MERGED` | `gh pr view 319` → `MERGED`, `mergedAt: 2026-08-04T20:44:22Z` | ✅ |
| PR #319 PR CI | run `30893070050`, `success` | 9/9 `ci-layers` jobs `SUCCESS` | ✅ |
| PR #319 post-merge main CI | run `30949232722`, `success` | `gh run view 30949232722` → `headSha 09ee20b7f1f655a4025a32927a8e81e596e1bb97`, `status completed`, `conclusion success` | ✅ |
| PR #320 merged | (context) | `gh pr view 320` → `MERGED`, merge commit `be72eb9b44829c4e6ad9d88e6bd80bcfe88c8fdd`, `mergedAt 2026-08-05T08:36:17Z` | ✅ |
| PR #320 post-merge main CI | run `30989713483`, `success` | `gh run view 30989713483` → `headSha be72eb9b...` exact match, `conclusion success` | ✅ |

**Ancestry** (`git merge-base --is-ancestor <sha> origin/main`, exit code checked): PR #318's merge commit `2452b8c4a4fcd963878bbc0fbc37045d9cef170c` — ancestor ✅. PR #319's merge commit `09ee20b7f1f655a4025a32927a8e81e596e1bb97` — ancestor ✅. PR #320's merge commit `be72eb9b44829c4e6ad9d88e6bd80bcfe88c8fdd` — ancestor ✅ (also `origin/main`'s exact current tip).

**Conclusion:** every fact in the assigning prompt's "AUTHORITATIVE CURRENT STATE" block is confirmed, byte-for-byte, against live GitHub state and local git ancestry as of this task's execution. No discrepancy found.

---

## 2. Repository-level security verification (Objective 1)

Both claims were independently re-derived from source and from real disposable-PostgreSQL test suites on current `main` (`be72eb9b`) — not merely cited from prior evidence documents.

### 2.1 F2-SEC-001 — Instagram inbox status mutation (`server/src/routes/instagramInbox.ts`)

Route: `PATCH /instagram/inbox/:id/status` (lines 769–831).

| Required property | Verified | Evidence |
|---|---|---|
| Clinic-membership scoped | ✅ | `allowedClinicIds = await getAllowedClinicIds(user)` computed independently of the target row (line 792); write predicate carries `OR(clinicId IS NULL, clinicId IN allowedClinicIds)` for restricted callers (lines 813–816) |
| No target-row pre-read controls authorization | ✅ | No `findFirst`/`findUnique` call anywhere in the handler; `server/src/tests/instagramInboxStatusClinicScope.test.ts` §10 asserts `findFirstCalls === 0` and `findUniqueCalls === 0` on a spied Prisma client |
| Mutation and returned row from the same scoped atomic statement | ✅ | Single `prisma.instagramInboxEntry.updateManyAndReturn({...})` call (line 810) — one `UPDATE ... WHERE ... RETURNING` SQL statement; §10 of the test file asserts `res.body.entry` is `capturedResult[0]`, the exact row `updateManyAndReturn` returned |
| Restricted empty membership never becomes unrestricted | ✅ | Predicate uses `allowedClinicIds !== null` (not truthiness) at line 814; §13 of the test file asserts the write predicate for `allowedClinicIds=[]` is the explicit `OR(clinicId IS NULL, clinicId IN [])`, never omitted, and that such a caller is denied on any assigned-clinic entry |
| Cross-org and same-org cross-clinic access fail closed | ✅ | `organizationId: user.organizationId` always present in the predicate (cross-org); clinic-membership `OR` clause (same-org cross-clinic); §3–§5 of the test file assert identical `404 {error:'Entry not found'}` for nonexistent/cross-org/same-org-wrong-clinic ids, with the target row provably unchanged (`status` re-read after the rejected call) |

**Test evidence (`server/src/tests/instagramInboxStatusClinicScope.test.ts`, real disposable-PostgreSQL, no mocked Prisma):** 13 sections, including a deterministic (promise-sequenced, non-sleep) concurrency regression proving a clinic reassignment racing between authorization-scope computation and the atomic write can never leak the reassigned row (§11), and the accepted null-clinic org-level policy (§12). Wired into `server:test:legacy-db-required` (`server/package.json`), which CI's `ci-layers / Layer 5: full-suite/compatibility fail-safe (backend, legacy server:test DB-required members)` job executes — confirmed `SUCCESS` on both PR #318's own CI run and its post-merge main CI run (§1 above).

**Finding: F2-SEC-001 is CONFIRMED closed on current `main`.**

### 2.2 F2-SEC-002 — WhatsApp legacy public API clinic resolution (`server/src/routes/whatsapp.ts`, `server/src/services/whatsappPublicApi.ts`, `server/src/utils/webhookRouting.ts`, `server/src/utils/encryption.ts`)

Six legacy routes, all mounted with the single shared middleware `authorizeAndResolveWhatsappPublicApi` (line 1268): `GET /services` (4016), `GET /doctors` (4031), `GET /availability` (4046), `GET /appointment-lookup` (4060), `POST /appointment-requests` (4093), `POST /cancel-request` (4141).

| Required property | Verified | Evidence |
|---|---|---|
| All six routes share the connection-bound middleware | ✅ | Grep of `router.(get\|post)` confirms all six (and only these six) attach `authorizeAndResolveWhatsappPublicApi`; the middleware's own doc comment states "all 6 routes share this exact same binding logic" |
| Request credential matches one active `evolution_api` connection | ✅ | `resolveWhatsappPublicApiConnection` (line 1165) filters `activeConnections` (`isActive: true, provider: 'evolution_api'`) by constant-time comparison (`timingSafeEqual`) of the decrypted per-connection `webhookSecret` |
| Zero and multiple matches fail closed | ✅ | `secretMatches.length === 1` → resolve; `secretMatches.length > 1` → `console.warn(...); return null` (never picks a first match, line 1183-1188); zero connection-specific matches falls through only to the strict legacy path (below), never a first-match/default |
| Connection/link/clinic organization invariant enforced | ✅ | `resolveWhatsappPublicApiClinic` (line 1224): `resolveSingleLinkedClinic` requires exactly one `ClinicWhatsAppConnection` row (`server/src/utils/webhookRouting.ts:5-9`, `length === 1` or `null`); then `link.organizationId !== connectionMatch.organizationId` fails closed; then `clinic.organizationId !== connectionMatch.organizationId` fails closed — all three of `connection.organizationId === clinicLink.organizationId === clinic.organizationId` are independently checked |
| Global secret only as `LEGACY_SINGLE_CONNECTION_COMPATIBILITY` | ✅ | Reached only when `secretMatches.length === 0` (line 1190-1215); additionally requires `activeConnections.length === 1` (line 1200) — the moment a second active Evolution connection exists, this path stops matching anything, confirmed by the block comment and by `resolveWhatsappPublicApiConnection`'s own logic |
| No first/default clinic resolution remains in these six routes | ✅ | None of the six routes or their shared middleware calls `prisma.clinic.findFirst` or any ordering-based lookup. A pre-existing `getDefaultClinic()` (`whatsapp.ts:1078`, `prisma.clinic.findFirst({orderBy:{createdAt:'asc'}})`) still exists but is used only by `getClinicForWhatsAppInstance`, which is called only from the **inbound webhook handler** (`POST /evolution-webhook`, a different route, not one of the six legacy public-API routes) and is itself gated by `isLegacyFallbackEnabled() && process.env.NODE_ENV !== 'production'` — inert in production and out of F2-SEC-002's own scope |

**Test evidence (`server/src/tests/dbVerification/whatsappPublicApiExplicitClinicBinding.test.ts`, real disposable-PostgreSQL, real route-handler chains extracted from the router, no mocked Prisma/secret comparison):** 10+ scenario sections including single-connection-resolves-correctly, no-match-fails-closed, multiple-match-fails-closed (never first), foreign/first-active-clinic-never-selected, cross-tenant write prevention, spoofed client-supplied `clinicId` ignored, invalid-credential creates no side effects, and R1's connection-specific-secret binding. Wired into `server:test:disposable-db`, executed by `ci-layers / Layer 3: disposable PostgreSQL tests` — `SUCCESS` on both PR #319's own CI run and its post-merge main CI run.

**Finding: F2-SEC-002 is CONFIRMED closed on current `main`.**

Neither claim required any code change in this task — both were already true on `origin/main` at the frozen baseline. No STOP condition was triggered.

---

## 3. Deployment readiness (Objective 2)

### 3.1 F2-SEC-001

- **Migration:** none. `git log --oneline -- server/prisma/migrations` shows the most recent migrations are unrelated (`medical-history`, `patient-emergency-contacts`, `inventory-unit-conversion`, `external-calendar`) — F2-SEC-001 changed only route logic in `instagramInbox.ts`, no `schema.prisma`/migration file.
- **Restart:** backend (`noramedi-api`, per prior F0-002/F0-006 production-topology evidence) rebuild + PM2 restart/reload required — TypeScript route code, not hot-reloadable at runtime.
- **Smoke endpoint:** `PATCH /api/instagram/inbox/:id/status`.
  - **Authorized scenario:** a `CLINIC_MANAGER`/`RECEPTIONIST` user whose `allowedClinicIds` includes the target entry's `clinicId` (or an `OWNER`/`ORG_ADMIN`) submits a valid `status` value → expect `200 {entry:{...,status:<new value>}}`.
  - **Unauthorized scenario:** the same role class targeting an entry assigned to a clinic outside `allowedClinicIds` → expect `404 {error:'Entry not found'}`, and the entry's `status` unchanged on a follow-up read.
- **Rollback:** revert the deployed commit (`git revert` or redeploy the prior release SHA) and restart `noramedi-api`; no data migration, no backward-incompatible schema, so rollback is a plain code revert with zero data-shape risk.

### 3.2 F2-SEC-002

- **Migration:** none. No `WhatsAppConnection`/`ClinicWhatsAppConnection` schema change shipped by PR #319 — confirmed by the same migration-directory check above.
- **Restart:** backend rebuild + PM2 restart/reload required (route/service logic only).
- **Smoke endpoints:** the six routes under `/api/public/whatsapp/*` (`services`, `doctors`, `availability`, `appointment-lookup`, `appointment-requests`, `cancel-request`).
  - **Authorized scenario:** a request bearing a valid connection-specific `webhookSecret` (via `Authorization: Bearer <secret>` or `x-whatsapp-secret`) for a connection with exactly one linked, org-consistent clinic → expect `200` with that clinic's own data (e.g. `GET /services` returns only that clinic's active `appointmentType` rows).
  - **Unauthorized scenario:** no credential → `401 {error:'Invalid WhatsApp API secret'}`; unknown/wrong secret, secret matching >1 active connection, connection with 0 or >1 clinic link, or an org-mismatched link → `404 {error:'Clinic not found'}` (identical shape across every failure reason — non-enumeration by design).
- **Configuration prerequisites — MUST be verified before deploy, not assumed:**
  1. **Active Evolution connections:** count `WhatsAppConnection` rows with `isActive: true, provider: 'evolution_api'` in production. A production deployment with **zero** such rows makes every one of the six routes permanently `401`/`404` (fail-closed, not a defect, but an operational fact to know in advance).
  2. **Per-connection `webhookSecret` presence:** every active Evolution connection intended to serve this API must have a non-null `webhookSecret`. A connection with `webhookSecret: null` can never be resolved by its own secret (only by the legacy global-secret path, and only if it is the sole active connection).
  3. **Duplicate `webhookSecret` risk:** `WhatsAppConnection.webhookSecret` carries **no database-level uniqueness constraint** (confirmed by direct schema read, `server/prisma/schema.prisma:1698` — no `@unique`). Two active connections whose *decrypted* secrets happen to be identical will each cause every legitimate caller's request to fail closed (`secretMatches.length > 1`) for both, not merely misroute — this must be checked by decrypting and comparing values, not by a DB query alone (encryption is non-deterministic per `encryptSecretTagged`, so identical ciphertext is not required for identical plaintext, nor does distinct ciphertext prove distinct plaintext).
  4. **Encrypted/tagged secret readability:** every active connection's `webhookSecret` must decrypt successfully via `decryptSecretTagged` (requires `ENCRYPTION_KEY` to be the same key used at encryption time). A corrupted or foreign-key-encrypted value does not crash resolution (`tryDecryptConnectionSecret` catches and treats it as "no match" — fail-closed) but silently removes that connection from ever being resolvable by its own secret, which reads as a customer-facing outage, not an error log.
  5. **Exactly one clinic link per connection** for this legacy API path: `ClinicWhatsAppConnection` allows a connection to link to zero, one, or many clinics (no schema-level `@unique` on `whatsappConnectionId` alone, only on `[clinicId, whatsappConnectionId]` together). Any connection intended to serve the legacy public API must have **exactly one** such link, or every request against it will `404` regardless of credential validity.
  6. **Connection/link/clinic organization consistency:** `connection.organizationId`, `clinicWhatsAppConnection.organizationId`, and `clinic.organizationId` must all agree for every link a production deployment relies on. A denormalization drift (e.g. a clinic reassigned to a different organization without its `ClinicWhatsAppConnection` row being updated) fails closed per the code, but should be swept for proactively rather than discovered via a support ticket.
  7. **Legacy global-secret topology:** if `WHATSAPP_WEBHOOK_SECRET` is set in production, confirm intent — it is accepted **only** when zero connection-specific secrets match **and** exactly one active Evolution connection exists globally. If production genuinely runs multiple tenants/connections, this env var should likely be **unset** (or its holder informed it now does nothing for a >1-connection topology) to avoid an operator believing it still provides a working fallback.

- **Rollback:** plain code revert + restart, same as F2-SEC-001; no data migration to unwind.

### 3.3 Pre-deploy read-only verification (no secret values read, printed, or logged)

The following are **defined, not executed** by this task — they must be run by an operator with production read access before deploying F2-SEC-001/002, as read-only Prisma queries against production:

```
-- 1. Active Evolution connection count and secret presence (no secret value selected)
SELECT id, "organizationId", "webhookSecret" IS NOT NULL AS "hasSecret"
FROM "WhatsAppConnection"
WHERE "isActive" = true AND provider = 'evolution_api';

-- 2. Clinic-link cardinality per active connection (flags 0 or >1 as at-risk)
SELECT "whatsappConnectionId", COUNT(*) AS "linkedClinicCount"
FROM "ClinicWhatsAppConnection"
GROUP BY "whatsappConnectionId"
HAVING COUNT(*) <> 1;

-- 3. Organization consistency across connection -> link -> clinic
SELECT c.id AS "connectionId", c."organizationId" AS "connOrg",
       l."organizationId" AS "linkOrg", cl."organizationId" AS "clinicOrg"
FROM "WhatsAppConnection" c
JOIN "ClinicWhatsAppConnection" l ON l."whatsappConnectionId" = c.id
JOIN "Clinic" cl ON cl.id = l."clinicId"
WHERE c."organizationId" <> l."organizationId" OR l."organizationId" <> cl."organizationId";
```

Query 4 (duplicate-secret / decrypt-failure detection) **cannot** be expressed as a read-only SQL query alone — it requires running the connection set through `decryptSecretTagged` (application code, using the production `ENCRYPTION_KEY`) and comparing plaintext values pairwise, printing only a boolean "duplicate found: yes/no" and a connection-ID list on collision — never the secret itself. This should be a small one-off Node/tsx script run by an operator with production `DATABASE_URL`/`ENCRYPTION_KEY` access, not committed as application code (matches this program's established convention for read-only production verification packages, e.g. `F0-002_PRODUCTION_EVIDENCE_REQUEST.md`).

### 3.4 Deployment readiness classification

| Item | Classification | Basis |
|---|---|---|
| F2-SEC-001 | **CODE_DEPLOYABLE** | No schema/config dependency; behavior is self-contained; smoke scenarios are simple pass/fail with no external configuration precondition |
| F2-SEC-002 | **CONFIGURATION_VERIFICATION_REQUIRED** | Correct behavior depends on production `WhatsAppConnection`/`ClinicWhatsAppConnection` topology (§3.2 items 1–7) that has not been inspected in this task (no production access) — deploying without first running §3.3's queries risks an unexpected full-outage of the six routes (if 0 usable connections) or a silent-fail-closed regression for any customer whose connection has a duplicate/undecryptable secret or a malformed clinic link |

**Neither item is claimed `NOT_DEPLOYABLE`** — no verified blocking defect exists in the code itself; SEC-002's caveat is purely a pre-deploy configuration-verification requirement, not a code defect.

**No production verification is claimed for either item by this task.**

---

## 4. Production verification plan (Objective 3 — checklist only, not executed)

### 4.1 F2-SEC-001

- [ ] Authorized clinic user (`allowedClinicIds` includes target entry's `clinicId`) → `PATCH .../status` succeeds (`200`), entry's `status` updated.
- [ ] Same-org user without membership in the target entry's clinic → `404`, entry unchanged.
- [ ] Cross-org user (any role, including `OWNER`/`canAccessAllClinics` of a *different* org) → `404`, entry unchanged.
- [ ] Nonexistent entry id → identical `404` shape to the two denials above (non-enumeration).
- [ ] Read the target entry immediately before and after each denied attempt — confirm zero field-level side effects (not only `status`).

### 4.2 F2-SEC-002

- [ ] Connection A's own secret resolves only clinic A's data (`GET /services`, `GET /doctors` scoped correctly).
- [ ] Connection B's own secret resolves only clinic B's data.
- [ ] An unknown/garbage secret → `401`/`404` per the documented non-enumeration contract, no data returned.
- [ ] A secret that (by production accident) matches two active connections → `404`, never one of the two connections' data.
- [ ] A connection with zero clinic links → `404`.
- [ ] A connection with more than one clinic link → `404` (never picks one).
- [ ] A connection/link/clinic organization mismatch (if any exists in production) → `404`.
- [ ] An active Meta (`meta_cloud_api`) connection's presence does not affect Evolution-provider resolution (the query filters `provider: 'evolution_api'` explicitly).
- [ ] The legacy global `WHATSAPP_WEBHOOK_SECRET` works **only** if production is a genuine single-active-Evolution-connection topology; if a second active connection is added later, confirm the global secret stops resolving anything (not silently routes to the wrong tenant).
- [ ] `POST /appointment-requests` write via a resolved clinic lands in **that** clinic's own `AppointmentRequest` rows only (`clinicId` on the created row matches the resolved clinic, not any other).
- [ ] Rollback smoke path: after a rollback (prior release SHA redeployed, service restarted), repeat the authorized-scenario checks above to confirm the previous behavior is restored, not left in a partially-migrated state (moot here since no migration exists, but the health/smoke check itself should still be re-run post-rollback per standard practice).

None of the above was executed by this task. Executing them requires production access this task was not granted and the task instructions explicitly prohibit.

---

## 5. Guardrail authorization decision (Objective 4)

### 5.1 Prerequisite evaluation

F2-GUARDRAIL-PREP-010-D's stated blocking condition was: *"CI guardrail implementation is NOT authorized while F2-SEC-001/F2-SEC-002 remain open."* Both are now, per §2 above, independently repository-verified **CONFIRMED CLOSED** on current `main` — merged, main-CI-passed, source-and-test-verified by this task directly (not merely cited). That specific blocking condition is **satisfied**.

However, per the task's own conservative model and this program's established convention (evidence-first, no status escalation beyond what was actually demonstrated): **merge + main-CI-green is repository-level closure only.** Neither PR has been deployed; neither has been production-verified (§3–§4 above). A **new**, narrower distinction is required before any enforcement decision:

- **(A) Repository-only guardrail implementation authorization** — building and running a report-only, non-blocking guardrail check inside this repository's own CI, over already-merged repository content. This does not touch production and carries no runtime/deployment risk of its own.
- **(B) Production enforcement authorization** — treating the guardrail as a blocking CI gate, and/or treating F2-SEC-001/F2-SEC-002 as *operationally* closed (i.e. safe to build further, security-sensitive work — such as Stage 2 Imaging caller migration — on top of).

### 5.2 Decision

**(A) Repository-only guardrail implementation: AUTHORIZED**, narrowly, as defined in §6 below (F2-GUARDRAIL-IMPL-001). Both concrete blockers named by F2-GUARDRAIL-PREP-010-D are closed at the repository level, and a report-only/non-blocking check operates entirely within the repository's own CI — it introduces no production risk and does not depend on deployment or production verification to be meaningful as a drift detector against the already-frozen PR #313 baseline.

**(B) Production enforcement: NOT AUTHORIZED.** Enforcement must remain **advisory/report-only**, not CI-blocking, until:
1. A baseline snapshot of the new guardrail's own report-only output is captured and reviewed (false-positive validation) — this program's own risk pattern (R-046, R-071) is that unilateral self-verification is insufficient; an explicit review pass is required before any check may block CI.
2. F2-SEC-001 and F2-SEC-002 are **deployed** and **production-verified** per §3–§4 above — closing this gap is exactly what this task's own instructions forbid it from doing (no deployment, no production-verification claim), so it necessarily remains open at the end of this task.

**CI-blocking enforcement of any kind — for the guardrail check or otherwise — must wait for both:** (i) the guardrail task itself (§6) merging and passing main CI, and (ii) F2-SEC-001/F2-SEC-002's deployment + production verification. Neither is satisfied by this task.

**Stage 2 Imaging: remains BLOCKED**, unchanged by this task. This task neither authorizes nor performs any Imaging caller-migration, runtime-modularization, or storage-lifecycle work. Stage 2 Imaging's own gating condition (F2-GUARDRAIL-PREP-010-D, F2-PREP-008) is independent of the F2-SEC-001/002 closure recorded here and is not newly satisfied by it — Stage 2 remains additionally gated on the guardrail task itself merging and passing main CI (per this task's own conservative model), which has not happened.

This decision follows the task's own stated preferred conservative model verbatim: narrow non-blocking guardrail authorized; enforcement advisory-only initially; no CI-blocking until baseline snapshot + false-positive validation pass; Stage 2 Imaging blocked until the guardrail task itself merges and is main-CI-verified; production enforcement gated on deployment + production verification. Repository evidence did not contradict this model at any point — it is adopted unchanged.

---

## 6. Exact next task (Objective 5 — defined, not implemented here)

**F2-GUARDRAIL-IMPL-001 — Exact-Edge and Tenant-Scope Guardrail Report-Only Baseline**

Scope, as a binding definition for the next task (no code for this exists after F2-SEC-003):

- Use the accepted exact-edge tuple identity, frozen by PR #313 and adopted unchanged by F2-GUARDRAIL-PREP-010-D: `(callerPath, callerSymbol, ownerDomain, targetModelOrSymbol, accessKind)`.
- Treat the `LEGACY_ALLOWLISTED_DIRECT_ACCESS` bucket (36 of 71 edges) as **descriptive evidence only** — never a target architecture, never authorization for a new edge, never permission to broaden an existing edge's tuple via path-only/domain-only/wildcard matching.
- **Do not** permit any new legacy edge — an edge absent from the frozen 71-edge baseline is flagged, never silently allowed.
- Operate in **report-only/non-blocking** mode for its entire scope in this next task — no CI job may fail the build because of a finding.
- Consume the existing evidence inventories (PR #313's 71-edge JSON, PR #315's 127-record tenant-scope inventory) as its input baseline — do not re-derive them from scratch.
- Detect **drift** against that baseline: new edges not in the 71, edges whose classification would need to change, tenant-scope patterns diverging from the inventoried set.
- Produce **machine-readable output** (JSON), consistent with this program's established companion-file convention.
- **Avoid runtime modularization** — no module boundary, no service extraction, no import restructuring.
- **Avoid ESLint-wide rewrites** unless a specific, named, narrow justification is documented for a specific rule — do not reach for a blanket lint-config change.
- **Avoid Stage 2 Imaging caller migration** — the guardrail may observe Imaging edges as part of the existing baseline but must not move, refactor, or migrate any Imaging caller.
- Define **measurable promotion criteria** (e.g.: N consecutive clean runs against a stabilized baseline, zero false positives across a defined review window, explicit program-owner sign-off) that must be met **before** any future task may flip it to CI-blocking — this task (F2-SEC-003) does not itself define the exact numeric thresholds; that is F2-GUARDRAIL-IMPL-001's own deliverable.

This task (F2-SEC-003) does **not** implement F2-GUARDRAIL-IMPL-001 — it only names and scopes it, per its own task-type restriction (documentation/analysis/authorization only).

---

## 7. Rollback and security impact

**Rollback:** this task is documentation/evidence-only. Its own rollback is reverting its single documentation-only PR — no application, schema, test, workflow, or package file is touched, so revert carries zero runtime risk. This is distinct from F2-SEC-001/F2-SEC-002's own already-merged code rollback path, described in §3.1/§3.2 above (plain code revert + restart, no migration to unwind).

**Security impact of this task itself:** none — no runtime code changed. **Security impact of the reconciliation's findings:** both F2-SEC-001 and F2-SEC-002 are confirmed closed at the repository level; the residual risk is entirely in the **gap between repository closure and production reality** — until deployed, production continues running whatever code was live before PR #318/#319 merged (i.e. the original defects remain live in production until an operator deploys). This task does not change that fact; it documents it precisely so a deployment decision can be made deliberately rather than assumed.

**Stage 2 Imaging:** unchanged, remains `BLOCKED` — not started, not newly authorized by this task, gated additionally on F2-GUARDRAIL-IMPL-001 merging + passing main CI per the conservative model adopted in §5.2.
