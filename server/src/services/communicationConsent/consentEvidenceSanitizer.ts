/**
 * consentEvidenceSanitizer.ts - Bounds and redacts free-text evidence notes,
 * and hashes IP/user-agent evidence with a dedicated secret.
 *
 * Mirrors the conventions in services/security/securitySignalService.ts:
 *   - a dedicated hash secret, never reused from another module's secret
 *   - fail-closed in production when the secret is missing/weak
 *   - a fixed, clearly-labelled fallback in non-production so local dev/tests work
 *   - raw IP/user-agent are never stored, only the HMAC
 */

import { createHmac } from 'node:crypto';

const MIN_SECRET_LENGTH = 32;
const DEV_FALLBACK_SECRET =
  'dev-only-insecure-communication-consent-evidence-hash-secret-DO-NOT-USE-IN-PRODUCTION';

const MAX_NOTE_INPUT_CEILING = 20000;
const MAX_NOTE_LENGTH = 1000;
const MAX_USER_AGENT_INPUT_LENGTH = 512;

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_LIKE_PATTERN = /\d[\d\s().-]{6,}\d/g;

// Strips control characters (0x00-0x1F, 0x7F) except tab/LF/CR, expressed via
// \x escapes only - never embed literal control bytes in this source file.
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** Secret-like content that must never survive into a stored note, even if pasted by staff. */
const SECRET_LIKE_PATTERN =
  /bearer\s+[a-z0-9._-]{10,}|authorization\s*:|password\s*[:=]|api[_-]?key\s*[:=]|secret\s*[:=]|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function resolveEvidenceHashSecret(): string {
  const secret = process.env.COMMUNICATION_CONSENT_EVIDENCE_HASH_SECRET?.trim();
  if (secret && secret.length >= MIN_SECRET_LENGTH) return secret;

  if (isProduction()) {
    throw new Error(
      'COMMUNICATION_CONSENT_EVIDENCE_HASH_SECRET is missing or too weak (must be a dedicated ' +
        `secret of at least ${MIN_SECRET_LENGTH} characters, never reused from JWT_SECRET/` +
        'ENCRYPTION_KEY/SECURITY_SIGNAL_IP_HASH_SECRET/other webhook secrets). Refusing to hash ' +
        'in production.',
    );
  }

  console.warn(
    '[communication-consent] COMMUNICATION_CONSENT_EVIDENCE_HASH_SECRET is not configured - ' +
      'using a fixed, non-production fallback secret. Set a dedicated secret before deploying ' +
      'to production if IP/user-agent evidence capture is enabled.',
  );
  return DEV_FALLBACK_SECRET;
}

export function isCommunicationConsentEvidenceHashSecretConfigured(): boolean {
  const secret = process.env.COMMUNICATION_CONSENT_EVIDENCE_HASH_SECRET;
  return Boolean(secret && secret.trim().length >= MIN_SECRET_LENGTH);
}

/** HMAC-SHA256 of a raw client IP. Never persist the raw IP - only this hash. */
export function hashEvidenceIp(ip: string | null | undefined): string | null {
  if (!ip || ip === 'unknown') return null;
  const secret = resolveEvidenceHashSecret();
  return createHmac('sha256', secret).update(`consent-ip:${ip}`, 'utf8').digest('hex');
}

/** HMAC-SHA256 of a bounded, normalized user-agent string. Raw UA is never persisted. */
export function hashEvidenceUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const truncated = userAgent.slice(0, MAX_USER_AGENT_INPUT_LENGTH);
  const secret = resolveEvidenceHashSecret();
  return createHmac('sha256', secret).update(`consent-ua:${truncated}`, 'utf8').digest('hex');
}

export type SanitizeNoteResult =
  | { ok: true; note: string | null }
  | { ok: false; reason: 'unsafe_note' };

/**
 * Sanitize a staff-entered consent evidence note:
 *  - hard input ceiling before any regex work (bounds worst-case regex cost)
 *  - strips control characters
 *  - rejects outright if it looks like a secret/credential/token (never logs the raw value)
 *  - redacts email addresses and phone-like number runs
 *  - bounds final length
 */
export function sanitizeConsentNote(raw: string | null | undefined): SanitizeNoteResult {
  if (!raw) return { ok: true, note: null };
  const ceilinged = raw.slice(0, MAX_NOTE_INPUT_CEILING);

  if (SECRET_LIKE_PATTERN.test(ceilinged)) {
    return { ok: false, reason: 'unsafe_note' };
  }

  const stripped = ceilinged.replace(CONTROL_CHAR_PATTERN, '');
  const redacted = stripped
    .replace(EMAIL_PATTERN, '[redacted-email]')
    .replace(PHONE_LIKE_PATTERN, '[redacted-phone]')
    .trim();

  return { ok: true, note: redacted.length > 0 ? redacted.slice(0, MAX_NOTE_LENGTH) : null };
}
