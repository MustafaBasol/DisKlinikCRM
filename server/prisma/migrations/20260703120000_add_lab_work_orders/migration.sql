-- Migration: add_lab_work_orders
-- Dental Laboratory Tracking: Laboratory directory, LabWorkOrder (patient work
-- sent to an external lab), append-only status history, and per-order file
-- attachments. Purely additive — no changes to existing tables.

-- Laboratory
CREATE TABLE "Laboratory" (
    "id"            TEXT NOT NULL,
    "clinicId"      TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone"         TEXT,
    "email"         TEXT,
    "address"       TEXT,
    "notes"         TEXT,
    "isActive"      BOOLEAN NOT NULL DEFAULT true,
    "createdById"   TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    "deletedAt"     TIMESTAMP(3),

    CONSTRAINT "Laboratory_pkey" PRIMARY KEY ("id")
);

-- LabWorkOrder
CREATE TABLE "LabWorkOrder" (
    "id"                 TEXT NOT NULL,
    "clinicId"           TEXT NOT NULL,
    "patientId"          TEXT NOT NULL,
    "laboratoryId"       TEXT NOT NULL,
    "treatmentCaseId"    TEXT,
    "practitionerId"     TEXT,
    "workType"           TEXT NOT NULL,
    "toothFdi"           TEXT,
    "shade"              TEXT,
    "material"           TEXT,
    "notesForLab"        TEXT,
    "notesInternal"      TEXT,
    "status"             TEXT NOT NULL DEFAULT 'pending',
    "revisionCount"      INTEGER NOT NULL DEFAULT 0,
    "impressionTakenAt"  TIMESTAMP(3),
    "sentToLabAt"        TIMESTAMP(3),
    "expectedReturnDate" TIMESTAMP(3),
    "receivedFromLabAt"  TIMESTAMP(3),
    "fittingScheduledAt" TIMESTAMP(3),
    "completedAt"        TIMESTAMP(3),
    "cancelledAt"        TIMESTAMP(3),
    "cancelReason"       TEXT,
    "labCost"            DOUBLE PRECISION,
    "currency"           TEXT,
    "createdById"        TEXT NOT NULL,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,
    "deletedAt"          TIMESTAMP(3),

    CONSTRAINT "LabWorkOrder_pkey" PRIMARY KEY ("id")
);

-- LabWorkOrderStatusHistory
CREATE TABLE "LabWorkOrderStatusHistory" (
    "id"             TEXT NOT NULL,
    "labWorkOrderId" TEXT NOT NULL,
    "fromStatus"     TEXT,
    "toStatus"       TEXT NOT NULL,
    "note"           TEXT,
    "changedById"    TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabWorkOrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- LabOrderAttachment
CREATE TABLE "LabOrderAttachment" (
    "id"             TEXT NOT NULL,
    "clinicId"       TEXT NOT NULL,
    "labWorkOrderId" TEXT NOT NULL,
    "fileName"       TEXT NOT NULL,
    "originalName"   TEXT NOT NULL,
    "fileSize"       INTEGER NOT NULL,
    "mimeType"       TEXT NOT NULL,
    "filePath"       TEXT NOT NULL,
    "uploadedById"   TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabOrderAttachment_pkey" PRIMARY KEY ("id")
);

-- Foreign keys: Laboratory
ALTER TABLE "Laboratory" ADD CONSTRAINT "Laboratory_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Laboratory" ADD CONSTRAINT "Laboratory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Foreign keys: LabWorkOrder
ALTER TABLE "LabWorkOrder" ADD CONSTRAINT "LabWorkOrder_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabWorkOrder" ADD CONSTRAINT "LabWorkOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabWorkOrder" ADD CONSTRAINT "LabWorkOrder_laboratoryId_fkey" FOREIGN KEY ("laboratoryId") REFERENCES "Laboratory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabWorkOrder" ADD CONSTRAINT "LabWorkOrder_treatmentCaseId_fkey" FOREIGN KEY ("treatmentCaseId") REFERENCES "TreatmentCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LabWorkOrder" ADD CONSTRAINT "LabWorkOrder_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LabWorkOrder" ADD CONSTRAINT "LabWorkOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign keys: LabWorkOrderStatusHistory
ALTER TABLE "LabWorkOrderStatusHistory" ADD CONSTRAINT "LabWorkOrderStatusHistory_labWorkOrderId_fkey" FOREIGN KEY ("labWorkOrderId") REFERENCES "LabWorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabWorkOrderStatusHistory" ADD CONSTRAINT "LabWorkOrderStatusHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign keys: LabOrderAttachment
ALTER TABLE "LabOrderAttachment" ADD CONSTRAINT "LabOrderAttachment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabOrderAttachment" ADD CONSTRAINT "LabOrderAttachment_labWorkOrderId_fkey" FOREIGN KEY ("labWorkOrderId") REFERENCES "LabWorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabOrderAttachment" ADD CONSTRAINT "LabOrderAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "Laboratory_clinicId_isActive_idx" ON "Laboratory"("clinicId", "isActive");

CREATE INDEX "LabWorkOrder_clinicId_status_idx" ON "LabWorkOrder"("clinicId", "status");
CREATE INDEX "LabWorkOrder_clinicId_patientId_idx" ON "LabWorkOrder"("clinicId", "patientId");
CREATE INDEX "LabWorkOrder_clinicId_laboratoryId_idx" ON "LabWorkOrder"("clinicId", "laboratoryId");
CREATE INDEX "LabWorkOrder_clinicId_expectedReturnDate_idx" ON "LabWorkOrder"("clinicId", "expectedReturnDate");

CREATE INDEX "LabWorkOrderStatusHistory_labWorkOrderId_createdAt_idx" ON "LabWorkOrderStatusHistory"("labWorkOrderId", "createdAt");

CREATE INDEX "LabOrderAttachment_clinicId_labWorkOrderId_idx" ON "LabOrderAttachment"("clinicId", "labWorkOrderId");
