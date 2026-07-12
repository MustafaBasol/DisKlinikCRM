/**
 * bridgeOnboardingConfig.ts — Self-servis Windows köprü kurulumu yapılandırması (PR 5/7).
 *
 * Fail-closed: IMAGING_BRIDGE_ONBOARDING_ENABLED açıkça 'true' olmadıkça devre
 * dışıdır, ve installer yalnızca indirme URL'si HTTPS (veya prod dışında
 * localhost http), sürüm ve sha256 biçimi geçerliyse "available" sayılır.
 * `signed` alanı asla varsayılan olarak true değildir — yalnızca ortam
 * değişkeni açıkça 'true' ise imzalı olduğu iddia edilir.
 *
 * Version/sha256/URL parsing lives in releaseMetadataValidation.ts (shared
 * with bridgeUpdateConfig.ts, PR 6) — do not reimplement those checks here.
 */

import { isAcceptableDownloadUrl, isValidSha256, isValidVersion } from './releaseMetadataValidation.js';

// windows-bridge/docs/installer.md ile senkron: installer Windows 10 build
// 10240 / Server 2016 (14393) altını LaunchCondition ile reddeder.
const MINIMUM_WINDOWS_BUILD = 10240;

export interface BridgeOnboardingInstallerMetadata {
  downloadUrl: string;
  version: string;
  sha256: string;
  signed: boolean;
  minimumWindowsBuild: number;
}

export interface BridgeOnboardingConfig {
  enabled: boolean;
  installerAvailable: boolean;
  installer: BridgeOnboardingInstallerMetadata | null;
}

export function getBridgeOnboardingConfig(): BridgeOnboardingConfig {
  const enabled = process.env.IMAGING_BRIDGE_ONBOARDING_ENABLED === 'true';
  if (!enabled) {
    return { enabled: false, installerAvailable: false, installer: null };
  }

  const downloadUrl = process.env.IMAGING_BRIDGE_INSTALLER_DOWNLOAD_URL?.trim() || '';
  const version = process.env.IMAGING_BRIDGE_INSTALLER_VERSION?.trim() || '';
  const sha256 = process.env.IMAGING_BRIDGE_INSTALLER_SHA256?.trim().toLowerCase() || '';
  const signed = process.env.IMAGING_BRIDGE_INSTALLER_SIGNED === 'true';

  const metadataValid =
    Boolean(downloadUrl) &&
    isAcceptableDownloadUrl(downloadUrl) &&
    isValidVersion(version) &&
    isValidSha256(sha256);

  if (!metadataValid) {
    return { enabled: true, installerAvailable: false, installer: null };
  }

  return {
    enabled: true,
    installerAvailable: true,
    installer: {
      downloadUrl,
      version,
      sha256,
      signed,
      minimumWindowsBuild: MINIMUM_WINDOWS_BUILD,
    },
  };
}
