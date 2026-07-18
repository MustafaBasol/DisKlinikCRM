/**
 * communicationConsentAdmin.ts - Mutation service for
 * PatientCommunicationPreference / PatientCommunicationConsentEvent
 * (KVKK-HIGH-007).
 *
 * Every mutation:
 *   - validates channel/purpose against the closed taxonomy
 *   - acquires a pg_advisory_xact_lock keyed to the patient+clinic+channel+
 *     purpose tuple as the FIRST statement of its transaction (see
 *     computeCommunicationPreferenceLockKey/acquireCommunicationPreferenceLock
 *     below), so concurrent grant/withdraw/deny calls for the same key are
 *     fully serialized — not just the final upsert. This makes the read of
 *     the current row, the upsert, and the revision/event insert a true
 *     critical section: previousStatus is always the actually-preceding
 *     committed state, never a stale pre-lock read.
 *   - assigns a monotonic per-key `revision` (see schema.prisma comments) to
 *     both the current row and the event row written in the same
 *     transaction. `revision`, not createdAt, is the authoritative order for
 *     a key's history — Postgres TIMESTAMP(3) is millisecond-precision and
 *     can tie under fast concurrent transitions.
 *   - sanitizes notes and never persists raw IP/user-agent
 *   - never overwrites or deletes prior PatientCommunicationConsentEvent rows
 *   - enforces the notice-version/evidence matrix for `grant` (see
 *     DIGITAL_GRANT_SOURCES below, plus the staff-source check inline) —
 *     never for deny/withdraw, so an opt-out is never blocked on paperwork
 */

import { createHash } from 'node:crypto';
import prisma from '../../db.js';
import type { Prisma } from '@prisma/client';
import {
  isCommunicationChannel,
  isCommunicationPurpose,
  isPolicyExceptionPurpose,
  isCommunicationConsentSource,
  type CommunicationPreferenceStatus,
} from './taxonomy.js';
import { sanitizeConsentNote } from './consentEvidenceSanitizer.js';

export type CommunicationConsentAdminErrorCode =
  | 'invalid_channel'
  | 'invalid_purpose'
  | 'invalid_transition'
  | 'scope_denied'
  | 'evidence_required'
  | 'notice_version_required'
  | 'unsafe_note'
  | 'preference_not_found';

export class CommunicationConsentAdminError extends Error {
  code: CommunicationConsentAdminErrorCode;
  constructor(code: CommunicationConsentAdminErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'CommunicationConsentAdminError';
  }
}

export type SetPreferenceAction = 'grant' | 'deny' | 'withdraw' | 'reset';

const ACTION_TO_STATUS: Record<SetPreferenceAction, CommunicationPreferenceStatus> = {
  grant: 'granted',
  deny: 'denied',
  withdraw: 'withdrawn',
  reset: 'unknown',
};

/** Actions that require explicit evidence — an unattributed reset to unknown does not. */
const EVIDENCE_REQUIRED_ACTIONS: readonly SetPreferenceAction[] = ['grant', 'deny', 'withdraw'];

export type SetPreferenceArgs = {
  organizationId: string;
  clinicId: string;
  patientId: string;
  channel: string;
  purpose: string;
  action: SetPreferenceAction;
  source: string;
  evidenceType?: string | null;
  noticeVersion?: string | null;
  policyVersion?: string | null;
  actorUserId?: string | null;
  actorPlatformAdminId?: string | null;
  requestIpHash?: string | null;
  userAgentHash?: string | null;
  externalProviderRef?: string | null;
  notes?: string | null;
};

export type SetPreferenceResult = {
  preference: {
    id: string;
    status: CommunicationPreferenceStatus;
    channel: string;
    purpose: string;
    effectiveAt: Date;
    grantedAt: Date | null;
    withdrawnAt: Date | null;
    source: string;
    evidenceType: string | null;
    noticeVersion: string | null;
    updatedAt: Date;
    revision: number;
  };
  eventId: string;
};

function validateTaxonomy(channel: string, purpose: string): void {
  if (!isCommunicationChannel(channel)) {
    throw new CommunicationConsentAdminError('invalid_channel', `Unknown communication channel: ${channel}`);
  }
  if (!isCommunicationPurpose(purpose)) {
    throw new CommunicationConsentAdminError('invalid_purpose', `Unknown communication purpose: ${purpose}`);
  }
}

// ── Advisory lock ─────────────────────────────────────────────────────────────

/**
 * Computes a deterministic [key1, key2] pair for pg_advisory_xact_lock(int4, int4),
 * scoped to one patient+clinic+channel+purpose preference key.
 *
 * Domain-separated (a fixed "comm-consent-pref:" prefix) from other advisory
 * locks in this codebase (e.g. appointmentRequestSafety.ts's slot lock) so the
 * two lock domains can never collide even if their other components happened
 * to match. Same clinic/channel/purpose/patient → same key pair; anything
 * different → a different key pair (collision probability negligible).
 *
 * Exported for unit testing only.
 */
export function computeCommunicationPreferenceLockKey(
  patientId: string,
  clinicId: string,
  channel: string,
  purpose: string,
): [number, number] {
  const keyString = `comm-consent-pref:${patientId}:${clinicId}:${channel}:${purpose}`;
  const hash = createHash('sha256').update(keyString, 'utf8').digest();
  // readInt32BE returns signed values in [-2147483648, 2147483647] — valid PostgreSQL int4
  const key1 = hash.readInt32BE(0);
  const key2 = hash.readInt32BE(4);
  return [key1, key2];
}

/**
 * Acquires a PostgreSQL advisory transaction lock for one preference key.
 *
 * MUST be called as the FIRST statement inside setCommunicationPreference's
 * $transaction callback, before any read of the current row. Concurrent
 * transactions for the same key serialize here; the lock releases
 * automatically on commit or rollback. Different keys never block each other.
 */
async function acquireCommunicationPreferenceLock(
  tx: Prisma.TransactionClient,
  patientId: string,
  clinicId: string,
  channel: string,
  purpose: string,
): Promise<void> {
  const [key1, key2] = computeCommunicationPreferenceLockKey(patientId, clinicId, channel, purpose);
  // pg_advisory_xact_lock(int4,int4): explicit casts required — Prisma binds
  // JS numbers as int8 by default, but PostgreSQL has no (bigint,bigint) overload.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key1}::int4, ${key2}::int4)`;
}

// ── Timestamp policy (Blocker 4) ───────────────────────────────────────────────

/**
 * Exact, documented timestamp policy per status (see
 * docs/compliance/56-kvkk-communication-preference-and-consent-management.md):
 *
 *  - granted:   grantedAt = now, withdrawnAt = null (never a stale prior withdrawal)
 *  - withdrawn: withdrawnAt = now. grantedAt is PRESERVED on an update (evidence
 *               of when the later-withdrawn consent was originally granted —
 *               unambiguous once withdrawnAt + status='withdrawn' are set); on
 *               a first-ever create (no prior grant on record), grantedAt = null.
 *  - denied:    both null — a denial must never retain a stale withdrawnAt or a
 *               misleading active grantedAt.
 *  - unknown (reset): both null, same reasoning as denied.
 *
 * `not_required` is intentionally not handled here — ACTION_TO_STATUS never
 * maps a user action to it, so it is structurally unreachable through this
 * function.
 */
function statusTimestampFields(
  newStatus: CommunicationPreferenceStatus,
  nowDate: Date,
  mode: 'create' | 'update',
): { grantedAt?: Date | null; withdrawnAt?: Date | null } {
  switch (newStatus) {
    case 'granted':
      return { grantedAt: nowDate, withdrawnAt: null };
    case 'withdrawn':
      return mode === 'create' ? { grantedAt: null, withdrawnAt: nowDate } : { withdrawnAt: nowDate };
    case 'denied':
    case 'unknown':
      return { grantedAt: null, withdrawnAt: null };
    default:
      return {};
  }
}

// ── Notice-version / evidence matrix (Blocker 5) ───────────────────────────────

/**
 * Digital/patient-facing sources — a `grant` recorded from one of these
 * requires a `noticeVersion` (or documented-equivalent evidence reference).
 * Deliberately narrower than the full source list: `api`/`import`/`legacy`/
 * `system` grants are not forced to supply one (explicit scope decision, see
 * the compliance doc's notice-version evidence matrix).
 */
const DIGITAL_GRANT_SOURCES: readonly string[] = [
  'patient_portal',
  'public_booking',
  'whatsapp',
  'sms_keyword',
  'email_unsubscribe',
];

/**
 * Grant/deny/withdraw/reset a single patient+clinic+channel+purpose
 * preference. Runs the advisory lock + upsert + event insert in one
 * transaction.
 */
export async function setCommunicationPreference(
  args: SetPreferenceArgs,
): Promise<SetPreferenceResult> {
  validateTaxonomy(args.channel, args.purpose);

  if (isPolicyExceptionPurpose(args.purpose as any)) {
    throw new CommunicationConsentAdminError(
      'invalid_purpose',
      `"${args.purpose}" is a policy-exception purpose (always allowed) and does not accept explicit preference records.`,
    );
  }

  if (!isCommunicationConsentSource(args.source)) {
    throw new CommunicationConsentAdminError('invalid_transition', `Unknown consent source: ${args.source}`);
  }

  if (EVIDENCE_REQUIRED_ACTIONS.includes(args.action) && !args.evidenceType?.trim()) {
    throw new CommunicationConsentAdminError(
      'evidence_required',
      `Recording a "${args.action}" decision requires an evidenceType (e.g. verbal_staff_record, signed_form, portal_click).`,
    );
  }

  const sanitized = sanitizeConsentNote(args.notes ?? null);
  if (!sanitized.ok) {
    throw new CommunicationConsentAdminError('unsafe_note', 'Note contains disallowed secret-like content and was rejected.');
  }

  const patient = await prisma.patient.findFirst({
    where: { id: args.patientId, deletedAt: null },
    select: { id: true, clinicId: true, organizationId: true },
  });
  if (!patient || patient.organizationId !== args.organizationId) {
    throw new CommunicationConsentAdminError('scope_denied', 'Patient not found in this organization.');
  }
  if (patient.clinicId !== args.clinicId) {
    const linked = await prisma.patientClinic.findFirst({
      where: { patientId: args.patientId, clinicId: args.clinicId },
      select: { id: true },
    });
    if (!linked) {
      throw new CommunicationConsentAdminError('scope_denied', 'Patient is not linked to this clinic.');
    }
  }

  // Notice-version / evidence matrix — grant only, and only once scope is
  // confirmed; deny/withdraw/reset never require noticeVersion or a source
  // description, so an opt-out is never blocked on paperwork.
  if (args.action === 'grant') {
    if (DIGITAL_GRANT_SOURCES.includes(args.source) && !args.noticeVersion?.trim()) {
      throw new CommunicationConsentAdminError(
        'notice_version_required',
        `Recording a "grant" from source "${args.source}" requires a noticeVersion (the notice/KVKK text version shown at the time of the decision).`,
      );
    }
    if (args.source === 'staff' && !sanitized.note) {
      throw new CommunicationConsentAdminError(
        'evidence_required',
        'Recording a staff-verbal "grant" requires a bounded source description in notes (what was said/shown, and when).',
      );
    }
  }

  const newStatus = ACTION_TO_STATUS[args.action];

  const sharedFields = {
    source: args.source,
    evidenceType: args.evidenceType ?? null,
    noticeVersion: args.noticeVersion ?? null,
    policyVersion: args.policyVersion ?? null,
    actorUserId: args.actorUserId ?? null,
    actorPlatformAdminId: args.actorPlatformAdminId ?? null,
    requestIpHash: args.requestIpHash ?? null,
    userAgentHash: args.userAgentHash ?? null,
    externalProviderRef: args.externalProviderRef ?? null,
    notes: sanitized.note,
  };

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // MUST be the first statement: serializes every concurrent call for this
    // exact patient+clinic+channel+purpose key. Everything below this line is
    // now a true critical section for that key.
    await acquireCommunicationPreferenceLock(tx, args.patientId, args.clinicId, args.channel, args.purpose);

    // Computed only after the lock is held, so a caller that had to wait
    // cannot record an earlier transition time than one that committed while
    // it waited.
    const nowDate = new Date();

    const existing = await tx.patientCommunicationPreference.findUnique({
      where: {
        patientId_clinicId_channel_purpose: {
          patientId: args.patientId,
          clinicId: args.clinicId,
          channel: args.channel,
          purpose: args.purpose,
        },
      },
      select: { id: true, status: true, revision: true },
    });

    // Serialized by the lock above, so no two concurrent callers for this key
    // can ever read the same `existing.revision` — contiguous, gap-free,
    // duplicate-free by construction (the @@unique([preferenceId, revision])
    // constraint is defense in depth, not the primary mechanism).
    const newRevision = (existing?.revision ?? 0) + 1;
    const timestampFields = statusTimestampFields(newStatus, nowDate, existing ? 'update' : 'create');

    const preference = await tx.patientCommunicationPreference.upsert({
      where: {
        patientId_clinicId_channel_purpose: {
          patientId: args.patientId,
          clinicId: args.clinicId,
          channel: args.channel,
          purpose: args.purpose,
        },
      },
      create: {
        organizationId: args.organizationId,
        clinicId: args.clinicId,
        patientId: args.patientId,
        channel: args.channel,
        purpose: args.purpose,
        status: newStatus,
        effectiveAt: nowDate,
        revision: newRevision,
        ...timestampFields,
        ...sharedFields,
      },
      update: {
        status: newStatus,
        effectiveAt: nowDate,
        revision: newRevision,
        ...timestampFields,
        ...sharedFields,
      },
    });

    const event = await tx.patientCommunicationConsentEvent.create({
      data: {
        organizationId: args.organizationId,
        clinicId: args.clinicId,
        patientId: args.patientId,
        preferenceId: preference.id,
        channel: args.channel,
        purpose: args.purpose,
        previousStatus: existing?.status ?? null,
        newStatus,
        revision: newRevision,
        ...sharedFields,
      },
      select: { id: true, revision: true },
    });

    return { preference, eventId: event.id, revision: event.revision };
  });

  return {
    preference: {
      id: result.preference.id,
      status: result.preference.status as CommunicationPreferenceStatus,
      channel: result.preference.channel,
      purpose: result.preference.purpose,
      effectiveAt: result.preference.effectiveAt,
      grantedAt: result.preference.grantedAt,
      withdrawnAt: result.preference.withdrawnAt,
      source: result.preference.source,
      evidenceType: result.preference.evidenceType,
      noticeVersion: result.preference.noticeVersion,
      updatedAt: result.preference.updatedAt,
      revision: result.preference.revision,
    },
    eventId: result.eventId,
  };
}

export type BulkSetPreferenceItem = {
  channel: string;
  purpose: string;
  action: SetPreferenceAction;
};

export type BulkSetPreferenceResult = {
  channel: string;
  purpose: string;
  ok: boolean;
  preferenceId?: string;
  eventId?: string;
  errorCode?: CommunicationConsentAdminErrorCode;
  errorMessage?: string;
};

/**
 * Apply several channel/purpose preference changes for one patient. Each
 * item is applied independently (its own transaction) so one invalid entry
 * never rolls back the others — the caller gets a per-item result list.
 */
export async function bulkSetCommunicationPreferences(
  base: Omit<SetPreferenceArgs, 'channel' | 'purpose' | 'action'>,
  items: BulkSetPreferenceItem[],
): Promise<BulkSetPreferenceResult[]> {
  const results: BulkSetPreferenceResult[] = [];
  for (const item of items) {
    try {
      const outcome = await setCommunicationPreference({
        ...base,
        channel: item.channel,
        purpose: item.purpose,
        action: item.action,
      });
      results.push({
        channel: item.channel,
        purpose: item.purpose,
        ok: true,
        preferenceId: outcome.preference.id,
        eventId: outcome.eventId,
      });
    } catch (err) {
      if (err instanceof CommunicationConsentAdminError) {
        results.push({
          channel: item.channel,
          purpose: item.purpose,
          ok: false,
          errorCode: err.code,
          errorMessage: err.message,
        });
      } else {
        throw err;
      }
    }
  }
  return results;
}
