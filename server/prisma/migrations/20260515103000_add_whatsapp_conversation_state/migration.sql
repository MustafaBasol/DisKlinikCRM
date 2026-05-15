-- CreateTable
CREATE TABLE "WhatsAppConversationState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "customerName" TEXT,
    "currentIntent" TEXT,
    "step" TEXT,
    "selectedAppointmentTypeId" TEXT,
    "selectedAppointmentTypeName" TEXT,
    "selectedPractitionerId" TEXT,
    "selectedDate" TEXT,
    "selectedTime" TEXT,
    "lastMessage" TEXT,
    "stateJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppConversationState_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConversationState_clinicId_phone_key" ON "WhatsAppConversationState"("clinicId", "phone");

-- CreateIndex
CREATE INDEX "WhatsAppConversationState_clinicId_updatedAt_idx" ON "WhatsAppConversationState"("clinicId", "updatedAt");