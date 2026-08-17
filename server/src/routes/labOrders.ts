import express, { Response, NextFunction } from 'express';
import multer from 'multer';
import prisma from '../db.js';
import { isAllowedFileSignature } from '../utils/fileSignature.js';
import { isInlinePreviewable } from '../utils/filePreview.js';
import { buildObjectStorageKey, fileNameFromKey, openFileStream, saveFile } from '../services/fileStorage.js';
import {
  deleteStoredObjectWithEvidence,
  isReconciliationSafe,
} from '../services/storageObjectDeletion.js';
import { extractRequestMeta, writeAuditLog } from '../utils/auditLog.js';
import { safeErrorFields } from '../utils/safeError.js';
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

// ── KVKK legal-hold response redaction (docs/compliance/53 §16B, R-079) ────
// Deliberately a local copy rather than an import from routes/attachments.ts:
// routes/imaging.ts already established that each domain owns its own copy of
// this two-line contract (see its roleCanSeeLegalHoldReason /
// redactStudyLegalHoldReason), and a route→route import would be the first
// cross-domain route dependency in the repository. The rule itself is
// identical and must stay identical: legalHold (boolean) is safe for every
// role that may already see the attachment; legalHoldReason is free text and
// must only ever reach OWNER/ORG_ADMIN — the same roles the legal-hold PATCH
// route below is gated to.
export function roleCanSeeLegalHoldReason(role: string): boolean {
  return role === 'OWNER' || role === 'ORG_ADMIN';
}

function canSeeLegalHoldReason(req: AuthRequest): boolean {
  return roleCanSeeLegalHoldReason(req.user!.role);
}

export function redactLabAttachmentLegalHoldReason<T extends { legalHoldReason?: string | null }>(row: T, allowed: boolean): T {
  if (allowed) return row;
  return { ...row, legalHoldReason: null };
}

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

    // The nested `attachments` include returns every LabOrderAttachment scalar
    // (Prisma `include` cannot restrict them), so this response is one of the
    // three that must be passed through the role-gated redaction helper.
    const canSeeReason = canSeeLegalHoldReason(req);
    res.json(withOverdue({
      ...order,
      attachments: order.attachments.map((a) => redactLabAttachmentLegalHoldReason(a, canSeeReason)),
    }));
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

    // patientId, clinicId, status and audit fields must never be touched by this generic update —
    // status changes go through PATCH /:id/status, and the schema already omits patientId, but we
    // strip it again here defensively since `data` is spread straight into Prisma.
    const { patientId: _ignoredPatientId, ...updateData } = validation.data as Record<string, unknown>;

    const updated = await prisma.labWorkOrder.update({
      where: { id },
      data: updateData,
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
// Same MIME-verification approach as attachments.ts (patient attachments):
// magic-byte signature check on the in-memory buffer, then handed to
// services/fileStorage.ts (yerel disk veya S3 — docs/45 Faz 3 #11). The file
// only ever lands under the *order's* clinic key, never req.user.clinicId
// (the uploader's default clinic is not necessarily the order's clinic).

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

const upload = multer({
  storage: multer.memoryStorage(),
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

    let storageKey: string | null = null;
    // Hoisted so the rollback in the catch block can attribute the compensating
    // object deletion to a clinic — storageKey is only set after this is
    // assigned, so whenever there is something to roll back the owner is known.
    let rollbackClinicId: string | null = null;
    try {
      const accessibleIds = await getAccessibleClinicIds(req.user!);
      if (accessibleIds.length === 0) {
        return res.status(403).json({ error: 'No clinic access' });
      }

      const order = await prisma.labWorkOrder.findFirst({ where: { id, clinicId: { in: accessibleIds }, deletedAt: null } });
      if (!order) {
        return res.status(404).json({ error: 'Lab work order not found' });
      }
      rollbackClinicId = order.clinicId;

      if (!isAllowedFileSignature(req.file.buffer, req.file.mimetype, req.file.originalname, ALLOWED_EXTENSIONS_BY_MIME)) {
        return res.status(400).json({ error: 'Dosya içeriği doğrulanamadı', detail: 'Dosya uzantısı, MIME tipi veya dosya imzası desteklenen türlerle eşleşmiyor' });
      }

      // Depolama anahtarı order'ın gerçek kliniğinden türetilir — dosyanın
      // nereye yazılacağı konusunda req.user.clinicId'ye asla güvenilmez.
      // F4-1A2: bu çağrı artık kendi nesne sınıfını ('lab-attachment') yetkili
      // sözleşmeye bildirir. Anahtar biçimi değişmedi — üç içerik sınıfı aynı
      // `<clinicId>/<opaqueId><ext>` şablonunu paylaşır (fileStorage.ts).
      storageKey = buildObjectStorageKey({
        kind: 'lab-attachment',
        clinicId: order.clinicId,
        originalName: req.file.originalname,
      });
      await saveFile(storageKey, req.file.buffer, req.file.mimetype);

      const attachment = await prisma.labOrderAttachment.create({
        data: {
          clinicId: order.clinicId,
          labWorkOrderId: id,
          fileName: fileNameFromKey(storageKey),
          originalName: req.file.originalname,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
          filePath: storageKey,
          uploadedById: req.user!.id,
        },
        include: { uploadedBy: { select: { firstName: true, lastName: true } } },
      });

      await logActivity({
        clinicId: order.clinicId, userId: req.user!.id, entityType: 'lab_work_order', entityId: id, patientId: order.patientId,
        action: 'updated', description: `Lab işine dosya eklendi: ${req.file.originalname}`,
      });

      res.status(201).json(redactLabAttachmentLegalHoldReason(attachment, canSeeLegalHoldReason(req)));
    } catch {
      // Depoya yazıldıktan sonra DB kaydı başarısız olduysa dosyayı geri sil.
      // F4-3: a failed rollback leaves an object with no DB row at all — the
      // evidence write is the only record that makes it reconcilable.
      // F4-3-R1: the rollback outcome is inspected, not discarded — a storage
      // delete that failed with no committed evidence leaves an object nothing
      // can name, so it is escalated rather than swallowed.
      if (storageKey && rollbackClinicId) {
        await deleteStoredObjectWithEvidence({
          organizationId: req.user!.organizationId,
          clinicId: rollbackClinicId,
          entityType: 'lab_order_attachment',
          entityId: id,
          storageKey,
          source: 'upload_rollback',
          actorUserId: req.user!.id,
          actorRole: req.user!.role,
          ...extractRequestMeta(req),
        })
          .then((result) => {
            if (!isReconciliationSafe(result)) {
              console.error(
                '[labOrders] upload rollback left an unevidenced storage object',
                { labWorkOrderId: id, outcome: result.outcome, keyForm: result.keyForm },
              );
            }
          })
          .catch((rollbackErr) => {
            console.error('[labOrders] upload rollback failed', safeErrorFields(rollbackErr));
          });
      }
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
    const canSeeReason = canSeeLegalHoldReason(req);
    res.json(attachments.map((a) => redactLabAttachmentLegalHoldReason(a, canSeeReason)));
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

    const stream = await openFileStream(attachment.filePath);
    if (!stream) return res.status(404).json({ error: 'File missing in storage' });

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.originalName)}"`);
    res.setHeader('Content-Type', attachment.mimeType);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).json({ error: 'Failed to download attachment' });
      else res.destroy();
    });
    stream.pipe(res as any);
  } catch {
    res.status(500).json({ error: 'Failed to download attachment' });
  }
});

// GET /api/lab-orders/:id/attachments/:attId/preview
router.get('/lab-orders/:id/attachments/:attId/preview', authorize([...LAB_ORDER_READ_ROLES]), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const attId = String(req.params.attId);

  try {
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const order = await prisma.labWorkOrder.findFirst({ where: { id, clinicId: { in: accessibleIds }, deletedAt: null } });
    if (!order) return res.status(404).json({ error: 'Lab work order not found' });

    const attachment = await prisma.labOrderAttachment.findFirst({ where: { id: attId, labWorkOrderId: id, clinicId: order.clinicId } });
    if (!attachment) return res.status(404).json({ error: 'Not found' });

    if (!isInlinePreviewable(attachment.mimeType)) {
      return res.status(415).json({ error: 'Bu dosya türü tarayıcıda önizlenemez' });
    }

    const stream = await openFileStream(attachment.filePath);
    if (!stream) return res.status(404).json({ error: 'File missing in storage' });

    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.originalName)}"`);
    res.setHeader('Content-Type', attachment.mimeType);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).json({ error: 'Failed to preview attachment' });
      else res.destroy();
    });
    stream.pipe(res as any);
  } catch {
    res.status(500).json({ error: 'Failed to preview attachment' });
  }
});

// PATCH /api/lab-orders/:id/attachments/:attId/legal-hold
// KVKK lifecycle (docs/compliance/53 §16B, R-079): sets/clears legalHold on a
// single LabOrderAttachment. Restricted to OWNER/ORG_ADMIN — the same, and
// only, roles the PatientAttachment legal-hold route accepts; no new role is
// introduced. Note this is deliberately NARROWER than LAB_ORDER_MANAGE_ROLES,
// which governs every other write on this router: placing/releasing a hold is
// a legal act, not lab coordination. Requires a reason (min 3 chars) in BOTH
// directions and audits both, because releasing a hold re-opens the row to
// permanent deletion and is exactly as consequential as placing one.
router.patch('/lab-orders/:id/attachments/:attId/legal-hold', authorize(['OWNER', 'ORG_ADMIN']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const attId = String(req.params.attId);
  const { legalHold, reason } = req.body as { legalHold?: boolean; reason?: string };

  if (typeof legalHold !== 'boolean') {
    return res.status(400).json({ error: 'legalHold must be a boolean' });
  }
  if (!reason || String(reason).trim().length < 3) {
    return res.status(400).json({
      error: `A reason is required (min 3 characters) to ${legalHold ? 'place' : 'release'} a legal hold.`,
    });
  }

  try {
    // Same ownership chain as every other route on this router: accessible
    // clinic ids -> LabWorkOrder -> the order's OWN clinicId. req.user.clinicId
    // is never the source of truth.
    const accessibleIds = await getAccessibleClinicIds(req.user!);
    if (accessibleIds.length === 0) return res.status(403).json({ error: 'No clinic access' });

    const order = await prisma.labWorkOrder.findFirst({ where: { id, clinicId: { in: accessibleIds }, deletedAt: null } });
    if (!order) return res.status(404).json({ error: 'Lab work order not found' });

    const existing = await prisma.labOrderAttachment.findFirst({
      where: { id: attId, labWorkOrderId: id, clinicId: order.clinicId },
      select: { id: true, legalHold: true },
    });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const trimmedReason = String(reason).trim().slice(0, 500);

    // updateMany scoped by the full ownership predicate rather than
    // `update({ where: { id } })`: the write stays inside the same proof of
    // ownership the read used, and it composes correctly with the DELETE
    // route's atomic gate — whichever single statement Postgres commits first
    // wins deterministically. If the row was deleted in between, count is 0
    // and nothing is silently resurrected.
    const updated = await prisma.labOrderAttachment.updateMany({
      where: { id: attId, labWorkOrderId: id, clinicId: order.clinicId },
      data: { legalHold, legalHoldReason: trimmedReason },
    });
    if (updated.count === 0) return res.status(404).json({ error: 'Not found' });

    await writeAuditLog({
      organizationId: req.user!.organizationId,
      clinicId: order.clinicId,
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: legalHold ? 'lab_order_attachment_legal_hold_set' : 'lab_order_attachment_legal_hold_released',
      entityType: 'lab_order_attachment',
      entityId: attId,
      // No file name and no free-text reason in the audit trail — the reason is
      // retained on the row itself (legalHoldReason); the audit record only
      // needs the stable references and the before/after state
      // (docs/compliance/53 P1 — no PII in audit log).
      description: `Lab order attachment legal hold ${legalHold ? 'set' : 'released'}`,
      metadata: { labWorkOrderId: id, previousLegalHold: existing.legalHold, newLegalHold: legalHold },
      ...extractRequestMeta(req),
    });

    res.json(redactLabAttachmentLegalHoldReason(
      { id: attId, legalHold, legalHoldReason: trimmedReason },
      canSeeLegalHoldReason(req),
    ));
  } catch (err) {
    console.error('[labOrders] legal-hold error:', safeErrorFields(err));
    res.status(500).json({ error: 'Failed to update legal hold' });
  }
});

// DELETE /api/lab-orders/:id/attachments/:attId
// KVKK lifecycle (docs/compliance/53 §16B, R-079): a legalHold=true attachment
// can never be deleted through this route, which is the only path in the
// codebase that deletes a LabOrderAttachment row or its stored object.
//
// Atomicity (closes the TOCTOU window R-079 recorded): the authorization
// decision is the single conditional `deleteMany` below, whose WHERE clause
// carries `legalHold: false` — NOT the pre-read above it. Postgres evaluates
// that predicate and performs the delete inside one statement, so a concurrent
// legal-hold PATCH either (a) commits first, the row no longer matches, the
// deleteMany affects 0 rows and nothing — neither the row nor the object — is
// deleted; or (b) loses, in which case its own scoped `updateMany` affects 0
// rows. A stale pre-read can therefore never authorize a delete. This is the
// same contract PR #163 established for PatientAttachment.
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

    // F4-3: the DB delete is scoped by the resolved owner (labWorkOrderId +
    // the order's own clinicId), not by bare id. The preceding findFirst
    // already proved ownership, but an id-only `delete` re-widens the write
    // past that proof and would act on a row that changed underneath it; the
    // conditional deleteMany keeps the authorization decision and the write in
    // the same statement, matching the patient-attachment route's precedent.
    //
    // F4-3/R-079: `legalHold: false` is part of that same predicate — it is the
    // gate, not a check performed near it. The pre-read above is metadata only
    // (filePath for the storage deletion, originalName for the activity log).
    const removed = await prisma.labOrderAttachment.deleteMany({
      where: { id: attId, labWorkOrderId: id, clinicId: order.clinicId, legalHold: false },
    });

    if (removed.count === 0) {
      // Three distinguishable causes, resolved WITHOUT widening tenant scope —
      // the re-read below carries the identical ownership predicate:
      //   * row gone (deleted concurrently)                      -> 404
      //   * row present and held (incl. a hold that committed
      //     after the pre-read — the TOCTOU case)                -> 409
      //   * ownership/scope mismatch                             -> already
      //     rejected above by the order lookup / pre-read, which never leave
      //     this branch reachable for another clinic's row.
      const stillThere = await prisma.labOrderAttachment.findFirst({
        where: { id: attId, labWorkOrderId: id, clinicId: order.clinicId },
      });
      if (!stillThere) return res.status(404).json({ error: 'Not found' });

      const canSeeReason = canSeeLegalHoldReason(req);
      await writeAuditLog({
        organizationId: req.user!.organizationId,
        clinicId: order.clinicId,
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        action: 'lab_order_attachment_delete_blocked_legal_hold',
        entityType: 'lab_order_attachment',
        entityId: attId,
        // entityId + labWorkOrderId are sufficient stable references; no file
        // name and no reason text (docs/compliance/53 P1 — no PII in audit log).
        description: 'Lab order attachment deletion rejected — under legal hold',
        metadata: { labWorkOrderId: id },
        ...extractRequestMeta(req),
      });
      return res.status(409).json({
        error: 'ATTACHMENT_LEGAL_HOLD',
        message: 'This attachment is under legal hold and cannot be deleted.',
        ...(canSeeReason ? { legalHoldReason: stillThere.legalHoldReason } : {}),
      });
    }

    // Reached only once the DB row is confirmed gone — i.e. the legal-hold gate
    // above authorized the deletion. Physical storage deletion is never
    // attempted on the blocked path, so no storage-deletion evidence is written
    // claiming an attempt that did not happen.
    const storageDeletion = await deleteStoredObjectWithEvidence({
      organizationId: req.user!.organizationId,
      clinicId: order.clinicId,
      entityType: 'lab_order_attachment',
      entityId: attId,
      storageKey: attachment.filePath,
      source: 'record_delete',
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      ...extractRequestMeta(req),
    });

    await logActivity({
      clinicId: order.clinicId, userId: req.user!.id, entityType: 'lab_work_order', entityId: id, patientId: order.patientId,
      action: 'updated', description: `Lab işinden dosya silindi: ${attachment.originalName}`,
    });

    // F4-3-R1: an evidenced storage failure still returns 200 (the row is gone
    // and the leak is tracked), but a storage failure with NO committed
    // evidence is not a success in any sense the caller could act on — the row
    // is gone and nothing names the object. Report the partial state plainly,
    // without exposing the storage key or file name.
    if (!isReconciliationSafe(storageDeletion)) {
      return res.status(500).json({
        error: 'Attachment record was deleted but its file removal could not be confirmed or recorded.',
        code: 'STORAGE_DELETE_UNEVIDENCED',
        recordDeleted: true,
        storageDeletion: storageDeletion.outcome,
      });
    }

    res.json({ success: true, storageDeletion: storageDeletion.outcome });
  } catch {
    res.status(500).json({ error: 'Failed to delete attachment' });
  }
});

export default router;
