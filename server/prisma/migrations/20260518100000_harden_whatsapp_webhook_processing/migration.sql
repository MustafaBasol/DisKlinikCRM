ALTER TABLE "WhatsAppConversationState"
ADD COLUMN "lastProviderMessageId" TEXT;

ALTER TABLE "WhatsAppConversationMessage"
ADD COLUMN "providerMessageId" TEXT;

CREATE UNIQUE INDEX "WhatsAppConversationMessage_clinicId_providerMessageId_key"
ON "WhatsAppConversationMessage"("clinicId", "providerMessageId");
