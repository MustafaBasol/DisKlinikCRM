/**
 * smsTemplating.ts — SMS body rendering, variable validation, consent rules,
 * and opt-out keyword parsing. Pure functions except renderSmsBody's date
 * formatting via clinic operating preferences.
 */

import { getClinicOperatingPreferences } from '../clinicOperatingPreferences.js';

// ── Purposes ──────────────────────────────────────────────────────────────────

export const SMS_PURPOSES = [
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancellation',
  'appointment_reschedule',
  'no_show_recovery',
  'post_treatment_followup',
  'manual_message',
  'payment_reminder',
  'marketing',
] as const;

export type SmsPurpose = typeof SMS_PURPOSES[number];

// ── Variable rendering ────────────────────────────────────────────────────────

export type SmsRenderContext = {
  patient?: { firstName: string; lastName: string } | null;
  clinic?: { id: string; name: string } | null;
  appointment?: {
    startTime: Date | string;
    practitioner?: { firstName: string; lastName: string } | null;
    appointmentType?: { name: string } | null;
  } | null;
};

/** Returns the variable names still unresolved in a rendered text (e.g. ['patient_name']). */
export function findUnresolvedVariables(text: string): string[] {
  const matches = text.match(/{{\s*([a-zA-Z0-9_]+)\s*}}/g) ?? [];
  return [...new Set(matches.map(m => m.replace(/[{}\s]/g, '')))];
}

/**
 * Render {{variable}} placeholders. Variables without a value in the context
 * are left unresolved on purpose — the caller must check
 * findUnresolvedVariables() and block the send.
 */
export async function renderSmsBody(templateBody: string, context: SmsRenderContext): Promise<string> {
  const preferences = context.clinic?.id
    ? await getClinicOperatingPreferences(context.clinic.id)
    : null;

  const start = context.appointment ? new Date(context.appointment.startTime) : null;

  const formatDate = (value: Date): string => {
    if (!preferences) return value.toISOString().slice(0, 10);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: preferences.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(value);
    const y = parts.find(p => p.type === 'year')?.value ?? '0000';
    const m = parts.find(p => p.type === 'month')?.value ?? '00';
    const d = parts.find(p => p.type === 'day')?.value ?? '00';
    if (preferences.dateFormat === 'MM/dd/yyyy') return `${m}/${d}/${y}`;
    if (preferences.dateFormat === 'dd/MM/yyyy') return `${d}/${m}/${y}`;
    if (preferences.dateFormat === 'yyyy-MM-dd') return `${y}-${m}-${d}`;
    return `${d}.${m}.${y}`;
  };

  const formatTime = (value: Date): string =>
    new Intl.DateTimeFormat(preferences?.locale ?? 'en-US', {
      timeZone: preferences?.timezone,
      hour: 'numeric', minute: '2-digit',
      hour12: preferences?.timeFormat === '12h',
    }).format(value);

  const vars: Record<string, string> = {
    patient_name: context.patient ? `${context.patient.firstName} ${context.patient.lastName}`.trim() : '',
    clinic_name: context.clinic?.name ?? '',
    appointment_date: start ? formatDate(start) : '',
    appointment_time: start ? formatTime(start) : '',
    practitioner_name: context.appointment?.practitioner
      ? `Dr. ${context.appointment.practitioner.firstName} ${context.appointment.practitioner.lastName}`
      : '',
    service_name: context.appointment?.appointmentType?.name ?? '',
  };

  let rendered = templateBody;
  for (const [key, value] of Object.entries(vars)) {
    if (!value) continue; // leave unresolved so validation catches it
    rendered = rendered.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value);
  }
  return rendered;
}

// ── Consent rules ─────────────────────────────────────────────────────────────

export type SmsConsentInput = {
  purpose: SmsPurpose;
  patient: {
    smsOptOut: boolean;
    communicationConsent: boolean;
    marketingConsent: boolean;
  };
};

export type SmsConsentDecision =
  | { allowed: true }
  | { allowed: false; reason: 'sms_opt_out' | 'missing_marketing_consent' | 'missing_communication_consent' };

/**
 * KVKK/GDPR consent gate for outbound SMS:
 *  - an explicit SMS opt-out blocks everything;
 *  - marketing requires explicit marketing consent;
 *  - all other purposes require general communication consent.
 */
export function evaluateSmsConsent({ purpose, patient }: SmsConsentInput): SmsConsentDecision {
  if (patient.smsOptOut) return { allowed: false, reason: 'sms_opt_out' };
  if (purpose === 'marketing') {
    return patient.marketingConsent
      ? { allowed: true }
      : { allowed: false, reason: 'missing_marketing_consent' };
  }
  return patient.communicationConsent
    ? { allowed: true }
    : { allowed: false, reason: 'missing_communication_consent' };
}

// ── Opt-out keywords (foundation for inbound STOP handling) ───────────────────

const OPT_OUT_KEYWORDS = new Set(['STOP', 'RET', 'IPTAL', 'İPTAL', 'UNSUBSCRIBE']);

/** True when an inbound reply is an SMS opt-out request (STOP / RET / IPTAL / UNSUBSCRIBE). */
export function isSmsOptOutKeyword(text: string | null | undefined): boolean {
  if (!text) return false;
  return OPT_OUT_KEYWORDS.has(text.trim().toLocaleUpperCase('tr-TR'))
    || OPT_OUT_KEYWORDS.has(text.trim().toUpperCase());
}
