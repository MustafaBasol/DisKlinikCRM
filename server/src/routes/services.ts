import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { appointmentTypeSchema } from '../schemas/index.js';
import { getClinicOperatingPreferences } from '../services/clinicOperatingPreferences.js';

const router = express.Router();

const getServicesHandler = async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { onlyActive, includeInactive } = req.query;

  try {
    const where: any = { clinicId };
    if (includeInactive !== 'true' && onlyActive !== 'false') where.isActive = true;

    const types = await prisma.appointmentType.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    res.json(types);
  } catch {
    res.status(500).json({ error: 'Failed to fetch services' });
  }
};

const createServiceHandler = async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const validation = appointmentTypeSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const operatingPreferences = await getClinicOperatingPreferences(clinicId);
    const type = await prisma.appointmentType.create({
      data: {
        ...validation.data,
        clinicId,
        currency: validation.data.currency || operatingPreferences.currency,
        isService: validation.data.isService ?? true,
      },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'setting', entityId: type.id,
      action: 'created', description: `"${type.name}" hizmeti oluşturuldu`,
    });

    res.json(type);
  } catch {
    res.status(500).json({ error: 'Failed to create service' });
  }
};

const updateServiceHandler = async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const validation = appointmentTypeSchema.partial().safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const existing = await prisma.appointmentType.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Service not found' });

    const type = await prisma.appointmentType.update({ where: { id }, data: validation.data });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'setting', entityId: type.id,
      action: 'updated', description: `"${type.name}" hizmeti güncellendi`,
    });

    res.json(type);
  } catch {
    res.status(500).json({ error: 'Failed to update service' });
  }
};

router.get('/appointment-types', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']), getServicesHandler);
router.get('/services', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']), getServicesHandler);
router.post('/appointment-types', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), createServiceHandler);
router.post('/services', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), createServiceHandler);
router.put('/appointment-types/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), updateServiceHandler);
router.put('/services/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), updateServiceHandler);

export default router;
