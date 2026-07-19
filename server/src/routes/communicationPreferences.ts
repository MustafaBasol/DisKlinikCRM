/**
 * communicationPreferences.ts — KVKK-HIGH-007 API: patient communication
 * preference and consent management.
 *
 * Technical control only — see docs/compliance/56-kvkk-communication-preference-and-consent-management.md.
 *
 * Roles: OWNER / ORG_ADMIN / CLINIC_MANAGER / RECEPTIONIST / DENTIST may
 * read and mutate. BILLING is intentionally excluded (no operational need to
 * edit legal evidence fields). DENTIST is read + grant/deny/withdraw capable
 * like front-desk staff — clinical staff routinely capture verbal consent
 * during a visit; a future review may narrow this further.
 *
 * The full-evidence export endpoint (GET .../export) is management-only
 * (OWNER / ORG_ADMIN / CLINIC_MANAGER) — narrower than the view/mutate roles
 * above, matching the equivalent patientPrivacy.ts export endpoint. A bulk
 * dump of every historical consent event is a different risk profile than
 * viewing/editing today's preference state, so RECEPTIONIST/DENTIST keep
 * matrix/history/mutation access but not the export.
 */

import express, { Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { getParam } from '../utils/helpers.js';
import { writeAuditLog, extractRequestMeta } from '../utils/auditLog.js';
import {
  COMMUNICATION_CHANNELS,
  COMMUNICATION_PURPOSES,
  POLICY_EXCEPTION_PURPOSES,
  isCommunicationChannel,
  isCommunicationPurpose,
} from '../services/communicationConsent/taxonomy.js';
import { deriveCommunicationDecision } from '../services/communicationConsent/communicationConsentPolicy.js';
import type { CommunicationPreferenceStatus } from '../services/communicationConsent/taxonomy.js';
import {
  setCommunicationPreference,
  bulkSetCommunicationPreferences,
  CommunicationConsentAdminError,
  type SetPreferenceAction,
} from '../services/communicationConsent/communicationConsentAdmin.js';
import { hashEvidenceIp, hashEvidenceUserAgent } from '../services/communicationConsent/consentEvidenceSanitizer.js';
import {
  getCommunicationConsentAuditSummary,
  CommunicationConsentAuditReportError,
} from '../services/communicationConsent/communicationConsentAuditReport.js';

const router = express.Router();

const ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST', 'DENTIST'] as const;

/** Consent evidence export is a bulk historical dump — management-only, same scope as patientPrivacy.ts's export endpoint. */
const EXPORT_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER'] as const;

/**
 * `revision` is only a global order *within* one channel+purpose key (see
 * communicationConsentAdmin.ts). When both `channel` and `purpose` are
 * supplied, exactly one preference chain is selected, so `revision desc`
 * alone is the authoritative, gap-free order. When either is omitted, the
 * result can span multiple independent chains — ordering by `revision` alone
 * would interleave unrelated chains (e.g. sms/reminder revision 3 could sit
 * between whatsapp/marketing revisions 5 and 6) and misrepresent the
 * timeline. In that case order by `createdAt desc` with deterministic
 * tie-breakers (channel, purpose, revision, id) so events from the same
 * millisecond never come back in arbitrary order.
 *
 * Exported so tests can exercise this exact ordering against a real DB.
 */
export function resolveCommunicationHistoryOrderBy(
  channel?: string,
  purpose?: string,
): Prisma.PatientCommunicationConsentEventOrderByWithRelationInput | Prisma.PatientCommunicationConsentEventOrderByWithRelationInput[] {
  const singleChainSelected = Boolean(channel && purpose);
  return singleChainSelected
    ? { revision: 'desc' }
    : [
        { createdAt: 'desc' },
        { channel: 'asc' },
        { purpose: 'asc' },
        { revision: 'desc' },
        { id: 'asc' },
      ];
}

const ADMIN_ERROR_STATUS: Record<string, number> = {
  invalid_channel: 400,
  invalid_purpose: 400,
  invalid_transition: 400,
  scope_denied: 403,
  evidence_required: 400,
  notice_version_required: 400,
  unsafe_note: 400,
  preference_not_found: 404,
};

/** Loads a patient scoped to the caller's organization + clinic access. Writes nothing. */
async function loadScopedPatient(req: AuthRequest, res: Response, patientId: string) {
  const orgId = req.user!.organizationId;
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, organizationId: orgId, deletedAt: null },
    select: { id: true, clinicId: true, organizationId: true, smsOptOut: true },
  });
  if (!patient) {
    res.status(404).json({ error: 'Patient not found' });
    return null;
  }
  if (!req.user!.canAccessAllClinics && !req.user!.allowedClinicIds.includes(patient.clinicId)) {
    res.status(403).json({ error: 'Access denied to this patient' });
    return null;
  }
  return patient;
}

// ─── GET /api/patients/:patientId/communication-preferences ──────────────────
// Full channel×purpose decision matrix (current state + live policy decision).

router.get(
  '/patients/:patientId/communication-preferences',
  authorize([...ROLES]),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'patientId');
    try {
      const patient = await loadScopedPatient(req, res, patientId);
      if (!patient) return;

      const rows = await prisma.patientCommunicationPreference.findMany({
        where: { patientId: patient.id, clinicId: patient.clinicId },
      });
      const byKey = new Map(rows.map((r) => [`${r.channel}:${r.purpose}`, r]));

      // Evaluated once, in memory, for every cell — the patient (and thus
      // scope) and every preference row are already loaded above, so there is
      // no need to re-query the database per channel×purpose cell (see
      // deriveCommunicationDecision doc comment). The matrix's own args always
      // match the loaded patient's org/clinic exactly, so the cross-clinic
      // PatientClinic branch in the full evaluateCommunicationPermission path
      // never applies here — this is a like-for-like optimization, not a
      // behavior change.
      const matrix = [];
      for (const channel of COMMUNICATION_CHANNELS) {
        for (const purpose of COMMUNICATION_PURPOSES) {
          const row = byKey.get(`${channel}:${purpose}`);
          const decisionArgs = {
            organizationId: patient.organizationId,
            clinicId: patient.clinicId,
            patientId: patient.id,
            channel,
            purpose,
          };
          const decision = deriveCommunicationDecision(
            decisionArgs,
            purpose,
            (row?.status as CommunicationPreferenceStatus | undefined) ?? null,
            row?.id,
          );

          // Read-only, always-computed ground truth (not gated by the
          // reconciliation/enforcement rollout flags — same principle as
          // evaluateCommunicationPermission always computing the real answer).
          // smsOptOut is dormant with no write path today, but a stale
          // hard-restrictive legacy signal disagreeing with an explicit
          // central grant is a genuine data-integrity conflict staff need to
          // see, never silently resolved by the matrix display itself.
          const legacyConflict = channel === 'sms' && patient.smsOptOut && row?.status === 'granted'
            ? { detected: true as const, reasonCode: 'legacy_central_conflict' as const }
            : null;

          matrix.push({
            channel,
            purpose,
            isPolicyException: (POLICY_EXCEPTION_PURPOSES as readonly string[]).includes(purpose),
            decision,
            legacyConflict,
            preference: row
              ? {
                  id: row.id,
                  status: row.status,
                  effectiveAt: row.effectiveAt,
                  grantedAt: row.grantedAt,
                  withdrawnAt: row.withdrawnAt,
                  source: row.source,
                  evidenceType: row.evidenceType,
                  noticeVersion: row.noticeVersion,
                  actorUserId: row.actorUserId,
                  actorPlatformAdminId: row.actorPlatformAdminId,
                  updatedAt: row.updatedAt,
                }
              : null,
          });
        }
      }

      res.json({ patientId: patient.id, clinicId: patient.clinicId, matrix });
    } catch (err: any) {
      console.error('[communicationPreferences] matrix error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to load communication preferences' });
    }
  },
);

// ─── GET /api/patients/:patientId/communication-preferences/history ──────────

router.get(
  '/patients/:patientId/communication-preferences/history',
  authorize([...ROLES]),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'patientId');
    try {
      const patient = await loadScopedPatient(req, res, patientId);
      if (!patient) return;

      const { channel, purpose, status, source, cursor } = req.query as {
        channel?: string; purpose?: string; status?: string; source?: string; cursor?: string;
      };
      const where: any = { patientId: patient.id, clinicId: patient.clinicId };
      if (channel) where.channel = channel;
      if (purpose) where.purpose = purpose;
      if (status) where.newStatus = status;
      if (source) where.source = source;

      const rawLimit = Number(req.query.limit);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 50;

      const events = await prisma.patientCommunicationConsentEvent.findMany({
        where,
        orderBy: resolveCommunicationHistoryOrderBy(channel, purpose),
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const hasMore = events.length > limit;
      const page = hasMore ? events.slice(0, limit) : events;

      res.json({
        patientId: patient.id,
        events: page,
        pageInfo: { hasMore, nextCursor: hasMore ? page[page.length - 1]!.id : null, limit },
      });
    } catch (err: any) {
      console.error('[communicationPreferences] history error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to load communication consent history' });
    }
  },
);

// ─── GET /api/patients/:patientId/communication-preferences/export ───────────
// Full consent evidence export for one patient (current state + full history).

router.get(
  '/patients/:patientId/communication-preferences/export',
  authorize([...EXPORT_ROLES]),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'patientId');
    try {
      const patient = await loadScopedPatient(req, res, patientId);
      if (!patient) return;

      const [preferences, events] = await Promise.all([
        prisma.patientCommunicationPreference.findMany({
          where: { patientId: patient.id, clinicId: patient.clinicId },
        }),
        prisma.patientCommunicationConsentEvent.findMany({
          where: { patientId: patient.id, clinicId: patient.clinicId },
          // This dump spans every channel/purpose key for the patient, so
          // `revision` is NOT a global chronological sequence here — it is
          // only authoritative *within* one channel+purpose chain (see
          // communicationConsentAdmin.ts). createdAt gives a sensible
          // cross-key chronological order; channel/purpose/revision/id are
          // deterministic tie-breakers so two chains that tie on createdAt
          // (or a chain's own revision, e.g. both at revision 1) always come
          // back in the same order. Within a single key, this still matches
          // that key's authoritative revision order.
          orderBy: [
            { createdAt: 'asc' },
            { channel: 'asc' },
            { purpose: 'asc' },
            { revision: 'asc' },
            { id: 'asc' },
          ],
        }),
      ]);

      writeAuditLog({
        organizationId: patient.organizationId,
        clinicId: patient.clinicId,
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        action: 'communication_consent_evidence_exported',
        entityType: 'patient',
        entityId: patient.id,
        ...extractRequestMeta(req),
      });

      res.json({
        patientId: patient.id,
        clinicId: patient.clinicId,
        organizationId: patient.organizationId,
        exportedAt: new Date().toISOString(),
        preferences,
        events,
      });
    } catch (err: any) {
      console.error('[communicationPreferences] export error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to export communication consent evidence' });
    }
  },
);

// ─── PUT /api/patients/:patientId/communication-preferences/:channel/:purpose ─
// Grant / deny / withdraw / reset one channel+purpose preference.

type PreferenceMutationBody = {
  action?: SetPreferenceAction;
  source?: string;
  evidenceType?: string | null;
  noticeVersion?: string | null;
  policyVersion?: string | null;
  externalProviderRef?: string | null;
  notes?: string | null;
  captureRequestMeta?: boolean;
};

router.put(
  '/patients/:patientId/communication-preferences/:channel/:purpose',
  authorize([...ROLES]),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'patientId');
    const channel = getParam(req, 'channel');
    const purpose = getParam(req, 'purpose');
    const body = req.body as PreferenceMutationBody;

    try {
      if (!isCommunicationChannel(channel)) {
        return res.status(400).json({ errorCode: 'invalid_channel', error: `Unknown channel: ${channel}` });
      }
      if (!isCommunicationPurpose(purpose)) {
        return res.status(400).json({ errorCode: 'invalid_purpose', error: `Unknown purpose: ${purpose}` });
      }
      const action = body.action;
      if (!action || !['grant', 'deny', 'withdraw', 'reset'].includes(action)) {
        return res.status(400).json({ errorCode: 'invalid_transition', error: 'action must be one of grant|deny|withdraw|reset' });
      }

      const patient = await loadScopedPatient(req, res, patientId);
      if (!patient) return;

      const meta = extractRequestMeta(req);
      const outcome = await setCommunicationPreference({
        organizationId: patient.organizationId,
        clinicId: patient.clinicId,
        patientId: patient.id,
        channel,
        purpose,
        action,
        source: body.source ?? 'staff',
        evidenceType: body.evidenceType ?? null,
        noticeVersion: body.noticeVersion ?? null,
        policyVersion: body.policyVersion ?? null,
        actorUserId: req.user!.id,
        externalProviderRef: body.externalProviderRef ?? null,
        notes: body.notes ?? null,
        requestIpHash: body.captureRequestMeta ? hashEvidenceIp(meta.ipAddress) : null,
        userAgentHash: body.captureRequestMeta ? hashEvidenceUserAgent(meta.userAgent) : null,
      });

      writeAuditLog({
        organizationId: patient.organizationId,
        clinicId: patient.clinicId,
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        action: `communication_consent_${action}`,
        entityType: 'patient_communication_preference',
        entityId: outcome.preference.id,
        description: `${channel}/${purpose} → ${outcome.preference.status}`,
        ...meta,
      });

      res.json(outcome);
    } catch (err: any) {
      if (err instanceof CommunicationConsentAdminError) {
        return res.status(ADMIN_ERROR_STATUS[err.code] ?? 400).json({ errorCode: err.code, error: err.message });
      }
      console.error('[communicationPreferences] mutation error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to update communication preference' });
    }
  },
);

// ─── POST /api/patients/:patientId/communication-preferences/bulk ────────────

type BulkMutationBody = {
  items?: Array<{ channel?: string; purpose?: string; action?: SetPreferenceAction }>;
  source?: string;
  evidenceType?: string | null;
  noticeVersion?: string | null;
  policyVersion?: string | null;
  notes?: string | null;
};

router.post(
  '/patients/:patientId/communication-preferences/bulk',
  authorize([...ROLES]),
  async (req: AuthRequest, res: Response) => {
    const patientId = getParam(req, 'patientId');
    const body = req.body as BulkMutationBody;

    try {
      if (!Array.isArray(body.items) || body.items.length === 0) {
        return res.status(400).json({ errorCode: 'invalid_transition', error: 'items must be a non-empty array' });
      }
      if (body.items.length > 50) {
        return res.status(400).json({ errorCode: 'invalid_transition', error: 'A single bulk request supports at most 50 items' });
      }

      const patient = await loadScopedPatient(req, res, patientId);
      if (!patient) return;

      const items = body.items.map((item) => ({
        channel: String(item.channel ?? ''),
        purpose: String(item.purpose ?? ''),
        action: item.action as SetPreferenceAction,
      }));

      const results = await bulkSetCommunicationPreferences(
        {
          organizationId: patient.organizationId,
          clinicId: patient.clinicId,
          patientId: patient.id,
          source: body.source ?? 'staff',
          evidenceType: body.evidenceType ?? null,
          noticeVersion: body.noticeVersion ?? null,
          policyVersion: body.policyVersion ?? null,
          actorUserId: req.user!.id,
          notes: body.notes ?? null,
        },
        items,
      );

      writeAuditLog({
        organizationId: patient.organizationId,
        clinicId: patient.clinicId,
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        action: 'communication_consent_bulk_update',
        entityType: 'patient',
        entityId: patient.id,
        description: `bulk update: ${results.filter((r) => r.ok).length}/${results.length} succeeded`,
        ...extractRequestMeta(req),
      });

      res.json({ results });
    } catch (err: any) {
      console.error('[communicationPreferences] bulk mutation error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to apply bulk communication preference update' });
    }
  },
);

// ─── GET /api/clinics/:clinicId/communication-preferences/aggregate ──────────
// Clinic-level counts only — never exposes individual patient data.

router.get(
  '/clinics/:clinicId/communication-preferences/aggregate',
  authorize([...ROLES]),
  async (req: AuthRequest, res: Response) => {
    const clinicId = getParam(req, 'clinicId');
    try {
      const orgId = req.user!.organizationId;
      const clinic = await prisma.clinic.findFirst({ where: { id: clinicId, organizationId: orgId }, select: { id: true } });
      if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
      if (!req.user!.canAccessAllClinics && !req.user!.allowedClinicIds.includes(clinicId)) {
        return res.status(403).json({ error: 'Access denied to this clinic' });
      }

      const grouped = await prisma.patientCommunicationPreference.groupBy({
        by: ['channel', 'purpose', 'status'],
        where: { clinicId },
        _count: { _all: true },
      });

      res.json({
        clinicId,
        counts: grouped.map((g) => ({
          channel: g.channel,
          purpose: g.purpose,
          status: g.status,
          count: g._count._all,
        })),
      });
    } catch (err: any) {
      console.error('[communicationPreferences] aggregate error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to load communication preference aggregate' });
    }
  },
);

// ─── GET /api/communication-consent/audit-summary ────────────────────────────
// Bounded audit-mode observability summary — see communicationConsentAuditReport.ts.
// Elevated-role only: this is operational rollout tooling, not day-to-day patient care.

router.get(
  '/communication-consent/audit-summary',
  authorize(['OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    try {
      const { clinicId, since, until } = req.query as { clinicId?: string; since?: string; until?: string };
      if (clinicId && !req.user!.canAccessAllClinics && !req.user!.allowedClinicIds.includes(clinicId)) {
        return res.status(403).json({ error: 'Access denied to this clinic' });
      }

      const summary = await getCommunicationConsentAuditSummary({
        organizationId: req.user!.organizationId,
        clinicId,
        since: since ? new Date(since) : undefined,
        until: until ? new Date(until) : undefined,
      });

      res.json(summary);
    } catch (err: any) {
      if (err instanceof CommunicationConsentAuditReportError) {
        return res.status(400).json({ error: err.message });
      }
      console.error('[communicationPreferences] audit-summary error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to load communication consent audit summary' });
    }
  },
);

export default router;
