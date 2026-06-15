-- Migration: add_patient_privacy_rights
-- Adds KVKK/GDPR anonymization tracking fields to Patient
-- and creates PatientPrivacyRequest model.

-- Patient: anonymization tracking fields
ALTER TABLE "Patient" ADD COLUMN "isAnonymized"        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Patient" ADD COLUMN "anonymizedAt"        TIMESTAMP(3);
ALTER TABLE "Patient" ADD COLUMN "anonymizedById"      TEXT;
ALTER TABLE "Patient" ADD COLUMN "anonymizationReason" TEXT;

-- PatientPrivacyRequest model
CREATE TABLE "PatientPrivacyRequest" (
    "id"                TEXT NOT NULL,
    "clinicId"          TEXT NOT NULL,
    "patientId"         TEXT,
    "requestType"       TEXT NOT NULL,
    "status"            TEXT NOT NULL DEFAULT 'pending',
    "requestedByUserId" TEXT,
    "handledByUserId"   TEXT,
    "requestNote"       TEXT,
    "decisionNote"      TEXT,
    "completedAt"       TIMESTAMP(3),
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientPrivacyRequest_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "PatientPrivacyRequest" ADD CONSTRAINT "PatientPrivacyRequest_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PatientPrivacyRequest" ADD CONSTRAINT "PatientPrivacyRequest_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "PatientPrivacyRequest_clinicId_status_idx"      ON "PatientPrivacyRequest"("clinicId", "status");
CREATE INDEX "PatientPrivacyRequest_clinicId_patientId_idx"   ON "PatientPrivacyRequest"("clinicId", "patientId");
CREATE INDEX "PatientPrivacyRequest_clinicId_requestType_idx" ON "PatientPrivacyRequest"("clinicId", "requestType");
CREATE INDEX "PatientPrivacyRequest_createdAt_idx"            ON "PatientPrivacyRequest"("createdAt");
