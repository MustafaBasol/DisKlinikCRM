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
 *  5. Metadata passes an explicit allowlist/sanitizer: keys matching a secret/
 *     credential/content pattern are dropped entirely (not merely redacted),
 *     string values are truncated, and total size/key-count is bounded.
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
import prisma from '../../db.js';
import type { Prisma } from '@prisma/client';

const MIN_SECRET_LENGTH = 32;
/** Clearly-labelled, non-production-only fallback — never used when NODE_ENV=production. */
const DEV_FALLBACK_SECRET = 'dev-only-insecure-security-signal-hash-secret-DO-NOT-USE-IN-PRODUCTION';

const MAX_USER_AGENT_INPUT_LENGTH = 512;
const MAX_METADATA_KEYS = 20;
const MAX_METADATA_STRING_LENGTH = 200;
const MAX_METADATA_JSON_BYTES = 4000;

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
 * Allowlist/sanitizer for safeMetadata. Never throws. Drops blocked keys
 * entirely, redacts email/phone-shaped substrings out of any string value,
 * truncates strings, bounds array/object nesting and key count, and caps
 * the final JSON size — so metadata can never be unbounded, never contains
 * secrets/tokens/paths, and never carries obvious patient-identifying
 * content through under an innocuous key name.
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
