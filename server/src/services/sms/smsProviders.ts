/**
 * smsProviders.ts — SMS provider registry.
 *
 * Providers are looked up by key from ClinicSmsSettings (turkeyProvider /
 * europeProvider). Unknown or unconfigured keys fail safely — no message is
 * sent and the attempt is recorded as failed/blocked.
 *
 * Currently only mock providers are registered; real Turkey/Europe SMS
 * companies are connected later by implementing SmsProvider and adding them
 * here (credentials live in ClinicSmsSettings.*ProviderConfig, encrypted
 * fields where needed).
 */

import { randomUUID } from 'node:crypto';
import type { SmsProvider, SmsProviderConfig, SmsSendPayload, SmsSendResult } from './SmsProvider.js';

/** Mock provider used until real SMS companies are connected. */
class MockSmsProvider implements SmsProvider {
  constructor(readonly key: string) {}

  async sendSms(payload: SmsSendPayload, config: SmsProviderConfig): Promise<SmsSendResult> {
    if (!payload.phone || !payload.text.trim()) {
      return { success: false, error: 'Recipient and text are required' };
    }
    // Test hook: a config of { simulateFailure: true } lets tests exercise the failure path.
    if (config && (config as Record<string, unknown>).simulateFailure === true) {
      return { success: false, error: `Simulated ${this.key} provider failure` };
    }
    return { success: true, externalMessageId: `${this.key}-${randomUUID()}` };
  }
}

const REGISTRY = new Map<string, SmsProvider>([
  ['mock_turkey', new MockSmsProvider('mock_turkey')],
  ['mock_europe', new MockSmsProvider('mock_europe')],
]);

export const AVAILABLE_SMS_PROVIDERS = {
  tr: ['mock_turkey'],
  eu: ['mock_europe'],
} as const;

export function getSmsProvider(key: string | null | undefined): SmsProvider | null {
  if (!key) return null;
  return REGISTRY.get(key) ?? null;
}
