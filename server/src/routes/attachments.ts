import express, { Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authorize, AuthRequest } from '../middleware/auth.js';
import prisma from '../db.js';

const router = express.Router();

// ── Yükleme dizini (klinik bazında izole) ─────────────────────────────
const BASE_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(BASE_UPLOAD_DIR)) fs.mkdirSync(BASE_UPLOAD_DIR, { recursive: true });

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
  if (hasMagic(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'application/msword';
  if (hasMagic(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return null;
}

function isAllowedFileSignature(filePath: string, declaredMime: string, originalName: string) {
  const ext = path.extname(originalName).toLowerCase();
  const allowedExts = ALLOWED_EXTENSIONS_BY_MIME[declaredMime] ?? [];
  if (!allowedExts.includes(ext)) return false;

  const detectedMime = detectMimeFromSignature(filePath);
  return detectedMime === declaredMime;
}

const storage = multer.diskStorage({
  destination: (req: any, _file, cb) => {
    // req.user is populated by authenticate middleware before this point
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

    try {
      // Verify patient belongs to clinic
      const patient = await prisma.patient.findFirst({
        where: { id: patientId, clinicId, deletedAt: null },
      });
      if (!patient) {
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: 'Patient not found' });
      }

      if (!isAllowedFileSignature(req.file.path, req.file.mimetype, req.file.originalname)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({
          error: 'Dosya içeriği doğrulanamadı',
          detail: 'Dosya uzantısı, MIME tipi veya dosya imzası desteklenen türlerle eşleşmiyor',
        });
      }

      const attachment = await prisma.patientAttachment.create({
        data: {
          clinicId,
          patientId,
          fileName: req.file.filename,
          originalName: req.file.originalname,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
          filePath: req.file.path,
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
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
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
      if (!fs.existsSync(attachment.filePath)) return res.status(404).json({ error: 'File missing on disk' });

      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.originalName)}"`);
      res.setHeader('Content-Type', attachment.mimeType);
      fs.createReadStream(attachment.filePath).pipe(res as any);
    } catch (err: any) {
      console.error('[attachments] download error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to download attachment' });
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

      if (fs.existsSync(attachment.filePath)) {
        fs.unlinkSync(attachment.filePath);
      }

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
