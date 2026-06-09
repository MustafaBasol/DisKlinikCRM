CREATE TABLE "MessagingInboundEvent" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "connectionId" TEXT,
    "clinicId" TEXT,
    "organizationId" TEXT,
    "providerMessageId" TEXT NOT NULL,
    "providerConversationId" TEXT,
    "fromExternalId" TEXT,
    "toExternalId" TEXT,
    "fromPhone" TEXT,
    "toPhone" TEXT,
    "eventType" TEXT NOT NULL DEFAULT 'message',
    "direction" TEXT NOT NULL DEFAULT 'inbound',
    "status" TEXT NOT NULL DEFAULT 'received',
    "rawPayload" JSONB,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessagingInboundEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessagingInboundEvent_channel_provider_connectionId_providerMessageId_key"
ON "MessagingInboundEvent"("channel", "provider", "connectionId", "providerMessageId");

CREATE INDEX "MessagingInboundEvent_organizationId_status_createdAt_idx"
ON "MessagingInboundEvent"("organizationId", "status", "createdAt");

CREATE INDEX "MessagingInboundEvent_clinicId_status_createdAt_idx"
ON "MessagingInboundEvent"("clinicId", "status", "createdAt");

CREATE INDEX "MessagingInboundEvent_channel_provider_providerMessageId_idx"
ON "MessagingInboundEvent"("channel", "provider", "providerMessageId");
