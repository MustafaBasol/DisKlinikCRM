-- Add non-unique indexes on Patient.phone and Patient.email for fast clinic-scoped lookups.
-- Multiple patients may share the same phone (e.g. parent/guardian) or email.
-- No unique constraints are added — phone/email are contact channels, not patient identifiers.

CREATE INDEX IF NOT EXISTS "Patient_clinicId_phone_idx" ON "Patient"("clinicId", "phone");
CREATE INDEX IF NOT EXISTS "Patient_clinicId_email_idx" ON "Patient"("clinicId", "email");
