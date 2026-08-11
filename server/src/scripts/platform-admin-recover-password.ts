/**
 * platform-admin-recover-password.ts — R-061 controlled PlatformAdmin
 * password recovery CLI.
 *
 * Usage:
 *   cd server
 *   npx tsx src/scripts/platform-admin-recover-password.ts \
 *     --email admin@example.com --confirm-email admin@example.com --dry-run
 *
 *   npx tsx src/scripts/platform-admin-recover-password.ts \
 *     --email admin@example.com --confirm-email admin@example.com --confirm
 *
 * See docs/program/evidence/R061_PLATFORM_ADMIN_PASSWORD_RECOVERY_RUNBOOK.md
 * for the full operator procedure. This script never accepts a password via
 * argv/env/piped-stdin — it only reads the new password (twice) from a
 * hidden interactive TTY prompt, and it never prints the password, its
 * hash, or the account's full ID.
 *
 * Session invalidation: PlatformAdmin has no persistent session table and
 * no `passwordChangedAt` marker (unlike the clinic `User` model — see
 * middleware/auth.ts). JWT sessions are stateless and cannot be revoked by
 * this script; see the runbook for the proposed follow-up migration. This
 * is a documented architecture gap, not an omission.
 */

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import prisma from '../db.js';
import { validatePassword } from '../utils/helpers.js';
import {
  writePlatformAdminAuditEventInTx,
  type PlatformAdminAuditEventInput,
} from '../services/platformAdminAudit.js';

const BCRYPT_COST_FACTOR = 12; // matches bcrypt.hash(..., 12) used elsewhere in this codebase

export class RecoveryRefusalError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RecoveryRefusalError';
    this.code = code;
  }
}

// ─── Argv parsing ────────────────────────────────────────────────────────────

const FORBIDDEN_ARGV_FLAGS = new Set([
  '--password',
  '--new-password',
  '--newpassword',
  '--confirm-password',
  '--pass',
  '--pwd',
]);

export interface ParsedCliArgs {
  email?: string;
  confirmEmail?: string;
  dryRun: boolean;
  confirm: boolean;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const forbidden = argv.find((arg) => FORBIDDEN_ARGV_FLAGS.has(arg.toLowerCase()));
  if (forbidden) {
    throw new RecoveryRefusalError(
      'PASSWORD_VIA_ARGV_REJECTED',
      `Refusing to run: "${forbidden}" is not accepted. The new password must be entered only via the hidden interactive prompt.`,
    );
  }

  const parsed: ParsedCliArgs = { dryRun: false, confirm: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--email') parsed.email = argv[++i];
    else if (arg === '--confirm-email') parsed.confirmEmail = argv[++i];
    else if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--confirm') parsed.confirm = true;
  }
  return parsed;
}

// ─── Interactive TTY gate ────────────────────────────────────────────────────

export function assertInteractiveTty(): void {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new RecoveryRefusalError(
      'NON_INTERACTIVE_EXECUTION_REJECTED',
      'Refusing to run: this command must be executed in an interactive terminal (TTY) so the new password can be entered via a hidden prompt. Piped, redirected, or otherwise non-interactive execution is not supported.',
    );
  }
}

// ─── Hidden password prompt (real TTY, production use only) ────────────────

const KEY_CODE_CTRL_C = 3;
const KEY_CODE_BACKSPACE = 8;
const KEY_CODE_DEL = 127;

function readHiddenLine(promptText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      reject(new RecoveryRefusalError('NON_INTERACTIVE_EXECUTION_REJECTED', 'Interactive TTY input is required to enter the password.'));
      return;
    }

    process.stdout.write(promptText);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let input = '';

    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        const code = char.charCodeAt(0);

        if (char === '\n' || char === '\r') {
          cleanup();
          process.stdout.write('\n');
          resolve(input);
          return;
        }

        if (code === KEY_CODE_CTRL_C) {
          cleanup();
          process.stdout.write('\n');
          reject(new RecoveryRefusalError('ABORTED_BY_OPERATOR', 'Aborted by operator (Ctrl+C).'));
          return;
        }

        if (code === KEY_CODE_BACKSPACE || code === KEY_CODE_DEL) {
          input = input.slice(0, -1);
        } else {
          input += char;
        }
      }
    };

    stdin.on('data', onData);
  });
}

async function defaultGetNewPasswordPair(): Promise<{ password: string; confirmPassword: string }> {
  const password = await readHiddenLine('New PlatformAdmin password: ');
  const confirmPassword = await readHiddenLine('Confirm new password: ');
  return { password, confirmPassword };
}

// ─── Core recovery logic ────────────────────────────────────────────────────

export interface RecoverPlatformAdminPasswordOptions {
  email: string;
  confirmEmail: string;
  dryRun: boolean;
  confirm: boolean;
}

export interface RecoverPlatformAdminPasswordDeps {
  prismaClient: Pick<PrismaClient, 'platformAdmin' | '$transaction'>;
  writeAuditEvent: (
    tx: Parameters<typeof writePlatformAdminAuditEventInTx>[0],
    input: PlatformAdminAuditEventInput,
  ) => Promise<void>;
  getNewPasswordPair: () => Promise<{ password: string; confirmPassword: string }>;
}

export interface RecoverPlatformAdminPasswordResult {
  dryRun: boolean;
  accountMatched: true;
  accountActive: boolean;
  mfaPreserved: true;
  mfaEnabled: boolean;
  sessionsInvalidated: number;
  auditWritten: boolean;
  passwordChanged: boolean;
  maskedAdminId: string;
  email: string;
  accountCreatedAt: Date;
}

function maskAdminId(id: string): string {
  return `${id.slice(0, 8)}...`;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

export async function recoverPlatformAdminPassword(
  options: RecoverPlatformAdminPasswordOptions,
  deps: Partial<RecoverPlatformAdminPasswordDeps> = {},
): Promise<RecoverPlatformAdminPasswordResult> {
  const prismaClient = deps.prismaClient ?? (prisma as unknown as RecoverPlatformAdminPasswordDeps['prismaClient']);
  const writeAuditEvent = deps.writeAuditEvent ?? writePlatformAdminAuditEventInTx;
  const getNewPasswordPair = deps.getNewPasswordPair ?? defaultGetNewPasswordPair;

  if (!options.email || !options.confirmEmail) {
    throw new RecoveryRefusalError('EMAIL_REQUIRED', 'Both --email and --confirm-email are required.');
  }

  const normalizedEmail = options.email.trim().toLowerCase();
  const normalizedConfirmEmail = options.confirmEmail.trim().toLowerCase();

  if (normalizedEmail !== normalizedConfirmEmail) {
    throw new RecoveryRefusalError('EMAIL_CONFIRMATION_MISMATCH', '--email and --confirm-email do not match.');
  }

  if (!options.dryRun && !options.confirm) {
    throw new RecoveryRefusalError('CONFIRMATION_REQUIRED', 'Refusing to change a password without explicit --confirm.');
  }

  const candidates = await prismaClient.platformAdmin.findMany({
    where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    select: { id: true, email: true, isActive: true, totpEnabledAt: true, createdAt: true },
  });

  if (candidates.length === 0) {
    throw new RecoveryRefusalError('ACCOUNT_NOT_FOUND', `No PlatformAdmin account matches "${normalizedEmail}".`);
  }
  if (candidates.length > 1) {
    throw new RecoveryRefusalError(
      'AMBIGUOUS_MATCH',
      `${candidates.length} PlatformAdmin accounts match "${normalizedEmail}" case-insensitively; refusing an ambiguous target.`,
    );
  }

  const admin = candidates[0];

  if (!admin.isActive) {
    throw new RecoveryRefusalError('ACCOUNT_INACTIVE', 'This PlatformAdmin account is inactive; refusing to reset its password.');
  }

  const mfaEnabled = admin.totpEnabledAt !== null;
  const maskedAdminId = maskAdminId(admin.id);

  if (options.dryRun) {
    return {
      dryRun: true,
      accountMatched: true,
      accountActive: admin.isActive,
      mfaPreserved: true,
      mfaEnabled,
      sessionsInvalidated: 0,
      auditWritten: false,
      passwordChanged: false,
      maskedAdminId,
      email: admin.email,
      accountCreatedAt: admin.createdAt,
    };
  }

  const { password, confirmPassword } = await getNewPasswordPair();

  if (password !== confirmPassword) {
    throw new RecoveryRefusalError('PASSWORD_CONFIRMATION_MISMATCH', 'The two password entries did not match.');
  }

  const policy = validatePassword(password);
  if (!policy.valid) {
    throw new RecoveryRefusalError(
      'PASSWORD_POLICY_FAILED',
      `Password does not meet policy requirements: ${policy.errors.join('; ')}`,
    );
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST_FACTOR);

  // No persistent PlatformAdmin session model exists to invalidate — see
  // the module doc comment and the runbook. Always 0; not invented here.
  const sessionsInvalidated = 0;

  await prismaClient.$transaction(async (tx) => {
    await tx.platformAdmin.update({
      where: { id: admin.id },
      data: { passwordHash },
    });

    await writeAuditEvent(tx, {
      actorPlatformAdminId: null,
      action: 'platform_admin.password_recovered',
      resourceType: 'PlatformAdmin',
      resourceKey: admin.id,
      previousValue: null,
      newValue: null,
      outcome: 'success',
      safeMetadata: {
        method: 'operator_cli',
        sessionsInvalidated,
        mfaPreserved: true,
      },
    });
  });

  return {
    dryRun: false,
    accountMatched: true,
    accountActive: admin.isActive,
    mfaPreserved: true,
    mfaEnabled,
    sessionsInvalidated,
    auditWritten: true,
    passwordChanged: true,
    maskedAdminId,
    email: admin.email,
    accountCreatedAt: admin.createdAt,
  };
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

export function printResult(result: RecoverPlatformAdminPasswordResult): void {
  if (result.dryRun) {
    console.log('\n=== PlatformAdmin Password Recovery — DRY RUN ===');
    console.log(`Account matched:          yes`);
    console.log(`Email:                    ${maskEmail(result.email)}`);
    console.log(`Account active:           ${result.accountActive ? 'yes' : 'no'}`);
    console.log(`MFA enabled (preserved):  ${result.mfaEnabled ? 'yes' : 'no'}`);
    console.log(`Account created at:       ${result.accountCreatedAt.toISOString()}`);
    console.log(`Admin ID (masked):        ${result.maskedAdminId}`);
    console.log('\nDry run complete: no hash computed, no database write, no audit event, no session change.');
    console.log('Re-run without --dry-run and with --confirm to perform the actual reset.\n');
    return;
  }

  console.log('\n=== PlatformAdmin Password Recovery — COMPLETE ===');
  console.log(`Account matched:          yes`);
  console.log(`Account active:           ${result.accountActive ? 'yes' : 'no'}`);
  console.log(`MFA preserved:            yes`);
  console.log(`Sessions invalidated:     ${result.sessionsInvalidated} (see note below)`);
  console.log(`Audit event written:      ${result.auditWritten ? 'yes' : 'no'}`);
  console.log(`Password changed:        ${result.passwordChanged ? 'yes' : 'no'}`);
  console.log('\nNOTE: PlatformAdmin sessions are stateless JWTs with no persistent session');
  console.log('store; this CLI cannot revoke tokens already issued to this account. See the');
  console.log('runbook for the proposed follow-up (passwordChangedAt-based invalidation,');
  console.log('mirroring the clinic User model).');
  console.log('\nIMPORTANT: This CLI does NOT test login. Perform exactly ONE normal');
  console.log('platform-admin login now, through the real login route, to confirm the new');
  console.log('password works.\n');
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  if (!args.dryRun) {
    assertInteractiveTty();
  }

  const result = await recoverPlatformAdminPassword({
    email: args.email ?? '',
    confirmEmail: args.confirmEmail ?? '',
    dryRun: args.dryRun,
    confirm: args.confirm,
  });

  printResult(result);
}

const invokedPath = process.argv[1]?.replace(/\\/g, '/') ?? '';
const isDirectRun = invokedPath.endsWith('platform-admin-recover-password.ts') || invokedPath.endsWith('platform-admin-recover-password.js');

if (isDirectRun) {
  main()
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nRefused / failed: ${message}\n`);
      process.exitCode = 1;
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
