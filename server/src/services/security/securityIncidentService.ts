/**
 * securityIncidentService.ts — KVKK-CRIT-003 incident aggregation + lifecycle.
 *
 * Two distinct responsibilities, kept in one file because they share the
 * same model but must not be confused:
 *
 *  1. upsertIncidentFromSignal() — called by detection rules once a
 *     threshold is crossed. Deterministically aggregates/deduplicates into
 *     a SecurityIncident via incidentKey (DB-unique, upserted — never a
 *     race-prone find-then-create). Severity escalation is done with a raw,
 *     conditional SQL UPDATE so it is race-safe even under concurrent
 *     escalations of different severities (see escalateSeverityAtomic).
 *
 *  2. Lifecycle mutations (acknowledge/investigate/assign/contain/resolve/
 *     close/false-positive/reopen/note) — Platform-Admin-only, validated
 *     status transitions, each executed as ONE DB transaction that updates
 *     SecurityIncident and inserts a SecurityIncidentActivity row together.
 *
 * SecurityIncidentActivity — not the existing AuditLog model — is the audit
 * trail for these lifecycle mutations. AuditLog is user/org-centric
 * (actorUserId, a required organizationId) and has no actorPlatformAdminId
 * column; a platform-wide incident (no organizationId) would not even fit
 * it. SecurityIncidentActivity is the dedicated, immutable, actor-attributed
 * record for this feature instead.
 *
 * This is a TECHNICAL foundation only — legalReviewRequired/legalReviewStatus
 * are placeholders for a pending human legal decision, never a legal
 * conclusion. See docs/compliance/55-kvkk-security-incident-response-foundation.md.
 */

import { createHash } from 'node:crypto';
import type { Prisma, SecurityIncident } from '@prisma/client';
import prisma from '../../db.js';
import { sanitizeSecurityMetadata, type SecuritySignalSeverity } from './securitySignalService.js';

const SEVERITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
/** Exported (pure, no DB) so tests can verify the escalation ordering without a live database. */
export function severityRank(value: string): number {
  return SEVERITY_RANK[value] ?? 1;
}
export const TERMINAL_STATUSES = new Set(['closed', 'false_positive']);

export const INCIDENT_STATUSES = [
  'open',
  'acknowledged',
  'investigating',
  'contained',
  'resolved',
  'closed',
  'false_positive',
] as const;
export const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

/** Documented status-transition graph — enforced server-side, never an arbitrary status PATCH. */
export const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  open: ['acknowledged', 'investigating', 'false_positive'],
  acknowledged: ['investigating', 'contained', 'false_positive'],
  investigating: ['contained', 'resolved', 'false_positive'],
  contained: ['investigating', 'resolved'],
  resolved: ['closed', 'investigating'],
  closed: [], // reachable only via the dedicated reopen action
  false_positive: [], // reachable only via the dedicated reopen action
};

export function buildIncidentKey(params: {
  sourceRule: string;
  organizationId?: string | null;
  clinicId?: string | null;
  affectedResourceType?: string | null;
  affectedResourceId?: string | null;
}): string {
  const parts = [
    params.sourceRule,
    params.organizationId ?? 'no-org',
    params.clinicId ?? 'no-clinic',
    params.affectedResourceType ?? 'no-resource-type',
    params.affectedResourceId ?? 'no-resource-id',
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

export interface UpsertIncidentFromSignalInput {
  sourceRule: string;
  sourceType: string;
  category: string;
  severity: SecuritySignalSeverity;
  organizationId?: string | null;
  clinicId?: string | null;
  affectedResourceType?: string | null;
  affectedResourceId?: string | null;
  title: string;
  summary: string;
  metadata?: Record<string, unknown> | null;
  now?: Date;
}

export interface UpsertIncidentResult {
  incident: SecurityIncident;
  created: boolean;
  severityEscalated: boolean;
}

/**
 * Race-safe conditional severity escalation: re-evaluates the CURRENT
 * stored severity at UPDATE time (not a JS-side value read earlier), so two
 * concurrent escalations of different incoming severities can never regress
 * the final value — Postgres serializes the row-level UPDATE, and the WHERE
 * clause only ever allows a strictly-higher rank to win.
 */
async function escalateSeverityAtomic(
  tx: Prisma.TransactionClient,
  incidentId: string,
  incomingSeverity: string,
  now: Date,
): Promise<boolean> {
  const RANK_CASE = `CASE severity WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'critical' THEN 4 ELSE 1 END`;
  const incomingRank = SEVERITY_RANK[incomingSeverity] ?? 1;
  const affected = await tx.$executeRawUnsafe(
    `UPDATE "SecurityIncident" SET severity = $1, "updatedAt" = $2 WHERE id = $3 AND (${RANK_CASE}) < $4`,
    incomingSeverity,
    now,
    incidentId,
    incomingRank,
  );
  return affected > 0;
}

/**
 * Deterministically upserts a SecurityIncident from a detection-rule
 * escalation. incidentKey is unique at the DB level; the create/increment
 * step uses Prisma's upsert (a single INSERT ... ON CONFLICT DO UPDATE), so
 * concurrent identical signals can only ever produce one row and one
 * correct occurrenceCount — never a race-prone find-then-create.
 *
 * Reopen/new-incident policy: once an incident reaches a terminal status
 * (closed or false_positive), a Platform Admin has already explicitly
 * decided that occurrence stream is over — further occurrences of the SAME
 * rule+scope do not silently reopen or keep incrementing it. Instead a NEW
 * incident is created, keyed by the base incidentKey plus the current UTC
 * date (so at most one fresh incident per rule+scope per day can be spawned
 * this way — bounded, not an alert storm), and its metadata links back to
 * the prior terminal incident id for continuity.
 */
export async function upsertIncidentFromSignal(input: UpsertIncidentFromSignalInput): Promise<UpsertIncidentResult> {
  const now = input.now ?? new Date();
  const baseKey = buildIncidentKey(input);
  const safeMetadata = sanitizeSecurityMetadata(input.metadata ?? null);

  return prisma.$transaction(async (tx) => {
    const existingBase = await tx.securityIncident.findUnique({ where: { incidentKey: baseKey } });

    let targetKey = baseKey;
    let reopenedFromIncidentId: string | null = null;
    if (existingBase && TERMINAL_STATUSES.has(existingBase.status)) {
      targetKey = `${baseKey}:${now.toISOString().slice(0, 10)}`;
      reopenedFromIncidentId = existingBase.id;
    }

    const metadataForCreate =
      reopenedFromIncidentId != null
        ? { ...(safeMetadata ?? {}), reopenedFromIncidentId }
        : safeMetadata;

    const preUpsertExisting = await tx.securityIncident.findUnique({ where: { incidentKey: targetKey } });

    const upserted = await tx.securityIncident.upsert({
      where: { incidentKey: targetKey },
      create: {
        incidentKey: targetKey,
        organizationId: input.organizationId ?? null,
        clinicId: input.clinicId ?? null,
        category: input.category,
        severity: input.severity,
        status: 'open',
        title: input.title,
        summary: input.summary,
        firstDetectedAt: now,
        lastDetectedAt: now,
        occurrenceCount: 1,
        sourceType: input.sourceType,
        sourceRule: input.sourceRule,
        affectedResourceType: input.affectedResourceType ?? null,
        affectedResourceId: input.affectedResourceId ?? null,
        metadata: metadataForCreate != null ? (metadataForCreate as Prisma.InputJsonValue) : undefined,
      },
      update: {
        occurrenceCount: { increment: 1 },
        lastDetectedAt: now,
      },
    });

    const created = preUpsertExisting === null;
    const severityEscalated = !created && (await escalateSeverityAtomic(tx, upserted.id, input.severity, now));

    if (created) {
      await tx.securityIncidentActivity.create({
        data: {
          incidentId: upserted.id,
          action: 'created',
          newStatus: 'open',
          note: reopenedFromIncidentId ? 'Recurrence after a prior closed/false-positive incident.' : null,
          metadata: reopenedFromIncidentId ? { reopenedFromIncidentId } : undefined,
        },
      });
    } else if (severityEscalated) {
      await tx.securityIncidentActivity.create({
        data: {
          incidentId: upserted.id,
          action: 'severity_escalated',
          metadata: { newSeverity: input.severity },
        },
      });
    }

    const finalIncident = created || !severityEscalated ? upserted : await tx.securityIncident.findUniqueOrThrow({ where: { id: upserted.id } });
    return { incident: finalIncident, created, severityEscalated };
  });
}

// ── Lifecycle mutations ──────────────────────────────────────────────────

export type LifecycleFailure = 'not_found' | 'invalid_transition' | 'summary_required';
export type LifecycleResult =
  | { ok: true; incident: SecurityIncident }
  | { ok: false; error: LifecycleFailure };

async function applyLifecycleTransition(params: {
  incidentId: string;
  actorPlatformAdminId: string;
  action: string;
  targetStatus: string;
  allowedFromStatuses: string[];
  note?: string | null;
  extraData?: Prisma.SecurityIncidentUncheckedUpdateInput;
}): Promise<LifecycleResult> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.securityIncident.findUnique({ where: { id: params.incidentId } });
    if (!existing) return { ok: false, error: 'not_found' };
    if (!params.allowedFromStatuses.includes(existing.status)) {
      return { ok: false, error: 'invalid_transition' };
    }

    const updated = await tx.securityIncident.update({
      where: { id: params.incidentId },
      data: { status: params.targetStatus, ...params.extraData },
    });

    await tx.securityIncidentActivity.create({
      data: {
        incidentId: params.incidentId,
        action: params.action,
        previousStatus: existing.status,
        newStatus: params.targetStatus,
        actorPlatformAdminId: params.actorPlatformAdminId,
        note: params.note ?? null,
      },
    });

    return { ok: true, incident: updated };
  });
}

export async function acknowledgeIncident(p: { incidentId: string; actorPlatformAdminId: string; note?: string | null }): Promise<LifecycleResult> {
  return applyLifecycleTransition({
    incidentId: p.incidentId,
    actorPlatformAdminId: p.actorPlatformAdminId,
    action: 'acknowledged',
    targetStatus: 'acknowledged',
    allowedFromStatuses: ['open'],
    note: p.note,
    extraData: { acknowledgedAt: new Date(), acknowledgedByPlatformAdminId: p.actorPlatformAdminId },
  });
}

export async function startInvestigation(p: { incidentId: string; actorPlatformAdminId: string; note?: string | null }): Promise<LifecycleResult> {
  return applyLifecycleTransition({
    incidentId: p.incidentId,
    actorPlatformAdminId: p.actorPlatformAdminId,
    action: 'investigating',
    targetStatus: 'investigating',
    allowedFromStatuses: ['open', 'acknowledged', 'contained', 'resolved'],
    note: p.note,
  });
}

export async function containIncident(p: {
  incidentId: string;
  actorPlatformAdminId: string;
  containmentSummary: string;
}): Promise<LifecycleResult> {
  const summary = p.containmentSummary?.trim();
  if (!summary) return { ok: false, error: 'summary_required' };
  return applyLifecycleTransition({
    incidentId: p.incidentId,
    actorPlatformAdminId: p.actorPlatformAdminId,
    action: 'contained',
    targetStatus: 'contained',
    allowedFromStatuses: ['acknowledged', 'investigating'],
    note: summary,
    extraData: {
      containedAt: new Date(),
      containedByPlatformAdminId: p.actorPlatformAdminId,
      containmentSummary: summary.slice(0, 2000),
    },
  });
}

export async function resolveIncident(p: {
  incidentId: string;
  actorPlatformAdminId: string;
  resolutionSummary: string;
}): Promise<LifecycleResult> {
  const summary = p.resolutionSummary?.trim();
  if (!summary) return { ok: false, error: 'summary_required' };
  return applyLifecycleTransition({
    incidentId: p.incidentId,
    actorPlatformAdminId: p.actorPlatformAdminId,
    action: 'resolved',
    targetStatus: 'resolved',
    allowedFromStatuses: ['investigating', 'contained'],
    note: summary,
    extraData: {
      resolvedAt: new Date(),
      resolvedByPlatformAdminId: p.actorPlatformAdminId,
      resolutionSummary: summary.slice(0, 2000),
    },
  });
}

export async function closeIncident(p: { incidentId: string; actorPlatformAdminId: string; note?: string | null }): Promise<LifecycleResult> {
  return applyLifecycleTransition({
    incidentId: p.incidentId,
    actorPlatformAdminId: p.actorPlatformAdminId,
    action: 'closed',
    targetStatus: 'closed',
    allowedFromStatuses: ['resolved'],
    note: p.note,
    extraData: { closedAt: new Date(), closedByPlatformAdminId: p.actorPlatformAdminId },
  });
}

export async function markFalsePositive(p: { incidentId: string; actorPlatformAdminId: string; note: string }): Promise<LifecycleResult> {
  const note = p.note?.trim();
  if (!note) return { ok: false, error: 'summary_required' };
  return applyLifecycleTransition({
    incidentId: p.incidentId,
    actorPlatformAdminId: p.actorPlatformAdminId,
    action: 'false_positive',
    targetStatus: 'false_positive',
    allowedFromStatuses: ['open', 'acknowledged', 'investigating'],
    note,
  });
}

export async function reopenIncident(p: { incidentId: string; actorPlatformAdminId: string; note: string }): Promise<LifecycleResult> {
  const note = p.note?.trim();
  if (!note) return { ok: false, error: 'summary_required' };
  return applyLifecycleTransition({
    incidentId: p.incidentId,
    actorPlatformAdminId: p.actorPlatformAdminId,
    action: 'reopened',
    targetStatus: 'investigating',
    allowedFromStatuses: ['closed', 'false_positive'],
    note,
  });
}

export type AssignResult =
  | { ok: true; incident: SecurityIncident }
  | { ok: false; error: 'not_found' };

/** Administrative assignment — not a status transition, so not gated by ALLOWED_TRANSITIONS. */
export async function assignIncident(p: {
  incidentId: string;
  actorPlatformAdminId: string;
  assigneePlatformAdminId: string | null;
}): Promise<AssignResult> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.securityIncident.findUnique({ where: { id: p.incidentId } });
    if (!existing) return { ok: false, error: 'not_found' };

    const updated = await tx.securityIncident.update({
      where: { id: p.incidentId },
      data: { assignedToPlatformAdminId: p.assigneePlatformAdminId },
    });

    await tx.securityIncidentActivity.create({
      data: {
        incidentId: p.incidentId,
        action: p.assigneePlatformAdminId ? 'assigned' : 'unassigned',
        actorPlatformAdminId: p.actorPlatformAdminId,
        metadata: { assignedToPlatformAdminId: p.assigneePlatformAdminId },
      },
    });

    return { ok: true, incident: updated };
  });
}

export type NoteResult =
  | { ok: true; incident: SecurityIncident }
  | { ok: false; error: 'not_found' | 'summary_required' };

export async function addIncidentNote(p: { incidentId: string; actorPlatformAdminId: string; note: string }): Promise<NoteResult> {
  const note = p.note?.trim();
  if (!note) return { ok: false, error: 'summary_required' };
  return prisma.$transaction(async (tx) => {
    const existing = await tx.securityIncident.findUnique({ where: { id: p.incidentId } });
    if (!existing) return { ok: false, error: 'not_found' };

    await tx.securityIncidentActivity.create({
      data: {
        incidentId: p.incidentId,
        action: 'note_added',
        actorPlatformAdminId: p.actorPlatformAdminId,
        note: note.slice(0, 2000),
      },
    });

    return { ok: true, incident: existing };
  });
}

// ── Reads (Platform Admin API) ───────────────────────────────────────────

export interface ListIncidentsFilters {
  status?: string;
  severity?: string;
  category?: string;
  organizationId?: string;
  clinicId?: string;
  assignedToPlatformAdminId?: string;
  from?: Date;
  to?: Date;
}

const MAX_PAGE_SIZE = 100;

export async function listIncidents(filters: ListIncidentsFilters, page: number, limit: number) {
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(MAX_PAGE_SIZE, Math.max(1, limit));
  const skip = (safePage - 1) * safeLimit;

  const where: Prisma.SecurityIncidentWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.severity) where.severity = filters.severity;
  if (filters.category) where.category = filters.category;
  if (filters.organizationId) where.organizationId = filters.organizationId;
  if (filters.clinicId) where.clinicId = filters.clinicId;
  if (filters.assignedToPlatformAdminId) where.assignedToPlatformAdminId = filters.assignedToPlatformAdminId;
  if (filters.from || filters.to) {
    where.lastDetectedAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  const [total, data] = await Promise.all([
    prisma.securityIncident.count({ where }),
    prisma.securityIncident.findMany({
      where,
      orderBy: [{ lastDetectedAt: 'desc' }, { id: 'desc' }],
      skip,
      take: safeLimit,
    }),
  ]);

  return { total, page: safePage, limit: safeLimit, data };
}

export async function getIncidentById(incidentId: string): Promise<SecurityIncident | null> {
  return prisma.securityIncident.findUnique({ where: { id: incidentId } });
}

export async function getIncidentActivity(incidentId: string) {
  return prisma.securityIncidentActivity.findMany({
    where: { incidentId },
    orderBy: { createdAt: 'desc' },
  });
}

export interface DashboardSummary {
  openCritical: number;
  openHigh: number;
  unacknowledged: number;
  investigating: number;
  last24h: number;
}

const NON_TERMINAL_STATUSES = ['open', 'acknowledged', 'investigating', 'contained'];

/** Bounded, indexed-only counts — never an unbounded full-table scan. */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [openCritical, openHigh, unacknowledged, investigating, last24h] = await Promise.all([
    prisma.securityIncident.count({ where: { status: { in: NON_TERMINAL_STATUSES }, severity: 'critical' } }),
    prisma.securityIncident.count({ where: { status: { in: NON_TERMINAL_STATUSES }, severity: 'high' } }),
    prisma.securityIncident.count({ where: { status: 'open' } }),
    prisma.securityIncident.count({ where: { status: 'investigating' } }),
    prisma.securityIncident.count({ where: { firstDetectedAt: { gte: since24h } } }),
  ]);

  return { openCritical, openHigh, unacknowledged, investigating, last24h };
}
