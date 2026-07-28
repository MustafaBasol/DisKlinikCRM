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
 * - No form of the customer/patient's real name reaches the AI prompt — not the
 *   full name, not even a first name. A fixed pseudonym (AI_CUSTOMER_NAME_PLACEHOLDER,
 *   via getAiCustomerNamePlaceholder) is sent instead wherever "the customer's name"
 *   would otherwise be included as prompt context. The app may still keep and use the
 *   real name locally (DB records, patient matching, outbound messages sent directly
 *   to the customer) — this only governs what crosses the boundary to the AI provider.
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

// A calendar date (DD.MM.YYYY, DD-MM-YYYY, or ISO YYYY-MM-DD) immediately
// followed by whitespace and a clock time is the single most common way a
// customer types a specific appointment request ("27.07.2026 14:00"). Dates
// and times use the same digit/separator characters as a phone number, so
// digit-count alone would otherwise swallow the whole date+time into one
// [PHONE] match (verified: "27.07.2026 14:00" -> "[PHONE]:00", destroying
// both the date and the time). Recognized via calendar/clock range
// validation (not just shape) so an actual phone number is not exempted by
// coincidence.
const DMY_DATE_PATTERN = /^(\d{1,2})[.\-](\d{1,2})[.\-](\d{2,4})$/;
const YMD_DATE_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const isValidCalendarDay = (day: number) => day >= 1 && day <= 31;
const isValidCalendarMonth = (month: number) => month >= 1 && month <= 12;

const isCalendarDateShape = (token: string): boolean => {
  const dmy = token.match(DMY_DATE_PATTERN);
  if (dmy) {
    const [, day, month] = dmy;
    return isValidCalendarDay(Number(day)) && isValidCalendarMonth(Number(month));
  }
  const ymd = token.match(YMD_DATE_PATTERN);
  if (ymd) {
    const [, , month, day] = ymd;
    return isValidCalendarDay(Number(day)) && isValidCalendarMonth(Number(month));
  }
  return false;
};

// True when a phone-shaped candidate is actually "<date> <time>": either the
// time survives in the match verbatim (dot-separated, e.g. "14.00") or it was
// truncated to a bare hour because ':' is not part of the phone character
// class (e.g. "27.07.2026 14" immediately followed by ":00" in the source).
const isDateFollowedByTime = (candidate: string, offset: number, fullString: string): boolean => {
  const parts = candidate.trim().split(/\s+/);
  if (parts.length !== 2 || !isCalendarDateShape(parts[0])) return false;
  const [, timePart] = parts;
  if (/^\d{1,2}\.\d{2}$/.test(timePart)) return true;
  return /^\d{1,2}$/.test(timePart) && fullString[offset + candidate.length] === ':';
};

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
//
// Only the key + separator is matched by regex; the value itself is parsed by
// redactCredentialKeyValues below using bounded scanning rather than a fixed
// character class. A character-class-based value pattern (e.g.
// [A-Za-z0-9._-]+) stops at the FIRST character outside that class and
// silently leaves everything after it as plain text — which is exactly how a
// credential containing punctuation ("Sup3r!Secret", "abc123+/==",
// "sk-test_123!more", "value-with-$pecial#chars") leaked its tail. Bounded
// scanning instead treats "value" as "everything up to the next clear
// terminator" (whitespace, end of line/string, or a matching closing quote),
// which fully consumes punctuation-bearing credentials while still stopping
// before ordinary prose that follows on the same line (prose is always
// separated from the credential by whitespace).
const CREDENTIAL_KEY_PATTERN = /\b(api[_-]?key|apikey|secret|token|password|pwd|auth[_-]?token|cookie|bearer)\s*[:=]\s*/gi;

// A trailing character directly touching the terminator (whitespace/EOL) that
// looks like sentence punctuation is treated as surrounding prose rather than
// part of the credential value — e.g. "token=abc123." at the end of a
// sentence redacts to "token: [TOKEN]." instead of swallowing the period into
// the placeholder. Only applies to the single run of trailing characters
// immediately before the terminator, never to punctuation in the middle of
// the value (so "Sup3r!Secret" is unaffected — the "!" is not at the end).
const SENTENCE_TERMINATOR_CHARS = new Set(['.', ',', ';', ':', '!', '?']);

/**
 * Replaces key:value / key=value credential-shaped substrings with
 * `key: [TOKEN]`, fully consuming the value via bounded parsing (see
 * CREDENTIAL_KEY_PATTERN above) instead of a fixed character class — no
 * suffix of a punctuation-bearing credential is left unredacted.
 */
const redactCredentialKeyValues = (value: string): string => {
  let result = '';
  let cursor = 0;
  CREDENTIAL_KEY_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CREDENTIAL_KEY_PATTERN.exec(value)) !== null) {
    const keyName = match[1];
    const valueStart = match.index + match[0].length;
    result += value.slice(cursor, match.index);

    let valueEnd: number;
    let trailingPunctuation = '';
    const openingQuote = value[valueStart] === '"' || value[valueStart] === "'" ? value[valueStart] : null;

    if (openingQuote) {
      // Bounded by the matching closing quote — or end of line/string if the
      // quote is never closed, so a stray opening quote can't run away with
      // the rest of the document.
      let i = valueStart + 1;
      while (i < value.length && value[i] !== openingQuote && value[i] !== '\n') i++;
      valueEnd = value[i] === openingQuote ? i + 1 : i;
    } else {
      // Unquoted: bounded by whitespace or end of string. Whitespace is a
      // clear terminator that is never part of a credential value, so this
      // never consumes prose that follows on the same line.
      let i = valueStart;
      while (i < value.length && !/\s/.test(value[i])) i++;
      valueEnd = i;
      // Peel sentence-ending punctuation off the very end of the run (never
      // all the way down to nothing) and re-attach it after the placeholder.
      while (valueEnd > valueStart + 1 && SENTENCE_TERMINATOR_CHARS.has(value[valueEnd - 1])) {
        trailingPunctuation = value[valueEnd - 1] + trailingPunctuation;
        valueEnd--;
      }
    }

    result += `${keyName}: [TOKEN]${trailingPunctuation}`;
    cursor = valueEnd;
    CREDENTIAL_KEY_PATTERN.lastIndex = valueEnd;
  }
  result += value.slice(cursor);
  return result;
};

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
  value.replace(PHONE_CANDIDATE_PATTERN, (match, _group, offset: number, fullString: string) => {
    if (isDateFollowedByTime(match, offset, fullString)) return match;
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
    result = redactCredentialKeyValues(result);
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
 * General-purpose name-minimization utility — NOT used by any active AI prompt
 * builder (see getAiCustomerNamePlaceholder below, which is what those use: no
 * form of the real name, not even the first name, is sent to the AI provider).
 * Kept for any caller that has a genuine need for a first-name-only value that
 * isn't an AI prompt (e.g. deterministic local business logic).
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

// Fixed pseudonym stood in for the customer's real name on every AI prompt
// path. No active Gemini call site depends on the real (or even redacted
// first) name for correctness: intent/action classification and slot
// extraction are driven by the message text itself, and any name the model
// extracts comes from parsing that message text (already routed through
// redactSensitiveText) — never from this context field. It exists purely so
// the model has a stable token to refer to "the person I'm talking to" if a
// reply needs to address them, without the real name ever leaving the
// application boundary. The app is free to keep the real name locally (DB
// records, patient matching, outbound message templating sent directly to
// the customer) — this constant only governs what is sent TO the AI provider.
export const AI_CUSTOMER_NAME_PLACEHOLDER = '[CUSTOMER]';

/**
 * Returns the fixed AI_CUSTOMER_NAME_PLACEHOLDER when a customer/patient name
 * is known, or null when no name is known yet — never the real name. This is
 * the ONLY form a customer/patient name may take in an AI prompt.
 */
export const getAiCustomerNamePlaceholder = (fullName?: string | null): string | null => {
  const trimmed = fullName?.trim();
  return trimmed ? AI_CUSTOMER_NAME_PLACEHOLDER : null;
};

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
