/**
 * auditLog.ts — Audit Log Utility
 *
 * Fire-and-forget audit event writer.  Errors are swallowed so that a logging
 * failure NEVER blocks the main operation.
 *
 * Usage:
 *   import { writeAuditLog } from '../utils/auditLog.js';
 *   await writeAuditLog({ organizationId, actorUserId, action: 'branch_created', ... });
 */

import prisma from '../db.js';
import { Prisma, type PrismaClient } from '@prisma/client';

export interface AuditLogInput {
  organizationId: string;
  clinicId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  description?: string | null;
  /**
   * Safe metadata object.  Never include passwords, tokens, API keys or any
   * credential-like field — callers are responsible for scrubbing before passing.
   */
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Write an immutable audit log entry.
 * Swallows all errors — call-site should not need a try/catch.
 */
export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: input.organizationId,
        clinicId: input.clinicId ?? null,
        actorUserId: input.actorUserId ?? null,
        actorRole: input.actorRole ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        description: input.description ?? null,
        metadata: input.metadata != null ? (input.metadata as Prisma.InputJsonValue) : undefined,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (err) {
    // Logging must never crash the main operation
    console.error('[AuditLog] Failed to write audit log:', err);
  }
}

/**
 * writeAuditLogInTx — transaction-scoped, non-swallowing audit write.
 *
 * Unlike writeAuditLog() (fire-and-forget, errors swallowed — correct for
 * most events), a small number of security-critical events must be
 * fail-closed: the operation they accompany must not be reported as
 * successful if the audit record could not be durably written. The
 * signature REQUIRES a Prisma.TransactionClient (no optional/default
 * fallback to the global `prisma` singleton) so the audit insert is
 * structurally part of the SAME transaction as the state change it
 * documents — if either fails, both roll back together. If the insert
 * throws, this function does NOT catch it; the caller's surrounding
 * `prisma.$transaction` call rejects and the whole transaction rolls back.
 *
 * Used by clinicBulkExportPackage.ts for: export request creation,
 * download-token issuance, and download claim/start (see
 * docs/compliance/54-kvkk-secure-clinic-bulk-export.md).
 */
export async function writeAuditLogInTx(
  tx: Pick<PrismaClient, 'auditLog'> | Prisma.TransactionClient,
  input: AuditLogInput,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      organizationId: input.organizationId,
      clinicId: input.clinicId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      description: input.description ?? null,
      metadata: input.metadata != null ? (input.metadata as Prisma.InputJsonValue) : undefined,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

/**
 * Helper: extract safe IP / user-agent from an Express request.
 */
export function extractRequestMeta(req: { ip?: string; headers: Record<string, unknown> }): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  return {
    ipAddress: (req.ip ?? null) as string | null,
    userAgent: (req.headers['user-agent'] ?? null) as string | null,
  };
}
