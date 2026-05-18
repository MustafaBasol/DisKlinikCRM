import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import {
  practitionerCompensationRuleSchema,
  serviceCompensationRuleSchema,
} from '../schemas/index.js';

const router = express.Router();

// ─── Practitioner Compensation Rules ────────────────────────────────────────

// GET /api/compensation-rules?practitionerId=
router.get('/compensation-rules', authorize(['admin', 'billing']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { practitionerId } = req.query;

  try {
    const rules = await prisma.practitionerCompensationRule.findMany({
      where: {
        clinicId,
        ...(practitionerId ? { practitionerId: String(practitionerId) } : {}),
      },
      include: { practitioner: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(rules);
  } catch {
    res.status(500).json({ error: 'Failed to fetch compensation rules' });
  }
});

// POST /api/compensation-rules
router.post('/compensation-rules', authorize(['admin']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const validation = practitionerCompensationRuleSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const practitioner = await prisma.user.findFirst({
      where: { id: validation.data.practitionerId, clinicId, role: 'doctor' },
    });
    if (!practitioner) return res.status(400).json({ error: 'Invalid practitioner' });

    const rule = await prisma.practitionerCompensationRule.create({
      data: { ...validation.data, clinicId },
      include: { practitioner: { select: { id: true, firstName: true, lastName: true } } },
    });

    await logActivity({
      clinicId, userId: req.user!.id,
      entityType: 'compensation_rule', entityId: rule.id,
      action: 'created',
      description: `Compensation rule created for ${practitioner.firstName} ${practitioner.lastName}`,
    });

    res.json(rule);
  } catch {
    res.status(500).json({ error: 'Failed to create compensation rule' });
  }
});

// PUT /api/compensation-rules/:id
router.put('/compensation-rules/:id', authorize(['admin']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const validation = practitionerCompensationRuleSchema.partial().safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const existing = await prisma.practitionerCompensationRule.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Compensation rule not found' });

    const updated = await prisma.practitionerCompensationRule.update({
      where: { id },
      data: validation.data,
      include: { practitioner: { select: { id: true, firstName: true, lastName: true } } },
    });

    await logActivity({
      clinicId, userId: req.user!.id,
      entityType: 'compensation_rule', entityId: id,
      action: 'updated', description: 'Compensation rule updated',
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update compensation rule' });
  }
});

// DELETE /api/compensation-rules/:id
router.delete('/compensation-rules/:id', authorize(['admin']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const existing = await prisma.practitionerCompensationRule.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Compensation rule not found' });

    await prisma.practitionerCompensationRule.delete({ where: { id } });

    await logActivity({
      clinicId, userId: req.user!.id,
      entityType: 'compensation_rule', entityId: id,
      action: 'deleted', description: 'Compensation rule deleted',
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete compensation rule' });
  }
});

// ─── Service Compensation Rules ──────────────────────────────────────────────

// GET /api/service-compensation-rules?practitionerId=
router.get('/service-compensation-rules', authorize(['admin', 'billing']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { practitionerId } = req.query;

  try {
    const rules = await prisma.serviceCompensationRule.findMany({
      where: {
        clinicId,
        ...(practitionerId ? { practitionerId: String(practitionerId) } : {}),
      },
      include: {
        practitioner: { select: { id: true, firstName: true, lastName: true } },
        service: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(rules);
  } catch {
    res.status(500).json({ error: 'Failed to fetch service compensation rules' });
  }
});

// POST /api/service-compensation-rules
router.post('/service-compensation-rules', authorize(['admin']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const validation = serviceCompensationRuleSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const [practitioner, service] = await Promise.all([
      prisma.user.findFirst({ where: { id: validation.data.practitionerId, clinicId, role: 'doctor' } }),
      prisma.appointmentType.findFirst({ where: { id: validation.data.serviceId, clinicId } }),
    ]);
    if (!practitioner) return res.status(400).json({ error: 'Invalid practitioner' });
    if (!service) return res.status(400).json({ error: 'Invalid service' });

    const rule = await prisma.serviceCompensationRule.upsert({
      where: { practitionerId_serviceId: { practitionerId: validation.data.practitionerId, serviceId: validation.data.serviceId } },
      create: { ...validation.data, clinicId },
      update: { percentage: validation.data.percentage, fixedAmount: validation.data.fixedAmount, isActive: validation.data.isActive },
      include: {
        practitioner: { select: { id: true, firstName: true, lastName: true } },
        service: { select: { id: true, name: true } },
      },
    });

    await logActivity({
      clinicId, userId: req.user!.id,
      entityType: 'service_compensation_rule', entityId: rule.id,
      action: 'upserted',
      description: `Service compensation rule set for ${practitioner.firstName} ${practitioner.lastName} — ${service.name}`,
    });

    res.json(rule);
  } catch {
    res.status(500).json({ error: 'Failed to save service compensation rule' });
  }
});

// DELETE /api/service-compensation-rules/:id
router.delete('/service-compensation-rules/:id', authorize(['admin']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const existing = await prisma.serviceCompensationRule.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Service compensation rule not found' });

    await prisma.serviceCompensationRule.delete({ where: { id } });

    await logActivity({
      clinicId, userId: req.user!.id,
      entityType: 'service_compensation_rule', entityId: id,
      action: 'deleted', description: 'Service compensation rule deleted',
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete service compensation rule' });
  }
});

export default router;
