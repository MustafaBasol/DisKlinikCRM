import express, { Response, NextFunction } from 'express';
import multer from 'multer';
import { authorize, AuthRequest } from '../middleware/auth.js';
import prisma from '../db.js';
import { isAllowedFileSignature } from '../utils/fileSignature.js';
import { isInlinePreviewable } from '../utils/filePreview.js';
import {
  buildStorageKey,
  deleteFile,
  fileNameFromKey,
  openFileStream,
  saveFile,
} from '../services/fileStorage.js';

const router = express.Router();

// ── İzin verilen MIME tipleri ─────────────────────────────────────────
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const ALLOWED_EXTENSIONS_BY_MIME: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
};

// Dosya bellekte tutulur (10 MB sınırıyla) ve doğrulama sonrası fileStorage'a
// yazılır: yerel disk veya S3_BUCKET tanımlıysa S3-uyumlu depo
// (docs/45 Faz 3 #11). Diske geçici dosya hiç yazılmaz.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  },
});

// ── POST /api/patients/:patientId/attachments ─────────────────────────
// Multer error handler — catches fileFilter rejection & size limit errors
function handleUpload(req: AuthRequest, res: Response, next: NextFunction) {
  upload.single('file')(req as any, res as any, (err: any) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Dosya 10 MB sınırını aşıyor' });
      }
      console.error('[attachments] multer error:', err.code, err.message);
      return res.status(400).json({ error: `Yükleme hatası: ${err.message}` });
    }
    // fileFilter rejected the MIME type
    if (err?.message === 'File type not allowed') {
      return res.status(400).json({
        error: 'Desteklenmeyen dosya türü',
        detail: 'Yalnızca JPEG, PNG, GIF, WebP, PDF ve Word dosyaları kabul edilir',
      });
    }
    console.error('[attachments] upload middleware error:', err?.message ?? err);
    return res.status(500).json({ error: 'Yükleme başlatılamadı' });
  });
}

router.post(
  '/patients/:patientId/attachments',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']),
  handleUpload,
  async (req: AuthRequest, res: Response) => {
    const patientId = String(req.params.patientId);
    const clinicId = req.user!.clinicId;

    if (!req.file) {
      // req.file is undefined only when Content-Type boundary is missing
      // (Axios/fetch must set it automatically — do NOT set Content-Type manually)
      console.error('[attachments] req.file is undefined — Content-Type boundary likely missing');
      return res.status(400).json({
        error: 'Dosya alınamadı',
        detail: 'İstek Content-Type başlığında boundary eksik olabilir',
      });
    }

    let storageKey: string | null = null;
    try {
      // Verify patient belongs to clinic
      const patient = await prisma.patient.findFirst({
        where: { id: patientId, clinicId, deletedAt: null },
      });
      if (!patient) {
        return res.status(404).json({ error: 'Patient not found' });
      }

      if (!isAllowedFileSignature(req.file.buffer, req.file.mimetype, req.file.originalname, ALLOWED_EXTENSIONS_BY_MIME)) {
        return res.status(400).json({
          error: 'Dosya içeriği doğrulanamadı',
          detail: 'Dosya uzantısı, MIME tipi veya dosya imzası desteklenen türlerle eşleşmiyor',
        });
      }

      storageKey = buildStorageKey(clinicId, req.file.originalname);
      await saveFile(storageKey, req.file.buffer, req.file.mimetype);

      const attachment = await prisma.patientAttachment.create({
        data: {
          clinicId,
          patientId,
          fileName: fileNameFromKey(storageKey),
          originalName: req.file.originalname,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
          filePath: storageKey,
          uploadedById: req.user!.id,
        },
        include: { uploadedBy: { select: { firstName: true, lastName: true } } },
      });

      await prisma.activityLog.create({
        data: {
          clinicId,
          userId: req.user!.id,
          action: 'create',
          entityType: 'patient',
          entityId: patientId,
          description: `Dosya eklendi: ${req.file.originalname}`,
        },
      });

      res.status(201).json(attachment);
    } catch (err: any) {
      // Depoya yazıldıktan sonra DB kaydı başarısız olduysa dosyayı geri sil.
      if (storageKey) await deleteFile(storageKey).catch(() => {});
      console.error('[attachments] upload error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to upload attachment' });
    }
  },
);

// ── GET /api/patients/:patientId/attachments ──────────────────────────
router.get(
  '/patients/:patientId/attachments',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const patientId = String(req.params.patientId);
    const clinicId = req.user!.clinicId;

    try {
      const attachments = await prisma.patientAttachment.findMany({
        where: { patientId, clinicId },
        include: { uploadedBy: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
      });
      res.json(attachments);
    } catch (err: any) {
      console.error('[attachments] list error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to fetch attachments' });
    }
  },
);

// ── GET /api/patients/:patientId/attachments/:id/download ─────────────
router.get(
  '/patients/:patientId/attachments/:id/download',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const patientId = String(req.params.patientId);
    const id = String(req.params.id);
    const clinicId = req.user!.clinicId;

    try {
      const attachment = await prisma.patientAttachment.findFirst({
        where: { id, patientId, clinicId },
      });
      if (!attachment) return res.status(404).json({ error: 'Not found' });

      const stream = await openFileStream(attachment.filePath);
      if (!stream) return res.status(404).json({ error: 'File missing in storage' });

      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.originalName)}"`);
      res.setHeader('Content-Type', attachment.mimeType);
      stream.on('error', (streamErr) => {
        console.error('[attachments] download stream error:', streamErr?.message ?? streamErr);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to download attachment' });
        else res.destroy();
      });
      stream.pipe(res as any);
    } catch (err: any) {
      console.error('[attachments] download error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to download attachment' });
    }
  },
);

// ── GET /api/patients/:patientId/attachments/:id/preview ──────────────
router.get(
  '/patients/:patientId/attachments/:id/preview',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const patientId = String(req.params.patientId);
    const id = String(req.params.id);
    const clinicId = req.user!.clinicId;

    try {
      const attachment = await prisma.patientAttachment.findFirst({
        where: { id, patientId, clinicId },
      });
      if (!attachment) return res.status(404).json({ error: 'Not found' });

      if (!isInlinePreviewable(attachment.mimeType)) {
        return res.status(415).json({ error: 'Bu dosya türü tarayıcıda önizlenemez' });
      }

      const stream = await openFileStream(attachment.filePath);
      if (!stream) return res.status(404).json({ error: 'File missing in storage' });

      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.originalName)}"`);
      res.setHeader('Content-Type', attachment.mimeType);
      stream.on('error', (streamErr) => {
        console.error('[attachments] preview stream error:', streamErr?.message ?? streamErr);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to preview attachment' });
        else res.destroy();
      });
      stream.pipe(res as any);
    } catch (err: any) {
      console.error('[attachments] preview error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to preview attachment' });
    }
  },
);

// ── PATCH /api/patients/:patientId/attachments/:id/legal-hold ─────────
// KVKK lifecycle (docs/compliance/53): sets/clears legalHold on a single
// PatientAttachment. Restricted to OWNER/ORG_ADMIN — legal hold blocks both
// anonymization metadata redaction and the deletion-review/execute
// live-delete path for this row. No automatic trigger exists in this PR.
router.patch(
  '/patients/:patientId/attachments/:id/legal-hold',
  authorize(['OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    const patientId = String(req.params.patientId);
    const id = String(req.params.id);
    const clinicId = req.user!.clinicId;
    const { legalHold, reason } = req.body as { legalHold?: boolean; reason?: string };

    if (typeof legalHold !== 'boolean') {
      return res.status(400).json({ error: 'legalHold must be a boolean' });
    }
    if (legalHold && (!reason || String(reason).trim().length < 3)) {
      return res.status(400).json({ error: 'A reason is required (min 3 characters) to place a legal hold.' });
    }

    try {
      const attachment = await prisma.patientAttachment.findFirst({
        where: { id, patientId, clinicId },
      });
      if (!attachment) return res.status(404).json({ error: 'Not found' });

      const updated = await prisma.patientAttachment.update({
        where: { id },
        data: {
          legalHold,
          legalHoldReason: legalHold ? String(reason).trim().slice(0, 500) : null,
        },
        select: { id: true, legalHold: true, legalHoldReason: true },
      });

      res.json(updated);
    } catch (err: any) {
      console.error('[attachments] legal-hold error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to update legal hold' });
    }
  },
);

// ── DELETE /api/patients/:patientId/attachments/:id ───────────────────
router.delete(
  '/patients/:patientId/attachments/:id',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const patientId = String(req.params.patientId);
    const id = String(req.params.id);
    const clinicId = req.user!.clinicId;

    try {
      const attachment = await prisma.patientAttachment.findFirst({
        where: { id, patientId, clinicId },
      });
      if (!attachment) return res.status(404).json({ error: 'Not found' });

      await prisma.patientAttachment.delete({ where: { id } });

      await deleteFile(attachment.filePath).catch((deleteErr) => {
        // DB kaydı silindi; depo silme hatası indirmeyi bozmaz, logla ve devam et.
        console.error('[attachments] storage delete error:', deleteErr?.message ?? deleteErr);
      });

      await prisma.activityLog.create({
        data: {
          clinicId,
          userId: req.user!.id,
          action: 'delete',
          entityType: 'patient',
          entityId: patientId,
          description: `Dosya silindi: ${attachment.originalName}`,
        },
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error('[attachments] delete error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to delete attachment' });
    }
  },
);

export default router;
