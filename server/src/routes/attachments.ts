import express, { Response, NextFunction } from 'express';
import multer from 'multer';
import { authorize, AuthRequest } from '../middleware/auth.js';
import prisma from '../db.js';
import { isAllowedFileSignature } from '../utils/fileSignature.js';
import { isInlinePreviewable } from '../utils/filePreview.js';
import { validateAndGetClinicIdScope } from '../utils/clinicScope.js';
import { writeAuditLog, extractRequestMeta } from '../utils/auditLog.js';
import {
  buildStorageKey,
  deleteFile,
  fileNameFromKey,
  openFileStream,
  saveFile,
} from '../services/fileStorage.js';

const router = express.Router();

// ── KVKK legal-hold response redaction (docs/compliance/53) ───────────
// legalHold (boolean) is safe for every clinical role that can see the
// attachment; legalHoldReason is a free-text justification and must only
// ever reach OWNER/ORG_ADMIN, mirroring the OWNER/ORG_ADMIN-only authorize
// gate on the legal-hold PATCH route itself.
export function roleCanSeeLegalHoldReason(role: string): boolean {
  return role === 'OWNER' || role === 'ORG_ADMIN';
}

function canSeeLegalHoldReason(req: AuthRequest): boolean {
  return roleCanSeeLegalHoldReason(req.user!.role);
}

export function redactLegalHoldReason<T extends { legalHoldReason?: string | null }>(row: T, allowed: boolean): T {
  if (allowed) return row;
  return { ...row, legalHoldReason: null };
}

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

/**
 * Per-file attachment upload limit — also reused as the per-file bound for
 * KVKK export packages (services/privacy/patientPrivacyExportPackage.ts) so
 * the two limits never drift apart.
 */
export const ATTACHMENT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// Dosya bellekte tutulur (10 MB sınırıyla) ve doğrulama sonrası fileStorage'a
// yazılır: yerel disk veya S3_BUCKET tanımlıysa S3-uyumlu depo
// (docs/45 Faz 3 #11). Diske geçici dosya hiç yazılmaz.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ATTACHMENT_MAX_FILE_SIZE_BYTES },
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

      res.status(201).json(redactLegalHoldReason(attachment, canSeeLegalHoldReason(req)));
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
      const canSeeReason = canSeeLegalHoldReason(req);
      res.json(attachments.map((a) => redactLegalHoldReason(a, canSeeReason)));
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
// PatientAttachment. Restricted to OWNER/ORG_ADMIN — legal hold blocks
// anonymization metadata redaction for this row. There is no live-delete
// endpoint in this PR at all (see routes/patientPrivacy.ts). Requires a
// reason (min 3 chars) both to place AND to release a hold, and writes an
// audit log entry for both directions.
router.patch(
  '/patients/:patientId/attachments/:id/legal-hold',
  authorize(['OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    const patientId = String(req.params.patientId);
    const id = String(req.params.id);
    const { legalHold, reason } = req.body as { legalHold?: boolean; reason?: string };

    if (typeof legalHold !== 'boolean') {
      return res.status(400).json({ error: 'legalHold must be a boolean' });
    }
    // A reason is required for BOTH placing AND releasing a hold — releasing
    // is just as consequential (it re-opens the row to anonymization
    // redaction) and must be justified/audited the same way.
    if (!reason || String(reason).trim().length < 3) {
      return res.status(400).json({
        error: `A reason is required (min 3 characters) to ${legalHold ? 'place' : 'release'} a legal hold.`,
      });
    }

    try {
      // Resolve the patient's clinic through the org/branch-scoped helper
      // (validateAndGetClinicIdScope) rather than trusting req.user.clinicId
      // directly — mirrors imaging.ts's findStudyInScope so OWNER/ORG_ADMIN
      // users with multi-branch access are scoped correctly.
      const scope = await validateAndGetClinicIdScope(req.user!, undefined, res);
      if (scope === false) return;

      const attachment = await prisma.patientAttachment.findFirst({
        where: { id, patientId, ...scope },
      });
      if (!attachment) return res.status(404).json({ error: 'Not found' });

      const previousLegalHold = attachment.legalHold;
      const trimmedReason = String(reason).trim().slice(0, 500);

      const updated = await prisma.patientAttachment.update({
        where: { id },
        data: {
          legalHold,
          legalHoldReason: trimmedReason,
        },
        select: { id: true, legalHold: true, legalHoldReason: true },
      });

      await writeAuditLog({
        organizationId: req.user!.organizationId,
        clinicId: attachment.clinicId,
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        action: legalHold ? 'patient_attachment_legal_hold_set' : 'patient_attachment_legal_hold_released',
        entityType: 'patient_attachment',
        entityId: id,
        // Do not put the free-text reason into the audit log — it is
        // retained on the PatientAttachment row itself (legalHoldReason);
        // the audit trail only needs the before/after state, not the
        // justification text (docs/compliance/53 P1 — no PII in audit log).
        description: `Patient attachment legal hold ${legalHold ? 'set' : 'released'}`,
        metadata: { patientId, previousLegalHold, newLegalHold: legalHold },
        ...extractRequestMeta(req),
      });

      res.json(redactLegalHoldReason(updated, canSeeLegalHoldReason(req)));
    } catch (err: any) {
      console.error('[attachments] legal-hold error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to update legal hold' });
    }
  },
);

// ── DELETE /api/patients/:patientId/attachments/:id ───────────────────
// KVKK lifecycle (docs/compliance/53): a legalHold=true attachment can never
// be deleted through this route — this is the ONLY attachment-delete path in
// the codebase (verified: no other route/service calls
// prisma.patientAttachment.delete or deleteFile() on a PatientAttachment
// row).
//
// Atomicity (closes a TOCTOU window): the authorization decision is made by
// a single conditional `deleteMany` whose WHERE clause includes
// `legalHold: false`, not by a separate read-then-delete. Postgres evaluates
// that WHERE clause and performs the row delete within one statement, so a
// concurrent legal-hold PATCH either (a) commits first and the row no
// longer matches `legalHold: false` → deleteMany affects 0 rows, nothing is
// deleted, or (b) the delete commits first and the row is gone, so the
// concurrent PATCH's `update` (single-row, by id) subsequently fails to find
// it. There is never a window where a row with legalHold=true (committed) is
// still deleted. Physical storage deletion only ever runs after the DB
// delete has been confirmed to have affected exactly one row.
//
// Scope: resolved via validateAndGetClinicIdScope (the established
// multi-branch clinic-scope helper — see PATCH legal-hold above and
// imaging.ts's findStudyInScope) rather than req.user.clinicId, so
// OWNER/ORG_ADMIN acting on an authorized non-default clinic are scoped
// correctly and cross-clinic/cross-org access is rejected.
router.delete(
  '/patients/:patientId/attachments/:id',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const patientId = String(req.params.patientId);
    const id = String(req.params.id);

    try {
      const scope = await validateAndGetClinicIdScope(req.user!, undefined, res);
      if (scope === false) return;

      // Pre-read for metadata only (originalName/filePath for storage cleanup
      // + activity log) — NOT the authorization decision. The decision is the
      // atomic deleteMany below, so a hold placed after this read still
      // blocks the delete.
      const attachment = await prisma.patientAttachment.findFirst({
        where: { id, patientId, ...scope },
      });
      if (!attachment) return res.status(404).json({ error: 'Not found' });

      const result = await prisma.patientAttachment.deleteMany({
        where: { id, patientId, ...scope, legalHold: false },
      });

      if (result.count === 0) {
        // Either a concurrent hold committed after our read (TOCTOU window,
        // now closed), or the row already carried legalHold=true. Re-read,
        // scoped, to report the correct outcome.
        const stillThere = await prisma.patientAttachment.findFirst({
          where: { id, patientId, ...scope },
        });
        if (!stillThere) return res.status(404).json({ error: 'Not found' });

        const canSeeReason = canSeeLegalHoldReason(req);
        await writeAuditLog({
          organizationId: req.user!.organizationId,
          clinicId: stillThere.clinicId,
          actorUserId: req.user!.id,
          actorRole: req.user!.role,
          action: 'patient_attachment_delete_blocked_legal_hold',
          entityType: 'patient_attachment',
          entityId: id,
          // No filename/reason in the audit trail — entityId + patientId are
          // sufficient references (docs/compliance/53 P1 — no PII in audit log).
          description: 'Attachment deletion rejected — under legal hold',
          metadata: { patientId },
          ...extractRequestMeta(req),
        });
        return res.status(409).json({
          error: 'ATTACHMENT_LEGAL_HOLD',
          message: 'This attachment is under legal hold and cannot be deleted.',
          ...(canSeeReason ? { legalHoldReason: stillThere.legalHoldReason } : {}),
        });
      }

      // The DB row is confirmed gone (deleted while legalHold=false) — safe
      // to remove the physical file using the pre-read metadata.
      await deleteFile(attachment.filePath).catch((deleteErr) => {
        // DB kaydı silindi; depo silme hatası indirmeyi bozmaz, logla ve devam et.
        console.error('[attachments] storage delete error:', deleteErr?.message ?? deleteErr);
      });

      await prisma.activityLog.create({
        data: {
          clinicId: attachment.clinicId,
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
