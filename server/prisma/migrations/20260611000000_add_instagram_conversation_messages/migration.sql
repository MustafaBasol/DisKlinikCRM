-- CreateTable
CREATE TABLE "InstagramConversationMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "patientId" TEXT,
    "instagramConnectionId" TEXT,
    "externalSenderId" TEXT NOT NULL,
    "senderUsername" TEXT,
    "externalMessageId" TEXT,
    "direction" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstagramConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramConversationMessage_organizationId_externalMessageId_key" ON "InstagramConversationMessage"("organizationId", "externalMessageId");

-- CreateIndex
CREATE INDEX "InstagramConversationMessage_organizationId_externalSenderId_createdAt_idx" ON "InstagramConversationMessage"("organizationId", "externalSenderId", "createdAt");

-- CreateIndex
CREATE INDEX "InstagramConversationMessage_clinicId_patientId_createdAt_idx" ON "InstagramConversationMessage"("clinicId", "patientId", "createdAt");

-- AddForeignKey
ALTER TABLE "InstagramConversationMessage" ADD CONSTRAINT "InstagramConversationMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramConversationMessage" ADD CONSTRAINT "InstagramConversationMessage_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramConversationMessage" ADD CONSTRAINT "InstagramConversationMessage_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramConversationMessage" ADD CONSTRAINT "InstagramConversationMessage_instagramConnectionId_fkey" FOREIGN KEY ("instagramConnectionId") REFERENCES "InstagramConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
