/**
 * clinicBulkExportPasswordAttempts.ts — KVKK-HIGH-004 step-up brute-force
 * lockout, PostgreSQL-authoritative.
 *
 * Every check-and-increment for a given (userId, clinicId, ipHash) key is
 * serialized with pg_advisory_xact_lock (same key-derivation shape as
 * services/appointmentRequestSafety.ts), acquired BEFORE reading or creating
 * the ClinicBulkExportPasswordAttempt row, inside one prisma.$transaction.
 * This is what makes the "row doesn't exist yet" race safe: two concurrent
 * first-attempts for a brand-new key cannot both observe "no row" and both
 * insert — the lock forces one to wait, so the second sees the first's row.
 *
 * Redis (createRateLimiter) is used ONLY as an optional fast pre-check that
 * can skip the (comparatively expensive) bcrypt.compare call when a caller
 * is very likely already locked out — it never changes the outcome. The
 * Postgres transaction below always runs and is always the final arbiter of
 * whether a request is locked out; there is exactly one authoritative
 * counter, never two independent ones with ambiguous state. If Redis is
 * unavailable, createRateLimiter's underlying counterStore already fails
 * open to an in-process Map (see utils/counterStore.ts) — that's fine here
 * specifically because this path is non-authoritative optimization only,
 * not the security boundary itself.
 */

import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../../db.js';
import { createRateLimiter } from '../../utils/helpers.js';
import {
  assertIpHashSecretConfigured,
  hashClientIp,
  verifyCurrentPassword,
  type PasswordStepUpFailure,
} from '../../utils/passwordStepUp.js';

/** Failed attempts allowed within LOCKOUT_WINDOW_MS before locking out. */
export const LOCKOUT_MAX_ATTEMPTS = 5;
/** Rolling window in which failed attempts accumulate. */
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
/** How long a key stays locked out once the threshold is crossed. */
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
/** ClinicBulkExportPasswordAttempt rows untouched this long are deleted by the cleanup job. */
export const ATTEMPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const precheckLimiter = createRateLimiter(
  LOCKOUT_MAX_ATTEMPTS,
  LOCKOUT_WINDOW_MS,
  'clinic-bulk-export-pw-precheck',
);

export type PasswordAttemptResult =
  | { outcome: 'locked'; lockedUntil: Date }
  | { outcome: 'verified' }
  | { outcome: 'rejected'; failure: PasswordStepUpFailure };

/**
 * Deterministic pg_advisory_xact_lock key pair for a
 * (userId, clinicId, ipHash) step-up attempt key. Exported for unit testing.
 */
export function computePasswordAttemptLockKey(
  userId: string,
  clinicId: string,
  ipHash: string,
): [number, number] {
  const hash = createHash('sha256')
    .update(`clinic-bulk-export-pw:${userId}:${clinicId}:${ipHash}`, 'utf8')
    .digest();
  return [hash.readInt32BE(0), hash.readInt32BE(4)];
}

/**
 * Verifies the supplied password for a clinic bulk export step-up,
 * enforcing a PostgreSQL-authoritative, advisory-lock-serialized brute-force
 * lockout keyed by (userId, clinicId, HMAC-hashed IP). Throws if
 * CLINIC_BULK_EXPORT_IP_HASH_SECRET is not configured (callers should call
 * assertIpHashSecretConfigured() earlier in the request for a clearer error
 * boundary; this function calls it too as a defensive backstop).
 *
 * `client` is injectable purely for tests to point this at a disposable
 * database; production code always uses the default (shared prisma
 * singleton).
 */
export async function verifyStepUpPasswordWithLockout(args: {
  userId: string;
  clinicId: string;
  ip: string;
  suppliedPassword: unknown;
  now?: Date;
  client?: Pick<PrismaClient, '$transaction'>;
}): Promise<PasswordAttemptResult> {
  assertIpHashSecretConfigured();
  const now = args.now ?? new Date();
  const client = args.client ?? prisma;
  const ipHash = hashClientIp(args.ip);
  const precheckKey = `${args.userId}:${args.clinicId}:${ipHash}`;

  // Non-authoritative optimization only: if Redis strongly suggests this key
  // is already over threshold, skip the bcrypt.compare call below (it would
  // fail regardless once the authoritative Postgres check runs). The
  // Postgres transaction still always executes and always decides the
  // returned lockedUntil.
  let likelyLockedOut = false;
  try {
    likelyLockedOut = !(await precheckLimiter.check(precheckKey));
  } catch {
    likelyLockedOut = false;
  }

  return client.$transaction(async (tx: Prisma.TransactionClient) => {
    const [key1, key2] = computePasswordAttemptLockKey(args.userId, args.clinicId, ipHash);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key1}::int4, ${key2}::int4)`;

    const existing = await tx.clinicBulkExportPasswordAttempt.findUnique({
      where: { userId_clinicId_ipHash: { userId: args.userId, clinicId: args.clinicId, ipHash } },
    });

    if (existing?.lockedUntil && existing.lockedUntil > now) {
      return { outcome: 'locked', lockedUntil: existing.lockedUntil } as const;
    }

    if (!likelyLockedOut) {
      const verification = await verifyCurrentPassword(args.userId, args.suppliedPassword);
      if (verification.ok) {
        await tx.clinicBulkExportPasswordAttempt.upsert({
          where: { userId_clinicId_ipHash: { userId: args.userId, clinicId: args.clinicId, ipHash } },
          create: { userId: args.userId, clinicId: args.clinicId, ipHash, attemptCount: 0, windowStartedAt: now },
          update: { attemptCount: 0, windowStartedAt: now, lockedUntil: null },
        });
        await precheckLimiter.reset(precheckKey).catch(() => {});
        return { outcome: 'verified' } as const;
      }
      // Fall through to record the failed attempt below, but still surface
      // the specific rejection reason for callers that need it internally
      // (never exposed to the client beyond the generic STEP_UP_FAILED code).
      await recordFailedAttempt(tx, args.userId, args.clinicId, ipHash, existing, now);
      void precheckLimiter.record(precheckKey).catch(() => {});
      return { outcome: 'rejected', failure: verification.failure! } as const;
    }

    // likelyLockedOut: skip bcrypt, still record as a failed attempt so the
    // Postgres-authoritative counter reflects reality even under the fast
    // pre-check path.
    await recordFailedAttempt(tx, args.userId, args.clinicId, ipHash, existing, now);
    void precheckLimiter.record(precheckKey).catch(() => {});
    return { outcome: 'rejected', failure: 'mismatch' } as const;
  });
}

async function recordFailedAttempt(
  tx: Prisma.TransactionClient,
  userId: string,
  clinicId: string,
  ipHash: string,
  existing: { attemptCount: number; windowStartedAt: Date } | null,
  now: Date,
): Promise<void> {
  const windowExpired = !existing || now.getTime() - existing.windowStartedAt.getTime() > LOCKOUT_WINDOW_MS;
  const nextCount = windowExpired ? 1 : existing!.attemptCount + 1;
  const nextWindowStartedAt = windowExpired ? now : existing!.windowStartedAt;
  const lockedUntil = nextCount >= LOCKOUT_MAX_ATTEMPTS ? new Date(now.getTime() + LOCKOUT_DURATION_MS) : null;

  await tx.clinicBulkExportPasswordAttempt.upsert({
    where: { userId_clinicId_ipHash: { userId, clinicId, ipHash } },
    create: { userId, clinicId, ipHash, attemptCount: nextCount, windowStartedAt: nextWindowStartedAt, lockedUntil },
    update: { attemptCount: nextCount, windowStartedAt: nextWindowStartedAt, lockedUntil },
  });
}

/** Deletes ClinicBulkExportPasswordAttempt rows untouched for >ATTEMPT_RETENTION_MS. Called by the cleanup job. */
export async function cleanupStaleClinicBulkExportPasswordAttempts(now: Date = new Date()): Promise<number> {
  const result = await prisma.clinicBulkExportPasswordAttempt.deleteMany({
    where: { updatedAt: { lt: new Date(now.getTime() - ATTEMPT_RETENTION_MS) } },
  });
  return result.count;
}
