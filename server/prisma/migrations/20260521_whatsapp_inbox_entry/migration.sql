-- CreateTable
CREATE TABLE "WhatsAppInboxEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "whatsappConnectionId" TEXT,
    "clinicId" TEXT,
    "patientId" TEXT,
    "resolvedByUserId" TEXT,
    "phone" TEXT NOT NULL,
    "displayName" TEXT,
    "lastMessageText" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 1,
    "externalMessageId" TEXT,
    "rawPayload" JSONB,
    "needsClinicResolution" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppInboxEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppInboxEntry_organizationId_needsClinicResolution_idx" ON "WhatsAppInboxEntry"("organizationId", "needsClinicResolution");

-- CreateIndex
CREATE INDEX "WhatsAppInboxEntry_organizationId_status_idx" ON "WhatsAppInboxEntry"("organizationId", "status");

-- CreateIndex
CREATE INDEX "WhatsAppInboxEntry_organizationId_clinicId_idx" ON "WhatsAppInboxEntry"("organizationId", "clinicId");

-- CreateIndex
CREATE INDEX "WhatsAppInboxEntry_whatsappConnectionId_phone_idx" ON "WhatsAppInboxEntry"("whatsappConnectionId", "phone");

-- AddForeignKey
ALTER TABLE "WhatsAppInboxEntry" ADD CONSTRAINT "WhatsAppInboxEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppInboxEntry" ADD CONSTRAINT "WhatsAppInboxEntry_whatsappConnectionId_fkey" FOREIGN KEY ("whatsappConnectionId") REFERENCES "WhatsAppConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppInboxEntry" ADD CONSTRAINT "WhatsAppInboxEntry_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppInboxEntry" ADD CONSTRAINT "WhatsAppInboxEntry_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppInboxEntry" ADD CONSTRAINT "WhatsAppInboxEntry_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

