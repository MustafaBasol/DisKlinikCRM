-- FILE-BACKUP-COVERAGE-001: off-host replication ledger for filesystem-backed
-- clinical artifacts (patient attachments, lab-order attachments, imaging
-- images). Purely additive — no existing table, column, constraint, or index
-- is altered, dropped, or renamed. Does NOT touch PatientAttachment,
-- LabOrderAttachment, ImagingImage, or ImagingStudy, and does not rename or
-- move any existing fileStorage.ts storage key. Hand-authored (not `prisma
-- migrate dev` auto-diff output), per this repo's existing convention.
--
-- See docs/program/evidence/FILE_BACKUP_COVERAGE_001.md for the scope
-- decision and its relationship to the KVKK architecture freeze boundary
-- (docs/program/KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md row 18).

-- CreateTable
CREATE TABLE "FileBackupRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "trigger" TEXT NOT NULL DEFAULT 'scheduled',
    "filesScanned" INTEGER NOT NULL DEFAULT 0,
    "filesCopied" INTEGER NOT NULL DEFAULT 0,
    "filesVerified" INTEGER NOT NULL DEFAULT 0,
    "filesSkipped" INTEGER NOT NULL DEFAULT 0,
    "filesFailed" INTEGER NOT NULL DEFAULT 0,
    "filesMissing" INTEGER NOT NULL DEFAULT 0,
    "bytesCopied" BIGINT NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "manifestKey" TEXT,

    CONSTRAINT "FileBackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileBackupEntry" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceModel" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "destinationKey" TEXT NOT NULL,
    "sourceChecksumSha256" TEXT,
    "destinationChecksumSha256" TEXT,
    "sourceSizeBytes" INTEGER,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "copiedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileBackupEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FileBackupRun_status_startedAt_idx" ON "FileBackupRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "FileBackupEntry_runId_status_idx" ON "FileBackupEntry"("runId", "status");

-- CreateIndex
CREATE INDEX "FileBackupEntry_clinicId_idx" ON "FileBackupEntry"("clinicId");

-- CreateIndex
CREATE INDEX "FileBackupEntry_sourceModel_sourceRecordId_idx" ON "FileBackupEntry"("sourceModel", "sourceRecordId");

-- AddForeignKey
ALTER TABLE "FileBackupEntry" ADD CONSTRAINT "FileBackupEntry_runId_fkey" FOREIGN KEY ("runId") REFERENCES "FileBackupRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
