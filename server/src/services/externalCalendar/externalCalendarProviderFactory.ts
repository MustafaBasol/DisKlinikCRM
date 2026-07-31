/**
 * externalCalendarProviderFactory.ts
 *
 * Returns the correct ExternalCalendarProvider instance for a given provider
 * key. Extend this map when new dental-software providers are added — no
 * other module (routes, jobs, webhook receiver) should import a concrete
 * provider class directly. Mirrors whatsappProviderFactory.ts.
 */

import type { ExternalCalendarProvider } from './ExternalCalendarProvider.js';
import { DigiDentisProvider } from './digidentis/DigiDentisProvider.js';

const PROVIDERS: Record<string, () => ExternalCalendarProvider> = {
  digidentis: () => new DigiDentisProvider(),
};

export function getExternalCalendarProvider(providerKey: string): ExternalCalendarProvider {
  const factory = PROVIDERS[providerKey];
  if (!factory) {
    throw new Error(
      `Unknown external calendar provider: "${providerKey}". Supported: ${Object.keys(PROVIDERS).join(', ')}`,
    );
  }
  return factory();
}

export function listSupportedExternalCalendarProviders(): string[] {
  return Object.keys(PROVIDERS);
}
