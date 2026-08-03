-- US-01.2: patient emergency contacts, relationship, and legal decision-maker support.
--
-- Purely additive migration:
--  * new table "PatientEmergencyContact" (patient/clinic/organization-scoped)
--  * a partial unique index enforcing the single-primary-contact invariant
--    at the database level (added after initial review — see below)
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
-- The "at most one isPrimary=true row per patient" invariant is now
-- DATABASE-BACKED via the partial unique index below (not just the
-- application-layer prisma.$transaction() reset-then-set sequence in
-- server/src/routes/patientEmergencyContacts.ts, which by itself cannot
-- prevent two concurrent requests from each completing with a separate
-- primary row). The index can only ever hold zero or one row per patientId
-- (only rows with isPrimary = true are indexed), so a concurrent write that
-- would create a second primary is rejected by Postgres with a P2002 unique
-- violation; the route translates that into a stable 409
-- PRIMARY_CONTACT_CONFLICT response (see isPrimaryContactConflict() in
-- server/src/services/patientEmergencyContacts.ts) rather than an unhandled
-- 500. Prisma's schema DSL has no support for partial/filtered unique
-- indexes, so this is expressed directly here rather than as `@@unique` in
-- schema.prisma — a plain `@@unique([patientId, isPrimary])` would be wrong
-- anyway, since it would also cap the number of isPrimary=false rows at one
-- per patient, which is not the intended rule.

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

-- CreateIndex (database-backed single-primary-contact invariant; see header comment)
CREATE UNIQUE INDEX "PatientEmergencyContact_one_primary_per_patient" ON "PatientEmergencyContact"("patientId") WHERE "isPrimary" = true;

-- AddForeignKey
ALTER TABLE "PatientEmergencyContact" ADD CONSTRAINT "PatientEmergencyContact_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientEmergencyContact" ADD CONSTRAINT "PatientEmergencyContact_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientEmergencyContact" ADD CONSTRAINT "PatientEmergencyContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
