/**
 * clinicBulkExport.ts — KVKK-HIGH-004 secure clinic bulk/structured-data
 * export API (docs/compliance/54-kvkk-secure-clinic-bulk-export.md).
 *
 * Every route below is OWNER/ORG_ADMIN only, clinic-scope validated via
 * clinicScope.ts (never req.user.clinicId), and — while
 * CLINIC_BULK_EXPORT_ENABLED is false — refuses to create new jobs at all.
 * `authenticate` and CSRF protection already run globally for the /api
 * prefix (see index.ts).
 *
 *   GET  /api/clinic/:clinicId/bulk-export/config           — {enabled}
 *   POST /api/clinic/:clinicId/bulk-export                  — create job (step-up)
 *   GET  /api/clinic/:clinicId/bulk-export/:jobId            — status
 *   POST /api/clinic/:clinicId/bulk-export/:jobId/download-token — issue token (step-up)
 *   GET  /api/clinic/:clinicId/bulk-export/:jobId/download   — stream download
 */

import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { validateAndGetScope } from '../utils/clinicScope.js';
import { getParam } from '../utils/helpers.js';
import { writeAuditLog, extractRequestMeta } from '../utils/auditLog.js';
import { safeErrorFields } from '../utils/safeError.js';
import { isClinicBulkExportEnabled } from '../services/privacy/clinicBulkExportConfig.js';
import {
  assertIpHashSecretConfigured,
  isWithinStepUpWindow,
} from '../utils/passwordStepUp.js';
import { verifyStepUpPasswordWithLockout } from '../services/privacy/clinicBulkExportPasswordAttempts.js';
import {
  reserveClinicBulkExport,
  expireArchiveIfPastTtl,
  issueClinicBulkExportDownloadToken,
  validateClinicBulkExportDownloadToken,
  claimClinicBulkExportDownload,
  ClinicBulkExportAlreadyRunningError,
  ClinicBulkExportRateLimitedError,
} from '../services/privacy/clinicBulkExportPackage.js';
import { openFileStream } from '../services/fileStorage.js';

const router = express.Router();

const EXPORT_ROLES = ['OWNER', 'ORG_ADMIN'];
const DOWNLOAD_TOKEN_HEADER = 'x-clinic-export-download-token';
const VALID_PURPOSES = new Set([
  'regulatory_request',
  'clinic_migration',
  'contract_termination',
  'legal_request',
  'other',
]);
const MAX_RESTRICTED_NOTE_LENGTH = 2000;

/** Resolves and validates the route's :clinicId against the user's org/access. Sends 403 and returns null on failure. */
async function resolveClinicScope(req: AuthRequest, res: Response): Promise<{ clinicId: string; organizationId: string } | null> {
  const clinicId = getParam(req, 'clinicId');
  if (!clinicId || clinicId === 'all') {
    res.status(400).json({ error: 'A specific clinicId is required' });
    return null;
  }
  const scope = await validateAndGetScope(req.user!, clinicId, res);
  if (scope === false) return null;
  if (!('clinicId' in scope) || typeof scope.clinicId !== 'string') {
    // Defensive: buildClinicScopeWhere only omits clinicId for the "all
    // clinics" mode, which resolveClinicScope already rejected above.
    res.status(403).json({ error: 'CLINIC_BULK_EXPORT_FORBIDDEN' });
    return null;
  }
  return { clinicId: scope.clinicId, organizationId: scope.organizationId };
}

// ── GET /config ──────────────────────────────────────────────────────────

router.get(
  '/clinic/:clinicId/bulk-export/config',
  authorize(EXPORT_ROLES),
  async (req: AuthRequest, res: Response) => {
    const scope = await resolveClinicScope(req, res);
    if (!scope) return;
    res.json({ enabled: isClinicBulkExportEnabled() });
  },
);

// ── POST / — create job ─────────────────────────────────────────────────

router.post(
  '/clinic/:clinicId/bulk-export',
  authorize(EXPORT_ROLES),
  async (req: AuthRequest, res: Response) => {
    const user = req.user!;

    if (!isClinicBulkExportEnabled()) {
      const clinicId = getParam(req, 'clinicId');
      void writeAuditLog({
        organizationId: user.organizationId,
        clinicId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'clinic_bulk_export_feature_disabled_attempt',
        entityType: 'clinic',
        entityId: clinicId,
        description: 'Clinic bulk export creation attempted while feature disabled',
        ...extractRequestMeta(req),
      });
      return res.status(403).json({ error: 'CLINIC_BULK_EXPORT_DISABLED' });
    }

    const scope = await resolveClinicScope(req, res);
    if (!scope) return;

    const body = req.body ?? {};
    const purpose = typeof body.purpose === 'string' ? body.purpose : '';
    const confirm = body.confirm === true;
    const restrictedNote =
      typeof body.restrictedNote === 'string' && body.restrictedNote.trim().length > 0
        ? body.restrictedNote.trim().slice(0, MAX_RESTRICTED_NOTE_LENGTH)
        : null;
    const currentPassword = body.currentPassword;

    if (!VALID_PURPOSES.has(purpose)) {
      return res.status(400).json({ error: 'Invalid or missing purpose' });
    }
    if (!confirm) {
      return res.status(400).json({ error: 'Explicit confirmation is required' });
    }

    try {
      assertIpHashSecretConfigured();
    } catch {
      return res.status(403).json({ error: 'CLINIC_BULK_EXPORT_DISABLED' });
    }

    const ip = req.ip ?? 'unknown';
    let stepUp;
    try {
      stepUp = await verifyStepUpPasswordWithLockout({
        userId: user.id,
        clinicId: scope.clinicId,
        ip,
        suppliedPassword: currentPassword,
      });
    } catch (err) {
      console.error('[clinic-bulk-export] step-up verification failed', safeErrorFields(err));
      return res.status(500).json({ error: 'Step-up verification failed. Please try again.' });
    }

    if (stepUp.outcome === 'locked') {
      void writeAuditLog({
        organizationId: scope.organizationId,
        clinicId: scope.clinicId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'clinic_bulk_export_rate_limited',
        entityType: 'clinic',
        entityId: scope.clinicId,
        description: 'Clinic bulk export step-up rate limited (brute-force lockout)',
        ...extractRequestMeta(req),
      });
      return res.status(429).json({ error: 'CLINIC_BULK_EXPORT_RATE_LIMITED' });
    }
    if (stepUp.outcome === 'rejected') {
      void writeAuditLog({
        organizationId: scope.organizationId,
        clinicId: scope.clinicId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'clinic_bulk_export_step_up_failed',
        entityType: 'clinic',
        entityId: scope.clinicId,
        description: 'Clinic bulk export step-up password verification failed',
        ...extractRequestMeta(req),
      });
      return res.status(401).json({ error: 'CLINIC_BULK_EXPORT_STEP_UP_FAILED' });
    }

    try {
      const { jobId } = await reserveClinicBulkExport({
        clinicId: scope.clinicId,
        organizationId: scope.organizationId,
        requestedByUserId: user.id,
        purpose,
        restrictedNote,
        stepUpVerifiedAt: new Date(),
        actorRole: user.role,
        req,
      });
      return res.status(202).json({ jobId, status: 'queued' });
    } catch (err) {
      if (err instanceof ClinicBulkExportAlreadyRunningError) {
        return res.status(409).json({ error: 'CLINIC_BULK_EXPORT_ALREADY_RUNNING' });
      }
      if (err instanceof ClinicBulkExportRateLimitedError) {
        return res.status(429).json({ error: 'CLINIC_BULK_EXPORT_RATE_LIMITED' });
      }
      console.error('[clinic-bulk-export] creation failed', safeErrorFields(err));
      return res.status(500).json({ error: 'Failed to create export job. Please try again.' });
    }
  },
);

// ── GET /:jobId — status ────────────────────────────────────────────────

router.get(
  '/clinic/:clinicId/bulk-export/:jobId',
  authorize(EXPORT_ROLES),
  async (req: AuthRequest, res: Response) => {
    const scope = await resolveClinicScope(req, res);
    if (!scope) return;
    const jobId = getParam(req, 'jobId');

    const row = await prisma.clinicBulkExportArchive.findFirst({
      where: { id: jobId, clinicId: scope.clinicId, organizationId: scope.organizationId },
      select: {
        id: true,
        status: true,
        purpose: true,
        createdAt: true,
        expiresAt: true,
        downloadedAt: true,
        failureCode: true,
      },
    });
    if (!row) return res.status(404).json({ error: 'Export job not found' });

    const status = await expireArchiveIfPastTtl(row);

    // Explicit allowlist DTO — never restrictedNote/storageKey/downloadTokenHash/manifestJson/cleanupFailureCode.
    res.json({
      jobId: row.id,
      status,
      purpose: row.purpose,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      downloadedAt: row.downloadedAt,
      failureCode: row.failureCode,
    });
  },
);

// ── POST /:jobId/download-token ─────────────────────────────────────────

router.post(
  '/clinic/:clinicId/bulk-export/:jobId/download-token',
  authorize(EXPORT_ROLES),
  async (req: AuthRequest, res: Response) => {
    const user = req.user!;
    const scope = await resolveClinicScope(req, res);
    if (!scope) return;
    const jobId = getParam(req, 'jobId');

    try {
      assertIpHashSecretConfigured();
    } catch {
      return res.status(403).json({ error: 'CLINIC_BULK_EXPORT_DISABLED' });
    }

    const body = req.body ?? {};
    const suppliedPassword = body.currentPassword;
    const now = new Date();

    let stepUpOk = false;
    if (typeof suppliedPassword === 'string' && suppliedPassword.length > 0) {
      const ip = req.ip ?? 'unknown';
      let stepUp;
      try {
        stepUp = await verifyStepUpPasswordWithLockout({
          userId: user.id,
          clinicId: scope.clinicId,
          ip,
          suppliedPassword,
          now,
        });
      } catch (err) {
        console.error('[clinic-bulk-export] step-up verification failed', safeErrorFields(err));
        return res.status(500).json({ error: 'Step-up verification failed. Please try again.' });
      }
      if (stepUp.outcome === 'locked') {
        return res.status(429).json({ error: 'CLINIC_BULK_EXPORT_RATE_LIMITED' });
      }
      stepUpOk = stepUp.outcome === 'verified';
    } else {
      const row = await prisma.clinicBulkExportArchive.findFirst({
        where: { id: jobId, clinicId: scope.clinicId, organizationId: scope.organizationId },
        select: { stepUpVerifiedAt: true },
      });
      stepUpOk = Boolean(row && isWithinStepUpWindow(row.stepUpVerifiedAt, now));
    }

    if (!stepUpOk) {
      void writeAuditLog({
        organizationId: scope.organizationId,
        clinicId: scope.clinicId,
        actorUserId: user.id,
        actorRole: user.role,
        action: 'clinic_bulk_export_step_up_failed',
        entityType: 'clinic',
        entityId: scope.clinicId,
        description: 'Clinic bulk export download-token step-up failed',
        metadata: { jobId },
        ...extractRequestMeta(req),
      });
      return res.status(401).json({ error: 'CLINIC_BULK_EXPORT_STEP_UP_FAILED' });
    }

    const result = await issueClinicBulkExportDownloadToken({
      jobId,
      clinicId: scope.clinicId,
      organizationId: scope.organizationId,
      actorUserId: user.id,
      actorRole: user.role,
      stepUpOk: true,
      req,
      now,
    });

    if (!result.ok) {
      const codeByFailure: Record<string, { status: number; error: string }> = {
        not_found: { status: 404, error: 'Export job not found' },
        not_ready: { status: 409, error: 'CLINIC_BULK_EXPORT_NOT_READY' },
        expired: { status: 410, error: 'CLINIC_BULK_EXPORT_EXPIRED' },
        token_already_issued: { status: 409, error: 'CLINIC_BULK_EXPORT_TOKEN_ALREADY_ISSUED' },
        step_up_failed: { status: 401, error: 'CLINIC_BULK_EXPORT_STEP_UP_FAILED' },
      };
      const mapped = codeByFailure[result.failure ?? 'not_found'] ?? { status: 500, error: 'Failed to issue download token' };
      return res.status(mapped.status).json({ error: mapped.error });
    }

    res.json({ token: result.token });
  },
);

// ── GET /:jobId/download ────────────────────────────────────────────────

router.get(
  '/clinic/:clinicId/bulk-export/:jobId/download',
  authorize(EXPORT_ROLES),
  async (req: AuthRequest, res: Response) => {
    const user = req.user!;
    const scope = await resolveClinicScope(req, res);
    if (!scope) return;
    const jobId = getParam(req, 'jobId');
    const token = String(req.headers[DOWNLOAD_TOKEN_HEADER] ?? '');

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    try {
      const validation = await validateClinicBulkExportDownloadToken({
        clinicId: scope.clinicId,
        organizationId: scope.organizationId,
        jobId,
        token,
      });
      if (!validation.ok || !validation.archive) {
        const reason = validation.failure ?? 'not_found';
        const statusByReason: Record<string, number> = {
          missing: 400,
          not_found: 404,
          wrong_scope: 404,
          expired: 410,
          not_ready: 409,
          already_downloaded: 409,
        };
        const codeByReason: Record<string, string> = {
          expired: 'CLINIC_BULK_EXPORT_EXPIRED',
          not_ready: 'CLINIC_BULK_EXPORT_NOT_READY',
          already_downloaded: 'CLINIC_BULK_EXPORT_ALREADY_DOWNLOADED',
        };
        return res.status(statusByReason[reason] ?? 404).json({ error: codeByReason[reason] ?? 'Export not available for download' });
      }

      // Confirm the file can actually be opened BEFORE claiming, so a
      // storage-layer failure never burns the one-time token.
      const stream = await openFileStream(validation.archive.storageKey);
      if (!stream) return res.status(404).json({ error: 'Export file missing in storage' });

      let claim;
      try {
        claim = await claimClinicBulkExportDownload({
          jobId: validation.archive.id,
          clinicId: scope.clinicId,
          organizationId: scope.organizationId,
          actorUserId: user.id,
          actorRole: user.role,
          req,
        });
      } catch (claimErr) {
        // The claim+audit transaction failed (fail-closed) — the already-
        // opened stream must never be piped; destroy it explicitly.
        stream.destroy();
        console.error('[clinic-bulk-export] download claim failed', safeErrorFields(claimErr));
        return res.status(500).json({ error: 'Download failed. Please try again.' });
      }
      if (!claim.claimed) {
        stream.destroy();
        return res.status(409).json({ error: 'CLINIC_BULK_EXPORT_ALREADY_DOWNLOADED' });
      }

      res.setHeader('Content-Disposition', `attachment; filename="clinic-export-${scope.clinicId}.zip"`);
      res.setHeader('Content-Type', 'application/zip');

      let outcomeLogged = false;
      const logOutcome = async (action: string, description: string, extra?: Record<string, unknown>) => {
        if (outcomeLogged) return;
        outcomeLogged = true;
        try {
          await writeAuditLog({
            organizationId: scope.organizationId,
            clinicId: scope.clinicId,
            actorUserId: user.id,
            actorRole: user.role,
            action,
            entityType: 'clinic',
            entityId: scope.clinicId,
            description,
            metadata: { jobId, ...extra },
            ...extractRequestMeta(req),
          });
        } catch (auditErr) {
          console.error('[clinic-bulk-export] outcome audit log failed', safeErrorFields(auditErr));
        }
      };

      stream.on('error', (streamErr) => {
        console.error('[clinic-bulk-export] download stream error', { jobId, ...safeErrorFields(streamErr) });
        void logOutcome('clinic_bulk_export_download_failed', 'Clinic bulk export download failed mid-stream', { reason: 'stream_error' });
        if (!res.headersSent) res.status(500).json({ error: 'Download failed' });
        else res.destroy();
      });
      res.on('close', () => {
        if (!outcomeLogged) {
          void logOutcome('clinic_bulk_export_download_failed', 'Clinic bulk export download interrupted (client disconnected)', { reason: 'interrupted' });
        }
      });
      stream.on('end', () => {
        void logOutcome('clinic_bulk_export_downloaded', 'Clinic bulk export downloaded');
      });
      stream.pipe(res as any);
    } catch (err) {
      console.error('[clinic-bulk-export] download failed', { jobId, ...safeErrorFields(err) });
      return res.status(500).json({ error: 'Download failed. Please try again.' });
    }
  },
);

export default router;
