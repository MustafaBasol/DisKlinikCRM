# R-061 — Authenticated Production Safe-Reset Verification (Final Closure Evidence)

**Task identity:** Documentation-only reconciliation and closure of R-061, based on a completed authenticated, non-activating production verification of the KVKK-HIGH-008 legacy-consent-correction runtime kill switch (`privacy.legacyConsentCorrection.runtimeEnabled`).
**Date:** 2026-07-24.
**Worktree:** `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\r061-production-closure`, branch `docs/r061-production-closure-20260724`, base `origin/main` @ `db53f374f49b9381ab55347871c50d0479ba8b69` — no drift at task start (confirmed `git rev-parse HEAD` == `git rev-parse origin/main`, clean working tree).
**Related risk:** [R-061](../RISK_REGISTER.md).
**Related evidence (preserved, not superseded in substance, only in disposition):** [R061_REMAINING_AUTHENTICATED_VERIFICATION_PACKAGE.md](R061_REMAINING_AUTHENTICATED_VERIFICATION_PACKAGE.md), [R061_PACKAGE_A_AUTHENTICATED_PRODUCTION_VERIFICATION.md](R061_PACKAGE_A_AUTHENTICATED_PRODUCTION_VERIFICATION.md), [R061_RESIDUAL_SAFE_RESET_PRODUCTION_VERIFICATION.md](R061_RESIDUAL_SAFE_RESET_PRODUCTION_VERIFICATION.md), [R061_PLATFORM_ADMIN_PASSWORD_RECOVERY_RUNBOOK.md](R061_PLATFORM_ADMIN_PASSWORD_RECOVERY_RUNBOOK.md).

## 1. Scope and prohibitions

This task is documentation/evidence-only. It records production facts and outcomes supplied by an authorized operator who executed the verification described below. This task itself:

- did not access production;
- did not receive, request, or store any credential, password, session cookie, JWT, CSRF token, database credential, or MFA value;
- did not modify application code, tests, the Prisma schema, migrations, dependencies, environment/configuration files, deployment files, or runtime settings;
- did not perform any production operation;
- did not create or modify a production account or password;
- did not activate the legacy consent correction workflow;
- did not set, or cause to be set, `runtimeEnabled=true` at any point.

The verification described below was itself, by design and by outcome, non-activating: it never submitted `runtimeEnabled=true`, performed no consent correction, and mutated no patient, communication-preference, backfill, or tenant data.

## 2. Production baseline

- Production repository SHA: `db53f374f49b9381ab55347871c50d0479ba8b69`.
- Public API: `https://api.noramedi.com`.
- Production database: `noramedi_crm`.
- PM2 API process: `noramedi-api`.
- Final API health: HTTP `200`.
- Final PM2 state: status `online`, unstable restarts `0`, restart count observed `20`.

This SHA is a descendant of every prior R-061 evidence document's own baseline (PR #197 "Package A", PR #221 admin password-recovery CLI) and includes the residual-safe-reset `DELETE` mechanism (`unsetPlatformSetting()`, implementation commit `b86001779fbbc2cfdcf76b84568d3d960850a761`) already recorded in [R061_RESIDUAL_SAFE_RESET_PRODUCTION_VERIFICATION.md](R061_RESIDUAL_SAFE_RESET_PRODUCTION_VERIFICATION.md).

## 3. Authentication recovery prerequisite

Every prior authenticated attempt against `admin@noramedi.com` had returned HTTP `401`, blocking R-061's authenticated closure chain (see [R061_RESIDUAL_SAFE_RESET_PRODUCTION_VERIFICATION.md](R061_RESIDUAL_SAFE_RESET_PRODUCTION_VERIFICATION.md) §6 and [R061_PLATFORM_ADMIN_PASSWORD_RECOVERY_RUNBOOK.md](R061_PLATFORM_ADMIN_PASSWORD_RECOVERY_RUNBOOK.md) §1). The audited operator CLI added by PR #221 (`server/src/scripts/platform-admin-recover-password.ts`, merged at the production baseline SHA above) was used to recover access to the existing production PlatformAdmin account.

Recorded facts (per the runbook's own §11 evidence-capture rules — no plaintext password, hash, or full account ID is recorded here or anywhere else):

| Field | Value |
|---|---|
| Account | `admin@noramedi.com` |
| Recovery implementation merge SHA | `db53f374f49b9381ab55347871c50d0479ba8b69` |
| Recovery audit action | `platform_admin.password_recovered` |
| Outcome | `success` |
| Method | `operator_cli` |
| Actor | system operator / null platform-admin actor (`actorPlatformAdminId: null`, by design — see the runbook §7 attribution decision; the account being recovered cannot, by definition, supply an authenticated-session actor) |
| MFA preserved | `mfaPreserved=true` |
| MFA state | Remained disabled — this is the account's pre-existing state; the CLI never reads or writes `totpSecretEncrypted`/`totpEnabledAt` |
| Sessions invalidated | `sessionsInvalidated=0` — `PlatformAdmin` sessions are stateless JWTs with no persistent session table and no `passwordChangedAt` field, so a prior-issued JWT cannot be revoked by this mechanism (documented limitation, not an oversight — see the runbook §8) |

No password, token, cookie, CSRF token, JWT, secret, or credential value is recorded in this document, consistent with the runbook's own prohibitions (§11–§12).

Following the runbook's post-reset rule (§10), exactly **one** normal platform-admin login was performed afterward through the real login route to confirm the new password — this CLI does not itself test login.

## 4. Diagnostic correction — incorrect read endpoint during preflight

During initial authenticated preflight investigation, the read endpoint was first attempted as:

- `GET /api/platform/privacy/legacy-consent-correction/settings`

The application defines no `GET` route on `/settings` — only `PATCH` and `DELETE` are defined there (`server/src/routes/platformAdmin.ts`). This produced misleading `HTTP 401 Unauthorized: Missing token` responses while testing the undefined `GET` path, which — taken at face value — could be misread as an authentication failure.

The correct read endpoint is:

- `GET /api/platform/privacy/legacy-consent-correction/policy`

This is recorded here as an **operational diagnostic note only**. It is not a product defect, not an authentication failure, and not a security incident: the `401` responses were the expected result of probing a path with no matching route under an auth-gated router, not evidence of a broken auth stack. During diagnosis of this discrepancy, the following were independently verified and confirm the auth stack itself was functioning correctly throughout:

- Cookie parsing correctly preserved the complete 369-character JWT.
- The JWT was structurally valid and unexpired.
- Claims included `type=platform`, the expected platform-administrator identity, and a session ID/JTI.
- Internal and public requests to the correct `/policy` endpoint both returned HTTP `200`.
- Bearer-token fallback was correctly rejected with `Unauthorized: Cookie session required` — confirming platform administration remains cookie-session-only, as intended, with no bearer-token bypass.

## 5. Correct endpoint map

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/platform/privacy/legacy-consent-correction/policy` | Read-only: current `runtimeEnabled` state |
| `PATCH` | `/api/platform/privacy/legacy-consent-correction/settings` | Set `runtimeEnabled` to an explicit boolean |
| `DELETE` | `/api/platform/privacy/legacy-consent-correction/settings` | Remove the persisted setting row, restoring absent/default-deny |

There is no `GET` on `/settings` (see §4).

## 6. CSRF / session-security behavior

- Platform-admin authentication is cookie-session-only.
- Bearer-token fallback is rejected with `Unauthorized: Cookie session required` — no bypass path exists.
- Unsafe methods (`PATCH`, `DELETE`) require a valid `X-CSRF-Token` header matching the session's CSRF cookie (double-submit pattern, `csrfProtection()` in `server/src/middleware/csrf.ts`), consistent with every prior R-061 evidence document's own description of this mechanism.
- No cookie value, JWT, or CSRF token value is recorded anywhere in this document.

## 7. Exact HTTP verification sequence and results

The following chain was completed through the public production API (`https://api.noramedi.com`) using an authenticated platform-admin cookie session obtained per §3, with valid CSRF protection on every unsafe request:

1. `GET /api/platform/privacy/legacy-consent-correction/policy`
   - HTTP `200`
   - `runtimeEnabled=false`

2. `PATCH /api/platform/privacy/legacy-consent-correction/settings`
   - Request body: `{ "runtimeEnabled": false }`
   - HTTP `200`
   - `runtimeEnabled=false`

3. `DELETE /api/platform/privacy/legacy-consent-correction/settings` (first)
   - HTTP `200`
   - `runtimeEnabled=false`
   - `settingPresent=false`
   - `removed=true`

4. `DELETE /api/platform/privacy/legacy-consent-correction/settings` (second, idempotency check)
   - HTTP `200`
   - `runtimeEnabled=false`
   - `settingPresent=false`
   - `removed=false`

5. `GET /api/platform/privacy/legacy-consent-correction/policy` (final)
   - HTTP `200`
   - `runtimeEnabled=false`

**Critical invariant, confirmed throughout:** `runtimeEnabled=true` was never submitted at any step. The legacy consent correction workflow was never enabled. No consent correction, patient-data mutation, communication-preference mutation, backfill, or tenant-data mutation of any kind was performed by this sequence.

This is the exact chain named as the remaining closure requirement by every predecessor R-061 evidence document (see [R061_RESIDUAL_SAFE_RESET_PRODUCTION_VERIFICATION.md](R061_RESIDUAL_SAFE_RESET_PRODUCTION_VERIFICATION.md) §12, [R061_PLATFORM_ADMIN_PASSWORD_RECOVERY_RUNBOOK.md](R061_PLATFORM_ADMIN_PASSWORD_RECOVERY_RUNBOOK.md) §14 step 7) — it is now complete.

## 8. Database final-state evidence

Final read-only query against `PlatformSetting` for key `privacy.legacyConsentCorrection.runtimeEnabled`:

- Final row count: `0`.

The setting therefore ended the verification window in the true absent/default-deny state — the same structural fail-closed default that has held in production since before this verification began, now additionally confirmed reachable and returnable to after an explicit `PATCH`/`DELETE` cycle.

## 9. Audit evidence

Two `PlatformAdminAuditEvent` rows were observed, both attributed to the authenticated platform administrator:

1. `platform_setting.updated`
   - `previousValue=false`
   - `newValue=false`
   - `outcome=success`

2. `platform_setting.reset`
   - `previousValue=false`
   - `newValue=null`
   - `outcome=success`
   - `safeMetadata.restoredDefaultState=true`

The second, idempotent `DELETE` (step 4 in §7) correctly produced **no** additional reset audit row, because no setting row existed for it to remove at that point — consistent with the reset mechanism's own no-op-when-absent design (`unsetPlatformSetting()`, `server/src/services/platformSettings.ts`), independently confirming atomic setting/audit behavior: a write only occurs when a row is actually mutated, and it is correctly attributed to the authenticated actor rather than a null/system actor (contrast with §3's account-recovery audit row, where a null actor is correct because no authenticated actor could exist at that point).

## 10. Cleanup evidence

All temporary authentication/session/probe artifacts were removed from production following the verification:

- `/root/r061-auth-session` (session directory) — removed.
- Temporary `r061_*` Python scripts — removed.
- Temporary `r061_*` Node scripts — removed.
- Matching Python cache files — removed.

Final cleanup verification:

- `session_directory_removed=true`
- `remaining_r061_artifacts=false`
- Production Git working tree: clean.

## 11. Health evidence

Post-verification, post-cleanup:

- API health: HTTP `200`.
- PM2 `noramedi-api`: `online`.
- Unstable restarts: `0`.
- Restart count observed: `20`.

## 12. Safety invariants

- `runtimeEnabled=true` was never submitted, at any step, by any command in this verification or its preflight diagnosis.
- The legacy consent correction workflow was never enabled.
- No patient record, communication preference, or consent field was read for mutation purposes or altered.
- No backfill or reconciliation job was triggered.
- No production account or password was created; the pre-existing `admin@noramedi.com` account was recovered, not replaced.
- No secret, credential, password, hash, cookie, JWT, or CSRF token value appears in this document or in any other file touched by this task.

## 13. Residual limitations and non-claims

This evidence closes R-061's own accept/reject decision (see §14) on the basis of a completed, non-activating authenticated verification of the default-deny runtime control. It does **not** establish, and this document makes no claim of:

- legal KVKK compliance approval of any kind;
- that the entire KVKK baseline is stable;
- that [KVKK_HIGH008_FREEZE_BOUNDARY.md](../KVKK_HIGH008_FREEZE_BOUNDARY.md) condition 4 (independent rollback rehearsal, independent test execution, and tenant-impact verification) is closed — that condition has its own separate evidence chain (F0-011-P2) and is unaffected by this document;
- that R-049 (CI coverage gap), R-062 (migration ordering), or any other risk besides R-061 is closed;
- that a production rollback rehearsal occurred during this task;
- that a real legacy consent correction was ever executed against a patient record;
- that any patient or clinic data was modified by this task or by the verification it records;
- that the legacy-consent-correction workflow was, at any point, enabled;
- that gaps 1–3 from the prior R-061 evidence chain (live-observed disabled-mutation-route behavior against a real, in-scope patient) are closed — they remain a separate, unauthorized item, unchanged, because they require a real patient record and were never in scope for any R-061 verification pass, including this one.

The stateless-JWT session-invalidation limitation recorded in §3 (`sessionsInvalidated=0`) is a pre-existing, documented architectural property of `PlatformAdmin` sessions (`middleware/platformAuth.ts`), not something this task introduced or was authorized to change.

## 14. Final R-061 disposition

Every remaining closure requirement named by the immediately preceding R-061 evidence chain — [R061_RESIDUAL_SAFE_RESET_PRODUCTION_VERIFICATION.md](R061_RESIDUAL_SAFE_RESET_PRODUCTION_VERIFICATION.md) §12, restated in [KVKK_HIGH008_FREEZE_BOUNDARY.md](../KVKK_HIGH008_FREEZE_BOUNDARY.md), [NORAMEDI_MASTER_TRACKER.md](../NORAMEDI_MASTER_TRACKER.md) §13, and [CURRENT_PHASE.md](../CURRENT_PHASE.md) — is now satisfied:

- The original no-kill-switch finding (R-061 as originally raised) was remediated by the `privacy.legacyConsentCorrection.runtimeEnabled` `PlatformSetting`-backed runtime control (PR #186, merged and deployed).
- That runtime control was deployed to production and its authenticated behavior has now been verified end-to-end.
- Default-deny behavior is confirmed: the setting reads `runtimeEnabled=false` both from an absent row (structural default) and from an explicit `false` value.
- Explicit `false` persistence is verified: `PATCH {"runtimeEnabled": false}` correctly writes and reads back `false`.
- Safe reset to the absent/default state is verified: `DELETE` correctly removes the row and returns to the structural default.
- Reset idempotency is verified: a second `DELETE` against an already-absent row returns `removed=false` with no additional audit row.
- Audit attribution and atomic setting/audit behavior are observed: both the update and the reset are attributed to the authenticated platform administrator, and the no-op idempotent `DELETE` correctly writes no spurious audit row.
- Final production state is: setting row **absent**; effective `runtimeEnabled=false`.
- `runtimeEnabled=true` was never used, at any point, in this or any predecessor R-061 verification task.

**R-061 human decision, recorded explicitly:** the program rejects the original no-kill-switch design; it required and has now implemented a runtime default-deny kill switch for the legacy-consent-correction workflow; and that control has been verified safely in production without enabling the workflow.

**R-061 status: `CLOSED`.**

This closure is scoped precisely to R-061 as defined (the absence of, and later remediation of, a runtime kill switch for the legacy-consent-correction workflow, plus its authenticated production verification). It does not extend to, and must not be read as closing, any other risk row or freeze-boundary condition — see §13.
