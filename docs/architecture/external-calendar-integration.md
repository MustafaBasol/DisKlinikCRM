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

Reserved/unknown webhook event types (anything DigiDentiS sends that is not
one of the three active types) are stored with `status: 'ignored'` — never
silently dropped, never guessed at.

## Authentication — DigiDentiS v3.2.0 per-request HMAC signing

DigiDentiS authenticates every API request individually with an HMAC
signature — there is no OAuth2 token endpoint, no bearer token, and nothing
to cache or refresh. An earlier revision of this module incorrectly assumed
OAuth2 client-credentials auth; that code (`DigiDentisAuthClient.ts`, the
`/oauth/token` path, the `Authorization: Bearer` header) has been removed
entirely.

Every outgoing request (`DigiDentisApiClient.ts`) carries:

| Header | Value |
| --- | --- |
| `X-Client-ID` | the clinic's DigiDentiS client id (plaintext, not secret) |
| `X-Timestamp` | unix epoch milliseconds, decimal string |
| `X-Nonce` | 16 random bytes as 32 hex chars, unique per request |
| `X-Signature` | `hex(HMAC-SHA256(clientSecret, signingString))` |

`signingString = "${METHOD}\n${path}\n${timestamp}\n${nonce}\n${sha256Hex(body)}"`,
where `path` is the request path only (no scheme/host/query) and `body` is
the *exact* Buffer transmitted as the HTTP body (never a re-serialization of
it — see `DigiDentisApiClient.ts`'s `performRequest`, which signs and sends
the same `Buffer`). Implementation: `DigiDentisSigning.ts`.

Inbound webhooks are verified the same way: `X-Webhook-Signature: <hex>` is
`HMAC-SHA256(webhookSecret, rawRequestBody)`, compared with
`crypto.timingSafeEqual` (`DigiDentisProvider.verifyWebhookSignature`).

**Known limitation.** No publicly reachable copy of the DigiDentiS Takvim
API v3.2.0 documentation could be located for this task (web search turned
up nothing under the DigiDentiS name matching a dental-calendar API). The
header names and HMAC-SHA256 algorithm above are exactly what was specified
for this task and are treated as authoritative. What remains unverified —
because no real spec was available to check them against — is the
byte-for-byte signing-string field order/separators, and all REST resource
paths/payloads/response shapes/error codes in `digidentisConfig.ts`'s
`DIGIDENTIS_PATHS` and `DigiDentisApiClient.ts` (companies/clinics/doctors/
treatment-types/slots/appointments). **Do not treat those as verified
against a real DigiDentiS deployment** — confirm and correct them against
the actual v3.2.0 documentation before enabling this integration for any
real clinic.

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
  an RFC 2606 `.invalid` placeholder host so a misconfigured clinic fails
  loudly instead of silently calling an unintended real endpoint.
- Migration `20260730120000_add_external_calendar_integration` is purely
  additive (four new tables, two new nullable back-relation columns via
  Prisma relations only — no columns added to existing tables). No backfill
  needed; no existing behavior changes on deploy.
- Migration `20260731000000_add_external_calendar_webhook_receiver_key`
  adds the `webhookReceiverKey` column described above (additive; backfills
  any pre-existing rows with a random value, then enforces `NOT NULL` +
  `UNIQUE`). This feature has not shipped to production, so no real backfill
  is expected in practice.
