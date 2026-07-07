/**
 * imaging.ts — Görüntüleme/cihaz entegrasyonu temeli (Phase 1).
 *
 * Kapsam: cihaz kaydı (registry), çekim istemleri (ImagingRequest), manuel
 * görüntü yükleme/içe aktarma, hasta/randevu/vaka bağlama, bağlanmamış
 * kuyruğu ve kimlik doğrulamalı stream ile önizleme/indirme.
 *
 * Güvenlik ilkeleri:
 *  - BILLING ve ASSISTANT rolleri klinik görüntülere HİÇBİR endpoint'te
 *    erişemez (attachments.ts emsali).
 *  - Görüntü dosyaları için asla public URL üretilmez; erişim yalnızca bu
 *    dosyadaki authorize + klinik kapsamı arkasındaki stream'lerden olur.
 *  - Orijinal görüntüler değişmezdir: binary güncelleme/değiştirme endpoint'i
 *    yok; arşivleme yalnızca status alanını değiştirir, hard-delete yok.
 *  - Audit/activity metadata'sında hasta kimliği taşıyan görüntü meta verisi
 *    (dosya adı, DICOM hasta etiketleri vb.) ASLA loglanmaz — yalnızca ID,
 *    modality ve sayaçlar yazılır.
 *  - DICOM doğrulaması bilinçli olarak dar: yalnızca Part-10 (offset 128'de
 *    DICM). Daha geniş DICOM desteği köprü (bridge) fazının işidir.
 */

import express, { Response, NextFunction } from 'express';
import multer from 'multer';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { isAllowedFileSignature } from '../utils/fileSignature.js';
import { isInlinePreviewable } from '../utils/filePreview.js';
import { buildStorageKey, deleteFile, fileNameFromKey, openFileStream, saveFile } from '../services/fileStorage.js';
import { getParam } from '../utils/helpers.js';
import { logActivity } from '../utils/activity.js';
import { writeAuditLog } from '../utils/auditLog.js';
import { validateAndGetClinicIdScope, resolveEffectiveClinicId } from '../utils/clinicScope.js';
import { findPatientInClinic, findAppointmentInClinic, findTreatmentCaseInClinic } from '../utils/relationGuards.js';
import {
  imagingDeviceSchema,
  imagingDeviceUpdateSchema,
  imagingRequestSchema,
  imagingRequestUpdateSchema,
  imagingStudyUploadSchema,
  imagingStudyLinkSchema,
  imagingBridgeSchema,
} from '../schemas/index.js';
import { generateBridgeToken } from '../services/imaging/bridgeTokens.js';
import {
  validateRequestTransition,
  canAttachStudyToRequest,
  type ImagingRequestStatus,
} from '../services/imaging/imagingRequestTransitions.js';
import {
  IMAGING_ALLOWED_MIME,
  IMAGING_EXTENSIONS_BY_MIME,
  MAX_FILE_MB,
  normalizeDeclaredMime,
} from '../services/imaging/imagingUploadValidation.js';

const router = express.Router();

// Klinik görüntüler tıbbi kayıttır: BILLING ve ASSISTANT hiçbir listede yok.
const IMAGING_CLINICAL_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST'] as const;
const IMAGING_MANAGE_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER'] as const;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (IMAGING_ALLOWED_MIME.has(normalizeDeclaredMime(file.mimetype, file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  },
});

function handleUpload(req: AuthRequest, res: Response, next: NextFunction) {
  upload.single('file')(req as any, res as any, (err: any) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `Dosya ${MAX_FILE_MB} MB sınırını aşıyor` });
      }
      return res.status(400).json({ error: 'Dosya yüklenemedi', detail: err.message });
    }
    if (err?.message === 'File type not allowed') {
      return res.status(400).json({ error: 'Dosya türüne izin verilmiyor' });
    }
    console.error('[imaging] upload middleware error:', err?.message ?? err);
    return res.status(500).json({ error: 'Yükleme başlatılamadı' });
  });
}

// ── Ortak yardımcılar ──────────────────────────────────────────────────

/** Audit girdisi — metadata yalnızca ID/modality/sayaç içerebilir, PII asla. */
async function auditImaging(
  req: AuthRequest,
  clinicId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: Record<string, unknown>,
) {
  await writeAuditLog({
    organizationId: req.user!.organizationId,
    clinicId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action,
    entityType,
    entityId,
    metadata: metadata ?? null,
  });
}

const studyImageSelect = {
  id: true,
  originalName: true,
  fileSize: true,
  mimeType: true,
  sopInstanceUid: true,
  createdAt: true,
};

const studyInclude = {
  images: { select: studyImageSelect, orderBy: { createdAt: 'asc' as const } },
  device: { select: { id: true, name: true, modality: true } },
  patient: { select: { id: true, firstName: true, lastName: true } },
  appointment: { select: { id: true, startTime: true } },
  treatmentCase: { select: { id: true, title: true } },
  imagingRequest: { select: { id: true, status: true, requestedModality: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
};

/**
 * Kullanıcının erişebildiği klinikler içinde çalışmayı bulur; bulunamazsa
 * yanıtı kendisi gönderir ve null döner.
 */
async function findStudyInScope(req: AuthRequest, res: Response, id: string) {
  const scope = await validateAndGetClinicIdScope(req.user!, undefined, res);
  if (scope === false) return null;
  const study = await prisma.imagingStudy.findFirst({ where: { id, ...scope }, include: studyInclude });
  if (!study) {
    res.status(404).json({ error: 'Imaging study not found' });
    return null;
  }
  return study;
}

async function findRequestInScope(req: AuthRequest, res: Response, id: string) {
  const scope = await validateAndGetClinicIdScope(req.user!, undefined, res);
  if (scope === false) return null;
  const request = await prisma.imagingRequest.findFirst({ where: { id, ...scope } });
  if (!request) {
    res.status(404).json({ error: 'Imaging request not found' });
    return null;
  }
  return request;
}

/**
 * Hasta/randevu/vaka/cihaz ID'lerinin verilen kliniğe ait ve tutarlı olduğunu
 * doğrular. Hata durumunda yanıtı gönderir ve false döner.
 */
async function validateClinicalLinks(
  res: Response,
  clinicId: string,
  links: {
    patientId?: string | null;
    appointmentId?: string | null;
    treatmentCaseId?: string | null;
    deviceId?: string | null;
  },
): Promise<boolean> {
  const { patientId, appointmentId, treatmentCaseId, deviceId } = links;

  if (!patientId && (appointmentId || treatmentCaseId)) {
    res.status(400).json({ error: 'Randevu/vaka bağlantısı için hasta gereklidir' });
    return false;
  }
  if (patientId) {
    const patient = await findPatientInClinic(patientId, clinicId);
    if (!patient) {
      res.status(404).json({ error: 'Patient not found' });
      return false;
    }
  }
  if (appointmentId) {
    const appointment = await findAppointmentInClinic(appointmentId, clinicId, patientId);
    if (!appointment) {
      res.status(404).json({ error: 'Appointment not found for this patient/clinic' });
      return false;
    }
  }
  if (treatmentCaseId) {
    const treatmentCase = await findTreatmentCaseInClinic(treatmentCaseId, clinicId, patientId);
    if (!treatmentCase) {
      res.status(404).json({ error: 'Treatment case not found for this patient/clinic' });
      return false;
    }
  }
  if (deviceId) {
    const device = await prisma.imagingDevice.findFirst({ where: { id: deviceId, clinicId, isActive: true } });
    if (!device) {
      res.status(404).json({ error: 'Imaging device not found' });
      return false;
    }
  }
  return true;
}

// ═══ Cihazlar (Imaging Devices) ════════════════════════════════════════

// GET /api/imaging/devices
router.get('/imaging/devices', authorize([...IMAGING_CLINICAL_ROLES]), async (req: AuthRequest, res: Response) => {
  try {
    const scope = await validateAndGetClinicIdScope(req.user!, req.query.clinicId as string | undefined, res);
    if (scope === false) return;

    const where: any = { ...scope };
    if (req.query.onlyActive === 'true') where.isActive = true;

    const devices = await prisma.imagingDevice.findMany({
      where,
      include: { _count: { select: { imagingStudies: true, imagingRequests: true } } },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    res.json(devices.map(d => ({
      ...d,
      canDelete: d._count.imagingStudies === 0 && d._count.imagingRequests === 0,
    })));
  } catch {
    res.status(500).json({ error: 'Failed to fetch imaging devices' });
  }
});

// POST /api/imaging/devices
router.post('/imaging/devices', authorize([...IMAGING_MANAGE_ROLES]), async (req: AuthRequest, res: Response) => {
  const validation = imagingDeviceSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  const clinicId = await resolveEffectiveClinicId(req.user!, validation.data.clinicId ?? (req.query.clinicId as string | undefined));
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

  try {
    const { clinicId: _ignored, ...data } = validation.data;
    const device = await prisma.imagingDevice.create({
      data: { ...data, clinicId, createdById: req.user!.id },
    });

    await auditImaging(req, clinicId, 'imaging_device_created', 'imaging_device', device.id, {
      modality: device.modality,
      connectionType: device.connectionType,
    });

    res.status(201).json(device);
  } catch {
    res.status(500).json({ error: 'Failed to create imaging device' });
  }
});

// PUT /api/imaging/devices/:id
router.put('/imaging/devices/:id', authorize([...IMAGING_MANAGE_ROLES]), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const validation = imagingDeviceUpdateSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, undefined, res);
    if (scope === false) return;

    const existing = await prisma.imagingDevice.findFirst({ where: { id, ...scope } });
    if (!existing) return res.status(404).json({ error: 'Imaging device not found' });

    const device = await prisma.imagingDevice.update({ where: { id }, data: validation.data });

    await auditImaging(req, existing.clinicId, 'imaging_device_updated', 'imaging_device', id, {
      modality: device.modality,
      isActive: device.isActive,
    });

    res.json(device);
  } catch {
    res.status(500).json({ error: 'Failed to update imaging device' });
  }
});

// DELETE /api/imaging/devices/:id — yalnızca hiç kullanılmamış cihazlar kalıcı
// olarak silinir; herhangi bir çalışma/istem referansı varsa 409 döner
// (kullanıcı bunun yerine pasifleştirmelidir). Uygunluk kontrolü + silme aynı
// transaction içinde yapılır (yarışa dayanıklı).
router.delete('/imaging/devices/:id', authorize([...IMAGING_MANAGE_ROLES]), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, undefined, res);
    if (scope === false) return;

    const existing = await prisma.imagingDevice.findFirst({ where: { id, ...scope } });
    if (!existing) return res.status(404).json({ error: 'Imaging device not found' });

    const result = await prisma.$transaction(async (tx) => {
      const [studyCount, requestCount] = await Promise.all([
        tx.imagingStudy.count({ where: { deviceId: id } }),
        tx.imagingRequest.count({ where: { requestedDeviceId: id } }),
      ]);
      if (studyCount + requestCount > 0) {
        return { blocked: true as const, studyCount, requestCount };
      }
      await tx.imagingDevice.delete({ where: { id } });
      return { blocked: false as const };
    });

    if (result.blocked) {
      return res.status(409).json({
        error: 'Imaging device is in use',
        code: 'IMAGING_DEVICE_IN_USE',
        usage: { studyCount: result.studyCount, requestCount: result.requestCount },
      });
    }

    await auditImaging(req, existing.clinicId, 'imaging_device_deleted', 'imaging_device', id, {
      name: existing.name,
    });
    res.status(200).json({ deleted: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete imaging device' });
  }
});

// ═══ Çekim istemleri (Imaging Requests) ════════════════════════════════

const requestInclude = {
  patient: { select: { id: true, firstName: true, lastName: true } },
  requestedDevice: { select: { id: true, name: true, modality: true } },
  requestedBy: { select: { id: true, firstName: true, lastName: true } },
  appointment: { select: { id: true, startTime: true } },
  treatmentCase: { select: { id: true, title: true } },
};

// GET /api/imaging/requests
router.get('/imaging/requests', authorize([...IMAGING_CLINICAL_ROLES]), async (req: AuthRequest, res: Response) => {
  try {
    const scope = await validateAndGetClinicIdScope(req.user!, req.query.clinicId as string | undefined, res);
    if (scope === false) return;

    const where: any = { ...scope };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.patientId) where.patientId = String(req.query.patientId);

    const requests = await prisma.imagingRequest.findMany({
      where,
      include: requestInclude,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    res.json(requests);
  } catch {
    res.status(500).json({ error: 'Failed to fetch imaging requests' });
  }
});

// POST /api/imaging/requests
router.post('/imaging/requests', authorize([...IMAGING_CLINICAL_ROLES]), async (req: AuthRequest, res: Response) => {
  const validation = imagingRequestSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  const clinicId = await resolveEffectiveClinicId(req.user!, validation.data.clinicId ?? (req.query.clinicId as string | undefined));
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

  const { clinicId: _ignored, requestedDeviceId, ...data } = validation.data;

  try {
    const linksOk = await validateClinicalLinks(res, clinicId, {
      patientId: data.patientId,
      appointmentId: data.appointmentId,
      treatmentCaseId: data.treatmentCaseId,
      deviceId: requestedDeviceId,
    });
    if (!linksOk) return;

    const request = await prisma.imagingRequest.create({
      data: {
        ...data,
        requestedDeviceId: requestedDeviceId ?? null,
        clinicId,
        status: 'requested',
        requestedByUserId: req.user!.id,
      },
      include: requestInclude,
    });

    await auditImaging(req, clinicId, 'imaging_request_created', 'imaging_request', request.id, {
      modality: request.requestedModality,
      priority: request.priority,
    });
    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'imaging_request',
      entityId: request.id,
      action: 'create',
      patientId: request.patientId,
      appointmentId: request.appointmentId,
      treatmentCaseId: request.treatmentCaseId,
      description: `Görüntüleme istemi oluşturuldu (${request.requestedModality})`,
    });

    res.status(201).json(request);
  } catch {
    res.status(500).json({ error: 'Failed to create imaging request' });
  }
});

// PATCH /api/imaging/requests/:id
router.patch('/imaging/requests/:id', authorize([...IMAGING_CLINICAL_ROLES]), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const validation = imagingRequestUpdateSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const existing = await findRequestInScope(req, res, id);
    if (!existing) return;

    const data = validation.data;

    if (data.status && data.status !== existing.status) {
      const transition = validateRequestTransition(existing.status as ImagingRequestStatus, data.status);
      if (!transition.ok) return res.status(409).json({ error: transition.message, code: transition.code });
    }

    const linksOk = await validateClinicalLinks(res, existing.clinicId, {
      patientId: existing.patientId,
      appointmentId: data.appointmentId,
      treatmentCaseId: data.treatmentCaseId,
      deviceId: data.requestedDeviceId,
    });
    if (!linksOk) return;

    const request = await prisma.imagingRequest.update({
      where: { id },
      data,
      include: requestInclude,
    });

    await auditImaging(req, existing.clinicId, 'imaging_request_updated', 'imaging_request', id, {
      fromStatus: existing.status,
      toStatus: request.status,
      modality: request.requestedModality,
    });

    res.json(request);
  } catch {
    res.status(500).json({ error: 'Failed to update imaging request' });
  }
});

// PATCH /api/imaging/requests/:id/cancel
router.patch('/imaging/requests/:id/cancel', authorize([...IMAGING_CLINICAL_ROLES]), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  try {
    const existing = await findRequestInScope(req, res, id);
    if (!existing) return;

    const transition = validateRequestTransition(existing.status as ImagingRequestStatus, 'cancelled');
    if (!transition.ok) return res.status(409).json({ error: transition.message, code: transition.code });

    const request = await prisma.imagingRequest.update({
      where: { id },
      data: { status: 'cancelled' },
      include: requestInclude,
    });

    await auditImaging(req, existing.clinicId, 'imaging_request_cancelled', 'imaging_request', id, {
      fromStatus: existing.status,
    });

    res.json(request);
  } catch {
    res.status(500).json({ error: 'Failed to cancel imaging request' });
  }
});

// ═══ Çalışmalar (Imaging Studies) ══════════════════════════════════════

// POST /api/imaging/studies — manuel yükleme/içe aktarma (tek dosya).
router.post('/imaging/studies', authorize([...IMAGING_CLINICAL_ROLES]), handleUpload, async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    return res.status(400).json({
      error: 'Dosya alınamadı',
      detail: 'İstek Content-Type başlığında boundary eksik olabilir',
    });
  }

  const validation = imagingStudyUploadSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  const clinicId = await resolveEffectiveClinicId(req.user!, validation.data.clinicId ?? (req.query.clinicId as string | undefined));
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

  const v = validation.data;
  let storageKey: string | null = null;

  try {
    // İstem bağlantısı: yalnızca açık (requested/scheduled) istemler kabul eder;
    // hasta/randevu/vaka bağlantıları verilmemişse istemden devralınır.
    let request = null as Awaited<ReturnType<typeof prisma.imagingRequest.findFirst>> | null;
    let patientId = v.patientId ?? null;
    let appointmentId = v.appointmentId ?? null;
    let treatmentCaseId = v.treatmentCaseId ?? null;

    if (v.imagingRequestId) {
      request = await prisma.imagingRequest.findFirst({ where: { id: v.imagingRequestId, clinicId } });
      if (!request) return res.status(404).json({ error: 'Imaging request not found' });
      if (!canAttachStudyToRequest(request.status as ImagingRequestStatus)) {
        return res.status(409).json({ error: 'Imaging request is not open for new studies' });
      }
      if (patientId && patientId !== request.patientId) {
        return res.status(400).json({ error: 'Patient does not match the imaging request' });
      }
      patientId = patientId ?? request.patientId;
      appointmentId = appointmentId ?? request.appointmentId;
      treatmentCaseId = treatmentCaseId ?? request.treatmentCaseId;
    }

    const linksOk = await validateClinicalLinks(res, clinicId, {
      patientId, appointmentId, treatmentCaseId, deviceId: v.deviceId,
    });
    if (!linksOk) return;

    const effectiveMime = normalizeDeclaredMime(req.file.mimetype, req.file.originalname);
    if (!isAllowedFileSignature(req.file.buffer, effectiveMime, req.file.originalname, IMAGING_EXTENSIONS_BY_MIME)) {
      return res.status(400).json({
        error: 'Dosya içeriği doğrulanamadı',
        detail: 'Dosya uzantısı, MIME tipi veya dosya imzası desteklenen türlerle eşleşmiyor',
      });
    }

    storageKey = buildStorageKey(clinicId, req.file.originalname);
    await saveFile(storageKey, req.file.buffer, effectiveMime);

    const study = await prisma.$transaction(async (tx) => {
      const created = await tx.imagingStudy.create({
        data: {
          clinicId,
          patientId,
          appointmentId,
          treatmentCaseId,
          deviceId: v.deviceId ?? null,
          imagingRequestId: request?.id ?? null,
          modality: v.modality,
          studyDate: v.studyDate ?? new Date(),
          description: v.description ?? null,
          source: 'manual_upload',
          status: 'active',
          createdById: req.user!.id,
        },
      });

      await tx.imagingImage.create({
        data: {
          clinicId,
          studyId: created.id,
          fileName: fileNameFromKey(storageKey!),
          originalName: req.file!.originalname,
          fileSize: req.file!.size,
          mimeType: effectiveMime,
          filePath: storageKey!,
        },
      });

      if (request) {
        // Yarışa dayanıklı: durum hâlâ açıksa 'received'a geçir, değilse iptal et.
        const updated = await tx.imagingRequest.updateMany({
          where: { id: request.id, clinicId, status: { in: ['requested', 'scheduled'] } },
          data: { status: 'received' },
        });
        if (updated.count === 0) {
          throw Object.assign(new Error('Imaging request is not open for new studies'), { statusCode: 409 });
        }
      }

      return created;
    });

    const full = await prisma.imagingStudy.findUnique({ where: { id: study.id }, include: studyInclude });

    await auditImaging(req, clinicId, 'imaging_study_uploaded', 'imaging_study', study.id, {
      modality: v.modality,
      fileSize: req.file.size,
      mimeType: effectiveMime,
      imagingRequestId: request?.id ?? null,
      linked: Boolean(patientId),
    });
    if (patientId) {
      await logActivity({
        clinicId,
        userId: req.user!.id,
        entityType: 'imaging_study',
        entityId: study.id,
        action: 'create',
        patientId,
        appointmentId,
        treatmentCaseId,
        description: `Görüntüleme çalışması yüklendi (${v.modality})`,
      });
    }

    res.status(201).json(full);
  } catch (err: any) {
    // Depoya yazıldıktan sonra DB işlemi başarısız olduysa dosyayı geri sil.
    if (storageKey) await deleteFile(storageKey).catch(() => {});
    if (err?.statusCode === 409) return res.status(409).json({ error: err.message });
    console.error('[imaging] upload error:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to upload imaging study' });
  }
});

// GET /api/imaging/unlinked — bağlanmamış kuyruğu.
router.get('/imaging/unlinked', authorize([...IMAGING_CLINICAL_ROLES]), async (req: AuthRequest, res: Response) => {
  try {
    const scope = await validateAndGetClinicIdScope(req.user!, req.query.clinicId as string | undefined, res);
    if (scope === false) return;

    const studies = await prisma.imagingStudy.findMany({
      where: { ...scope, patientId: null, status: 'active' },
      include: studyInclude,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    res.json(studies);
  } catch {
    res.status(500).json({ error: 'Failed to fetch unlinked imaging studies' });
  }
});

// GET /api/patients/:patientId/imaging — hasta görüntüleme listesi.
router.get('/patients/:patientId/imaging', authorize([...IMAGING_CLINICAL_ROLES]), async (req: AuthRequest, res: Response) => {
  const patientId = getParam(req, 'patientId');

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, req.query.clinicId as string | undefined, res);
    if (scope === false) return;

    const patient = await prisma.patient.findFirst({ where: { id: patientId, deletedAt: null, ...scope }, select: { id: true } });
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const where: any = { patientId, ...scope };
    if (req.query.includeArchived !== 'true') where.status = 'active';

    const studies = await prisma.imagingStudy.findMany({
      where,
      include: studyInclude,
      orderBy: { studyDate: 'desc' },
    });
    res.json(studies);
  } catch {
    res.status(500).json({ error: 'Failed to fetch patient imaging' });
  }
});

// GET /api/imaging/studies/:id
router.get('/imaging/studies/:id', authorize([...IMAGING_CLINICAL_ROLES]), async (req: AuthRequest, res: Response) => {
  try {
    const study = await findStudyInScope(req, res, getParam(req, 'id'));
    if (!study) return;
    res.json(study);
  } catch {
    res.status(500).json({ error: 'Failed to fetch imaging study' });
  }
});

// ── Görüntü stream'leri (asla public URL yok; her erişim audit'lenir) ──

async function streamStudyImage(req: AuthRequest, res: Response, mode: 'preview' | 'download') {
  const studyId = getParam(req, 'id');
  const imageId = getParam(req, 'imageId');

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, undefined, res);
    if (scope === false) return;

    const image = await prisma.imagingImage.findFirst({
      where: { id: imageId, studyId, study: { ...scope } },
    });
    if (!image) return res.status(404).json({ error: 'Imaging image not found' });

    if (mode === 'preview' && !isInlinePreviewable(image.mimeType)) {
      return res.status(415).json({ error: 'Bu dosya türü tarayıcıda önizlenemez; indirerek görüntüleyin' });
    }

    const stream = await openFileStream(image.filePath);
    if (!stream) return res.status(404).json({ error: 'File not found in storage' });

    await auditImaging(req, image.clinicId, 'imaging_study_viewed', 'imaging_study', studyId, {
      imageId,
      mode,
    });

    const disposition = mode === 'preview' ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(image.originalName)}"`);
    res.setHeader('Content-Type', image.mimeType);
    res.setHeader('Content-Length', String(image.fileSize));
    stream.on('error', (streamErr: any) => {
      console.error(`[imaging] ${mode} stream error:`, streamErr?.message ?? streamErr);
      if (!res.headersSent) res.status(500).json({ error: `Failed to ${mode} imaging image` });
      else res.destroy();
    });
    stream.pipe(res as any);
  } catch {
    if (!res.headersSent) res.status(500).json({ error: `Failed to ${mode} imaging image` });
  }
}

// GET /api/imaging/studies/:id/images/:imageId/preview
router.get('/imaging/studies/:id/images/:imageId/preview', authorize([...IMAGING_CLINICAL_ROLES]), (req: AuthRequest, res: Response) =>
  streamStudyImage(req, res, 'preview'));

// GET /api/imaging/studies/:id/images/:imageId/download
router.get('/imaging/studies/:id/images/:imageId/download', authorize([...IMAGING_CLINICAL_ROLES]), (req: AuthRequest, res: Response) =>
  streamStudyImage(req, res, 'download'));

// ── Bağlama / arşivleme ────────────────────────────────────────────────

// PATCH /api/imaging/studies/:id/link — hasta (+ opsiyonel randevu/vaka) bağlar;
// önceki randevu/vaka bağlantılarını verilenlerle DEĞİŞTİRİR.
router.patch('/imaging/studies/:id/link', authorize([...IMAGING_CLINICAL_ROLES]), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const validation = imagingStudyLinkSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const study = await findStudyInScope(req, res, id);
    if (!study) return;

    const { patientId, appointmentId, treatmentCaseId } = validation.data;
    const linksOk = await validateClinicalLinks(res, study.clinicId, {
      patientId,
      appointmentId: appointmentId ?? null,
      treatmentCaseId: treatmentCaseId ?? null,
    });
    if (!linksOk) return;

    const updated = await prisma.imagingStudy.update({
      where: { id },
      data: {
        patientId,
        appointmentId: appointmentId ?? null,
        treatmentCaseId: treatmentCaseId ?? null,
      },
      include: studyInclude,
    });

    await auditImaging(req, study.clinicId, 'imaging_study_linked', 'imaging_study', id, {
      previousPatientId: study.patientId,
      modality: study.modality,
    });
    await logActivity({
      clinicId: study.clinicId,
      userId: req.user!.id,
      entityType: 'imaging_study',
      entityId: id,
      action: 'link',
      patientId,
      appointmentId: appointmentId ?? null,
      treatmentCaseId: treatmentCaseId ?? null,
      description: `Görüntüleme çalışması hastaya bağlandı (${study.modality})`,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to link imaging study' });
  }
});

// PATCH /api/imaging/studies/:id/unlink — tüm klinik bağlantılarını kaldırıp
// çalışmayı bağlanmamış kuyruğuna geri koyar. Not: 'received' olmuş bir istem
// geri açılmaz (Phase 1 sınırlaması — istem geçmişi denetim izi olarak kalır).
router.patch('/imaging/studies/:id/unlink', authorize([...IMAGING_CLINICAL_ROLES]), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  try {
    const study = await findStudyInScope(req, res, id);
    if (!study) return;

    const updated = await prisma.imagingStudy.update({
      where: { id },
      data: { patientId: null, appointmentId: null, treatmentCaseId: null, imagingRequestId: null },
      include: studyInclude,
    });

    await auditImaging(req, study.clinicId, 'imaging_study_unlinked', 'imaging_study', id, {
      previousPatientId: study.patientId,
      modality: study.modality,
    });
    if (study.patientId) {
      await logActivity({
        clinicId: study.clinicId,
        userId: req.user!.id,
        entityType: 'imaging_study',
        entityId: id,
        action: 'unlink',
        patientId: study.patientId,
        description: `Görüntüleme çalışması hasta bağlantısından ayrıldı (${study.modality})`,
      });
    }

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to unlink imaging study' });
  }
});

async function setStudyStatus(req: AuthRequest, res: Response, status: 'active' | 'archived') {
  const id = getParam(req, 'id');

  try {
    const study = await findStudyInScope(req, res, id);
    if (!study) return;
    if (study.status === status) return res.json(study);

    const updated = await prisma.imagingStudy.update({ where: { id }, data: { status }, include: studyInclude });

    await auditImaging(req, study.clinicId, status === 'archived' ? 'imaging_study_archived' : 'imaging_study_unarchived', 'imaging_study', id, {
      modality: study.modality,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update imaging study status' });
  }
}

// PATCH /api/imaging/studies/:id/archive — orijinal dosyaya dokunmaz.
router.patch('/imaging/studies/:id/archive', authorize([...IMAGING_CLINICAL_ROLES]), (req: AuthRequest, res: Response) =>
  setStudyStatus(req, res, 'archived'));

// PATCH /api/imaging/studies/:id/unarchive
router.patch('/imaging/studies/:id/unarchive', authorize([...IMAGING_CLINICAL_ROLES]), (req: AuthRequest, res: Response) =>
  setStudyStatus(req, res, 'active'));

// ═══ Köprü ajanları (Bridge Agents) ════════════════════════════════════
// Yalnızca kayıt/listeleme/iptal (Phase 2 sözleşmesi). Heartbeat public
// endpoint'i routes/imagingBridgePublic.ts dosyasındadır; köprüden görüntü
// yükleme bilinçli olarak İLERİDE — bkz. docs/47-imaging-bridge-contract.md.
// tokenHash hiçbir API yanıtında yer almaz; düz metin token yalnızca
// oluşturma yanıtında bir kez döner ve asla saklanmaz/loglanmaz.

const bridgeAgentSelect = {
  id: true,
  clinicId: true,
  name: true,
  status: true,
  lastSeenAt: true,
  agentVersion: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, firstName: true, lastName: true } },
};

// GET /api/imaging/bridges
router.get('/imaging/bridges', authorize([...IMAGING_MANAGE_ROLES]), async (req: AuthRequest, res: Response) => {
  try {
    const scope = await validateAndGetClinicIdScope(req.user!, req.query.clinicId as string | undefined, res);
    if (scope === false) return;

    const bridges = await prisma.imagingBridgeAgent.findMany({
      where: { ...scope },
      select: { ...bridgeAgentSelect, _count: { select: { imagingStudies: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(bridges.map(({ _count, ...b }) => ({
      ...b,
      hasConnected: b.lastSeenAt !== null || _count.imagingStudies > 0,
      canDelete: b.lastSeenAt === null && _count.imagingStudies === 0,
    })));
  } catch {
    res.status(500).json({ error: 'Failed to fetch bridge agents' });
  }
});

// POST /api/imaging/bridges — düz metin token YALNIZCA bu yanıtta döner.
router.post('/imaging/bridges', authorize([...IMAGING_MANAGE_ROLES]), async (req: AuthRequest, res: Response) => {
  const validation = imagingBridgeSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  const clinicId = await resolveEffectiveClinicId(req.user!, validation.data.clinicId ?? (req.query.clinicId as string | undefined));
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

  try {
    const { token, tokenHash } = generateBridgeToken();
    const agent = await prisma.imagingBridgeAgent.create({
      data: { clinicId, name: validation.data.name, tokenHash, createdById: req.user!.id },
      select: bridgeAgentSelect,
    });

    await auditImaging(req, clinicId, 'imaging_bridge_registered', 'imaging_bridge_agent', agent.id);
    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'imaging_bridge',
      entityId: agent.id,
      action: 'create',
      description: 'Görüntüleme köprü ajanı kaydedildi',
    });

    res.status(201).json({ ...agent, token });
  } catch {
    res.status(500).json({ error: 'Failed to register bridge agent' });
  }
});

// POST /api/imaging/bridges/:id/revoke — heartbeat anında engellenir.
router.post('/imaging/bridges/:id/revoke', authorize([...IMAGING_MANAGE_ROLES]), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, undefined, res);
    if (scope === false) return;

    const existing = await prisma.imagingBridgeAgent.findFirst({ where: { id, ...scope } });
    if (!existing) return res.status(404).json({ error: 'Bridge agent not found' });
    if (existing.status === 'revoked') return res.status(409).json({ error: 'Bridge agent already revoked' });

    const agent = await prisma.imagingBridgeAgent.update({
      where: { id },
      data: { status: 'revoked' },
      select: bridgeAgentSelect,
    });

    await auditImaging(req, existing.clinicId, 'imaging_bridge_revoked', 'imaging_bridge_agent', id);
    await logActivity({
      clinicId: existing.clinicId,
      userId: req.user!.id,
      entityType: 'imaging_bridge',
      entityId: id,
      action: 'revoke',
      description: 'Görüntüleme köprü ajanı iptal edildi',
    });

    res.json(agent);
  } catch {
    res.status(500).json({ error: 'Failed to revoke bridge agent' });
  }
});

// DELETE /api/imaging/bridges/:id — yalnızca hiç heartbeat göndermemiş ve hiçbir
// çalışmaya bağlı olmayan ajanlar kalıcı olarak silinir; aksi halde 409 döner.
// revoked durumu tek başına silinebilirlik sağlamaz (bkz. docs/48).
router.delete('/imaging/bridges/:id', authorize([...IMAGING_MANAGE_ROLES]), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');

  try {
    const scope = await validateAndGetClinicIdScope(req.user!, undefined, res);
    if (scope === false) return;

    const existing = await prisma.imagingBridgeAgent.findFirst({ where: { id, ...scope } });
    if (!existing) return res.status(404).json({ error: 'Bridge agent not found' });

    const result = await prisma.$transaction(async (tx) => {
      const studyCount = await tx.imagingStudy.count({ where: { bridgeAgentId: id } });
      const hasConnected = existing.lastSeenAt !== null || studyCount > 0;
      if (hasConnected) {
        return { blocked: true as const, studyCount, hasConnected };
      }
      await tx.imagingBridgeAgent.delete({ where: { id } });
      return { blocked: false as const };
    });

    if (result.blocked) {
      return res.status(409).json({
        error: 'Imaging bridge agent has historical activity',
        code: 'IMAGING_BRIDGE_IN_USE',
        usage: { studyCount: result.studyCount, hasConnected: result.hasConnected },
      });
    }

    await auditImaging(req, existing.clinicId, 'imaging_bridge_deleted', 'imaging_bridge_agent', id, {
      name: existing.name,
    });
    res.status(200).json({ deleted: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete bridge agent' });
  }
});

export default router;
