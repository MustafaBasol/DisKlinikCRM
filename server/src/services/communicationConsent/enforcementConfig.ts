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
 * COMMUNICATION_CONSENT_LEGACY_RECONCILIATION_ENABLED (default: false)
 *   Independent of the two flags above. Governs whether the legacy-gated
 *   senders (SMS, recall — see legacyReconciliationResolver.ts) let an
 *   explicit central signal (granted/denied/withdrawn) participate in their
 *   send decision at all. false → those senders behave exactly as they did
 *   before KVKK-HIGH-007 (pure legacy Patient.communicationConsent/
 *   marketingConsent/smsOptOut gate, unchanged). This is deliberately a
 *   separate flag from enforcement: the channels that never had a legacy gate
 *   (WhatsApp reminders/no-show/post-treatment/confirmation, and the generic
 *   message composer) are governed purely by enforcementMode above and do not
 *   read this flag at all.
 *
 * Enforcement (and reconciliation) must never be silently enabled in
 * production by this PR — the default is fail-safe (disabled/off) regardless
 * of environment.
 */

export type CommunicationConsentEnforcementMode = 'audit' | 'enforce';

export function isCommunicationConsentEnforcementEnabled(): boolean {
  return process.env.COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED === 'true';
}

export function getCommunicationConsentEnforcementMode(): CommunicationConsentEnforcementMode {
  const raw = process.env.COMMUNICATION_CONSENT_ENFORCEMENT_MODE?.trim().toLowerCase();
  return raw === 'enforce' ? 'enforce' : 'audit';
}

export function isCommunicationConsentLegacyReconciliationEnabled(): boolean {
  return process.env.COMMUNICATION_CONSENT_LEGACY_RECONCILIATION_ENABLED === 'true';
}

/**
 * Bounded audit-mode observability (Workstream 3). All three of these must be
 * explicitly, validly configured before any sampled OperationalEvent is ever
 * written — any missing/invalid piece fails safe to "log nothing", never to
 * "log everything".
 */
export function isCommunicationConsentAuditLoggingEnabled(): boolean {
  return process.env.COMMUNICATION_CONSENT_AUDIT_LOGGING_ENABLED === 'true';
}

/** Returns null (fail-safe) unless explicitly configured to a valid number in [0,1]. */
export function getCommunicationConsentAuditLogSampleRate(): number | null {
  const raw = process.env.COMMUNICATION_CONSENT_AUDIT_LOG_SAMPLE_RATE;
  if (raw === undefined || raw === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null;
  return parsed;
}

/**
 * Shared secret used only in-memory to compute the deterministic sampling
 * hash — never persisted or logged. Deliberately separate from
 * COMMUNICATION_CONSENT_EVIDENCE_HASH_SECRET (different purpose, different
 * rotation lifecycle). Required so the same logical evaluation gets the same
 * sampling decision regardless of which of NoraMedi's multiple API/worker
 * instances handles it.
 */
export function getCommunicationConsentAuditSampleSalt(): string | null {
  const raw = process.env.COMMUNICATION_CONSENT_AUDIT_SAMPLE_SALT;
  return raw && raw.length > 0 ? raw : null;
}
