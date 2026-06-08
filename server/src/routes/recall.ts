import express, { Response } from 'express';
import { z } from 'zod';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { resolveEffectiveClinicId, validateAndGetClinicIdScope, getAccessibleClinicIds } from '../utils/clinicScope.js';
import { getParam } from '../utils/helpers.js';
import { logActivity } from '../utils/activity.js';
import {
  getRecallSettings,
  recallSettingsSchema,
  upsertRecallSettings,
} from '../services/recallSettings.js';
import {
  ACTIVE_RECALL_STATUSES,
  createRecallTaskForCandidate,
  generateRecallCandidatesForClinic,
  prepareRecallMessageForCandidate,
  recallCandidateInclude,
} from '../services/recallCandidateService.js';

const router = express.Router();

const recallReadRoles = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING'];
const recallActionRoles = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING'];
const recallManageRoles = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER'];

const candidateStatusValues = [
  'PENDING',
  'TASK_CREATED',
  'MESSAGE_DRAFTED',
  'CONTACTED',
  'APPOINTMENT_BOOKED',
  'DECLINED',
  'SNOOZED',
  'COMPLETED',
  'CANCELLED',
] as const;

const statusSchema = z.object({
  status: z.enum(candidateStatusValues),
  note: z.string().max(1000).optional().nullable(),
});

const snoozeSchema = z.object({
  nextActionAt: z.string().datetime(),
  note: z.string().max(1000).optional().nullable(),
});

const noteSchema = z.object({
  note: z.string().max(1000).optional().nullable(),
});

async function validateRecallTemplateIds(clinicId: string, settings: Record<string, unknown>) {
  const templateIds = Object.entries(settings)
    .filter(([key, value]) => key.endsWith('MessageTemplateId') && typeof value === 'string' && value)
    .map(([, value]) => String(value));

  const uniqueIds = [...new Set(templateIds)];
  if (uniqueIds.length === 0) return { error: null };

  const count = await prisma.messageTemplate.count({
    where: {
      clinicId,
      id: { in: uniqueIds },
      channel: 'whatsapp',
      isActive: true,
    },
  });

  if (count !== uniqueIds.length) {
    return { error: 'One or more recall message templates are invalid for this clinic' };
  }

  return { error: null };
}

async function findAccessibleCandidate(req: AuthRequest, id: string) {
  const accessibleIds = await getAccessibleClinicIds(req.user!);
  if (accessibleIds.length === 0) return null;

  return prisma.recallCandidate.findFirst({
    where: { id, clinicId: { in: accessibleIds } },
    include: recallCandidateInclude,
  });
}

function buildSummary(candidates: any[]) {
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const active = candidates.filter(candidate =>
    (ACTIVE_RECALL_STATUSES as readonly string[]).includes(candidate.status),
  );

  return {
    todayCount: active.filter(candidate => new Date(candidate.nextActionAt ?? candidate.dueAt) <= todayEnd).length,
    routineCheckups: active.filter(candidate => candidate.recallType === 'ROUTINE_CHECKUP').length,
    incompleteTreatments: active.filter(candidate => candidate.recallType === 'INCOMPLETE_TREATMENT').length,
    pendingTreatmentPlans: active.filter(candidate => candidate.recallType === 'TREATMENT_PLAN_NOT_STARTED').length,
    noShowFollowups: active.filter(candidate => candidate.recallType === 'NO_SHOW_FOLLOW_UP').length,
    estimatedPendingRevenue: active.reduce((sum, candidate) => sum + (candidate.estimatedValue ?? 0), 0),
  };
}

router.get('/recall/settings', authorize(recallReadRoles), async (req: AuthRequest, res: Response) => {
  const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

  try {
    const settings = await getRecallSettings(clinicId);
    res.json({ clinicId, settings });
  } catch {
    res.status(500).json({ error: 'Failed to load recall settings' });
  }
});

router.put('/recall/settings', authorize(recallManageRoles), async (req: AuthRequest, res: Response) => {
  const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

  const parsed = recallSettingsSchema.safeParse((req.body as { settings?: unknown }).settings ?? req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

  try {
    const templateValidation = await validateRecallTemplateIds(clinicId, parsed.data);
    if (templateValidation.error) return res.status(400).json({ error: templateValidation.error });

    const settings = await upsertRecallSettings(clinicId, parsed.data);

    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'settings',
      entityId: clinicId,
      action: 'recall_settings_updated',
      description: 'Recall settings updated',
    });

    res.json({ clinicId, settings });
  } catch {
    res.status(500).json({ error: 'Failed to save recall settings' });
  }
});

router.post('/recall/generate', authorize(recallManageRoles), async (req: AuthRequest, res: Response) => {
  const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

  try {
    const result = await generateRecallCandidatesForClinic(clinicId, req.user!.id);
    res.json({ clinicId, ...result });
  } catch (error: any) {
    console.error('[recall] generate error:', error?.message ?? error);
    res.status(500).json({ error: 'Failed to generate recall candidates' });
  }
});

router.get('/recall/candidates', authorize(recallReadRoles), async (req: AuthRequest, res: Response) => {
  const {
    clinicId: selectedClinicId,
    recallType,
    status,
    priority,
    assignedToId,
    search,
    dueFrom,
    dueTo,
  } = req.query;

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const where: any = { ...scope };
    if (recallType) where.recallType = String(recallType);
    if (status) where.status = String(status);
    if (priority) where.priority = String(priority);
    if (assignedToId) where.assignedToId = String(assignedToId);
    if (dueFrom || dueTo) {
      where.dueAt = {};
      if (dueFrom) where.dueAt.gte = new Date(String(dueFrom));
      if (dueTo) where.dueAt.lte = new Date(String(dueTo));
    }
    if (search) {
      const q = String(search);
      where.OR = [
        { patient: { firstName: { contains: q, mode: 'insensitive' } } },
        { patient: { lastName: { contains: q, mode: 'insensitive' } } },
        { patient: { phone: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const candidates = await prisma.recallCandidate.findMany({
      where,
      include: recallCandidateInclude,
      orderBy: [{ nextActionAt: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
      take: 250,
    });

    res.json({ candidates, summary: buildSummary(candidates) });
  } catch (error: any) {
    console.error('[recall] candidates error:', error?.message ?? error);
    res.status(500).json({ error: 'Failed to fetch recall candidates' });
  }
});

router.get('/recall/candidates/:id', authorize(recallReadRoles), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  try {
    const candidate = await findAccessibleCandidate(req, id);
    if (!candidate) return res.status(404).json({ error: 'Recall candidate not found' });
    res.json(candidate);
  } catch {
    res.status(500).json({ error: 'Failed to fetch recall candidate' });
  }
});

router.patch('/recall/candidates/:id/status', authorize(recallActionRoles), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

  try {
    const existing = await findAccessibleCandidate(req, id);
    if (!existing) return res.status(404).json({ error: 'Recall candidate not found' });

    const now = new Date();
    const data: any = { status: parsed.data.status };
    if (parsed.data.status === 'COMPLETED') data.completedAt = now;
    if (parsed.data.status === 'CANCELLED') data.cancelledAt = now;
    if (parsed.data.status === 'CONTACTED') {
      data.lastContactedAt = now;
      data.attemptsCount = { increment: 1 };
    }

    const candidate = await prisma.recallCandidate.update({
      where: { id },
      data,
      include: recallCandidateInclude,
    });

    await prisma.recallAction.create({
      data: {
        clinicId: existing.clinicId,
        candidateId: id,
        patientId: existing.patientId,
        actionType: 'STATUS_CHANGED',
        performedById: req.user!.id,
        note: parsed.data.note ?? `Status changed to ${parsed.data.status}`,
      },
    });

    await logActivity({
      clinicId: existing.clinicId,
      userId: req.user!.id,
      entityType: 'recall_candidate',
      entityId: id,
      action: 'recall_status_changed',
      description: `Recall status changed to ${parsed.data.status}`,
      patientId: existing.patientId,
      appointmentId: existing.appointmentId,
      treatmentCaseId: existing.treatmentCaseId,
      metadata: { status: parsed.data.status },
    });

    res.json(candidate);
  } catch {
    res.status(500).json({ error: 'Failed to update recall status' });
  }
});

router.post('/recall/candidates/:id/snooze', authorize(recallActionRoles), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const parsed = snoozeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

  try {
    const existing = await findAccessibleCandidate(req, id);
    if (!existing) return res.status(404).json({ error: 'Recall candidate not found' });

    const nextActionAt = new Date(parsed.data.nextActionAt);
    const candidate = await prisma.recallCandidate.update({
      where: { id },
      data: { status: 'SNOOZED', nextActionAt, dueAt: nextActionAt, note: parsed.data.note ?? existing.note },
      include: recallCandidateInclude,
    });

    await prisma.recallAction.create({
      data: {
        clinicId: existing.clinicId,
        candidateId: id,
        patientId: existing.patientId,
        actionType: 'SNOOZED',
        performedById: req.user!.id,
        note: parsed.data.note ?? `Snoozed until ${nextActionAt.toISOString()}`,
      },
    });

    await logActivity({
      clinicId: existing.clinicId,
      userId: req.user!.id,
      entityType: 'recall_candidate',
      entityId: id,
      action: 'recall_snoozed',
      description: `Recall snoozed until ${nextActionAt.toISOString()}`,
      patientId: existing.patientId,
      appointmentId: existing.appointmentId,
      treatmentCaseId: existing.treatmentCaseId,
    });

    res.json(candidate);
  } catch {
    res.status(500).json({ error: 'Failed to snooze recall candidate' });
  }
});

router.post('/recall/candidates/:id/create-task', authorize(recallActionRoles), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const parsed = noteSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

  try {
    const existing = await findAccessibleCandidate(req, id);
    if (!existing) return res.status(404).json({ error: 'Recall candidate not found' });

    const task = await createRecallTaskForCandidate(id, req.user!.id, parsed.data.note ?? undefined);
    const candidate = await prisma.recallCandidate.findUnique({ where: { id }, include: recallCandidateInclude });
    res.json({ task, candidate });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Failed to create recall task' });
  }
});

router.post('/recall/candidates/:id/prepare-message', authorize(recallActionRoles), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  try {
    const existing = await findAccessibleCandidate(req, id);
    if (!existing) return res.status(404).json({ error: 'Recall candidate not found' });

    const message = await prepareRecallMessageForCandidate(id, req.user!.id);
    const candidate = await prisma.recallCandidate.findUnique({ where: { id }, include: recallCandidateInclude });
    res.json({ message, candidate });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Failed to prepare recall message' });
  }
});

router.post('/recall/candidates/:id/log-contact', authorize(recallActionRoles), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const parsed = noteSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.format() });

  try {
    const existing = await findAccessibleCandidate(req, id);
    if (!existing) return res.status(404).json({ error: 'Recall candidate not found' });

    const candidate = await prisma.recallCandidate.update({
      where: { id },
      data: {
        status: 'CONTACTED',
        lastContactedAt: new Date(),
        attemptsCount: { increment: 1 },
        note: parsed.data.note ?? existing.note,
      },
      include: recallCandidateInclude,
    });

    await prisma.recallAction.create({
      data: {
        clinicId: existing.clinicId,
        candidateId: id,
        patientId: existing.patientId,
        actionType: 'CALL_LOGGED',
        performedById: req.user!.id,
        note: parsed.data.note ?? null,
      },
    });

    await logActivity({
      clinicId: existing.clinicId,
      userId: req.user!.id,
      entityType: 'recall_candidate',
      entityId: id,
      action: 'recall_contact_logged',
      description: 'Recall contact logged',
      patientId: existing.patientId,
      appointmentId: existing.appointmentId,
      treatmentCaseId: existing.treatmentCaseId,
    });

    res.json(candidate);
  } catch {
    res.status(500).json({ error: 'Failed to log recall contact' });
  }
});

export default router;
