-- CreateTable
CREATE TABLE "PatientCommunicationPreference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "evidenceType" TEXT,
    "noticeVersion" TEXT,
    "policyVersion" TEXT,
    "actorUserId" TEXT,
    "actorPlatformAdminId" TEXT,
    "requestIpHash" TEXT,
    "userAgentHash" TEXT,
    "externalProviderRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientCommunicationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientCommunicationConsentEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "preferenceId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "previousStatus" TEXT,
    "newStatus" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "evidenceType" TEXT,
    "noticeVersion" TEXT,
    "policyVersion" TEXT,
    "actorUserId" TEXT,
    "actorPlatformAdminId" TEXT,
    "requestIpHash" TEXT,
    "userAgentHash" TEXT,
    "externalProviderRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientCommunicationConsentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientCommunicationPreference_clinicId_channel_purpose_sta_idx" ON "PatientCommunicationPreference"("clinicId", "channel", "purpose", "status");

-- CreateIndex
CREATE INDEX "PatientCommunicationPreference_organizationId_idx" ON "PatientCommunicationPreference"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientCommunicationPreference_patientId_clinicId_channel_p_key" ON "PatientCommunicationPreference"("patientId", "clinicId", "channel", "purpose");

-- CreateIndex
CREATE INDEX "PatientCommunicationConsentEvent_patientId_clinicId_channel_idx" ON "PatientCommunicationConsentEvent"("patientId", "clinicId", "channel", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "PatientCommunicationConsentEvent_clinicId_createdAt_idx" ON "PatientCommunicationConsentEvent"("clinicId", "createdAt");

-- CreateIndex
CREATE INDEX "PatientCommunicationConsentEvent_organizationId_idx" ON "PatientCommunicationConsentEvent"("organizationId");

-- AddForeignKey
ALTER TABLE "PatientCommunicationPreference" ADD CONSTRAINT "PatientCommunicationPreference_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCommunicationPreference" ADD CONSTRAINT "PatientCommunicationPreference_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCommunicationConsentEvent" ADD CONSTRAINT "PatientCommunicationConsentEvent_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCommunicationConsentEvent" ADD CONSTRAINT "PatientCommunicationConsentEvent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCommunicationConsentEvent" ADD CONSTRAINT "PatientCommunicationConsentEvent_preferenceId_fkey" FOREIGN KEY ("preferenceId") REFERENCES "PatientCommunicationPreference"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
