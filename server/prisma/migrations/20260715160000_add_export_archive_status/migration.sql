-- PR #160 review remediation (docs/compliance/53): adds a lifecycle
-- "status" column to PatientPrivacyExportArchive so a per-clinic export
-- generation can be marked "generating" BEFORE the (potentially slow) ZIP
-- build starts, letting a concurrent request be rejected with 409 instead
-- of racing. storageKey/manifestJson/tokenHash/expiresAt are relaxed to
-- nullable because they are only known once generation completes. Contains
-- ONLY the statements for this additive schema.prisma change — no unrelated
-- drift.

-- AlterTable
ALTER TABLE "PatientPrivacyExportArchive" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ready',
ALTER COLUMN "storageKey" DROP NOT NULL,
ALTER COLUMN "manifestJson" DROP NOT NULL,
ALTER COLUMN "tokenHash" DROP NOT NULL,
ALTER COLUMN "expiresAt" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "PatientPrivacyExportArchive_clinicId_status_idx" ON "PatientPrivacyExportArchive"("clinicId", "status");
