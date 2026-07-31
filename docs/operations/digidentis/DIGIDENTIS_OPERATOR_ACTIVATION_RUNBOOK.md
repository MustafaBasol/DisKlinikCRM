# DIGIDENTIS_OPERATOR_ACTIVATION_RUNBOOK — NoraMedi ↔ DigiDentiS External Calendar Integration

**Baseline:** `origin/main` @ PR #271 merge commit `bc2762742a5b8bc31cf78bb2f2c4a155e032bba7` (merged 2026-07-31). Vendor source: [`docs/vendor/digidentis/DigiDentiS_Takvim_API_Documentation_v3.2.html`](../../vendor/digidentis/DigiDentiS_Takvim_API_Documentation_v3.2.html) (v3.2.0, "Enterprise docs · Partner Confidential"). Companion architecture doc: [`docs/architecture/external-calendar-integration.md`](../../architecture/external-calendar-integration.md) — that document is the authoritative source for internal module names and code-level detail; this runbook does not restate it, it operationalizes it.

**Companion documents (production topology this runbook assumes):** [`docs/program/PRODUCTION_TOPOLOGY.md`](../../program/PRODUCTION_TOPOLOGY.md), [`scripts/noramedi-deploy.sh`](../../../scripts/noramedi-deploy.sh), [`scripts/noramedi-healthcheck.sh`](../../../scripts/noramedi-healthcheck.sh).

## 0. Non-authorization statement

**This document does not activate anything.** PR #271 is merged into `main` — that is a repository fact, distinct from "deployed to production," which is distinct from "migration applied," which is distinct from "feature enabled for a clinic." As of this baseline: **the integration is merged, disabled by default, and not wired into the live appointment-approval flow.** No clinic has been configured. No real DigiDentiS clinic activation has occurred. Every action step below that touches production, sends vendor email, or enables a clinic requires a human operator/decision owner to actually execute it — nothing here runs itself.

**Phase 2 status:** Phase 2 (connecting DigiDentiS events to `AppointmentRequest` conversion, delaying patient confirmation until external sync succeeds, and outbound retry orchestration — see §7) **has not been merged into `main` and has not been deployed anywhere.** It does not exist in this codebase as of this baseline. No step in this runbook depends on Phase 2 existing, and nothing here should be read as implying it does.

**Activation gate:** no clinic — including the single test clinic in §5 — should be switched to `enabled: true` until all four of the following are confirmed:
1. Webhook topology is confirmed with DigiDentiS — per-integrator vs. per-clinic (§1.1).
2. The production outbound IP is registered/whitelisted with DigiDentiS (§1, §3.5).
3. Credentials (Client ID/Secret, `externalCompanyId`, `externalClinicId`) are configured for that clinic (§2).
4. Practitioner and treatment-type mappings are entered and validated for that clinic (§2, §5 step 4).

---

## 1. DigiDentiS vendor information request

Copy-ready email: [`DIGIDENTIS_VENDOR_INFORMATION_REQUEST_EMAIL.md`](DIGIDENTIS_VENDOR_INFORMATION_REQUEST_EMAIL.md). Summary of what's being asked and what the vendor doc already tells us:

| Item | What the vendor doc (v3.2.0) already says | What still requires the vendor's direct answer |
|---|---|---|
| Outbound production IP whitelist | §2: "All requests must originate from pre-approved IP addresses. Contact DigiDentiS support to register your server IPs before integration." | The actual registration process/turnaround, and whether IPs can be updated later without full re-onboarding. **Cannot be verified from documentation alone.** |
| Webhook URL registration | §11: webhooks are "opt-in and configured per integrator by the DigiDentiS team" — you provide a public HTTPS URL, a webhook secret, and the event list. | The actual registration workflow (portal vs. email vs. account manager). |
| Webhook topology: per clinic or per integrator | §11 says "per integrator," **not** "per clinic." | **This is the single most important open question** — see §1.1 below. NoraMedi's own architecture (webhookReceiverKey) generates a distinct URL per clinic; whether DigiDentiS's "per integrator" model can register more than one URL under one account, or requires one integrator account per clinic, is not stated anywhere in v3.2.0 and must be confirmed before a second clinic is onboarded. |
| Sandbox availability | §1 lists exactly one base URL, labeled "Production." No sandbox/staging host is documented anywhere in v3.2.0. | Whether a non-production environment exists at all. Until confirmed, **treat every API call, including the §5 test-clinic rollout, as hitting the real production DigiDentiS system.** |
| Current support contact | Two different addresses appear in the same document: `destek@digidentis.com` (§7.10) and `digidentis@gmail.com` (final Support section). | Which is authoritative today — ask this explicitly, first, in the outbound email. |
| Reserved webhook event activation | §11.1: `appointment.confirmed`/`.completed`/`.no_show` are "Reserved" — "part of the webhook contract and may be enabled progressively. Subscribe to them now so your endpoint receives them automatically once activated." | Confirmation that subscribing to reserved events now is accepted at initial registration (the doc implies yes, but doesn't guarantee it for every integrator). |
| Vendor-side clinic/account activation steps | §7.4 documents a per-company quota endpoint, implying company-level plan/quota assignment exists. | Whether any clinic-level enablement step is needed on DigiDentiS's side beyond issuing a Client ID/Secret, and whether the "API Visible" treatment-type flag (§7.10) is self-service or requires vendor action. |

### 1.1 Why the webhook topology question matters operationally

NoraMedi's `ExternalCalendarIntegration.webhookReceiverKey` is generated **per clinic** (one opaque, rotatable token per clinic row), producing a distinct webhook URL per clinic:
`/api/public/external-calendar/digidentis/:webhookReceiverKey/webhook`. If DigiDentiS's "per integrator" model means literally one webhook URL for the entire NoraMedi account, then either:
- DigiDentiS must be asked whether multiple webhook URLs can be registered under one integrator account (one per clinic) — the current code's design assumes this is possible — **or**
- NoraMedi's first production webhook URL is effectively the only one that will ever receive deliveries, and a second clinic would need its own DigiDentiS integrator account, not just its own row in this table.

**Do not enable any clinic — including the single test clinic in §5 — until this is resolved with the vendor.** Onboarding a *second* clinic has the additional, distinct requirement that the multi-URL question above is answered; see the activation gate in §0.

---

## 2. NoraMedi pre-deployment checklist

| Item | Status | Detail |
|---|---|---|
| `ENCRYPTION_KEY` | **Already implemented / already required.** No new key needed. | Reused from the existing WhatsApp/Instagram credential encryption (AES-256-GCM, `utils/encryption.ts`). If it's already set in `/var/www/noramedi/server/.env`, nothing to do here. If somehow unset, nothing in the app works today, not just this integration — check this first, it is a pre-existing requirement, not new. |
| `PUBLIC_API_BASE_URL` | **Requires production operator action.** Optional in code, but functionally required for this integration. | Not present in `server/.env.example` — must be added manually to the production `.env`. If unset, the Platform Admin UI shows the webhook URL as a relative path, which DigiDentiS cannot call. Set it to `https://api.noramedi.com` (confirmed production hostname per `PRODUCTION_TOPOLOGY.md`). |
| `DIGIDENTIS_DEFAULT_API_BASE_URL` | **Not required for now.** | Optional override; defaults to the verified production base URL (`https://www.ddslogin.com/Api/v1/external_booking`). Only set this if/when DigiDentiS confirms a sandbox host exists and you want to point a specific clinic at it via the per-clinic `apiBaseUrl` override field instead (see below) — prefer the per-clinic override over the global env var so production clinics are unaffected. |
| Public API base URL reachability | **Cannot yet be verified** — depends on current DNS/TLS state at activation time. | Verify with §3 commands before relying on it. |
| Credential generation and storage | **Already implemented.** | Client ID/Secret and Webhook Secret are entered once via Platform Admin (`PUT /api/platform/clinics/:clinicId/external-calendar`) and stored AES-256-GCM-encrypted (`clientSecretEncrypted`/webhook secret column) — never logged, never returned decrypted by any route. The actual Client ID/Secret values come from DigiDentiS after their onboarding process (requires vendor action, see §1). |
| Clinic selection in Platform Admin | **Already implemented.** | `/platform/external-calendar` (Platform Admin UI, `src/pages/platform/PlatformExternalCalendar.tsx`) — select-then-configure pattern, same as the existing SMS add-on flow. |
| Company/clinic identifiers | **Requires production operator action**, values come from DigiDentiS. | `externalCompanyId` (`cmp_...`) and `externalClinicId` (`cln_...`) fields on the integration row — obtained from DigiDentiS after account setup, entered via the same `PUT` above. |
| Practitioner mappings | **Already implemented** (UI + API), **data entry is an operator action.** | `PUT /api/platform/clinics/:clinicId/external-calendar/mappings` (`mappingType: "practitioner"`) maps a local NoraMedi dentist (`User.id`) to a DigiDentiS `doc_...` id. Local options come from `GET .../local-options`; remote options come from `GET .../remote-options` (calls DigiDentiS live). |
| Treatment-type mappings | **Already implemented** (UI + API), **data entry is an operator action.** | Same mapping endpoints, `mappingType: "service"`, mapping a local `AppointmentType.id` to a DigiDentiS `att_...` id. |
| DigiDentiS "API Visible" prerequisite | **Requires DigiDentiS-side action per clinic/company**, not a NoraMedi bug. | If `GET .../remote-options` returns an empty treatment-type list, the cause is almost always that no treatment type has "API Visible" enabled in DigiDentiS's own dashboard (Settings → System → Customization). Confirm with the vendor per §1 whether this is self-service or needs their intervention for a new account. |
| Disabled-by-default verification | **Already implemented and enforced server-side**, verify anyway before go-live. | `enabled` defaults to `false` on the Prisma model; `PATCH .../enabled {enabled:true}` is **rejected** unless `clientId`, `clientSecretEncrypted`, and `externalClinicId` are all already set (`externalCalendarConnectionService.ts`). Confirm with §3.10's query that no clinic shows `enabled = true` before this program's own test-clinic step. |

---

## 3. Exact read-only commands

All commands below are **read-only** — none modify code, data, or configuration. Run on the production host unless noted. `$APP_DIR` = `/var/www/noramedi`.

### 3.1 Current `origin/main` SHA (local checkout vs. remote)

```bash
cd /var/www/noramedi
git fetch origin --quiet
git rev-parse HEAD
git rev-parse origin/main
git log -1 --format='%H %ci %s' origin/main
```

### 3.2 Current PM2 process names and status

```bash
pm2 list
pm2 describe noramedi-api
```

Per confirmed production topology, expect `noramedi-api` (HTTP, PM2-managed by the deploy script) and `noramedi-worker` (no HTTP surface, background jobs — its own restart mechanism is **not** defined in this repository, so do not assume `pm2 reload` covers it).

### 3.3 NoraMedi API listening port

```bash
pm2 env noramedi-api | grep -E '^(PORT|LISTEN_HOST)='
ss -ltnp 2>/dev/null | grep -E ':5000\b' || netstat -ltnp 2>/dev/null | grep -E ':5000\b'
```

Default is `PORT=5000`, `LISTEN_HOST=0.0.0.0` unless overridden in production's `.env` (recommendation elsewhere in this repo is `127.0.0.1` in production, behind Nginx).

### 3.4 Public health status

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.noramedi.com/api/health
curl -s https://api.noramedi.com/api/health
/usr/local/sbin/noramedi-healthcheck.sh --max-attempts 3 --interval 5
```

`{"status":"ok"}` (200) = DB reachable within 3s. `{"status":"degraded"}` (503) = DB probe failed/timed out. This endpoint is intentionally unauthenticated and detail-free.

### 3.5 Server outbound IP (needed for the DigiDentiS whitelist request in §1)

```bash
curl -s https://api.ipify.org
curl -s https://ifconfig.me
```

Run both and confirm they agree before sending the IP to DigiDentiS — a host behind a NAT/proxy layer you don't control could otherwise report the wrong address.

### 3.6 DNS resolution (confirm `api.noramedi.com` resolves to this host before relying on the public webhook URL)

```bash
dig +short api.noramedi.com
getent hosts api.noramedi.com
```

### 3.7 Webhook public reachability (from *outside* the host — run from your own machine or a third-party tool, not from the server itself, since loopback reachability proves nothing about public reachability)

```bash
# Replace :webhookReceiverKey with the real value from the Platform Admin
# summary DTO for the clinic under test — never with a guessed/enumerated value.
curl -i -X POST https://api.noramedi.com/api/public/external-calendar/digidentis/<webhookReceiverKey>/webhook \
  -H 'Content-Type: application/json' \
  -d '{"event":"connectivity.probe","timestamp":"1970-01-01T00:00:00+03:00","data":{}}'
```

Expect a fast 2xx or a signature-verification rejection (never a connection timeout/refused, and never a 5xx) — this only proves the route is reachable and responds quickly, per the vendor's own 15-second delivery timeout (§11.5); it does not send a real DigiDentiS-signed event and will be recorded/ignored by signature verification, not processed as a real appointment event.

### 3.8 Migration status

```bash
cd /var/www/noramedi/server
npx prisma migrate status
```

Confirm `20260730120000_add_external_calendar_integration` and `20260731000000_add_external_calendar_webhook_receiver_key` both show as applied (or, pre-deploy, are the next pending migrations with no gap before them). This targets whichever database `DATABASE_URL` in `/var/www/noramedi/server/.env` points to — per `PRODUCTION_TOPOLOGY.md`, production is PostgreSQL 16.14, database `noramedi_crm`; if the output looks unexpected (unfamiliar migration history, connection to the wrong host), confirm `DATABASE_URL` still points at `noramedi_crm` before proceeding.

### 3.9 Relevant safe logs (never grep for secret values themselves — see §6)

```bash
pm2 logs noramedi-api --lines 200 --nostream | grep -i 'external-calendar\|external_calendar\|digidentis'
pm2 logs noramedi-worker --lines 200 --nostream | grep -i 'external-calendar\|externalCalendarInboundRetryJob'
```

### 3.10 Clinics currently enabled (read-only DB check)

There is no cross-clinic "list all" endpoint in the Platform Admin API (`GET .../external-calendar` is scoped to one `:clinicId` at a time) — this is the only way to check the enabled state of every clinic's row at once. Selected columns exclude both secret columns.

```bash
psql "$DATABASE_URL" -c "SELECT \"clinicId\", \"provider\", \"enabled\", \"status\" FROM \"ExternalCalendarIntegration\" WHERE \"enabled\" = true;"
```

Expect zero rows before this program's own test-clinic step (§5) and again after §5 step 11 disables it. `$DATABASE_URL` is whatever `/var/www/noramedi/server/.env` sets — do not hardcode a connection string; per `PRODUCTION_TOPOLOGY.md` this targets database `noramedi_crm`.

---

## 4. Deployment checklist

This section maps directly onto the existing, already-battle-tested `scripts/noramedi-deploy.sh` — it does not introduce a new deployment mechanism for this feature. Every migration this PR adds is additive (confirmed in §3.8); no destructive DDL runs as part of this deploy.

1. **Fetch/update** — `git -C /var/www/noramedi pull --ff-only` (step 1 of `noramedi-deploy.sh`; confirm the pulled SHA matches §3.1's `origin/main` first if running manually).
2. **Backend dependency install** — `npm ci` in `server/` (installs the same deps; PR #271 adds no new runtime dependency beyond what's already in `server/package.json`).
3. **Migration** — `npx prisma migrate deploy` (applies the two additive migrations from §3.8 if not already applied).
4. **Prisma generation** — `npx prisma generate` (regenerates the client against the new schema — required after step 3, cheap, already step 4 of the deploy script).
5. **Backend build** — none: this project runs the backend via `tsx` directly (`npm run start` → `npx prisma generate && tsx src/index.ts`), there is no separate backend compile/build step.
6. **Frontend build (only if the Platform Admin UI changed and needs to reach the browser)** — `npm run build` (`tsc -b && vite build`) at the repo root, then publish per whatever mechanism currently serves the static frontend in production. **`PRODUCTION_TOPOLOGY.md` records that this publish step is not automated by any repository script** — confirm manually how the frontend currently reaches Nginx's static root before assuming this deploy alone makes `/platform/external-calendar` visible in production.
7. **PM2 restart** — `pm2 reload noramedi-api --update-env` (zero-downtime if cluster mode, instant otherwise — step 5 of the deploy script). The `--update-env` flag matters here specifically because step 2's `PUBLIC_API_BASE_URL` addition is a new environment variable PM2 must pick up.
8. **Local health check** — `noramedi-healthcheck.sh --local --max-attempts 12 --interval 5` (step 6 of the deploy script; targets `http://127.0.0.1:5000/api/health`).
9. **Public health check** — `noramedi-healthcheck.sh --max-attempts 3 --interval 5` (targets `https://api.noramedi.com/api/health`; not part of the existing script but a reasonable manual add-on right after deploy).
10. **Log check** — §3.9's commands, confirm no unexpected errors referencing `external-calendar`/`digidentis` immediately after restart.
11. **Rollback/disable instructions** — see §6.4. This deploy adds tables/columns only (no destructive DDL) — per this repo's own incident-response convention (`PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md` §4.1), the default response to any problem here is **disable the feature, not roll back the deploy**, since a physical rollback risks desynchronizing `_prisma_migrations` once the tables have any real rows.

Full command sequence, run from the production host as the deploying user:

```bash
sudo /usr/local/sbin/noramedi-deploy.sh
# equivalent manual sequence if not using the wrapper script:
#   git -C /var/www/noramedi pull --ff-only
#   cd /var/www/noramedi/server && npm ci
#   npx prisma migrate deploy
#   npx prisma generate
#   pm2 reload noramedi-api --update-env
#   sleep 2
#   /usr/local/sbin/noramedi-healthcheck.sh --local --max-attempts 12 --interval 5
```

---

## 5. Test-clinic rollout (single clinic only)

**Prerequisite:** the §0 activation gate is satisfied (webhook topology confirmed, production outbound IP whitelisted, credentials configured, mappings validated) — plus support contact confirmed and sandbox-vs-production clarified per §1 — and §2/§4 both green.

1. **Configure exactly one clinic** in Platform Admin (`/platform/external-calendar`) — do not touch any other clinic's row during this test.
2. **Enter test credentials** — the Client ID/Secret and `externalClinicId`/`externalCompanyId` DigiDentiS issues for this specific clinic/company. Since no sandbox is documented (§1), these credentials talk to DigiDentiS's real production system — proceed accordingly (see §6.3 on avoiding real patient data).
3. **Fetch company/clinic/doctors/treatment types** via `POST .../test-connection` then `GET .../remote-options` — confirms the credentials work and treatment types are "API Visible" (§2) before attempting anything else.
4. **Verify mappings** — map at least one real practitioner and one real treatment type via `PUT .../mappings`, confirm both appear correctly via `GET .../mappings`.
5. **Re-confirm the §0 activation gate, then enable the clinic** — before this step, credentials (step 2) and mappings (step 4) are already in place; explicitly re-check that webhook topology is confirmed and the production outbound IP is whitelisted (§1). Only once all four gate conditions hold: `PATCH /api/platform/clinics/:clinicId/external-calendar/enabled {"enabled": true}`. Confirm the response reflects `enabled: true` before proceeding — no earlier step in this rollout enables the clinic.
6. **Verify slots** — this PR's provider client supports doctor/company slot queries (`DIGIDENTIS_PATHS.doctorSlots`/`companySlots`); confirm a slot query for the mapped doctor returns a plausible, non-empty result for a near-future date range (respecting the vendor's 90-day max span, §10.5 of the vendor doc).
7. **Create a controlled test appointment** — use a clearly fake/test patient name and a phone/email that is obviously not a real patient's (per §6.3, never real patient data). Use `X-Idempotency-Key` semantics as documented (the client should already do this) so a retried create call is provably safe.
8. **Verify DigiDentiS calendar appearance** — confirm the test appointment is visible in DigiDentiS's own UI/calendar for that doctor/clinic, not just that NoraMedi's API call returned success.
9. **Verify created/cancelled/rescheduled webhooks** — trigger each from the DigiDentiS side (or via the API calls that cause them) and confirm each is durably recorded (`ExternalCalendarInboundEvent`) with the correct `eventType` and a verified `X-Webhook-Signature`. Remember: per the architecture doc, none of these webhooks mutate NoraMedi's `Appointment` table yet — Phase 2 has not been merged (§0) — verification here means "durably and correctly recorded," not "reflected in the patient-facing calendar."
10. **Verify duplicate webhook handling** — DigiDentiS itself states deliveries "may arrive more than once in rare cases" (§11.5); replaying the same webhook body/`X-Webhook-Id` should be idempotently deduped, not double-recorded. This can be tested directly (resend the same captured request) without waiting for a real vendor-side duplicate.
11. **Disable the integration after testing** — `PATCH /api/platform/clinics/:clinicId/external-calendar/enabled {"enabled": false}` — **do this before ending the test session**, since Phase 2 (appointment-flow wiring) has not been merged (§0) and there is no product reason for a clinic to have this enabled with no Phase 2 consumer of the data yet; every enabled clinic is additional exposed surface (webhook endpoint, stored external credentials) with no corresponding business benefit until Phase 2 exists.

---

## 6. Security rules

1. **Never email a Client Secret or Webhook Secret.** These are entered directly into Platform Admin's configuration form (`PUT .../external-calendar`, over the platform's own authenticated/CSRF-protected session) — there is no legitimate reason for either value to appear in an email, a support ticket, or a chat message. If DigiDentiS's own onboarding process sends you a secret by email, treat that inbound email itself as sensitive (delete after use, do not forward) — that is their channel choice, not a NoraMedi one, and does not license doing the same in reverse.
2. **Never print secrets in commands or logs.** None of §3's read-only commands request, echo, or grep for `clientSecret`, `webhookSecret`, or their encrypted columns. The codebase already never returns a decrypted secret from any route (`externalCalendarConnectionService.ts`'s summary DTO exposes only `clientSecretConfigured: boolean`). Do not add `console.log`/ad-hoc debugging that would violate this — if you need to confirm a secret was saved, use the boolean "configured" flag or `test-connection`, never inspect the raw column.
3. **Avoid real patient data in tests** (§5, step 7) — use obviously-fake names/contact details for the single test appointment. This also matters because a webhook payload's `data.patient` block (per the vendor's documented payload shape, §11.3) will contain whatever was entered, and that payload is durably stored in `ExternalCalendarInboundEvent` once received.
4. **Rotate secrets after accidental disclosure:**
   - **Webhook secret leaked/suspected leaked:** re-enter a new `webhookSecret` via `PUT .../external-calendar` (this alone does not change the public webhook URL) **and** ask DigiDentiS to update their side to the new secret — the vendor doc's own best practice (§11.6) is "rotate it via the DigiDentiS team if it is ever exposed," meaning this is a two-sided rotation, not a NoraMedi-only action.
   - **Client Secret leaked/suspected leaked:** this is vendor-issued and vendor-side; contact DigiDentiS support (§1) to reissue it, then update `clientSecret` via the same `PUT` endpoint. There is no NoraMedi-side-only remediation for this one.
   - **Webhook receiver key (URL) leaked:** lower severity — it is not a secret in the HMAC sense (forged deliveries are still rejected by signature verification regardless), but rotate it anyway to stop a leaked/enumerated URL from being probed: `POST .../external-calendar/rotate-webhook-key`. The old URL stops resolving immediately; DigiDentiS must be given the new one.
5. **Exact kill-switch step** (single clinic, immediate, no deploy required):
   ```
   PATCH /api/platform/clinics/:clinicId/external-calendar/enabled
   Body: { "enabled": false }
   ```
   This is the same call used in §5 step 11. It is instantaneous (no restart, no migration) and is enforced server-side — a disabled clinic's webhook events are still accepted and durably recorded (never silently dropped, per the architecture doc) but the connection is marked inactive for any future Phase 2 orchestration (Phase 2 not merged, §0).
6. **Exact rollback step** (application-level, if a deploy itself needs to be undone): per §4 item 11 and this repo's own incident playbook, prefer redeploying a known-good prior commit over reversing the (purely additive) migrations — see `PILOT_INCIDENT_AND_ROLLBACK_PLAYBOOK.md` §4.1 for the general principle this project already follows. Do not run a reverse migration against these two tables once any real clinic has rows in them.

---

## 7. Status matrix

| Capability | Status |
|---|---|
| Provider-agnostic integration framework, DigiDentiS HMAC client, encrypted credential storage, Platform Admin UI, mapping UI, webhook receiver + idempotent storage | **Already implemented** (PR #271, merged) |
| Disabled-by-default enforcement, refuse-enable-until-configured guard | **Already implemented**, verify live state per §2's last row before go-live |
| Connecting DigiDentiS events to `AppointmentRequest` conversion; delaying patient confirmation until external sync succeeds; outbound retry orchestration for approved appointments | **Requires Phase 2 — not yet merged into `main`, not deployed, does not exist in this codebase as of this baseline** (explicitly out of scope for PR #271 per its own description) |
| IP whitelist registration; confirmed current support contact; confirmed webhook topology (per-clinic vs. per-integrator); confirmed sandbox existence; any vendor-side clinic/company activation step | **Requires DigiDentiS support** — see §1 |
| Setting `PUBLIC_API_BASE_URL` in production `.env`; entering real Client ID/Secret/company/clinic ids and mappings for any real clinic; running the deploy; running the test-clinic rollout; disabling after test | **Requires production operator action** |
| Whether production DNS/health/outbound IP/webhook reachability are currently correct; whether the frontend build for `/platform/external-calendar` has actually been published to Nginx's static root | **Cannot yet be verified** from this repository alone — run §3's commands live to find out |

**This integration is not production-active for any clinic as of this baseline.** PR #271 provides the foundation only.

---

## 8. What you should do next

In order:

1. Send the vendor email (§1, full draft in [`DIGIDENTIS_VENDOR_INFORMATION_REQUEST_EMAIL.md`](DIGIDENTIS_VENDOR_INFORMATION_REQUEST_EMAIL.md)) and wait for answers on support contact, IP whitelisting, webhook topology, and sandbox availability before proceeding further.
2. While waiting, run the read-only verification commands now, from the production host, to establish a current baseline (safe regardless of vendor response timing):
   ```bash
   cd /var/www/noramedi && git fetch origin --quiet && git rev-parse HEAD origin/main
   pm2 list
   curl -s https://api.noramedi.com/api/health
   curl -s https://api.ipify.org; curl -s https://ifconfig.me
   cd /var/www/noramedi/server && npx prisma migrate status
   ```
3. Add `PUBLIC_API_BASE_URL=https://api.noramedi.com` to production's `server/.env` (it is not in `server/.env.example` and must be added manually) — confirm `ENCRYPTION_KEY` is already set (it should be, as a pre-existing requirement).
4. Once the vendor confirms the IP whitelist is registered and answers the webhook-topology question, deploy per §4 (`sudo /usr/local/sbin/noramedi-deploy.sh`), then confirm `npx prisma migrate status` shows both new migrations applied and both health checks pass.
5. Run the single test-clinic rollout per §5, end-to-end, with a fake test patient/appointment only.
6. Disable that clinic's integration (§6, step 5's `PATCH .../enabled {"enabled": false}`) once testing is verified — leave it disabled until Phase 2 is scoped and approved.
7. Do not onboard a second clinic, and do not treat this as production-active for real patients, until Phase 2 exists and the webhook-topology question from §1.1 is resolved.
