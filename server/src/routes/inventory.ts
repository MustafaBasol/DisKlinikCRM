import express, { Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { validateAndGetScope, getAccessibleClinicIds, resolveEffectiveClinicId } from '../utils/clinicScope.js';
import {
  computeQuantityInBaseUnit,
  isCoherentUnitConfiguration,
  isConsumptionUnitChangeBlocked,
  isConversionFactorChangeBlocked,
  isValidConversionFactor,
  isValidQuantity,
  InventoryUnitConversionError,
  resolveUnitRole,
} from '../services/inventoryUnitConversion.js';

const router = express.Router();

/**
 * Validates that a purchase/consumption unit reference belongs to the item's
 * own clinic and is active. Returns an error payload (never throws) so
 * routes can respond with a precise, localizable code.
 */
async function validateUnitReference(
  clinicId: string,
  unitId: string,
): Promise<{ error: string; code: string } | null> {
  const unit = await prisma.inventoryUnit.findFirst({ where: { id: unitId, clinicId } });
  if (!unit) {
    return { error: 'Inventory unit not found in this clinic', code: 'INVENTORY_UNIT_CROSS_CLINIC' };
  }
  if (!unit.isActive) {
    return { error: 'Inventory unit is inactive and cannot be assigned to new records', code: 'INVENTORY_UNIT_INACTIVE' };
  }
  return null;
}

// ── GET /api/inventory ───────────────────────────────────────────────────────
router.get('/inventory', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const { category, lowStock, search, isActive } = req.query;
  const selectedClinicId = req.query.clinicId as string | undefined;

  const clinicScope = await validateAndGetScope(req.user!, selectedClinicId, res);
  if (clinicScope === false) return;

  const where: any = { ...clinicScope };
  if (isActive !== undefined) {
    where.isActive = isActive === 'true';
  } else {
    where.isActive = true;
  }
  if (category) where.category = String(category);
  if (search) {
    where.OR = [
      { name: { contains: String(search), mode: 'insensitive' } },
      { supplier: { contains: String(search), mode: 'insensitive' } },
    ];
  }

  try {
    const items = await prisma.inventoryItem.findMany({
      where,
      include: { purchaseUnit: true, consumptionUnit: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    const result = items.map((item) => ({
      ...item,
      isLowStock: item.currentStock <= item.minimumStock,
    }));

    const filtered = lowStock === 'true' ? result.filter((i) => i.isLowStock) : result;

    res.json(filtered);
  } catch (err) {
    console.error('Inventory list error:', err);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

// ── GET /api/inventory/alerts ────────────────────────────────────────────────
router.get('/inventory/alerts', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const selectedClinicId = req.query.clinicId as string | undefined;

  const clinicScope = await validateAndGetScope(req.user!, selectedClinicId, res);
  if (clinicScope === false) return;

  try {
    const items = await prisma.inventoryItem.findMany({
      where: { ...clinicScope, isActive: true },
    });

    const lowStock = items.filter((i) => i.currentStock <= i.minimumStock && i.minimumStock > 0);

    res.json({
      total: items.length,
      lowStockCount: lowStock.length,
      items: lowStock.map((i) => ({ ...i, isLowStock: true })),
    });
  } catch (err) {
    console.error('Inventory alerts error:', err);
    res.status(500).json({ error: 'Failed to fetch inventory alerts' });
  }
});

// ── GET /api/inventory/:id ───────────────────────────────────────────────────
router.get('/inventory/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const item = await prisma.inventoryItem.findFirst({
      where: { id, clinicId: { in: accessibleIds } },
      include: {
        purchaseUnit: true,
        consumptionUnit: true,
        transactions: {
          include: {
            performedBy: { select: { id: true, firstName: true, lastName: true } },
            unit: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!item) return res.status(404).json({ error: 'Item not found' });

    res.json({ ...item, isLowStock: item.currentStock <= item.minimumStock });
  } catch (err) {
    console.error('Inventory get error:', err);
    res.status(500).json({ error: 'Failed to fetch inventory item' });
  }
});

// ── POST /api/inventory ──────────────────────────────────────────────────────
router.post('/inventory', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']), async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { name, category, unit, currentStock, minimumStock, unitCost, supplier, barcode, notes } = req.body;
  const purchaseUnitId = req.body.purchaseUnitId != null ? String(req.body.purchaseUnitId) : null;
  const consumptionUnitId = req.body.consumptionUnitId != null ? String(req.body.consumptionUnitId) : null;
  const conversionFactor = req.body.conversionFactor != null ? Number(req.body.conversionFactor) : null;

  if (!name || !category || !unit) {
    return res.status(400).json({ error: 'name, category, and unit are required' });
  }

  if (!isCoherentUnitConfiguration({ purchaseUnitId, consumptionUnitId, conversionFactor })) {
    return res.status(400).json({
      error: 'purchaseUnitId, consumptionUnitId, and conversionFactor must be provided together',
      code: 'INVENTORY_UNIT_CONFIG_INCOMPLETE',
    });
  }
  if (conversionFactor != null && !isValidConversionFactor(conversionFactor)) {
    return res.status(400).json({ error: 'conversionFactor must be a positive number', code: 'INVENTORY_CONVERSION_FACTOR_INVALID' });
  }

  const clinicId = await resolveEffectiveClinicId(req.user!, req.body.clinicId as string | undefined);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

  if (purchaseUnitId) {
    const err = await validateUnitReference(clinicId, purchaseUnitId);
    if (err) return res.status(400).json(err);
  }
  if (consumptionUnitId) {
    const err = await validateUnitReference(clinicId, consumptionUnitId);
    if (err) return res.status(400).json(err);
  }

  try {
    const item = await prisma.inventoryItem.create({
      data: {
        clinicId,
        organizationId: req.user!.organizationId,
        name: String(name),
        category: String(category),
        unit: String(unit),
        currentStock: Number(currentStock) || 0,
        minimumStock: Number(minimumStock) || 0,
        unitCost: unitCost != null ? Number(unitCost) : null,
        supplier: supplier ? String(supplier) : null,
        barcode: barcode ? String(barcode) : null,
        notes: notes ? String(notes) : null,
        purchaseUnitId,
        consumptionUnitId,
        conversionFactor,
      },
    });

    // If opening stock > 0, create initial "in" transaction.
    // Opening stock is always entered directly in the consumption/base unit
    // (it seeds currentStock, not a purchase-unit receipt), so it is its own
    // base-unit equivalent.
    if (item.currentStock > 0) {
      await prisma.inventoryTransaction.create({
        data: {
          clinicId,
          itemId: item.id,
          type: 'in',
          quantity: item.currentStock,
          unitCost: item.unitCost ?? null,
          reason: 'purchase',
          notes: 'Açılış stoğu',
          performedById: userId,
          unitId: item.consumptionUnitId,
          quantityInBaseUnit: item.currentStock,
        },
      });
    }

    await logActivity({ clinicId, userId, action: 'create', entityType: 'inventory', entityId: item.id, description: `Yeni stok kalemi eklendi: ${item.name}` });

    res.status(201).json(item);
  } catch (err) {
    console.error('Inventory create error:', err);
    res.status(500).json({ error: 'Failed to create inventory item' });
  }
});

// ── PUT /api/inventory/:id ───────────────────────────────────────────────────
class InventoryItemNotFoundError extends Error {}
class UnitConfigIncompleteError extends Error {}
class ConsumptionUnitLockedError extends Error {}
class ConversionFactorLockedError extends Error {}

router.put('/inventory/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const userId = req.user!.id;
  const { name, category, unit, minimumStock, unitCost, supplier, barcode, notes, isActive } = req.body;
  const purchaseUnitIdProvided = Object.prototype.hasOwnProperty.call(req.body, 'purchaseUnitId');
  const consumptionUnitIdProvided = Object.prototype.hasOwnProperty.call(req.body, 'consumptionUnitId');
  const conversionFactorProvided = Object.prototype.hasOwnProperty.call(req.body, 'conversionFactor');
  const purchaseUnitId = purchaseUnitIdProvided ? (req.body.purchaseUnitId != null ? String(req.body.purchaseUnitId) : null) : undefined;
  const consumptionUnitId = consumptionUnitIdProvided ? (req.body.consumptionUnitId != null ? String(req.body.consumptionUnitId) : null) : undefined;
  const conversionFactor = conversionFactorProvided ? (req.body.conversionFactor != null ? Number(req.body.conversionFactor) : null) : undefined;

  if (conversionFactor != null && !isValidConversionFactor(conversionFactor)) {
    return res.status(400).json({ error: 'conversionFactor must be a positive number', code: 'INVENTORY_CONVERSION_FACTOR_INVALID' });
  }

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const existingForAuth = await prisma.inventoryItem.findFirst({ where: { id, clinicId: { in: accessibleIds } } });
    if (!existingForAuth) return res.status(404).json({ error: 'Item not found' });

    const clinicId = existingForAuth.clinicId;

    // Cross-clinic/active checks are read-only lookups on InventoryUnit rows,
    // not on this item's own row — not race-sensitive, safe ahead of the lock.
    if (purchaseUnitIdProvided && purchaseUnitId) {
      const err = await validateUnitReference(clinicId, purchaseUnitId);
      if (err) return res.status(400).json(err);
    }
    if (consumptionUnitIdProvided && consumptionUnitId) {
      const err = await validateUnitReference(clinicId, consumptionUnitId);
      if (err) return res.status(400).json(err);
    }

    // Concurrency strategy: the consumption-unit lock decision (stock,
    // minimum stock, transaction-history counts) and the item write happen
    // inside one interactive transaction, guarded by a FOR UPDATE lock taken
    // on this row *before* any of those counts are read. Every
    // stock-mutating write on this item (POST /inventory/:id/transactions)
    // also takes the same lock before it touches InventoryTransaction, so a
    // transaction-create request racing this update always serializes
    // against it — it either fully lands first (and its InventoryTransaction
    // row is counted here) or blocks until this transaction commits/rolls
    // back (and then re-resolves its unit role against the now-committed
    // configuration). There is no window where "no history exists" is read
    // here while a transaction is concurrently being created underneath it.
    const updated = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM "InventoryItem" WHERE id = ${id} AND "clinicId" = ${clinicId} FOR UPDATE`
      );
      if (locked.length === 0) throw new InventoryItemNotFoundError();

      const existing = await tx.inventoryItem.findUniqueOrThrow({ where: { id } });

      const finalPurchaseUnitId = purchaseUnitIdProvided ? purchaseUnitId : existing.purchaseUnitId;
      const finalConsumptionUnitId = consumptionUnitIdProvided ? consumptionUnitId : existing.consumptionUnitId;
      const finalConversionFactor = conversionFactorProvided ? conversionFactor : existing.conversionFactor;
      if (!isCoherentUnitConfiguration({ purchaseUnitId: finalPurchaseUnitId, consumptionUnitId: finalConsumptionUnitId, conversionFactor: finalConversionFactor })) {
        throw new UnitConfigIncompleteError();
      }

      if (consumptionUnitIdProvided) {
        const hasTransactions = (await tx.inventoryTransaction.count({ where: { itemId: id } })) > 0;
        if (isConsumptionUnitChangeBlocked({
          currentConsumptionUnitId: existing.consumptionUnitId,
          nextConsumptionUnitId: consumptionUnitId,
          currentStock: existing.currentStock,
          minimumStock: existing.minimumStock,
          hasTransactions,
        })) {
          throw new ConsumptionUnitLockedError();
        }
      }

      if (conversionFactorProvided && existing.conversionFactor !== null && conversionFactor !== existing.conversionFactor) {
        const normalizedPurchaseTransactionCount = existing.purchaseUnitId
          ? await tx.inventoryTransaction.count({
              where: { itemId: id, unitId: existing.purchaseUnitId, quantityInBaseUnit: { not: null } },
            })
          : 0;
        if (isConversionFactorChangeBlocked({
          currentConversionFactor: existing.conversionFactor,
          nextConversionFactor: conversionFactor,
          hasNormalizedPurchaseTransactions: normalizedPurchaseTransactionCount > 0,
        })) {
          throw new ConversionFactorLockedError();
        }
      }

      // Replacing/clearing purchaseUnitId is not lock-guarded: past
      // transactions store their own unitId/quantityInBaseUnit independently
      // of the item's current purchaseUnitId, so they stay correctly
      // attributed to whichever unit was active when they were created,
      // regardless of what the item points to afterwards. The
      // conversionFactor history lock above still protects the multiplier.
      return tx.inventoryItem.update({
        where: { id },
        data: {
          ...(name != null && { name: String(name) }),
          ...(category != null && { category: String(category) }),
          ...(unit != null && { unit: String(unit) }),
          ...(minimumStock != null && { minimumStock: Number(minimumStock) }),
          ...(unitCost !== undefined && { unitCost: unitCost != null ? Number(unitCost) : null }),
          ...(supplier !== undefined && { supplier: supplier ? String(supplier) : null }),
          ...(barcode !== undefined && { barcode: barcode ? String(barcode) : null }),
          ...(notes !== undefined && { notes: notes ? String(notes) : null }),
          ...(isActive != null && { isActive: Boolean(isActive) }),
          ...(purchaseUnitIdProvided && { purchaseUnitId }),
          ...(consumptionUnitIdProvided && { consumptionUnitId }),
          ...(conversionFactorProvided && { conversionFactor }),
        },
      });
    });

    await logActivity({ clinicId, userId, action: 'update', entityType: 'inventory', entityId: id, description: `Stok kalemi güncellendi: ${updated.name}` });

    res.json(updated);
  } catch (err) {
    if (err instanceof InventoryItemNotFoundError) return res.status(404).json({ error: 'Item not found' });
    if (err instanceof UnitConfigIncompleteError) {
      return res.status(400).json({
        error: 'purchaseUnitId, consumptionUnitId, and conversionFactor must be provided together',
        code: 'INVENTORY_UNIT_CONFIG_INCOMPLETE',
      });
    }
    if (err instanceof ConsumptionUnitLockedError) {
      return res.status(409).json({
        error: 'consumptionUnitId cannot be changed or cleared once stock, minimum stock, or transaction history exists for this item',
        code: 'INVENTORY_CONSUMPTION_UNIT_LOCKED',
      });
    }
    if (err instanceof ConversionFactorLockedError) {
      return res.status(409).json({
        error: 'conversionFactor cannot be changed once purchase-unit transactions have been recorded for this item',
        code: 'INVENTORY_CONVERSION_FACTOR_LOCKED',
      });
    }
    console.error('Inventory update error:', err);
    res.status(500).json({ error: 'Failed to update inventory item' });
  }
});

// ── POST /api/inventory/:id/transactions ─────────────────────────────────────
class InsufficientStockError extends Error {}
class AdjustmentUnitUnsupportedError extends Error {}

router.post('/inventory/:id/transactions', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const userId = req.user!.id;
  const { type, quantity, unitCost, reason, treatmentCaseId, notes, unitId } = req.body;

  if (!type || !quantity) {
    return res.status(400).json({ error: 'type and quantity are required' });
  }
  if (!['in', 'out', 'adjustment'].includes(String(type))) {
    return res.status(400).json({ error: 'type must be in | out | adjustment' });
  }

  const qty = Number(quantity);
  if (!isValidQuantity(qty)) {
    return res.status(400).json({ error: 'quantity must be a positive number', code: 'INVENTORY_QUANTITY_INVALID' });
  }

  const txType = String(type);
  const requestedUnitId = unitId != null ? String(unitId) : null;

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const itemForAuth = await prisma.inventoryItem.findFirst({ where: { id, clinicId: { in: accessibleIds } } });
    if (!itemForAuth) return res.status(404).json({ error: 'Item not found' });

    const clinicId = itemForAuth.clinicId;

    // Cross-clinic/active checks are read-only lookups on InventoryUnit rows
    // and don't depend on this item's own state — safe ahead of the lock.
    if (requestedUnitId) {
      const unitErr = await validateUnitReference(clinicId, requestedUnitId);
      if (unitErr) return res.status(400).json(unitErr);
    }

    // Validate treatmentCaseId belongs to clinic if provided
    if (treatmentCaseId) {
      const tc = await prisma.treatmentCase.findFirst({ where: { id: String(treatmentCaseId), clinicId } });
      if (!tc) return res.status(400).json({ error: 'Invalid treatmentCaseId' });
    }

    // Concurrency strategy: role resolution and quantity conversion are
    // deliberately re-derived *inside* this transaction from a FOR UPDATE
    // locked read, not from the itemForAuth snapshot above. PUT
    // /inventory/:id's unit-config lock takes the same FOR UPDATE lock on
    // this row before it commits a purchase/consumption/conversionFactor
    // change — so if a concurrent PUT is in flight, this request either
    // observes its fully-committed result (and resolves the role against
    // it) or blocks until it does. Atomic, race-safe stock mutation: 'in'
    // uses Prisma's atomic increment (safe regardless of concurrent
    // writers); 'out' uses an updateMany with a currentStock >=
    // quantityInBaseUnit guard so two concurrent depletions cannot both
    // succeed and drive stock negative (same pattern as
    // treatmentStockDeduction.ts's deductInventoryRequirements);
    // 'adjustment' sets the absolute target (unchanged last-write-wins
    // semantics).
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM "InventoryItem" WHERE id = ${id} AND "clinicId" = ${clinicId} FOR UPDATE`
      );
      const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id } });

      const role = resolveUnitRole(item, requestedUnitId);

      // Adjustment sets an absolute target quantity — ambiguous in
      // purchase-unit terms (target box count vs. target piece count), so
      // it is restricted to the consumption/base unit (or the legacy
      // free-text unit), same as before unit-conversion existed.
      if (role === 'purchase' && txType === 'adjustment') {
        throw new AdjustmentUnitUnsupportedError();
      }

      const quantityInBaseUnit = computeQuantityInBaseUnit({ quantity: qty, role, conversionFactor: item.conversionFactor });

      const transactionData = {
        clinicId,
        itemId: id,
        type: txType,
        quantity: qty,
        unitCost: unitCost != null ? Number(unitCost) : null,
        reason: reason ? String(reason) : null,
        treatmentCaseId: treatmentCaseId ? String(treatmentCaseId) : null,
        notes: notes ? String(notes) : null,
        performedById: userId,
        unitId: requestedUnitId,
        quantityInBaseUnit,
      };

      if (txType === 'out') {
        const updateResult = await tx.inventoryItem.updateMany({
          where: { id, currentStock: { gte: quantityInBaseUnit } },
          data: { currentStock: { decrement: quantityInBaseUnit } },
        });
        if (updateResult.count !== 1) throw new InsufficientStockError();
      } else if (txType === 'in') {
        await tx.inventoryItem.update({ where: { id }, data: { currentStock: { increment: quantityInBaseUnit } } });
      } else {
        await tx.inventoryItem.update({ where: { id }, data: { currentStock: quantityInBaseUnit } });
      }

      const created = await tx.inventoryTransaction.create({ data: transactionData });
      const updatedItem = await tx.inventoryItem.findUniqueOrThrow({ where: { id }, select: { currentStock: true } });
      return { created, newStock: updatedItem.currentStock, itemName: item.name, itemUnit: item.unit };
    });

    const typeLabel = txType === 'in' ? 'Giriş' : txType === 'out' ? 'Çıkış' : 'Düzeltme';
    await logActivity({ clinicId, userId, action: 'update', entityType: 'inventory', entityId: id, description: `${result.itemName}: stok ${typeLabel} (${qty} ${result.itemUnit})` });

    res.status(201).json({ transaction: result.created, newStock: result.newStock });
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return res.status(400).json({ error: 'Insufficient stock for this transaction', code: 'INVENTORY_INSUFFICIENT_STOCK' });
    }
    if (err instanceof AdjustmentUnitUnsupportedError) {
      return res.status(400).json({
        error: 'Adjustment transactions must use the consumption unit, not the purchase unit',
        code: 'INVENTORY_ADJUSTMENT_UNIT_UNSUPPORTED',
      });
    }
    if (err instanceof InventoryUnitConversionError) {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    console.error('Inventory transaction error:', err);
    res.status(500).json({ error: 'Failed to create inventory transaction' });
  }
});

// ── GET /api/inventory/:id/transactions ──────────────────────────────────────
router.get('/inventory/:id/transactions', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const item = await prisma.inventoryItem.findFirst({ where: { id, clinicId: { in: accessibleIds } } });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const transactions = await prisma.inventoryTransaction.findMany({
      where: { itemId: id, clinicId: item.clinicId },
      include: {
        performedBy: { select: { id: true, firstName: true, lastName: true } },
        treatmentCase: { select: { id: true, title: true } },
        unit: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    res.json(transactions);
  } catch (err) {
    console.error('Inventory transactions fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

export default router;
