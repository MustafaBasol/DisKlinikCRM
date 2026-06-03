import type { SessionType } from './sessionCookies.js';

function readBooleanFlag(value: string | undefined, defaultValue: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) return false;
  if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  return defaultValue;
}

export function isBearerFallbackEnabled(type: SessionType): boolean {
  const specificKey = type === 'clinic'
    ? 'CLINIC_BEARER_FALLBACK_ENABLED'
    : 'PLATFORM_BEARER_FALLBACK_ENABLED';

  return readBooleanFlag(
    process.env[specificKey] ?? process.env.AUTH_BEARER_FALLBACK_ENABLED,
    true,
  );
}

export function getBearerFallbackWarnings(): string[] {
  if (process.env.NODE_ENV !== 'production') return [];

  const warnings: string[] = [];
  if (isBearerFallbackEnabled('clinic')) {
    warnings.push('Clinic Bearer auth fallback is enabled. Disable CLINIC_BEARER_FALLBACK_ENABLED after cookie auth is verified.');
  }
  if (isBearerFallbackEnabled('platform')) {
    warnings.push('Platform Bearer auth fallback is enabled. Disable PLATFORM_BEARER_FALLBACK_ENABLED after cookie auth is verified.');
  }

  return warnings;
}
