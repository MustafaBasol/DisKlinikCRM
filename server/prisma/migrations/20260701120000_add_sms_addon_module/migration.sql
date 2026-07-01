-- SMS Add-on Module: clinic-level activation, quota tracking, queue/history

-- Patient SMS opt-out (KVKK/GDPR foundation for STOP/RET/IPTAL/UNSUBSCRIBE)
ALTER TABLE "Patient" ADD COLUMN "smsOptOut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Patient" ADD COLUMN "smsOptOutAt" TIMESTAMP(3);

CREATE TABLE "ClinicSmsSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "addonEnabled" BOOLEAN NOT NULL DEFAULT false,
    "monthlyQuota" INTEGER NOT NULL DEFAULT 0,
    "senderName" TEXT,
    "turkeyProvider" TEXT,
    "turkeyProviderConfig" JSONB,
    "europeProvider" TEXT,
    "europeProviderConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClinicSmsSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClinicSmsSettings_clinicId_key" ON "ClinicSmsSettings"("clinicId");
CREATE INDEX "ClinicSmsSettings_organizationId_idx" ON "ClinicSmsSettings"("organizationId");

ALTER TABLE "ClinicSmsSettings" ADD CONSTRAINT "ClinicSmsSettings_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT,
    "appointmentId" TEXT,
    "templateId" TEXT,
    "purpose" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "providerRegion" TEXT,
    "provider" TEXT,
    "externalMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "dedupeKey" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmsMessage_dedupeKey_key" ON "SmsMessage"("dedupeKey");
CREATE INDEX "SmsMessage_clinicId_status_createdAt_idx" ON "SmsMessage"("clinicId", "status", "createdAt");
CREATE INDEX "SmsMessage_clinicId_patientId_idx" ON "SmsMessage"("clinicId", "patientId");
CREATE INDEX "SmsMessage_organizationId_idx" ON "SmsMessage"("organizationId");

ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SmsUsageCounter" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SmsUsageCounter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmsUsageCounter_clinicId_period_key" ON "SmsUsageCounter"("clinicId", "period");

ALTER TABLE "SmsUsageCounter" ADD CONSTRAINT "SmsUsageCounter_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
