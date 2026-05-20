import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { taskSchema } from '../schemas/index.js';
import { validateAndGetScope } from '../utils/clinicScope.js';

const router = express.Router();

// GET /api/tasks
router.get('/tasks', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const { role, id: userId } = req.user!;
  const { status, assignedToId, patientId, clinicId: selectedClinicId } = req.query;

  try {
    const scope = await validateAndGetScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const where: any = { ...scope };

    if (role === 'doctor') {
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
router.get('/tasks/:id', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const task = await prisma.task.findFirst({
      where: { id, clinicId },
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
router.post('/tasks', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const validation = taskSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
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
router.put('/tasks/:id', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const validation = taskSchema.partial().safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const existing = await prisma.task.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Task not found' });

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

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// PATCH /api/tasks/:id/complete
router.patch('/tasks/:id/complete', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const existing = await prisma.task.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    if (existing.status === 'completed') return res.status(400).json({ error: 'Task is already completed' });

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
