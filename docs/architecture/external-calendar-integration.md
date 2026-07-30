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
    DigiDentisSigning.ts      — request signing + webhook signature verification
    DigiDentisAuthClient.ts   — OAuth2 client-credentials token cache
    DigiDentisApiClient.ts    — low-level signed HTTP client
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

## Known limitation — DigiDentiS v3.2.0 authentication/signing

The DigiDentiS v3.2.0 API documentation referenced by this task was not
available in the repository or task materials at implementation time.
`DigiDentisSigning.ts` implements a best-practice placeholder (OAuth2
client-credentials + HMAC-SHA256 request signing, modeled on this
codebase's existing Meta webhook verification) that is deliberately
isolated in `DigiDentisSigning.ts` / `digidentisConfig.ts` so it can be
corrected against the real spec without touching any other module. **Do not
treat the current header names, canonicalization, or endpoint paths as
verified against a real DigiDentiS deployment.** Before enabling this
integration for any real clinic, confirm and correct:

- The token endpoint path and grant shape (`digidentisConfig.ts`'s
  `DIGIDENTIS_PATHS.token`).
- The request-signing header names/canonicalization
  (`DigiDentisSigning.ts`).
- The webhook signature header name and scheme
  (`DigiDentisProvider.verifyWebhookSignature`, currently
  `X-DigiDentiS-Signature: sha256=<hex>`).
- All REST resource paths in `digidentisConfig.ts`'s `DIGIDENTIS_PATHS`
  (companies/clinics/doctors/treatment-types/slots/appointments).

## Configuration / deployment notes

- `ENCRYPTION_KEY` (already required by the rest of the app) is reused —
  no new encryption key needed.
- `PUBLIC_API_BASE_URL` (optional): if set, the Platform Admin UI's
  displayed webhook URL is prefixed with it (e.g.
  `https://api.example.com/api/public/external-calendar/digidentis/:id/webhook`).
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
