/**
 * communicationConsentPolicy.ts - Central communication permission decision
 * service for KVKK-HIGH-007.
 *
 * Technical control only - this module contains no legal conclusions.
 * See docs/compliance/56-kvkk-communication-preference-and-consent-management.md.
 *
 * Two entry points:
 *   - evaluateCommunicationPermission(): pure decision, ALWAYS computes the
 *     real answer from the current preference state, regardless of rollout
 *     flags. Used for the API's "decision matrix" view and for tests.
 *   - assertCommunicationPermission(): the flag-aware wrapper every outbound
 *     sender should call. It runs evaluateCommunicationPermission() and then
 *     applies the rollout mode (disabled/audit/enforce) to decide whether the
 *     send may actually proceed.
 *
 * Policy rules (technical, not legal):
 *   - transactional / legal_notice / security_notice are policy exceptions:
 *     always allowed, never require a preference row (never silently allow
 *     marketing this way - these are a fixed, closed list).
 *   - every other purpose (including marketing/campaign) requires an
 *     explicit 'granted' preference row. Missing row => unknown => denied.
 *     This fails closed: unknown or withdrawn NEVER resolves to allowed.
 *   - clinic/patient scope mismatches and missing patients are always denied.
 */

import prisma from '../../db.js';
import {
  isCommunicationChannel,
  isCommunicationPurpose,
  isPolicyExceptionPurpose,
  type CommunicationChannel,
  type CommunicationPurpose,
  type CommunicationPreferenceStatus,
} from './taxonomy.js';
import {
  isCommunicationConsentEnforcementEnabled,
  getCommunicationConsentEnforcementMode,
} from './enforcementConfig.js';

export type CommunicationPermissionReasonCode =
  | 'consent_granted'
  | 'consent_denied'
  | 'consent_withdrawn'
  | 'consent_unknown'
  | 'consent_not_required'
  | 'transactional_exception'
  | 'legal_notice_exception'
  | 'security_notice_exception'
  | 'patient_missing'
  | 'clinic_scope_mismatch'
  | 'channel_unavailable'
  | 'purpose_not_supported'
  | 'consent_enforcement_disabled';

export type CommunicationPermissionDecision = {
  allowed: boolean;
  reasonCode: CommunicationPermissionReasonCode;
  channel: string;
  purpose: string;
  effectiveStatus: CommunicationPreferenceStatus | null;
  preferenceId?: string;
  consentEventId?: string;
  evaluatedAt: string;
};

export type EvaluateCommunicationPermissionArgs = {
  organizationId: string;
  clinicId: string;
  patientId: string;
  channel: string;
  purpose: string;
};

const EXCEPTION_REASON_CODE: Partial<
  Record<CommunicationPurpose, CommunicationPermissionReasonCode>
> = {
  transactional: 'transactional_exception',
  legal_notice: 'legal_notice_exception',
  security_notice: 'security_notice_exception',
};

const now = (): string => new Date().toISOString();

function decision(
  args: EvaluateCommunicationPermissionArgs,
  allowed: boolean,
  reasonCode: CommunicationPermissionReasonCode,
  effectiveStatus: CommunicationPreferenceStatus | null = null,
  preferenceId?: string,
): CommunicationPermissionDecision {
  return {
    allowed,
    reasonCode,
    channel: args.channel,
    purpose: args.purpose,
    effectiveStatus,
    preferenceId,
    evaluatedAt: now(),
  };
}

/**
 * Pure decision: always computes the real, current answer from the
 * preference table - never gated by the rollout flag. Never throws; unknown
 * inputs resolve to an explicit deny reason code instead.
 */
export async function evaluateCommunicationPermission(
  args: EvaluateCommunicationPermissionArgs,
): Promise<CommunicationPermissionDecision> {
  if (!isCommunicationChannel(args.channel)) {
    return decision(args, false, 'channel_unavailable');
  }
  if (!isCommunicationPurpose(args.purpose)) {
    return decision(args, false, 'purpose_not_supported');
  }

  const purpose = args.purpose as CommunicationPurpose;

  if (isPolicyExceptionPurpose(purpose)) {
    return decision(args, true, EXCEPTION_REASON_CODE[purpose] ?? 'consent_not_required', 'not_required');
  }

  const patient = await prisma.patient.findFirst({
    where: { id: args.patientId, deletedAt: null },
    select: { id: true, clinicId: true, organizationId: true },
  });

  if (!patient) {
    return decision(args, false, 'patient_missing');
  }
  if (patient.organizationId !== args.organizationId || patient.clinicId !== args.clinicId) {
    // Patients may also be reachable via PatientClinic (multi-branch visit
    // history) - check that before declaring a scope mismatch.
    const linked = await prisma.patientClinic.findFirst({
      where: { patientId: args.patientId, clinicId: args.clinicId },
      select: { id: true },
    });
    if (!linked || patient.organizationId !== args.organizationId) {
      return decision(args, false, 'clinic_scope_mismatch');
    }
  }

  const preference = await prisma.patientCommunicationPreference.findUnique({
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

  const status = (preference?.status ?? 'unknown') as CommunicationPreferenceStatus;

  switch (status) {
    case 'granted':
      return decision(args, true, 'consent_granted', status, preference?.id);
    case 'not_required':
      return decision(args, true, 'consent_not_required', status, preference?.id);
    case 'denied':
      return decision(args, false, 'consent_denied', status, preference?.id);
    case 'withdrawn':
      return decision(args, false, 'consent_withdrawn', status, preference?.id);
    case 'unknown':
    default:
      return decision(args, false, 'consent_unknown', status, preference?.id);
  }
}

export type AssertCommunicationPermissionResult = CommunicationPermissionDecision & {
  /** true only when COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED=true and mode='enforce' actually blocked the send */
  blocked: boolean;
  enforcementMode: 'disabled' | 'audit' | 'enforce';
};

/**
 * Flag-aware wrapper every outbound sender should call before dispatching a
 * patient-facing message.
 *
 *  - disabled (default): never queries the preference table; always allowed.
 *  - audit: evaluates the real decision (for logging/observability) but
 *    never blocks the send.
 *  - enforce: evaluates the real decision and blocks when denied.
 */
export async function assertCommunicationPermission(
  args: EvaluateCommunicationPermissionArgs,
): Promise<AssertCommunicationPermissionResult> {
  if (!isCommunicationConsentEnforcementEnabled()) {
    return {
      ...decision(args, true, 'consent_enforcement_disabled'),
      blocked: false,
      enforcementMode: 'disabled',
    };
  }

  const real = await evaluateCommunicationPermission(args);
  const mode = getCommunicationConsentEnforcementMode();

  if (mode === 'audit') {
    return { ...real, allowed: true, blocked: false, enforcementMode: 'audit' };
  }

  return { ...real, blocked: !real.allowed, enforcementMode: 'enforce' };
}
