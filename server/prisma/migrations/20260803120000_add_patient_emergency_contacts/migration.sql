-- US-01.2: patient emergency contacts, relationship, and legal decision-maker support.
--
-- Purely additive migration:
--  * new table "PatientEmergencyContact" (patient/clinic/organization-scoped)
--
-- No existing table is altered and no column is dropped or renamed. No
-- backfill is required for existing Patient rows — a patient simply has zero
-- PatientEmergencyContact rows until one is added via the API. contactType
-- is a plain TEXT column (stable backend string contract: SPOUSE | PARENT |
-- GUARDIAN | CHILD | SIBLING | OTHER — validated in the application layer,
-- consistent with the string-based status/type convention already used for
-- Patient.patientStatus, Appointment.status, etc. — see server/prisma/
-- schema.prisma for the full field/relation comment).
--
-- The "at most one isPrimary=true row per patient" invariant is enforced in
-- the application layer via a transaction (server/src/routes/
-- patientEmergencyContacts.ts), not a DB constraint — see PR description.

-- CreateTable
CREATE TABLE "PatientEmergencyContact" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactType" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "phoneCountryCode" TEXT,
    "email" TEXT,
    "occupation" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isLegalDecisionMaker" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientEmergencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientEmergencyContact_patientId_isPrimary_idx" ON "PatientEmergencyContact"("patientId", "isPrimary");

-- CreateIndex
CREATE INDEX "PatientEmergencyContact_clinicId_idx" ON "PatientEmergencyContact"("clinicId");

-- CreateIndex
CREATE INDEX "PatientEmergencyContact_organizationId_idx" ON "PatientEmergencyContact"("organizationId");

-- AddForeignKey
ALTER TABLE "PatientEmergencyContact" ADD CONSTRAINT "PatientEmergencyContact_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientEmergencyContact" ADD CONSTRAINT "PatientEmergencyContact_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientEmergencyContact" ADD CONSTRAINT "PatientEmergencyContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
