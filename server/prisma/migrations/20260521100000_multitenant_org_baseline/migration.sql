-- =============================================================================
-- Migration: 20260521100000_multitenant_org_baseline
-- Purpose  : Add multi-tenant / multi-branch support.
--            Creates Plan, PlatformAdmin, Organization, UserClinic,
--            PatientClinic, ClinicInvitation tables; adds organizationId and
--            related columns to Clinic, User, Patient, InventoryItem;
--            backfills all existing rows into a single "Default" organization;
--            replaces the single-column User_email_key unique index with the
--            composite (organizationId, email) unique.
-- Must run BEFORE: 20260521113926_whatsapp_connection_models
-- =============================================================================

-- ─── SECTION A: Create independent new tables ────────────────────────────────

CREATE TABLE "Plan" (
    "id"           TEXT         NOT NULL,
    "name"         TEXT         NOT NULL,
    "displayName"  TEXT         NOT NULL,
    "maxUsers"     INTEGER      NOT NULL,
    "maxPatients"  INTEGER      NOT NULL,
    "features"     JSONB        NOT NULL DEFAULT '{}',
    "monthlyPrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "isActive"     BOOLEAN      NOT NULL DEFAULT true,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Plan_name_key" ON "Plan"("name");

CREATE TABLE "PlatformAdmin" (
    "id"           TEXT         NOT NULL,
    "email"        TEXT         NOT NULL,
    "passwordHash" TEXT         NOT NULL,
    "name"         TEXT         NOT NULL,
    "isActive"     BOOLEAN      NOT NULL DEFAULT true,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlatformAdmin_email_key" ON "PlatformAdmin"("email");

CREATE TABLE "Organization" (
    "id"          TEXT         NOT NULL,
    "name"        TEXT         NOT NULL,
    "slug"        TEXT         NOT NULL,
    "status"      TEXT         NOT NULL DEFAULT 'trial',
    "planId"      TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "ownerId"     TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- ─── SECTION B: Seed default Plan and default Organization ───────────────────
-- Fixed IDs ensure idempotent re-runs and allow later migrations to reference
-- them without querying the DB first.

INSERT INTO "Plan" (
    "id", "name", "displayName", "maxUsers", "maxPatients",
    "features", "monthlyPrice", "isActive", "createdAt"
)
VALUES (
    '00000000-plan-0000-0000-default00001',
    'starter',
    'Starter',
    100,
    10000,
    '{"whatsapp": true, "reports": true, "compensation": true, "inventory": true}'::jsonb,
    0,
    true,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "Organization" (
    "id", "name", "slug", "status", "planId", "createdAt", "updatedAt"
)
VALUES (
    '00000000-org0-0000-0000-default00001',
    'Default Organization',
    'default',
    'active',
    '00000000-plan-0000-0000-default00001',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("slug") DO NOTHING;

-- ─── SECTION C: Add nullable columns to existing tables ─────────────────────
-- All new columns are nullable first so existing rows are not rejected.
-- They will be backfilled in section D and made NOT NULL in section E.

-- Clinic
ALTER TABLE "Clinic"
    ADD COLUMN "organizationId" TEXT,
    ADD COLUMN "planId"         TEXT,
    ADD COLUMN "slug"           TEXT,
    ADD COLUMN "trialEndsAt"    TIMESTAMP(3),
    ADD COLUMN "maxUsers"       INTEGER DEFAULT 10,
    ADD COLUMN "maxPatients"    INTEGER DEFAULT 500;

-- status is TEXT NOT NULL with default 'active'
ALTER TABLE "Clinic" ADD COLUMN "status" TEXT DEFAULT 'active';

-- User
ALTER TABLE "User"
    ADD COLUMN "organizationId"      TEXT,
    ADD COLUMN "defaultClinicId"     TEXT,
    ADD COLUMN "canAccessAllClinics" BOOLEAN NOT NULL DEFAULT false;

-- Patient
ALTER TABLE "Patient"
    ADD COLUMN "organizationId"  TEXT,
    ADD COLUMN "primaryClinicId" TEXT;

-- InventoryItem (may not exist yet on all environments – skip if absent)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'InventoryItem') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'InventoryItem' AND column_name = 'organizationId'
        ) THEN
            ALTER TABLE "InventoryItem" ADD COLUMN "organizationId" TEXT;
        END IF;
    END IF;
END $$;

-- ─── SECTION D: Backfill existing rows ───────────────────────────────────────

-- Clinic: use each clinic's own id as its slug (unique per row, always safe)
UPDATE "Clinic"
SET
    "organizationId" = '00000000-org0-0000-0000-default00001',
    "slug"           = "id",
    "status"         = COALESCE("status", 'active'),
    "maxUsers"       = COALESCE("maxUsers", 10),
    "maxPatients"    = COALESCE("maxPatients", 500)
WHERE "organizationId" IS NULL;

-- User
UPDATE "User"
SET "organizationId" = '00000000-org0-0000-0000-default00001'
WHERE "organizationId" IS NULL;

-- Patient
UPDATE "Patient"
SET "organizationId" = '00000000-org0-0000-0000-default00001'
WHERE "organizationId" IS NULL;

-- InventoryItem
UPDATE "InventoryItem"
SET "organizationId" = '00000000-org0-0000-0000-default00001'
WHERE "organizationId" IS NULL;

-- ─── SECTION E: Apply NOT NULL constraints after backfill ────────────────────

-- Clinic
ALTER TABLE "Clinic" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Clinic" ALTER COLUMN "slug"           SET NOT NULL;
ALTER TABLE "Clinic" ALTER COLUMN "status"         SET NOT NULL;
ALTER TABLE "Clinic" ALTER COLUMN "maxUsers"       SET NOT NULL;
ALTER TABLE "Clinic" ALTER COLUMN "maxPatients"    SET NOT NULL;

-- User
ALTER TABLE "User" ALTER COLUMN "organizationId" SET NOT NULL;

-- Patient
ALTER TABLE "Patient" ALTER COLUMN "organizationId" SET NOT NULL;

-- InventoryItem
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'InventoryItem' AND column_name = 'organizationId'
    ) THEN
        ALTER TABLE "InventoryItem" ALTER COLUMN "organizationId" SET NOT NULL;
    END IF;
END $$;

-- ─── SECTION F: Foreign keys between tables ──────────────────────────────────

-- Organization ← Plan
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Clinic ← Organization
ALTER TABLE "Clinic" ADD CONSTRAINT "Clinic_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Clinic ← Plan (nullable)
ALTER TABLE "Clinic" ADD CONSTRAINT "Clinic_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- User ← Organization
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- User.defaultClinicId ← Clinic (nullable)
ALTER TABLE "User" ADD CONSTRAINT "User_defaultClinicId_fkey"
    FOREIGN KEY ("defaultClinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Patient ← Organization
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Patient.primaryClinicId ← Clinic (nullable)
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_primaryClinicId_fkey"
    FOREIGN KEY ("primaryClinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- InventoryItem ← Organization
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'InventoryItem' AND column_name = 'organizationId'
    ) THEN
        ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- ─── SECTION G: Indexes and composite unique constraints ─────────────────────

-- Clinic unique (organizationId, slug)
CREATE UNIQUE INDEX "Clinic_organizationId_slug_key" ON "Clinic"("organizationId", "slug");

-- Drop old single-column User_email_key; replace with (organizationId, email)
DROP INDEX IF EXISTS "User_email_key";
CREATE UNIQUE INDEX "User_organizationId_email_key" ON "User"("organizationId", "email");

-- ─── SECTION H: Create junction / bridge tables ──────────────────────────────

CREATE TABLE "UserClinic" (
    "id"        TEXT         NOT NULL,
    "userId"    TEXT         NOT NULL,
    "clinicId"  TEXT         NOT NULL,
    "role"      TEXT         NOT NULL,
    "isActive"  BOOLEAN      NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserClinic_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserClinic_userId_clinicId_key" ON "UserClinic"("userId", "clinicId");
CREATE INDEX "UserClinic_clinicId_isActive_idx"     ON "UserClinic"("clinicId", "isActive");
CREATE INDEX "UserClinic_userId_isActive_idx"        ON "UserClinic"("userId",   "isActive");
ALTER TABLE "UserClinic" ADD CONSTRAINT "UserClinic_userId_fkey"
    FOREIGN KEY ("userId")   REFERENCES "User"("id")   ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserClinic" ADD CONSTRAINT "UserClinic_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PatientClinic" (
    "id"          TEXT         NOT NULL,
    "patientId"   TEXT         NOT NULL,
    "clinicId"    TEXT         NOT NULL,
    "firstVisitAt" TIMESTAMP(3),
    "lastVisitAt"  TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatientClinic_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PatientClinic_patientId_clinicId_key" ON "PatientClinic"("patientId", "clinicId");
CREATE INDEX "PatientClinic_clinicId_idx"   ON "PatientClinic"("clinicId");
CREATE INDEX "PatientClinic_patientId_idx"  ON "PatientClinic"("patientId");
ALTER TABLE "PatientClinic" ADD CONSTRAINT "PatientClinic_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientClinic" ADD CONSTRAINT "PatientClinic_clinicId_fkey"
    FOREIGN KEY ("clinicId")  REFERENCES "Clinic"("id")  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ClinicInvitation" (
    "id"             TEXT         NOT NULL,
    "clinicId"       TEXT         NOT NULL,
    "email"          TEXT         NOT NULL,
    "role"           TEXT         NOT NULL,
    "token"          TEXT         NOT NULL,
    "expiresAt"      TIMESTAMP(3) NOT NULL,
    "usedAt"         TIMESTAMP(3),
    "organizationId" TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClinicInvitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClinicInvitation_token_key"          ON "ClinicInvitation"("token");
CREATE INDEX        "ClinicInvitation_clinicId_email_idx" ON "ClinicInvitation"("clinicId", "email");
CREATE INDEX        "ClinicInvitation_token_idx"          ON "ClinicInvitation"("token");
ALTER TABLE "ClinicInvitation" ADD CONSTRAINT "ClinicInvitation_clinicId_fkey"
    FOREIGN KEY ("clinicId")       REFERENCES "Clinic"("id")       ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicInvitation" ADD CONSTRAINT "ClinicInvitation_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── SECTION I: Backfill junction tables from existing rows ──────────────────
-- IDs are derived deterministically from the source row IDs so re-runs are safe.
-- md5 produces a 32-char hex string; format() converts it to UUID notation.

INSERT INTO "UserClinic" ("id", "userId", "clinicId", "role", "isActive", "createdAt", "updatedAt")
SELECT
    format('%s-%s-%s-%s-%s',
        left(md5(u."id" || '-uc-' || u."clinicId"), 8),
        substr(md5(u."id" || '-uc-' || u."clinicId"), 9,  4),
        substr(md5(u."id" || '-uc-' || u."clinicId"), 13, 4),
        substr(md5(u."id" || '-uc-' || u."clinicId"), 17, 4),
        right(md5(u."id" || '-uc-' || u."clinicId"), 12)
    ),
    u."id",
    u."clinicId",
    u."role",
    u."isActive",
    u."createdAt",
    u."updatedAt"
FROM "User" u
ON CONFLICT ("userId", "clinicId") DO NOTHING;

INSERT INTO "PatientClinic" ("id", "patientId", "clinicId", "firstVisitAt", "createdAt")
SELECT
    format('%s-%s-%s-%s-%s',
        left(md5(p."id" || '-pc-' || p."clinicId"), 8),
        substr(md5(p."id" || '-pc-' || p."clinicId"), 9,  4),
        substr(md5(p."id" || '-pc-' || p."clinicId"), 13, 4),
        substr(md5(p."id" || '-pc-' || p."clinicId"), 17, 4),
        right(md5(p."id" || '-pc-' || p."clinicId"), 12)
    ),
    p."id",
    p."clinicId",
    p."createdAt",
    p."createdAt"
FROM "Patient" p
ON CONFLICT ("patientId", "clinicId") DO NOTHING;
