-- Migration: add_inbound_event_retry_support
-- Faz 2 (docs/45 #6): failed webhook event'leri için retry job desteği.
-- attempts: retry sayacı; status+updatedAt indeksi retry job'un tarama sorgusu için.

ALTER TABLE "MessagingInboundEvent" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "MessagingInboundEvent_status_updatedAt_idx" ON "MessagingInboundEvent"("status", "updatedAt");
