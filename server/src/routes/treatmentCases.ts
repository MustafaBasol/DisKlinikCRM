import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { treatmentCaseSchema } from '../schemas/index.js';
import { generateEarningFromTreatmentCase } from '../services/earningService.js';
import { validateAndGetClinicIdScope, getAccessibleClinicIds, resolveEffectiveClinicId } from '../utils/clinicScope.js';
import { getClinicOperatingPreferences } from '../services/clinicOperatingPreferences.js';

const router = express.Router();

const treatmentCaseInclude = {
  patient: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
  practitioner: { select: { id: true, firstName: true, lastName: true } },
  appointments: {
    where: { deletedAt: null },
    include: { appointmentType: { select: { id: true, name: true } }, practitioner: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { startTime: 'asc' as const },
  },
  payments: { orderBy: { createdAt: 'desc' as const } },
};

// GET /api/treatment-cases
router.get('/treatment-cases', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']), async (req: AuthRequest, res: Response) => {
  const { normalizedRole, id: userId } = req.user!;
  const { status, patientId, practitionerId, clinicId: selectedClinicId } = req.query;

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const where: any = { ...scope };

    if (normalizedRole === 'DENTIST') where.practitionerId = userId;
    else if (practitionerId) where.practitionerId = String(practitionerId);

    if (patientId) where.patientId = String(patientId);
    if (status) where.status = String(status);

    const cases = await prisma.treatmentCase.findMany({
      where,
      include: treatmentCaseInclude,
      orderBy: { createdAt: 'desc' },
    });

    res.json(cases);
  } catch {
    res.status(500).json({ error: 'Failed to fetch treatment cases' });
  }
});

// GET /api/treatment-cases/:id
router.get('/treatment-cases/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const { normalizedRole, id: userId } = req.user!;

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const tc = await prisma.treatmentCase.findFirst({
      where: { id, clinicId: { in: accessibleIds } },
      include: {
        ...treatmentCaseInclude,
        activityLogs: {
          include: { user: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!tc) return res.status(404).json({ error: 'Treatment case not found' });

    if (normalizedRole === 'DENTIST' && tc.practitionerId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(tc);
  } catch {
    res.status(500).json({ error: 'Failed to fetch treatment case' });
  }
});

// POST /api/treatment-cases
// TODO(MVP): RECEPTIONIST can open treatment cases for intake workflow.
// Review before onboarding external clinics — consider restricting to DENTIST only.
router.post('/treatment-cases', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

  try {
    const operatingPreferences = await getClinicOperatingPreferences(clinicId);
    const validation = treatmentCaseSchema.safeParse({
      ...req.body,
      currency: req.body.currency || operatingPreferences.currency,
    });
    if (!validation.success) return res.status(400).json({ error: validation.error.format() });

    const practitionerId = validation.data.practitionerId ?? undefined;
    const [patient, practitioner] = await Promise.all([
      prisma.patient.findFirst({ where: { id: validation.data.patientId, organizationId: req.user!.organizationId, deletedAt: null } }),
      practitionerId ? prisma.user.findFirst({ where: { id: practitionerId, clinicId, role: 'doctor' } }) : Promise.resolve(null),
    ]);

    if (!patient) return res.status(400).json({ error: 'Invalid patient' });
    if (practitionerId && !practitioner) return res.status(400).json({ error: 'Invalid practitioner' });

    const tc = await prisma.treatmentCase.create({
      data: {
        ...validation.data,
        currency: validation.data.currency || operatingPreferences.currency,
        clinicId,
      },
      include: treatmentCaseInclude,
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'treatment_case', entityId: tc.id,
      action: 'created', description: `${patient.firstName} ${patient.lastName} için "${tc.title}" tedavi vakası oluşturuldu`,
    });

    // Auto-generate practitioner earning when TC is created with a known cost (billed base)
    if (tc.practitionerId && (tc.estimatedAmount || tc.acceptedAmount)) {
      generateEarningFromTreatmentCase(tc.id, clinicId, req.user!.id).catch(console.error);
    }

    res.json(tc);
  } catch {
    res.status(500).json({ error: 'Failed to create treatment case' });
  }
});

// PUT /api/treatment-cases/:id
// TODO(MVP): RECEPTIONIST can update treatment cases for status/note updates.
// Review before onboarding external clinics — consider restricting to DENTIST only.
router.put('/treatment-cases/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const { normalizedRole, id: userId } = req.user!;

  const validation = treatmentCaseSchema.partial().safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const existing = await prisma.treatmentCase.findFirst({ where: { id, clinicId: { in: accessibleIds } } });
    if (!existing) return res.status(404).json({ error: 'Treatment case not found' });
    const clinicId = existing.clinicId;

    if (normalizedRole === 'DENTIST' && existing.practitionerId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const updated = await prisma.treatmentCase.update({
      where: { id },
      data: validation.data,
      include: treatmentCaseInclude,
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'treatment_case', entityId: id,
      action: 'updated', description: `"${updated.title}" tedavi vakası güncellendi`,
    });

    // Auto-generate practitioner earning when treatment case has a known cost (billed base)
    // Covers: initial cost set, cost updated, and stage=completed
    if (updated.practitionerId && (updated.estimatedAmount || updated.acceptedAmount)) {
      generateEarningFromTreatmentCase(id, clinicId, req.user!.id).catch(console.error);
    }

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update treatment case' });
  }
});

// ── Treatment Materials (inventory usage) ────────────────────────────────────

// Helper: create a low-stock notification if item drops at or below minimum
async function checkAndNotifyLowStock(clinicId: string, itemId: string) {
  try {
    const item = await prisma.inventoryItem.findFirst({ where: { id: itemId, clinicId } });
    if (!item || item.minimumStock <= 0) return;
    if (item.currentStock <= item.minimumStock) {
      await (prisma as any).notification.upsert({
        where: { clinicId_externalId: { clinicId, externalId: `lowstock-${itemId}` } },
        create: {
          clinicId,
          externalId: `lowstock-${itemId}`,
          type: 'low_stock',
          title: `Düşük stok: ${item.name}`,
          subtitle: `Mevcut: ${item.currentStock} ${item.unit} (Min: ${item.minimumStock})`,
          link: '/inventory',
          isRead: false,
        },
        update: {
          isRead: false, // reset to unread whenever threshold is hit again
          subtitle: `Mevcut: ${item.currentStock} ${item.unit} (Min: ${item.minimumStock})`,
        },
      });
    }
  } catch {
    // silently fail if Notification table not migrated yet
  }
}

// GET /api/treatment-cases/:id/materials
router.get('/treatment-cases/:id/materials', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']), async (req: AuthRequest, res: Response) => {
  const id = String(getParam(req, 'id'));
  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    // Validate treatment case belongs to accessible clinic
    const tc = await prisma.treatmentCase.findFirst({ where: { id, clinicId: { in: accessibleIds } } });
    if (!tc) return res.status(404).json({ error: 'Treatment case not found' });
    const clinicId = tc.clinicId;

    const materials = await prisma.inventoryTransaction.findMany({
      where: { treatmentCaseId: id, clinicId, type: 'out', reason: 'treatment_use' },
      include: { item: { select: { id: true, name: true, unit: true, category: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(materials);
  } catch {
    res.status(500).json({ error: 'Failed to fetch materials' });
  }
});

// POST /api/treatment-cases/:id/materials
// TODO(MVP): RECEPTIONIST can record material usage during visit intake.
// Review before onboarding external clinics — consider restricting to DENTIST only.
router.post('/treatment-cases/:id/materials', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = String(getParam(req, 'id'));
  const userId = req.user!.id;
  const { itemId, quantity, notes } = req.body;

  if (!itemId || !quantity || Number(quantity) <= 0) {
    return res.status(400).json({ error: 'itemId and quantity (>0) are required' });
  }

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const tc = await prisma.treatmentCase.findFirst({ where: { id, clinicId: { in: accessibleIds } } });
    if (!tc) return res.status(404).json({ error: 'Treatment case not found' });
    const clinicId = tc.clinicId;

    const item = await prisma.inventoryItem.findFirst({ where: { id: itemId, clinicId, isActive: true } });
    if (!item) return res.status(404).json({ error: 'Inventory item not found' });

    const qty = Number(quantity);
    if (item.currentStock < qty) {
      return res.status(400).json({ error: `Yetersiz stok. Mevcut: ${item.currentStock} ${item.unit}` });
    }

    // Deduct from stock
    await prisma.inventoryItem.update({
      where: { id: itemId },
      data: { currentStock: { decrement: qty } },
    });

    // Create transaction record
    const tx = await prisma.inventoryTransaction.create({
      data: {
        clinicId,
        itemId,
        treatmentCaseId: id,
        type: 'out',
        quantity: qty,
        unitCost: item.unitCost ?? null,
        reason: 'treatment_use',
        notes: notes ? String(notes) : null,
        performedById: userId,
      },
      include: { item: { select: { id: true, name: true, unit: true, category: true } } },
    });

    await checkAndNotifyLowStock(clinicId, itemId);

    await logActivity({
      clinicId, userId, action: 'updated', entityType: 'treatmentCase', entityId: id,
      description: `Tedavi malzemesi eklendi: ${item.name} × ${qty} ${item.unit}`,
    });

    res.status(201).json(tx);
  } catch (err: any) {
    console.error('Treatment material create error:', err?.message);
    res.status(500).json({ error: 'Failed to add material' });
  }
});

// DELETE /api/treatment-cases/:id/materials/:txId
// RECEPTIONIST intentionally excluded: deleting a material restores inventory stock —
// a sensitive operation that should require clinical authority (DENTIST) or management.
router.delete('/treatment-cases/:id/materials/:txId', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST']), async (req: AuthRequest, res: Response) => {
  const id = String(getParam(req, 'id'));
  const txId = String(req.params.txId);
  const userId = req.user!.id;

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const tx = await prisma.inventoryTransaction.findFirst({
      where: { id: txId, treatmentCaseId: id, clinicId: { in: accessibleIds }, type: 'out', reason: 'treatment_use' },
    });
    if (!tx) return res.status(404).json({ error: 'Material record not found' });
    const clinicId = tx.clinicId;

    // Restore stock
    await prisma.inventoryItem.update({
      where: { id: tx.itemId },
      data: { currentStock: { increment: tx.quantity } },
    });

    await prisma.inventoryTransaction.delete({ where: { id: txId } });

    await logActivity({
      clinicId, userId, action: 'updated', entityType: 'treatmentCase', entityId: id,
      description: `Tedavi malzemesi kaldırıldı: ${tx.quantity} adet (stoka geri eklendi)`,
    });

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to remove material' });
  }
});

export default router;
