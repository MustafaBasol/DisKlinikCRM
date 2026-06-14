-- CreateTable: ContactRequest
CREATE TABLE "ContactRequest" (
    "id"                   TEXT NOT NULL,
    "clinicId"             TEXT NOT NULL,
    "patientId"            TEXT,
    "channel"              TEXT NOT NULL,
    "sourceConversationId" TEXT,
    "sourceMessageId"      TEXT,
    "externalSenderId"     TEXT,
    "phone"                TEXT,
    "name"                 TEXT,
    "type"                 TEXT NOT NULL DEFAULT 'staff_handoff',
    "status"               TEXT NOT NULL DEFAULT 'pending',
    "priority"             TEXT NOT NULL DEFAULT 'normal',
    "note"                 TEXT,
    "lastMessage"          TEXT,
    "assignedToId"         TEXT,
    "resolvedById"         TEXT,
    "resolvedAt"           TIMESTAMP(3),
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactRequest_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ContactRequest" ADD CONSTRAINT "ContactRequest_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContactRequest" ADD CONSTRAINT "ContactRequest_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContactRequest" ADD CONSTRAINT "ContactRequest_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContactRequest" ADD CONSTRAINT "ContactRequest_resolvedById_fkey"
    FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ContactRequest_clinicId_status_idx" ON "ContactRequest"("clinicId", "status");
CREATE INDEX "ContactRequest_clinicId_channel_idx" ON "ContactRequest"("clinicId", "channel");
CREATE INDEX "ContactRequest_clinicId_externalSenderId_idx" ON "ContactRequest"("clinicId", "externalSenderId");
CREATE INDEX "ContactRequest_clinicId_createdAt_idx" ON "ContactRequest"("clinicId", "createdAt");
