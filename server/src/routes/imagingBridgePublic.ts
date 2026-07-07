/**
 * imagingBridgePublic.ts — Görüntüleme köprü ajanı public uç noktaları.
 *
 * /api/public altına authenticate ÖNCESİNDE bağlanır; kullanıcı oturumu değil,
 * köprü token'ı (Bearer) ile kimlik doğrular. Token veritabanında yalnızca
 * sha256 özeti (tokenHash) olarak durur — kayıt routes/imaging.ts'te yapılır.
 *
 * Güvenlik ilkeleri:
 *  - İptal edilen (revoked) ajan anında reddedilir; tüm ret durumları aynı
 *    jenerik 401 döner (token geçerliliği hakkında bilgi sızdırılmaz).
 *  - IP ve token bazlı çift rate limit (mevcut createRateLimiter altyapısı).
 *  - Loglara/audit metadata'sına düz metin token, tokenHash, dosya adı,
 *    PHI/PII veya DICOM etiketi ASLA yazılmaz — yalnızca ajan/cihaz ID'si,
 *    modality ve sayaçlar.
 *  - Yanıt minimaldir; klinik/hasta verisi dönmez, storage path/URL asla yok.
 *  - Yükleme idempotent'tir: ajanın gönderdiği ingestKey sunucuda dosya
 *    buffer'ından bağımsız olarak yeniden hesaplanır ve uyuşmazsa reddedilir;
 *    tekilleştirme klinik düzeyinde yapılır (clinicId+ingestKey) — bridgeAgentId
 *    düzeyinde DEĞİL — böylece ajan değişse/çoğalsa bile aynı dosya iki kez
 *    yüklenemez (bkz. docs/47-imaging-bridge-contract.md).
 */

import crypto from 'crypto';
import express, { Request, Response } from 'express';
import multer from 'multer';
import prisma from '../db.js';
import { createRateLimiter } from '../utils/helpers.js';
import { writeAuditLog } from '../utils/auditLog.js';
import { hashBridgeToken } from '../services/imaging/bridgeTokens.js';
import { isAllowedFileSignature } from '../utils/fileSignature.js';
import { buildStorageKey, deleteFile, fileNameFromKey, saveFile } from '../services/fileStorage.js';
import {
  IMAGING_ALLOWED_MIME,
  IMAGING_EXTENSIONS_BY_MIME,
  MAX_FILE_MB,
  normalizeDeclaredMime,
} from '../services/imaging/imagingUploadValidation.js';
import { canAttachStudyToRequest, type ImagingRequestStatus } from '../services/imaging/imagingRequestTransitions.js';
import { imagingBridgeHeartbeatSchema, imagingBridgeStudyUploadSchema } from '../schemas/index.js';

const router = express.Router();

// Ajan ~60 sn'de bir heartbeat atar; token başına 6/dk cömert bir tavandır.
const heartbeatIpLimiter = createRateLimiter(60, 60 * 1000, 'imaging-bridge-hb-ip');
const heartbeatTokenLimiter = createRateLimiter(6, 60 * 1000, 'imaging-bridge-hb-token');

// Görüntü yükleme burst'lüdür (bir dizi ağız içi çekim saniyeler içinde export
// edilebilir); heartbeat'in tavanından belirgin biçimde yüksek tutulur.
const uploadIpLimiter = createRateLimiter(120, 60 * 1000, 'imaging-bridge-upload-ip');
const uploadTokenLimiter = createRateLimiter(30, 60 * 1000, 'imaging-bridge-upload-token');

// Eşzamanlı yükleme sınırı: bellek-tabanlı upload'ları (multer memoryStorage)
// tek bir ajanın onlarca dosyayı aynı anda paralel göndermesinden korur.
// Süreç-içi sayaçtır — birden fazla API replikası varsa her biri kendi payını
// uygular; rate limiter'lar (yukarıda, paylaşımlı store) asıl tavanı zaten
// paylaşımlı olarak uygular, bu yalnızca tek-süreç bellek baskısını sınırlar.
const MAX_CONCURRENT_UPLOADS_PER_TOKEN = 3;
const inFlightUploadsByToken = new Map<string, number>();

function tryAcquireUploadSlot(tokenHash: string): boolean {
  const current = inFlightUploadsByToken.get(tokenHash) ?? 0;
  if (current >= MAX_CONCURRENT_UPLOADS_PER_TOKEN) return false;
  inFlightUploadsByToken.set(tokenHash, current + 1);
  return true;
}

function releaseUploadSlot(tokenHash: string): void {
  const current = inFlightUploadsByToken.get(tokenHash) ?? 0;
  if (current <= 1) inFlightUploadsByToken.delete(tokenHash);
  else inFlightUploadsByToken.set(tokenHash, current - 1);
}

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

type AuthenticatedBridgeAgent = {
  id: string;
  clinicId: string;
  status: string;
  clinic: { organizationId: string };
};

/**
 * Bearer token'ı doğrular ve aktif (revoked olmayan) ajanı döner. Token
 * eksik/bilinmeyen/iptal edilmiş — hepsinde null döner; çağıran aynı jenerik
 * 401'i yazar (ret nedeni sızdırılmaz).
 */
async function authenticateBridgeAgent(req: Request): Promise<{ agent: AuthenticatedBridgeAgent; tokenHash: string } | null> {
  const authHeader = req.headers.authorization;
  const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : undefined;
  if (!rawToken) return null;

  const tokenHash = hashBridgeToken(rawToken);
  const agent = await prisma.imagingBridgeAgent.findUnique({
    where: { tokenHash },
    select: { id: true, clinicId: true, status: true, clinic: { select: { organizationId: true } } },
  });

  if (!agent || agent.status === 'revoked') return null;
  return { agent, tokenHash };
}

// POST /api/public/imaging/bridge/heartbeat
router.post('/imaging/bridge/heartbeat', async (req: Request, res: Response) => {
  try {
    const ipKey = req.ip ?? 'unknown';
    if (!(await heartbeatIpLimiter.check(ipKey))) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    await heartbeatIpLimiter.record(ipKey);

    const authHeader = req.headers.authorization;
    const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : undefined;
    if (!rawToken) return res.status(401).json({ error: 'Unauthorized' });

    // Token bazlı limit özet (hash) üzerinden anahtarlanır — düz metin token
    // rate-limit store'una dahi yazılmaz.
    const tokenHash = hashBridgeToken(rawToken);
    if (!(await heartbeatTokenLimiter.check(tokenHash))) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    await heartbeatTokenLimiter.record(tokenHash);

    const validation = imagingBridgeHeartbeatSchema.safeParse(req.body ?? {});
    if (!validation.success) return res.status(400).json({ error: 'Invalid payload' });

    const authResult = await authenticateBridgeAgent(req);
    if (!authResult) return res.status(401).json({ error: 'Unauthorized' });
    const { agent } = authResult;

    const firstSeen = agent.status === 'pending';
    await prisma.imagingBridgeAgent.update({
      where: { id: agent.id },
      data: {
        status: 'online',
        lastSeenAt: new Date(),
        ...(validation.data.agentVersion ? { agentVersion: validation.data.agentVersion } : {}),
      },
    });

    if (firstSeen) {
      await writeAuditLog({
        organizationId: agent.clinic.organizationId,
        clinicId: agent.clinicId,
        action: 'imaging_bridge_heartbeat_first_seen',
        entityType: 'imaging_bridge_agent',
        entityId: agent.id,
        metadata: validation.data.agentVersion ? { agentVersion: validation.data.agentVersion } : null,
      });
    }

    // Minimal yanıt: ajan durumu dışında hiçbir veri dönmez.
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Heartbeat failed' });
  }
});

// POST /api/public/imaging/bridge/studies — köprü ajanının görüntü yüklemesi.
router.post('/imaging/bridge/studies', (req: Request, res: Response, next) => {
  upload.single('file')(req as any, res as any, (err: any) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `File exceeds ${MAX_FILE_MB} MB limit` });
      }
      return res.status(400).json({ error: 'Upload failed', detail: err.message });
    }
    if (err?.message === 'File type not allowed') {
      return res.status(400).json({ error: 'File type not allowed' });
    }
    console.error('[imaging-bridge] upload middleware error:', err?.message ?? err);
    return res.status(500).json({ error: 'Upload could not start' });
  });
}, async (req: Request, res: Response) => {
  let tokenHashForSlot: string | null = null;
  let storageKey: string | null = null;

  try {
    const ipKey = req.ip ?? 'unknown';
    if (!(await uploadIpLimiter.check(ipKey))) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    await uploadIpLimiter.record(ipKey);

    const authResult = await authenticateBridgeAgent(req);
    if (!authResult) return res.status(401).json({ error: 'Unauthorized' });
    const { agent, tokenHash } = authResult;

    if (!(await uploadTokenLimiter.check(tokenHash))) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    await uploadTokenLimiter.record(tokenHash);

    if (!tryAcquireUploadSlot(tokenHash)) {
      return res.status(429).json({ error: 'Too many concurrent uploads' });
    }
    tokenHashForSlot = tokenHash;

    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }

    const validation = imagingBridgeStudyUploadSchema.safeParse(req.body ?? {});
    if (!validation.success) return res.status(400).json({ error: validation.error.format() });
    const v = validation.data;

    // Sunucu, ajanın gönderdiği ingestKey'e GÜVENMEZ — buffer'dan bağımsız
    // olarak yeniden hesaplar. Uyuşmazlık her zaman reddedilir.
    const computedHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    if (computedHash !== v.ingestKey) {
      return res.status(400).json({ error: 'ingestKey does not match uploaded file content' });
    }

    const clinicId = agent.clinicId;

    // Klinik düzeyinde tekilleştirme — bridgeAgentId'den bağımsız.
    const existingByIngestKey = await prisma.imagingStudy.findFirst({
      where: { clinicId, ingestKey: v.ingestKey },
      select: { id: true },
    });
    if (existingByIngestKey) {
      await prisma.imagingBridgeAgent.update({
        where: { id: agent.id },
        data: { status: 'online', lastSeenAt: new Date() },
      });
      return res.status(200).json({ ok: true, studyId: existingByIngestKey.id, duplicate: true });
    }

    if (v.deviceId) {
      const device = await prisma.imagingDevice.findFirst({ where: { id: v.deviceId, clinicId, isActive: true } });
      if (!device) return res.status(404).json({ error: 'Imaging device not found' });
    }

    // Kontrollü opsiyonel bağlama: yalnızca imagingRequestId üzerinden, yalnızca
    // aynı klinikte ve durumu hâlâ açıksa. Ad/telefon/dosya adından eşleştirme
    // YOKTUR — verilmezse study patientId:null ile bağlanmamış kuyruğa düşer.
    let request: { id: string; patientId: string; status: string } | null = null;
    if (v.imagingRequestId) {
      const found = await prisma.imagingRequest.findFirst({
        where: { id: v.imagingRequestId, clinicId },
        select: { id: true, patientId: true, status: true },
      });
      if (!found) return res.status(404).json({ error: 'Imaging request not found' });
      if (!canAttachStudyToRequest(found.status as ImagingRequestStatus)) {
        return res.status(409).json({ error: 'Imaging request is not open for new studies' });
      }
      request = found;
    }

    const effectiveMime = normalizeDeclaredMime(req.file.mimetype, req.file.originalname);
    if (!isAllowedFileSignature(req.file.buffer, effectiveMime, req.file.originalname, IMAGING_EXTENSIONS_BY_MIME)) {
      return res.status(400).json({ error: 'File content could not be validated' });
    }

    storageKey = buildStorageKey(clinicId, req.file.originalname);
    await saveFile(storageKey, req.file.buffer, effectiveMime);

    let duplicate = false;
    let studyId: string;
    try {
      const created = await prisma.$transaction(async (tx) => {
        const study = await tx.imagingStudy.create({
          data: {
            clinicId,
            patientId: request?.patientId ?? null,
            deviceId: v.deviceId ?? null,
            imagingRequestId: request?.id ?? null,
            modality: v.modality ?? 'OTHER',
            studyDate: v.studyDate ?? new Date(),
            source: 'bridge',
            status: 'active',
            createdById: null,
            bridgeAgentId: agent.id,
            ingestKey: v.ingestKey,
          },
        });

        await tx.imagingImage.create({
          data: {
            clinicId,
            studyId: study.id,
            fileName: fileNameFromKey(storageKey!),
            originalName: req.file!.originalname,
            fileSize: req.file!.size,
            mimeType: effectiveMime,
            filePath: storageKey!,
          },
        });

        if (request) {
          const updated = await tx.imagingRequest.updateMany({
            where: { id: request.id, clinicId, status: { in: ['requested', 'scheduled'] } },
            data: { status: 'received' },
          });
          if (updated.count === 0) {
            throw Object.assign(new Error('Imaging request is not open for new studies'), { statusCode: 409 });
          }
        }

        return study;
      });
      studyId = created.id;
    } catch (txErr: any) {
      // Yarış: aynı anda iki istek aynı clinicId+ingestKey ile yükledi — unique
      // constraint P2002 verir. Az önce yazılan dosyayı sil, var olan study'yi dön.
      if (txErr?.code === 'P2002') {
        await deleteFile(storageKey).catch(() => {});
        storageKey = null;
        const existing = await prisma.imagingStudy.findFirst({
          where: { clinicId, ingestKey: v.ingestKey },
          select: { id: true },
        });
        if (!existing) throw txErr;
        studyId = existing.id;
        duplicate = true;
      } else {
        throw txErr;
      }
    }

    await prisma.imagingBridgeAgent.update({
      where: { id: agent.id },
      data: { status: 'online', lastSeenAt: new Date() },
    });

    // Audit metadata: yalnızca güvenli tanımlayıcı/sayaçlar — dosya adı,
    // hasta verisi ya da token/hash ASLA yazılmaz.
    await writeAuditLog({
      organizationId: agent.clinic.organizationId,
      clinicId,
      action: 'imaging_bridge_study_ingested',
      entityType: 'imaging_study',
      entityId: studyId,
      metadata: {
        deviceId: v.deviceId ?? null,
        modality: v.modality ?? 'OTHER',
        fileSize: req.file.size,
        mimeType: effectiveMime,
        duplicate,
      },
    });

    res.status(duplicate ? 200 : 201).json({ ok: true, studyId, duplicate });
  } catch (err: any) {
    if (storageKey) await deleteFile(storageKey).catch(() => {});
    if (err?.statusCode === 409) return res.status(409).json({ error: err.message });
    console.error('[imaging-bridge] upload error:', err?.message ?? err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to ingest imaging study' });
  } finally {
    if (tokenHashForSlot) releaseUploadSlot(tokenHashForSlot);
  }
});

export default router;
