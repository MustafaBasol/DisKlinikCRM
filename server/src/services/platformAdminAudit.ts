/**
 * platformAdminAudit.ts — durable audit trail for Platform Admin
 * configuration changes (e.g. PlatformSetting toggles).
 *
 * Deliberately separate from SecuritySignalEvent/recordSecuritySignal():
 * that store is security-detection telemetry aggregated by
 * securityDetectionRules.ts, and a platform-admin configuration change is
 * not a security detection signal — mixing the two would create retention/
 * reporting ambiguity and risk future detection rules misinterpreting
 * routine admin changes.
 *
 * Mirrors writeAuditLogInTx() in utils/auditLog.ts: this function's type
 * signature accepts ONLY Prisma.TransactionClient — not the global `prisma`
 * singleton, not even structurally via a Pick<PrismaClient, ...> — so a
 * caller cannot compile a call that passes the global client and silently
 * takes the audit insert out of the surrounding transaction. This is a
 * compile-time guarantee, not just a documented convention. If the insert
 * throws, this does NOT catch it — the caller's surrounding
 * `prisma.$transaction` rejects and the whole transaction (including the
 * setting change) rolls back. A successful setting change without its
 * audit row must never happen.
 */

import { Prisma } from '@prisma/client';

export interface PlatformAdminAuditEventInput {
  actorPlatformAdminId: string | null;
  action: string;
  resourceType: string;
  resourceKey: string;
  previousValue?: string | null;
  newValue?: string | null;
  outcome: string;
  /** Sanitized, non-secret, non-patient metadata only — caller's responsibility. */
  safeMetadata?: Record<string, unknown> | null;
}

export async function writePlatformAdminAuditEventInTx(
  tx: Prisma.TransactionClient,
  input: PlatformAdminAuditEventInput,
): Promise<void> {
  await tx.platformAdminAuditEvent.create({
    data: {
      actorPlatformAdminId: input.actorPlatformAdminId,
      action: input.action,
      resourceType: input.resourceType,
      resourceKey: input.resourceKey,
      previousValue: input.previousValue ?? null,
      newValue: input.newValue ?? null,
      outcome: input.outcome,
      safeMetadata: input.safeMetadata != null ? (input.safeMetadata as Prisma.InputJsonValue) : undefined,
    },
  });
}
