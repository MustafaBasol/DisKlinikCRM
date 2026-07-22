import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { validateAndGetScope, getAccessibleClinicIds, resolveEffectiveClinicId } from '../utils/clinicScope.js';

const router = express.Router();

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
        transactions: {
          include: { performedBy: { select: { id: true, firstName: true, lastName: true } } },
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

  if (!name || !category || !unit) {
    return res.status(400).json({ error: 'name, category, and unit are required' });
  }

  const clinicId = await resolveEffectiveClinicId(req.user!, req.body.clinicId as string | undefined);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

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
      },
    });

    // If opening stock > 0, create initial "in" transaction
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
router.put('/inventory/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const userId = req.user!.id;
  const { name, category, unit, minimumStock, unitCost, supplier, barcode, notes, isActive } = req.body;

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const existing = await prisma.inventoryItem.findFirst({ where: { id, clinicId: { in: accessibleIds } } });
    if (!existing) return res.status(404).json({ error: 'Item not found' });

    const clinicId = existing.clinicId;

    const updated = await prisma.inventoryItem.update({
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
      },
    });

    await logActivity({ clinicId, userId, action: 'update', entityType: 'inventory', entityId: id, description: `Stok kalemi güncellendi: ${updated.name}` });

    res.json(updated);
  } catch (err) {
    console.error('Inventory update error:', err);
    res.status(500).json({ error: 'Failed to update inventory item' });
  }
});

// ── POST /api/inventory/:id/transactions ─────────────────────────────────────
router.post('/inventory/:id/transactions', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const userId = req.user!.id;
  const { type, quantity, unitCost, reason, treatmentCaseId, notes } = req.body;

  if (!type || !quantity) {
    return res.status(400).json({ error: 'type and quantity are required' });
  }
  if (!['in', 'out', 'adjustment'].includes(String(type))) {
    return res.status(400).json({ error: 'type must be in | out | adjustment' });
  }

  const qty = Number(quantity);
  if (isNaN(qty) || qty <= 0) {
    return res.status(400).json({ error: 'quantity must be a positive number' });
  }

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const item = await prisma.inventoryItem.findFirst({ where: { id, clinicId: { in: accessibleIds } } });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const clinicId = item.clinicId;

    // Compute new stock
    let stockDelta = qty;
    if (type === 'out') stockDelta = -qty;
    else if (type === 'adjustment') stockDelta = qty - item.currentStock; // absolute

    const newStock = type === 'adjustment' ? qty : item.currentStock + stockDelta;
    if (newStock < 0) {
      return res.status(400).json({ error: `Yetersiz stok. Mevcut: ${item.currentStock}` });
    }

    // Validate treatmentCaseId belongs to clinic if provided
    if (treatmentCaseId) {
      const tc = await prisma.treatmentCase.findFirst({ where: { id: String(treatmentCaseId), clinicId } });
      if (!tc) return res.status(400).json({ error: 'Invalid treatmentCaseId' });
    }

    const [transaction] = await prisma.$transaction([
      prisma.inventoryTransaction.create({
        data: {
          clinicId,
          itemId: id,
          type: String(type),
          quantity: qty,
          unitCost: unitCost != null ? Number(unitCost) : null,
          reason: reason ? String(reason) : null,
          treatmentCaseId: treatmentCaseId ? String(treatmentCaseId) : null,
          notes: notes ? String(notes) : null,
          performedById: userId,
        },
      }),
      prisma.inventoryItem.update({
        where: { id },
        data: { currentStock: newStock },
      }),
    ]);

    const typeLabel = type === 'in' ? 'Giriş' : type === 'out' ? 'Çıkış' : 'Düzeltme';
    await logActivity({ clinicId, userId, action: 'update', entityType: 'inventory', entityId: id, description: `${item.name}: stok ${typeLabel} (${qty} ${item.unit})` });

    res.status(201).json({ transaction, newStock });
  } catch (err) {
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
