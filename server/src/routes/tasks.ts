import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { taskSchema } from '../schemas/index.js';
import { validateAndGetClinicIdScope, getAccessibleClinicIds, resolveEffectiveClinicId } from '../utils/clinicScope.js';
import { sendTaskAssignmentNotification } from '../services/taskAssignmentNotifier.js';
import { validateTaskRelations } from '../utils/relationGuards.js';

const router = express.Router();

// GET /api/tasks
router.get('/tasks', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const { normalizedRole, id: userId } = req.user!;
  const { status, assignedToId, patientId, clinicId: selectedClinicId } = req.query;

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const where: any = { ...scope };

    if (normalizedRole === 'DENTIST') {
      where.OR = [{ assignedToId: userId }, { createdById: userId }];
    }

    if (assignedToId) where.assignedToId = String(assignedToId);
    if (patientId) where.patientId = String(patientId);
    if (status) where.status = String(status);

    const tasks = await prisma.task.findMany({
      where,
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });

    res.json(tasks);
  } catch {
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// GET /api/tasks/:id
router.get('/tasks/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const task = await prisma.task.findFirst({
      where: { id, clinicId: { in: accessibleIds } },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!task) return res.status(404).json({ error: 'Task not found' });

    res.json(task);
  } catch {
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

// POST /api/tasks
router.post('/tasks', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });
  const validation = taskSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const relationValidation = await validateTaskRelations(validation.data, clinicId);
    if (relationValidation.error) return res.status(400).json({ error: relationValidation.error });

    const task = await prisma.task.create({
      data: { ...validation.data, clinicId, createdById: req.user!.id },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'task', entityId: task.id,
      action: 'created', description: `"${task.title}" görevi oluşturuldu`,
    });

    res.json(task);
  } catch {
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// PUT /api/tasks/:id
router.put('/tasks/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const validation = taskSchema.partial().safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const existing = await prisma.task.findFirst({ where: { id, clinicId: { in: accessibleIds } } });
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    const clinicId = existing.clinicId;

    const relationValidation = await validateTaskRelations({
      patientId: validation.data.patientId === undefined ? existing.patientId : validation.data.patientId,
      appointmentId: validation.data.appointmentId === undefined ? existing.appointmentId : validation.data.appointmentId,
      treatmentCaseId: existing.treatmentCaseId,
      assignedToId: validation.data.assignedToId === undefined ? existing.assignedToId : validation.data.assignedToId,
    }, clinicId);
    if (relationValidation.error) return res.status(400).json({ error: relationValidation.error });

    const updated = await prisma.task.update({
      where: { id },
      data: validation.data,
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'task', entityId: id,
      action: 'updated', description: `"${updated.title}" görevi güncellendi`,
    });

    if (validation.data.assignedToId && validation.data.assignedToId !== existing.assignedToId) {
      await sendTaskAssignmentNotification(clinicId, updated);
    }

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// PATCH /api/tasks/:id/complete
router.patch('/tasks/:id/complete', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const existing = await prisma.task.findFirst({ where: { id, clinicId: { in: accessibleIds } } });
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    if (existing.status === 'completed') return res.status(400).json({ error: 'Task is already completed' });
    const clinicId = existing.clinicId;

    const updated = await prisma.task.update({
      where: { id },
      data: { status: 'completed', completedAt: new Date() },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'task', entityId: id,
      action: 'completed', description: `"${updated.title}" görevi tamamlandı`,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to complete task' });
  }
});

export default router;
