-- US-01.1-P1: versioned medical-history backend foundation.
--
-- Purely additive migration:
--  * new table "PatientMedicalHistory" — one immutable row per version,
--    patient/clinic/organization-scoped (see server/prisma/schema.prisma for
--    the full design comment: no separate "current state" row, no
--    update/delete route, latest version = MAX(version) per patientId).
--  * new table "MedicalCondition" — global, tenant-independent ICD-10-
--    compatible lookup catalog, seeded idempotently by
--    server/prisma/seedMedicalConditions.ts.
--  * new table "PatientCondition" — join table linking one
--    PatientMedicalHistory version to one or more MedicalCondition rows.
--
-- No existing table is altered and no column is dropped or renamed. No
-- backfill is required for existing Patient rows — a patient simply has
-- zero PatientMedicalHistory rows until the first version is recorded via
-- POST /api/patients/:patientId/medical-history.
--
-- The "no duplicate (patientId, version) pair" invariant is DATABASE-BACKED
-- via the unique index below (not just the application-layer
-- prisma.$transaction() + per-patient pg_advisory_xact_lock sequence in
-- server/src/routes/patientMedicalHistory.ts / services/
-- patientMedicalHistoryConcurrency.ts, which by itself is the primary
-- defense but is backstopped here in case it is ever bypassed). A concurrent
-- write that would create a second row for the same (patientId, version) is
-- rejected by Postgres with a P2002 unique violation; the route translates
-- that into a stable 409 MEDICAL_HISTORY_VERSION_CONFLICT response.
--
-- No cascade delete anywhere in this migration: every foreign key below is
-- ON DELETE RESTRICT — medical history, its condition links, and the
-- condition lookup catalog are never silently removed as a side effect of
-- deleting a patient, clinic, organization, user, or lookup row.

-- CreateTable
CREATE TABLE "PatientMedicalHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "noKnownConditions" BOOLEAN NOT NULL DEFAULT false,
    "allergies" TEXT,
    "currentMedications" TEXT,
    "pregnancyStatus" TEXT NOT NULL DEFAULT 'unknown',
    "pregnancyStartDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientMedicalHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalCondition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameTr" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientCondition" (
    "id" TEXT NOT NULL,
    "historyId" TEXT NOT NULL,
    "conditionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientCondition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientMedicalHistory_organizationId_idx" ON "PatientMedicalHistory"("organizationId");

-- CreateIndex
CREATE INDEX "PatientMedicalHistory_clinicId_idx" ON "PatientMedicalHistory"("clinicId");

-- CreateIndex
CREATE INDEX "PatientMedicalHistory_patientId_createdAt_idx" ON "PatientMedicalHistory"("patientId", "createdAt");

-- CreateIndex (database-backed duplicate-version backstop; see header comment)
CREATE UNIQUE INDEX "PatientMedicalHistory_patientId_version_key" ON "PatientMedicalHistory"("patientId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalCondition_code_key" ON "MedicalCondition"("code");

-- CreateIndex
CREATE INDEX "MedicalCondition_category_idx" ON "MedicalCondition"("category");

-- CreateIndex
CREATE INDEX "PatientCondition_historyId_idx" ON "PatientCondition"("historyId");

-- CreateIndex
CREATE INDEX "PatientCondition_conditionId_idx" ON "PatientCondition"("conditionId");

-- CreateIndex
CREATE INDEX "PatientCondition_patientId_idx" ON "PatientCondition"("patientId");

-- CreateIndex
CREATE INDEX "PatientCondition_clinicId_idx" ON "PatientCondition"("clinicId");

-- CreateIndex
CREATE INDEX "PatientCondition_organizationId_idx" ON "PatientCondition"("organizationId");

-- AddForeignKey
ALTER TABLE "PatientMedicalHistory" ADD CONSTRAINT "PatientMedicalHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientMedicalHistory" ADD CONSTRAINT "PatientMedicalHistory_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientMedicalHistory" ADD CONSTRAINT "PatientMedicalHistory_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientMedicalHistory" ADD CONSTRAINT "PatientMedicalHistory_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCondition" ADD CONSTRAINT "PatientCondition_historyId_fkey" FOREIGN KEY ("historyId") REFERENCES "PatientMedicalHistory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCondition" ADD CONSTRAINT "PatientCondition_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "MedicalCondition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCondition" ADD CONSTRAINT "PatientCondition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCondition" ADD CONSTRAINT "PatientCondition_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCondition" ADD CONSTRAINT "PatientCondition_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
