-- F4-3 / R-079: legal hold for lab-order attachments.
--
-- Purely EXPAND-ONLY and backward-compatible. No existing table, column,
-- constraint or index is altered, dropped or renamed; no data is rewritten.
-- Both columns mirror the already-accepted PatientAttachment / ImagingStudy
-- legal-hold shape byte-for-byte (see
-- 20260715145843_add_kvkk_attachment_imaging_lifecycle lines 15-20 and 63-66).
--
-- Existing rows: "legalHold" gets the column DEFAULT false, i.e. every
-- attachment that exists today stays deletable exactly as it is today. That is
-- deliberate and is the only safe default — a legal hold is an affirmative
-- legal act recorded by an OWNER/ORG_ADMIN with a reason, and back-filling one
-- onto historical rows would fabricate a legal position nobody took.
-- "legalHoldReason" is nullable with no default and stays NULL until a hold is
-- actually placed.
--
-- Rollback: application rollback first — the columns are inert to code that
-- never reads them. See docs/compliance/53 §16B; a destructive DROP COLUMN is
-- NOT the immediate rollback path.
--
-- Hand-authored per this repo's convention (see
-- 20260814120000_add_recovery_drill_run), and verified byte-equivalent to what
-- `prisma migrate diff` produces for this schema change.

-- AlterTable
ALTER TABLE "LabOrderAttachment" ADD COLUMN     "legalHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "legalHoldReason" TEXT;

-- CreateIndex
CREATE INDEX "LabOrderAttachment_clinicId_legalHold_idx" ON "LabOrderAttachment"("clinicId", "legalHold");
