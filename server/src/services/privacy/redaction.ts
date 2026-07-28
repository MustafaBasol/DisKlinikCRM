/**
 * Privacy utility functions for the AI boundary.
 *
 * This module is THE single AI prompt privacy boundary for every active Gemini/
 * Google AI Studio call path (googleAiStudio.ts extraction + date-normalization,
 * whatsappAgentPrompt.ts conversation-agent decisions, whatsappStepAwareNlu.ts
 * step-aware classification). All three build a free-text prompt out of
 * customer-provided data — this module is what stands between that data and the
 * third-party AI provider.
 *
 * Rules enforced here:
 * - Only the first name (not full name) reaches the AI prompt.
 * - Message history is capped to a maximum count and per-message character limit.
 * - Phone-like, email-like, UUID/identifier-like, and token/credential-like
 *   strings are redacted from text before it is included in an AI prompt —
 *   this applies to the CURRENT/latest message as well as historical context,
 *   since the current message is exactly as customer-controlled as history.
 * - Logs always receive masked phone/email values, never raw ones, and never
 *   log a raw value next to its redacted form.
 * - Sanitization fails safe: if redaction itself throws, callers get back a
 *   fixed placeholder instead of the untouched original text.
 */

// Matches sequences that look like phone numbers: starts with an optional +,
// followed by at least 7 consecutive digit/separator characters. Kept broad so
// Turkish (0532 123 45 67, +90 532 123 45 67) and French (06 12 34 56 78,
// +33 6 12 34 56 78) formats are caught. A candidate is only treated as a phone
// number once it contains 9-15 digits (E.164 range) — this is what keeps an
// 8-digit Turkish date (27.07.2026) or a bare HH:MM time from being swallowed.
const PHONE_CANDIDATE_PATTERN = /(\+?\d[\d\s\-().]{5,}\d)/g;
const MIN_PHONE_DIGITS = 9;
const MAX_PHONE_DIGITS = 15;

// Standard email pattern.
const EMAIL_PATTERN = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Standard UUID (v1-v5) — e.g. patient/appointment/session identifiers.
const UUID_PATTERN = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;

// JWT-shaped values (header.payload.signature, header starts with base64 '{"').
const JWT_PATTERN = /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

// "Bearer <token>" authorization values.
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._-]{8,}/gi;

// key: value / key=value pairs where the key names a credential — the key name
// is kept (it carries no PII) but the value is replaced.
const SECRET_KEY_VALUE_PATTERN = /\b(api[_-]?key|apikey|secret|token|password|pwd|auth[_-]?token|cookie|bearer)\s*[:=]\s*"?'?[A-Za-z0-9._-]{4,}"?'?/gi;

// Catch-all for identifier/token-shaped strings that don't match the specific
// patterns above — malformed UUIDs, database-style ids (Mongo ObjectId, cuid,
// nanoid), or other credential-like blobs. Runs last: by then every legitimate
// match above has already been replaced with a short placeholder, so this only
// ever sees text that wasn't already redacted. Requires at least one digit in
// the run so ordinary long text (a repeated character, a long compound word)
// is never mistaken for an identifier — real ids/tokens are alnum mixes.
const LONG_IDENTIFIER_PATTERN = /\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}\b/g;

const FAILSAFE_PLACEHOLDER = '[REDACTED]';

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

const redactPhoneCandidates = (value: string): string =>
  value.replace(PHONE_CANDIDATE_PATTERN, (match) => {
    const digitCount = (match.match(/\d/g) ?? []).length;
    return digitCount >= MIN_PHONE_DIGITS && digitCount <= MAX_PHONE_DIGITS ? '[PHONE]' : match;
  });

/**
 * Replaces phone-like, email-like, UUID/identifier-like, and token/credential-
 * like substrings inside free text with placeholder tokens. This is the single
 * text-sanitization primitive every AI prompt builder in this codebase must
 * route customer-provided text through — the current/latest message as well
 * as historical context — before that text reaches a third-party AI provider.
 *
 * Deterministic and side-effect free. Fails safe: if anything here throws
 * (unexpected input shape, pathological regex input), the original text is
 * NOT returned — a fixed placeholder is, so a sanitization bug can never
 * result in raw customer text reaching the AI provider.
 */
export const redactSensitiveText = (value: string): string => {
  try {
    if (typeof value !== 'string') return FAILSAFE_PLACEHOLDER;
    let result = value;
    result = result.replace(JWT_PATTERN, '[TOKEN]');
    result = result.replace(BEARER_PATTERN, '[TOKEN]');
    result = result.replace(SECRET_KEY_VALUE_PATTERN, (_match, key: string) => `${key}: [TOKEN]`);
    result = result.replace(EMAIL_PATTERN, '[EMAIL]');
    result = result.replace(UUID_PATTERN, '[ID]');
    result = redactPhoneCandidates(result);
    result = result.replace(LONG_IDENTIFIER_PATTERN, '[ID]');
    return result;
  } catch {
    return FAILSAFE_PLACEHOLDER;
  }
};

/**
 * Returns only the first name from a full name string, redacted through the
 * same sanitizer as defense-in-depth (a name field that accidentally contains
 * a phone/email/token must not leak it). Returns null for empty input.
 *
 * This is the ONLY form of a patient/customer name that may reach an AI
 * prompt — never the full name, never a raw name string.
 */
export const getAiSafeFirstName = (fullName?: string | null): string | null => {
  try {
    const trimmed = fullName?.trim();
    if (!trimmed) return null;
    const firstToken = trimmed.split(/\s+/)[0];
    return firstToken ? redactSensitiveText(firstToken) : null;
  } catch {
    return null;
  }
};

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
