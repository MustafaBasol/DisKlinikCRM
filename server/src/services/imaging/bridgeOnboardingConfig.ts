/**
 * bridgeOnboardingConfig.ts — Self-servis Windows köprü kurulumu yapılandırması (PR 5/7).
 *
 * Fail-closed: IMAGING_BRIDGE_ONBOARDING_ENABLED açıkça 'true' olmadıkça devre
 * dışıdır, ve installer yalnızca indirme URL'si HTTPS (veya prod dışında
 * localhost http), sürüm ve sha256 biçimi geçerliyse "available" sayılır.
 * `signed` alanı asla varsayılan olarak true değildir — yalnızca ortam
 * değişkeni açıkça 'true' ise imzalı olduğu iddia edilir.
 */

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

function isAcceptableDownloadUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  // Yalnızca prod DIŞINDA localhost http'ye izin verilir (yerel geliştirme/test).
  if (
    parsed.protocol === 'http:' &&
    process.env.NODE_ENV !== 'production' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
  ) {
    return true;
  }
  return false;
}

function isValidSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

/** Basit x.y.z / x.y.z.w biçimi — serbest metin kabul edilmez. */
function isValidVersion(value: string): boolean {
  return /^\d+(\.\d+){1,3}$/.test(value);
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
