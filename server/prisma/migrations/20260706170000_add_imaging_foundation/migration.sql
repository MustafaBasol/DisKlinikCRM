-- Migration: add_imaging_foundation
-- Imaging / Device Integration Foundation (Phase 1): ImagingDevice (clinic
-- device registry), ImagingRequest (minimal acquisition job — future DICOM
-- Worklist / bridge jobs), ImagingStudy (a study; patientId NULL = unlinked
-- queue) and ImagingImage (immutable original files, storage-key based).
-- Purely additive — no changes to existing tables.

-- ImagingDevice
CREATE TABLE "ImagingDevice" (
    "id"             TEXT NOT NULL,
    "clinicId"       TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "modality"       TEXT NOT NULL,
    "manufacturer"   TEXT,
    "modelName"      TEXT,
    "connectionType" TEXT NOT NULL DEFAULT 'manual',
    "isActive"       BOOLEAN NOT NULL DEFAULT true,
    "notes"          TEXT,
    "createdById"    TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImagingDevice_pkey" PRIMARY KEY ("id")
);

-- ImagingRequest
CREATE TABLE "ImagingRequest" (
    "id"                TEXT NOT NULL,
    "clinicId"          TEXT NOT NULL,
    "patientId"         TEXT NOT NULL,
    "appointmentId"     TEXT,
    "treatmentCaseId"   TEXT,
    "requestedModality" TEXT NOT NULL,
    "requestedDeviceId" TEXT,
    "status"            TEXT NOT NULL DEFAULT 'requested',
    "priority"          TEXT,
    "notes"             TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImagingRequest_pkey" PRIMARY KEY ("id")
);

-- ImagingStudy
CREATE TABLE "ImagingStudy" (
    "id"               TEXT NOT NULL,
    "clinicId"         TEXT NOT NULL,
    "patientId"        TEXT,
    "appointmentId"    TEXT,
    "treatmentCaseId"  TEXT,
    "deviceId"         TEXT,
    "imagingRequestId" TEXT,
    "modality"         TEXT NOT NULL,
    "studyDate"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description"      TEXT,
    "source"           TEXT NOT NULL DEFAULT 'manual_upload',
    "status"           TEXT NOT NULL DEFAULT 'active',
    "studyInstanceUid" TEXT,
    "createdById"      TEXT NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImagingStudy_pkey" PRIMARY KEY ("id")
);

-- ImagingImage
CREATE TABLE "ImagingImage" (
    "id"             TEXT NOT NULL,
    "clinicId"       TEXT NOT NULL,
    "studyId"        TEXT NOT NULL,
    "fileName"       TEXT NOT NULL,
    "originalName"   TEXT NOT NULL,
    "fileSize"       INTEGER NOT NULL,
    "mimeType"       TEXT NOT NULL,
    "filePath"       TEXT NOT NULL,
    "sopInstanceUid" TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImagingImage_pkey" PRIMARY KEY ("id")
);

-- Foreign keys: ImagingDevice
ALTER TABLE "ImagingDevice" ADD CONSTRAINT "ImagingDevice_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImagingDevice" ADD CONSTRAINT "ImagingDevice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign keys: ImagingRequest
ALTER TABLE "ImagingRequest" ADD CONSTRAINT "ImagingRequest_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImagingRequest" ADD CONSTRAINT "ImagingRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImagingRequest" ADD CONSTRAINT "ImagingRequest_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImagingRequest" ADD CONSTRAINT "ImagingRequest_treatmentCaseId_fkey" FOREIGN KEY ("treatmentCaseId") REFERENCES "TreatmentCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImagingRequest" ADD CONSTRAINT "ImagingRequest_requestedDeviceId_fkey" FOREIGN KEY ("requestedDeviceId") REFERENCES "ImagingDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImagingRequest" ADD CONSTRAINT "ImagingRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign keys: ImagingStudy
ALTER TABLE "ImagingStudy" ADD CONSTRAINT "ImagingStudy_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImagingStudy" ADD CONSTRAINT "ImagingStudy_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImagingStudy" ADD CONSTRAINT "ImagingStudy_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImagingStudy" ADD CONSTRAINT "ImagingStudy_treatmentCaseId_fkey" FOREIGN KEY ("treatmentCaseId") REFERENCES "TreatmentCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImagingStudy" ADD CONSTRAINT "ImagingStudy_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "ImagingDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImagingStudy" ADD CONSTRAINT "ImagingStudy_imagingRequestId_fkey" FOREIGN KEY ("imagingRequestId") REFERENCES "ImagingRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImagingStudy" ADD CONSTRAINT "ImagingStudy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign keys: ImagingImage
ALTER TABLE "ImagingImage" ADD CONSTRAINT "ImagingImage_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImagingImage" ADD CONSTRAINT "ImagingImage_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "ImagingStudy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "ImagingDevice_clinicId_isActive_idx" ON "ImagingDevice"("clinicId", "isActive");

CREATE INDEX "ImagingRequest_clinicId_status_idx" ON "ImagingRequest"("clinicId", "status");
CREATE INDEX "ImagingRequest_clinicId_patientId_idx" ON "ImagingRequest"("clinicId", "patientId");

CREATE INDEX "ImagingStudy_clinicId_patientId_idx" ON "ImagingStudy"("clinicId", "patientId");
CREATE INDEX "ImagingStudy_clinicId_status_idx" ON "ImagingStudy"("clinicId", "status");

CREATE INDEX "ImagingImage_clinicId_studyId_idx" ON "ImagingImage"("clinicId", "studyId");
