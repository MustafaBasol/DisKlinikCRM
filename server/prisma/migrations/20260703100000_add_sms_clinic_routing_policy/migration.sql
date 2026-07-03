-- Clinic-level SMS destination-region permissions + routing policy.
-- Platform admin decides which regions a clinic may send to and how a
-- provider is picked; clinics cannot edit these fields.
--
-- Columns default OFF (false) / automatic so newly-enabled add-ons start
-- fully locked down until platform admin explicitly allows a region.
-- Existing clinics that already had the SMS add-on active are backfilled to
-- both regions allowed so they keep sending without interruption.

ALTER TABLE "ClinicSmsSettings"
  ADD COLUMN "turkeyAllowed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "europeAllowed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "routingPolicy" TEXT NOT NULL DEFAULT 'automatic_by_recipient_phone_region';

UPDATE "ClinicSmsSettings"
SET "turkeyAllowed" = true, "europeAllowed" = true
WHERE "addonEnabled" = true;

-- Clinics enabled via plan.features.sms === true (rather than the paid
-- add-on) are intentionally NOT backfilled here: plan eligibility lives on
-- Plan.features (JSON, reachable via clinic.plan or clinic.organization.plan)
-- and cannot be joined/filtered reliably in a single SQL statement without
-- risking incorrect matches across plan shapes. Instead, getSmsEntitlement()
-- (server/src/services/sms/smsEntitlement.ts) computes safe effective
-- routing settings at runtime for plan-enabled clinics: when such a clinic
-- has no admin-managed ClinicSmsSettings row (or a stale row with
-- addonEnabled=false), both destination regions default to allowed so
-- previously-working plan-granted SMS sending is never blocked. See the
-- "SMS entitlement / effective routing settings" tests in smsModule.test.ts.
