/**
 * smsCommunicationPurposeMap.ts — Maps the SMS module's own purpose
 * taxonomy (SmsPurpose, smsTemplating.ts) onto the general-purpose
 * CommunicationPurpose taxonomy used by the central KVKK-HIGH-007 consent
 * decision service (communicationConsentPolicy.ts).
 *
 * The two taxonomies are intentionally separate — SmsPurpose predates and
 * remains the source of truth for SMS template/routing logic — this map is
 * the one place that reconciles them for consent evaluation.
 */

import type { SmsPurpose } from './smsTemplating.js';
import type { CommunicationPurpose } from '../communicationConsent/taxonomy.js';

export const SMS_PURPOSE_TO_COMMUNICATION_PURPOSE: Record<SmsPurpose, CommunicationPurpose> = {
  appointment_confirmation: 'appointment_reminder',
  appointment_reminder: 'appointment_reminder',
  appointment_cancellation: 'appointment_reminder',
  appointment_reschedule: 'appointment_reminder',
  no_show_recovery: 'no_show_recovery',
  post_treatment_followup: 'clinical_followup',
  manual_message: 'operational',
  payment_reminder: 'operational',
  marketing: 'marketing',
};
