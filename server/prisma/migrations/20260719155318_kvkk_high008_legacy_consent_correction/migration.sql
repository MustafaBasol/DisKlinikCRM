-- KVKK-HIGH-008: legacy consent correction workflow.
-- Purely additive — no existing table, column, constraint, or index is
-- altered, dropped, or renamed. Hand-authored (not `prisma migrate dev`
-- auto-diff output) to exclude unrelated pre-existing schema drift that the
-- diff tool would otherwise have bundled in (FK drop/recreate on
-- ImagingStudy/WhatsAppConversationMessage, an unrelated User unique-index
-- drop, several @updatedAt default drops, a WhatsAppConnection column type
-- change) — none of that belongs to this change and none of it is applied
-- here.

-- CreateEnum
CREATE TYPE "PatientLegacyConsentField" AS ENUM ('SMS_OPT_OUT');

-- CreateTable
CREATE TABLE "PatientLegacyConsentCorrection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "fieldName" "PatientLegacyConsentField" NOT NULL,
    "previousValue" BOOLEAN NOT NULL,
    "newValue" BOOLEAN NOT NULL,
    "previousRecordedAt" TIMESTAMP(3),
    "correctionReason" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "sourceReference" TEXT,
    "notes" TEXT NOT NULL,
    "correctedById" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientLegacyConsentCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientLegacyConsentCorrection_patientId_createdAt_idx" ON "PatientLegacyConsentCorrection"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "PatientLegacyConsentCorrection_organizationId_clinicId_crea_idx" ON "PatientLegacyConsentCorrection"("organizationId", "clinicId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PatientLegacyConsentCorrection_organizationId_patientId_ide_key" ON "PatientLegacyConsentCorrection"("organizationId", "patientId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "PatientLegacyConsentCorrection" ADD CONSTRAINT "PatientLegacyConsentCorrection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientLegacyConsentCorrection" ADD CONSTRAINT "PatientLegacyConsentCorrection_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientLegacyConsentCorrection" ADD CONSTRAINT "PatientLegacyConsentCorrection_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientLegacyConsentCorrection" ADD CONSTRAINT "PatientLegacyConsentCorrection_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
