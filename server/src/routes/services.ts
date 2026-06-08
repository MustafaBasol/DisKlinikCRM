import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { appointmentTypeSchema, materialRecipeSchema } from '../schemas/index.js';
import { getClinicOperatingPreferences } from '../services/clinicOperatingPreferences.js';

const router = express.Router();
const materialRecipeListSchema = materialRecipeSchema.array().max(100);

const serviceMaterialInclude = {
  inventoryItem: { select: { id: true, name: true, unit: true, currentStock: true, minimumStock: true, category: true } },
} as const;

async function ensureServiceInClinic(serviceId: string, clinicId: string) {
  return prisma.appointmentType.findFirst({ where: { id: serviceId, clinicId } });
}

async function validateRecipeInventoryItems(clinicId: string, materials: { inventoryItemId: string }[]) {
  const inventoryItemIds = Array.from(new Set(materials.map(material => material.inventoryItemId)));
  if (inventoryItemIds.length !== materials.length) {
    return 'Ayni stok kalemi bir hizmet recetesinde bir kez tanimlanabilir.';
  }

  const validItems = await prisma.inventoryItem.count({
    where: { id: { in: inventoryItemIds }, clinicId, isActive: true },
  });
  if (validItems !== inventoryItemIds.length) {
    return 'Gecersiz veya pasif stok kalemi secildi.';
  }

  return null;
}

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

const listServiceMaterialsHandler = async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const service = await ensureServiceInClinic(id, clinicId);
    if (!service) return res.status(404).json({ error: 'Service not found' });

    const materials = await prisma.appointmentTypeMaterial.findMany({
      where: { serviceId: id, clinicId },
      include: serviceMaterialInclude,
      orderBy: { createdAt: 'asc' },
    });

    return res.json(materials);
  } catch {
    return res.status(500).json({ error: 'Failed to fetch service materials' });
  }
};

const replaceServiceMaterialsHandler = async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const payload = Array.isArray(req.body) ? req.body : req.body.materials;
  const validation = materialRecipeListSchema.safeParse(payload ?? []);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const service = await ensureServiceInClinic(id, clinicId);
    if (!service) return res.status(404).json({ error: 'Service not found' });

    const inventoryError = await validateRecipeInventoryItems(clinicId, validation.data);
    if (inventoryError) return res.status(400).json({ error: inventoryError });

    const materials = await prisma.$transaction(async (tx) => {
      await tx.appointmentTypeMaterial.deleteMany({ where: { serviceId: id, clinicId } });

      if (validation.data.length > 0) {
        await tx.appointmentTypeMaterial.createMany({
          data: validation.data.map(material => ({
            clinicId,
            serviceId: id,
            inventoryItemId: material.inventoryItemId,
            quantity: material.quantity,
            unit: material.unit ?? null,
            deductionTiming: material.deductionTiming,
            isOptional: material.isOptional,
            note: material.note ?? null,
          })),
        });
      }

      return tx.appointmentTypeMaterial.findMany({
        where: { serviceId: id, clinicId },
        include: serviceMaterialInclude,
        orderBy: { createdAt: 'asc' },
      });
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'setting', entityId: id,
      action: 'updated', description: `"${service.name}" hizmet recetesi guncellendi`,
    });

    return res.json(materials);
  } catch {
    return res.status(500).json({ error: 'Failed to update service materials' });
  }
};

const addServiceMaterialHandler = async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const validation = materialRecipeSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const service = await ensureServiceInClinic(id, clinicId);
    if (!service) return res.status(404).json({ error: 'Service not found' });

    const inventoryError = await validateRecipeInventoryItems(clinicId, [validation.data]);
    if (inventoryError) return res.status(400).json({ error: inventoryError });

    const material = await prisma.appointmentTypeMaterial.create({
      data: {
        clinicId,
        serviceId: id,
        inventoryItemId: validation.data.inventoryItemId,
        quantity: validation.data.quantity,
        unit: validation.data.unit ?? null,
        deductionTiming: validation.data.deductionTiming,
        isOptional: validation.data.isOptional,
        note: validation.data.note ?? null,
      },
      include: serviceMaterialInclude,
    });

    return res.status(201).json(material);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'Bu stok kalemi hizmet recetesinde zaten var.' });
    }
    return res.status(500).json({ error: 'Failed to create service material' });
  }
};

const updateServiceMaterialHandler = async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const materialId = getParam(req, 'materialId');
  const clinicId = req.user!.clinicId;
  const validation = materialRecipeSchema.partial().safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const material = await prisma.appointmentTypeMaterial.findFirst({
      where: { id: materialId, serviceId: id, clinicId },
    });
    if (!material) return res.status(404).json({ error: 'Service material not found' });

    if (validation.data.inventoryItemId) {
      const inventoryError = await validateRecipeInventoryItems(clinicId, [{ inventoryItemId: validation.data.inventoryItemId }]);
      if (inventoryError) return res.status(400).json({ error: inventoryError });
    }

    const updated = await prisma.appointmentTypeMaterial.update({
      where: { id: materialId },
      data: {
        ...(validation.data.inventoryItemId !== undefined && { inventoryItemId: validation.data.inventoryItemId }),
        ...(validation.data.quantity !== undefined && { quantity: validation.data.quantity }),
        ...(validation.data.unit !== undefined && { unit: validation.data.unit ?? null }),
        ...(validation.data.deductionTiming !== undefined && { deductionTiming: validation.data.deductionTiming }),
        ...(validation.data.isOptional !== undefined && { isOptional: validation.data.isOptional }),
        ...(validation.data.note !== undefined && { note: validation.data.note ?? null }),
      },
      include: serviceMaterialInclude,
    });

    return res.json(updated);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'Bu stok kalemi hizmet recetesinde zaten var.' });
    }
    return res.status(500).json({ error: 'Failed to update service material' });
  }
};

const deleteServiceMaterialHandler = async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const materialId = getParam(req, 'materialId');
  const clinicId = req.user!.clinicId;

  try {
    const material = await prisma.appointmentTypeMaterial.findFirst({
      where: { id: materialId, serviceId: id, clinicId },
    });
    if (!material) return res.status(404).json({ error: 'Service material not found' });

    await prisma.appointmentTypeMaterial.delete({ where: { id: materialId } });
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Failed to delete service material' });
  }
};

router.get('/appointment-types', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']), getServicesHandler);
router.get('/services', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']), getServicesHandler);
router.get('/appointment-types/:id/materials', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']), listServiceMaterialsHandler);
router.get('/services/:id/materials', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']), listServiceMaterialsHandler);
router.post('/appointment-types/:id/materials', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), addServiceMaterialHandler);
router.post('/services/:id/materials', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), addServiceMaterialHandler);
router.put('/appointment-types/:id/materials', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), replaceServiceMaterialsHandler);
router.put('/services/:id/materials', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), replaceServiceMaterialsHandler);
router.put('/appointment-types/:id/materials/:materialId', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), updateServiceMaterialHandler);
router.put('/services/:id/materials/:materialId', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), updateServiceMaterialHandler);
router.delete('/appointment-types/:id/materials/:materialId', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), deleteServiceMaterialHandler);
router.delete('/services/:id/materials/:materialId', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), deleteServiceMaterialHandler);
router.post('/appointment-types', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), createServiceHandler);
router.post('/services', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), createServiceHandler);
router.put('/appointment-types/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), updateServiceHandler);
router.put('/services/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), updateServiceHandler);

export default router;
