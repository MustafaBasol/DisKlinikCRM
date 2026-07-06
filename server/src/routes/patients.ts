import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { patientSchema, patientUpdateSchema } from '../schemas/index.js';
import { checkPatientLimit } from '../middleware/planLimits.js';
import { validateAndGetScope, resolveEffectiveClinicId } from '../utils/clinicScope.js';
import { patientListSelect, userNameRoleSelect, userNameSelect } from '../utils/prismaSelects.js';
import { writeAuditLog, extractRequestMeta } from '../utils/auditLog.js';

const router = express.Router();

// GET /api/patients/check-phone-duplicate
// Returns patients in the same clinic sharing the given phone. Non-blocking — callers decide what to do.
router.get('/patients/check-phone-duplicate', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const { phone, clinicId: selectedClinicId, excludePatientId } = req.query;
  if (!phone || typeof phone !== 'string' || !phone.trim()) {
    return res.json({ duplicates: [] });
  }

  try {
    const scope = await validateAndGetScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const where: any = {
      ...scope,
      phone: phone.trim(),
      deletedAt: null,
    };
    if (excludePatientId && typeof excludePatientId === 'string') {
      where.id = { not: excludePatientId };
    }

    const duplicates = await prisma.patient.findMany({
      where,
      select: { id: true, firstName: true, lastName: true, phone: true },
      take: 10,
    });

    res.json({ duplicates });
  } catch (err: any) {
    console.error('[patients] check-phone-duplicate error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to check phone duplicate' });
  }
});

// GET /api/patients
// BILLING dahil — yalnızca patientListSelect (kimlik + iletişim) alanları döner, klinik veri içermez.
router.get('/patients', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']), async (req: AuthRequest, res: Response) => {
  const { search, status, source, includeArchived, clinicId: selectedClinicId, createdWithinDays, limit, offset } = req.query;
  const { normalizedRole, id: userId } = req.user!;

  // limit gönderilmediğinde geriye dönük uyumluluk için tüm liste döner;
  // gönderildiğinde 1..500 aralığına sıkıştırılır (frontend picker'ları 5-200 kullanıyor)
  const parsedLimit = Number(limit);
  const take = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(Math.floor(parsedLimit), 500) : undefined;
  const parsedOffset = Number(offset);
  const skip = Number.isFinite(parsedOffset) && parsedOffset > 0 ? Math.floor(parsedOffset) : undefined;

  try {
    const scope = await validateAndGetScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const where: any = { ...scope, deletedAt: null };

    if (search) {
      where.OR = [
        { firstName: { contains: String(search), mode: 'insensitive' } },
        { lastName: { contains: String(search), mode: 'insensitive' } },
        { email: { contains: String(search), mode: 'insensitive' } },
        { phone: { contains: String(search), mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.patientStatus = String(status);
    } else if (includeArchived !== 'true') {
      where.patientStatus = { not: 'archived' };
    }

    if (source) where.source = String(source);

    if (createdWithinDays) {
      const days = Number(createdWithinDays);
      if (Number.isFinite(days) && days > 0) {
        const cutoff = new Date();
        cutoff.setHours(0, 0, 0, 0);
        cutoff.setDate(cutoff.getDate() - days);
        where.createdAt = { gte: cutoff };
      }
    }

    if (normalizedRole === 'DENTIST') {
      where.AND = [
        ...(where.AND ?? []),
        {
          OR: [
            { appointments: { some: { practitionerId: userId, deletedAt: null } } },
            { treatmentCases: { some: { practitionerId: userId, deletedAt: null } } },
          ],
        },
      ];
    }

    const patients = await prisma.patient.findMany({
      where,
      select: patientListSelect,
      orderBy: { createdAt: 'desc' },
      ...(take !== undefined ? { take } : {}),
      ...(skip !== undefined ? { skip } : {}),
    });
    res.json(patients);
  } catch (err: any) {
    console.error('[patients] list error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

// GET /api/patients/:id
// BILLING dahil — bu role için klinik veri (tedavi, randevu, dental, ek dosya, mesaj) DÖNDÜRÜLMEZ;
// yalnızca kimlik/iletişim alanları + ödemeler (finansal işlemler için gerekli minimum veri).
router.get('/patients/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const orgId = req.user!.organizationId;
  const { normalizedRole, id: userId } = req.user!;

  try {
    const patientWhere: any = { id, organizationId: orgId, deletedAt: null };
    if (normalizedRole === 'DENTIST') {
      patientWhere.OR = [
        { appointments: { some: { practitionerId: userId, deletedAt: null } } },
        { treatmentCases: { some: { practitionerId: userId, deletedAt: null } } },
      ];
    }

    if (normalizedRole === 'BILLING') {
      const billingPatient = await prisma.patient.findFirst({
        where: patientWhere,
        select: {
          ...patientListSelect,
          payments: {
            where: { paymentStatus: { not: 'cancelled' } },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
      if (!billingPatient) return res.status(404).json({ error: 'Patient not found' });
      if (!req.user!.canAccessAllClinics && !req.user!.allowedClinicIds.includes(billingPatient.clinicId)) {
        return res.status(403).json({ error: 'Access denied to this patient' });
      }
      // KVKK erişim hesap verebilirliği: hassas kayıt görüntülemeleri de loglanır
      writeAuditLog({
        organizationId: orgId,
        clinicId: billingPatient.clinicId,
        actorUserId: userId,
        actorRole: req.user!.role,
        action: 'patient_record_viewed',
        entityType: 'patient',
        entityId: billingPatient.id,
        ...extractRequestMeta(req),
      });
      return res.json(billingPatient);
    }

    const patient = await prisma.patient.findFirst({
      where: patientWhere,
      include: {
        appointments: {
          include: { practitioner: { select: userNameSelect }, appointmentType: true },
          orderBy: { startTime: 'desc' },
        },
        activityLogs: {
          include: { user: { select: userNameSelect } },
          orderBy: { createdAt: 'desc' },
        },
        insuranceProvisions: {
          include: { treatmentCase: true, assignedTo: { select: userNameRoleSelect } },
          orderBy: { updatedAt: 'desc' },
        },
        treatmentCases: {
          where: { deletedAt: null },
          orderBy: { updatedAt: 'desc' },
        },
        tasks: { orderBy: { dueDate: 'asc' } },
        payments: {
          where: { paymentStatus: { not: 'cancelled' } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    // Klinige erişim kontrolü (multi-branch)
    if (!req.user!.canAccessAllClinics && !req.user!.allowedClinicIds.includes(patient.clinicId)) {
      return res.status(403).json({ error: 'Access denied to this patient' });
    }

    const clinicId = patient.clinicId; // İlgili sorguların klinik kapsamı için

    // Fetch WhatsApp messages separately — resilient to missing migrations
    let whatsappConversationMessages: any[] = [];
    try {
      whatsappConversationMessages = await prisma.whatsAppConversationMessage.findMany({
        where: { patientId: id, clinicId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    } catch (waErr: any) {
      console.warn('[patients/:id] whatsappConversationMessages query failed (migration pending?):', waErr?.message);
    }

    let instagramConversationMessages: any[] = [];
    try {
      instagramConversationMessages = await prisma.instagramConversationMessage.findMany({
        where: { patientId: id },
        select: {
          id: true,
          externalSenderId: true,
          senderUsername: true,
          direction: true,
          text: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    } catch (igErr: any) {
      console.warn('[patients/:id] instagramConversationMessages query failed (migration pending?):', igErr?.message);
    }

    // Fetch tooth records separately — resilient to missing migrations
    let toothRecords: any[] = [];
    try {
      toothRecords = await (prisma as any).toothRecord.findMany({
        where: { patientId: id, clinicId },
        select: { id: true, status: true, toothFdi: true },
      });
    } catch (trErr: any) {
      console.warn('[patients/:id] toothRecords query failed (migration pending?):', trErr?.message);
    }

    // Fetch treatment cases with procedures + practitioner separately — resilient
    let treatmentCasesEnriched: any[] = (patient as any).treatmentCases || [];
    try {
      const enriched = await prisma.treatmentCase.findMany({
        where: { patientId: id, clinicId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        include: {
          practitioner: { select: { firstName: true, lastName: true } },
          procedures: { select: { id: true, status: true } },
        },
      });
      treatmentCasesEnriched = enriched;
    } catch (tcErr: any) {
      console.warn('[patients/:id] enriched treatmentCases query failed (migration pending?):', tcErr?.message);
    }

    // KVKK erişim hesap verebilirliği: hassas kayıt görüntülemeleri de loglanır
    writeAuditLog({
      organizationId: orgId,
      clinicId,
      actorUserId: userId,
      actorRole: req.user!.role,
      action: 'patient_record_viewed',
      entityType: 'patient',
      entityId: patient.id,
      ...extractRequestMeta(req),
    });

    res.json({ ...patient, treatmentCases: treatmentCasesEnriched, toothRecords, whatsappConversationMessages, instagramConversationMessages });
  } catch (err: any) {
    console.error('[patients/:id] error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to fetch patient' });
  }
});

// POST /api/patients
router.post('/patients', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), checkPatientLimit as express.RequestHandler, async (req: AuthRequest, res: Response) => {
  // ?clinicId query param varsa doğrula, yoksa defaultClinicId kullan
  const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });
  const validation = patientSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const patient = await prisma.patient.create({ data: { ...validation.data, clinicId, organizationId: req.user!.organizationId } });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'patient', entityId: patient.id,
      action: 'created',
      description: `${patient.firstName} ${patient.lastName} adlı hasta oluşturuldu`,
    });

    res.json(patient);
  } catch (err: any) {
    console.error('[patients] create error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to create patient' });
  }
});

// PUT /api/patients/:id
router.put('/patients/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const orgId = req.user!.organizationId;
  const { normalizedRole, id: userId } = req.user!;

  const validation = patientUpdateSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const existingPatient = await prisma.patient.findFirst({ where: { id, organizationId: orgId, deletedAt: null } });
    if (!existingPatient) return res.status(404).json({ error: 'Patient not found' });

    // Klinige erişim kontrolü
    if (!req.user!.canAccessAllClinics && !req.user!.allowedClinicIds.includes(existingPatient.clinicId)) {
      return res.status(403).json({ error: 'Access denied to this patient' });
    }

    const clinicId = existingPatient.clinicId;

    if (normalizedRole === 'DENTIST') {
      const hasAppointment = await prisma.appointment.findFirst({
        where: { patientId: id, practitionerId: userId, clinicId },
      });
      if (!hasAppointment) return res.status(403).json({ error: 'Forbidden: You can only update your own patients' });
    }

    const patient = await prisma.patient.update({ where: { id }, data: validation.data });

    await logActivity({
      clinicId, userId, entityType: 'patient', entityId: patient.id,
      action: 'updated',
      description: `${patient.firstName} ${patient.lastName} adlı hasta bilgileri güncellendi`,
    });

    res.json(patient);
  } catch (err: any) {
    console.error('[patients] update error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to update patient' });
  }
});

// DELETE /api/patients/:id (soft delete)
// Yalnızca OWNER, ORG_ADMIN, CLINIC_MANAGER silebilir — RECEPTIONIST ve DENTIST silemez.
router.delete('/patients/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const orgId = req.user!.organizationId;

  try {
    const patient = await prisma.patient.findFirst({ where: { id, organizationId: orgId, deletedAt: null } });
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    // Klinige erişim kontrolü
    if (!req.user!.canAccessAllClinics && !req.user!.allowedClinicIds.includes(patient.clinicId)) {
      return res.status(403).json({ error: 'Access denied to this patient' });
    }

    const clinicId = patient.clinicId;

    await prisma.patient.update({
      where: { id },
      data: { patientStatus: 'archived' },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'patient', entityId: id,
      action: 'archived',
      description: `${patient.firstName} ${patient.lastName} adlı hasta arşivlendi`,
    });

    res.json({ message: 'Patient archived successfully' });
  } catch (err: any) {
    console.error('[patients] archive error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to archive patient' });
  }
});

// POST /api/patients/:id/unarchive
// Yalnızca OWNER, ORG_ADMIN, CLINIC_MANAGER arşivden çıkarabilir.
router.post('/patients/:id/unarchive', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const orgId = req.user!.organizationId;

  try {
    const patient = await prisma.patient.findFirst({ where: { id, organizationId: orgId, deletedAt: null } });
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    if (!req.user!.canAccessAllClinics && !req.user!.allowedClinicIds.includes(patient.clinicId)) {
      return res.status(403).json({ error: 'Access denied to this patient' });
    }

    const clinicId = patient.clinicId;

    await prisma.patient.update({
      where: { id },
      data: { patientStatus: 'active' },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'patient', entityId: id,
      action: 'unarchived',
      description: `${patient.firstName} ${patient.lastName} adlı hasta arşivden çıkarıldı`,
    });

    res.json({ message: 'Patient unarchived successfully' });
  } catch (err: any) {
    console.error('[patients] unarchive error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to unarchive patient' });
  }
});

export default router;
