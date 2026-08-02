-- Phase 2: wires ExternalCalendarAppointmentLink into the AppointmentRequest
-- conversion flow as a durable outbound-sync ledger. Adds the fields needed
-- for an outbound lifecycle (pending/syncing/synced/failed_retryable/
-- failed_terminal/cancelled), attempt counting, retry backoff scheduling,
-- and safe (non-secret, non-patient-data) failure classification.
--
-- externalAppointmentId becomes nullable: a row now exists from the moment
-- local conversion commits (status='pending'), before the provider has
-- confirmed anything.

-- AlterColumn: externalAppointmentId is no longer known at row-creation time.
ALTER TABLE "ExternalCalendarAppointmentLink" ALTER COLUMN "externalAppointmentId" DROP NOT NULL;

-- AlterColumn: status default changes from the old 'active' (post-hoc link)
-- semantics to the new pre-sync 'pending' default. Existing rows (none
-- expected outside local/dev testing — this table is unused by any
-- production write path before this migration) keep their current value.
ALTER TABLE "ExternalCalendarAppointmentLink" ALTER COLUMN "status" SET DEFAULT 'pending';

-- AddColumn
ALTER TABLE "ExternalCalendarAppointmentLink" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ExternalCalendarAppointmentLink" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);
ALTER TABLE "ExternalCalendarAppointmentLink" ADD COLUMN "lastAttemptAt" TIMESTAMP(3);
ALTER TABLE "ExternalCalendarAppointmentLink" ADD COLUMN "lastError" TEXT;
ALTER TABLE "ExternalCalendarAppointmentLink" ADD COLUMN "errorCode" TEXT;

-- CreateIndex: the retry job's core query is `status = 'failed_retryable' AND
-- nextAttemptAt <= now()`.
CREATE INDEX "ExternalCalendarAppointmentLink_status_nextAttemptAt_idx" ON "ExternalCalendarAppointmentLink"("status", "nextAttemptAt");
