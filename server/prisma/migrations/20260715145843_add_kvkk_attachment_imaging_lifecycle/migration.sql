-- KVKK attachment/imaging lifecycle (docs/compliance/53). Contains ONLY the
-- statements required by the additive schema.prisma changes for this
-- feature: legal-hold + storage-verified-missing fields on PatientAttachment
-- / ImagingStudy / ImagingImage, and the new PatientPrivacyExportArchive
-- table (including its "status" lifecycle column — queued/generating/ready/
-- failed — and the nullable artifact columns that are only populated once
-- generation completes). No unrelated drift (dropped/renamed indexes,
-- changed column defaults/types on other tables, or FK drop/recreate) is
-- included.

-- AlterTable
ALTER TABLE "ImagingImage" ADD COLUMN     "storageVerifiedMissingAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ImagingStudy" ADD COLUMN     "legalHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "legalHoldReason" TEXT;

-- AlterTable
ALTER TABLE "PatientAttachment" ADD COLUMN     "legalHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "legalHoldReason" TEXT,
ADD COLUMN     "storageVerifiedMissingAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PatientPrivacyExportArchive" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "storageKey" TEXT,
    "manifestJson" JSONB,
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "downloadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientPrivacyExportArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatientPrivacyExportArchive_tokenHash_key" ON "PatientPrivacyExportArchive"("tokenHash");

-- CreateIndex
CREATE INDEX "PatientPrivacyExportArchive_clinicId_patientId_idx" ON "PatientPrivacyExportArchive"("clinicId", "patientId");

-- CreateIndex
CREATE INDEX "PatientPrivacyExportArchive_organizationId_idx" ON "PatientPrivacyExportArchive"("organizationId");

-- CreateIndex
CREATE INDEX "PatientPrivacyExportArchive_expiresAt_idx" ON "PatientPrivacyExportArchive"("expiresAt");

-- CreateIndex
CREATE INDEX "PatientPrivacyExportArchive_clinicId_status_idx" ON "PatientPrivacyExportArchive"("clinicId", "status");

-- CreateIndex
CREATE INDEX "ImagingStudy_clinicId_legalHold_idx" ON "ImagingStudy"("clinicId", "legalHold");

-- CreateIndex
CREATE INDEX "PatientAttachment_clinicId_legalHold_idx" ON "PatientAttachment"("clinicId", "legalHold");

-- AddForeignKey
ALTER TABLE "PatientPrivacyExportArchive" ADD CONSTRAINT "PatientPrivacyExportArchive_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPrivacyExportArchive" ADD CONSTRAINT "PatientPrivacyExportArchive_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
