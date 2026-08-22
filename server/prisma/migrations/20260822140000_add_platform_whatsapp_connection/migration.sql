-- F3-WA-META-COEX-002B — platform-owned Meta Cloud API WhatsApp connection.
--
-- STRICTLY ADDITIVE. One new table, no ALTER of any existing table, no
-- backfill, no data migration. WhatsAppConnection / ClinicWhatsAppConnection
-- and every existing tenant WhatsApp route/row are untouched.
--
-- The "singleton" column's UNIQUE index is the DB-level guarantee that at
-- most one row can ever exist here (it is always TRUE, and Postgres treats
-- repeated non-NULL values in a unique index as a violation) — this is
-- enforced even under a concurrent create race, not just by application code.
--
-- BACKWARD COMPATIBILITY: the previous application version never queries
-- this table, so it keeps working unchanged against a migrated database.
--
-- ROLLBACK: revert the application code. Do NOT drop this table as part of
-- an emergency rollback — it is inert and unused by any pre-existing code
-- path, so leaving it in place is always safe. Physical DROP TABLE is only a
-- later, separately-controlled contract cleanup if the feature is ever
-- retired outright.

-- CreateTable
CREATE TABLE "PlatformWhatsAppConnection" (
    "id" TEXT NOT NULL,
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'meta_cloud_api',
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "phoneNumber" TEXT,
    "displayName" TEXT,
    "metaBusinessId" TEXT,
    "metaWabaId" TEXT,
    "metaPhoneNumberId" TEXT,
    "metaAppId" TEXT,
    "metaAccessTokenEncrypted" TEXT,
    "metaWebhookVerifyToken" TEXT,
    "metaWebhookSecret" TEXT,
    "metaTokenStatus" TEXT DEFAULT 'unknown',
    "metaTokenExpiresAt" TIMESTAMP(3),
    "metaTokenLastCheckedAt" TIMESTAMP(3),
    "webhookSecret" TEXT,
    "lastConnectedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformWhatsAppConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformWhatsAppConnection_singleton_key" ON "PlatformWhatsAppConnection"("singleton");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformWhatsAppConnection_metaPhoneNumberId_key" ON "PlatformWhatsAppConnection"("metaPhoneNumberId");

-- CreateIndex
CREATE INDEX "PlatformWhatsAppConnection_provider_idx" ON "PlatformWhatsAppConnection"("provider");
