# KVKK-HIGH-008-F1 — Production-Safe, Non-Activating Behavioral Verification

**Task ID:** KVKK-HIGH-008-F1-PROD-BEHAVIORAL-SAFE-VERIFY
**Date:** 2026-07-21
**Phase:** F0 — Baseline, Program Control, and Architecture Validation
**Overall result:** **PARTIALLY VERIFIED** — not a complete verification, not a failed one.

## 1. Evidence classification and execution model

`VERIFIED_USER_SUPPLIED_PRODUCTION_EVIDENCE` for every result recorded below, with one sub-result recorded as `BLOCKED_NOT_EXECUTED` (see §5).

All production commands in this pass were prepared by this task and **executed exclusively by the user**, directly on the production host. This task itself:

- was never given SSH access, and never requested or received an SSH key;
- never requested, received, read, or stored any platform-admin credential, password, MFA code, session cookie, CSRF token, access token, or `DATABASE_URL`;
- never received a raw HTTP response body, raw log line, patient identifier, patient name/phone/email, or any other PII;
- did not perform, request, or observe any deployment, migration, PM2 restart/reload, `PlatformSetting` write, backfill, or patient/consent mutation;
- did not commit or push any change prior to this documentation pass, and this pass itself is not committed/pushed pending the user's review (see §9).

Everything in §2–§8 is the user's own redacted, aggregate-only report of command output, analyzed here without alteration.

## 2. Production and runtime baseline

- Verification window: `2026-07-21T20:50:06Z` – `2026-07-21T20:58:38Z`.
- Host: `disklinik-prod-01`. Repository path: `/var/www/noramedi`. Branch: `main`. Working tree: clean.
- Production `HEAD`: `85e3ffbca7ee1b53789564e16c5e58c5ec498cf2` (unchanged from the KVKK-HIGH-008-F1-PROD-DOCS baseline recorded in [KVKK-HIGH-008-F1_PRODUCTION_DEPLOYMENT_VERIFICATION.md](KVKK-HIGH-008-F1_PRODUCTION_DEPLOYMENT_VERIFICATION.md)).
- `origin/main` observed at fetch time: `cf947ea244f274c60b71085bab1025ca3bc3803a`. Production trailing `origin/main` is recorded as informational only — no deploy was authorized or performed by this task, and this is explicitly not treated as a deployment failure.
- PR #186 ancestor-of-production-HEAD check: confirmed (`PR186_INCLUDED=yes`).
- `noramedi-api`: `online`, restart count `17` before and after — unchanged.
- `noramedi-worker`: `online`, restart count `16` before and after — unchanged.
- Prisma: `65` migrations found, "Database schema is up to date."

No process instability, restart-count increase, unexpected drift, or pending/failed migration was observed. No stop condition was triggered by Phase A.

## 3. Before/after database invariant comparison (Phase B → Phase D)

| Check | Before (Phase B) | After (Phase D) | Result |
|---|---|---|---|
| `PlatformSetting` row count (`privacy.legacyConsentCorrection.runtimeEnabled`) | `0` | `0` | Unchanged |
| `PlatformSetting` value | `ABSENT` | `ABSENT` | Unchanged |
| `PlatformAdminAuditEvent` total | `0` | `0` | Unchanged |
| `PlatformAdminAuditEvent` rows for this setting's `resourceKey` | `0` | `0` | Unchanged |
| `PatientLegacyConsentCorrection` total | `0` | `0` | Unchanged |
| `Patient.smsOptOut = true` count | `0` | `0` | Unchanged |
| `Patient.smsOptOut = false` count | `17` | `17` | Unchanged |
| `Patient.smsOptOutAt IS NOT NULL` count | `0` | `0` | Unchanged |
| `Patient` smsOptOut/smsOptOutAt digest | `6108337ffa688b7ba4d7f5ac13cc94ed` | `6108337ffa688b7ba4d7f5ac13cc94ed` | Identical hash |
| `SecuritySignalEvent` count for `platform_admin.config_change.v1` | `0` | `0` | Unchanged |

**All 10 measured values are identical before and after.** `ALL_DATABASE_INVARIANTS_UNCHANGED=yes`, as reported by the user. No stop condition was triggered; no repair/toggle/delete action was necessary or performed.

The absent `PlatformSetting` row confirms the runtime gate remained on its fail-closed, missing-row default (`effectively false`) throughout the verification window, both before and after every test in §4 ran.

## 4. Endpoint-behavior results

### 4.1 Test C1 — Authenticated read-only policy endpoint: **BLOCKED / NOT EXECUTED**

The user's platform-admin login attempt (`POST /api/platform/auth/login`) returned `HTTP 401` with error `Invalid credentials`. Per the prepared command package's own stop condition ("any status other than 200 → do not proceed... report only the status code"), the user correctly halted before issuing the authenticated `GET` request. **No session was established; the read-only policy endpoint was never called.**

This is recorded as `BLOCKED / NOT EXECUTED`, not as a failure of the endpoint or the runtime gate — the login rejection reflects the credential attempt made, and reveals nothing about the policy endpoint's own behavior.

### 4.2 Test C2 — Unauthenticated rejection check: **VERIFIED**

`PATCH /api/platform/privacy/legacy-consent-correction/settings` with body `{"runtimeEnabled": false}`, no credentials attached: `HTTP 401`. Production log confirmed the same request: PATCH route, `statusCode 401`, `responseTime 2ms`. This matches the expected outcome exactly and is consistent with the static-inspection proof already on file (`router.use(authenticatePlatformAdmin, csrfProtection('platform'))` gating every route below it in `platformAdmin.ts`) — the handler body was never reached, and no `PlatformSetting`/`PlatformAdminAuditEvent` mutation occurred (confirmed by §3's zero deltas).

### 4.3 Test C3 — Authenticated invalid-payload rejection check: **BLOCKED / NOT EXECUTED**

Not attempted, for the same reason as §4.1 — Test C3 requires the same authenticated session that Test C1 could not obtain. No invalid-payload PATCH was sent.

### 4.4 Test 4 — Disabled mutation route with a real patient: **NOT SAFELY EXECUTABLE IN PRODUCTION** (unchanged from prior evidence)

Reason, reaffirmed by the user and unchanged from [F0-011-P1](F0-011-P1_KVKK_HIGH008_ACTIVE_WORK_BASELINE.md)/prior passes: `loadScopedPatient` resolves a real, existing patient via `prisma.patient.findFirst(...)` **before** the runtime-disabled gate check in `legacyConsentCorrection.ts` is ever reached. A synthetic/non-resolving patient ID would 404 at the patient-lookup step and would prove nothing about fail-closed gate behavior — it would not exercise the gate at all. A real patient identifier is prohibited as a test subject for this task. This test remains out of scope and was not run; it is not counted toward either "verified" or "not verified" endpoint coverage — it is its own, permanently excluded category for this verification method.

## 5. Health and log verification

- API health: `HTTP 200`, body `status: ok`.
- `https://noramedi.com`: `HTTP 200`. `https://app.noramedi.com`: `HTTP 302` → `/login` (expected redirect for an unauthenticated request).
- No `5xx` responses observed anywhere in Phase E.
- API logs in the verification window: no new Prisma, `PlatformAdminAuditEvent`, legacy-consent-correction, audit, or `5xx` errors; the expected unauthorized-PATCH `401` (§4.2) is present as expected. Pre-existing WhatsApp JSON-parsing errors were observed and are unrelated/pre-existing (already tracked as [R-066](../RISK_REGISTER.md)).
- Worker logs: no relevant runtime errors; Prisma config/schema startup lines were normal.
- PM2 process state and restart counts unchanged from §2 baseline.

No stop condition was triggered by Phase E.

## 6. Final state confirmation

Production working tree remained clean; branch remained `main`; `HEAD` remained unchanged (`85e3ffbca7ee1b53789564e16c5e58c5ec498cf2`); migration status remained up to date; both PM2 processes remained `online` with unchanged restart counts; all temporary verification files and shell variables (cookie jar, response bodies, `CSRF_TOKEN` variable) were removed by the user after use. No commit or push was performed on the production host or in this repository as part of running the command package.

## 7. Evidence classification summary

**Verified in this pass (`VERIFIED_USER_SUPPLIED_PRODUCTION_EVIDENCE`):**

- Production baseline (branch/HEAD/clean tree/migration status/PM2 health), consistent with the prior KVKK-HIGH-008-F1-PROD-DOCS evidence.
- Fail-closed stored-setting baseline: `PlatformSetting` row absent, both before and after all tests (§3).
- Unauthenticated PATCH rejection behavior (§4.2) — real production confirmation of the static-inspection proof already on file.
- Database invariants: zero deltas across all 10 measured values (§3) — no test in this pass mutated any tracked table.
- Health and relevant logs: no blocker-class error, no `5xx`, no unexpected restart.

**Not verified in this pass (unchanged category — still open, still requires a future pass with valid credentials or a separate authorization):**

- Authenticated read-only policy-endpoint behavior (Test C1) — blocked by a login credential rejection, not attempted.
- Authenticated invalid-payload rejection behavior (Test C3) — not attempted, same reason.
- Successful `PlatformAdminAuditEvent` row creation, and its actor/previous-value/new-value attribution — no such row exists in production to inspect (§3 confirms the audit table remains empty).
- Controlled activation of `privacy.legacyConsentCorrection.runtimeEnabled` — not attempted, not authorized, not in scope for this or any non-activating verification task.
- Disabled-mutation-route behavior via a real patient (Test 4) — permanently excluded from this verification method (§4.4), not merely deferred.

## 8. Risk disposition

- **R-061** — remains `OPEN`. This pass adds independently production-verified evidence for the unauthenticated-rejection path and confirms all database invariants held across the verification window, but the authenticated policy-endpoint and invalid-payload checks remain `BLOCKED / NOT EXECUTED` (credential rejection, not a negative finding), and successful `PlatformAdminAuditEvent` creation remains unverified because no such row exists in production. See updated wording in [RISK_REGISTER.md](../RISK_REGISTER.md) R-061.
- **R-046** — remains `OPEN`. Full production cross-tenant/audit verification is unaffected by this pass.
- **R-062** — remains `MITIGATED` (migration-ordering component only); unaffected by this pass.
- **R-070** — remains `OPEN`; unaffected by this pass (no migration/rollback activity occurred).

## 9. Non-authorization statement

This document, and the KVKK-HIGH-008-F1-PROD-BEHAVIORAL-SAFE-VERIFY task that produced it, record read-only, user-executed, user-supplied production evidence only. They do not authorize, perform, or declare: feature activation, a `PlatformSetting` write, a `PlatformAdminAuditEvent` creation, a real-patient test of the disabled mutation route, or a "KVKK baseline stable" declaration. The overall result is **PARTIALLY VERIFIED**, not complete — authenticated-endpoint behavior remains an open gap requiring either a retried login with valid credentials (still non-activating, same command package) or its own follow-up task. This documentation change is not committed or pushed; it awaits the user's review of the diff.
