/**
 * bridgeUpdateConfig.ts — canonical server-side release descriptor for the
 * paired Windows Bridge auto-updater (PR 6/7). Shares version/sha256/URL
 * parsing with bridgeOnboardingConfig.ts (PR 5) via releaseMetadataValidation.ts
 * — this is the ONLY place update-specific fields (mode, publisher
 * thumbprint, minimum source version, staged rollout, rollback) are parsed.
 *
 * Fail-closed: IMAGING_BRIDGE_UPDATE_MODE unset/unrecognized -> 'disabled'.
 * A release is only ever considered installable when its metadata is fully
 * well-formed AND (in production) it declares a pinned publisher thumbprint.
 *
 * Staged rollout (PR 7): a release additionally carries a channel
 * ('stable' | 'pilot') and a rollout percentage (0-100). Eligibility for a
 * given bridge is computed deterministically from a stable hash of
 * (bridge agent ID, release ID) — never Math.random() and never re-rolled on
 * every request, so a bridge that is offered (or not offered) a release stays
 * that way for the lifetime of that release ID. See
 * `docs/update-runbook.md` "Staged rollout" for the operational model.
 */

import crypto from 'crypto';
import {
  isAcceptableDownloadUrl,
  isValidCertThumbprint,
  isValidReleaseId,
  isValidRolloutPercent,
  isValidSha256,
  isValidVersion,
  parseUpdateChannel,
  parseUpdateMode,
  type UpdateChannel,
  type UpdateMode,
} from './releaseMetadataValidation.js';

export interface BridgeUpdateRollbackPackage {
  version: string;
  downloadUrl: string;
  sha256: string;
  publisherThumbprint: string;
}

export interface BridgeUpdateRelease {
  releaseId: string;
  version: string;
  downloadUrl: string;
  sha256: string;
  /** true only when a publisher thumbprint is pinned and the release is expected to be Authenticode-signed by it. */
  signed: boolean;
  /** 40-char hex Authenticode certificate thumbprint the installer must be signed by. Required for `signed: true`. */
  publisherThumbprint: string | null;
  minimumSourceVersion: string | null;
  notes: string | null;
  channel: UpdateChannel;
  rolloutPercent: number;
  /** Security/critical release — bypasses rolloutPercent gating (never bypasses channel, mode, or minimumSourceVersion). */
  forced: boolean;
  /** The previously-trusted release the bridge should cache locally as its one-step rollback target before installing this one. Null when the operator hasn't declared a rollback package for this release. */
  rollback: BridgeUpdateRollbackPackage | null;
}

export interface BridgeUpdateConfig {
  mode: UpdateMode;
  release: BridgeUpdateRelease | null;
}

/** The bridge identity fields needed to evaluate rollout eligibility — a subset of `AuthenticatedBridgeAgent`. */
export interface BridgeUpdateEligibility {
  bridgeAgentId: string;
  updateChannel: string;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Deterministic cohort bucket in [0, 100). Same (bridgeAgentId, releaseId)
 * pair always yields the same bucket — no per-request randomness, no
 * re-selection, and the assignment for one release ID never changes across
 * repeated checks. Different release IDs deliberately reshuffle the cohort
 * (a bridge that missed a 10% rollout isn't guaranteed to miss the next
 * release's 10% too) — see docs/update-runbook.md for the rationale.
 */
export function computeRolloutBucket(bridgeAgentId: string, releaseId: string): number {
  const digest = crypto.createHash('sha256').update(`${bridgeAgentId}:${releaseId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

function isBridgeInRolloutCohort(bridgeAgentId: string, releaseId: string, rolloutPercent: number, forced: boolean): boolean {
  if (forced) return true;
  if (rolloutPercent <= 0) return false;
  if (rolloutPercent >= 100) return true;
  return computeRolloutBucket(bridgeAgentId, releaseId) < rolloutPercent;
}

function parseRollbackPackage(): BridgeUpdateRollbackPackage | null {
  const version = process.env.IMAGING_BRIDGE_ROLLBACK_VERSION?.trim() || '';
  const downloadUrl = process.env.IMAGING_BRIDGE_ROLLBACK_DOWNLOAD_URL?.trim() || '';
  const sha256 = process.env.IMAGING_BRIDGE_ROLLBACK_SHA256?.trim().toLowerCase() || '';
  const publisherThumbprint = process.env.IMAGING_BRIDGE_ROLLBACK_PUBLISHER_THUMBPRINT?.trim().toLowerCase() || '';

  // Rollback is opt-in: an operator who hasn't declared one gets no rollback
  // metadata at all (bridge simply has no cached rollback target for this
  // release — never a partially-valid/guessed one).
  if (!version && !downloadUrl && !sha256 && !publisherThumbprint) return null;

  const valid =
    isValidVersion(version) &&
    Boolean(downloadUrl) &&
    isAcceptableDownloadUrl(downloadUrl) &&
    isValidSha256(sha256) &&
    isValidCertThumbprint(publisherThumbprint);

  // A malformed rollback declaration must never be handed to the bridge —
  // that would mean caching an unverifiable "previous known-good" package.
  // Fail closed to "no rollback available" rather than guessing.
  if (!valid) return null;

  return { version, downloadUrl, sha256, publisherThumbprint };
}

/**
 * @param eligibility Omit only for callers that need the raw release
 * descriptor validity check without evaluating rollout eligibility (e.g.
 * onboarding/admin tooling). The public update route always supplies it.
 */
export function getBridgeUpdateConfig(eligibility?: BridgeUpdateEligibility): BridgeUpdateConfig {
  const mode = parseUpdateMode(process.env.IMAGING_BRIDGE_UPDATE_MODE);
  if (mode === 'disabled') {
    return { mode: 'disabled', release: null };
  }

  const version = process.env.IMAGING_BRIDGE_UPDATE_VERSION?.trim() || '';
  const downloadUrl = process.env.IMAGING_BRIDGE_UPDATE_DOWNLOAD_URL?.trim() || '';
  const sha256 = process.env.IMAGING_BRIDGE_UPDATE_SHA256?.trim().toLowerCase() || '';
  const signed = process.env.IMAGING_BRIDGE_UPDATE_SIGNED === 'true';
  const publisherThumbprintRaw = process.env.IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT?.trim().toLowerCase() || '';
  const minimumSourceVersionRaw = process.env.IMAGING_BRIDGE_UPDATE_MIN_SOURCE_VERSION?.trim() || '';
  const notes = process.env.IMAGING_BRIDGE_UPDATE_NOTES?.trim() || null;
  const releaseIdRaw = process.env.IMAGING_BRIDGE_UPDATE_RELEASE_ID?.trim() || '';
  const rolloutPercentRaw = process.env.IMAGING_BRIDGE_UPDATE_ROLLOUT_PERCENT?.trim() || '100';
  const channel = parseUpdateChannel(process.env.IMAGING_BRIDGE_UPDATE_CHANNEL ?? 'stable');
  const forced = process.env.IMAGING_BRIDGE_UPDATE_FORCED === 'true';

  const coreValid =
    Boolean(downloadUrl) &&
    isAcceptableDownloadUrl(downloadUrl) &&
    isValidVersion(version) &&
    isValidSha256(sha256);

  // A release that claims to be signed must carry a well-formed thumbprint.
  // In production a release that is NOT signed is never offered at all —
  // installing an unsigned package as LocalSystem is refused fail-closed
  // regardless of what the bridge's own trust check would later do; this
  // keeps an operator misconfiguration (forgetting IMAGING_BRIDGE_UPDATE_SIGNED)
  // from ever reaching a paired bridge as an "available" release.
  const publisherValid = signed ? isValidCertThumbprint(publisherThumbprintRaw) : true;
  const productionSigningRequirementMet = !isProduction() || signed;

  const minimumSourceVersionValid = !minimumSourceVersionRaw || isValidVersion(minimumSourceVersionRaw);
  const releaseIdValid = isValidReleaseId(releaseIdRaw);
  const rolloutPercentValid = isValidRolloutPercent(rolloutPercentRaw);
  const channelValid = channel !== null;

  const metadataValid =
    coreValid &&
    publisherValid &&
    productionSigningRequirementMet &&
    minimumSourceVersionValid &&
    releaseIdValid &&
    rolloutPercentValid &&
    channelValid;

  if (!metadataValid) {
    return { mode, release: null };
  }

  const rolloutPercent = Number(rolloutPercentRaw);

  const release: BridgeUpdateRelease = {
    releaseId: releaseIdRaw,
    version,
    downloadUrl,
    sha256,
    signed,
    publisherThumbprint: signed ? publisherThumbprintRaw : null,
    minimumSourceVersion: minimumSourceVersionRaw || null,
    notes,
    channel: channel as UpdateChannel,
    rolloutPercent,
    forced,
    rollback: parseRollbackPackage(),
  };

  if (eligibility) {
    // Channel is an exact match, not a hierarchy — a 'pilot' release is
    // never offered to a 'stable' bridge and vice versa. Bridges default to
    // 'stable' (schema default), so a stable-channel release reaches the
    // whole fleet unless explicitly narrowed by rolloutPercent.
    const channelEligible = eligibility.updateChannel === release.channel;
    const cohortEligible = isBridgeInRolloutCohort(eligibility.bridgeAgentId, release.releaseId, release.rolloutPercent, release.forced);
    if (!channelEligible || !cohortEligible) {
      return { mode, release: null };
    }
  }

  return { mode, release };
}
