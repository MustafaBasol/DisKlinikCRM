# R-061 Package A — Authenticated Production Verification Result

**Execution classification:** `VERIFIED_USER_SUPPLIED_PRODUCTION_EVIDENCE`
**Execution date:** 2026-07-22/23 production verification window
**Related risk:** [R-061](../RISK_REGISTER.md)
**Prepared command package:** [R061_REMAINING_AUTHENTICATED_VERIFICATION_PACKAGE.md](R061_REMAINING_AUTHENTICATED_VERIFICATION_PACKAGE.md)
**Production application baseline:** `1aa741d1dc1e1888b1dfdb9b911d0123b4eea1ab`
**Documentation branch baseline:** `origin/main` @ `ebb0246c0af9d32e71f4057e5d497ee140266bfc`

## 1. Scope

An authorized human operator executed Package A’s already-authorized, non-activating authenticated production retry.

The verification was limited to:

- normal platform-admin login;
- Test C1, authenticated read-only policy `GET`;
- Test C3, authenticated deliberately-invalid `PATCH`;
- before/after database invariants;
- patient-state digest comparison;
- application health and PM2 process-state checks;
- local session/cookie-variable cleanup.

Package B was not executed.

No real patient identifier was used. No valid-boolean setting PATCH was sent. The feature was not activated.

## 2. Authentication result

Normal application login endpoint:

`POST /api/platform/auth/login`

Result:

- HTTP `200`;
- a valid authenticated platform-admin session was obtained;
- the CSRF token was captured only into an in-memory shell variable and was not intentionally printed or committed;
- the temporary cookie jar and session variables were deleted/unset after verification.

A forgotten platform-admin password was reset before the final Package A verification window. That password reset changed the selected `PlatformAdmin.passwordHash` and `updatedAt` before the final before/after invariant capture. It is not represented as a Package A side effect.

## 3. Test C1 result

Endpoint:

`GET /api/platform/privacy/legacy-consent-correction/policy`

Observed result:

    HTTP 200
    {"runtimeEnabled":false}

Classification:

`PASS — AUTHENTICATED PRODUCTION VERIFIED`

This confirms that the production runtime reports the legacy-consent-correction gate as disabled through the effective fail-closed state.

## 4. Test C3 result

Endpoint:

`PATCH /api/platform/privacy/legacy-consent-correction/settings`

Deliberately invalid request body:

    {"runtimeEnabled":"not-a-boolean"}

Observed result:

    HTTP 400
    {"error":"runtimeEnabled must be a boolean"}

Classification:

`PASS — AUTHENTICATED INVALID-PAYLOAD REJECTION PRODUCTION VERIFIED`

The request was rejected before any setting-write/audit transaction could execute.

## 5. Before/after invariants

Final Package A before invariant:

    0||0|0|0|0|18|0|0

Final Package A after invariant:

    0||0|0|0|0|18|0|0

The values represent the prepared package’s checked production state, including:

- no persisted `privacy.legacyConsentCorrection.runtimeEnabled` setting row;
- no value for that absent row;
- zero relevant platform-admin audit events;
- zero legacy-consent correction rows;
- unchanged patient SMS opt-out aggregate counts;
- zero relevant security-signal rows.

The before and after values are identical.

## 6. Patient-state digest

Final Package A before digest:

    c91b3a90502dad4b92ee465c477190b6

Final Package A after digest:

    c91b3a90502dad4b92ee465c477190b6

The digest is identical before and after the authenticated tests.

The production patient count had changed from 17 to 18 before the final authenticated verification window. The additional patient predated the final Package A baseline and was not created or modified by Package A. The final window itself preserved both the count and digest.

## 7. Runtime health and cleanup

Final checks:

    health status: 200
    noramedi-api online restarts=18
    noramedi-worker online restarts=16
    final Package A session cleaned

No restart-count increase occurred during the final Package A window.

The temporary cookie jar was removed and the platform-admin email, CSRF token, response bodies, statuses, and other session variables were unset.

## 8. Security-handling note

During an earlier, preliminary verification attempt, a filtered log excerpt displayed an `x-csrf-token` value. The authenticated session cookie was masked and was not exposed. The local cookie jar was immediately deleted and shell session variables were cleared.

A CSRF token alone is not sufficient to authenticate without the corresponding signed session cookie. No broad secret rotation was performed because the session cookie was not disclosed and the local session material was removed.

No credential, password, session cookie, database credential, or production environment value is stored in this evidence document.

## 9. Result and precise risk disposition

Package A result:

`PASS — AUTHENTICATED PRODUCTION VERIFIED`

Package A closes:

- Test C1 — authenticated policy read;
- Test C3 — authenticated invalid-payload rejection;
- the previously credential-blocked authenticated retry;
- confirmation that the final authenticated verification window produced no measured setting, audit, correction, security-signal, or patient-state change.

Package A does not close:

- gaps 1–3: live real-patient mutation/read/history behavior;
- gaps 4–8: a successful valid setting write, successful production `PlatformAdminAuditEvent` creation, actor attribution, previous/new values, and audit-content inspection;
- gap 9: controlled activation.

Those remaining items require separate human authorization decisions described in Package B. Package B was not executed and is not authorized by this evidence.

Therefore:

`R-061 remains OPEN — Package A PASS; Test C1/Test C3 CLOSED; separately-gated gaps 1–9 remain governed by their existing authorization decisions.`

## 10. Change boundary

This evidence records operator-executed production results.

This documentation task itself:

- did not access production;
- did not receive or store credentials;
- did not execute Package B;
- did not change application code;
- did not change tests, Prisma schema, migrations, package files, deployment scripts, or configuration;
- does not authorize a real-patient test, an explicit-false setting write, or controlled activation.
