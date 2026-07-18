/**
 * communicationConsentAdmin.ts - Mutation service for
 * PatientCommunicationPreference / PatientCommunicationConsentEvent
 * (KVKK-HIGH-007).
 *
 * Every mutation:
 *   - validates channel/purpose against the closed taxonomy
 *   - upserts the current-state row and inserts an immutable history event
 *     in a single transaction (upsert compiles to an atomic
 *     INSERT ... ON CONFLICT DO UPDATE, so concurrent grant/withdraw races on
 *     the same patient+clinic+channel+purpose resolve to exactly one row -
 *     see @@unique([patientId, clinicId, channel, purpose]) in schema.prisma)
 *   - sanitizes notes and never persists raw IP/user-agent
 *   - never overwrites or deletes prior PatientCommunicationConsentEvent rows
 */

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

/**
 * Grant/deny/withdraw/reset a single patient+clinic+channel+purpose
 * preference. Runs the upsert + event insert in one transaction.
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

  const newStatus = ACTION_TO_STATUS[args.action];
  const nowDate = new Date();

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
    const existing = await tx.patientCommunicationPreference.findUnique({
      where: {
        patientId_clinicId_channel_purpose: {
          patientId: args.patientId,
          clinicId: args.clinicId,
          channel: args.channel,
          purpose: args.purpose,
        },
      },
      select: { id: true, status: true },
    });

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
        grantedAt: newStatus === 'granted' ? nowDate : null,
        withdrawnAt: newStatus === 'withdrawn' ? nowDate : null,
        ...sharedFields,
      },
      update: {
        status: newStatus,
        effectiveAt: nowDate,
        grantedAt: newStatus === 'granted' ? nowDate : undefined,
        withdrawnAt: newStatus === 'withdrawn' ? nowDate : undefined,
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
        ...sharedFields,
      },
      select: { id: true },
    });

    return { preference, eventId: event.id };
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
