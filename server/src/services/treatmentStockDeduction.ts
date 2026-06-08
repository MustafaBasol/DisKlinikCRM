import type { Prisma } from '@prisma/client';
import prisma from '../db.js';
import { checkAndNotifyLowStock } from './inventoryAlerts.js';

type TxClient = Prisma.TransactionClient;

type ProcedureForStock = {
  id: string;
  clinicId: string;
  treatmentCaseId: string;
  serviceId: string | null;
  procedureName: string;
  packageApplicationId: string | null;
  treatmentPackageId: string | null;
  stockDeductedAt: Date | null;
};

type DeductionRequirement = {
  inventoryItemId: string;
  quantity: number;
  sourceLabel: string;
  note?: string | null;
};

type DeductionContext = {
  clinicId: string;
  userId: string;
  treatmentCaseId: string;
  treatmentPlanProcedureId?: string | null;
  serviceId?: string | null;
  treatmentPackageId?: string | null;
  packageApplicationId?: string | null;
  reason: string;
  notesPrefix: string;
};

type Shortage = {
  inventoryItemId: string;
  name: string;
  required: number;
  available: number;
  unit: string;
};

type StockItem = {
  id: string;
  name: string;
  currentStock: number;
  minimumStock: number;
  unit: string;
  unitCost: number | null;
};

export class TreatmentStockDeductionError extends Error {
  code = 'INSUFFICIENT_STOCK_FOR_TREATMENT';
  statusCode = 409;
  shortages: Shortage[];
  packageApplicationId?: string | null;

  constructor(message: string, shortages: Shortage[], packageApplicationId?: string | null) {
    super(message);
    this.name = 'TreatmentStockDeductionError';
    this.shortages = shortages;
    this.packageApplicationId = packageApplicationId;
  }
}

export function isTreatmentStockDeductionError(error: unknown): error is TreatmentStockDeductionError {
  return error instanceof TreatmentStockDeductionError;
}

function aggregateRequirements(requirements: DeductionRequirement[]): DeductionRequirement[] {
  const byItem = new Map<string, DeductionRequirement>();

  for (const requirement of requirements) {
    if (!Number.isFinite(requirement.quantity) || requirement.quantity <= 0) continue;

    const current = byItem.get(requirement.inventoryItemId);
    if (!current) {
      byItem.set(requirement.inventoryItemId, { ...requirement });
      continue;
    }

    current.quantity += requirement.quantity;
    current.sourceLabel = `${current.sourceLabel}, ${requirement.sourceLabel}`;
  }

  return Array.from(byItem.values());
}

async function deductInventoryRequirements(
  tx: TxClient,
  requirements: DeductionRequirement[],
  context: DeductionContext,
): Promise<'deducted' | 'not_required'> {
  const aggregated = aggregateRequirements(requirements);
  if (aggregated.length === 0) return 'not_required';

  const itemIds = aggregated.map(requirement => requirement.inventoryItemId);
  const items = await tx.inventoryItem.findMany({
    where: { id: { in: itemIds }, clinicId: context.clinicId, isActive: true },
    select: { id: true, name: true, currentStock: true, minimumStock: true, unit: true, unitCost: true },
  }) as StockItem[];
  const itemById = new Map<string, StockItem>(items.map(item => [item.id, item]));

  const shortages: Shortage[] = [];
  for (const requirement of aggregated) {
    const item = itemById.get(requirement.inventoryItemId);
    if (!item || item.currentStock < requirement.quantity) {
      shortages.push({
        inventoryItemId: requirement.inventoryItemId,
        name: item?.name ?? 'Stok kalemi',
        required: requirement.quantity,
        available: item?.currentStock ?? 0,
        unit: item?.unit ?? '',
      });
    }
  }

  if (shortages.length > 0) {
    const message = shortages
      .map(item => `${item.name}: gerekli ${item.required} ${item.unit}, mevcut ${item.available} ${item.unit}`)
      .join('; ');
    throw new TreatmentStockDeductionError(`Yetersiz stok. ${message}`, shortages, context.packageApplicationId);
  }

  for (const requirement of aggregated) {
    const item = itemById.get(requirement.inventoryItemId);
    if (!item) {
      throw new TreatmentStockDeductionError(
        'Yetersiz stok. Stok kalemi bulunamadi.',
        [{
          inventoryItemId: requirement.inventoryItemId,
          name: 'Stok kalemi',
          required: requirement.quantity,
          available: 0,
          unit: '',
        }],
        context.packageApplicationId,
      );
    }

    const updated = await tx.inventoryItem.updateMany({
      where: {
        id: requirement.inventoryItemId,
        clinicId: context.clinicId,
        currentStock: { gte: requirement.quantity },
      },
      data: { currentStock: { decrement: requirement.quantity } },
    });

    if (updated.count !== 1) {
      throw new TreatmentStockDeductionError(
        `Yetersiz stok. ${item.name} stogu islem sirasinda degisti.`,
        [{
          inventoryItemId: requirement.inventoryItemId,
          name: item.name,
          required: requirement.quantity,
          available: item.currentStock,
          unit: item.unit,
        }],
        context.packageApplicationId,
      );
    }

    await tx.inventoryTransaction.create({
      data: {
        clinicId: context.clinicId,
        itemId: requirement.inventoryItemId,
        type: 'out',
        quantity: requirement.quantity,
        unitCost: item.unitCost ?? null,
        reason: context.reason,
        treatmentCaseId: context.treatmentCaseId,
        treatmentPlanProcedureId: context.treatmentPlanProcedureId ?? null,
        serviceId: context.serviceId ?? null,
        treatmentPackageId: context.treatmentPackageId ?? null,
        packageApplicationId: context.packageApplicationId ?? null,
        performedById: context.userId,
        notes: `${context.notesPrefix}: ${requirement.sourceLabel}`,
      },
    });

    await checkAndNotifyLowStock(context.clinicId, requirement.inventoryItemId, tx);
  }

  return 'deducted';
}

export async function deductServiceMaterialsForCompletedProcedure(
  tx: TxClient,
  procedure: ProcedureForStock,
  userId: string,
): Promise<'deducted' | 'not_required'> {
  if (!procedure.serviceId) return 'not_required';

  const materials = await tx.appointmentTypeMaterial.findMany({
    where: {
      clinicId: procedure.clinicId,
      serviceId: procedure.serviceId,
      deductionTiming: 'ON_TREATMENT_COMPLETED',
      isOptional: false,
    },
    include: {
      inventoryItem: { select: { id: true, name: true, unit: true } },
    },
  });

  return deductInventoryRequirements(
    tx,
    materials.map((material: any) => ({
      inventoryItemId: material.inventoryItemId,
      quantity: Number(material.quantity),
      sourceLabel: `${procedure.procedureName} / ${material.inventoryItem.name}`,
      note: material.note,
    })),
    {
      clinicId: procedure.clinicId,
      userId,
      treatmentCaseId: procedure.treatmentCaseId,
      treatmentPlanProcedureId: procedure.id,
      serviceId: procedure.serviceId,
      treatmentPackageId: procedure.treatmentPackageId,
      packageApplicationId: procedure.packageApplicationId,
      reason: 'treatment_completed',
      notesPrefix: 'Tedavi tamamlandiginda otomatik stok dusumu',
    },
  );
}

export async function deductPackageExtraMaterialsIfReady(
  tx: TxClient,
  procedure: ProcedureForStock,
  userId: string,
  now: Date,
): Promise<'deducted' | 'not_required' | 'pending'> {
  if (!procedure.packageApplicationId) return 'pending';

  const application = await tx.treatmentPackageApplication.findFirst({
    where: { id: procedure.packageApplicationId, clinicId: procedure.clinicId },
    include: { treatmentPackage: { select: { id: true, name: true } } },
  });
  if (!application || application.extraMaterialsDeductedAt) return 'pending';

  const remainingProcedures = await tx.treatmentPlanProcedure.count({
    where: {
      clinicId: procedure.clinicId,
      packageApplicationId: procedure.packageApplicationId,
      status: { not: 'completed' },
    },
  });
  if (remainingProcedures > 0) return 'pending';

  const materials = await tx.treatmentPackageMaterial.findMany({
    where: {
      clinicId: procedure.clinicId,
      packageId: application.packageId,
      deductionTiming: 'ON_TREATMENT_COMPLETED',
      isOptional: false,
    },
    include: {
      inventoryItem: { select: { id: true, name: true, unit: true } },
    },
  });

  const status = await deductInventoryRequirements(
    tx,
    materials.map((material: any) => ({
      inventoryItemId: material.inventoryItemId,
      quantity: Number(material.quantity),
      sourceLabel: `${application.treatmentPackage.name} / ${material.inventoryItem.name}`,
      note: material.note,
    })),
    {
      clinicId: procedure.clinicId,
      userId,
      treatmentCaseId: procedure.treatmentCaseId,
      treatmentPlanProcedureId: procedure.id,
      treatmentPackageId: application.packageId,
      packageApplicationId: procedure.packageApplicationId,
      reason: 'package_completed',
      notesPrefix: 'Paket tamamlandiginda otomatik stok dusumu',
    },
  );

  await tx.treatmentPackageApplication.update({
    where: { id: application.id },
    data: {
      extraMaterialsDeductedAt: now,
      extraMaterialsDeductionStatus: status,
      extraMaterialsDeductionError: null,
    },
  });

  return status;
}

export async function markProcedureStockDeductionFailed(
  procedureId: string,
  clinicId: string,
  message: string,
) {
  await prisma.treatmentPlanProcedure.updateMany({
    where: { id: procedureId, clinicId },
    data: {
      stockDeductionStatus: 'failed',
      stockDeductionError: message.substring(0, 500),
    },
  });
}

export async function markPackageExtraStockDeductionFailed(
  packageApplicationId: string | null | undefined,
  clinicId: string,
  message: string,
) {
  if (!packageApplicationId) return;

  await prisma.treatmentPackageApplication.updateMany({
    where: { id: packageApplicationId, clinicId },
    data: {
      extraMaterialsDeductionStatus: 'failed',
      extraMaterialsDeductionError: message.substring(0, 500),
    },
  });
}
