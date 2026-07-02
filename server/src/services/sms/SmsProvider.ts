/**
 * SmsProvider.ts — Provider-Agnostic SMS Interface
 *
 * All SMS providers (Turkey providers, Europe providers, future integrations)
 * must implement this interface. Core messaging code calls smsService, never
 * providers directly — mirroring the WhatsAppProvider pattern.
 *
 * Real providers (e.g. NetGSM/İleti Merkezi for Turkey, Twilio/Vonage for
 * Europe) plug in later by adding an entry to the registry in smsProviders.ts.
 */

export type SmsSendPayload = {
  /** Recipient in E.164 format (e.g. +905321234567) */
  phone: string;
  text: string;
  /** Alphanumeric sender id / originator, when the provider supports it */
  senderName?: string | null;
};

export type SmsSendResult = {
  success: boolean;
  externalMessageId?: string | null;
  error?: string;
};

export type SmsProviderConfig = Record<string, unknown> | null | undefined;

export interface SmsProvider {
  /** Registry key, e.g. 'mock_turkey', 'netgsm', 'twilio' */
  readonly key: string;
  /** Send a single SMS. Must never throw — return { success: false, error }. */
  sendSms(payload: SmsSendPayload, config: SmsProviderConfig): Promise<SmsSendResult>;
  /**
   * Optional connectivity/credentials check used by the platform admin
   * "test provider" action. Must never throw. Real adapters should hit the
   * vendor's auth/balance endpoint; mocks simulate success.
   */
  testProvider?(config: SmsProviderConfig): Promise<SmsSendResult>;
}
