# F3-IMPL-003 — Platform-Admin Privileged Mutation Audit Coverage (R-019)

Phase: F3 — Production Hardening. Third F3 implementation task; runs in parallel with F3-IMPL-002 (worker/process-role contract work, disjoint files).

Branch: `feature/f3-impl-003-platform-admin-audit`
Worktree: `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f3-impl-003`
Baseline: `origin/main` @ `1909b186a01611c8be90313b7166085a887d05f4` — independently confirmed via `git fetch origin` + `git rev-parse origin/main`, exact match, no drift.

Parallel-safety: this task touched only `server/src/routes/platformAdmin.ts` and `server/src/tests/platformAdmin.test.ts`, plus this doc set. It did not touch `server/src/index.ts`, `server/src/worker.ts`, `server/src/utils/backgroundJobsOwnership.ts`, `scripts/noramedi-deploy.sh`, or any PM2/process-role file — the files F3-IMPL-002 owns.

## 1. Objective

Reduce (not necessarily close) R-019 ("Platform-admin yetki aşımı" / platform-admin authorization overreach — `RISK_REGISTER.md` row 88, `Medium`/`High`, `OPEN`, `UNVERIFIED`) by adding durable, attributable, PII-minimized `PlatformAdminAuditEvent` audit evidence to currently-unaudited high-risk platform-admin mutation endpoints. This is the direct follow-up F3-IMPL-001 itself named as the next R-019 slice (its evidence file §23: "Extend the `PlatformAdminAuditEvent` audit trail to the remaining ~18 unaudited platform-admin mutation endpoints").

## 2. Pre-work inventory

All authenticated platform-admin routes were enumerated across the three route files gated by `authenticatePlatformAdmin`: `server/src/routes/platformAdmin.ts` (46 routes), `server/src/routes/platformSecurityIncidents.ts` (13 routes), `server/src/routes/platformExternalCalendar.ts` (11 routes) — **70 routes total**. Each was classified `AUDITED_DURABLY` / `LOG_ONLY` / `UNAUDITED` / `READ_ONLY` / `OUT_OF_SCOPE`.

### 2.1 Classification counts

| Classification | Count | Notes |
|---|---:|---|
| `READ_ONLY` | 28 | GET routes, plus `POST /clinics/:id/sms-addon/preview-routing` (dry-run only, zero Prisma writes) |
| `OUT_OF_SCOPE` | 5 | See §2.2 |
| `AUDITED_DURABLY` (pre-existing, before this task) | 19 | See §2.3 |
| `AUDITED_DURABLY` (added by this task) | 6 | See §3 |
| `UNAUDITED` (still, deferred) | 12 | See §4 |
| **Total** | **70** | |

Mutation-only subset (excludes `READ_ONLY`/`OUT_OF_SCOPE`): 19 + 6 + 12 = 37. Before this task started, 19 were audited and 18 were not — closely matching F3-IMPL-001's own independent estimate ("~18 other platform-admin mutation endpoints... remain unaudited"), a useful cross-check that this inventory is accurate and not double-counting or missing routes.

### 2.2 `OUT_OF_SCOPE` (5)

| Route | Reason |
|---|---|
| `POST /auth/login` (`platformAdmin.ts:61`) | Runs *before* `authenticatePlatformAdmin`; not yet an authenticated platform-admin action. Failed attempts already flow through `evaluateAuthLoginFailureSignal` (a separate, existing security-detection telemetry path). |
| `POST /auth/logout` (`platformAdmin.ts:141`) | Clears session cookies only — no persisted-row mutation to audit. |
| `POST /sms-providers/:id/test` (`platformAdmin.ts:815`) | Diagnostic connectivity check; writes only `lastTestedAt`/`lastTestOk`/`lastTestError` on the existing row — never changes routing/credential behavior. |
| `POST /clinics/:clinicId/external-calendar/test-connection` (`platformExternalCalendar.ts:151`) | Same shape — diagnostic, writes only `lastCheckedAt`/`status`/`lastError`. |
| `POST /mail/test` (`platformAdmin.ts:1719`) | Sends a transient test email; nothing persisted to audit against (no `resourceKey`/previous-vs-new state exists for this action). |

### 2.3 `AUDITED_DURABLY` — pre-existing, before this task (19)

- `platformAdmin.ts` (5): `PATCH`/`DELETE /privacy/legacy-consent-correction/settings` (`PlatformAdminAuditEvent`, transactional, advisory-lock-serialized), `POST /privacy/data-retention/run` (RETENTION-MANUAL-RUN-AUDIT-001, started+terminal event pairs), `POST /backups/run`, `POST /backups/restore-test` (F3-IMPL-001, R-019).
- `platformSecurityIncidents.ts` (9): all nine lifecycle mutations (`acknowledge`, `investigate`, `assign`, `contain`, `resolve`, `close`, `false-positive`, `reopen`, `notes`) write a `SecurityIncidentActivity` row inside the same transaction as the state change (`securityIncidentService.ts:239,251,319,458,484`) — a separate, dedicated, durable, admin-attributed audit trail (KVKK-CRIT-003), not `PlatformAdminAuditEvent`, but already covering this file. Per this task's own instruction ("do not blindly add audit to every route if a shared service already covers it"), this file was left untouched.
- `platformExternalCalendar.ts` (5): `PUT`/`PATCH .../enabled`/`POST .../rotate-webhook-key` on the connection, `PUT`/`DELETE` on mappings — all route through `services/externalCalendar/{externalCalendarConnectionService,externalCalendarMappingService}.ts`, which call `writeAuditLog()` (`utils/auditLog.ts`, the general `AuditLog` model) with `actorRole: 'PLATFORM_ADMIN'` and non-secret metadata (`fieldsUpdated`, `clientSecretChanged`/`webhookSecretChanged` booleans — never the secrets themselves). Also left untouched for the same reason.

## 3. Endpoints changed by this task (6) — priority classes 1–3

Per the task's own priority ordering (1: security/auth configuration, 2: provider/credential configuration, 3: privacy/runtime controls, 4: clinic/platform lifecycle, 5: operational destructive actions), this task closed all of classes 1–3 — the highest-risk classes — and deferred classes 4–5 (§4) to keep the PR reviewable, consistent with F3-IMPL-001's own bounded-scope precedent.

All six use the existing `writePlatformAdminAuditEventInTx()` (`services/platformAdminAudit.ts`) inside the same `prisma.$transaction` as the business mutation — a successful mutation without its audit row is a compile-time-impossible/transactionally-impossible state, mirroring the pattern already proven for `legacy-consent-correction`.

| # | Route | Class | Action | resourceType/Key | previous/new | Why unaudited before was a real gap |
|---|---|---|---|---|---|---|
| 1 | `POST /auth/mfa/setup` | 1 — security/auth config | `platform_admin_mfa.setup_initiated` | `platform_admin` / admin id | null/null, `safeMetadata.hadPendingSecret` | Silently (re-)issues a new pending TOTP secret for the acting admin — zero trace before. |
| 2 | `POST /auth/mfa/verify` | 1 | `platform_admin_mfa.enabled` | `platform_admin` / admin id | `'false'`/`'true'` | Enables MFA — zero trace before. |
| 3 | `POST /auth/mfa/disable` | 1 | `platform_admin_mfa.disabled` | `platform_admin` / admin id | `'true'`/`'false'` | **Highest-risk of the three** — weakens the acting admin's own account security posture; a stolen session could silently strip MFA with no evidence. |
| 4 | `PUT /sms-providers` | 2 — provider/credential config | `platform_sms_provider.upserted` | `platform_sms_provider` / `region:providerCode` | non-secret JSON snapshots (`displayName`/`isActive`/`isDefault`/`senderName`); `safeMetadata.credentialsChanged` boolean | Global, cross-tenant SMS provider config (including encrypted credentials) had zero audit trail. |
| 5 | `DELETE /sms-providers/:id` | 2 | `platform_sms_provider.deleted` | `platform_sms_provider` / `region:providerCode` | snapshot/null | Destructive credential-config removal, zero trace before. |
| 6 | `PATCH /privacy/data-retention/settings` | 3 — privacy/runtime control | `platform_setting.updated` | `platform_setting` / `privacy.dataRetention.runtimeEnabled` | prior/new string, `null` if the setting row never existed | **The most glaring gap found**: the sibling `legacy-consent-correction` runtime toggle already had this exact audit pattern; this KVKK-relevant retention-cleanup kill switch did not. |

None of the six broaden authorization, redesign platform-admin auth, or touch the underlying business-mutation semantics — each is additive: wrap the existing mutation in `prisma.$transaction`, add one `writePlatformAdminAuditEventInTx()` call. No schema/migration change (per the task brief: "if schema change is required, STOP" — none was).

### 3.1 PII/secret minimization, per endpoint

- MFA rows never contain the TOTP secret, the admin's password, or their email — verified by a negative `JSON.stringify(row)` assertion in every success/failure test.
- SMS-provider rows never contain `credentials` (API keys/tokens) — only a `credentialsChanged: boolean` and non-secret display fields.
- Data-retention rows carry only the boolean-as-string setting value — no patient/clinic data is in scope for this endpoint at all.
- All six use `actorPlatformAdminId` (a UUID) for attribution — never the admin's email.

## 4. Endpoints intentionally deferred (12) — priority classes 4–5

Not touched by this task; still `UNAUDITED`. Deferred per this task's own scope discipline ("do not blindly add audit to every route") and to keep this PR a reviewable, bounded slice — exactly the precedent F3-IMPL-001 set.

**Class 4 — clinic/platform lifecycle (10):**
`PATCH /organizations/:id/status`, `PATCH /organizations/:id/plan`, `PATCH /organizations/:id/trial`, `POST /clinics`, `PATCH /clinics/:id/status`, `PATCH /clinics/:id/plan`, `PATCH /clinics/:id/sms-addon`, `PATCH /users/:id/status`, `POST /plans`, `PUT /plans/:id`.

**Class 5 — operational destructive/near-destructive actions (2):**
`POST /file-backups/run`, `POST /file-backups/restore-rehearsal` — the file-backup counterparts of `POST /backups/run`/`POST /backups/restore-test`, which F3-IMPL-001 already audited; these two were never migrated to the same pattern.

These 12 are a natural, mechanical next F3 slice for R-019 (same `writePlatformAdminAuditEventInTx` pattern, no new infrastructure needed) — see §8 "Exact next task".

## 5. Implementation notes

- `POST /auth/mfa/setup`/`verify`/`disable` all resolve the acting admin's own `PlatformAdmin` row (`prisma.platformAdmin.findUnique({ where: { id: req.platformAdmin!.id } })`) *before* any mutation — a non-existent actor id 404s before the transaction is ever opened. This is weaker than "prove the audit insert and the mutation roll back together under a forced mid-transaction failure" (the technique already used for `legacy-consent-correction`/`data-retention`/`sms-providers`, via a real FK-violating ghost admin id), because these three routes cannot reach their own transaction with a ghost actor id in the first place — the row lookup guards it structurally. §6 documents this as an accepted, narrower-but-still-real proof (see the dedicated "non-existent actor id" test per MFA route).
- `PUT /sms-providers` and `DELETE /sms-providers/:id` don't require the acting admin to pre-exist for the *business* logic to run (only the audit insert's FK does), so the stronger ghost-FK atomicity proof — identical in shape to the existing `legacy-consent-correction` test suite — was used for both, plus for `PATCH /privacy/data-retention/settings`.
- `DELETE /sms-providers/:id`'s pre-existing catch-all (`catch { res.status(404)... }`) was left unchanged — a forced audit-insert failure now surfaces as the same 404 it always did (verified in the new test), not a new 500.
- `PATCH /privacy/data-retention/settings` reuses the exact advisory-lock pattern (`pg_advisory_xact_lock(hashtext(key))`) already proven for `legacy-consent-correction`, so concurrent toggles of this setting serialize the same way.

## 6. Tests

New tests: 22, all added to the existing `server/src/tests/platformAdmin.test.ts` (no new test file — this file already held the equivalent `legacy-consent-correction` audit-trail suite whose conventions were reused directly: `getRouteMiddlewareChain`/`runChain`/`mockPlatformRes` route-stack extraction against a real disposable Postgres, no supertest, no mocked Prisma). `platformAdmin.test.ts`: **82/82** (was 60/60 after F3-IMPL-001-R1).

Per endpoint/class, each new test group proves:

- **Successful mutation creates exactly the expected audit row** — action/resourceType/resourceKey/previousValue/newValue/outcome asserted exactly (e.g. `mfa.disable`: `previousValue: 'true'`, `newValue: 'false'`).
- **Rejected/invalid-input mutation creates no audit row** — wrong MFA code, wrong password, already-enabled MFA, invalid SMS-provider payload, non-boolean retention toggle — each asserted via an audit-row `count()` unchanged before/after.
- **Forced mutation failure creates no misleading success audit**:
  - `sms-providers` PUT/DELETE and `data-retention/settings` PATCH: a real Postgres FK violation (`platformAdminAuditEvent.actorPlatformAdminId` → nonexistent `PlatformAdmin.id`) forces the audit insert to fail inside the transaction; asserted that the business mutation (provider row / setting value) is also rolled back — atomic, not best-effort.
  - `mfa/setup`/`verify`/`disable`: a nonexistent actor id 404s before the transaction opens; asserted zero audit rows and zero mutation.
- **Admin attribution uses id, never email/PII/secrets** — every success-path test also does a negative `JSON.stringify(row)` scan for the admin's email, password, and (for MFA/SMS) the actual secret/credential value used in that test.
- **Scope/target metadata is correct** — e.g. the SMS-provider `resourceKey` is exactly `region:providerCode`; the `previousValue`/`newValue` JSON snapshots contain only non-secret fields and match the actual before/after row state.
- One additional test proves the shared `router.use(authenticatePlatformAdmin, csrfProtection('platform'))` gate (already proven generically many times earlier in this same file) rejects an invalid token before any of the six new handlers can run — not duplicated six times.

### 6.1 Full regression

- `cd server && npm run typecheck` — clean, exit `0`.
- `npm run test:runtime:postgres-compat -- --summary-file=postgres-compat-run-summary.json` (repo root; Docker-provisioned digest-pinned Postgres 16, 72/72 migrations applied) — runs `server:test:legacy-db-required` (25 suites, including `test:auth` → `platformAdmin.test.ts`). **Exit `0`, 0 failures.**
- `npm run test:runtime:postgres -- --summary-file=postgres-run-summary.json` (repo root) — runs `server:test:disposable-db` (25 suites, general regression net for the changed route file, per the task's mandated validation list). **Exit `0`, 0 failures.**
- Both summary JSONs (`postgres-run-summary.json`, `postgres-compat-run-summary.json`) written at repo root, left untracked (consistent with prior task precedent — never previously committed to git history).

### 6.2 One environment-only fixture gap found and fixed (not a code defect)

The first run of the postgres-compat orchestrator against this freshly-created worktree failed 8/82 `platformAdmin.test.ts` cases, all with `ENCRYPTION_KEY env var must be a 64-char hex string`. Root cause: `.env` is gitignored and per-worktree — this worktree was created fresh via `git worktree add` and never had one, so `utils/encryption.ts`'s hard (no-fallback) `ENCRYPTION_KEY` requirement failed for the newly-added MFA/SMS-provider code paths, which are the first tests in this suite to exercise `encryptSecretTagged`/`encryptProviderCredentials`. Fixed by generating a fresh, disposable, test-only 64-hex-char key (`openssl rand -hex 32`) and writing it to this worktree's `server/.env` — **not** copied from the primary worktree's real `.env` (blocked by session sandboxing, and the right call regardless: a throwaway worktree should not hold a copy of a real secret). Re-run: 82/82, 0 failures. This is a one-time local dev-environment setup gap, not a production or CI concern — CI provisions its own environment per run.

## 7. Security / tenant / KVKK impact

- **Security:** all six audited actions are platform-admin-scoped (no tenant/clinic-scoped patient data touched by any of them). MFA disable specifically closes a "silent security-downgrade with zero evidence" gap for the platform's own most-privileged account type.
- **Tenant isolation:** unaffected — none of the six routes' authorization/query-scoping logic was touched, only audit-write additions inside existing transactions.
- **KVKK:** `PATCH /privacy/data-retention/settings` is the most KVKK-relevant of the six (a runtime kill switch for automated data retention/cleanup) — it is now durably auditable, closing a real gap where the sibling `legacy-consent-correction` toggle already had this and this one did not. No patient/medical data is read, written, or logged by any of the six changed endpoints or their audit rows.
- No new authorization surface, no authorization broadened, no platform-admin auth model change.

## 8. Migration

None. No schema change required or made — `PlatformAdminAuditEvent` already existed (added by an earlier task, `20260720180000_add_platform_admin_audit_event`) and was reused as-is.

## 9. Rollback

Pure additive code change to one route file plus its test file. Revert is a single-commit `git revert` with zero data-migration concerns — no schema touched, no data backfilled/transformed. The six newly-audited routes' business behavior (status codes, response shapes, validation rules) is byte-for-byte unchanged; only new `PlatformAdminAuditEvent` rows are now written on success.

## 10. Task status

- Agent: `AGENT_COMPLETED`.
- Tests: `TESTS_PASSED` — `cd server && npm run typecheck` exit `0`; `platformAdmin.test.ts` 82/82 (22 new); `test:runtime:postgres-compat` exit `0`; `test:runtime:postgres` exit `0`.
- PR: see §11 for the exact PR link once opened.
- Merged: `NOT_MERGED`.
- Deployed: `NOT_DEPLOYED`.
- Production verified: `NOT_PRODUCTION_VERIFIED`.

## 11. Remaining R-019 gap

**R-019 is reduced, not closed.** Of the 37 platform-admin mutation endpoints inventoried, 25 are now `AUDITED_DURABLY` (19 pre-existing + 6 added here) and **12 remain `UNAUDITED`** — the full class-4/class-5 list in §4. `RISK_REGISTER.md` row 88 (R-019) should remain `OPEN`/`UNVERIFIED` until that remaining set (or a program-owner decision that it's acceptable residual risk) is addressed.

## 12. Exact next task

A bounded follow-up (suggested id: `F3-IMPL-004` or similar, to avoid colliding with any task already using that id) to close the 12 deferred endpoints in §4, using the identical `writePlatformAdminAuditEventInTx` pattern established here and in F3-IMPL-001 — no new infrastructure, no schema change expected. Class 4 (org/clinic/plan/user lifecycle, 10 routes) is the larger remaining slice; class 5 (2 file-backup routes) is a small, near-mechanical mirror of the already-audited DB-backup routes.
