# External Calendar Integration Framework

Status: **Foundation phase implemented, disabled by default.** No production
appointment approval behavior or patient confirmation messaging is changed
by this phase. See "Current phase boundary" below.

## Goal

A reusable, provider-agnostic framework for synchronizing NoraMedi
appointments with external dental-software calendars, starting with
DigiDentiS. Designed so additional providers can be added later without
touching WhatsApp/appointment route code.

## Architecture

```
server/src/services/externalCalendar/
  ExternalCalendarProvider.ts          — provider adapter interface
  externalCalendarProviderFactory.ts   — provider key -> implementation
  externalCalendarErrors.ts            — typed error hierarchy
  externalCalendarConnectionService.ts — tenant-safe config CRUD, encryption, sanitized DTOs
  externalCalendarMappingService.ts    — practitioner/service <-> doctor/treatment-type mappings
  externalCalendarIdempotency.ts       — inbound webhook idempotency ledger
  externalCalendarWebhookProcessor.ts  — signature-verified event -> durable, idempotent storage
  externalCalendarOrchestration.ts     — prepared (NOT wired up) seam for the appointment approval flow
  digidentis/
    digidentisConfig.ts       — endpoint paths, defaults
    DigiDentisSigning.ts      — per-request HMAC signing + webhook signature verification
    DigiDentisApiClient.ts    — low-level HMAC-signed HTTP client (no token/bearer auth)
    DigiDentisProvider.ts     — ExternalCalendarProvider implementation for DigiDentiS

server/src/routes/
  externalCalendarWebhook.ts      — public webhook receiver (mounted at /api/public)
  platformExternalCalendar.ts     — Platform Admin configuration API (mounted at /api/platform)

server/src/jobs/
  externalCalendarInboundRetryJob.ts — crash-recovery for stuck inbound events

src/pages/platform/PlatformExternalCalendar.tsx — Platform Admin UI: select a
  clinic, configure DigiDentiS, manage mappings.
```

Every provider-specific integration (currently only DigiDentiS) implements
`ExternalCalendarProvider` and is looked up only through
`externalCalendarProviderFactory.ts` — no route, job, or webhook handler
imports a concrete provider class directly. Adding a second provider means:
add a new subdirectory implementing the interface, register it in the
factory map, and it is immediately usable by every existing route/job/
webhook path with no changes to those files.

## Reused patterns

- **Encryption**: `utils/encryption.ts`'s `encryptSecret`/`decryptSecret`
  (AES-256-GCM), the same module used for WhatsApp/Instagram credentials.
- **Tenant isolation**: `ExternalCalendarIntegration.clinicId` is a unique
  key (one integration per clinic, mirrors `ClinicSmsSettings`);
  `organizationId` is always re-derived from the `Clinic` row, never trusted
  from caller input.
- **Webhook idempotency**: `ExternalCalendarInboundEvent`'s
  `@@unique([provider, connectionId, providerEventId])` constraint plus
  "insert, catch P2002" dedup — the same pattern as `MessagingInboundEvent`
  / `messagingInboundIdempotency.ts`.
- **Audit trail**: every configuration/mapping/enable-disable change is
  recorded via `writeAuditLog()` (`utils/auditLog.ts`), never including
  secret values.
- **Background jobs**: `node-cron` + `utils/jobLock.ts`'s DB-backed lease
  lock, the same convention as `inboundEventRetryJob.ts`.
- **Admin UX**: Platform Admin selects a clinic from a searchable list, then
  configures that clinic's integration in a detail panel — the same
  select-then-configure shape as `PlatformClinics.tsx`'s SMS add-on modal.

## Current phase boundary

This phase intentionally does **not**:

- Change any production appointment approval behavior or patient
  confirmation messages.
- Automatically mutate NoraMedi `Appointment` status from webhook events —
  `externalCalendarWebhookProcessor.ts` durably records every recognized
  event (`appointment.created` / `.cancelled` / `.rescheduled`) but never
  writes to `Appointment`.
- Enable any clinic's integration by default — `enabled` defaults to
  `false` and is refused until `clientId`/`clientSecret`/`externalClinicId`
  are all configured.
- Wire `externalCalendarOrchestration.ts`'s prepared
  `syncAppointmentToExternalCalendar()` seam into any real call site — it
  throws `ExternalCalendarOrchestrationNotImplementedError` if called.

Reserved event types (`appointment.confirmed`/`.completed`/`.no_show` —
documented as part of the webhook contract, not yet firing in practice) and
genuinely unrecognized event types are both stored with `status: 'ignored'`
— never silently dropped, never guessed at. Reserved types are recognized
by name (not lumped in with true `unknown` types) so their stored
`eventType` is always the real, specific string DigiDentiS sent.

## Authentication — DigiDentiS Takvim API v3.2.0 per-request HMAC signing

**Verified against the real vendor documentation**
(`docs/vendor/digidentis/DigiDentiS_Takvim_API_Documentation_v3.2.html`,
§2–§4, §11.4). DigiDentiS authenticates every API request individually with
an HMAC signature — there is no OAuth2 token endpoint, no bearer token, and
nothing to cache or refresh. An earlier revision of this module incorrectly
assumed OAuth2 client-credentials auth; that code (`DigiDentisAuthClient.ts`,
the `/oauth/token` path, the `Authorization: Bearer` header) has been
removed entirely.

Every outgoing request (`DigiDentisApiClient.ts`) carries:

| Header | Value |
| --- | --- |
| `X-Client-ID` | the clinic's DigiDentiS client id (plaintext, not secret) |
| `X-Timestamp` | unix epoch **seconds** (not milliseconds), decimal string — must be within 5 minutes of DigiDentiS's server time |
| `X-Nonce` | 16 random bytes as 32 hex chars, unique per request (matches the vendor's own PHP reference: `bin2hex(random_bytes(16))`) |
| `X-Signature` | `hex(HMAC-SHA256(signingString, clientSecret))` |

`signingString = "${timestamp}.${nonce}.${method}.${path}.${sha256Hex(body)}"`
— **dot-separated**, in this exact field order (NOT newline-separated, and
NOT the same field order as an earlier placeholder revision of this file
assumed). `path` is the endpoint path *relative to the base URL*: no
scheme/host, no leading slash, and — critically — **no query string**; a
GET request's pagination params or a DELETE's `?reason=...` are never part
of the signature. `body` is the *exact* Buffer transmitted as the HTTP body
(never a re-serialization of it — see `DigiDentisApiClient.ts`'s
`performRequest`, which signs and sends the same `Buffer`). For a bodyless
request, `sha256Hex(body)` is `SHA256("")` =
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
Implementation: `DigiDentisSigning.ts`; `digidentisSigning.test.ts` asserts
against the vendor doc's own worked example verbatim.

Inbound webhooks are verified the same way, with one documented detail that
is easy to get wrong: `X-Webhook-Signature` is **`sha256=<hex-digest>`** —
the `sha256=` prefix is part of the format, comparison must be against the
full prefixed string, not a bare hex digest. The digest itself is
`HMAC-SHA256(webhookSecret, rawRequestBody)`, compared with
`crypto.timingSafeEqual` (`DigiDentisProvider.verifyWebhookSignature`).

### IP whitelisting (vendor doc §2)

"All requests must originate from pre-approved IP addresses. Contact
DigiDentiS support to register your server IPs before integration." This is
an operational/support-desk requirement, not something this codebase can
configure — the production host's actual outbound IP must be obtained live
(it is not otherwise recorded anywhere in this repository) and submitted to
DigiDentiS support before any real clinic can connect. A 403
`IP_NOT_ALLOWED` response indicates this step was missed or the IP changed.

### Endpoint inventory (vendor doc §7) — company-scoped, not clinic-scoped

Doctors, treatment types, and the full-sync export are listed per DigiDentiS
**company** (`companies/{company_id}/doctors`, `.../treatment-types`), not
per clinic — an earlier placeholder revision of this module assumed
clinic-nested paths (`clinics/{clinicId}/doctors`), which do not exist in
the real API. Clinic-level filtering happens via each record's own
`clinic_id` field, or an optional `clinic_id` query parameter on
`GET /appointments` and `GET /slots` — never via a clinic-scoped path
segment. See `digidentisConfig.ts`'s `DIGIDENTIS_PATHS` for the full,
verified path list (health, companies, company details/quota, clinics,
doctors, doctor slots, company-wide slots, treatment types, full sync,
appointments create/list/get/cancel/reschedule).

Every response is wrapped in an envelope —
`{"success": true, "data": {...}, "meta": {...}}` on success, or
`{"success": false, "error": {"code": "...", "message": "..."}, "meta": {...}}`
on failure — which `DigiDentisApiClient.ts` unwraps/surfaces accordingly.
Idempotency (`X-Idempotency-Key`, recommended on create/cancel/reschedule)
is a request **header**, never a JSON body field.

### Treatment-type "API Visible" prerequisite (vendor doc §7.10)

If `GET /companies/{company_id}/treatment-types` returns an empty array, it
means no treatment types are enabled for API visibility on the DigiDentiS
side. Resolve in the DigiDentiS dashboard: **Settings → System →
Customization → enable "API Visible"** for each treatment type to expose.
This is a real, DigiDentiS-side prerequisite per clinic/company, not a bug
in this integration — the Platform Admin mapping UI will simply show an
empty treatment-type dropdown until it's done.

## Public webhook URL — opaque receiver key, not the row's database id

`ExternalCalendarIntegration.webhookReceiverKey` is a 256-bit random,
URL-safe token (`crypto.randomBytes(32).toString('base64url')`), generated
once when a clinic's integration is first configured and stored alongside
(but independent from) the row's own primary key. The public webhook URL is
built from this key, never from the row's own database id:

```
/api/public/external-calendar/digidentis/:webhookReceiverKey/webhook
```

This matters because the row's own id is also the foreign-key target for
every child table (`ExternalCalendarMapping`, `ExternalCalendarInboundEvent`,
`ExternalCalendarAppointmentLink`) and the audit log's `entityId` — it isn't
something that can be safely rotated on its own. `webhookReceiverKey` exists
so the public-facing value can be regenerated independently:

- `POST /api/platform/clinics/:clinicId/external-calendar/rotate-webhook-key`
  (Platform Admin only) regenerates the key. The previous webhook URL stops
  resolving immediately (the lookup is a `findUnique` by
  `webhookReceiverKey` — see `getExternalCalendarConnectionRecordByReceiverKey`
  in `externalCalendarConnectionService.ts`), and DigiDentiS must be
  reconfigured with the new URL. The Platform Admin UI exposes this as a
  "Rotate webhook key" button next to the displayed webhook URL.
- Saving other configuration fields (client id/secret, external ids) never
  touches `webhookReceiverKey` — only explicit rotation changes it.
- The key itself is not treated as a secret in the same sense as the
  webhook HMAC secret (it's returned in the Platform Admin summary DTO so
  the URL can be displayed/copied) — forged webhook deliveries are still
  rejected by `X-Webhook-Signature` verification regardless of whether the
  receiver key leaked. Its purpose is to avoid exposing/enumerating a
  predictable database identifier in a public URL, and to make that URL
  rotatable without disturbing the integration row's identity.

## Configuration / deployment notes

- `ENCRYPTION_KEY` (already required by the rest of the app) is reused —
  no new encryption key needed.
- `PUBLIC_API_BASE_URL` (optional): if set, the Platform Admin UI's
  displayed webhook URL is prefixed with it (e.g.
  `https://api.example.com/api/public/external-calendar/digidentis/:webhookReceiverKey/webhook`).
  If unset, the webhook URL is shown as a relative path — set this in
  production so the displayed URL is the one DigiDentiS should actually
  call.
- `DIGIDENTIS_DEFAULT_API_BASE_URL` (optional): default DigiDentiS API base
  URL when a clinic does not set its own `apiBaseUrl` override. Defaults to
  the **verified production base URL from the vendor doc**,
  `https://www.ddslogin.com/Api/v1/external_booking`
  (`DIGIDENTIS_VERIFIED_PRODUCTION_BASE_URL` in `digidentisConfig.ts`). The
  vendor documentation lists exactly one base URL, labeled "Production" — no
  sandbox/staging host is documented anywhere in the v3.2.0 spec; confirm
  with DigiDentiS support directly whether a non-production environment
  exists before assuming any clinic can be safely used for live testing.
- Migration `20260730120000_add_external_calendar_integration` is purely
  additive (four new tables, two new nullable back-relation columns via
  Prisma relations only — no columns added to existing tables). No backfill
  needed; no existing behavior changes on deploy.
- Migration `20260731000000_add_external_calendar_webhook_receiver_key`
  adds the `webhookReceiverKey` column described above (additive; backfills
  any pre-existing rows with a random value, then enforces `NOT NULL` +
  `UNIQUE`). This feature has not shipped to production, so no real backfill
  is expected in practice.
