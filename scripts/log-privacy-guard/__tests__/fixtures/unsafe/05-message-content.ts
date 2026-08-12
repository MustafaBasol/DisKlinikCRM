// Fixture: raw inbound message text logged in a messaging-processing catch.
// Expected: exactly one MESSAGE_CONTENT finding.
declare function processInbound(message: { text: string }): void;

export function unsafeMessageContent(message: { text: string }) {
  try {
    processInbound(message);
  } catch {
    console.error('[whatsapp] inbound processing failed', message.text);
  }
}
