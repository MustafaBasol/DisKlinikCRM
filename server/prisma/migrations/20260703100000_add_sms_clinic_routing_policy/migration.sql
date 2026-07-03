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
