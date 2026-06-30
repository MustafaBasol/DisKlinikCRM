CREATE TABLE "ChannelConsentLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "contactIdentifier" TEXT NOT NULL,
    "conversationId" TEXT,
    "sourceMessageId" TEXT,
    "consentStatus" TEXT NOT NULL,
    "consentTextVersion" TEXT NOT NULL,
    "consentTextSnapshot" TEXT NOT NULL,
    "privacyUrl" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'tr',
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChannelConsentLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChannelConsentLog_clinicId_channel_contactIdentifier_idx" ON "ChannelConsentLog"("clinicId", "channel", "contactIdentifier");
CREATE INDEX "ChannelConsentLog_clinicId_consentTextVersion_idx" ON "ChannelConsentLog"("clinicId", "consentTextVersion");
CREATE INDEX "ChannelConsentLog_organizationId_idx" ON "ChannelConsentLog"("organizationId");

ALTER TABLE "ChannelConsentLog" ADD CONSTRAINT "ChannelConsentLog_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
