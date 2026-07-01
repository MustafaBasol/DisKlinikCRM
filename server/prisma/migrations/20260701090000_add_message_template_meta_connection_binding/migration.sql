-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN "metaTemplateConnectionId" TEXT,
ADD COLUMN "metaWabaIdSnapshot" TEXT,
ADD COLUMN "metaPhoneNumberIdSnapshot" TEXT;

-- CreateIndex
CREATE INDEX "MessageTemplate_metaTemplateConnectionId_idx" ON "MessageTemplate"("metaTemplateConnectionId");

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_metaTemplateConnectionId_fkey" FOREIGN KEY ("metaTemplateConnectionId") REFERENCES "WhatsAppConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
