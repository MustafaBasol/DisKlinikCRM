-- KVKK-HIGH-008-F1 (external-review correction pass): dedicated, durable
-- audit trail for Platform Admin configuration changes (e.g. PlatformSetting
-- toggles). Purely additive — no existing table, column, constraint, or
-- index is altered, dropped, or renamed. Hand-authored (not `prisma migrate
-- dev` auto-diff output) to exclude unrelated pre-existing schema drift, per
-- the same convention as prior migrations in this repo.
--
-- Deliberately a separate table from SecuritySignalEvent: that table is
-- security-detection telemetry aggregated by securityDetectionRules.ts, and
-- a platform-admin configuration change is not a security detection signal.

-- CreateTable
CREATE TABLE "PlatformAdminAuditEvent" (
    "id" TEXT NOT NULL,
    "actorPlatformAdminId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceKey" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "outcome" TEXT NOT NULL,
    "safeMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAdminAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformAdminAuditEvent_actorPlatformAdminId_createdAt_idx" ON "PlatformAdminAuditEvent"("actorPlatformAdminId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformAdminAuditEvent_action_createdAt_idx" ON "PlatformAdminAuditEvent"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "PlatformAdminAuditEvent" ADD CONSTRAINT "PlatformAdminAuditEvent_actorPlatformAdminId_fkey" FOREIGN KEY ("actorPlatformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
