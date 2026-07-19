/**
 * legacyReconciliationResolver.ts — KVKK-HIGH-007 legacy/central consent
 * dual-gate reconciliation.
 *
 * Technical control only — see
 * docs/compliance/56-kvkk-communication-preference-and-consent-management.md.
 *
 * The problem: senders that predate the central PatientCommunicationPreference
 * system (SMS, recall drafting) each run their own legacy gate
 * (Patient.communicationConsent / marketingConsent / smsOptOut) completely
 * independently of the central decision service. Today that legacy gate runs
 * first, unconditionally, and short-circuits on failure — so an explicit
 * central `granted` row currently has zero effect on those two senders. This
 * module is the single orchestration point both senders call instead of
 * chaining two independent checks whose precedence could diverge.
 *
 * Patient.smsOptOut is dormant (no active UI, no write path anywhere in the
 * app — only the backfill script reads it). Treating it as an eternal,
 * unconditional veto that can never be corrected once a newer evidenced
 * central grant exists would create a second, uncorrectable source of truth.
 * It must not silently override a central grant, and a central grant must not
 * silently override it either — see the `legacy_central_conflict` branch.
 */

import {
  evaluateCommunicationPermission,
  assertCommunicationPermission,
  type EvaluateCommunicationPermissionArgs,
  type CommunicationPermissionDecision,
} from './communicationConsentPolicy.js';
import {
  isCommunicationConsentEnforcementEnabled,
  getCommunicationConsentEnforcementMode,
  isCommunicationConsentLegacyReconciliationEnabled,
  type CommunicationConsentEnforcementMode,
} from './enforcementConfig.js';
import { recordCommunicationConsentConflict } from './communicationConsentConflictTracker.js';

export type EffectiveEnforcementMode = 'disabled' | CommunicationConsentEnforcementMode;

/** The legacy gate's own decision for one send, computed by the caller (SMS/recall) using its existing logic. */
export type LegacyGateSignal = {
  allowed: boolean;
  /**
   * true only for a genuine hard-restrictive signal (e.g. SMS opt-out) that
   * should always block once reconciliation is on — distinct from an
   * ambiguous default-false legacy boolean, which only ever falls back.
   */
  hardVeto: boolean;
  reasonCode: string;
};

export type ReconciledCommunicationConsentResult = {
  legacyDecision: LegacyGateSignal;
  centralDecision: CommunicationPermissionDecision | null;
  finalAllowed: boolean;
  finalReasonCode: string;
  conflict: boolean;
  enforcementMode: EffectiveEnforcementMode;
  reconciliationEnabled: boolean;
};

const SCOPE_FAILURE_REASON_CODES = new Set([
  'patient_missing',
  'clinic_scope_mismatch',
  'channel_unavailable',
  'purpose_not_supported',
]);

function resolveEffectiveEnforcementMode(): EffectiveEnforcementMode {
  if (!isCommunicationConsentEnforcementEnabled()) return 'disabled';
  return getCommunicationConsentEnforcementMode();
}

/**
 * Single orchestration point for legacy-gated senders (SMS, recall). Never
 * call the legacy gate and the central decision service independently for a
 * send decision — always go through this function so precedence cannot
 * diverge between call sites.
 *
 * See docs/compliance/56-kvkk-communication-preference-and-consent-management.md
 * for the full mode matrix and rationale.
 */
export async function resolveCommunicationConsent(
  legacy: LegacyGateSignal,
  centralArgs: EvaluateCommunicationPermissionArgs,
): Promise<ReconciledCommunicationConsentResult> {
  const reconciliationEnabled = isCommunicationConsentLegacyReconciliationEnabled();
  const enforcementMode = resolveEffectiveEnforcementMode();

  if (!reconciliationEnabled) {
    // Byte-identical to the pre-existing two-step call sites: the legacy gate
    // is unconditional, and central is applied exactly as
    // assertCommunicationPermission already does (disabled/audit never
    // block; enforce blocks on deny). Zero extra DB query beyond what
    // assertCommunicationPermission itself already performs.
    const centralAssert = await assertCommunicationPermission(centralArgs);
    const finalAllowed = legacy.allowed && centralAssert.allowed;
    return {
      legacyDecision: legacy,
      centralDecision: null,
      finalAllowed,
      finalReasonCode: !legacy.allowed ? legacy.reasonCode : centralAssert.reasonCode,
      conflict: false,
      enforcementMode,
      reconciliationEnabled: false,
    };
  }

  // Reconciliation is on: always compute the true, unconditional central
  // decision (evaluateCommunicationPermission never gates on rollout flags).
  const central = await evaluateCommunicationPermission(centralArgs);

  if (SCOPE_FAILURE_REASON_CODES.has(central.reasonCode)) {
    // Scope/validity failure always blocks — policy exceptions never bypass scope.
    return {
      legacyDecision: legacy,
      centralDecision: central,
      finalAllowed: false,
      finalReasonCode: central.reasonCode,
      conflict: false,
      enforcementMode,
      reconciliationEnabled,
    };
  }

  if (central.effectiveStatus === 'not_required') {
    // Named branch: transactional_exception / legal_notice_exception /
    // security_notice_exception / consent_not_required. Mirrors the central
    // module's own pre-existing, unconditional exception rule rather than
    // accidentally falling through the `unknown` branch below, which would
    // let an ambiguous legacy false/default block a legal/transactional
    // message. Whether a hard channel opt-out may ever suppress a
    // legal/security notice remains an open question pending legal review —
    // this is a technical default, not a legal conclusion.
    return {
      legacyDecision: legacy,
      centralDecision: central,
      finalAllowed: true,
      finalReasonCode: central.reasonCode,
      conflict: false,
      enforcementMode,
      reconciliationEnabled,
    };
  }

  if (legacy.hardVeto && central.effectiveStatus === 'granted') {
    // Fail closed, ALWAYS, every enforcementMode — never silently resolved in
    // either direction. Not auto-granted (the veto never wins outright and
    // permanently), not auto-overridden by the veto either (the grant is
    // never silently ignored/discarded).
    await recordCommunicationConsentConflict({
      organizationId: centralArgs.organizationId,
      clinicId: centralArgs.clinicId,
      channel: centralArgs.channel,
      purpose: centralArgs.purpose,
      reasonCode: 'legacy_central_conflict',
    });
    return {
      legacyDecision: legacy,
      centralDecision: central,
      finalAllowed: false,
      finalReasonCode: 'legacy_central_conflict',
      conflict: true,
      enforcementMode,
      reconciliationEnabled,
    };
  }

  if (legacy.hardVeto) {
    return {
      legacyDecision: legacy,
      centralDecision: central,
      finalAllowed: false,
      finalReasonCode: legacy.reasonCode,
      conflict: false,
      enforcementMode,
      reconciliationEnabled,
    };
  }

  if (central.effectiveStatus === 'denied' || central.effectiveStatus === 'withdrawn') {
    // Explicit central restriction always wins once reconciliation is on,
    // regardless of enforcementMode — honoring a restriction early is never
    // a compliance risk.
    return {
      legacyDecision: legacy,
      centralDecision: central,
      finalAllowed: false,
      finalReasonCode: central.reasonCode,
      conflict: false,
      enforcementMode,
      reconciliationEnabled,
    };
  }

  if (central.effectiveStatus === 'granted') {
    // The ONE permissive change — double-gated: reconciliation ON *and*
    // enforcementMode === 'enforce'. In disabled/audit this is observed only
    // (finalAllowed still falls back to legacy) so nothing changes for a real
    // send until enforce is deliberately turned on.
    if (enforcementMode === 'enforce') {
      return {
        legacyDecision: legacy,
        centralDecision: central,
        finalAllowed: true,
        finalReasonCode: central.reasonCode,
        conflict: false,
        enforcementMode,
        reconciliationEnabled,
      };
    }
    return {
      legacyDecision: legacy,
      centralDecision: central,
      finalAllowed: legacy.allowed,
      finalReasonCode: legacy.allowed ? 'legacy_fallback_allowed_pending_enforce' : legacy.reasonCode,
      conflict: false,
      enforcementMode,
      reconciliationEnabled,
    };
  }

  // central.effectiveStatus === 'unknown': unchanged fallback, holds even in
  // enforce mode — avoids nuking ~100% of sends before backfill/reconciliation
  // has populated real central evidence.
  return {
    legacyDecision: legacy,
    centralDecision: central,
    finalAllowed: legacy.allowed,
    finalReasonCode: legacy.reasonCode,
    conflict: false,
    enforcementMode,
    reconciliationEnabled,
  };
}
