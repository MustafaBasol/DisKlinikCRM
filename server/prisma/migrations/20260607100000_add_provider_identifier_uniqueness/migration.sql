-- Enforce tenant-safe provider identifier routing.
--
-- Duplicate non-null provider identifiers would make global public webhooks
-- ambiguous. Run these diagnostics before applying if this migration fails:
--
-- SELECT "metaPhoneNumberId", COUNT(*) FROM "WhatsAppConnection"
-- WHERE "metaPhoneNumberId" IS NOT NULL
-- GROUP BY "metaPhoneNumberId" HAVING COUNT(*) > 1;
--
-- SELECT "evolutionInstanceName", COUNT(*) FROM "WhatsAppConnection"
-- WHERE "evolutionInstanceName" IS NOT NULL
-- GROUP BY "evolutionInstanceName" HAVING COUNT(*) > 1;
--
-- SELECT "instagramAccountId", COUNT(*) FROM "InstagramConnection"
-- WHERE "instagramAccountId" IS NOT NULL
-- GROUP BY "instagramAccountId" HAVING COUNT(*) > 1;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "WhatsAppConnection"
    WHERE "metaPhoneNumberId" IS NOT NULL
    GROUP BY "metaPhoneNumberId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate non-null WhatsAppConnection.metaPhoneNumberId values exist. Clean them up before applying this migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "WhatsAppConnection"
    WHERE "evolutionInstanceName" IS NOT NULL
    GROUP BY "evolutionInstanceName"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate non-null WhatsAppConnection.evolutionInstanceName values exist. Clean them up before applying this migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "InstagramConnection"
    WHERE "instagramAccountId" IS NOT NULL
    GROUP BY "instagramAccountId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate non-null InstagramConnection.instagramAccountId values exist. Clean them up before applying this migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX "WhatsAppConnection_metaPhoneNumberId_key"
  ON "WhatsAppConnection"("metaPhoneNumberId");

CREATE UNIQUE INDEX "WhatsAppConnection_evolutionInstanceName_key"
  ON "WhatsAppConnection"("evolutionInstanceName");

CREATE UNIQUE INDEX "InstagramConnection_instagramAccountId_key"
  ON "InstagramConnection"("instagramAccountId");
