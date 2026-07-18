/**
 * taxonomy.ts — Channel/purpose/status/source vocabulary for KVKK-HIGH-007
 * communication preference & consent management.
 *
 * Technical control only — see docs/compliance/56-kvkk-communication-preference-and-consent-management.md.
 * This file intentionally contains no legal conclusions; it only names the
 * technical categories the decision service and API operate on.
 */

export const COMMUNICATION_CHANNELS = [
  'sms',
  'email',
  'whatsapp',
  'phone_call',
  'push',
] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export const COMMUNICATION_PURPOSES = [
  'transactional',
  'appointment_reminder',
  'appointment_followup',
  'clinical_followup',
  'recall',
  'no_show_recovery',
  'operational',
  'marketing',
  'campaign',
  'survey',
  'legal_notice',
  'security_notice',
] as const;
export type CommunicationPurpose = (typeof COMMUNICATION_PURPOSES)[number];

/**
 * Purposes that are always allowed by explicit policy and never require a
 * patient preference row. These are account/security/legal communications,
 * not patient marketing or clinical outreach — kept outside consent
 * enforcement per KVKK-HIGH-007 scope (section 3.7 of the task spec).
 */
export const POLICY_EXCEPTION_PURPOSES: readonly CommunicationPurpose[] = [
  'transactional',
  'legal_notice',
  'security_notice',
] as const;

export const COMMUNICATION_PREFERENCE_STATUSES = [
  'granted',
  'denied',
  'withdrawn',
  'unknown',
  'not_required',
] as const;
export type CommunicationPreferenceStatus = (typeof COMMUNICATION_PREFERENCE_STATUSES)[number];

export const COMMUNICATION_CONSENT_SOURCES = [
  'patient_portal',
  'public_booking',
  'staff',
  'import',
  'api',
  'whatsapp',
  'sms_keyword',
  'email_unsubscribe',
  'legacy',
  'system',
] as const;
export type CommunicationConsentSource = (typeof COMMUNICATION_CONSENT_SOURCES)[number];

export function isCommunicationChannel(value: string): value is CommunicationChannel {
  return (COMMUNICATION_CHANNELS as readonly string[]).includes(value);
}

export function isCommunicationPurpose(value: string): value is CommunicationPurpose {
  return (COMMUNICATION_PURPOSES as readonly string[]).includes(value);
}

export function isCommunicationConsentSource(value: string): value is CommunicationConsentSource {
  return (COMMUNICATION_CONSENT_SOURCES as readonly string[]).includes(value);
}

export function isPolicyExceptionPurpose(purpose: CommunicationPurpose): boolean {
  return (POLICY_EXCEPTION_PURPOSES as readonly string[]).includes(purpose);
}
