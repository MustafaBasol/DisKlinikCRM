-- External Calendar Integration Framework (DigiDentiS + future providers).
-- Purely additive — no existing table, column, constraint, or index is
-- altered, dropped, or renamed. Hand-authored (not `prisma migrate dev`
-- auto-diff output), per the same convention as prior migrations in this
-- repo (see 20260720180000_add_platform_admin_audit_event).
--
-- All four tables are new and unused by any production write path until a
-- Platform Admin explicitly configures + enables a clinic's integration.
-- `enabled` defaults to false everywhere.

-- CreateTable
CREATE TABLE "ExternalCalendarIntegration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'digidentis',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'not_configured',
    "clientId" TEXT,
    "clientSecretEncrypted" TEXT,
    "webhookSecretEncrypted" TEXT,
    "externalCompanyId" TEXT,
    "externalClinicId" TEXT,
    "apiBaseUrl" TEXT,
    "lastSuccessfulCheckAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalCalendarIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalCalendarIntegration_clinicId_key" ON "ExternalCalendarIntegration"("clinicId");

-- CreateIndex
CREATE INDEX "ExternalCalendarIntegration_organizationId_idx" ON "ExternalCalendarIntegration"("organizationId");

-- CreateIndex
CREATE INDEX "ExternalCalendarIntegration_provider_idx" ON "ExternalCalendarIntegration"("provider");

-- AddForeignKey
ALTER TABLE "ExternalCalendarIntegration" ADD CONSTRAINT "ExternalCalendarIntegration_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ExternalCalendarMapping" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "mappingType" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalLabel" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalCalendarMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalCalendarMapping_connectionId_mappingType_localId_key" ON "ExternalCalendarMapping"("connectionId", "mappingType", "localId");

-- CreateIndex
CREATE INDEX "ExternalCalendarMapping_clinicId_idx" ON "ExternalCalendarMapping"("clinicId");

-- CreateIndex
CREATE INDEX "ExternalCalendarMapping_connectionId_mappingType_idx" ON "ExternalCalendarMapping"("connectionId", "mappingType");

-- AddForeignKey
ALTER TABLE "ExternalCalendarMapping" ADD CONSTRAINT "ExternalCalendarMapping_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ExternalCalendarIntegration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ExternalCalendarInboundEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "connectionId" TEXT,
    "clinicId" TEXT,
    "organizationId" TEXT,
    "eventType" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "externalAppointmentId" TEXT,
    "rawPayload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'received',
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalCalendarInboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalCalendarInboundEvent_provider_connectionId_provide_key" ON "ExternalCalendarInboundEvent"("provider", "connectionId", "providerEventId");

-- CreateIndex
CREATE INDEX "ExternalCalendarInboundEvent_organizationId_status_created_idx" ON "ExternalCalendarInboundEvent"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalCalendarInboundEvent_clinicId_status_createdAt_idx" ON "ExternalCalendarInboundEvent"("clinicId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalCalendarInboundEvent_status_updatedAt_idx" ON "ExternalCalendarInboundEvent"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "ExternalCalendarInboundEvent" ADD CONSTRAINT "ExternalCalendarInboundEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ExternalCalendarIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ExternalCalendarAppointmentLink" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "externalAppointmentId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalCalendarAppointmentLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalCalendarAppointmentLink_connectionId_idempotencyK_key" ON "ExternalCalendarAppointmentLink"("connectionId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ExternalCalendarAppointmentLink_connectionId_externalAppoi_idx" ON "ExternalCalendarAppointmentLink"("connectionId", "externalAppointmentId");

-- CreateIndex
CREATE INDEX "ExternalCalendarAppointmentLink_clinicId_idx" ON "ExternalCalendarAppointmentLink"("clinicId");

-- CreateIndex
CREATE INDEX "ExternalCalendarAppointmentLink_appointmentId_idx" ON "ExternalCalendarAppointmentLink"("appointmentId");

-- AddForeignKey
ALTER TABLE "ExternalCalendarAppointmentLink" ADD CONSTRAINT "ExternalCalendarAppointmentLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ExternalCalendarIntegration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalCalendarAppointmentLink" ADD CONSTRAINT "ExternalCalendarAppointmentLink_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
