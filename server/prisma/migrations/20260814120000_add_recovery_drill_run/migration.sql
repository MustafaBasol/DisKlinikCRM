-- F4-FCR-001: durable RPO/RTO evidence trail for recovery drills (database
-- restore tests and file restore rehearsals). Purely additive — no existing
-- table, column, constraint, or index is altered, dropped, or renamed. Does
-- NOT touch FileBackupRun/FileBackupEntry or any tenant-scoped model.
-- Hand-authored (not `prisma migrate dev` auto-diff output), per this repo's
-- existing convention (see 20260728120000_add_file_backup_coverage).
--
-- "residualArtifact" intentionally stores a non-sensitive, operator-actionable
-- label such as a leaked scratch database name
-- (e.g. noramedi_restore_test_1723545600000_ab12cd34). That value carries no
-- PHI, no patient/clinic identifier and no secret, and an operator needs it
-- verbatim to clean up by hand.

-- CreateTable
CREATE TABLE "RecoveryDrillRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'scheduled',
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "sourceArtifactAt" TIMESTAMP(3),
    "sourceArtifactAgeMinutes" INTEGER,
    "samplesAttempted" INTEGER NOT NULL DEFAULT 0,
    "samplesPassed" INTEGER NOT NULL DEFAULT 0,
    "samplesFailed" INTEGER NOT NULL DEFAULT 0,
    "cleanupVerified" BOOLEAN NOT NULL DEFAULT false,
    "residualArtifact" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryDrillRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecoveryDrillRun_kind_startedAt_idx" ON "RecoveryDrillRun"("kind", "startedAt");

-- CreateIndex
CREATE INDEX "RecoveryDrillRun_status_startedAt_idx" ON "RecoveryDrillRun"("status", "startedAt");
