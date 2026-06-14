-- Add purpose field to MessageTemplate
ALTER TABLE "MessageTemplate" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'general_message';

-- Backfill: appointment reminders (name contains reminder/hatırlatma)
UPDATE "MessageTemplate"
SET "purpose" = 'appointment_reminder'
WHERE lower("name") LIKE '%reminder%'
   OR lower("name") LIKE '%hatırlatma%'
   OR lower("name") LIKE '%hatirlama%'
   OR lower("name") LIKE '%hatirlatma%';

-- Backfill: payment reminders (name contains payment/ödeme — only if not already set)
UPDATE "MessageTemplate"
SET "purpose" = 'payment_reminder'
WHERE "purpose" = 'general_message'
  AND (lower("name") LIKE '%payment%'
    OR lower("name") LIKE '%ödeme%'
    OR lower("name") LIKE '%odeme%');

-- Backfill: appointment confirmations (name contains confirmation/onay)
UPDATE "MessageTemplate"
SET "purpose" = 'appointment_confirmation'
WHERE "purpose" = 'general_message'
  AND (lower("name") LIKE '%confirmation%'
    OR lower("name") LIKE '%onayı%'
    OR lower("name") LIKE '%onayi%'
    OR lower("name") LIKE '%onay%');

-- Backfill: no-show recovery (name contains no-show/gelmeyen)
UPDATE "MessageTemplate"
SET "purpose" = 'no_show_recovery'
WHERE "purpose" = 'general_message'
  AND (lower("name") LIKE '%no-show%'
    OR lower("name") LIKE '%no show%'
    OR lower("name") LIKE '%noshow%'
    OR lower("name") LIKE '%gelmeyen%');
