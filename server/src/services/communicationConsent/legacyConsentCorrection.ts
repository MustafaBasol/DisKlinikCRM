/**
 * legacyConsentCorrection.ts — KVKK-HIGH-008: audited correction workflow for
 * stale/incorrect legacy consent signals (currently only Patient.smsOptOut).
 *
 * This is deliberately NOT part of the central consent system
 * (communicationConsentAdmin.ts / PatientCommunicationPreference /
 * PatientCommunicationConsentEvent):
 *   - it never calls setCommunicationPreference and never creates/alters a
 *     PatientCommunicationPreference row;
 *   - it never grants consent — correcting a stale legacy restriction is not
 *     the same claim as "the patient affirmatively consented";
 *   - every correction is recorded in a dedicated immutable
 *     PatientLegacyConsentCorrection row (create-only — no update/delete path
 *     exists or should ever exist for that model).
 *
 * Scope/authorization ordering (KVKK-HIGH-008 review requirement): callers
 * MUST authorize the role and resolve organizationId/clinicId for this
 * patient (see communicationPreferences.ts's loadScopedPatient) BEFORE
 * calling into this module. Nothing here re-derives caller identity — every
 * function takes an already-authorized organizationId/clinicId/patientId.
 * This is what prevents a cross-tenant caller from ever reaching the
 * idempotency-replay lookup below (see correctSmsOptOut's Layer 1).
 *
 * Idempotency: client-supplied idempotencyKey, unique per
 * (organizationId, patientId, idempotencyKey). A replay of the exact same
 * logical request (same key + same canonical payload fingerprint) returns the
 * original result; the same key with different content is rejected as
 * idempotency_conflict. See computeRequestFingerprint below for the exact
 * canonicalization — it is never returned or logged.
 *
 * Concurrency: the Patient.smsOptOut flip is guarded by a conditional
 * `updateMany` (WHERE smsOptOut = true) inside the same transaction as the
 * correction-row insert — this codebase has no version-column convention
 * (see clinicBulkExportPackage.ts for the same WHERE-guarded-updateMany
 * idiom), so a lost race always resolves to a definitive
 * stale_legacy_signal_state or idempotent replay, never a lost update.
 */

import { createHash } from 'node:crypto';
import prisma from '../../db.js';
import type { Prisma } from '@prisma/client';
import { sanitizeConsentNote } from './consentEvidenceSanitizer.js';
import { getPlatformSetting } from '../platformSettings.js';

// ── KVKK-HIGH-008-F1: runtime activation control (kill switch) ─────────────
//
// Same PlatformSetting-backed pattern as privacy.dataRetention.runtimeEnabled
// (see platformAdmin.ts) — no caching, so a toggle takes effect on the very
// next request. Default-deny: an absent row (production's actual current
// state — no migration adds one) reads as `null`, which is treated as
// disabled, same as an explicit 'false'. Only the exact string 'true' enables
// the mutation route.
export const LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY = 'privacy.legacyConsentCorrection.runtimeEnabled';

export async function isLegacyConsentCorrectionRuntimeEnabled(): Promise<boolean> {
  const value = await getPlatformSetting(LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY);
  return value === 'true';
}

export const LEGACY_CORRECTION_EVIDENCE_TYPES = [
  'patient_verbal_confirmation',
  'signed_form',
  'documented_import_error',
  'other_verified_source',
] as const;
export type LegacyCorrectionEvidenceType = (typeof LEGACY_CORRECTION_EVIDENCE_TYPES)[number];

export function isLegacyCorrectionEvidenceType(value: unknown): value is LegacyCorrectionEvidenceType {
  return typeof value === 'string' && (LEGACY_CORRECTION_EVIDENCE_TYPES as readonly string[]).includes(value);
}

export type LegacyConsentCorrectionErrorCode =
  | 'legacy_signal_not_present'
  | 'legacy_signal_already_corrected'
  | 'stale_legacy_signal_state'
  | 'correction_notes_required'
  | 'correction_reason_required'
  | 'invalid_evidence_type'
  | 'unsafe_note'
  | 'patient_not_found'
  | 'clinic_scope_mismatch'
  | 'idempotency_conflict';

export class LegacyConsentCorrectionError extends Error {
  code: LegacyConsentCorrectionErrorCode;
  constructor(code: LegacyConsentCorrectionErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'LegacyConsentCorrectionError';
  }
}

const isPrismaUniqueConstraintError = (error: unknown) =>
  Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'P2002');

function toIsoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

// ── requestFingerprint canonicalization ────────────────────────────────────
//
// Fixed-order tuple array (never relies on object-key iteration order),
// SHA-256, explicit UTF-8. Deliberately EXCLUDES organizationId/clinicId/
// patientId/correctedById/idempotencyKey/createdAt — identity/scope is
// already pinned by the (organizationId, patientId, idempotencyKey) unique
// key and by route-level authorization; this fingerprint's only job is
// detecting whether a reused key carries the same logical correction
// content. Normalization is deliberately conservative (exact string after
// zod's trim + sanitizeConsentNote's redaction, no case-folding, no Unicode
// normalization) so materially different staff-written evidence can never
// collapse to the same fingerprint. Never returned in any API response or
// written to any log.
export function canonicalizeCorrectionPayload(input: {
  correctionReason: string;
  evidenceType: string;
  sourceReference: string | null;
  notes: string;
  expectedSmsOptOutAt?: string | null;
}): string {
  const tuples: [string, string][] = [
    ['fieldName', 'SMS_OPT_OUT'],
    ['expectedCurrentValue', 'true'],
    [
      'expectedSmsOptOutAt',
      input.expectedSmsOptOutAt === undefined
        ? '__omitted__'
        : input.expectedSmsOptOutAt === null
          ? '__null__'
          : input.expectedSmsOptOutAt,
    ],
    ['correctionReason', input.correctionReason],
    ['evidenceType', input.evidenceType],
    ['sourceReference', input.sourceReference == null ? '__none__' : input.sourceReference],
    ['notes', input.notes],
  ];
  return JSON.stringify(tuples);
}

export function computeRequestFingerprint(input: {
  correctionReason: string;
  evidenceType: string;
  sourceReference: string | null;
  notes: string;
  expectedSmsOptOutAt?: string | null;
}): string {
  return createHash('sha256').update(canonicalizeCorrectionPayload(input), 'utf8').digest('hex');
}

// ── correctSmsOptOut ────────────────────────────────────────────────────────

export type CorrectSmsOptOutArgs = {
  /** Already authorized by the caller (loadScopedPatient) — never re-derived here. */
  organizationId: string;
  clinicId: string;
  patientId: string;
  correctionReason: string;
  evidenceType: string;
  sourceReference?: string | null;
  notes: string;
  /** Schema enforces literal `true` upstream; re-checked here defensively. */
  expectedCurrentValue: true;
  /** Optional stronger token — see docs/compliance write-up for the stated limitation (always null today). */
  expectedSmsOptOutAt?: string | null;
  correctedById: string;
  idempotencyKey: string;
};

export type LegacyConsentCorrectionRecord = {
  id: string;
  organizationId: string;
  clinicId: string;
  patientId: string;
  fieldName: 'SMS_OPT_OUT';
  previousValue: boolean;
  newValue: boolean;
  previousRecordedAt: Date | null;
  evidenceType: string;
  correctedById: string;
  createdAt: Date;
};

export type CorrectSmsOptOutResult = {
  replay: boolean;
  correction: LegacyConsentCorrectionRecord;
};

function toRecord(row: {
  id: string; organizationId: string; clinicId: string; patientId: string;
  fieldName: string; previousValue: boolean; newValue: boolean;
  previousRecordedAt: Date | null; evidenceType: string; correctedById: string; createdAt: Date;
}): LegacyConsentCorrectionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    clinicId: row.clinicId,
    patientId: row.patientId,
    fieldName: 'SMS_OPT_OUT',
    previousValue: row.previousValue,
    newValue: row.newValue,
    previousRecordedAt: row.previousRecordedAt,
    evidenceType: row.evidenceType,
    correctedById: row.correctedById,
    createdAt: row.createdAt,
  };
}

async function fireAndForgetActivityLog(
  correction: LegacyConsentCorrectionRecord,
  actorUserId: string,
): Promise<void> {
  // Best-effort, non-transactional operational projection — see module doc
  // comment / docs/compliance write-up. logActivity uses its own separate
  // PrismaClient and swallows its own errors; it is structurally incapable of
  // joining the main $transaction, unlike writeAuditLogInTx. If this fails,
  // the correction row + AuditLog entry (already committed) remain the sole
  // authoritative evidence — only the clinic activity feed entry is missing.
  const { logActivity } = await import('../../utils/activity.js');
  await logActivity({
    clinicId: correction.clinicId,
    userId: actorUserId,
    entityType: 'patient',
    entityId: correction.patientId,
    patientId: correction.patientId,
    action: 'legacy_sms_opt_out_corrected',
    description: 'Eski SMS engelleme kaydı hatalı/güncel değil olarak işaretlendi.',
  });
}

/**
 * Marks a patient's legacy Patient.smsOptOut=true as stale/incorrect.
 * Flips it to false and records an immutable PatientLegacyConsentCorrection
 * row in the same transaction. Never touches PatientCommunicationPreference /
 * PatientCommunicationConsentEvent and never grants consent.
 */
export async function correctSmsOptOut(input: CorrectSmsOptOutArgs): Promise<CorrectSmsOptOutResult> {
  if (!input.correctionReason?.trim()) {
    throw new LegacyConsentCorrectionError('correction_reason_required', 'A correction reason is required.');
  }
  if (!input.notes?.trim()) {
    throw new LegacyConsentCorrectionError('correction_notes_required', 'Staff notes explaining why the old signal is stale are required.');
  }
  if (!isLegacyCorrectionEvidenceType(input.evidenceType)) {
    throw new LegacyConsentCorrectionError('invalid_evidence_type', `Unknown evidenceType: ${input.evidenceType}`);
  }

  const sanitizedReason = sanitizeConsentNote(input.correctionReason);
  if (!sanitizedReason.ok || !sanitizedReason.note) {
    throw new LegacyConsentCorrectionError('unsafe_note', 'Correction reason contains disallowed secret-like content and was rejected.');
  }
  const sanitizedNotes = sanitizeConsentNote(input.notes);
  if (!sanitizedNotes.ok || !sanitizedNotes.note) {
    throw new LegacyConsentCorrectionError('unsafe_note', 'Notes contain disallowed secret-like content and were rejected.');
  }
  const sourceReference = input.sourceReference?.trim() || null;

  const requestFingerprint = computeRequestFingerprint({
    correctionReason: sanitizedReason.note,
    evidenceType: input.evidenceType,
    sourceReference,
    notes: sanitizedNotes.note,
    expectedSmsOptOutAt: input.expectedSmsOptOutAt,
  });

  // ── Layer 1 — cheap pre-check, ALREADY scoped by the caller-supplied,
  // pre-authorized organizationId/patientId (see module doc comment: this
  // function must never be reached by an unauthorized caller in the first
  // place). Handles the common sequential-retry case without touching the
  // Patient row at all.
  const existing = await prisma.patientLegacyConsentCorrection.findUnique({
    where: {
      organizationId_patientId_idempotencyKey: {
        organizationId: input.organizationId,
        patientId: input.patientId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) {
    if (existing.clinicId !== input.clinicId) {
      // Defense in depth: cannot happen given a patient's clinicId is fixed,
      // but never trust a cross-clinic match blindly.
      throw new LegacyConsentCorrectionError('clinic_scope_mismatch', 'Correction record clinic scope mismatch.');
    }
    if (existing.requestFingerprint === requestFingerprint) {
      return { replay: true, correction: toRecord(existing) };
    }
    throw new LegacyConsentCorrectionError('idempotency_conflict', 'This idempotency key was already used with different correction content.');
  }

  // ── Layer 2 — single interactive transaction, re-reads fresh.
  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const patient = await tx.patient.findFirst({
        where: { id: input.patientId, organizationId: input.organizationId, clinicId: input.clinicId },
        select: { smsOptOut: true, smsOptOutAt: true },
      });
      if (!patient) {
        throw new LegacyConsentCorrectionError('clinic_scope_mismatch', 'Patient not found in this organization/clinic scope.');
      }

      if (patient.smsOptOut !== true) {
        const prior = await tx.patientLegacyConsentCorrection.findFirst({
          where: { organizationId: input.organizationId, patientId: input.patientId, fieldName: 'SMS_OPT_OUT' },
        });
        throw new LegacyConsentCorrectionError(
          prior ? 'legacy_signal_already_corrected' : 'legacy_signal_not_present',
          prior
            ? 'This legacy signal was already corrected previously.'
            : 'Patient.smsOptOut is not currently true — nothing to correct.',
        );
      }

      if (input.expectedSmsOptOutAt !== undefined && toIsoOrNull(patient.smsOptOutAt) !== input.expectedSmsOptOutAt) {
        throw new LegacyConsentCorrectionError('stale_legacy_signal_state', 'The expected prior smsOptOutAt no longer matches the current value.');
      }

      // The atomic guard: only succeeds if smsOptOut is STILL true right now.
      const updated = await tx.patient.updateMany({
        where: { id: input.patientId, organizationId: input.organizationId, clinicId: input.clinicId, smsOptOut: true },
        data: { smsOptOut: false, smsOptOutAt: null },
      });

      if (updated.count === 0) {
        // Lost a race since the findFirst above. Distinguish "a concurrent
        // duplicate of THIS exact request already won" (idempotent success)
        // from "a genuinely different request won" (real staleness) — both
        // are non-throwing lookups, safe to keep querying inside this tx.
        const winner = await tx.patientLegacyConsentCorrection.findUnique({
          where: {
            organizationId_patientId_idempotencyKey: {
              organizationId: input.organizationId,
              patientId: input.patientId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (winner && winner.clinicId === input.clinicId && winner.requestFingerprint === requestFingerprint) {
          return { replay: true, correction: toRecord(winner) };
        }
        if (winner) {
          throw new LegacyConsentCorrectionError('idempotency_conflict', 'This idempotency key was already used with different correction content.');
        }
        throw new LegacyConsentCorrectionError('stale_legacy_signal_state', 'The legacy signal was changed by another request.');
      }

      // Terminal statement of the transaction. A P2002 here (only reachable
      // via an astronomically tight window not covered by the count-check
      // above) propagates OUT of $transaction uncaught — Prisma rolls back
      // everything including the updateMany above. No further query is
      // attempted inside this tx after an error; the outer catch below runs
      // a FRESH, separate, non-transactional query.
      const correction = await tx.patientLegacyConsentCorrection.create({
        data: {
          organizationId: input.organizationId,
          clinicId: input.clinicId,
          patientId: input.patientId,
          fieldName: 'SMS_OPT_OUT',
          previousValue: true,
          newValue: false,
          previousRecordedAt: patient.smsOptOutAt,
          correctionReason: sanitizedReason.note!,
          evidenceType: input.evidenceType,
          sourceReference,
          notes: sanitizedNotes.note!,
          correctedById: input.correctedById,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint,
        },
      });

      const { writeAuditLogInTx } = await import('../../utils/auditLog.js');
      await writeAuditLogInTx(tx, {
        organizationId: input.organizationId,
        clinicId: input.clinicId,
        actorUserId: input.correctedById,
        action: 'patient_legacy_sms_opt_out_corrected',
        entityType: 'Patient',
        entityId: input.patientId,
        description: 'Legacy SMS opt-out signal corrected (marked stale).',
        metadata: {
          correctionId: correction.id,
          fieldName: 'SMS_OPT_OUT',
          previousValue: true,
          newValue: false,
          evidenceType: input.evidenceType,
        },
      });

      return { replay: false, correction: toRecord(correction) };
    });

    if (!result.replay) {
      fireAndForgetActivityLog(result.correction, input.correctedById).catch(() => {});
    }
    return result;
  } catch (err) {
    if (isPrismaUniqueConstraintError(err)) {
      const winner = await prisma.patientLegacyConsentCorrection.findUnique({
        where: {
          organizationId_patientId_idempotencyKey: {
            organizationId: input.organizationId,
            patientId: input.patientId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (winner?.clinicId === input.clinicId && winner.requestFingerprint === requestFingerprint) {
        return { replay: true, correction: toRecord(winner) };
      }
      if (winner) {
        throw new LegacyConsentCorrectionError('idempotency_conflict', 'This idempotency key was already used with different correction content.');
      }
      // Defensive: constraint violated but row not found is a contradiction
      // for an insert-only table with no delete path.
      throw err;
    }
    throw err;
  }
}

// ── History (list + detail) ─────────────────────────────────────────────────

export type LegacyConsentCorrectionSummary = {
  id: string;
  fieldName: string;
  previousValue: boolean;
  newValue: boolean;
  previousRecordedAt: Date | null;
  evidenceType: string;
  correctedById: string;
  createdAt: Date;
};

const SUMMARY_SELECT = {
  id: true,
  fieldName: true,
  previousValue: true,
  newValue: true,
  previousRecordedAt: true,
  evidenceType: true,
  correctedById: true,
  createdAt: true,
} as const;

export async function listLegacyConsentCorrections(args: {
  organizationId: string;
  clinicId: string;
  patientId: string;
  cursor?: string;
  limit?: number;
}): Promise<{ items: LegacyConsentCorrectionSummary[]; hasMore: boolean; nextCursor: string | null }> {
  const limit = Number.isFinite(args.limit) && (args.limit as number) > 0 ? Math.min(Math.floor(args.limit as number), 50) : 20;

  const rows = await prisma.patientLegacyConsentCorrection.findMany({
    where: { organizationId: args.organizationId, clinicId: args.clinicId, patientId: args.patientId },
    select: SUMMARY_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { items: page, hasMore, nextCursor: hasMore ? page[page.length - 1]!.id : null };
}

export type LegacyConsentCorrectionDetail = LegacyConsentCorrectionSummary & {
  correctionReason: string;
  notes: string;
  sourceReference: string | null;
};

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  correctionReason: true,
  notes: true,
  sourceReference: true,
} as const;

export async function getLegacyConsentCorrectionDetail(args: {
  organizationId: string;
  clinicId: string;
  patientId: string;
  correctionId: string;
}): Promise<LegacyConsentCorrectionDetail | null> {
  return prisma.patientLegacyConsentCorrection.findFirst({
    where: {
      id: args.correctionId,
      organizationId: args.organizationId,
      clinicId: args.clinicId,
      patientId: args.patientId,
    },
    select: DETAIL_SELECT,
  });
}
