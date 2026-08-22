-- F5-2 — Transactional outbox foundation (ADR-006 / repository phase F6).
--
-- STRICTLY ADDITIVE. Two new tables and their indexes; nothing existing is
-- altered, renamed or dropped. An application version that predates this
-- migration ignores both tables entirely and keeps working — the producer is
-- feature-flagged off by default and the dispatcher is not scheduled unless
-- explicitly enabled, so deploying this migration ahead of the application is
-- safe and is the documented rollout order.
--
-- ROLLBACK: do NOT drop these tables during an emergency rollback. Disable the
-- producer flag, drain/stop the dispatcher, revert the application. The tables
-- are inert without a running dispatcher, and dropping them would destroy
-- undelivered obligations. Removal, if ever wanted, is a separate planned
-- migration once the tables are provably empty.

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "eventType" TEXT NOT NULL,
    "eventVersion" INTEGER NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "correlationId" TEXT,
    "causationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "deadLetteredAt" TIMESTAMP(3),
    "deadLetterCode" TEXT,
    "replayCount" INTEGER NOT NULL DEFAULT 0,
    "lastReplayedAt" TIMESTAMP(3),
    "lastReplayedBy" TEXT,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxConsumerExecution" (
    "id" TEXT NOT NULL,
    "consumerKey" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "status" TEXT NOT NULL,
    "executedBy" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "outcomeCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxConsumerExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_dedupeKey_key" ON "OutboxEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_availableAt_occurredAt_idx" ON "OutboxEvent"("status", "availableAt", "occurredAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_leaseExpiresAt_idx" ON "OutboxEvent"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_organizationId_status_occurredAt_idx" ON "OutboxEvent"("organizationId", "status", "occurredAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_clinicId_status_occurredAt_idx" ON "OutboxEvent"("clinicId", "status", "occurredAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_eventType_eventVersion_status_idx" ON "OutboxEvent"("eventType", "eventVersion", "status");

-- CreateIndex
CREATE INDEX "OutboxEvent_idempotencyKey_idx" ON "OutboxEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OutboxConsumerExecution_organizationId_status_idx" ON "OutboxConsumerExecution"("organizationId", "status");

-- CreateIndex
CREATE INDEX "OutboxConsumerExecution_status_leaseExpiresAt_idx" ON "OutboxConsumerExecution"("status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxConsumerExecution_consumerKey_idempotencyKey_key" ON "OutboxConsumerExecution"("consumerKey", "idempotencyKey");
