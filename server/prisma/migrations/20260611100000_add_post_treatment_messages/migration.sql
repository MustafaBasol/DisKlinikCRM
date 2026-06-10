-- CreateTable: PostTreatmentMessageTemplate
CREATE TABLE "PostTreatmentMessageTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "serviceId" TEXT,
    "treatmentPackageId" TEXT,
    "messageBody" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'preferred',
    "sendDelayMinutes" INTEGER NOT NULL DEFAULT 0,
    "requireStaffApproval" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostTreatmentMessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PostTreatmentMessageQueue
CREATE TABLE "PostTreatmentMessageQueue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "treatmentCaseId" TEXT,
    "treatmentProcedureId" TEXT,
    "treatmentPackageApplicationId" TEXT,
    "serviceId" TEXT,
    "packageId" TEXT,
    "channel" TEXT NOT NULL,
    "recipient" TEXT,
    "messageBodyRendered" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "sourceType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostTreatmentMessageQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostTreatmentMessageTemplate_clinicId_isActive_idx" ON "PostTreatmentMessageTemplate"("clinicId", "isActive");
CREATE INDEX "PostTreatmentMessageTemplate_clinicId_serviceId_idx" ON "PostTreatmentMessageTemplate"("clinicId", "serviceId");
CREATE INDEX "PostTreatmentMessageTemplate_clinicId_treatmentPackageId_idx" ON "PostTreatmentMessageTemplate"("clinicId", "treatmentPackageId");

CREATE UNIQUE INDEX "PostTreatmentMessageQueue_patientId_templateId_appointmentId_treatmentProcedureId_key"
    ON "PostTreatmentMessageQueue"("patientId", "templateId", "appointmentId", "treatmentProcedureId");
CREATE INDEX "PostTreatmentMessageQueue_clinicId_status_scheduledAt_idx" ON "PostTreatmentMessageQueue"("clinicId", "status", "scheduledAt");
CREATE INDEX "PostTreatmentMessageQueue_clinicId_patientId_idx" ON "PostTreatmentMessageQueue"("clinicId", "patientId");
CREATE INDEX "PostTreatmentMessageQueue_templateId_idx" ON "PostTreatmentMessageQueue"("templateId");

-- AddForeignKey
ALTER TABLE "PostTreatmentMessageTemplate" ADD CONSTRAINT "PostTreatmentMessageTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PostTreatmentMessageTemplate" ADD CONSTRAINT "PostTreatmentMessageTemplate_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PostTreatmentMessageTemplate" ADD CONSTRAINT "PostTreatmentMessageTemplate_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "AppointmentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PostTreatmentMessageTemplate" ADD CONSTRAINT "PostTreatmentMessageTemplate_treatmentPackageId_fkey" FOREIGN KEY ("treatmentPackageId") REFERENCES "TreatmentPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PostTreatmentMessageQueue" ADD CONSTRAINT "PostTreatmentMessageQueue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PostTreatmentMessageQueue" ADD CONSTRAINT "PostTreatmentMessageQueue_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PostTreatmentMessageQueue" ADD CONSTRAINT "PostTreatmentMessageQueue_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PostTreatmentMessageQueue" ADD CONSTRAINT "PostTreatmentMessageQueue_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PostTreatmentMessageTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PostTreatmentMessageQueue" ADD CONSTRAINT "PostTreatmentMessageQueue_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "AppointmentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PostTreatmentMessageQueue" ADD CONSTRAINT "PostTreatmentMessageQueue_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "TreatmentPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
