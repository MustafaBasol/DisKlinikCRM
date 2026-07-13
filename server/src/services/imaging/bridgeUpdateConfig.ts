/**
 * bridgeUpdateConfig.ts — canonical server-side release descriptor for the
 * paired Windows Bridge auto-updater (PR 6/7). Shares version/sha256/URL
 * parsing with bridgeOnboardingConfig.ts (PR 5) via releaseMetadataValidation.ts
 * — this is the ONLY place update-specific fields (mode, publisher
 * thumbprint, minimum source version) are parsed.
 *
 * Fail-closed: IMAGING_BRIDGE_UPDATE_MODE unset/unrecognized -> 'disabled'.
 * A release is only ever considered installable when its metadata is fully
 * well-formed AND (in production) it declares a pinned publisher thumbprint.
 */

import {
  isAcceptableDownloadUrl,
  isValidCertThumbprint,
  isValidSha256,
  isValidVersion,
  parseUpdateMode,
  type UpdateMode,
} from './releaseMetadataValidation.js';

export interface BridgeUpdateRelease {
  version: string;
  downloadUrl: string;
  sha256: string;
  /** true only when a publisher thumbprint is pinned and the release is expected to be Authenticode-signed by it. */
  signed: boolean;
  /** 40-char hex Authenticode certificate thumbprint the installer must be signed by. Required for `signed: true`. */
  publisherThumbprint: string | null;
  minimumSourceVersion: string | null;
  notes: string | null;
}

export interface BridgeUpdateConfig {
  mode: UpdateMode;
  release: BridgeUpdateRelease | null;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function getBridgeUpdateConfig(): BridgeUpdateConfig {
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

  const metadataValid = coreValid && publisherValid && productionSigningRequirementMet && minimumSourceVersionValid;

  if (!metadataValid) {
    return { mode, release: null };
  }

  return {
    mode,
    release: {
      version,
      downloadUrl,
      sha256,
      signed,
      publisherThumbprint: signed ? publisherThumbprintRaw : null,
      minimumSourceVersion: minimumSourceVersionRaw || null,
      notes,
    },
  };
}
