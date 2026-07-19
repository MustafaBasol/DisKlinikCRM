-- KVKK-HIGH-007 follow-up: legacy/central consent reconciliation.
-- Purely additive — no existing table, column, or constraint is altered.

-- CreateTable
CREATE TABLE "CommunicationConsentConflictBucket" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "bucketStartedAt" TIMESTAMP(3) NOT NULL,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationConsentConflictBucket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommunicationConsentConflictBucket_organizationId_clinicId__idx" ON "CommunicationConsentConflictBucket"("organizationId", "clinicId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunicationConsentConflictBucket_bucketStartedAt_idx" ON "CommunicationConsentConflictBucket"("bucketStartedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationConsentConflictBucket_organizationId_clinicId__key" ON "CommunicationConsentConflictBucket"("organizationId", "clinicId", "channel", "purpose", "reasonCode", "bucketStartedAt");

-- CreateIndex
CREATE INDEX "OperationalEvent_source_organizationId_clinicId_createdAt_idx" ON "OperationalEvent"("source", "organizationId", "clinicId", "createdAt");
