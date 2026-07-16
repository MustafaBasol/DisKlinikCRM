/**
 * passwordStepUp.ts — KVKK-HIGH-004 step-up (re-authentication) helpers.
 *
 * verifyCurrentPassword() extracts the exact password re-verification
 * pattern used by POST /api/auth/change-password (server/src/routes/auth.ts):
 * re-fetch the user by id, require the account to still exist and be
 * active, bcrypt.compare, never log/echo the supplied password.
 *
 * hashClientIp() is used by clinicBulkExportPasswordAttempts.ts to key the
 * Postgres-authoritative brute-force lockout table by IP WITHOUT ever
 * persisting a raw IP address. It uses a dedicated, required secret —
 * CLINIC_BULK_EXPORT_IP_HASH_SECRET — never JWT_SECRET, ENCRYPTION_KEY, or
 * any other existing app secret (see docs/compliance/54). When
 * CLINIC_BULK_EXPORT_ENABLED=true and this secret is missing or too weak,
 * assertIpHashSecretConfigured() throws — callers on every export-creation
 * and step-up-verification path must call it before doing any real work, so
 * a misconfigured deploy fails closed rather than silently hashing with an
 * absent/weak key.
 */

import bcrypt from 'bcryptjs';
import { createHmac } from 'node:crypto';
import prisma from '../db.js';

/** A fresh step-up (creation, or a re-verified password at download-token time)
 * remains usable without re-prompting for this long. Server-clock only —
 * never derived from a client-supplied timestamp. */
export const STEP_UP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

const MAX_PASSWORD_LENGTH = 200;
const MIN_IP_HASH_SECRET_LENGTH = 32;

export type PasswordStepUpFailure = 'empty' | 'oversized' | 'user_not_found' | 'user_inactive' | 'mismatch';

export interface PasswordStepUpResult {
  ok: boolean;
  failure?: PasswordStepUpFailure;
}

/**
 * Re-verifies the currently authenticated user's password. Never throws on
 * a wrong/missing password — returns a generic failure reason for internal
 * logic branching only; callers must map every failure to the same generic
 * user-facing error (CLINIC_BULK_EXPORT_STEP_UP_FAILED) so no distinction
 * between "wrong password" and "account issue" is ever leaked to the client.
 */
export async function verifyCurrentPassword(
  userId: string,
  suppliedPassword: unknown,
): Promise<PasswordStepUpResult> {
  if (typeof suppliedPassword !== 'string' || suppliedPassword.length === 0) {
    return { ok: false, failure: 'empty' };
  }
  if (suppliedPassword.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, failure: 'oversized' };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true, passwordHash: true },
  });

  if (!user) return { ok: false, failure: 'user_not_found' };
  if (!user.isActive) return { ok: false, failure: 'user_inactive' };

  const matches = await bcrypt.compare(suppliedPassword, user.passwordHash);
  if (!matches) return { ok: false, failure: 'mismatch' };

  return { ok: true };
}

/**
 * Throws if CLINIC_BULK_EXPORT_IP_HASH_SECRET is missing or below the
 * minimum strength bar. MUST be called at the top of every export-creation
 * and step-up-verification code path (not only at process boot) so a
 * misconfigured deploy fails closed on every request rather than only on
 * the first one.
 */
export function assertIpHashSecretConfigured(): void {
  if (!isIpHashSecretConfigured()) {
    throw new Error(
      'CLINIC_BULK_EXPORT_IP_HASH_SECRET is missing or too weak (must be a required, ' +
        `dedicated secret of at least ${MIN_IP_HASH_SECRET_LENGTH} characters, never reused ` +
        'from JWT_SECRET/ENCRYPTION_KEY/webhook secrets). Refusing to process clinic bulk ' +
        'export creation/step-up while CLINIC_BULK_EXPORT_ENABLED=true and this secret is ' +
        'unset.',
    );
  }
}

export function isIpHashSecretConfigured(): boolean {
  const secret = process.env.CLINIC_BULK_EXPORT_IP_HASH_SECRET;
  return Boolean(secret && secret.length >= MIN_IP_HASH_SECRET_LENGTH);
}

/**
 * HMAC-SHA256 of a client IP, keyed by CLINIC_BULK_EXPORT_IP_HASH_SECRET.
 * Never persist the raw IP — only this hash is stored in
 * ClinicBulkExportPasswordAttempt.ipHash. Throws if the secret is not
 * configured (call assertIpHashSecretConfigured() first for a clearer
 * failure path/message).
 */
export function hashClientIp(ip: string): string {
  const secret = process.env.CLINIC_BULK_EXPORT_IP_HASH_SECRET;
  if (!secret) {
    throw new Error('CLINIC_BULK_EXPORT_IP_HASH_SECRET is not configured');
  }
  return createHmac('sha256', secret).update(ip || 'unknown', 'utf8').digest('hex');
}

/** True if a prior step-up (creation, or a re-verified password at
 * download-token time) is still within the reuse window. Server-clock `now`
 * only — never derived from a client-supplied timestamp. */
export function isWithinStepUpWindow(stepUpVerifiedAt: Date | null, now: Date): boolean {
  if (!stepUpVerifiedAt) return false;
  return now.getTime() - stepUpVerifiedAt.getTime() < STEP_UP_WINDOW_MS;
}

/**
 * Actor-bound step-up window reuse check (KVKK-HIGH-004 remediation): a
 * still-fresh step-up window may only be reused WITHOUT a fresh password by
 * the exact user who most recently satisfied it. Without this, any
 * OWNER/ORG_ADMIN on the same archive could reuse a DIFFERENT user's recent
 * password verification just by knowing the jobId. A null
 * `stepUpVerifiedByUserId` (e.g. the original verifier was later
 * deactivated/deleted, per the SetNull relation) can never satisfy
 * passwordless reuse for anyone — it must fail closed, not open.
 */
export function isStepUpWindowReusableBy(
  row: { stepUpVerifiedAt: Date | null; stepUpVerifiedByUserId: string | null } | null,
  actorUserId: string,
  now: Date,
): boolean {
  return Boolean(
    row &&
      row.stepUpVerifiedByUserId !== null &&
      row.stepUpVerifiedByUserId === actorUserId &&
      isWithinStepUpWindow(row.stepUpVerifiedAt, now),
  );
}
