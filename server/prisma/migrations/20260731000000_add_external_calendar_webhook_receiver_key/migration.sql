-- Adds an opaque, random, rotatable webhook receiver key to
-- ExternalCalendarIntegration, decoupled from the row's own database id.
--
-- The original migration exposed the row's own primary key as the public
-- webhook URL path segment (/api/public/external-calendar/digidentis/:id/
-- webhook). A Prisma-generated uuid() primary key is randomly generated,
-- but it is also this row's foreign-key target for every child table
-- (ExternalCalendarMapping, ExternalCalendarInboundEvent,
-- ExternalCalendarAppointmentLink) and the entityId used throughout the
-- audit log — rotating it would mean deleting and recreating the whole
-- integration and all of its mappings. This column exists solely so the
-- public-facing value can be regenerated independently, without touching
-- the row's identity or any related data.
--
-- Backfill uses gen_random_uuid(), built into Postgres core since v13 (no
-- pgcrypto extension required) — sufficient one-time entropy for existing
-- rows; new rows always get an application-generated key (see
-- externalCalendarConnectionService.ts's generateWebhookReceiverKey()).

-- AddColumn
ALTER TABLE "ExternalCalendarIntegration" ADD COLUMN "webhookReceiverKey" TEXT;

-- Backfill any existing rows (none expected outside of local/dev testing —
-- this feature has not shipped to production yet).
UPDATE "ExternalCalendarIntegration"
SET "webhookReceiverKey" = gen_random_uuid()::text
WHERE "webhookReceiverKey" IS NULL;

-- AlterColumn
ALTER TABLE "ExternalCalendarIntegration" ALTER COLUMN "webhookReceiverKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ExternalCalendarIntegration_webhookReceiverKey_key" ON "ExternalCalendarIntegration"("webhookReceiverKey");
