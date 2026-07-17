-- KVKK-CRIT-003: Security Incident Response Foundation
--
-- This migration only adds the three new security-incident tables. It was
-- generated against a dev database that had unrelated drift (other tables'
-- FKs/indexes/defaults); those unrelated statements were intentionally
-- stripped from this file so it applies cleanly to any environment already
-- at the 20260716120000_add_clinic_bulk_export baseline.

-- CreateTable
CREATE TABLE "SecuritySignalEvent" (
    "id" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "organizationId" TEXT,
    "clinicId" TEXT,
    "actorUserId" TEXT,
    "actorPlatformAdminId" TEXT,
    "ipHash" TEXT,
    "userAgentFingerprint" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "dedupeDimension" TEXT NOT NULL,
    "safeMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecuritySignalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityIncident" (
    "id" TEXT NOT NULL,
    "incidentKey" TEXT NOT NULL,
    "organizationId" TEXT,
    "clinicId" TEXT,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "sourceType" TEXT NOT NULL,
    "sourceRule" TEXT NOT NULL,
    "affectedResourceType" TEXT,
    "affectedResourceId" TEXT,
    "assignedToPlatformAdminId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedByPlatformAdminId" TEXT,
    "containedAt" TIMESTAMP(3),
    "containedByPlatformAdminId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByPlatformAdminId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedByPlatformAdminId" TEXT,
    "resolutionSummary" TEXT,
    "containmentSummary" TEXT,
    "legalReviewRequired" BOOLEAN NOT NULL DEFAULT true,
    "legalReviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityIncidentActivity" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousStatus" TEXT,
    "newStatus" TEXT,
    "actorPlatformAdminId" TEXT,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityIncidentActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SecuritySignalEvent_ruleKey_dedupeDimension_createdAt_idx" ON "SecuritySignalEvent"("ruleKey", "dedupeDimension", "createdAt");

-- CreateIndex
CREATE INDEX "SecuritySignalEvent_organizationId_createdAt_idx" ON "SecuritySignalEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "SecuritySignalEvent_clinicId_createdAt_idx" ON "SecuritySignalEvent"("clinicId", "createdAt");

-- CreateIndex
CREATE INDEX "SecuritySignalEvent_createdAt_idx" ON "SecuritySignalEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityIncident_incidentKey_key" ON "SecurityIncident"("incidentKey");

-- CreateIndex
CREATE INDEX "SecurityIncident_status_severity_lastDetectedAt_idx" ON "SecurityIncident"("status", "severity", "lastDetectedAt");

-- CreateIndex
CREATE INDEX "SecurityIncident_organizationId_status_idx" ON "SecurityIncident"("organizationId", "status");

-- CreateIndex
CREATE INDEX "SecurityIncident_clinicId_status_idx" ON "SecurityIncident"("clinicId", "status");

-- CreateIndex
CREATE INDEX "SecurityIncident_category_lastDetectedAt_idx" ON "SecurityIncident"("category", "lastDetectedAt");

-- CreateIndex
CREATE INDEX "SecurityIncident_assignedToPlatformAdminId_status_idx" ON "SecurityIncident"("assignedToPlatformAdminId", "status");

-- CreateIndex
CREATE INDEX "SecurityIncidentActivity_incidentId_createdAt_idx" ON "SecurityIncidentActivity"("incidentId", "createdAt");

-- AddForeignKey
ALTER TABLE "SecurityIncident" ADD CONSTRAINT "SecurityIncident_assignedToPlatformAdminId_fkey" FOREIGN KEY ("assignedToPlatformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityIncident" ADD CONSTRAINT "SecurityIncident_acknowledgedByPlatformAdminId_fkey" FOREIGN KEY ("acknowledgedByPlatformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityIncident" ADD CONSTRAINT "SecurityIncident_containedByPlatformAdminId_fkey" FOREIGN KEY ("containedByPlatformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityIncident" ADD CONSTRAINT "SecurityIncident_resolvedByPlatformAdminId_fkey" FOREIGN KEY ("resolvedByPlatformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityIncident" ADD CONSTRAINT "SecurityIncident_closedByPlatformAdminId_fkey" FOREIGN KEY ("closedByPlatformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityIncidentActivity" ADD CONSTRAINT "SecurityIncidentActivity_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "SecurityIncident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityIncidentActivity" ADD CONSTRAINT "SecurityIncidentActivity_actorPlatformAdminId_fkey" FOREIGN KEY ("actorPlatformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
