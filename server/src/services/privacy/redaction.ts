/**
 * Privacy utility functions for the AI boundary.
 *
 * Rules enforced here:
 * - Only the first name (not full name) reaches the AI prompt.
 * - Message history is capped to a maximum count and per-message character limit.
 * - Phone-like and email-like strings embedded in user messages are redacted
 *   before the text is included in an AI prompt.
 * - Logs always receive masked phone/email values, never raw ones.
 */

// Matches sequences that look like phone numbers: starts with an optional +,
// followed by at least 7 consecutive digit/separator characters.
// Kept intentionally broad so Turkish formats (05xx, 90xx, +90xx) are caught.
const PHONE_PATTERN = /(\+?\d[\d\s\-().]{5,}\d)/g;

// Standard email pattern.
const EMAIL_PATTERN = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/**
 * Returns a masked version of a phone number suitable for logs.
 * Shows only the last 4 digits so staff can correlate without exposing the full number.
 */
export const maskPhone = (value: string | null | undefined): string => {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length <= 4) return '***';
  return `***${digits.slice(-4)}`;
};

/**
 * Returns a masked version of an email address suitable for logs.
 */
export const maskEmail = (value: string | null | undefined): string => {
  const s = String(value ?? '').trim();
  const atIndex = s.indexOf('@');
  if (atIndex < 0) return '***';
  const local = s.slice(0, atIndex);
  const domain = s.slice(atIndex + 1);
  const visibleLocal = local.length > 2 ? local.slice(0, 2) : local.slice(0, 1);
  return `${visibleLocal}***@${domain}`;
};

/**
 * Replaces phone-like and email-like substrings inside free text with tokens.
 * Used before including user-typed messages in AI prompts so that numbers the
 * user happens to paste are not forwarded to a third-party AI provider.
 */
export const redactSensitiveText = (value: string): string =>
  value
    .replace(EMAIL_PATTERN, '[EMAIL]')
    .replace(PHONE_PATTERN, '[PHONE]');

/**
 * Builds the minimum patient context object that should be forwarded to the AI.
 * Only the first name is included — not the full name, DOB, address, phone, or
 * any medical / financial field.
 */
export const buildSafeAiPatientContext = (patient: {
  firstName?: string | null;
}): { firstName: string | null } => ({
  firstName: patient.firstName?.trim() || null,
});

export type AiMessage = {
  direction: 'incoming' | 'outgoing';
  text: string;
};

const DEFAULT_MAX_MESSAGE_COUNT = 10;
const DEFAULT_MAX_TEXT_LENGTH = 300;

/**
 * Trims and redacts a list of messages before they are included in an AI prompt.
 *
 * - Keeps only the most recent `maxCount` messages.
 * - Truncates each message body to `maxTextLength` characters.
 * - Optionally replaces phone/email patterns with placeholder tokens.
 */
export const sanitizeAiMessageHistory = (
  messages: AiMessage[],
  options?: {
    maxCount?: number;
    maxTextLength?: number;
    redactPii?: boolean;
  },
): AiMessage[] => {
  const maxCount = options?.maxCount ?? DEFAULT_MAX_MESSAGE_COUNT;
  const maxTextLength = options?.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH;
  const shouldRedact = options?.redactPii ?? true;

  return messages.slice(-maxCount).map((msg) => {
    let text = msg.text.slice(0, maxTextLength);
    if (shouldRedact) text = redactSensitiveText(text);
    return { direction: msg.direction, text };
  });
};
