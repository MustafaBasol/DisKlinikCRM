import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { getAccessibleClinicIds, resolveEffectiveClinicId, validateAndGetClinicIdScope } from '../utils/clinicScope.js';

const router = express.Router();

const READ_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING', 'DENTIST', 'RECEPTIONIST'];
const MANAGE_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER'];

function normalizedName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ── GET /api/inventory-units ─────────────────────────────────────────────────
router.get('/inventory-units', authorize(READ_ROLES), async (req: AuthRequest, res: Response) => {
  const { includeInactive, clinicId: selectedClinicId } = req.query;

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const where: any = { ...scope };
    if (includeInactive !== 'true') where.isActive = true;

    const units = await prisma.inventoryUnit.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });

    return res.json(units);
  } catch (err) {
    console.error('Inventory unit list error:', err);
    return res.status(500).json({ error: 'Failed to fetch inventory units' });
  }
});

// ── POST /api/inventory-units ────────────────────────────────────────────────
router.post('/inventory-units', authorize(MANAGE_ROLES), async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const name = normalizedName(req.body.name);
  const abbreviation = normalizedName(req.body.abbreviation);

  if (!name || !abbreviation) {
    return res.status(400).json({ error: 'name and abbreviation are required', code: 'INVENTORY_UNIT_FIELDS_REQUIRED' });
  }

  const bodyClinicId = req.body.clinicId != null ? String(req.body.clinicId) : undefined;
  const queryClinicId = req.query.clinicId != null ? String(req.query.clinicId) : undefined;

  if (bodyClinicId !== undefined && queryClinicId !== undefined && bodyClinicId !== queryClinicId) {
    return res.status(400).json({ error: 'clinicId in body and query must match', code: 'INVENTORY_UNIT_CLINIC_MISMATCH' });
  }

  const selectedClinicId = bodyClinicId ?? queryClinicId;

  const clinicId = await resolveEffectiveClinicId(req.user!, selectedClinicId);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

  try {
    const unit = await prisma.inventoryUnit.create({
      data: { clinicId, name, abbreviation },
    });

    await logActivity({ clinicId, userId, action: 'create', entityType: 'inventory_unit', entityId: unit.id, description: `Yeni stok birimi eklendi: ${unit.name}` });

    return res.status(201).json(unit);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'An inventory unit with this name or abbreviation already exists in this clinic', code: 'INVENTORY_UNIT_DUPLICATE' });
    }
    console.error('Inventory unit create error:', err);
    return res.status(500).json({ error: 'Failed to create inventory unit' });
  }
});

// ── PUT /api/inventory-units/:id ─────────────────────────────────────────────
router.put('/inventory-units/:id', authorize(MANAGE_ROLES), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const userId = req.user!.id;
  const { name, abbreviation, isActive } = req.body;

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const existing = await prisma.inventoryUnit.findFirst({ where: { id, clinicId: { in: accessibleIds } } });
    if (!existing) return res.status(404).json({ error: 'Inventory unit not found' });

    if (name !== undefined && !normalizedName(name)) {
      return res.status(400).json({ error: 'name cannot be empty', code: 'INVENTORY_UNIT_FIELDS_REQUIRED' });
    }
    if (abbreviation !== undefined && !normalizedName(abbreviation)) {
      return res.status(400).json({ error: 'abbreviation cannot be empty', code: 'INVENTORY_UNIT_FIELDS_REQUIRED' });
    }

    const updated = await prisma.inventoryUnit.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: normalizedName(name)! }),
        ...(abbreviation !== undefined && { abbreviation: normalizedName(abbreviation)! }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    });

    await logActivity({
      clinicId: existing.clinicId, userId, action: 'update', entityType: 'inventory_unit', entityId: id,
      description: isActive === false ? `Stok birimi pasiflestirildi: ${updated.name}` : `Stok birimi guncellendi: ${updated.name}`,
    });

    return res.json(updated);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'An inventory unit with this name or abbreviation already exists in this clinic', code: 'INVENTORY_UNIT_DUPLICATE' });
    }
    console.error('Inventory unit update error:', err);
    return res.status(500).json({ error: 'Failed to update inventory unit' });
  }
});

export default router;
