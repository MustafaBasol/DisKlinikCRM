/**
 * securitySignalService.ts — KVKK-CRIT-003 security-signal capture.
 *
 * Central entry point for recording security-relevant raw evidence
 * (SecuritySignalEvent, append-only). This is NOT the incident record —
 * see securityIncidentService.ts for the mutable, deduplicated
 * SecurityIncident aggregate a Platform Admin actually works.
 *
 * Hard rules enforced here (see docs/compliance/55-kvkk-security-incident-response-foundation.md):
 *  1. Raw IP addresses are never stored — only HMAC-SHA256(SECURITY_SIGNAL_IP_HASH_SECRET, ip).
 *  2. SECURITY_SIGNAL_IP_HASH_SECRET is dedicated: never JWT_SECRET, ENCRYPTION_KEY,
 *     any webhook secret, or CLINIC_BULK_EXPORT_IP_HASH_SECRET.
 *  3. In production a missing/weak secret fails closed for IP/identifier hashing
 *     (recordSecuritySignal swallows the resulting error — see rule 7 below).
 *     In non-production, a safe warning is logged and a fixed, clearly-labelled
 *     test-only fallback secret is used so local dev/tests keep working.
 *  4. User-agent is never stored raw — only a bounded SHA-256 fingerprint of a
 *     truncated, normalized string.
 *  5. Metadata is gated by TWO layers, not one:
 *       a. an explicit, closed, per-rule-family field allowlist (Zod schema
 *          — see AUTH_SIGNAL_METADATA_SCHEMA / CROSS_TENANT_SIGNAL_METADATA_SCHEMA /
 *          EXPORT_SIGNAL_METADATA_SCHEMA / INCIDENT_ACTIVITY_METADATA_SCHEMA below),
 *          applied by each detection rule at the exact call site that knows
 *          which family it belongs to — unknown keys are dropped, values with
 *          the wrong type drop the whole object (fail-closed);
 *       b. sanitizeSecurityMetadata(), a generic SECOND-layer guard applied
 *          after (a): keys matching a secret/credential/content-pattern
 *          DENYLIST are dropped entirely (not merely redacted), string
 *          values are redaction-scrubbed and truncated, and total
 *          size/key-count is bounded. This layer is defense-in-depth ONLY —
 *          it must never be the sole gate on caller-supplied metadata, since
 *          a denylist can only ever block what it already knows to name.
 *  6. recordSecuritySignal() NEVER throws — a signal-recording failure must
 *     never break the primary request (login, clinic access, export). This
 *     mirrors writeAuditLog()/recordOperationalEvent()'s existing swallow-all
 *     convention. It must also never be used to turn a rejection into an
 *     allow: callers make their allow/deny decision independently and call
 *     this purely for observability, so a swallowed failure here changes
 *     nothing about that decision.
 *  7. Durable, database-backed deduplication/counting only (SecuritySignalEvent
 *     rows + countSignalsInWindow()) — never in-memory-only, never Redis-only.
 */

import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import prisma from '../../db.js';
import type { Prisma } from '@prisma/client';

const MIN_SECRET_LENGTH = 32;
/** Clearly-labelled, non-production-only fallback — never used when NODE_ENV=production. */
const DEV_FALLBACK_SECRET = 'dev-only-insecure-security-signal-hash-secret-DO-NOT-USE-IN-PRODUCTION';

const MAX_USER_AGENT_INPUT_LENGTH = 512;
const MAX_METADATA_KEYS = 20;
const MAX_METADATA_STRING_LENGTH = 200;
const MAX_METADATA_JSON_BYTES = 4000;

/** Final stored length for a Platform-Admin-entered operator text field. */
const MAX_OPERATOR_TEXT_LENGTH = 2000;
/** Hard ceiling applied before any regex scanning, independent of the final bound above — bounds worst-case regex work on a pathologically long paste. */
const MAX_OPERATOR_TEXT_INPUT_CEILING = 20000;

/** Keys rejected outright from safeMetadata (case-insensitive substring match). */
const BLOCKED_METADATA_KEY_PATTERN =
  /password|passwordhash|token|secret|authoriz|cookie|\bbody\b|rawpayload|messagetext|accesstoken|storagekey|filepath|exportpath/i;

/** Heuristic content patterns that must never survive into stored metadata, even under an allowed key. */
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_LIKE_PATTERN = /\d[\d\s().-]{6,}\d/g;

export type SecuritySignalSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface RecordSecuritySignalInput {
  signalType: string;
  category: string;
  severity: SecuritySignalSeverity;
  ruleKey: string;
  /** Grouping key for durable windowed-threshold counting (already-safe value, e.g. a hash). */
  dedupeDimension: string;
  organizationId?: string | null;
  clinicId?: string | null;
  actorUserId?: string | null;
  actorPlatformAdminId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  resourceType?: string | null;
  /** Already-safe resource identifier (e.g. hashClinicOrResourceId output) — never a raw guessed id. */
  resourceId?: string | null;
  safeMetadata?: Record<string, unknown> | null;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function resolveHashSecret(): string {
  const secret = process.env.SECURITY_SIGNAL_IP_HASH_SECRET?.trim();
  if (secret && secret.length >= MIN_SECRET_LENGTH) return secret;

  if (isProduction()) {
    throw new Error(
      'SECURITY_SIGNAL_IP_HASH_SECRET is missing or too weak (must be a dedicated secret of at ' +
        `least ${MIN_SECRET_LENGTH} characters, never reused from JWT_SECRET/ENCRYPTION_KEY/webhook ` +
        'secrets/CLINIC_BULK_EXPORT_IP_HASH_SECRET). Refusing to hash in production.',
    );
  }

  console.warn(
    '[security-signal] SECURITY_SIGNAL_IP_HASH_SECRET is not configured — using a fixed, ' +
      'non-production fallback secret. Set a dedicated secret before deploying to production.',
  );
  return DEV_FALLBACK_SECRET;
}

export function isSecuritySignalHashSecretConfigured(): boolean {
  const secret = process.env.SECURITY_SIGNAL_IP_HASH_SECRET;
  return Boolean(secret && secret.trim().length >= MIN_SECRET_LENGTH);
}

/** HMAC-SHA256 of a raw client IP. Never persist the raw IP — only this hash. */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip || ip === 'unknown') return null;
  const secret = resolveHashSecret();
  return createHmac('sha256', secret).update(`ip:${ip}`, 'utf8').digest('hex');
}

/**
 * HMAC-SHA256 of a normalized account identifier (e.g. lowercased/trimmed
 * email). Domain-separated from hashIp() via a purpose prefix even though
 * both share SECURITY_SIGNAL_IP_HASH_SECRET, so the two hash spaces can
 * never collide.
 */
export function hashAccountIdentifier(identifier: string | null | undefined): string | null {
  if (!identifier) return null;
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) return null;
  const secret = resolveHashSecret();
  return createHmac('sha256', secret).update(`account:${normalized}`, 'utf8').digest('hex');
}

/** HMAC-SHA256 of a resource identifier (e.g. an attempted-but-denied clinicId). */
export function hashResourceId(resourceId: string | null | undefined): string | null {
  if (!resourceId) return null;
  const secret = resolveHashSecret();
  return createHmac('sha256', secret).update(`resource:${resourceId}`, 'utf8').digest('hex');
}

/**
 * Bounded, non-reversible user-agent fingerprint. Truncates before hashing
 * so a pathologically long header can never inflate storage, and returns a
 * plain SHA-256 (no secret needed — a UA string is not itself confidential,
 * this is purely for bounding/normalization, not secrecy).
 */
export function fingerprintUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const bounded = userAgent.slice(0, MAX_USER_AGENT_INPUT_LENGTH).trim();
  if (!bounded) return null;
  return createHash('sha256').update(bounded, 'utf8').digest('hex');
}

function redactContentPatterns(value: string): string {
  return value.replace(EMAIL_PATTERN, '[redacted-email]').replace(PHONE_LIKE_PATTERN, '[redacted-number]');
}

function sanitizeMetadataValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    return redactContentPatterns(value).slice(0, MAX_METADATA_STRING_LENGTH);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 2) return '[nested-value-omitted]';
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((entry) => sanitizeMetadataValue(entry, depth + 1));
  }
  if (typeof value === 'object') {
    return sanitizeMetadataObject(value as Record<string, unknown>, depth + 1);
  }
  // functions, symbols, etc. — never serialize
  return null;
}

function sanitizeMetadataObject(input: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(input)) {
    if (count >= MAX_METADATA_KEYS) break;
    if (BLOCKED_METADATA_KEY_PATTERN.test(key)) continue; // reject outright, never even redact-in-place
    out[key] = sanitizeMetadataValue(value, depth);
    count += 1;
  }
  return out;
}

/**
 * Generic, SECOND-layer metadata guard. This is a DENYLIST, not an
 * allowlist — it accepts any key that doesn't match
 * BLOCKED_METADATA_KEY_PATTERN, so on its own it cannot stop an unknown
 * innocuous-looking key (e.g. "debugContext") from being stored. The actual
 * allowlisting happens per rule family BEFORE this function runs (see
 * AUTH_SIGNAL_METADATA_SCHEMA / CROSS_TENANT_SIGNAL_METADATA_SCHEMA /
 * EXPORT_SIGNAL_METADATA_SCHEMA / INCIDENT_ACTIVITY_METADATA_SCHEMA and
 * sanitizeRuleMetadata() below) — this function only ever sees whatever
 * survived that closed field list, and exists to additionally bound
 * size/nesting, truncate strings, redact email/phone-shaped substrings, and
 * drop any denylisted key name as defense-in-depth should a schema above
 * ever be misconfigured. Never throws.
 */
export function sanitizeSecurityMetadata(
  input: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!input || typeof input !== 'object') return null;
  try {
    const sanitized = sanitizeMetadataObject(input, 0);
    let json = JSON.stringify(sanitized);
    if (json.length > MAX_METADATA_JSON_BYTES) {
      // Oversized even after per-field bounding (e.g. many keys) — drop keys
      // from the end until it fits, rather than storing a truncated/invalid
      // JSON fragment.
      const entries = Object.entries(sanitized);
      while (entries.length > 0 && json.length > MAX_METADATA_JSON_BYTES) {
        entries.pop();
        json = JSON.stringify(Object.fromEntries(entries));
      }
      return Object.fromEntries(entries);
    }
    return sanitized;
  } catch {
    return null;
  }
}

// ── Explicit per-rule metadata allowlists ────────────────────────────────
//
// One closed Zod schema per rule family — every field a rule is allowed to
// attach to a SecuritySignalEvent.safeMetadata or SecurityIncident.metadata
// value is named here explicitly. Anything not listed is dropped (Zod's
// default "strip" behavior for a plain z.object schema, not `.strict()`,
// which would throw instead — dropping keeps this fail-closed without ever
// throwing). A field that IS listed but has the wrong type drops the whole
// object rather than partially validating it.

const boundedMetaString = (max: number) => z.string().max(max);
const boundedMetaNumber = z.number().finite();

/** Rule 1 (auth.brute_force.v1) — auth login-failure signal + incident metadata. */
export const AUTH_SIGNAL_METADATA_SCHEMA = z.object({
  context: boundedMetaString(50).optional(),
  occurrenceCountAtDetection: boundedMetaNumber.optional(),
  windowMinutes: boundedMetaNumber.optional(),
});

/** Rule 2 (access.cross_tenant.v1) — cross-tenant denial signal + incident metadata. */
export const CROSS_TENANT_SIGNAL_METADATA_SCHEMA = z.object({
  method: boundedMetaString(20).optional(),
  routeTemplate: boundedMetaString(200).optional(),
  occurrenceCountAtDetection: boundedMetaNumber.optional(),
  distinctResourceCount: boundedMetaNumber.optional(),
  windowMinutes: boundedMetaNumber.optional(),
});

/** Rule 3 (export.*.v1 — step-up lockout, token replay, generation integrity, cleanup failure, request burst). */
export const EXPORT_SIGNAL_METADATA_SCHEMA = z.object({
  reason: boundedMetaString(50).optional(),
  failureCode: boundedMetaString(100).optional(),
  occurrenceCountAtDetection: boundedMetaNumber.optional(),
  distinctClinicCount: boundedMetaNumber.optional(),
  windowMinutes: boundedMetaNumber.optional(),
});

/**
 * SecurityIncidentActivity.metadata for the lifecycle/aggregation events
 * securityIncidentService.ts constructs itself (never Platform-Admin free
 * text — see sanitizeSecurityOperatorText for that): severity_escalated,
 * the reopen-linkage on a recurrence 'created' activity, and assign/unassign.
 */
export const INCIDENT_ACTIVITY_METADATA_SCHEMA = z.object({
  newSeverity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  reopenedFromIncidentId: boundedMetaString(100).optional(),
  assignedToPlatformAdminId: boundedMetaString(100).nullable().optional(),
});

/**
 * Applies an explicit per-rule-family schema BEFORE the generic
 * sanitizeSecurityMetadata() denylist pass (see that function's docstring
 * for why both layers are required). Never throws — a schema mismatch drops
 * the whole object (fail-closed) rather than propagating a ZodError.
 */
export function sanitizeRuleMetadata(
  schema: z.ZodTypeAny,
  input: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!input || typeof input !== 'object') return null;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return null;
  return sanitizeSecurityMetadata(parsed.data as Record<string, unknown>);
}

// ── Platform-Admin operator free-text sanitization ──────────────────────

/**
 * C0 (except tab and newline) + C1 control characters + DEL — never
 * legitimate in an operator-typed field. Built from explicit character
 * codes (not a regex literal) so the control-character ranges stay
 * unambiguous and no raw control bytes ever appear in this source file.
 */
const OPERATOR_TEXT_CONTROL_CHAR_CODES: ReadonlySet<number> = new Set([
  ...Array.from({ length: 0x20 }, (_, code) => code).filter((code) => code !== 0x09 && code !== 0x0a),
  0x7f,
  ...Array.from({ length: 0x20 }, (_, offset) => 0x80 + offset),
]);

function stripControlCharacters(value: string): string {
  let out = '';
  for (const ch of value) {
    if (!OPERATOR_TEXT_CONTROL_CHAR_CODES.has(ch.codePointAt(0) ?? -1)) out += ch;
  }
  return out;
}

/**
 * Structured-secret shapes that must reject the ENTIRE field rather than be
 * partially redacted (unlike email/phone, above): a bearer token, password,
 * cookie/session value, API key, or a download/reset/access token embedded
 * in operator-typed text is not something that can be safely truncated to a
 * marker in place — the only safe move is to force the operator to rewrite
 * the note without it.
 */
const UNSAFE_OPERATOR_TEXT_PATTERNS: RegExp[] = [
  /\bbearer\s+[a-z0-9._~+/-]{8,}=*/i,
  /\bauthoriz(?:e|ation)\s*[:=]/i,
  /\b(pass(?:word)?|pwd)\s*[:=]\s*\S+/i,
  /\b(access|refresh|reset|download|api|auth|session|csrf|bearer)[-_ ]?token\s*[:=]\s*\S+/i,
  /\bapi[-_]?key\s*[:=]\s*\S+/i,
  /\bcookie\s*[:=]/i,
  /\bset-cookie\s*[:=]/i,
  /\bsession(?:id)?\s*[:=]\s*\S{6,}/i,
  // Common vendor API-key shapes even without an explicit "key:" label.
  /\b(sk|pk|rk)_(live|test)_[a-z0-9]{10,}/i,
  // Filesystem / storage-object paths (never operator-relevant content).
  /(^|[\s"'(])(\/[\w.-]+){2,}\.(zip|pdf|csv|json|xlsx?|png|jpe?g|db|sql|log|txt)\b/i,
  /[a-zA-Z]:\\[^\s"']+/,
  /\bs3:\/\/\S+/i,
  /\b(uploads|exports)\/\S+/i,
];

/** Text that survived sanitization but is only redaction markers/whitespace carries no operator meaning. */
const ONLY_REDACTION_MARKERS_PATTERN = /^(\s|\[redacted-(email|number)\])*$/;

/**
 * Sanitizer for Platform-Admin-entered free text on a SecurityIncident
 * (containment/resolution/false-positive/reopen summaries, activity notes).
 * Unlike sanitizeSecurityMetadata() (a structured-object key allowlist),
 * this guards a single free-text field: an admin investigating an incident
 * can accidentally paste patient PII, clinical detail, or a literal
 * credential/token/path copied from logs.
 *
 * Never logs, and never returns, the raw rejected input — a rejection is
 * always just `null`, so a caller cannot accidentally leak it into an error
 * response or log line.
 *
 * Returns `null` if the input is not a string, becomes empty after
 * stripping/redaction, contains a structured-secret pattern, or reduces to
 * nothing but redaction markers. Callers treat `null` the same as an empty
 * field (e.g. 'summary_required' for the required lifecycle fields).
 */
export function sanitizeSecurityOperatorText(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;

  let value = raw.slice(0, MAX_OPERATOR_TEXT_INPUT_CEILING);
  value = stripControlCharacters(value).trim();
  if (!value) return null;

  for (const pattern of UNSAFE_OPERATOR_TEXT_PATTERNS) {
    if (pattern.test(value)) return null;
  }

  value = redactContentPatterns(value).slice(0, MAX_OPERATOR_TEXT_LENGTH).trim();
  if (!value || ONLY_REDACTION_MARKERS_PATTERN.test(value)) return null;

  return value;
}

/**
 * Records one raw security-signal occurrence. NEVER throws — see rule 6 in
 * the file header. Callers should fire this without awaiting-and-handling
 * errors themselves (though it is safe to await for ordering).
 */
export async function recordSecuritySignal(input: RecordSecuritySignalInput): Promise<void> {
  try {
    const ipHash = hashIp(input.ipAddress ?? null);
    const userAgentFingerprint = fingerprintUserAgent(input.userAgent ?? null);
    const safeMetadata = sanitizeSecurityMetadata(input.safeMetadata ?? null);

    await prisma.securitySignalEvent.create({
      data: {
        signalType: input.signalType,
        category: input.category,
        severity: input.severity,
        ruleKey: input.ruleKey,
        organizationId: input.organizationId ?? null,
        clinicId: input.clinicId ?? null,
        actorUserId: input.actorUserId ?? null,
        actorPlatformAdminId: input.actorPlatformAdminId ?? null,
        ipHash,
        userAgentFingerprint,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        dedupeDimension: input.dedupeDimension,
        safeMetadata: safeMetadata != null ? (safeMetadata as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch (err) {
    // Signal-recording failure must never break the primary request, and
    // must never be interpreted as permission to change an allow/deny
    // decision that already happened independently of this call.
    console.error('[security-signal] Failed to record signal:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Durable, database-backed count of signals matching (ruleKey,
 * dedupeDimension) within the last windowMs. Used by threshold-based
 * detection rules to decide whether to escalate to a SecurityIncident.
 * Returns 0 (never throws) on failure — callers should treat that as "below
 * threshold" rather than block the primary request.
 */
export async function countSignalsInWindow(params: {
  ruleKey: string;
  dedupeDimension: string;
  windowMs: number;
  now?: Date;
}): Promise<number> {
  try {
    const now = params.now ?? new Date();
    return await prisma.securitySignalEvent.count({
      where: {
        ruleKey: params.ruleKey,
        dedupeDimension: params.dedupeDimension,
        createdAt: { gte: new Date(now.getTime() - params.windowMs) },
      },
    });
  } catch (err) {
    console.error('[security-signal] Failed to count signals in window:', err instanceof Error ? err.message : String(err));
    return 0;
  }
}
