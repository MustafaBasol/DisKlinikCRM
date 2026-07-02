-- Platform-level SMS provider configuration (managed by platform admin only).
-- Credentials are stored encrypted (encryptJson) and never returned by the API.

CREATE TABLE "PlatformSmsProvider" (
    "id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "senderName" TEXT,
    "credentials" JSONB,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastTestError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformSmsProvider_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformSmsProvider_region_providerCode_key" ON "PlatformSmsProvider"("region", "providerCode");
CREATE INDEX "PlatformSmsProvider_region_isActive_isDefault_idx" ON "PlatformSmsProvider"("region", "isActive", "isDefault");
