# R-061 — Residual-Safe-Reset Production Deployment and Verification

**Task identity:** Documentation-only reconciliation of an operator-executed production deployment and verification of the R-061 residual-safe-reset mechanism (the `unsetPlatformSetting`/`DELETE` reversibility path for `privacy.legacyConsentCorrection.runtimeEnabled`).
**Date:** 2026-07-23.
**Worktree:** `D:\wt\r061-prod-verify`, branch `audit/r061-residual-reset-production-verification`, base `origin/main` @ `8906e66af5169220a4aed48fe4cfea8524976fb8` — this is also the confirmed production application SHA recorded below; no drift between base and production at task start.
**Related risk:** [R-061](../RISK_REGISTER.md) (`OPEN`).
**Related evidence:** [R061_REMAINING_AUTHENTICATED_VERIFICATION_PACKAGE.md](R061_REMAINING_AUTHENTICATED_VERIFICATION_PACKAGE.md), [R061_PACKAGE_A_AUTHENTICATED_PRODUCTION_VERIFICATION.md](R061_PACKAGE_A_AUTHENTICATED_PRODUCTION_VERIFICATION.md).

## 1. Documentation-only statement

This task did not access production itself. All production facts recorded below were supplied by an authorized human operator who executed the deployment and verification steps directly. This task did not modify application code, tests, the Prisma schema, migrations, package files, deployment scripts, or environment/configuration files — it records operator-supplied evidence only, in documentation and evidence files.

## 2. Implementation summary (merged before this task)

Feature branch `feature/r061-residual-safe-closure`, implementation commit `b86001779fbbc2cfdcf76b84568d3d960850a761` (`fix(privacy): add audited legacy consent setting reset`), merged into `origin/main` prior to this task. It adds:

- `unsetPlatformSetting(key, client = prisma): Promise<boolean>` (`server/src/services/platformSettings.ts`);
- `DELETE /api/platform/privacy/legacy-consent-correction/settings` (`server/src/routes/platformAdmin.ts`), alongside the pre-existing `PATCH` on the same path.

DELETE behavior, per the operator-supplied implementation summary:

- uses the same setting-scoped PostgreSQL advisory lock as `PATCH`;
- if the setting row is absent, returns `removed:false` and writes **no** audit row (idempotent no-op);
- if the setting row is present, atomically deletes it and writes a `PlatformAdminAuditEvent` row with `action: platform_setting.reset`, `newValue: null`, and metadata including `restoredDefaultState: true`;
- response body: `{ runtimeEnabled: false, settingPresent: false, removed: <boolean> }`.

Relevant source tests reported passing before merge, including: false-row reset, absent-row idempotency, audit-failure rollback, and concurrent PATCH/DELETE serialization. This task did not independently re-execute these tests; they are recorded here as operator-supplied, pre-merge facts, consistent with `server/src/tests/platformAdmin.test.ts`.

This resolves the previously-documented absence of an unset/delete path for `privacy.legacyConsentCorrection.runtimeEnabled` — see §7 for the corresponding supersession note.

## 3. Production deployment

- Production repository: `/var/www/noramedi`.
- Production application SHA after deployment: `8906e66af5169220a4aed48fe4cfea8524976fb8`.
- Production `HEAD` == `origin/main` at this SHA; working tree clean.
- `npm run typecheck` completed successfully.
- `noramedi-api` restarted; PM2 status: `online`.
- API startup log: `Server is running on 127.0.0.1:5000`.

### 3.1 Startup-window `502`

An initial external `502` occurred only during the restart/startup window, before the process began listening. This is consistent with the known startup-readiness gap already recorded as [R-063](../RISK_REGISTER.md) (PM2 routes traffic to the reloading process before it starts listening). It is **not** classified as a deployment failure: all checks performed after startup completed (see §4) returned expected results, and no application or infrastructure defect is implied by this transient window.

## 4. Unauthenticated endpoint results (post-startup)

All requests below were made without an authenticated session:

| Request | Result |
|---|---|
| Local `GET .../legacy-consent-correction/policy` | HTTP `401` |
| Public `GET .../legacy-consent-correction/policy` | HTTP `401` |
| Public `DELETE .../legacy-consent-correction/settings` | HTTP `401` |

Response body for the rejected requests:

```
{"error":"Unauthorized: Missing token"}
```

This confirms both the pre-existing unauthenticated `GET`/`PATCH` protection and the newly-deployed `DELETE` route are fail-closed for unauthenticated callers, consistent with the same authentication middleware already covering `PATCH` on this path.

## 5. Database invariants (pre-authenticated-attempt)

Final database state before any authenticated request was attempted:

- `settingPresent`: `false`
- `settingValue`: `null`
- `settingUpdatedAt`: `null`
- `resetAuditCount`: `0`
- `allSettingAuditCount`: `0`

This is consistent with every prior production evidence pass for this setting (row absent, effective fail-closed default).

## 6. Authenticated verification attempt — outcome and stop-condition compliance

A single normal platform-admin login attempt was made against the production login endpoint. It returned HTTP `401`.

Per the existing stop condition (see [R061_REMAINING_AUTHENTICATED_VERIFICATION_PACKAGE.md](R061_REMAINING_AUTHENTICATED_VERIFICATION_PACKAGE.md) §A.2):

- no second credential was guessed or attempted;
- no authenticated `GET`/`PATCH`/`DELETE` request was sent;
- no valid-boolean `PATCH` was sent;
- no setting row was created;
- no audit row was created.

This is a credential-attempt rejection. It is not evidence about the behavior of the `GET`/`PATCH`/`DELETE` endpoints themselves, and it must not be characterized as an endpoint defect.

Final post-attempt database check (unchanged from §5):

- `settingPresent`: `false`
- `settingValue`: `null`
- `settingUpdatedAt`: `null`
- `auditCount`: `0`
- `recentAudits`: `[]`

PM2 remained `online`. Production `HEAD` remained `8906e66af5169220a4aed48fe4cfea8524976fb8`. The repository remained clean. Temporary cookie/login files and secret-bearing shell variables were cleaned. No patient or consent data was read or mutated. No feature activation occurred.

## 7. What was, and was not, executed — matrix

| Item | Result |
|---|---|
| Deployment of the reversible reset mechanism | `PASS` |
| API startup/service health | `PASS` |
| Unauthenticated protection of `GET` and `DELETE` | `PASS` |
| Default-false/absent database invariant | `PASS` |
| Successful authenticated explicit-`false` `PATCH` | `BLOCKED / NOT EXECUTED` |
| Authenticated `DELETE`, `removed:true` | `BLOCKED / NOT EXECUTED` |
| Idempotent authenticated `DELETE`, `removed:false` | `BLOCKED / NOT EXECUTED` |
| Production `PlatformAdminAuditEvent` write/reset verification | `BLOCKED / NOT EXECUTED` |
| Controlled activation (`runtimeEnabled:true`) | `NOT AUTHORIZED / NOT EXECUTED` |
| Real-patient mutation/read-history behavioral gaps (gaps 1–3) | `NOT AUTHORIZED / NOT EXECUTED` |

### Supersession note — reversibility

Prior feasibility evidence (e.g. [KVKK-HIGH-008-F1-PBV-S1](KVKK-HIGH-008-F1-PBV-S1_SAFE_BEHAVIORAL_PRODUCTION_VERIFICATION_FEASIBILITY.md), and Package B item B.2 in [R061_REMAINING_AUTHENTICATED_VERIFICATION_PACKAGE.md](R061_REMAINING_AUTHENTICATED_VERIFICATION_PACKAGE.md)) correctly stated, at the time it was captured, that no unset/delete API existed for `PlatformSetting`, and therefore an explicit-`false` `PATCH` was **irreversible**. That historical text is preserved and must not be deleted or rewritten.

It is now **superseded**: the merged and deployed `DELETE` mechanism (§2 above) resolves that specific limitation — reversibility is now available in both code and production. However, the authenticated reversible chain (`PATCH` → verify → `DELETE` → verify → idempotent second `DELETE` → verify) was **not executed** in this task, because the single normal platform-admin login attempt returned HTTP `401` (§6). Gaps 4–8 therefore remain production-unverified, but the reason has changed: it is no longer because the reset path is absent from code/production — it is because the authenticated chain to exercise it has not yet been run.

## 8. Secret and data-minimization statement

No credential, password, session cookie, database credential, CSRF token, MFA value, raw login request/response body, IP address, or patient identifier is recorded anywhere in this document. Temporary cookie/login files and secret-bearing shell variables used by the operator were cleaned after the attempt.

## 9. Final state

- Service: `noramedi-api` `online` (PM2), post-startup health nominal.
- Repository: production `HEAD` == `origin/main` == `8906e66af5169220a4aed48fe4cfea8524976fb8`; working tree clean.
- Database: `privacy.legacyConsentCorrection.runtimeEnabled` setting row absent; effective default `false`; zero audit rows for this setting; zero rows created or modified by this task's activity.

## 10. Verdict

**`PASS WITH BLOCKED AUTHENTICATED RESIDUAL`**

Precise disposition, item by item, matches §7 above: the reversible reset mechanism is deployed and its unauthenticated protection, service health, and default database invariants are all production-verified `PASS`. The authenticated write/reset/idempotency chain and production audit attribution remain `BLOCKED / NOT EXECUTED` because the platform-admin login attempt returned `401`. Controlled activation and real-patient production tests remain separately unauthorized and were not attempted.

## 11. R-061 status

**R-061 remains `OPEN`.**

Recommended current wording:

> OPEN — reversible reset implementation is merged and deployed; unauthenticated route protection, API health, clean repository state, and absent/default-false production database invariants are verified. Successful authenticated explicit-false write/reset/idempotency and production audit attribution remain blocked because the single normal platform-admin login attempt returned HTTP 401. No authenticated setting request was sent. Controlled activation and real-patient production tests remain separately unauthorized.

## 12. Exact remaining closure requirements

1. Obtain or validate the normal platform-admin authentication path/credential operationally.
2. Rerun only the already-authorized, non-activating authenticated chain: `GET` policy → `PATCH runtimeEnabled:false` → verify setting/audit → `DELETE` reset → verify `removed:true` → second `DELETE` → verify `removed:false`/no extra audit → final absent/default-false invariant.
3. Do not authorize `runtimeEnabled:true` or a real-patient production test as part of this closure — those remain separate, later, explicitly-gated decisions (Package B, unchanged).

## 13. Change boundary

This documentation task itself:

- did not access production;
- did not receive or store credentials, cookies, tokens, MFA values, or raw login payloads;
- did not change application code, tests, Prisma schema, migrations, package files, deployment scripts, or configuration;
- did not execute Package B, controlled activation, or any real-patient test;
- does not claim R-061 is closed.
