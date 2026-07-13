/**
 * releaseMetadataValidation.ts — the ONE parser for release-descriptor
 * fields (download URL, version, SHA-256) shared by both the unauthenticated
 * web onboarding installer card (bridgeOnboardingConfig.ts, PR 5) and the
 * authenticated bridge auto-update descriptor (bridgeUpdateConfig.ts, PR 6).
 *
 * Do not add a second regex-based parser for any of these fields elsewhere —
 * the update endpoint and the onboarding card must never silently diverge on
 * what counts as a valid version/hash/URL.
 */

/** HTTPS always accepted. Plain HTTP accepted only for localhost/127.0.0.1 outside production — never in production, never for any other host. */
export function isAcceptableDownloadUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  if (
    parsed.protocol === 'http:' &&
    process.env.NODE_ENV !== 'production' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
  ) {
    return true;
  }
  return false;
}

export function isValidSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

/** Simple x.y.z / x.y.z.w form — matches Windows Installer's 3-4 field ProductVersion; free text is never accepted. */
export function isValidVersion(value: string): boolean {
  return /^\d+(\.\d+){1,3}$/.test(value);
}

/**
 * A 40-character hex SHA-1 Authenticode certificate thumbprint (the format
 * `certutil`/`signtool`/`Get-AuthenticodeSignature` all report it in).
 */
export function isValidCertThumbprint(value: string): boolean {
  return /^[a-f0-9]{40}$/i.test(value);
}

export const UPDATE_MODES = ['disabled', 'notify', 'automatic'] as const;
export type UpdateMode = (typeof UPDATE_MODES)[number];

/** Unrecognized/missing input always resolves to 'disabled' — the update subsystem fails closed, never fails open. */
export function parseUpdateMode(value: string | undefined): UpdateMode {
  const normalized = value?.trim().toLowerCase();
  return (UPDATE_MODES as readonly string[]).includes(normalized ?? '') ? (normalized as UpdateMode) : 'disabled';
}
