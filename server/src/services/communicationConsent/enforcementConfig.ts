/**
 * enforcementConfig.ts — Rollout flags for KVKK-HIGH-007 communication
 * consent enforcement.
 *
 * COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED (default: false)
 *   false → assertCommunicationPermission() always returns allowed=true with
 *           reasonCode='consent_enforcement_disabled' and never queries the
 *           preference table. Existing send behavior is completely unchanged.
 *   true  → mode below governs behavior.
 *
 * COMMUNICATION_CONSENT_ENFORCEMENT_MODE (default: 'audit', only read when ENABLED=true)
 *   'audit'   → evaluate the real decision, write an audit trail, but never
 *               block a send (allowed is forced to true; reasonCode reflects
 *               the real underlying decision for observability).
 *   'enforce' → block sends the decision service denies.
 *
 * Enforcement must never be silently enabled in production by this PR — the
 * default is fail-safe (disabled) regardless of environment.
 */

export type CommunicationConsentEnforcementMode = 'audit' | 'enforce';

export function isCommunicationConsentEnforcementEnabled(): boolean {
  return process.env.COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED === 'true';
}

export function getCommunicationConsentEnforcementMode(): CommunicationConsentEnforcementMode {
  const raw = process.env.COMMUNICATION_CONSENT_ENFORCEMENT_MODE?.trim().toLowerCase();
  return raw === 'enforce' ? 'enforce' : 'audit';
}
