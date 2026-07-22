# R-061 — Remaining Authenticated Verification Package

**Task type:** Documentation and command-preparation only. No production access performed or requested by this task.
**Related risk:** R-061 ([RISK_REGISTER.md](../RISK_REGISTER.md))
**Related freeze boundary:** [KVKK_HIGH008_FREEZE_BOUNDARY.md](../KVKK_HIGH008_FREEZE_BOUNDARY.md)
**Worktree:** `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\r061-authenticated-verification-package`, branch `docs/r061-authenticated-verification-package`, created from `origin/main` at `70ac5ed9d729783c7cda492b126b1f34d6b3ca77` (merge of [PR #193](https://github.com/MustafaBasol/DisKlinikCRM/pull/193)).
**Primary working tree:** not touched. Remains at `docs/kvkk-20260720-production-reconciliation`, `HEAD 404f653`.

## 0. Non-negotiable constraints this task operated under

This task did not access production, and was never given — and never requested — any of: SSH access, an SSH key, a database credential, a platform-admin password, a token, a session cookie, an MFA code, or a patient identifier. Every command below is prepared text only; none of it was executed by this task. Package A never embeds a credential value in the document itself — the login step (A.2) prompts the user interactively (`read`/`read -s`) at execution time, so no email, password, TOTP code, session cookie, or CSRF token is ever written into this file, and none is ever to be pasted back into it or into any other committed file.

## 1. Preserved verified facts (unchanged by this task)

This task adds no new production observation and changes no prior finding. It carries forward, unmodified, the record established across [F0-011-P1](F0-011-P1_KVKK_HIGH008_ACTIVE_WORK_BASELINE.md), [F0-011-P3](F0-011-P3_KVKK_HIGH008_F1_PRODUCTION_DEPLOYMENT_EVIDENCE.md), [KVKK-HIGH-008-F1-PBV-S1](KVKK-HIGH-008-F1-PBV-S1_SAFE_BEHAVIORAL_PRODUCTION_VERIFICATION_FEASIBILITY.md), and [KVKK-HIGH-008-F1_PRODUCTION_SAFE_BEHAVIORAL_VERIFICATION.md](KVKK-HIGH-008-F1_PRODUCTION_SAFE_BEHAVIORAL_VERIFICATION.md):

1. The `privacy.legacyConsentCorrection.runtimeEnabled` `PlatformSetting` row is **absent** in production.
2. The effective runtime behavior is **fail-closed / default false** (missing-row default, `platformSettings.ts:11-17` + `legacyConsentCorrection.ts`).
3. An unauthenticated `PATCH /api/platform/privacy/legacy-consent-correction/settings` returned **HTTP 401**, confirmed live in production (2026-07-21 pass, §4.2 of the safe-behavioral-verification evidence).
4. Before/after production invariants (10 measured values: `PlatformSetting` row/value, `PlatformAdminAuditEvent` totals, `PatientLegacyConsentCorrection` total, `Patient.smsOptOut`/`smsOptOutAt` counts and digest, `SecuritySignalEvent` count) were **unchanged** across that same verification window.
5. The authenticated policy `GET` (Test C1) and the authenticated invalid-payload `PATCH` (Test C3) were both **`BLOCKED / NOT EXECUTED`** in that pass because the platform-admin login attempt (`POST /api/platform/auth/login`) returned **HTTP 401 `Invalid credentials`**, and the user correctly halted per the prepared package's own stop condition rather than guessing or retrying with fabricated credentials.
6. That credential rejection is evidence about the credentials attempted, **not** about the policy/PATCH endpoints' own behavior — it does not prove, and must never be characterized as proving, endpoint failure.
7. Real-patient mutation-route verification (the disabled `POST .../legacy-corrections/sms-opt-out` route) is **not safely executable** under current rules: `loadScopedPatient()` resolves a real, existing, in-scope patient **before** the runtime gate is ever checked (`communicationPreferences.ts:563,574`), so a synthetic/nonexistent patient ID 404s at the lookup step and proves nothing about the gate. This task does not attempt it and does not authorize it.
8. Successful `PlatformAdminAuditEvent` row creation — actor attribution, previous/new value chain, outcome field — remains **unverified**: the table holds 0 rows in production, and no PATCH that would create one has ever been sent.
9. **R-061 remains `OPEN`.**
10. A `false → true → false` activation cycle is **forbidden** by this task and by every prior task in this line — it is not proposed as an executable step anywhere in this document, including Package B.

Nothing below adds a new production fact. It prepares commands for the user to run later, and separately documents a decision memo the user has not been asked, and is not being asked here, to approve for execution.

---

## Package A — Already-Authorized, Non-Activating Authenticated Retry

**Purpose:** retry, and only retry, the two authenticated checks that were previously blocked by a credential rejection (Test C1, Test C3), plus the before/after invariant and log checks that already have precedent in the prior pass. Every command in this package is either strictly read-only, or is a `PATCH` whose body is deliberately invalid and must be rejected before it reaches any state-changing code. **No command in this package can create, update, or delete a `PlatformSetting` row, and none can create a `PlatformAdminAuditEvent` row.**

This package is to be run **by the user, manually**, after the user has obtained a valid platform-admin session through the application's own normal login flow (its own browser/password/MFA — never supplied to, or requested by, this task or any agent). Nothing in this section is executed by this task.

### A.0 Preconditions

- Run this from the production host, as the same operator/account used for prior verification passes (`disklinik-prod-01`, `/var/www/noramedi`), in one continuous shell session so exported variables carry forward.
- Do **not** paste a real password, session cookie, CSRF token, or database credential into this file, into chat, or into any other committed document at any point — screen them out of any output before sharing it back.
- Do **not** proceed past any step whose stop condition is triggered. A triggered stop condition is itself valid, reportable evidence (as it was for Test C1/C3 previously) — it is not a failure of this package.
- Do **not** enable shell tracing (`set -x`) at any point this session, and confirm it is not already on (`set +x` in A.2 makes this explicit) — a traced shell would echo the password/JSON payload to the terminal/log even though it is never placed in a command-line argument.
- The login step (A.2) reads the password via `read -s` rather than a command-line argument, specifically so it never appears in shell history or in another user's `ps` output on this shared host.

### A.1 Baseline capture (before)

```bash
APP_DIR="/var/www/noramedi"
DB_NAME="noramedi_crm"
cd "$APP_DIR" || exit 1

echo "--- Git state ---"
git rev-parse HEAD
git rev-parse --abbrev-ref HEAD
git status --short

echo "--- PM2 state (before) ---"
pm2 jlist | node -e "
const procs = JSON.parse(require('fs').readFileSync(0, 'utf8'));
for (const p of procs) {
  if (p.name === 'noramedi-api' || p.name === 'noramedi-worker') {
    console.log(p.name, p.pm2_env.status, 'restarts=' + p.pm2_env.restart_time);
  }
}
"

echo "--- Health (before) ---"
curl -s -o /dev/null -w 'health status: %{http_code}\n' https://api.noramedi.com/api/health

echo "--- Prisma migration status (before) ---"
cd server && npx prisma migrate status 2>&1 | tail -5 && cd ..

echo "--- DB invariants (before) ---"
sudo -u postgres psql -d "$DB_NAME" -t -A -c "
SELECT
  (SELECT count(*) FROM \"PlatformSetting\" WHERE key = 'privacy.legacyConsentCorrection.runtimeEnabled') AS setting_row_count,
  (SELECT value FROM \"PlatformSetting\" WHERE key = 'privacy.legacyConsentCorrection.runtimeEnabled') AS setting_value,
  (SELECT count(*) FROM \"PlatformAdminAuditEvent\") AS audit_total,
  (SELECT count(*) FROM \"PlatformAdminAuditEvent\" WHERE \"resourceKey\" = 'privacy.legacyConsentCorrection.runtimeEnabled') AS audit_for_this_setting,
  (SELECT count(*) FROM \"PatientLegacyConsentCorrection\") AS correction_total,
  (SELECT count(*) FROM \"Patient\" WHERE \"smsOptOut\" = true) AS sms_optout_true,
  (SELECT count(*) FROM \"Patient\" WHERE \"smsOptOut\" = false) AS sms_optout_false,
  (SELECT count(*) FROM \"Patient\" WHERE \"smsOptOutAt\" IS NOT NULL) AS sms_optout_at_set,
  (SELECT count(*) FROM \"SecuritySignalEvent\" WHERE \"ruleKey\" = 'platform_admin.config_change.v1') AS security_signal_count
;"

echo "--- Patient smsOptOut/smsOptOutAt digest (before) ---"
sudo -u postgres psql -d "$DB_NAME" -t -A -c "
SELECT md5(string_agg(id || ':' || \"smsOptOut\" || ':' || COALESCE(\"smsOptOutAt\"::text, 'null'), ',' ORDER BY id))
FROM \"Patient\";"
```

Record every printed value. These are the "before" values Section A.5 compares against. This is the same 10-value invariant set (`setting_row_count`, `setting_value`, `audit_total`, `audit_for_this_setting`, `correction_total`, `sms_optout_true`, `sms_optout_false`, `sms_optout_at_set`, digest, `security_signal_count`) already established in [KVKK-HIGH-008-F1_PRODUCTION_SAFE_BEHAVIORAL_VERIFICATION.md](KVKK-HIGH-008-F1_PRODUCTION_SAFE_BEHAVIORAL_VERIFICATION.md) §3 — table/column names confirmed against `server/prisma/schema.prisma` (`PlatformSetting`, `PlatformAdminAuditEvent.resourceKey`, `PatientLegacyConsentCorrection`, `Patient.smsOptOut`/`smsOptOutAt`, `SecuritySignalEvent.ruleKey`) and the `ruleKey` value confirmed against `server/src/tests/platformAdmin.test.ts:665,690`, so this package's before/after values are directly comparable to that prior evidence row-for-row.

### A.2 Authenticated login (user-supplied credentials only)

Confirmed against the current source (`server/src/routes/platformAdmin.ts` `POST /auth/login`, `server/src/utils/sessionCookies.ts`, `server/src/middleware/csrf.ts`): the login endpoint takes JSON body fields `email`, `password`, and an optional `totpCode` — the server only requires `totpCode` if MFA is enabled for that specific admin account (`admin.totpEnabledAt`), so the field must be **omitted entirely**, not sent empty, when this account has no MFA. A successful login returns `HTTP 200` with JSON body `{"csrfToken": "...", "admin": {"id","name","email","createdAt"}}` and sets two cookies: `hcrm_platform_session` (httpOnly session token) and `platform_csrf_token` (non-httpOnly, readable double-submit token — the same value as the `csrfToken` in the body). Authentication is cookie-based; the deprecated bearer-token fallback is not used here. The CSRF header required on the PATCH in A.4 is `X-CSRF-Token`, checked only for unsafe methods and only when the request authenticated via cookie (`csrfProtection()` in `csrf.ts`) — the `GET` in A.3 needs no CSRF header.

```bash
set +x   # confirm command tracing is off before any secret is read
COOKIE_JAR=$(mktemp)

read -r -p "Platform admin email: " PLATFORM_ADMIN_EMAIL
read -r -s -p "Platform admin password (not echoed, not stored in shell history): " PLATFORM_ADMIN_PASSWORD
echo
read -r -p "TOTP code (leave BLANK if MFA is not enabled for this account): " PLATFORM_ADMIN_TOTP_CODE

# Built via node/stdin rather than shell string interpolation, so a quote or
# backslash in the password can never break out of the JSON literal, and the
# totpCode key is omitted entirely (not sent empty) when left blank.
LOGIN_PAYLOAD=$(PLATFORM_ADMIN_EMAIL="$PLATFORM_ADMIN_EMAIL" \
  PLATFORM_ADMIN_PASSWORD="$PLATFORM_ADMIN_PASSWORD" \
  PLATFORM_ADMIN_TOTP_CODE="$PLATFORM_ADMIN_TOTP_CODE" \
  node -e "
    const body = { email: process.env.PLATFORM_ADMIN_EMAIL, password: process.env.PLATFORM_ADMIN_PASSWORD };
    const totp = process.env.PLATFORM_ADMIN_TOTP_CODE;
    if (totp) body.totpCode = totp;
    process.stdout.write(JSON.stringify(body));
  ")

LOGIN_RESPONSE=$(printf '%s' "$LOGIN_PAYLOAD" | curl -s -c "$COOKIE_JAR" -w '\n%{http_code}' \
  -X POST https://api.noramedi.com/api/platform/auth/login \
  -H 'Content-Type: application/json' \
  --data-binary @-)

LOGIN_STATUS=$(echo "$LOGIN_RESPONSE" | tail -1)
LOGIN_BODY=$(echo "$LOGIN_RESPONSE" | sed '$d')

# Unset every secret-bearing variable immediately, regardless of outcome:
unset PLATFORM_ADMIN_PASSWORD PLATFORM_ADMIN_TOTP_CODE LOGIN_PAYLOAD

echo "login status: $LOGIN_STATUS"

if [ "$LOGIN_STATUS" != "200" ]; then
  echo "Login did not return 200 (got $LOGIN_STATUS)."
  echo "This is itself valid, reportable evidence — report only the status code,"
  echo "never the response body verbatim (it may echo back input)."
  echo "Per this package's stop condition:"
  echo "  - Do NOT attempt another login with a different, guessed, or fabricated credential."
  echo "  - Skip Sections A.3-A.4 (the authenticated tests) entirely."
  echo "  - Continue directly to Section A.5 onward (safe closing checks) — those still"
  echo "    run, still produce valid evidence, and are not conditioned on login success."
  CSRF_TOKEN=""
else
  CSRF_TOKEN=$(printf '%s' "$LOGIN_BODY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).csrfToken))")
  echo "session established (csrfToken captured, not printed)"
fi

unset LOGIN_BODY LOGIN_RESPONSE
```

If the login attempt fails, Sections A.3–A.4 (the authenticated tests) are skipped — not attempted, exactly as in the prior pass, and this is a valid, reportable outcome, not a workaround to bypass. Do **not** loop back and try A.2 again with a different credential. Sections A.5–A.8 (invariant re-check, log filtering, health/PM2 check, cleanup) are **not** conditioned on login success and still run either way — see each section below, which is now guarded by `LOGIN_STATUS` so it self-skips the authenticated-only steps rather than requiring the user to stop the whole package.

### A.3 Test C1 — Authenticated read-only policy `GET` (retry)

Self-guarded on `LOGIN_STATUS`; only issues the request if A.2 returned `200`.

```bash
if [ "$LOGIN_STATUS" = "200" ]; then
  curl -s -b "$COOKIE_JAR" -w '\nstatus: %{http_code}\n' \
    https://api.noramedi.com/api/platform/privacy/legacy-consent-correction/policy
else
  echo "Skipped — no authenticated session (LOGIN_STATUS=$LOGIN_STATUS). Proceeding to A.4/A.5."
fi
```

Expected: `HTTP 200`, body `{"runtimeEnabled": false}`. This is a pure read (`platformAdmin.ts:1084-1087` — `res.json({ runtimeEnabled })`, no write path, no CSRF header required for a `GET`). Any other status or body is worth recording verbatim (with the response body redacted of nothing but secrets, since this endpoint returns no PII).

### A.4 Test C3 — Authenticated invalid-payload `PATCH` (retry, must be rejected)

Self-guarded on `LOGIN_STATUS`; only issues the request if A.2 returned `200`. **The body below is deliberately not a boolean** — this must return `400` before the transaction that would write `PlatformSetting`/`PlatformAdminAuditEvent` ever opens (`platformAdmin.ts:1092-1096` rejects any non-boolean `runtimeEnabled` before the `prisma.$transaction` call at line 1115).

```bash
if [ "$LOGIN_STATUS" = "200" ]; then
  curl -s -b "$COOKIE_JAR" -w '\nstatus: %{http_code}\n' \
    -X PATCH https://api.noramedi.com/api/platform/privacy/legacy-consent-correction/settings \
    -H 'Content-Type: application/json' \
    -H "X-CSRF-Token: $CSRF_TOKEN" \
    -d '{"runtimeEnabled": "not-a-boolean"}'
else
  echo "Skipped — no authenticated session (LOGIN_STATUS=$LOGIN_STATUS). Proceeding to A.5."
fi
```

Expected (when run): `HTTP 400`, body `{"error": "runtimeEnabled must be a boolean"}`.

**STOP CONDITION (applies only when this request was actually sent, i.e. `LOGIN_STATUS` was `200`):** if it returns anything other than `400` — in particular if it returns `200`, or any status suggesting the setting or audit table was touched — stop immediately, do not run any further authenticated command, do not attempt a corrective PATCH, a rollback, or a second login attempt, and do not guess at a fix. Sections A.5–A.8 (safe invariant/log/health capture and secret cleanup) should still be performed where possible — they are read-only/cleanup and are themselves part of documenting what happened — then report the exact status code and response body back for review before any further action. A `200` here would indicate a code-level input-validation regression, not something this package is designed to remediate.

### A.5 Aggregate audit/invariant re-check (after)

Run the identical query from A.1 again:

```bash
echo "--- DB invariants (after) ---"
sudo -u postgres psql -d "$DB_NAME" -t -A -c "
SELECT
  (SELECT count(*) FROM \"PlatformSetting\" WHERE key = 'privacy.legacyConsentCorrection.runtimeEnabled') AS setting_row_count,
  (SELECT value FROM \"PlatformSetting\" WHERE key = 'privacy.legacyConsentCorrection.runtimeEnabled') AS setting_value,
  (SELECT count(*) FROM \"PlatformAdminAuditEvent\") AS audit_total,
  (SELECT count(*) FROM \"PlatformAdminAuditEvent\" WHERE \"resourceKey\" = 'privacy.legacyConsentCorrection.runtimeEnabled') AS audit_for_this_setting,
  (SELECT count(*) FROM \"PatientLegacyConsentCorrection\") AS correction_total,
  (SELECT count(*) FROM \"Patient\" WHERE \"smsOptOut\" = true) AS sms_optout_true,
  (SELECT count(*) FROM \"Patient\" WHERE \"smsOptOut\" = false) AS sms_optout_false,
  (SELECT count(*) FROM \"Patient\" WHERE \"smsOptOutAt\" IS NOT NULL) AS sms_optout_at_set,
  (SELECT count(*) FROM \"SecuritySignalEvent\" WHERE \"ruleKey\" = 'platform_admin.config_change.v1') AS security_signal_count
;"

echo "--- Patient smsOptOut/smsOptOutAt digest (after) ---"
sudo -u postgres psql -d "$DB_NAME" -t -A -c "
SELECT md5(string_agg(id || ':' || \"smsOptOut\" || ':' || COALESCE(\"smsOptOutAt\"::text, 'null'), ',' ORDER BY id))
FROM \"Patient\";"
```

**Confirmation criterion:** every value in A.5 must equal the corresponding value from A.1 — `setting_row_count = 0`, `setting_value` is empty/NULL, `audit_total` and `audit_for_this_setting` unchanged, `correction_total` unchanged, `sms_optout_true`/`sms_optout_false`/`sms_optout_at_set` all unchanged, `security_signal_count` unchanged, and the `Patient` digest string identical. If any value differs, **stop, do not run any further step, and report the exact before/after diff** — this package is not designed to have caused a change, and a change would need investigation before this document could be considered complete. This section runs regardless of whether A.2's login succeeded — it is not gated on `LOGIN_STATUS`.

### A.6 API log filtering

```bash
# Adjust the log path/command to whatever this host actually uses
# (journalctl, pm2 logs, or a file under /var/log) — confirm the real
# mechanism first rather than assuming one.
pm2 logs noramedi-api --lines 200 --nostream | grep -E \
  "legacy-consent-correction|platform_setting|PlatformAdminAuditEvent|/api/platform/auth/login|/api/platform/privacy/legacy-consent-correction" \
  | sed -E 's/("email":")[^"]*(")/\1[REDACTED]\2/g'
```

Confirm: the login attempt appears with its actual status code (from A.2), and — only if `LOGIN_STATUS` was `200` — the policy `GET` and invalid-payload `PATCH` also appear with their expected status codes (from A.3–A.4), with no unexpected `5xx` anywhere. This section runs regardless of `LOGIN_STATUS`; if login failed, the log line of interest is simply the login attempt itself. Redact any field that could contain an email, name, phone number, or token before recording or sharing the output — the `sed` above is a starting point, not a guarantee; review the raw match lines yourself before pasting them anywhere.

### A.7 Health and PM2 restart-count re-check

```bash
echo "--- Health (after) ---"
curl -s -o /dev/null -w 'health status: %{http_code}\n' https://api.noramedi.com/api/health

echo "--- PM2 state (after) ---"
pm2 jlist | node -e "
const procs = JSON.parse(require('fs').readFileSync(0, 'utf8'));
for (const p of procs) {
  if (p.name === 'noramedi-api' || p.name === 'noramedi-worker') {
    console.log(p.name, p.pm2_env.status, 'restarts=' + p.pm2_env.restart_time);
  }
}
"
```

**Confirmation criterion:** both processes remain `online`; `restart_time` for each is identical to A.1 (no unexpected restart occurred during this package's execution). This section also runs regardless of `LOGIN_STATUS`.

### A.8 Cleanup

Runs regardless of `LOGIN_STATUS` — always removes the cookie jar and clears every variable this package set, whether or not an authenticated session was ever established.

```bash
rm -f "$COOKIE_JAR"
unset COOKIE_JAR CSRF_TOKEN LOGIN_STATUS PLATFORM_ADMIN_EMAIL
```

### A.9 What Package A does, and cannot, prove

If A.2 succeeds and A.3/A.4 return their expected results, this package closes: Test C1 (authenticated policy read, live), Test C3 (authenticated invalid-payload rejection, live), and reconfirms — a second time, now with an authenticated session in play rather than only an unauthenticated one — that no `PlatformSetting`/`PlatformAdminAuditEvent`/patient-data change occurred. It does **not**, and cannot, close: gaps 1–3 (real-patient mutation-route behavior), or gaps 4–8 (successful `PlatformSetting` write, successful `PlatformAdminAuditEvent` creation, actor/previous/new-value attribution) — those require either a real in-scope patient or a valid-boolean `PATCH`, neither of which appears anywhere in this package. See Package B for why those remain separately gated.

If A.2's login instead fails again (any non-200), Package A still closes one thing: it reconfirms, with a second independent attempt, that the blocker is credential-related rather than a fluke of the first attempt — and every invariant/health/log check in A.1, A.5, A.6, A.7 still runs and still produces valid evidence about production stability during the attempt.

---

## Package B — Separate Decision Memo (Not Authorized for Execution)

**This section is not an executable recommendation.** It documents four remaining verification items that Package A cannot close, and for each: the exact evidence it would close, why it is not currently authorized, its reversibility, its data-mutation implications, the minimum approval this program would require before attempting it, safer alternatives, and a recommendation. No command in this section is to be run against production by anyone acting on this document alone.

### B.1 Real in-scope patient route behavioral verification

- **What it is:** invoking `POST /api/patients/:patientId/communication-preferences/legacy-corrections/sms-opt-out` (and the two read routes) against a real, existing, in-scope `Patient` row while the runtime gate is disabled, to observe the literal `403 { errorCode: 'runtime_disabled', ... }` response live rather than only from source (`communicationPreferences.ts:586-589`).
- **Evidence it would close:** gaps 1–3 — live-observed disabled-mutation fail-closed behavior, the exact response status/body as actually returned by the running process, and live-observed read/history behavior while disabled.
- **Why not currently authorized:** `loadScopedPatient()` resolves a real patient row **before** the gate check (`communicationPreferences.ts:563,574` — confirmed in [KVKK-HIGH-008-F1-PBV-S1](KVKK-HIGH-008-F1-PBV-S1_SAFE_BEHAVIORAL_PRODUCTION_VERIFICATION_FEASIBILITY.md) §13-§15). There is no synthetic-patient path. This means the *test's own precondition* is real patient data — a category this task's operating rules place out of scope without separate, explicit authorization naming a specific patient or a deliberately created test patient in a non-production-equivalent tenant.
- **Reversible:** Yes for the HTTP call itself (a `GET`/rejected `POST` leaves no persisted row when the gate is disabled — confirmed by the "no side effects when disabled" test already covered in `legacyConsentCorrection.test.ts`, per [KVKK_HIGH008_FREEZE_BOUNDARY.md](../KVKK_HIGH008_FREEZE_BOUNDARY.md) §7). **No** for the act of selecting and touching a real patient record with a production request outside of clinical workflow — that action itself is not something an "undo" erases from an access/audit-log perspective.
- **Data mutation implications:** none expected on a successful (disabled) test — the mutation route returns 403 before any write. But the test necessarily executes a real, unrelated-to-care API call against a real patient's record, which is the sensitive part, not the mutation risk.
- **Minimum approval required:** an explicit, named decision identifying either (a) a specific real patient and the accountable approver's justification for using that patient's record for a non-clinical verification call, or (b) authorization to create a clearly-labeled synthetic test patient in a tenant the program has separately confirmed is not live/production clinical data — plus confirmation of the exact single request(s) to be sent and the evidence to be captured.
- **Safer alternative:** rely on the existing disposable-Postgres test suite (`legacyConsentCorrection.test.ts`, already covering missing/false/true states and no-side-effects-when-disabled per [KVKK_HIGH008_FREEZE_BOUNDARY.md](../KVKK_HIGH008_FREEZE_BOUNDARY.md) §7) as the verification method for this behavior, and treat production confirmation as permanently out of scope for a non-activating verification task.
- **Recommendation:** do not authorize against a real existing patient. If closing this gap is a priority, authorize option (b) — a deliberately created, clearly labeled synthetic patient in a tenant confirmed non-clinical — as its own, separately scoped task with its own approval, not folded into this package.

### B.2 Explicit-`false` `PATCH` that would create a persistent setting row

- **What it is:** `PATCH /api/platform/privacy/legacy-consent-correction/settings` with body `{"runtimeEnabled": false}`, authenticated.
- **Evidence it would close:** gaps 4–8 — a successful `setPlatformSetting()` write, a successful `PlatformAdminAuditEvent` insert, real `actorPlatformAdminId` attribution, the real previous/new value chain (`ABSENT`/`null` → `'false'`), confirmation of zero `SecuritySignalEvent` rows from the action, and confirmation of no PII/PHI in the created audit row.
- **Why not currently authorized:** `setPlatformSetting()` (`platformSettings.ts:24-34`) always `upsert`s — a `false`-valued PATCH is not a no-op; it moves production from "row absent" (structural fail-closed default) to "row present with value `'false'`" (a persisted state), and inserts exactly one `PlatformAdminAuditEvent` row. This is a real production state change, not a pure read, and this task's scope is limited to non-activating, non-mutating verification.
- **Reversible:** **No**, by this program's own reversibility standard (already established in [KVKK-HIGH-008-F1-PBV-S1](KVKK-HIGH-008-F1-PBV-S1_SAFE_BEHAVIORAL_PRODUCTION_VERIFICATION_FEASIBILITY.md) §35-§36): `platformSettings.ts` has no `deletePlatformSetting()`/unset function, and no route calls one. Returning to "no row" would require an out-of-band direct database `DELETE`, outside this program's normal, audited tooling and outside any task's authorization to date.
- **Data mutation implications:** one new `PlatformSetting` row (key `privacy.legacyConsentCorrection.runtimeEnabled`, value `'false'`); one new `PlatformAdminAuditEvent` row (action `platform_setting.updated`, previousValue reflecting the fail-closed default, newValue `'false'`). No patient, consent, or clinic data is touched — the effective runtime behavior does not change (stays disabled).
- **Minimum approval required:** an explicit, named human decision accepting the permanent, non-reversible-via-API persistence-state change described above as a deliberate, low-risk trade-off — i.e., accepting that "absent row" becomes "row present, value false" forever (short of an unsupported manual DB `DELETE`), in exchange for closing gaps 4–8.
- **Safer alternative:** none exists that closes these exact gaps without writing the row — that is what makes this a genuine decision rather than a technical gap. A partial safer alternative is to accept `platformAdmin.test.ts`'s existing disposable-Postgres coverage (GET/PATCH round-trip, admin-attributed logging, FK-violation atomic rollback, concurrency — [KVKK_HIGH008_FREEZE_BOUNDARY.md](../KVKK_HIGH008_FREEZE_BOUNDARY.md) §7) as sufficient proof of the mechanism, and treat live production confirmation of gaps 4–8 as permanently deferred rather than pursued.
- **Recommendation:** do not execute this PATCH as part of routine or automatic verification. If the program decides closing gaps 4–8 is worth a permanent persisted-row state change, that decision should be made explicitly and separately (naming the approver and accepting §35's non-reversibility in writing), not bundled with any other verification activity. Absent that explicit decision, continue carrying gaps 4–8 as open, exactly as [KVKK-HIGH-008-F1-PBV-S1](KVKK-HIGH-008-F1-PBV-S1_SAFE_BEHAVIORAL_PRODUCTION_VERIFICATION_FEASIBILITY.md) §39 already recommends.

### B.3 Successful `PlatformAdminAuditEvent` creation (as its own item)

- **What it is:** the specific sub-outcome of B.2 — a `PlatformAdminAuditEvent` row actually appearing in production with correct actor/action/resourceKey/previousValue/newValue/outcome fields, inspectable to confirm no PII/PHI/secret leaked into it.
- **Evidence it would close:** gaps 5, 6, 7, 8 specifically (attribution, value chain, `SecuritySignalEvent` absence, content safety) — listed separately from B.2 because a future decision could in principle authorize *only* observing an audit row from some other legitimate admin action (e.g., a genuinely-needed data-retention toggle elsewhere in `platformAdmin.ts` that already exists for other reasons) rather than manufacturing one via this specific setting.
- **Why not currently authorized:** the only route that writes to this table for this `resourceKey` is the same PATCH analyzed in B.2; there is no separate, lower-cost path to create a `PlatformAdminAuditEvent` row scoped to `privacy.legacyConsentCorrection.runtimeEnabled` without performing that same PATCH.
- **Reversible:** No — once written, a `PlatformAdminAuditEvent` row is, by design, a durable audit record; it must not be deleted even if the triggering setting change is later reconsidered (consistent with the retain-during-cutback rule already recorded in [KVKK_HIGH008_FREEZE_BOUNDARY.md](../KVKK_HIGH008_FREEZE_BOUNDARY.md) §7.1 / R-070).
- **Data mutation implications:** identical to B.2 — this is not a separate mutation, it is the same one, viewed from the audit-content angle.
- **Minimum approval required:** the same approval as B.2, since there is no independent path to this evidence — this item does not lower the bar B.2 already sets.
- **Safer alternative:** rely on the disposable-Postgres, FK-violation, and concurrency tests already covering `writePlatformAdminAuditEventInTx` (`platformAdmin.test.ts`, per [KVKK_HIGH008_FREEZE_BOUNDARY.md](../KVKK_HIGH008_FREEZE_BOUNDARY.md) §7.2-§7.3) as the accepted proof of correctness, and treat a live production row as optional confirmation rather than a required gate.
- **Recommendation:** do not pursue independently of B.2. If B.2 is ever explicitly authorized, this item closes as a byproduct; if B.2 is declined, this item should be declined for the same reason, not attempted through some other route.

### B.4 Controlled activation (`runtimeEnabled: true`, and any `false → true → false` cycle)

- **What it is:** setting `privacy.legacyConsentCorrection.runtimeEnabled` to `true` in production, for any duration, including as part of a full activation/deactivation cycle.
- **Evidence it would close:** none of the gaps in this document — this is not a verification action, it is a feature-activation action. It would additionally close (separately, if desired) live-observed behavior of the actual enabled-state mutation route against a real patient, but doing so would require B.1's real-patient authorization as well.
- **Why not currently authorized:** this is a live-production feature-flag flip for a workflow that performs real, tenant-scoped, create-only mutations against real patient consent data once enabled ([F0-011-P1](F0-011-P1_KVKK_HIGH008_ACTIVE_WORK_BASELINE.md) §8). Controlled activation is, by existing program decision (R-061, [KVKK_HIGH008_FREEZE_BOUNDARY.md](../KVKK_HIGH008_FREEZE_BOUNDARY.md) §8), its own separate, later, explicitly-authorized action — not a verification step, and not something this or any prior non-activating task has treated as in scope.
- **Reversible:** **No**, not as a clean no-op. Setting it back to `false` afterward does not undo: (a) any correction row written by real usage during the `true` window, (b) the `PlatformAdminAuditEvent` rows for both the enable and disable actions, or (c) any downstream effect (e.g., an SMS opt-out correction actually applied to a real patient) that occurred while enabled. A `false → true → false` cycle is not a reversible test by this program's standard — it is a real, consequential activation window with an aftermath.
- **Data mutation implications:** potentially significant and patient-facing — every request the enabled mutation route receives while `true` performs a real, tenant-scoped, audited but persistent correction to a patient's recorded consent/opt-out field. This is categorically different from B.1–B.3's platform-configuration-only mutations.
- **Minimum approval required:** a named approver with product/compliance authority (not a documentation task), a defined maintenance window, an explicit rollback/monitoring plan, a pre-agreed evidence-capture scope, and — per the freeze boundary — satisfaction of the independent rollback/tenant-impact verification and independent test-execution conditions that remain separately open in [KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](../KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md) §5 and [KVKK_HIGH008_FREEZE_BOUNDARY.md](../KVKK_HIGH008_FREEZE_BOUNDARY.md) §3.
- **Safer alternative:** continue relying on the disposable-Postgres pre-merge test suite for enabled-state behavior (already covering the true/enabled path per [KVKK_HIGH008_FREEZE_BOUNDARY.md](../KVKK_HIGH008_FREEZE_BOUNDARY.md) §7), and defer production activation until it is a genuine, business-driven rollout decision rather than a verification exercise.
- **Recommendation:** **do not authorize.** This document does not propose a `false → true → false` cycle as an executable recommendation, now or as a fallback if B.1–B.3 are declined. Controlled activation should be revisited only as its own, separately-scoped decision when the program is actually ready to roll out the workflow — not to close a verification gap.

### B.5 Summary table

| Item | Closes | Authorized here? | Reversible? | Mutates data? | Approval needed |
|---|---|---|---|---|---|
| B.1 Real-patient route behavior | Gaps 1–3 | No | Partial (HTTP call yes; real-patient touch no) | No (on expected 403) | Named patient/tenant decision |
| B.2 Explicit-`false` PATCH | Gaps 4–8 | No | No (no unset API exists) | Yes — 1 `PlatformSetting` row, 1 audit row | Explicit accept of permanent state change |
| B.3 Audit-event creation | Gaps 5–8 | No (same action as B.2) | No | Same as B.2 | Same as B.2 |
| B.4 Controlled activation | Not a verification gap | **No — never** | No | Yes — potentially patient-facing | Full program/product/compliance authorization, separate from verification |

---

## 2. What this task did and did not do

- Did not access production, request or receive any credential/token/session/cookie/MFA code/patient ID.
- Did not execute any command in Package A or Package B.
- Did not modify any application code, test, migration, or configuration file.
- Did not modify [`NORAMEDI_MASTER_TRACKER.md`](../NORAMEDI_MASTER_TRACKER.md), [`RISK_REGISTER.md`](../RISK_REGISTER.md), [`KVKK_HIGH008_FREEZE_BOUNDARY.md`](../KVKK_HIGH008_FREEZE_BOUNDARY.md), or any other shared tracker file.
- Created exactly one new file: this document.
- Did not commit or push anything — this file exists only in the isolated worktree named at the top of this document, awaiting the user's own review before any commit/PR decision.
- Did not run CodeGraph (not required for this documentation/command-preparation task; source line citations above were confirmed by direct file reads of the same lines already cited in the prior evidence files this document builds on).
- R-061 status is unchanged by this document: **`OPEN`**.
