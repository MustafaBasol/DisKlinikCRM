-- F3-DATA-MIG-TODAY-001-R10-FINAL-COVERAGE
--
-- EXPAND-ONLY. Additive in every statement: one nullable column and two new
-- tables. Nothing is dropped, renamed, narrowed or backfilled, and no existing
-- table is rewritten.
--
-- LOCK / REWRITE RISK
--   ALTER TABLE "Patient" ADD COLUMN "district" TEXT  — PostgreSQL 11+ adds a
--   nullable column with no DEFAULT as a catalog-only change: an ACCESS
--   EXCLUSIVE lock held for the catalog update, no table rewrite, no row
--   scan. On the first customer's 14,890-row Patient table this is
--   sub-millisecond. (A DEFAULT was deliberately not used; even though PG11+
--   handles that without a rewrite too, a NULL district must stay
--   distinguishable from a district somebody actually cleared.)
--
--   The two CREATE TABLE statements take no lock on existing data. Their
--   foreign keys take a SHARE ROW EXCLUSIVE lock on the referenced tables
--   ("Patient", "Clinic", "Organization", "MigrationRun") only for the
--   duration of the constraint creation; because the new tables are empty
--   there is nothing to validate, so this is also effectively instant.
--
-- ROLLBACK COMPATIBILITY
--   The PREVIOUS application release never reads or writes any of these three
--   objects, and "district" is nullable, so every INSERT the old release
--   issues against "Patient" stays valid. Rolling the application back
--   therefore requires NO schema rollback — leave the column and the tables in
--   place. That is the intended rollback path.
--
--   A true schema rollback is possible but is a separate, deliberate CONTRACT
--   migration and destroys preserved legacy evidence:
--     DROP TABLE "MigrationPreservedSourceValue";
--     DROP TABLE "PatientContactPoint";
--     ALTER TABLE "Patient" DROP COLUMN "district";
--
-- OLD-RELEASE COMPATIBILITY
--   Forward-compatible: an old application binary running against this schema
--   behaves exactly as before. Two new tables it does not know about, and one
--   column its SELECTs do not name.
--
-- Index names on MigrationPreservedSourceValue are PINNED because Prisma's
-- generated names exceed PostgreSQL's 63-character identifier limit and would
-- be silently truncated. See the note in schema.prisma.

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "district" TEXT;

-- CreateTable
CREATE TABLE "PatientContactPoint" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactType" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT,
    "label" TEXT,
    "source" TEXT NOT NULL DEFAULT 'staff',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientContactPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationPreservedSourceValue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "migrationRunId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceColumn" TEXT NOT NULL,
    "sourceRowNumber" INTEGER,
    "value" TEXT NOT NULL,
    "valueType" TEXT NOT NULL DEFAULT 'string',
    "semanticClass" TEXT NOT NULL,
    "sensitivity" TEXT NOT NULL DEFAULT 'NORMAL',
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationPreservedSourceValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientContactPoint_patientId_contactType_idx" ON "PatientContactPoint"("patientId", "contactType");

-- CreateIndex
CREATE INDEX "PatientContactPoint_clinicId_idx" ON "PatientContactPoint"("clinicId");

-- CreateIndex
CREATE INDEX "PatientContactPoint_organizationId_idx" ON "PatientContactPoint"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientContactPoint_patientId_contactType_value_key" ON "PatientContactPoint"("patientId", "contactType", "value");

-- CreateIndex
CREATE INDEX "MigrationPreservedSourceValue_patientId_sourceColumn_idx" ON "MigrationPreservedSourceValue"("patientId", "sourceColumn");

-- CreateIndex
CREATE INDEX "MigrationPreservedSourceValue_org_system_column_idx" ON "MigrationPreservedSourceValue"("organizationId", "sourceSystem", "sourceColumn");

-- CreateIndex
CREATE INDEX "MigrationPreservedSourceValue_clinicId_idx" ON "MigrationPreservedSourceValue"("clinicId");

-- CreateIndex
CREATE INDEX "MigrationPreservedSourceValue_migrationRunId_idx" ON "MigrationPreservedSourceValue"("migrationRunId");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationPreservedSourceValue_run_patient_column_row_key" ON "MigrationPreservedSourceValue"("migrationRunId", "patientId", "sourceColumn", "sourceRowNumber");

-- AddForeignKey
ALTER TABLE "PatientContactPoint" ADD CONSTRAINT "PatientContactPoint_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientContactPoint" ADD CONSTRAINT "PatientContactPoint_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientContactPoint" ADD CONSTRAINT "PatientContactPoint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationPreservedSourceValue" ADD CONSTRAINT "MigrationPreservedSourceValue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationPreservedSourceValue" ADD CONSTRAINT "MigrationPreservedSourceValue_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationPreservedSourceValue" ADD CONSTRAINT "MigrationPreservedSourceValue_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationPreservedSourceValue" ADD CONSTRAINT "MigrationPreservedSourceValue_migrationRunId_fkey" FOREIGN KEY ("migrationRunId") REFERENCES "MigrationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
