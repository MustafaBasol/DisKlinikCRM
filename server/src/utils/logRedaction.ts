/**
 * logRedaction.ts — Shared helpers for keeping PII out of operational logs.
 *
 * Matches the redaction format already established in server/src/routes/whatsapp.ts
 * and server/src/jobs/reminders.ts (`***` + last 4 digits) so new call sites don't
 * introduce a third, inconsistent phone-redaction shape.
 */

export const redactPhone = (phone: string | null | undefined) => {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length <= 4) return '***';
  return `***${digits.slice(-4)}`;
};

export const summarizeTextForLog = (text: string | null | undefined) => ({
  length: String(text ?? '').length,
});
