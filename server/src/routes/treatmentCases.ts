import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { treatmentCaseSchema } from '../schemas/index.js';
import { generateEarningFromTreatmentCase } from '../services/earningService.js';
import { validateAndGetClinicIdScope, getAccessibleClinicIds, resolveEffectiveClinicId } from '../utils/clinicScope.js';
import { getClinicOperatingPreferences } from '../services/clinicOperatingPreferences.js';
import { safeErrorFields } from '../utils/safeError.js';
import {
  findAppointmentTypeInClinic,
  findPatientInClinic,
  findUserAssignedToClinic,
} from '../utils/relationGuards.js';
import {
  MAX_PROPOSAL_PROCEDURES,
  buildProposalPdfFilename,
  generateTreatmentProposalPdf,
  type ProposalLocale,
} from '../services/treatmentProposalPdf.js';

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
router.get('/treatment-cases', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const { normalizedRole, id: userId } = req.user!;
  const { status, search, patientId, practitionerId, clinicId: selectedClinicId, limit } = req.query;

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const where: any = { ...scope };

    if (normalizedRole === 'DENTIST') where.practitionerId = userId;
    else if (practitionerId) where.practitionerId = String(practitionerId);

    if (patientId) where.patientId = String(patientId);
    if (status) where.status = String(status);

    // UX-001-PROD-SMOKE-R2 (finding 2): `search` was previously accepted by
    // callers (GlobalSearch, TreatmentCases.tsx) but silently ignored here,
    // so a query like "mustafa" returned the role's entire unfiltered/most
    // recent case list instead of matches — surfacing unrelated patients'
    // treatment cases. Match against the same user-visible fields the UI
    // renders: treatment title, patient first/last name.
    if (search) {
      const s = String(search);
      where.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { patient: { firstName: { contains: s, mode: 'insensitive' } } },
        { patient: { lastName: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const parsedLimit = Number(limit);
    const take = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(Math.floor(parsedLimit), 500) : undefined;

    const cases = await prisma.treatmentCase.findMany({
      where,
      include: treatmentCaseInclude,
      orderBy: { createdAt: 'desc' },
      ...(take !== undefined ? { take } : {}),
    });

    res.json(cases);
  } catch {
    res.status(500).json({ error: 'Failed to fetch treatment cases' });
  }
});

// GET /api/treatment-cases/financial-select
// Restricted selector for payment workflows: BILLING (and other finance-capable roles) can
// resolve a patient's treatment cases without exposing clinical data (procedures, notes,
// dental chart, attachments, activity logs).
router.get('/treatment-cases/financial-select', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const { patientId, clinicId: selectedClinicId } = req.query;
  if (!patientId) return res.status(400).json({ error: 'patientId is required' });

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const cases = await prisma.treatmentCase.findMany({
      where: { ...scope, patientId: String(patientId), deletedAt: null },
      select: {
        id: true,
        title: true,
        patientId: true,
        clinicId: true,
        stage: true,
        estimatedAmount: true,
        acceptedAmount: true,
        currency: true,
        createdAt: true,
        updatedAt: true,
        payments: { where: { paymentStatus: 'paid' }, select: { amount: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = cases.map(({ payments, ...tc }) => {
      const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
      const remainingBalance = (tc.acceptedAmount ?? tc.estimatedAmount ?? 0) - totalPaid;
      return { ...tc, totalPaid, remainingBalance };
    });

    res.json(result);
  } catch {
    res.status(500).json({ error: 'Failed to fetch treatment cases' });
  }
});

// GET /api/treatment-cases/:id
router.get('/treatment-cases/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
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

// GET /api/treatment-cases/:id/proposal-pdf
// US-02.2 Phase 1: deterministic, server-generated treatment proposal PDF.
// Same authorization/clinic-scope/DENTIST-ownership rules as the detail GET above —
// no new authorization mechanism. Route stays thin: it only resolves/authorizes data
// and delegates rendering to services/treatmentProposalPdf.ts (no auth/tenant logic there).
router.get('/treatment-cases/:id/proposal-pdf', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const { normalizedRole, id: userId } = req.user!;

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const tc = await prisma.treatmentCase.findFirst({
      where: { id, clinicId: { in: accessibleIds } },
      include: {
        patient: { select: { firstName: true, lastName: true } },
        practitioner: { select: { firstName: true, lastName: true } },
        clinic: { select: { name: true, address: true, phone: true, currency: true, defaultLanguage: true } },
        procedures: {
          // Cancelled procedures must never appear on the patient proposal or contribute to
          // its total — filtered here at the Prisma level (preferred); the PDF service also
          // filters defense-in-depth, per the project's `status !== 'cancelled'` convention.
          where: { status: { not: 'cancelled' } },
          select: { toothFdi: true, procedureName: true, status: true, estimatedCost: true },
          orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    if (!tc) return res.status(404).json({ error: 'Treatment case not found' });

    if (normalizedRole === 'DENTIST' && tc.practitionerId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (tc.procedures.length > MAX_PROPOSAL_PROCEDURES) {
      return res.status(400).json({ error: 'Too many procedures for a proposal PDF export' });
    }

    const locale: ProposalLocale = (['tr', 'en', 'fr', 'de'] as const).includes(tc.clinic.defaultLanguage as ProposalLocale)
      ? (tc.clinic.defaultLanguage as ProposalLocale)
      : 'en';
    const generatedAt = new Date();

    const pdfBuffer = await generateTreatmentProposalPdf({
      locale,
      clinic: { name: tc.clinic.name, address: tc.clinic.address, phone: tc.clinic.phone },
      patient: { fullName: `${tc.patient.firstName} ${tc.patient.lastName}` },
      treatmentCase: {
        title: tc.title,
        stage: tc.stage,
        practitionerName: tc.practitioner ? `${tc.practitioner.firstName} ${tc.practitioner.lastName}` : null,
        currency: tc.currency || tc.clinic.currency,
        estimatedAmount: tc.estimatedAmount,
        acceptedAmount: tc.acceptedAmount,
      },
      procedures: tc.procedures.map((p) => ({
        toothFdi: p.toothFdi,
        procedureName: p.procedureName,
        status: p.status,
        estimatedCost: p.estimatedCost,
      })),
      generatedAt,
    });

    const filename = buildProposalPdfFilename(id, generatedAt);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Proposal PDF generation failed', { treatmentCaseId: id, ...safeErrorFields(err) });
    res.status(500).json({ error: 'Failed to generate proposal PDF' });
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
    const appointmentTypeId = validation.data.appointmentTypeId ?? undefined;
    const [patient, practitioner, appointmentType] = await Promise.all([
      findPatientInClinic(validation.data.patientId, clinicId),
      practitionerId ? findUserAssignedToClinic(practitionerId, clinicId, { roles: ['DENTIST'] }) : Promise.resolve(null),
      appointmentTypeId ? findAppointmentTypeInClinic(appointmentTypeId, clinicId) : Promise.resolve(null),
    ]);

    if (!patient) return res.status(400).json({ error: 'Invalid patient' });
    if (practitionerId && !practitioner) return res.status(400).json({ error: 'Invalid practitioner' });
    if (appointmentTypeId && !appointmentType) return res.status(400).json({ error: 'Invalid appointment type' });

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

    const nextPatientId = validation.data.patientId ?? existing.patientId;
    const nextPractitionerId = validation.data.practitionerId === undefined
      ? existing.practitionerId
      : validation.data.practitionerId;
    const nextAppointmentTypeId = validation.data.appointmentTypeId === undefined
      ? existing.appointmentTypeId
      : validation.data.appointmentTypeId;

    if (normalizedRole === 'DENTIST' && nextPractitionerId !== userId) {
      return res.status(403).json({ error: 'Doctors cannot reassign treatment cases' });
    }

    const [patient, practitioner, appointmentType] = await Promise.all([
      findPatientInClinic(nextPatientId, clinicId),
      nextPractitionerId ? findUserAssignedToClinic(nextPractitionerId, clinicId, { roles: ['DENTIST'] }) : Promise.resolve(null),
      nextAppointmentTypeId ? findAppointmentTypeInClinic(nextAppointmentTypeId, clinicId) : Promise.resolve(null),
    ]);

    if (!patient) return res.status(400).json({ error: 'Invalid patient' });
    if (nextPractitionerId && !practitioner) return res.status(400).json({ error: 'Invalid practitioner' });
    if (nextAppointmentTypeId && !appointmentType) return res.status(400).json({ error: 'Invalid appointment type' });

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
router.get('/treatment-cases/:id/materials', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = String(getParam(req, 'id'));
  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    // Validate treatment case belongs to accessible clinic
    const tc = await prisma.treatmentCase.findFirst({ where: { id, clinicId: { in: accessibleIds } } });
    if (!tc) return res.status(404).json({ error: 'Treatment case not found' });
    if (req.user!.normalizedRole === 'DENTIST' && tc.practitionerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
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
    if (req.user!.normalizedRole === 'DENTIST' && tc.practitionerId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
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
        // Manually recorded usage is already expressed directly against
        // currentStock's base unit — no purchase-unit conversion applies here.
        unitId: item.consumptionUnitId,
        quantityInBaseUnit: qty,
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
    console.error('Treatment material create error:', safeErrorFields(err));
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

    if (req.user!.normalizedRole === 'DENTIST') {
      const tc = await prisma.treatmentCase.findFirst({
        where: { id, clinicId, practitionerId: userId },
        select: { id: true },
      });
      if (!tc) return res.status(403).json({ error: 'Forbidden' });
    }

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
