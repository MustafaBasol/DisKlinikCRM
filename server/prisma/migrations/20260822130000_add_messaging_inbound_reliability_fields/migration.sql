-- F5-3 — messaging inbound reliability fields (repository phase F6).
--
-- STRICTLY ADDITIVE. Six nullable/defaulted columns and one index on the
-- existing MessagingInboundEvent ledger. No column is altered, renamed or
-- dropped, and no existing row is rewritten.
--
-- BACKWARD COMPATIBILITY: the previous application version selects named
-- columns and never sees these, so it keeps working unchanged against a
-- migrated database. `nextAttemptAt` is NULL on every existing row, which is
-- deliberately the same meaning the pre-F5-3 retry job already had ("eligible
-- once the minimum-age floor has passed") — so a database migrated ahead of
-- the application behaves exactly as it does today.
--
-- ROLLBACK: revert the application. Do NOT drop these columns — `status =
-- 'dead'` rows written while the new version was live would silently become
-- indistinguishable from retryable ones, and the replay audit trail would be
-- destroyed. Dropping them is a separate planned migration, never an
-- emergency action.

-- AlterTable
ALTER TABLE "MessagingInboundEvent" ADD COLUMN     "deadLetteredAt" TIMESTAMP(3),
ADD COLUMN     "lastErrorCode" TEXT,
ADD COLUMN     "lastReplayedAt" TIMESTAMP(3),
ADD COLUMN     "lastReplayedBy" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "replayCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "MessagingInboundEvent_status_nextAttemptAt_idx" ON "MessagingInboundEvent"("status", "nextAttemptAt");
