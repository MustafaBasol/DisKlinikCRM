/**
 * communicationConsentAuditLogging.ts — Bounded, deterministic, PII-free
 * audit-mode observability for KVKK-HIGH-007 (Workstream 3).
 *
 * Sampling is deterministic per EVALUATION, not per clinic/channel/purpose/
 * hour bucket alone — hashing in a stable per-evaluation input (defaults to
 * patientId, used only in-memory, never persisted) means individual
 * evaluations for the same clinic/channel/purpose/hour distribute
 * independently instead of an all-or-nothing burst.
 *
 * All three of logging-enabled / sample-rate / sample-salt must be validly
 * configured before anything is logged — any missing or invalid piece fails
 * safe to "log nothing".
 */

import { recordOperationalEvent } from '../operationalEventService.js';
import {
  isCommunicationConsentAuditLoggingEnabled,
  getCommunicationConsentAuditLogSampleRate,
  getCommunicationConsentAuditSampleSalt,
} from './enforcementConfig.js';

/** Bumped whenever the sampling algorithm changes, so historical rows remain correctly interpretable even if the method changes later. */
export const COMMUNICATION_CONSENT_SAMPLING_VERSION = 1;

const HOUR_MS = 60 * 60 * 1000;

/** Small, fast, stable 32-bit hash (FNV-1a) — not cryptographic, not needed to be; only needs to distribute evenly and be deterministic. */
function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

export type SamplingDecisionInput = {
  organizationId: string;
  clinicId: string;
  channel: string;
  purpose: string;
  /** Stable per-evaluation input — defaults to patientId at the call site. Never persisted. */
  stableEventKey: string;
  now: Date;
  salt: string;
  sampleRate: number;
};

/** Same logical evaluation (same key + hour bucket) always produces the same decision; different patients/keys distribute independently. */
export function computeDeterministicSamplingDecision(input: SamplingDecisionInput): boolean {
  const hourBucket = Math.floor(input.now.getTime() / HOUR_MS);
  const key = `${input.organizationId}:${input.clinicId}:${input.channel}:${input.purpose}:${input.stableEventKey}:${hourBucket}:${input.salt}`;
  return fnv1aHash(key) < input.sampleRate;
}

export type CommunicationConsentAuditEventInput = {
  organizationId: string;
  clinicId: string;
  channel: string;
  purpose: string;
  reasonCode: string;
  enforcementMode: 'audit' | 'enforce';
  evaluatedAllowed: boolean;
  wouldBlock: boolean;
  /** Used only to compute the sampling decision — never included in the persisted event. Defaults to patientId at the call site. */
  stableEventKey: string;
};

/**
 * Records one communication-consent evaluation as a sampled OperationalEvent,
 * subject to the logging-enabled flag, a validly-configured sample rate, and
 * a validly-configured salt. No patientId, phone, email, message text, IP, or
 * user-agent ever enters the persisted metadata.
 */
export async function maybeRecordCommunicationConsentAuditEvent(
  input: CommunicationConsentAuditEventInput,
  now: Date = new Date(),
): Promise<void> {
  if (!isCommunicationConsentAuditLoggingEnabled()) return;

  const sampleRate = getCommunicationConsentAuditLogSampleRate();
  const salt = getCommunicationConsentAuditSampleSalt();
  if (sampleRate === null || salt === null) return; // fail safe: log nothing, never "log everything"

  const sampled = computeDeterministicSamplingDecision({
    organizationId: input.organizationId,
    clinicId: input.clinicId,
    channel: input.channel,
    purpose: input.purpose,
    stableEventKey: input.stableEventKey,
    now,
    salt,
    sampleRate,
  });
  if (!sampled) return;

  await recordOperationalEvent({
    organizationId: input.organizationId,
    clinicId: input.clinicId,
    severity: input.wouldBlock ? 'warning' : 'info',
    source: 'communication_consent',
    message: `Communication consent evaluated (${input.enforcementMode})`,
    metadata: {
      evaluatedAllowed: input.evaluatedAllowed,
      reasonCode: input.reasonCode,
      channel: input.channel,
      purpose: input.purpose,
      enforcementMode: input.enforcementMode,
      wouldBlock: input.wouldBlock,
      sampled: true,
      samplingRate: sampleRate,
      samplingVersion: COMMUNICATION_CONSENT_SAMPLING_VERSION,
    },
  });
}
