/**
 * whatsappProviderFactory.ts
 *
 * Returns the correct WhatsAppProvider instance for a given provider string.
 * Extend this switch when new providers are added.
 */

import type { WhatsAppProvider } from './WhatsAppProvider.js';
import { EvolutionWhatsAppProvider } from './EvolutionWhatsAppProvider.js';
import { MetaCloudWhatsAppProvider } from './MetaCloudWhatsAppProvider.js';

const PROVIDERS: Record<string, () => WhatsAppProvider> = {
  evolution_api: () => new EvolutionWhatsAppProvider(),
  meta_cloud_api: () => new MetaCloudWhatsAppProvider(),
};

export function getWhatsAppProvider(providerKey: string): WhatsAppProvider {
  const factory = PROVIDERS[providerKey];
  if (!factory) {
    throw new Error(
      `Unknown WhatsApp provider: "${providerKey}". Supported: ${Object.keys(PROVIDERS).join(', ')}`,
    );
  }
  return factory();
}
