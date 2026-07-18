/**
 * platformSecurityIncidents.ts — KVKK-CRIT-003 Platform Admin incident API.
 *
 * Mounted under the existing platform namespace (/api/platform/security/...).
 * Every route requires authenticatePlatformAdmin — no clinic-user route ever
 * reaches this file, and no clinic-facing route exposes SecurityIncident
 * data. This is a TECHNICAL classification tool only: responses never imply
 * a legal determination — see legalReviewRequired/legalReviewStatus and the
 * runbook (docs/compliance/55-kvkk-security-incident-response-foundation.md).
 */

import express, { Response } from 'express';
import { z } from 'zod';
import type { SecurityIncident } from '@prisma/client';
import { authenticatePlatformAdmin, PlatformAdminRequest } from '../middleware/platformAuth.js';
import { csrfProtection } from '../middleware/csrf.js';
import { createRateLimiter } from '../utils/helpers.js';
import {
  INCIDENT_STATUSES,
  INCIDENT_SEVERITIES,
  listIncidents,
  getIncidentById,
  getIncidentActivity,
  getDashboardSummary,
  acknowledgeIncident,
  startInvestigation,
  assignIncident,
  containIncident,
  resolveIncident,
  closeIncident,
  markFalsePositive,
  reopenIncident,
  addIncidentNote,
  type LifecycleResult,
} from '../services/security/securityIncidentService.js';

const router = express.Router();

function getIdParam(req: PlatformAdminRequest): string {
  const value = req.params.id;
  return Array.isArray(value) ? value[0] : value;
}

// All routes below require Platform Admin auth. GET requests pass through
// csrfProtection unaffected (it only gates unsafe methods) — see csrf.ts.
router.use(authenticatePlatformAdmin as express.RequestHandler, csrfProtection('platform'));

// Generous but bounded — legitimate triage work clicks through many
// incidents; this exists to blunt a scripted mass-mutation attempt, not to
// throttle normal use.
const mutationLimiter = createRateLimiter(120, 15 * 60 * 1000, 'platform-security-incident-mutation');

async function checkMutationRateLimit(req: PlatformAdminRequest, res: Response): Promise<boolean> {
  const key = req.platformAdmin!.id;
  if (!(await mutationLimiter.check(key))) {
    res.status(429).json({ error: 'Too many incident mutations. Please slow down.' });
    return false;
  }
  await mutationLimiter.record(key);
  return true;
}

function toIncidentDTO(incident: SecurityIncident) {
  return {
    id: incident.id,
    incidentKey: incident.incidentKey,
    organizationId: incident.organizationId,
    clinicId: incident.clinicId,
    category: incident.category,
    severity: incident.severity,
    status: incident.status,
    title: incident.title,
    summary: incident.summary,
    firstDetectedAt: incident.firstDetectedAt,
    lastDetectedAt: incident.lastDetectedAt,
    occurrenceCount: incident.occurrenceCount,
    sourceType: incident.sourceType,
    sourceRule: incident.sourceRule,
    affectedResourceType: incident.affectedResourceType,
    affectedResourceId: incident.affectedResourceId,
    assignedToPlatformAdminId: incident.assignedToPlatformAdminId,
    acknowledgedAt: incident.acknowledgedAt,
    acknowledgedByPlatformAdminId: incident.acknowledgedByPlatformAdminId,
    containedAt: incident.containedAt,
    containedByPlatformAdminId: incident.containedByPlatformAdminId,
    containmentSummary: incident.containmentSummary,
    resolvedAt: incident.resolvedAt,
    resolvedByPlatformAdminId: incident.resolvedByPlatformAdminId,
    resolutionSummary: incident.resolutionSummary,
    closedAt: incident.closedAt,
    closedByPlatformAdminId: incident.closedByPlatformAdminId,
    legalReviewRequired: incident.legalReviewRequired,
    legalReviewStatus: incident.legalReviewStatus,
    metadata: incident.metadata,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
  };
}

const MAX_PAGE_SIZE = 100;
const listQuerySchema = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  category: z.string().max(100).optional(),
  organizationId: z.string().max(100).optional(),
  clinicId: z.string().max(100).optional(),
  assignedTo: z.string().max(100).optional(),
  from: z.string().refine((v) => !v || !Number.isNaN(Date.parse(v)), 'Invalid from date').optional(),
  to: z.string().refine((v) => !v || !Number.isNaN(Date.parse(v)), 'Invalid to date').optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});

// ── GET /api/platform/security/summary ───────────────────────────────────

router.get('/security/summary', async (_req: PlatformAdminRequest, res: Response) => {
  try {
    const summary = await getDashboardSummary();
    res.json(summary);
  } catch (err) {
    console.error('[platform-security-incidents] summary failed', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

// ── GET /api/platform/security/incidents ─────────────────────────────────

router.get('/security/incidents', async (req: PlatformAdminRequest, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid filter parameters' });
  }
  const q = parsed.data;
  const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(q.limit ?? '25', 10) || 25));

  try {
    const result = await listIncidents(
      {
        status: q.status,
        severity: q.severity,
        category: q.category,
        organizationId: q.organizationId,
        clinicId: q.clinicId,
        assignedToPlatformAdminId: q.assignedTo,
        from: q.from ? new Date(q.from) : undefined,
        to: q.to ? new Date(q.to) : undefined,
      },
      page,
      limit,
    );
    res.json({ total: result.total, page: result.page, limit: result.limit, data: result.data.map(toIncidentDTO) });
  } catch (err) {
    console.error('[platform-security-incidents] list failed', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Failed to list incidents' });
  }
});

// ── GET /api/platform/security/incidents/:id ─────────────────────────────

router.get('/security/incidents/:id', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const incident = await getIncidentById(getIdParam(req));
    if (!incident) return res.status(404).json({ error: 'Incident not found' });
    res.json(toIncidentDTO(incident));
  } catch (err) {
    console.error('[platform-security-incidents] get failed', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Failed to load incident' });
  }
});

// ── GET /api/platform/security/incidents/:id/activity ────────────────────

router.get('/security/incidents/:id/activity', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const incident = await getIncidentById(getIdParam(req));
    if (!incident) return res.status(404).json({ error: 'Incident not found' });
    const activity = await getIncidentActivity(getIdParam(req));
    res.json({
      data: activity.map((a) => ({
        id: a.id,
        action: a.action,
        previousStatus: a.previousStatus,
        newStatus: a.newStatus,
        actorPlatformAdminId: a.actorPlatformAdminId,
        note: a.note,
        metadata: a.metadata,
        createdAt: a.createdAt,
      })),
    });
  } catch (err) {
    console.error('[platform-security-incidents] activity failed', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Failed to load incident activity' });
  }
});

// ── Lifecycle mutations ───────────────────────────────────────────────────

const HTTP_STATUS_BY_LIFECYCLE_ERROR: Record<string, number> = {
  not_found: 404,
  invalid_transition: 409,
  summary_required: 400,
  // Another Platform Admin's concurrent request already won the transition —
  // a conflict, not a validation error. The client should reload the
  // incident's current state rather than blindly retry.
  concurrent_transition: 409,
};

function respondLifecycle(res: Response, result: LifecycleResult) {
  if (result.ok) return res.json(toIncidentDTO(result.incident));
  const status = HTTP_STATUS_BY_LIFECYCLE_ERROR[result.error] ?? 400;
  return res.status(status).json({ error: result.error });
}

const optionalNoteSchema = z.object({ note: z.string().max(2000).optional() });
const requiredSummarySchema = (field: 'containmentSummary' | 'resolutionSummary' | 'note') =>
  z.object({ [field]: z.string().min(1).max(2000) });
const assignSchema = z.object({ assigneePlatformAdminId: z.string().min(1).max(100).nullable() });

router.post('/security/incidents/:id/acknowledge', async (req: PlatformAdminRequest, res: Response) => {
  if (!(await checkMutationRateLimit(req, res))) return;
  const parsed = optionalNoteSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request body' });
  try {
    const result = await acknowledgeIncident({ incidentId: getIdParam(req), actorPlatformAdminId: req.platformAdmin!.id, note: parsed.data.note });
    respondLifecycle(res, result);
  } catch (err) {
    console.error('[platform-security-incidents] acknowledge failed', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Failed to acknowledge incident' });
  }
});

router.post('/security/incidents/:id/investigate', async (req: PlatformAdminRequest, res: Response) => {
  if (!(await checkMutationRateLimit(req, res))) return;
  const parsed = optionalNoteSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request body' });
  try {
    const result = await startInvestigation({ incidentId: getIdParam(req), actorPlatformAdminId: req.platformAdmin!.id, note: parsed.data.note });
    respondLifecycle(res, result);
  } catch (err) {
    console.error('[platform-security-incidents] investigate failed', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Failed to start investigation' });
  }
});

router.post('/security/incidents/:id/assign', async (req: PlatformAdminRequest, res: Response) => {
  if (!(await checkMutationRateLimit(req, res))) return;
  const parsed = assignSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request body' });
  try {
    const result = await assignIncident({
      incidentId: getIdParam(req),
      actorPlatformAdminId: req.platformAdmin!.id,
      assigneePlatformAdminId: parsed.data.assigneePlatformAdminId,
    });
    if (!result.ok) return res.status(404).json({ error: result.error });
    res.json(toIncidentDTO(result.incident));
  } catch (err) {
    console.error('[platform-security-incidents] assign failed', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Failed to assign incident' });
  }
});

router.post('/security/incidents/:id/contain', async (req: PlatformAdminRequest, res: Response) => {
  if (!(await checkMutationRateLimit(req, res))) return;
  const parsed = requiredSummarySchema('containmentSummary').safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'containmentSummary is required' });
  try {
    const result = await containIncident({
      incidentId: getIdParam(req),
      actorPlatformAdminId: req.platformAdmin!.id,
      containmentSummary: parsed.data.containmentSummary,
    });
    respondLifecycle(res, result);
  } catch (err) {
    console.error('[platform-security-incidents] contain failed', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Failed to mark incident contained' });
  }
});

router.post('/security/incidents/:id/resolve', async (req: PlatformAdminRequest, res: Response) => {
  if (!(await checkMutationRateLimit(req, res))) return;
  const parsed = requiredSummarySchema('resolutionSummary').safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'resolutionSummary is required' });
  try {
    const result = await resolveIncident({
      incidentId: getIdParam(req),
      actorPlatformAdminId: req.platformAdmin!.id,
      resolutionSummary: parsed.data.resolutionSummary,
    });
    respondLifecycle(res, result);
  } catch (err) {
    console.error('[platform-security-incidents] resolve failed', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Failed to resolve incident' });
  }
});

router.post('/security/incidents/:id/close', async (req: PlatformAdminRequest, res: Response) => {
  if (!(await checkMutationRateLimit(req, res))) return;
  const parsed = optionalNoteSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request body' });
  try {
    const result = await closeIncident({ incidentId: getIdParam(req), actorPlatformAdminId: req.platformAdmin!.id, note: parsed.data.note });
    respondLifecycle(res, result);
  } catch (err) {
    console.error('[platform-security-incidents] close failed', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Failed to close incident' });
  }
});

router.post('/security/incidents/:id/false-positive', async (req: PlatformAdminRequest, res: Response) => {
  if (!(await checkMutationRateLimit(req, res))) return;
  const parsed = requiredSummarySchema('note').safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'note is required' });
  try {
    const result = await markFalsePositive({ incidentId: getIdParam(req), actorPlatformAdminId: req.platformAdmin!.id, note: parsed.data.note });
    respondLifecycle(res, result);
  } catch (err) {
    console.error('[platform-security-incidents] false-positive failed', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Failed to mark incident as false positive' });
  }
});

router.post('/security/incidents/:id/reopen', async (req: PlatformAdminRequest, res: Response) => {
  if (!(await checkMutationRateLimit(req, res))) return;
  const parsed = requiredSummarySchema('note').safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'note is required' });
  try {
    const result = await reopenIncident({ incidentId: getIdParam(req), actorPlatformAdminId: req.platformAdmin!.id, note: parsed.data.note });
    respondLifecycle(res, result);
  } catch (err) {
    console.error('[platform-security-incidents] reopen failed', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Failed to reopen incident' });
  }
});

router.post('/security/incidents/:id/notes', async (req: PlatformAdminRequest, res: Response) => {
  if (!(await checkMutationRateLimit(req, res))) return;
  const parsed = requiredSummarySchema('note').safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'note is required' });
  try {
    const result = await addIncidentNote({ incidentId: getIdParam(req), actorPlatformAdminId: req.platformAdmin!.id, note: parsed.data.note });
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }
    res.json(toIncidentDTO(result.incident));
  } catch (err) {
    console.error('[platform-security-incidents] add note failed', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Failed to add note' });
  }
});

export default router;
