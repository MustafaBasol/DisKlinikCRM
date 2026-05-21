-- AlterTable
ALTER TABLE "SentMessage" ADD COLUMN     "direction" TEXT,
ADD COLUMN     "externalMessageId" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "whatsappConnectionId" TEXT;

-- CreateTable
CREATE TABLE "ClinicWorkingHours" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicWorkingHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'evolution_api',
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "phoneNumber" TEXT,
    "displayName" TEXT,
    "evolutionApiUrl" TEXT,
    "evolutionInstanceName" TEXT,
    "evolutionApiKeyEncrypted" TEXT,
    "metaBusinessId" TEXT,
    "metaWabaId" TEXT,
    "metaPhoneNumberId" TEXT,
    "metaAppId" TEXT,
    "metaAccessTokenEncrypted" TEXT,
    "metaWebhookVerifyToken" TEXT,
    "metaWebhookSecret" TEXT,
    "webhookSecret" TEXT,
    "lastConnectedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicWhatsAppConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "whatsappConnectionId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicWhatsAppConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClinicWorkingHours_clinicId_idx" ON "ClinicWorkingHours"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicWorkingHours_clinicId_dayOfWeek_key" ON "ClinicWorkingHours"("clinicId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "WhatsAppConnection_organizationId_idx" ON "WhatsAppConnection"("organizationId");

-- CreateIndex
CREATE INDEX "WhatsAppConnection_provider_idx" ON "WhatsAppConnection"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConnection_organizationId_name_key" ON "WhatsAppConnection"("organizationId", "name");

-- CreateIndex
CREATE INDEX "ClinicWhatsAppConnection_organizationId_idx" ON "ClinicWhatsAppConnection"("organizationId");

-- CreateIndex
CREATE INDEX "ClinicWhatsAppConnection_clinicId_idx" ON "ClinicWhatsAppConnection"("clinicId");

-- CreateIndex
CREATE INDEX "ClinicWhatsAppConnection_whatsappConnectionId_idx" ON "ClinicWhatsAppConnection"("whatsappConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicWhatsAppConnection_clinicId_whatsappConnectionId_key" ON "ClinicWhatsAppConnection"("clinicId", "whatsappConnectionId");

-- AddForeignKey
ALTER TABLE "SentMessage" ADD CONSTRAINT "SentMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentMessage" ADD CONSTRAINT "SentMessage_whatsappConnectionId_fkey" FOREIGN KEY ("whatsappConnectionId") REFERENCES "WhatsAppConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicWorkingHours" ADD CONSTRAINT "ClinicWorkingHours_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicWorkingHours" ADD CONSTRAINT "ClinicWorkingHours_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConnection" ADD CONSTRAINT "WhatsAppConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicWhatsAppConnection" ADD CONSTRAINT "ClinicWhatsAppConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicWhatsAppConnection" ADD CONSTRAINT "ClinicWhatsAppConnection_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicWhatsAppConnection" ADD CONSTRAINT "ClinicWhatsAppConnection_whatsappConnectionId_fkey" FOREIGN KEY ("whatsappConnectionId") REFERENCES "WhatsAppConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

