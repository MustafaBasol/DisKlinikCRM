-- WhatsAppConversationMessage.patientId becomes nullable so that inbound/outbound
-- WhatsApp messages are persisted even before a patient is resolved/linked.
-- Existing rows are unaffected; unlinked messages are backfilled when staff links
-- the conversation to a patient.
ALTER TABLE "WhatsAppConversationMessage" ALTER COLUMN "patientId" DROP NOT NULL;
