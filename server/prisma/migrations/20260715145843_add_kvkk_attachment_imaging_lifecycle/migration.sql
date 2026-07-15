-- DropForeignKey
ALTER TABLE "ImagingStudy" DROP CONSTRAINT "ImagingStudy_createdById_fkey";

-- DropForeignKey
ALTER TABLE "WhatsAppConversationMessage" DROP CONSTRAINT "WhatsAppConversationMessage_patientId_fkey";

-- DropIndex
DROP INDEX "User_organizationId_email_key";

-- AlterTable
ALTER TABLE "Clinic" ALTER COLUMN "status" SET DEFAULT 'trial';

-- AlterTable
ALTER TABLE "ClinicInstagramConnection" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ClinicLegalProfile" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ImagingImage" ADD COLUMN     "storageVerifiedMissingAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ImagingStudy" ADD COLUMN     "legalHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "legalHoldReason" TEXT;

-- AlterTable
ALTER TABLE "InstagramConnection" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InstagramInboxEntry" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Organization" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PatientAttachment" ADD COLUMN     "legalHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "legalHoldReason" TEXT,
ADD COLUMN     "storageVerifiedMissingAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Plan" ALTER COLUMN "features" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PlatformAdmin" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "UserClinic" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "WhatsAppConnection" ALTER COLUMN "metaTokenExpiresAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "metaTokenLastCheckedAt" SET DATA TYPE TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PatientPrivacyExportArchive" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "manifestJson" JSONB NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
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
CREATE INDEX "ImagingStudy_clinicId_legalHold_idx" ON "ImagingStudy"("clinicId", "legalHold");

-- CreateIndex
CREATE INDEX "PatientAttachment_clinicId_legalHold_idx" ON "PatientAttachment"("clinicId", "legalHold");

-- AddForeignKey
ALTER TABLE "WhatsAppConversationMessage" ADD CONSTRAINT "WhatsAppConversationMessage_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingStudy" ADD CONSTRAINT "ImagingStudy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPrivacyExportArchive" ADD CONSTRAINT "PatientPrivacyExportArchive_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPrivacyExportArchive" ADD CONSTRAINT "PatientPrivacyExportArchive_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "InstagramConversationMessage_organizationId_externalMessageId_k" RENAME TO "InstagramConversationMessage_organizationId_externalMessage_key";

-- RenameIndex
ALTER INDEX "InstagramConversationMessage_organizationId_externalSenderId_cr" RENAME TO "InstagramConversationMessage_organizationId_externalSenderI_idx";

-- RenameIndex
ALTER INDEX "MessagingInboundEvent_channel_provider_connectionId_providerMes" RENAME TO "MessagingInboundEvent_channel_provider_connectionId_provide_key";

-- RenameIndex
ALTER INDEX "PostTreatmentMessageQueue_patientId_templateId_appointmentId_tr" RENAME TO "PostTreatmentMessageQueue_patientId_templateId_appointmentI_key";
