-- F3-DATA-MIG-TODAY-001: Platform Admin clinic data migration capability.
--
-- PURPOSE
--   Adds the durable state a controlled, resumable, idempotent first-customer
--   patient-master migration needs, plus the two destination gaps that were
--   ranked P0 first-customer blockers and the three P1 destinations that would
--   otherwise force required source data to be silently dropped.
--
-- EXPAND BEHAVIOUR / SAFETY CLASSIFICATION
--   PURELY ADDITIVE (expand phase of expand-migrate-contract).
--     * 7 new tables, none referenced by any existing code path.
--     * 3 new NULLABLE columns on "Patient" — no default, no backfill, no
--       NOT NULL, no rewrite of existing rows. On PostgreSQL, ADD COLUMN of a
--       nullable column with no default is a catalog-only change: it takes a
--       brief ACCESS EXCLUSIVE lock and does NOT rewrite the table, so the
--       lock duration is independent of the row count. Reviewed against pilot
--       table sizes: acceptable.
--     * 2 new indexes on "Patient". These DO scan the table. They are created
--       WITHOUT the CONCURRENTLY option because Prisma migrations run inside a
--       transaction; at first-customer scale (hundreds to ~15k rows) the build
--       is sub-second. If this migration is ever applied to a materially larger
--       "Patient" table, split the two CREATE INDEX statements out and run them
--       CONCURRENTLY outside the transaction.
--     * NO column is dropped, renamed, retyped, or made stricter.
--     * NO data is modified. NO row is deleted.
--
-- PRODUCTION DEPLOY ORDER
--   1. Deploy this migration (safe against the currently-running application:
--      every added column is nullable and every added table is unreferenced, so
--      the old application version continues to work unchanged).
--   2. Deploy the application build that contains the migration feature.
--   3. Set PATIENT_IDENTITY_ENCRYPTION_KEY and PATIENT_IDENTITY_LOOKUP_SECRET.
--      Until they are set, identity writes FAIL CLOSED — patient rows still
--      import, identity values are quarantined and reported, and nothing is
--      written in a weaker form. Nothing else in the product is affected.
--   There is no ordering dependency in the other direction: step 1 is safe
--   without step 2.
--
-- ROLLBACK STRATEGY
--   Schema rollback (no domain rows written yet):
--     DROP TABLE "MigrationRowOutcome", "MigrationRunBatch", "MigrationFieldMapping",
--                "MigrationRecord", "MigrationReferenceMap", "MigrationRun",
--                "PatientIdentityDocument";
--     DROP INDEX "Patient_clinicId_chartNumber_idx", "Patient_clinicId_primaryPractitionerId_idx";
--     ALTER TABLE "Patient" DROP CONSTRAINT "Patient_primaryPractitionerId_fkey";
--     ALTER TABLE "Patient" DROP COLUMN "gender", DROP COLUMN "chartNumber",
--                           DROP COLUMN "primaryPractitionerId";
--   (Drop MigrationRecord before MigrationRun — it has an FK to it.)
--
--   Logical rollback AFTER a run has written domain rows: schema rollback is
--   NOT the mechanism. Rollback is PROVENANCE-SCOPED and driven by
--   "MigrationRecord": delete only the Patient rows whose MigrationRecord has
--   outcome='created' AND createdByRunId = <the run being rolled back>, and only
--   after verifying no dependent rows (appointments, payments, messages, consent
--   events) were created since — if dependents exist, downgrade to
--   patientStatus='archived' instead of deleting. Rows with outcome='matched'
--   are NEVER deleted: they pre-existed the migration. 'updated' cannot occur —
--   this design deliberately supports only create and match, which is what makes
--   rollback a bounded delete with no pre-image problem.
--   Rollback is scoped to a migrationRunId and can never touch unrelated tenant
--   data, because every provenance row carries organizationId and clinicId.

-- ---------------------------------------------------------------------------
-- Patient: three additive nullable destinations
-- ---------------------------------------------------------------------------
-- gender (G-E5)        : source CINSIYET, 79.3 % filled / 11,807 values, had no
--                        destination. Allowed values male|female|other; NULL
--                        means "not recorded" and is a DISTINCT state from
--                        'other'.
-- chartNumber (G-E6)   : source DOSYANO, 98.84 % filled, clinic-facing paper
--                        chart number. Deliberately NOT unique — measured
--                        source data has 17 duplicate pairs (34 rows) requiring
--                        manual reconciliation; a hard unique constraint would
--                        block go-live before any human reviewed them.
-- primaryPractitionerId (G-E3) : source HASTADOKTOR, 99.5 % filled / 25 distinct
--                        labels, resolved to an EXISTING User through an
--                        explicit human-approved reference map. A migration
--                        never creates a User.
ALTER TABLE "Patient" ADD COLUMN "gender" TEXT;
ALTER TABLE "Patient" ADD COLUMN "chartNumber" TEXT;
ALTER TABLE "Patient" ADD COLUMN "primaryPractitionerId" TEXT;

-- Tenant column leads both indexes, so they are usable under the clinic scope
-- every patient query already applies.
CREATE INDEX "Patient_clinicId_chartNumber_idx" ON "Patient"("clinicId", "chartNumber");
CREATE INDEX "Patient_clinicId_primaryPractitionerId_idx" ON "Patient"("clinicId", "primaryPractitionerId");

ALTER TABLE "Patient" ADD CONSTRAINT "Patient_primaryPractitionerId_fkey"
  FOREIGN KEY ("primaryPractitionerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- PatientIdentityDocument (G-E4) — encrypted national/travel identity
-- ---------------------------------------------------------------------------
-- A CHILD MODEL, not Patient scalars: GET /api/patients/:id uses include: with
-- no top-level select: and spreads the whole record, so any new Patient scalar
-- auto-leaks to every authorized clinic client with zero code change. A
-- relation is returned only when explicitly included.
--
-- valueEncrypted: AES-256-GCM under DEDICATED key material, never the general
--   ENCRYPTION_KEY. A T.C. Kimlik No is immutable, lifelong and
--   government-issued: it cannot be reissued if its key leaks, unlike every
--   current ENCRYPTION_KEY consumer (all rotatable machine secrets).
-- lookupHash: HMAC-SHA256 over organizationId + ':' + docType + ':' + value,
--   keyed with a SEPARATE dedicated secret. TENANT-BOUND BY CONSTRUCTION — the
--   same identity value in two organizations MUST NOT produce the same token,
--   or the column becomes a cross-tenant correlator readable by anyone with DB
--   access. An UNKEYED hash would be plaintext with extra steps: the valid TC
--   space is ~9e8 and exhaustively invertible in well under a second.
-- cryptoVersion: key generation, so a future rotation is an additive backfill
--   rather than a destructive rewrite.
--
-- The lookup index is NOT unique and leads with organizationId. That scoping is
-- load-bearing, not incidental. No cross-patient unique constraint exists at
-- launch: measured source data carries 30 duplicate values across 60 rows whose
-- nature (genuine duplicate / guardian-on-minor / data-entry error) is not
-- determinable from the workbook. Collisions raise a soft warning for manual
-- review and are NEVER auto-merged.
CREATE TABLE "PatientIdentityDocument" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "valueEncrypted" TEXT NOT NULL,
    "lookupHash" TEXT NOT NULL,
    "cryptoVersion" INTEGER NOT NULL DEFAULT 1,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientIdentityDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatientIdentityDocument_patientId_docType_key" ON "PatientIdentityDocument"("patientId", "docType");
CREATE INDEX "PatientIdentityDocument_organizationId_docType_lookupHash_idx" ON "PatientIdentityDocument"("organizationId", "docType", "lookupHash");
CREATE INDEX "PatientIdentityDocument_clinicId_idx" ON "PatientIdentityDocument"("clinicId");

ALTER TABLE "PatientIdentityDocument" ADD CONSTRAINT "PatientIdentityDocument_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientIdentityDocument" ADD CONSTRAINT "PatientIdentityDocument_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientIdentityDocument" ADD CONSTRAINT "PatientIdentityDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- MigrationRun — run lifecycle, source-file safe metadata, dry-run, locking
-- ---------------------------------------------------------------------------
-- sourceFileStoredPath points at a server-local, non-public, run-scoped path
-- under server/.tmp/migration-source/<runId>/source.bin. It is never served
-- over HTTP, never under uploads/, and the operator's filename is NEVER used to
-- build it (traversal-proof by construction).
CREATE TABLE "MigrationRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "profileVersion" TEXT NOT NULL DEFAULT 'v1',
    "entityType" TEXT NOT NULL DEFAULT 'patient',
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "sourceFileNameSafe" TEXT,
    "sourceFileFormat" TEXT,
    "sourceFileSizeBytes" INTEGER,
    "sourceFileSha256" TEXT,
    "sourceFileStoredPath" TEXT,
    "sourceFileDeletedAt" TIMESTAMP(3),
    "sheetName" TEXT,
    "sheetIndex" INTEGER,
    "totalSourceRows" INTEGER,
    "headerColumnCount" INTEGER,
    "analysisWarnings" JSONB,
    "batchSize" INTEGER NOT NULL DEFAULT 500,
    "totalBatches" INTEGER NOT NULL DEFAULT 0,
    "currentBatch" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "createdRows" INTEGER NOT NULL DEFAULT 0,
    "matchedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "warningRows" INTEGER NOT NULL DEFAULT 0,
    "blockedRows" INTEGER NOT NULL DEFAULT 0,
    "dryRunSummary" JSONB,
    "reconciliation" JSONB,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "executionLockToken" TEXT,
    "executionLockedAt" TIMESTAMP(3),
    "executionHeartbeatAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "cancelRequestedById" TEXT,
    "createdByPlatformAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "uploadedAt" TIMESTAMP(3),
    "analyzedAt" TIMESTAMP(3),
    "dryRunAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "MigrationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MigrationRun_organizationId_createdAt_idx" ON "MigrationRun"("organizationId", "createdAt");
CREATE INDEX "MigrationRun_clinicId_createdAt_idx" ON "MigrationRun"("clinicId", "createdAt");
CREATE INDEX "MigrationRun_status_createdAt_idx" ON "MigrationRun"("status", "createdAt");

ALTER TABLE "MigrationRun" ADD CONSTRAINT "MigrationRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MigrationRun" ADD CONSTRAINT "MigrationRun_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- SetNull so deactivating a Platform Admin never destroys migration history.
ALTER TABLE "MigrationRun" ADD CONSTRAINT "MigrationRun_createdByPlatformAdminId_fkey" FOREIGN KEY ("createdByPlatformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- MigrationRunBatch — per-batch durable state
-- ---------------------------------------------------------------------------
-- Bounded batches with per-batch atomicity. A failure in batch N never rolls
-- back committed batches 1..N-1, and resume restarts at the first
-- non-succeeded batch.
CREATE TABLE "MigrationRunBatch" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "batchNumber" INTEGER NOT NULL,
    "rowStart" INTEGER NOT NULL,
    "rowEnd" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "createdRows" INTEGER NOT NULL DEFAULT 0,
    "matchedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "warningRows" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorSummary" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationRunBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MigrationRunBatch_runId_batchNumber_key" ON "MigrationRunBatch"("runId", "batchNumber");
CREATE INDEX "MigrationRunBatch_runId_status_idx" ON "MigrationRunBatch"("runId", "status");

ALTER TABLE "MigrationRunBatch" ADD CONSTRAINT "MigrationRunBatch_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MigrationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- MigrationFieldMapping — the operator's resolved source→destination decisions
-- ---------------------------------------------------------------------------
-- sourceField is the header BYTE-EXACT as exported; reruns re-key on it.
-- Every source column gets exactly one row, so a run can never execute with an
-- undecided column.
CREATE TABLE "MigrationFieldMapping" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceField" TEXT NOT NULL,
    "sourceIndex" INTEGER NOT NULL,
    "sourceNormalized" TEXT NOT NULL,
    "destinationField" TEXT,
    "transform" TEXT,
    "composeOrder" INTEGER,
    "state" TEXT NOT NULL DEFAULT 'MANUAL_REQUIRED',
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "sourceProfile" JSONB,
    "isAutoSuggested" BOOLEAN NOT NULL DEFAULT false,
    "decidedByPlatformAdminId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationFieldMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MigrationFieldMapping_runId_sourceField_key" ON "MigrationFieldMapping"("runId", "sourceField");
CREATE INDEX "MigrationFieldMapping_runId_state_idx" ON "MigrationFieldMapping"("runId", "state");

ALTER TABLE "MigrationFieldMapping" ADD CONSTRAINT "MigrationFieldMapping_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MigrationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- MigrationReferenceMap (G-E2) — source value → existing NoraMedi entity
-- ---------------------------------------------------------------------------
-- Tenant-scoped by construction. sourceValue is stored BYTE-EXACT (no trim, no
-- case folding, no Turkish-locale casing, no diacritic stripping) — a
-- normalized key would silently re-key on rerun.
-- NO fuzzy matching and NO auto-creation of destination rows: a
-- migration-created User would be a credentialed, payable account created
-- without an onboarding decision.
-- R1: the mapping is BRANCH-scoped. In a multi-branch organization the same
-- source label is two different people in two different branches, so an
-- organization-only unique key silently reuses clinic A's approved mapping
-- when clinic B is migrated. clinicId is part of the identity of a mapping.
CREATE TABLE "MigrationReferenceMap" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "sourceValue" TEXT NOT NULL,
    "destinationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNMAPPED',
    "approvedByPlatformAdminId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationReferenceMap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MigrationReferenceMap_organizationId_clinicId_sourceSystem_key" ON "MigrationReferenceMap"("organizationId", "clinicId", "sourceSystem", "entityType", "sourceValue");
CREATE INDEX "MigrationReferenceMap_organizationId_clinicId_sourceSystem_idx" ON "MigrationReferenceMap"("organizationId", "clinicId", "sourceSystem", "entityType", "status");
CREATE INDEX "MigrationReferenceMap_clinicId_idx" ON "MigrationReferenceMap"("clinicId");

ALTER TABLE "MigrationReferenceMap" ADD CONSTRAINT "MigrationReferenceMap_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MigrationReferenceMap" ADD CONSTRAINT "MigrationReferenceMap_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- MigrationRecord (G-E1) — DURABLE CROSS-RUN PROVENANCE / IDEMPOTENCY ANCHOR
-- ---------------------------------------------------------------------------
-- THE unique invariant of this whole feature:
--   UNIQUE (organizationId, sourceSystem, sourceEntity, sourceId)
-- TENANT-SCOPED, deliberately NOT global. The same vendor HASTA_ID in two
-- organizations is two unrelated patients and MUST NOT collide; a globally
-- unique index over vendor source ids would itself be a cross-tenant hazard.
--
-- This is what makes rerunning a row MATCH instead of creating a second
-- Patient, and what makes a batch retry incapable of duplicating.
--
-- HASTA_ID is source provenance, never a patient business identifier. Phone,
-- e-mail and name are empirically disproven as keys (28.6 % shared phones,
-- 25.7 % colliding names) and are NEVER used for provenance or dedup.
--
-- destinationId is polymorphic by sourceEntity and deliberately carries no FK,
-- so the same table serves future entity types. Reconciliation verifies
-- resolution by query rather than by constraint.
--
-- createdByRunId is IMMUTABLE — rollback is scoped on it, so a later rerun
-- must never overwrite it. lastSeenRunId is the mutable "most recent run that
-- observed this record".
CREATE TABLE "MigrationRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceEntity" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdByRunId" TEXT NOT NULL,
    "lastSeenRunId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MigrationRecord_organizationId_sourceSystem_sourceEntity_sourceId_key" ON "MigrationRecord"("organizationId", "sourceSystem", "sourceEntity", "sourceId");
CREATE INDEX "MigrationRecord_createdByRunId_sourceEntity_idx" ON "MigrationRecord"("createdByRunId", "sourceEntity");
CREATE INDEX "MigrationRecord_organizationId_sourceEntity_destinationId_idx" ON "MigrationRecord"("organizationId", "sourceEntity", "destinationId");
CREATE INDEX "MigrationRecord_clinicId_sourceEntity_idx" ON "MigrationRecord"("clinicId", "sourceEntity");

ALTER TABLE "MigrationRecord" ADD CONSTRAINT "MigrationRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MigrationRecord" ADD CONSTRAINT "MigrationRecord_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MigrationRecord" ADD CONSTRAINT "MigrationRecord_createdByRunId_fkey" FOREIGN KEY ("createdByRunId") REFERENCES "MigrationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- MigrationRowOutcome — per-run, per-row ledger
-- ---------------------------------------------------------------------------
-- Separate from MigrationRecord on purpose: MigrationRecord is the durable
-- cross-run identity map (one row per source record, ever) while this is the
-- per-run ledger (one row per source row, per run). Sharing one table would
-- make run A's report mutate when run B executes.
--
-- NO RAW PII/PHI IN THIS TABLE, by design: it is the source of both XLSX
-- reports. sourceId is the vendor provenance key (operational, not clinical);
-- errorMessage is a templated string; warnings are CODES. No name, phone,
-- e-mail, address, note or identity value is ever stored here.
CREATE TABLE "MigrationRowOutcome" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceRowNumber" INTEGER NOT NULL,
    "batchNumber" INTEGER,
    "sourceId" TEXT,
    "status" TEXT NOT NULL,
    "resultCode" TEXT,
    "errorMessage" TEXT,
    "fieldName" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "destinationPatientId" TEXT,
    "identityClassification" TEXT,
    "identityWritten" BOOLEAN NOT NULL DEFAULT false,
    "warnings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationRowOutcome_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MigrationRowOutcome_runId_sourceRowNumber_key" ON "MigrationRowOutcome"("runId", "sourceRowNumber");
CREATE INDEX "MigrationRowOutcome_runId_status_idx" ON "MigrationRowOutcome"("runId", "status");
CREATE INDEX "MigrationRowOutcome_runId_batchNumber_idx" ON "MigrationRowOutcome"("runId", "batchNumber");

ALTER TABLE "MigrationRowOutcome" ADD CONSTRAINT "MigrationRowOutcome_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MigrationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
