/**
 * whatsappCommunicationPurposeMap.ts — Maps the generic message-composer's
 * own template-purpose taxonomy (MessageTemplatePurpose, schemas/index.ts)
 * onto the general-purpose CommunicationPurpose taxonomy used by the central
 * KVKK-HIGH-007 consent decision service (communicationConsentPolicy.ts).
 *
 * Mirrors server/src/services/sms/smsCommunicationPurposeMap.ts exactly,
 * value-for-value, except `general_message` (this taxonomy's equivalent of
 * SMS's `manual_message`) — both map to `operational`, deliberately the
 * least-privileged non-exception bucket: it fails closed by construction
 * once enforcement is active, since `operational` is not a policy-exception
 * purpose and a central-unknown status still denies.
 *
 * Applies only to POST /api/messages/:id/send (the manual composer / recall
 * dispatch path) — NOT to WhatsApp inbox replies or the AI auto-responder,
 * which are direct replies within a patient-initiated conversation and are
 * explicitly out of scope here (see routes/messages.ts).
 */

import type { MessageTemplatePurpose } from '../../schemas/index.js';
import type { CommunicationPurpose } from '../communicationConsent/taxonomy.js';

export const MESSAGE_TEMPLATE_PURPOSE_TO_COMMUNICATION_PURPOSE: Record<MessageTemplatePurpose, CommunicationPurpose> = {
  appointment_reminder: 'appointment_reminder',
  appointment_confirmation: 'appointment_reminder',
  appointment_cancellation: 'appointment_reminder',
  appointment_reschedule: 'appointment_reminder',
  no_show_recovery: 'no_show_recovery',
  post_treatment_followup: 'clinical_followup',
  payment_reminder: 'operational',
  marketing: 'marketing',
  general_message: 'operational',
};

/** No template selected (free-typed body) also defaults to the least-privileged operational bucket. */
export const DEFAULT_MESSAGE_COMMUNICATION_PURPOSE: CommunicationPurpose = 'operational';
