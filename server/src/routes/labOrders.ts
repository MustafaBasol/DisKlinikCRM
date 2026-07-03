import express, { Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { labWorkOrderSchema, labWorkOrderUpdateSchema, labWorkOrderStatusUpdateSchema } from '../schemas/index.js';
import { validateAndGetClinicIdScope, getAccessibleClinicIds, resolveEffectiveClinicId } from '../utils/clinicScope.js';
import { findPatientInClinic, findTreatmentCaseInClinic, findUserAssignedToClinic } from '../utils/relationGuards.js';
import { validateStatusTransition, isRevisionLoopBack, isOverdue, type LabWorkOrderStatus } from '../services/labOrders/labOrderStatusTransitions.js';
import { buildDashboardSummary } from '../services/labOrders/labOrderSummary.js';

const router = express.Router();

// Reception/clinical/management staff run day-to-day lab coordination (impressions, shipping,
// fitting scheduling). BILLING can view (incl. cost) but never create/edit/cancel/change status —
// enforced simply by never including 'BILLING' in a write-route authorize() list below.
const LAB_ORDER_MANAGE_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'ASSISTANT'] as const;
const LAB_ORDER_READ_ROLES = [...LAB_ORDER_MANAGE_ROLES, 'BILLING'] as const;
const LAB_ORDER_DELETE_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER'] as const;

const labOrderInclude = {
  patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
  laboratory: { select: { id: true, name: true, phone: true, email: true } },
  practitioner: { select: { id: true, firstName: true, lastName: true } },
  treatmentCase: { select: { id: true, title: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
};

function withOverdue<T extends { status: string; expectedReturnDate: Date | null }>(order: T) {
  return { ...order, isOverdue: isOverdue(order) };
}

// GET /api/lab-orders
router.get('/lab-orders', authorize([...LAB_ORDER_READ_ROLES]), async (req: AuthRequest, res: Response) => {
  const { status, laboratoryId, patientId, overdue, clinicId: selectedClinicId } = req.query;

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const where: any = { ...scope, deletedAt: null };
    if (status) where.status = String(status);
    if (laboratoryId) where.laboratoryId = String(laboratoryId);
    if (patientId) where.patientId = String(patientId);

    const orders = await prisma.labWorkOrder.findMany({
      where,
      include: labOrderInclude,
      orderBy: { createdAt: 'desc' },
    });

    let result = orders.map(withOverdue);
    if (overdue === 'true') result = result.filter(o => o.isOverdue);

    res.json(result);
  } catch {
    res.status(500).json({ error: 'Failed to fetch lab work orders' });
  }
});

// GET /api/lab-orders/dashboard
router.get('/lab-orders/dashboard', authorize([...LAB_ORDER_READ_ROLES]), async (req: AuthRequest, res: Response) => {
  const { clinicId: selectedClinicId } = req.query;

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
    if (scope === false) return;

    const orders = await prisma.labWorkOrder.findMany({
      where: { ...scope, deletedAt: null },
      select: { status: true, expectedReturnDate: true },
    });

    res.json(buildDashboardSummary(orders));
  } catch {
    res.status(500).json({ error: 'Failed to fetch lab work order dashboard summary' });
  }
});

// GET /api/lab-orders/:id
router.get('/lab-orders/:id', authorize([...LAB_ORDER_READ_ROLES]), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const order = await prisma.labWorkOrder.findFirst({
      where: { id, clinicId: { in: accessibleIds }, deletedAt: null },
      include: {
        ...labOrderInclude,
        statusHistory: {
          include: { changedBy: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
        },
        attachments: {
          include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!order) return res.status(404).json({ error: 'Lab work order not found' });

    res.json(withOverdue(order));
  } catch {
    res.status(500).json({ error: 'Failed to fetch lab work order' });
  }
});

// POST /api/lab-orders
router.post('/lab-orders', authorize([...LAB_ORDER_MANAGE_ROLES]), async (req: AuthRequest, res: Response) => {
  const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

  const validation = labWorkOrderSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const { patientId, laboratoryId, treatmentCaseId, practitionerId } = validation.data;

    const [patient, laboratory, treatmentCase, practitioner] = await Promise.all([
      findPatientInClinic(patientId, clinicId),
      prisma.laboratory.findFirst({ where: { id: laboratoryId, clinicId, deletedAt: null } }),
      treatmentCaseId ? findTreatmentCaseInClinic(treatmentCaseId, clinicId, patientId) : Promise.resolve(null),
      practitionerId ? findUserAssignedToClinic(practitionerId, clinicId) : Promise.resolve(null),
    ]);

    if (!patient) return res.status(400).json({ error: 'Invalid patient' });
    if (!laboratory) return res.status(400).json({ error: 'Invalid laboratory' });
    if (treatmentCaseId && !treatmentCase) return res.status(400).json({ error: 'Invalid treatment case' });
    if (practitionerId && !practitioner) return res.status(400).json({ error: 'Invalid practitioner' });

    const order = await prisma.labWorkOrder.create({
      data: { ...validation.data, clinicId, status: 'pending', createdById: req.user!.id },
      include: labOrderInclude,
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'lab_work_order', entityId: order.id, patientId,
      action: 'created', description: `${patient.firstName} ${patient.lastName} için lab işi oluşturuldu (${laboratory.name})`,
    });

    res.status(201).json(withOverdue(order));
  } catch {
    res.status(500).json({ error: 'Failed to create lab work order' });
  }
});

// PUT /api/lab-orders/:id — non-status fields only
router.put('/lab-orders/:id', authorize([...LAB_ORDER_MANAGE_ROLES]), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  const validation = labWorkOrderUpdateSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const existing = await prisma.labWorkOrder.findFirst({ where: { id, clinicId: { in: accessibleIds }, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: 'Lab work order not found' });
    const clinicId = existing.clinicId;

    const { laboratoryId, treatmentCaseId, practitionerId } = validation.data;
    const [laboratory, treatmentCase, practitioner] = await Promise.all([
      laboratoryId ? prisma.laboratory.findFirst({ where: { id: laboratoryId, clinicId, deletedAt: null } }) : Promise.resolve(null),
      treatmentCaseId ? findTreatmentCaseInClinic(treatmentCaseId, clinicId, existing.patientId) : Promise.resolve(null),
      practitionerId ? findUserAssignedToClinic(practitionerId, clinicId) : Promise.resolve(null),
    ]);

    if (laboratoryId && !laboratory) return res.status(400).json({ error: 'Invalid laboratory' });
    if (treatmentCaseId && !treatmentCase) return res.status(400).json({ error: 'Invalid treatment case' });
    if (practitionerId && !practitioner) return res.status(400).json({ error: 'Invalid practitioner' });

    const updated = await prisma.labWorkOrder.update({
      where: { id },
      data: validation.data,
      include: labOrderInclude,
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'lab_work_order', entityId: id, patientId: existing.patientId,
      action: 'updated', description: 'Lab işi güncellendi',
    });

    res.json(withOverdue(updated));
  } catch {
    res.status(500).json({ error: 'Failed to update lab work order' });
  }
});

// PATCH /api/lab-orders/:id/status
router.patch('/lab-orders/:id/status', authorize([...LAB_ORDER_MANAGE_ROLES]), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  const validation = labWorkOrderStatusUpdateSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const existing = await prisma.labWorkOrder.findFirst({ where: { id, clinicId: { in: accessibleIds }, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: 'Lab work order not found' });
    const clinicId = existing.clinicId;

    const fromStatus = existing.status as LabWorkOrderStatus;
    const { status: toStatus, note, newExpectedReturnDate, cancelReason } = validation.data;

    const transition = validateStatusTransition(fromStatus, toStatus);
    if (!transition.ok) return res.status(400).json({ error: transition.message, code: transition.code });

    const now = new Date();
    const data: any = { status: toStatus };

    if (toStatus === 'impression_taken') data.impressionTakenAt = now;
    if (toStatus === 'sent_to_lab') data.sentToLabAt = now;
    if (toStatus === 'received_from_lab') data.receivedFromLabAt = now;
    if (toStatus === 'fitting_or_trial') data.fittingScheduledAt = now;
    if (toStatus === 'completed') data.completedAt = now;
    if (toStatus === 'cancelled') {
      data.cancelledAt = now;
      data.cancelReason = cancelReason ?? null;
    }
    if (isRevisionLoopBack(fromStatus, toStatus)) {
      data.revisionCount = existing.revisionCount + 1;
    }
    if (newExpectedReturnDate) data.expectedReturnDate = newExpectedReturnDate;

    const [updated] = await prisma.$transaction([
      prisma.labWorkOrder.update({ where: { id }, data, include: labOrderInclude }),
      prisma.labWorkOrderStatusHistory.create({
        data: { labWorkOrderId: id, fromStatus, toStatus, note: note ?? null, changedById: req.user!.id },
      }),
    ]);

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'lab_work_order', entityId: id, patientId: existing.patientId,
      action: 'status_change', description: `Lab işi durumu değişti: ${fromStatus} → ${toStatus}`,
    });

    res.json(withOverdue(updated));
  } catch {
    res.status(500).json({ error: 'Failed to update lab work order status' });
  }
});

// DELETE /api/lab-orders/:id — soft delete
router.delete('/lab-orders/:id', authorize([...LAB_ORDER_DELETE_ROLES]), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const existing = await prisma.labWorkOrder.findFirst({ where: { id, clinicId: { in: accessibleIds }, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: 'Lab work order not found' });

    await prisma.labWorkOrder.update({ where: { id }, data: { deletedAt: new Date() } });

    await logActivity({
      clinicId: existing.clinicId, userId: req.user!.id, entityType: 'lab_work_order', entityId: id, patientId: existing.patientId,
      action: 'deleted', description: 'Lab işi silindi',
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete lab work order' });
  }
});

// ── Attachments ───────────────────────────────────────────────────────────
// Same storage/MIME-verification approach as attachments.ts (patient attachments),
// scoped under uploads/{clinicId}/ and re-checked by magic-byte signature.

const BASE_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(BASE_UPLOAD_DIR)) fs.mkdirSync(BASE_UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
]);

const ALLOWED_EXTENSIONS_BY_MIME: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
};

function hasMagic(bytes: Buffer, magic: number[]) {
  return magic.every((value, index) => bytes[index] === value);
}

function detectMimeFromSignature(filePath: string): string | null {
  const bytes = fs.readFileSync(filePath).subarray(0, 16);
  if (hasMagic(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (hasMagic(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

function isAllowedFileSignature(filePath: string, declaredMime: string, originalName: string) {
  const ext = path.extname(originalName).toLowerCase();
  const allowedExts = ALLOWED_EXTENSIONS_BY_MIME[declaredMime] ?? [];
  if (!allowedExts.includes(ext)) return false;
  return detectMimeFromSignature(filePath) === declaredMime;
}

const storage = multer.diskStorage({
  destination: (req: any, _file, cb) => {
    const clinicId = req.user?.clinicId ?? 'unknown';
    const clinicDir = path.join(BASE_UPLOAD_DIR, clinicId);
    fs.mkdirSync(clinicDir, { recursive: true });
    cb(null, clinicDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error('File type not allowed'));
  },
});

function handleUpload(req: AuthRequest, res: Response, next: NextFunction) {
  upload.single('file')(req as any, res as any, (err: any) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Dosya 10 MB sınırını aşıyor' });
      return res.status(400).json({ error: `Yükleme hatası: ${err.message}` });
    }
    if (err?.message === 'File type not allowed') {
      return res.status(400).json({ error: 'Desteklenmeyen dosya türü', detail: 'Yalnızca JPEG, PNG, GIF, WebP ve PDF kabul edilir' });
    }
    return res.status(500).json({ error: 'Yükleme başlatılamadı' });
  });
}

// POST /api/lab-orders/:id/attachments
router.post(
  '/lab-orders/:id/attachments',
  authorize([...LAB_ORDER_MANAGE_ROLES]),
  handleUpload,
  async (req: AuthRequest, res: Response) => {
    const id = getParam(req, 'id');

    if (!req.file) {
      return res.status(400).json({ error: 'Dosya alınamadı', detail: 'İstek Content-Type başlığında boundary eksik olabilir' });
    }

    try {
      const accessibleIds = await getAccessibleClinicIds(req.user!);
      if (accessibleIds.length === 0) {
        fs.unlinkSync(req.file.path);
        return res.status(403).json({ error: 'No clinic access' });
      }

      const order = await prisma.labWorkOrder.findFirst({ where: { id, clinicId: { in: accessibleIds }, deletedAt: null } });
      if (!order) {
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: 'Lab work order not found' });
      }

      if (!isAllowedFileSignature(req.file.path, req.file.mimetype, req.file.originalname)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Dosya içeriği doğrulanamadı', detail: 'Dosya uzantısı, MIME tipi veya dosya imzası desteklenen türlerle eşleşmiyor' });
      }

      const attachment = await prisma.labOrderAttachment.create({
        data: {
          clinicId: order.clinicId,
          labWorkOrderId: id,
          fileName: req.file.filename,
          originalName: req.file.originalname,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
          filePath: req.file.path,
          uploadedById: req.user!.id,
        },
        include: { uploadedBy: { select: { firstName: true, lastName: true } } },
      });

      await logActivity({
        clinicId: order.clinicId, userId: req.user!.id, entityType: 'lab_work_order', entityId: id, patientId: order.patientId,
        action: 'updated', description: `Lab işine dosya eklendi: ${req.file.originalname}`,
      });

      res.status(201).json(attachment);
    } catch {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(500).json({ error: 'Failed to upload attachment' });
    }
  },
);

// GET /api/lab-orders/:id/attachments
router.get('/lab-orders/:id/attachments', authorize([...LAB_ORDER_READ_ROLES]), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const order = await prisma.labWorkOrder.findFirst({ where: { id, clinicId: { in: accessibleIds }, deletedAt: null } });
    if (!order) return res.status(404).json({ error: 'Lab work order not found' });

    const attachments = await prisma.labOrderAttachment.findMany({
      where: { labWorkOrderId: id, clinicId: order.clinicId },
      include: { uploadedBy: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(attachments);
  } catch {
    res.status(500).json({ error: 'Failed to fetch attachments' });
  }
});

// GET /api/lab-orders/:id/attachments/:attId/download
router.get('/lab-orders/:id/attachments/:attId/download', authorize([...LAB_ORDER_READ_ROLES]), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const attId = String(req.params.attId);

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const order = await prisma.labWorkOrder.findFirst({ where: { id, clinicId: { in: accessibleIds }, deletedAt: null } });
    if (!order) return res.status(404).json({ error: 'Lab work order not found' });

    const attachment = await prisma.labOrderAttachment.findFirst({ where: { id: attId, labWorkOrderId: id, clinicId: order.clinicId } });
    if (!attachment) return res.status(404).json({ error: 'Not found' });
    if (!fs.existsSync(attachment.filePath)) return res.status(404).json({ error: 'File missing on disk' });

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.originalName)}"`);
    res.setHeader('Content-Type', attachment.mimeType);
    fs.createReadStream(attachment.filePath).pipe(res as any);
  } catch {
    res.status(500).json({ error: 'Failed to download attachment' });
  }
});

// DELETE /api/lab-orders/:id/attachments/:attId
router.delete('/lab-orders/:id/attachments/:attId', authorize([...LAB_ORDER_MANAGE_ROLES]), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const attId = String(req.params.attId);

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const order = await prisma.labWorkOrder.findFirst({ where: { id, clinicId: { in: accessibleIds }, deletedAt: null } });
    if (!order) return res.status(404).json({ error: 'Lab work order not found' });

    const attachment = await prisma.labOrderAttachment.findFirst({ where: { id: attId, labWorkOrderId: id, clinicId: order.clinicId } });
    if (!attachment) return res.status(404).json({ error: 'Not found' });

    await prisma.labOrderAttachment.delete({ where: { id: attId } });
    if (fs.existsSync(attachment.filePath)) fs.unlinkSync(attachment.filePath);

    await logActivity({
      clinicId: order.clinicId, userId: req.user!.id, entityType: 'lab_work_order', entityId: id, patientId: order.patientId,
      action: 'updated', description: `Lab işinden dosya silindi: ${attachment.originalName}`,
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete attachment' });
  }
});

export default router;
