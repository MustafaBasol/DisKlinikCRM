-- Add optional channel source metadata for unified appointment requests.
ALTER TABLE "AppointmentRequest" ADD COLUMN "externalSenderId" TEXT;
ALTER TABLE "AppointmentRequest" ADD COLUMN "sourceConnectionId" TEXT;
ALTER TABLE "AppointmentRequest" ADD COLUMN "sourceInboxEntryId" TEXT;
ALTER TABLE "AppointmentRequest" ADD COLUMN "sourceConversationId" TEXT;

CREATE INDEX "AppointmentRequest_source_status_createdAt_idx" ON "AppointmentRequest"("source", "status", "createdAt");
CREATE INDEX "AppointmentRequest_sourceInboxEntryId_idx" ON "AppointmentRequest"("sourceInboxEntryId");
