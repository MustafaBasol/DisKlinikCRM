/**
 * platformSmsProviders.ts — Platform-level SMS provider configuration.
 *
 * NoraMedi sells SMS as an add-on: clinics get activation + quota only, while
 * the platform owner configures the actual Turkey/Europe provider credentials
 * centrally (PlatformSmsProvider rows, managed via platform admin routes).
 *
 * Credentials are encrypted at rest with encryptJson() and are decrypted only
 * here, immediately before a provider call — never in API responses and never
 * logged.
 *
 * Sending order per region: a clinic-level provider override (legacy
 * ClinicSmsSettings.turkeyProvider/europeProvider) wins when set; otherwise
 * the region's active platform provider (default first) is used.
 */

import prisma from '../../db.js';
import { decryptJson, encryptJson } from '../../utils/encryption.js';
import { getSmsProvider } from './smsProviders.js';

export const PLATFORM_SMS_REGIONS = ['tr', 'eu'] as const;
export type PlatformSmsRegion = (typeof PLATFORM_SMS_REGIONS)[number];

/** Resolved provider for a region: registry key + decrypted config + sender id. */
export type ResolvedPlatformSmsProvider = {
  providerKey: string;
  config: Record<string, unknown> | null;
  senderName: string | null;
};

type PlatformSmsProviderRow = {
  id: string;
  region: string;
  providerCode: string;
  displayName: string;
  isActive: boolean;
  isDefault: boolean;
  senderName: string | null;
  credentials: unknown;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  updatedAt: Date;
};

/**
 * API-safe view of a provider row: stored credentials are replaced with a
 * boolean flag so secrets can never leak through platform admin responses.
 */
export function sanitizePlatformSmsProvider(row: PlatformSmsProviderRow) {
  const { credentials, ...rest } = row;
  return {
    ...rest,
    credentialsConfigured:
      !!credentials && typeof credentials === 'object' && Object.keys(credentials as object).length > 0,
  };
}

/** Encrypt a credentials object for storage. Empty objects store as null. */
export function encryptProviderCredentials(
  credentials: Record<string, unknown> | null | undefined,
): Record<string, string> | null {
  if (!credentials || Object.keys(credentials).length === 0) return null;
  return encryptJson(credentials);
}

/**
 * Pick the platform provider for a region: active rows only, default first,
 * then most recently updated. Returns null when nothing is configured (the
 * send then fails safely as provider_not_configured, unchanged behavior).
 */
export async function resolvePlatformSmsProvider(
  region: PlatformSmsRegion,
): Promise<ResolvedPlatformSmsProvider | null> {
  try {
    const row = await prisma.platformSmsProvider.findFirst({
      where: { region, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
      select: { providerCode: true, credentials: true, senderName: true },
    });
    if (!row) return null;
    return {
      providerKey: row.providerCode,
      config: decryptJson(row.credentials),
      senderName: row.senderName,
    };
  } catch {
    // Missing table / DB hiccup must never break the send pipeline — behave
    // as "no platform provider configured".
    return null;
  }
}

/**
 * Platform admin "test provider" action. Validates that an adapter exists for
 * the stored providerCode and runs its connectivity check (mocks simulate
 * success). Never throws and never includes credential values in the result.
 */
export async function runPlatformSmsProviderTest(row: {
  providerCode: string;
  credentials: unknown;
}): Promise<{ ok: boolean; error: string | null }> {
  const provider = getSmsProvider(row.providerCode);
  if (!provider) {
    return { ok: false, error: `No adapter is registered for provider "${row.providerCode}" yet.` };
  }
  if (!provider.testProvider) {
    return { ok: false, error: `Provider "${row.providerCode}" does not support connection tests yet.` };
  }
  try {
    const config = decryptJson(row.credentials);
    const result = await provider.testProvider(config);
    return { ok: result.success, error: result.success ? null : (result.error ?? 'Provider test failed') };
  } catch {
    // decryptJson throws on wrong ENCRYPTION_KEY / corrupted ciphertext.
    return { ok: false, error: 'Stored credentials could not be decrypted. Re-enter the credentials.' };
  }
}
