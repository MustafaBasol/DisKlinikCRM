import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { laboratorySchema, laboratoryUpdateSchema } from '../schemas/index.js';
import { validateAndGetClinicIdScope, getAccessibleClinicIds, resolveEffectiveClinicId } from '../utils/clinicScope.js';

const router = express.Router();

// External lab directory (reference data): who can create/edit lab work orders can also
// manage the directory those orders point to. BILLING is read-only, matching lab order access.
const LAB_MANAGE_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'ASSISTANT'] as const;
const LAB_READ_ROLES = [...LAB_MANAGE_ROLES, 'BILLING'] as const;
const LAB_DELETE_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER'] as const;

// GET /api/laboratories
router.get('/laboratories', authorize([...LAB_READ_ROLES]), async (req: AuthRequest, res: Response) => {
  const { isActive, clinicId: selectedClinicId } = req.query;

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const where: any = { ...scope, deletedAt: null };
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const labs = await prisma.laboratory.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    res.json(labs);
  } catch {
    res.status(500).json({ error: 'Failed to fetch laboratories' });
  }
});

// POST /api/laboratories
router.post('/laboratories', authorize([...LAB_MANAGE_ROLES]), async (req: AuthRequest, res: Response) => {
  const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

  const validation = laboratorySchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const lab = await prisma.laboratory.create({
      data: { ...validation.data, clinicId, createdById: req.user!.id },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'laboratory', entityId: lab.id,
      action: 'created', description: `Laboratuvar eklendi: ${lab.name}`,
    });

    res.status(201).json(lab);
  } catch {
    res.status(500).json({ error: 'Failed to create laboratory' });
  }
});

// PUT /api/laboratories/:id
router.put('/laboratories/:id', authorize([...LAB_MANAGE_ROLES]), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  const validation = laboratoryUpdateSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const existing = await prisma.laboratory.findFirst({ where: { id, clinicId: { in: accessibleIds }, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: 'Laboratory not found' });

    const updated = await prisma.laboratory.update({ where: { id }, data: validation.data });

    await logActivity({
      clinicId: existing.clinicId, userId: req.user!.id, entityType: 'laboratory', entityId: id,
      action: 'updated', description: `Laboratuvar güncellendi: ${updated.name}`,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update laboratory' });
  }
});

// DELETE /api/laboratories/:id — soft delete (deactivate)
router.delete('/laboratories/:id', authorize([...LAB_DELETE_ROLES]), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const existing = await prisma.laboratory.findFirst({ where: { id, clinicId: { in: accessibleIds }, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: 'Laboratory not found' });

    await prisma.laboratory.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });

    await logActivity({
      clinicId: existing.clinicId, userId: req.user!.id, entityType: 'laboratory', entityId: id,
      action: 'deleted', description: `Laboratuvar kaldırıldı: ${existing.name}`,
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete laboratory' });
  }
});

export default router;
