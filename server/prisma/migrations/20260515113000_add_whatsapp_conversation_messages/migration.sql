-- CreateTable
CREATE TABLE "WhatsAppConversationMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppConversationMessage_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WhatsAppConversationMessage_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WhatsAppConversationMessage_clinicId_patientId_createdAt_idx" ON "WhatsAppConversationMessage"("clinicId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppConversationMessage_clinicId_phone_createdAt_idx" ON "WhatsAppConversationMessage"("clinicId", "phone", "createdAt");