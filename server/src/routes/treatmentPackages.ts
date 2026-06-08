import express, { Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { getAccessibleClinicIds, resolveEffectiveClinicId, validateAndGetClinicIdScope } from '../utils/clinicScope.js';
import { treatmentPackageSchema, treatmentPackageUpdateSchema } from '../schemas/index.js';
import { getClinicOperatingPreferences } from '../services/clinicOperatingPreferences.js';

const router = express.Router();

const packageItemInclude = {
  service: { select: { id: true, name: true, durationMinutes: true, basePrice: true, currency: true, category: true, color: true } },
};

const packageMaterialInclude = {
  inventoryItem: { select: { id: true, name: true, unit: true, currentStock: true, minimumStock: true, category: true } },
};

const treatmentPackageInclude = Prisma.validator<Prisma.TreatmentPackageInclude>()({
  items: { include: packageItemInclude, orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
  materials: { include: packageMaterialInclude, orderBy: { createdAt: 'asc' as const } },
});

const packageApplicationInclude = Prisma.validator<Prisma.TreatmentPackageApplicationInclude>()({
  treatmentPackage: { include: treatmentPackageInclude },
  procedures: {
    include: {
      service: { select: { id: true, name: true, basePrice: true, currency: true, durationMinutes: true } },
      packageItem: { select: { id: true, quantity: true, sortOrder: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
});

function hasDuplicates(values: string[]) {
  return new Set(values).size !== values.length;
}

async function validatePackageReferences(
  clinicId: string,
  items?: { serviceId: string }[],
  materials?: { inventoryItemId: string }[],
) {
  if (items) {
    const serviceIds = items.map(item => item.serviceId);
    if (hasDuplicates(serviceIds)) return 'Ayni hizmet paket icinde bir kez tanimlanabilir. Tekrar icin adet kullanin.';

    const validServices = await prisma.appointmentType.count({
      where: { id: { in: serviceIds }, clinicId },
    });
    if (validServices !== serviceIds.length) return 'Gecersiz hizmet secildi.';
  }

  if (materials) {
    const inventoryItemIds = materials.map(material => material.inventoryItemId);
    if (hasDuplicates(inventoryItemIds)) return 'Ayni stok kalemi paket malzemelerinde bir kez tanimlanabilir.';

    if (inventoryItemIds.length > 0) {
      const validItems = await prisma.inventoryItem.count({
        where: { id: { in: inventoryItemIds }, clinicId, isActive: true },
      });
      if (validItems !== inventoryItemIds.length) return 'Gecersiz veya pasif stok kalemi secildi.';
    }
  }

  return null;
}

function buildPackageData(input: any) {
  return {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.description !== undefined && { description: input.description ?? null }),
    ...(input.category !== undefined && { category: input.category ?? null }),
    ...(input.color !== undefined && { color: input.color ?? null }),
    ...(input.durationMinutes !== undefined && { durationMinutes: input.durationMinutes ?? null }),
    ...(input.price !== undefined && { price: input.price ?? null }),
    ...(input.currency !== undefined && { currency: input.currency ?? null }),
    ...(input.pricingMode !== undefined && { pricingMode: input.pricingMode }),
    ...(input.isActive !== undefined && { isActive: input.isActive }),
  };
}

function buildPackageItems(clinicId: string, packageId: string, items: any[]) {
  return items.map((item, index) => ({
    clinicId,
    packageId,
    serviceId: item.serviceId,
    quantity: item.quantity,
    sortOrder: item.sortOrder ?? index,
    overridePrice: item.overridePrice ?? null,
    overrideDurationMin: item.overrideDurationMin ?? null,
  }));
}

function buildPackageMaterials(clinicId: string, packageId: string, materials: any[]) {
  return materials.map(material => ({
    clinicId,
    packageId,
    inventoryItemId: material.inventoryItemId,
    quantity: material.quantity,
    unit: material.unit ?? null,
    deductionTiming: material.deductionTiming,
    isOptional: material.isOptional,
    note: material.note ?? null,
  }));
}

router.get('/treatment-packages', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']), async (req: AuthRequest, res: Response) => {
  const { includeInactive, search, clinicId: selectedClinicId } = req.query;

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const where: any = { ...scope };
    if (includeInactive !== 'true') where.isActive = true;
    if (search) {
      where.OR = [
        { name: { contains: String(search), mode: 'insensitive' } },
        { category: { contains: String(search), mode: 'insensitive' } },
      ];
    }

    const packages = await prisma.treatmentPackage.findMany({
      where,
      include: treatmentPackageInclude,
      orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { name: 'asc' }],
    });

    return res.json(packages);
  } catch {
    return res.status(500).json({ error: 'Failed to fetch treatment packages' });
  }
});

router.get('/treatment-packages/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const treatmentPackage = await prisma.treatmentPackage.findFirst({
      where: { id, clinicId: { in: accessibleIds } },
      include: treatmentPackageInclude,
    });
    if (!treatmentPackage) return res.status(404).json({ error: 'Treatment package not found' });

    return res.json(treatmentPackage);
  } catch {
    return res.status(500).json({ error: 'Failed to fetch treatment package' });
  }
});

router.post('/treatment-packages', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const clinicId = await resolveEffectiveClinicId(req.user!, req.body.clinicId ?? req.query.clinicId as string | undefined);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

  try {
    const operatingPreferences = await getClinicOperatingPreferences(clinicId);
    const validation = treatmentPackageSchema.safeParse({
      ...req.body,
      currency: req.body.currency || operatingPreferences.currency,
    });
    if (!validation.success) return res.status(400).json({ error: validation.error.format() });

    const referenceError = await validatePackageReferences(clinicId, validation.data.items, validation.data.materials);
    if (referenceError) return res.status(400).json({ error: referenceError });

    const treatmentPackage = await prisma.$transaction(async (tx) => {
      const created = await tx.treatmentPackage.create({
        data: {
          clinicId,
          name: validation.data.name,
          description: validation.data.description ?? null,
          category: validation.data.category ?? null,
          color: validation.data.color ?? null,
          durationMinutes: validation.data.durationMinutes ?? null,
          price: validation.data.price ?? null,
          currency: validation.data.currency ?? operatingPreferences.currency,
          pricingMode: validation.data.pricingMode,
          isActive: validation.data.isActive,
        },
      });

      await tx.treatmentPackageItem.createMany({
        data: buildPackageItems(clinicId, created.id, validation.data.items),
      });

      if (validation.data.materials.length > 0) {
        await tx.treatmentPackageMaterial.createMany({
          data: buildPackageMaterials(clinicId, created.id, validation.data.materials),
        });
      }

      return tx.treatmentPackage.findUnique({
        where: { id: created.id },
        include: treatmentPackageInclude,
      });
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'setting', entityId: treatmentPackage!.id,
      action: 'created', description: `"${treatmentPackage!.name}" tedavi paketi olusturuldu`,
    });

    return res.status(201).json(treatmentPackage);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'Bu isimde bir tedavi paketi zaten var.' });
    }
    return res.status(500).json({ error: 'Failed to create treatment package' });
  }
});

router.put('/treatment-packages/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const validation = treatmentPackageUpdateSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const existing = await prisma.treatmentPackage.findFirst({ where: { id, clinicId: { in: accessibleIds } } });
    if (!existing) return res.status(404).json({ error: 'Treatment package not found' });

    const referenceError = await validatePackageReferences(existing.clinicId, validation.data.items, validation.data.materials);
    if (referenceError) return res.status(400).json({ error: referenceError });

    const treatmentPackage = await prisma.$transaction(async (tx) => {
      await tx.treatmentPackage.update({
        where: { id },
        data: buildPackageData(validation.data),
      });

      if (validation.data.items) {
        await tx.treatmentPackageItem.deleteMany({ where: { packageId: id, clinicId: existing.clinicId } });
        await tx.treatmentPackageItem.createMany({
          data: buildPackageItems(existing.clinicId, id, validation.data.items),
        });
      }

      if (validation.data.materials) {
        await tx.treatmentPackageMaterial.deleteMany({ where: { packageId: id, clinicId: existing.clinicId } });
        if (validation.data.materials.length > 0) {
          await tx.treatmentPackageMaterial.createMany({
            data: buildPackageMaterials(existing.clinicId, id, validation.data.materials),
          });
        }
      }

      return tx.treatmentPackage.findUnique({
        where: { id },
        include: treatmentPackageInclude,
      });
    });

    await logActivity({
      clinicId: existing.clinicId, userId: req.user!.id, entityType: 'setting', entityId: id,
      action: 'updated', description: `"${treatmentPackage!.name}" tedavi paketi guncellendi`,
    });

    return res.json(treatmentPackage);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'Bu isimde bir tedavi paketi zaten var.' });
    }
    return res.status(500).json({ error: 'Failed to update treatment package' });
  }
});

router.delete('/treatment-packages/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const existing = await prisma.treatmentPackage.findFirst({ where: { id, clinicId: { in: accessibleIds } } });
    if (!existing) return res.status(404).json({ error: 'Treatment package not found' });

    const updated = await prisma.treatmentPackage.update({
      where: { id },
      data: { isActive: false },
      include: treatmentPackageInclude,
    });

    await logActivity({
      clinicId: existing.clinicId, userId: req.user!.id, entityType: 'setting', entityId: id,
      action: 'updated', description: `"${updated.name}" tedavi paketi pasife alindi`,
    });

    return res.json(updated);
  } catch {
    return res.status(500).json({ error: 'Failed to deactivate treatment package' });
  }
});

router.post('/treatment-cases/:caseId/package-applications', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST']), async (req: AuthRequest, res: Response) => {
  const caseId = getParam(req, 'caseId');
  const { packageId, allowDuplicate } = req.body;
  if (!packageId || typeof packageId !== 'string') {
    return res.status(400).json({ error: 'packageId is required' });
  }

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const treatmentCase = await prisma.treatmentCase.findFirst({
      where: { id: caseId, clinicId: { in: accessibleIds }, deletedAt: null },
      select: { id: true, clinicId: true, patientId: true, practitionerId: true },
    });
    if (!treatmentCase) return res.status(404).json({ error: 'Treatment case not found' });
    if (req.user!.normalizedRole === 'DENTIST' && treatmentCase.practitionerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const treatmentPackage = await prisma.treatmentPackage.findFirst({
      where: { id: packageId, clinicId: treatmentCase.clinicId, isActive: true },
      include: treatmentPackageInclude,
    });
    if (!treatmentPackage) return res.status(404).json({ error: 'Treatment package not found' });
    if (treatmentPackage.items.length === 0) return res.status(400).json({ error: 'Treatment package has no services' });

    if (!allowDuplicate) {
      const existingApplication = await prisma.treatmentPackageApplication.findFirst({
        where: { clinicId: treatmentCase.clinicId, treatmentCaseId: caseId, packageId: treatmentPackage.id },
      });
      if (existingApplication) {
        return res.status(409).json({
          error: 'Bu tedavi paketi bu vakaya daha once eklenmis.',
          code: 'PACKAGE_ALREADY_APPLIED',
          packageApplicationId: existingApplication.id,
        });
      }
    }

    const totalDurationMinutes = treatmentPackage.durationMinutes ?? treatmentPackage.items.reduce((sum, item) => {
      const duration = item.overrideDurationMin ?? item.service.durationMinutes ?? 0;
      return sum + (duration * item.quantity);
    }, 0);
    const serviceSumPrice = treatmentPackage.items.reduce((sum, item) => {
      const price = item.overridePrice ?? item.service.basePrice ?? 0;
      return sum + (price * item.quantity);
    }, 0);
    const totalPrice = treatmentPackage.pricingMode === 'SERVICE_SUM'
      ? serviceSumPrice
      : (treatmentPackage.price ?? serviceSumPrice);

    const application = await prisma.$transaction(async (tx) => {
      const createdApplication = await tx.treatmentPackageApplication.create({
        data: {
          clinicId: treatmentCase.clinicId,
          treatmentCaseId: treatmentCase.id,
          patientId: treatmentCase.patientId,
          packageId: treatmentPackage.id,
          pricingMode: treatmentPackage.pricingMode,
          totalDurationMinutes,
          totalPrice,
          currency: treatmentPackage.currency,
          createdById: req.user!.id,
        },
      });

      const procedureRows = treatmentPackage.items.flatMap((item) => {
        return Array.from({ length: item.quantity }, (_unused, occurrence) => ({
          clinicId: treatmentCase.clinicId,
          treatmentCaseId: treatmentCase.id,
          patientId: treatmentCase.patientId,
          procedureName: item.service.name,
          serviceId: item.serviceId,
          packageApplicationId: createdApplication.id,
          treatmentPackageId: treatmentPackage.id,
          packageItemId: item.id,
          status: 'planned',
          estimatedCost: item.overridePrice ?? item.service.basePrice ?? null,
          notes: item.quantity > 1 ? `Paket seansi ${occurrence + 1}/${item.quantity}` : null,
          createdById: req.user!.id,
        }));
      });

      await tx.treatmentPlanProcedure.createMany({ data: procedureRows });

      return tx.treatmentPackageApplication.findUnique({
        where: { id: createdApplication.id },
        include: packageApplicationInclude,
      });
    });

    await logActivity({
      clinicId: treatmentCase.clinicId,
      userId: req.user!.id,
      action: 'create',
      entityType: 'TreatmentPackageApplication',
      entityId: application!.id,
      description: `Tedavi paketi eklendi: ${treatmentPackage.name}`,
    });

    return res.status(201).json(application);
  } catch {
    return res.status(500).json({ error: 'Failed to apply treatment package' });
  }
});

export default router;
