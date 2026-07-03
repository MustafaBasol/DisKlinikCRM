/**
 * smsRoutingPolicy.ts — Clinic destination-region permissions + routing
 * policy resolution, shared by the real send pipeline (smsService.ts) and
 * the platform admin preview endpoint so both always agree on the outcome.
 *
 * Resolution order: normalize phone -> detect region -> apply routing
 * policy (may force a region, blocking on conflict) -> check the clinic is
 * allowed to send to that region -> pick a provider (clinic-level legacy
 * override first, else the region's platform default). Every failure path
 * returns a stable code so callers can render/log a clear reason.
 */

import { normalizeSmsPhone, resolveSmsRegion, type SmsRegion } from './smsRouting.js';
import { resolvePlatformSmsProvider, type PlatformSmsRegion } from './platformSmsProviders.js';
import { decryptJson } from '../../utils/encryption.js';

export const SMS_ROUTING_POLICIES = [
  'automatic_by_recipient_phone_region',
  'force_turkey_provider',
  'force_europe_provider',
] as const;
export type SmsRoutingPolicy = (typeof SMS_ROUTING_POLICIES)[number];

export const DEFAULT_SMS_ROUTING_POLICY: SmsRoutingPolicy = 'automatic_by_recipient_phone_region';

export function normalizeSmsRoutingPolicy(raw: string | null | undefined): SmsRoutingPolicy {
  return (SMS_ROUTING_POLICIES as readonly string[]).includes(raw ?? '')
    ? (raw as SmsRoutingPolicy)
    : DEFAULT_SMS_ROUTING_POLICY;
}

export type SmsRoutingSettings = {
  turkeyAllowed: boolean;
  europeAllowed: boolean;
  routingPolicy: string | null;
  /** Legacy clinic-level override, wins over the platform default when set. */
  turkeyProvider?: string | null;
  turkeyProviderConfig?: unknown;
  europeProvider?: string | null;
  europeProviderConfig?: unknown;
};

export type SmsRoutingDeps = {
  getPlatformProvider: typeof resolvePlatformSmsProvider;
};

const defaultRoutingDeps: SmsRoutingDeps = { getPlatformProvider: resolvePlatformSmsProvider };

export type SmsRoutingBlockCode =
  | 'invalid_phone'
  | 'region_unsupported'
  | 'region_disabled'
  | 'policy_conflict'
  | 'provider_not_configured';

export type SmsRoutingResolution =
  | {
      ok: true;
      normalizedPhone: string;
      detectedRegion: 'tr' | 'eu';
      targetRegion: 'tr' | 'eu';
      providerKey: string;
      providerSource: 'clinic_override' | 'platform_default';
      config: unknown;
      senderName: string | null;
    }
  | {
      ok: false;
      normalizedPhone: string | null;
      detectedRegion: SmsRegion | null;
      code: SmsRoutingBlockCode;
      message: string;
    };

const REGION_LABEL: Record<'tr' | 'eu', string> = { tr: 'Turkey', eu: 'Europe' };

export async function resolveSmsRouting(
  phone: string | null | undefined,
  settings: SmsRoutingSettings | null | undefined,
  deps: SmsRoutingDeps = defaultRoutingDeps,
): Promise<SmsRoutingResolution> {
  const normalizedPhone = normalizeSmsPhone(phone);
  if (!normalizedPhone) {
    return {
      ok: false, normalizedPhone: null, detectedRegion: null,
      code: 'invalid_phone', message: 'Recipient phone number is missing or invalid.',
    };
  }

  const detectedRegion = resolveSmsRegion(normalizedPhone);
  if (detectedRegion === 'unsupported') {
    return {
      ok: false, normalizedPhone, detectedRegion,
      code: 'region_unsupported', message: 'This phone number region is not supported for SMS.',
    };
  }

  const policy = normalizeSmsRoutingPolicy(settings?.routingPolicy);
  const targetRegion: 'tr' | 'eu' =
    policy === 'force_turkey_provider' ? 'tr' : policy === 'force_europe_provider' ? 'eu' : detectedRegion;

  if (targetRegion !== detectedRegion) {
    return {
      ok: false, normalizedPhone, detectedRegion,
      code: 'policy_conflict',
      message: `Routing policy forces the ${REGION_LABEL[targetRegion]} provider, but the recipient number is in ${REGION_LABEL[detectedRegion]}.`,
    };
  }

  const regionAllowed = targetRegion === 'tr' ? settings?.turkeyAllowed : settings?.europeAllowed;
  if (!regionAllowed) {
    return {
      ok: false, normalizedPhone, detectedRegion,
      code: 'region_disabled',
      message: `Sending to ${REGION_LABEL[targetRegion]} numbers is not enabled for this clinic.`,
    };
  }

  const clinicProviderKey = targetRegion === 'tr' ? settings?.turkeyProvider : settings?.europeProvider;
  if (clinicProviderKey) {
    const rawConfig = targetRegion === 'tr' ? settings?.turkeyProviderConfig : settings?.europeProviderConfig;
    return {
      ok: true, normalizedPhone, detectedRegion, targetRegion,
      providerKey: clinicProviderKey, providerSource: 'clinic_override',
      config: decryptJson(rawConfig), senderName: null,
    };
  }

  const platform = await deps.getPlatformProvider(targetRegion as PlatformSmsRegion);
  if (!platform) {
    return {
      ok: false, normalizedPhone, detectedRegion,
      code: 'provider_not_configured',
      message: `No ${REGION_LABEL[targetRegion]} SMS provider is configured.`,
    };
  }

  return {
    ok: true, normalizedPhone, detectedRegion, targetRegion,
    providerKey: platform.providerKey, providerSource: 'platform_default',
    config: platform.config, senderName: platform.senderName,
  };
}
