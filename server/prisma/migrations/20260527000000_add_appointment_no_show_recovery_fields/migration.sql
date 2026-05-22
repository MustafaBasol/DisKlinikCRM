-- Migration: add_appointment_no_show_recovery_fields
-- Adds no-show recovery tracking fields to the Appointment table.
-- These columns are referenced by schema.prisma and the /api/no-shows routes
-- but were never committed as a migration, causing production 500 errors.
-- Uses IF NOT EXISTS to be idempotent (safe if columns were hotfixed manually).

ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS "noShowMarkedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "noShowMarkedById" TEXT,
  ADD COLUMN IF NOT EXISTS "recoveryStatus"   TEXT,
  ADD COLUMN IF NOT EXISTS "recoveryNote"     TEXT,
  ADD COLUMN IF NOT EXISTS "recoveredAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "recoveredById"    TEXT;
