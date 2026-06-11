/**
 * operationalEventService.ts — Operational Event Writer
 *
 * Records system-level operational events (integration failures, webhook errors,
 * cron failures, etc.).  Events are resolvable by authorized admins.
 *
 * Errors are swallowed — a logging failure must never crash the main operation.
 */

import prisma from '../db.js';
import { Prisma } from '@prisma/client';

export type EventSeverity = 'info' | 'warning' | 'error' | 'critical';
export type EventSource = 'whatsapp' | 'meta_whatsapp' | 'instagram' | 'appointment' | 'finance' | 'auth' | 'system';

export interface OperationalEventInput {
  organizationId: string;
  clinicId?: string | null;
  severity: EventSeverity;
  source: EventSource;
  message: string;
  /**
   * Safe metadata only — no credentials, no tokens.
   */
  metadata?: Record<string, unknown> | null;
}

/**
 * Record an operational event.
 * Swallows all errors — callers do NOT need to try/catch this.
 */
export async function recordOperationalEvent(input: OperationalEventInput): Promise<void> {
  try {
    await prisma.operationalEvent.create({
      data: {
        organizationId: input.organizationId,
        clinicId: input.clinicId ?? null,
        severity: input.severity,
        source: input.source,
        message: input.message,
        metadata: input.metadata != null ? (input.metadata as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch (err) {
    console.error('[OperationalEvent] Failed to record event:', err);
  }
}
