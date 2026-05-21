-- Sprint 13: Operational Monitoring — AuditLog + OperationalEvent

CREATE TABLE "AuditLog" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId"       TEXT,
    "actorUserId"    TEXT,
    "actorRole"      TEXT,
    "action"         TEXT NOT NULL,
    "entityType"     TEXT NOT NULL,
    "entityId"       TEXT,
    "description"    TEXT,
    "metadata"       JSONB,
    "ipAddress"      TEXT,
    "userAgent"      TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationalEvent" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId"       TEXT,
    "severity"       TEXT NOT NULL DEFAULT 'info',
    "source"         TEXT NOT NULL,
    "message"        TEXT NOT NULL,
    "metadata"       JSONB,
    "resolvedAt"     TIMESTAMP(3),
    "resolvedById"   TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationalEvent_pkey" PRIMARY KEY ("id")
);

-- AuditLog indexes
CREATE INDEX "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");
CREATE INDEX "AuditLog_clinicId_idx" ON "AuditLog"("clinicId");
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- OperationalEvent indexes
CREATE INDEX "OperationalEvent_organizationId_severity_idx" ON "OperationalEvent"("organizationId", "severity");
CREATE INDEX "OperationalEvent_organizationId_source_idx" ON "OperationalEvent"("organizationId", "source");
CREATE INDEX "OperationalEvent_organizationId_resolvedAt_idx" ON "OperationalEvent"("organizationId", "resolvedAt");
CREATE INDEX "OperationalEvent_createdAt_idx" ON "OperationalEvent"("createdAt");
