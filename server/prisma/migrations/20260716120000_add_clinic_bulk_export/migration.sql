-- KVKK-HIGH-004: secure clinic bulk/structured-data export
-- ClinicBulkExportArchive, ClinicBulkExportPasswordAttempt, OperationalEvent.dedupeKey

-- AlterTable
ALTER TABLE "OperationalEvent" ADD COLUMN     "dedupeKey" TEXT;

-- CreateTable
CREATE TABLE "ClinicBulkExportArchive" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "purpose" TEXT NOT NULL,
    "restrictedNote" TEXT,
    "exportSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "storageKey" TEXT,
    "manifestJson" JSONB,
    "downloadTokenHash" TEXT,
    "stepUpVerifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "downloadedAt" TIMESTAMP(3),
    "artifactDeletedAt" TIMESTAMP(3),
    "cleanupFailureCode" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicBulkExportArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicBulkExportPasswordAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicBulkExportPasswordAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClinicBulkExportArchive_downloadTokenHash_key" ON "ClinicBulkExportArchive"("downloadTokenHash");

-- CreateIndex
CREATE INDEX "ClinicBulkExportArchive_organizationId_clinicId_idx" ON "ClinicBulkExportArchive"("organizationId", "clinicId");

-- CreateIndex
CREATE INDEX "ClinicBulkExportArchive_clinicId_status_idx" ON "ClinicBulkExportArchive"("clinicId", "status");

-- CreateIndex
CREATE INDEX "ClinicBulkExportArchive_requestedByUserId_createdAt_idx" ON "ClinicBulkExportArchive"("requestedByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ClinicBulkExportArchive_expiresAt_idx" ON "ClinicBulkExportArchive"("expiresAt");

-- CreateIndex
CREATE INDEX "ClinicBulkExportArchive_leaseExpiresAt_idx" ON "ClinicBulkExportArchive"("leaseExpiresAt");

-- CreateIndex
CREATE INDEX "ClinicBulkExportArchive_clinicId_status_leaseExpiresAt_idx" ON "ClinicBulkExportArchive"("clinicId", "status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "ClinicBulkExportPasswordAttempt_updatedAt_idx" ON "ClinicBulkExportPasswordAttempt"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicBulkExportPasswordAttempt_userId_clinicId_ipHash_key" ON "ClinicBulkExportPasswordAttempt"("userId", "clinicId", "ipHash");

-- CreateIndex
CREATE UNIQUE INDEX "OperationalEvent_dedupeKey_key" ON "OperationalEvent"("dedupeKey");

-- AddForeignKey
ALTER TABLE "ClinicBulkExportArchive" ADD CONSTRAINT "ClinicBulkExportArchive_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicBulkExportArchive" ADD CONSTRAINT "ClinicBulkExportArchive_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicBulkExportPasswordAttempt" ADD CONSTRAINT "ClinicBulkExportPasswordAttempt_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Final invariant for "exactly one queued/generating export per clinic".
--
-- This is deliberately hand-written raw SQL: Prisma schema syntax has no
-- first-class way to declare a partial (WHERE-qualified) unique index
-- without an unstable preview feature, so it cannot be expressed directly
-- in schema.prisma. The application-level advisory-lock reservation
-- transaction (see clinicBulkExportPackage.ts, key namespace
-- "clinic-bulk-export-slot:<clinicId>") is the primary enforcement path;
-- this index is the last-resort invariant enforced by the database itself
-- even if the advisory lock is ever bypassed or misused. A violating insert
-- surfaces to the application as a Postgres unique-violation (Prisma
-- error P2002), mapped to 409 CLINIC_BULK_EXPORT_ALREADY_RUNNING.
--
-- Validated against a completely fresh disposable Postgres database via
-- `prisma migrate deploy` + `prisma migrate status` (no drift reported) —
-- see docs/compliance/54-kvkk-secure-clinic-bulk-export.md for the exact
-- commands used. Because this predicate is not representable in
-- schema.prisma, `prisma format`/`prisma generate` will never attempt to
-- regenerate or drop it; do not "fix" apparent drift here by editing this
-- migration file after the fact.
CREATE UNIQUE INDEX "ClinicBulkExportArchive_one_active_per_clinic"
ON "ClinicBulkExportArchive" ("clinicId")
WHERE status IN ('queued', 'generating');
