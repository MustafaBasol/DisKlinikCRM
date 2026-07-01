/**
 * smsService.ts — Outbound SMS pipeline (add-on gated, quota + consent safe).
 *
 * Every send goes through:
 *   1. Add-on entitlement check (disabled by default)
 *   2. Phone normalization + Turkey/Europe region routing
 *   3. Consent gate (opt-out, marketing consent, communication consent)
 *   4. Template rendering + unresolved-variable validation
 *   5. Duplicate prevention (dedupeKey)
 *   6. Atomic monthly quota reservation
 *   7. Provider-agnostic send (mock providers until real ones are connected)
 *
 * Blocked attempts (quota/consent/region/template) are recorded in SmsMessage
 * history so staff can see WHY a message was not sent. Logs never contain
 * message bodies or full phone numbers.
 */

import prisma from '../../db.js';
import { recordOperationalEvent } from '../operationalEventService.js';
import { getSmsProvider } from './smsProviders.js';
import { normalizeSmsPhone, resolveSmsRegion, type SmsRegion } from './smsRouting.js';
import {
  getSmsEntitlement,
  reserveSmsQuotaSlot,
  releaseSmsQuotaSlot,
  type SmsEntitlement,
} from './smsEntitlement.js';
import {
  evaluateSmsConsent,
  findUnresolvedVariables,
  renderSmsBody,
  type SmsPurpose,
  type SmsRenderContext,
} from './smsTemplating.js';

const MAX_SMS_BODY_LENGTH = 1000;

export type SmsBlockCode =
  | 'addon_disabled'
  | 'invalid_phone'
  | 'region_unsupported'
  | 'provider_not_configured'
  | 'consent_blocked'
  | 'template_invalid'
  | 'unresolved_variables'
  | 'quota_exceeded'
  | 'duplicate'
  | 'send_failed';

export type SendClinicSmsArgs = {
  organizationId: string;
  clinicId: string;
  patientId: string;
  purpose: SmsPurpose;
  /** Explicit body text. Either body or templateId must be provided. */
  body?: string | null;
  /** MessageTemplate (channel=sms) to render. */
  templateId?: string | null;
  appointmentId?: string | null;
  /** Override recipient; defaults to the patient's phone. */
  phone?: string | null;
  /** Duplicate-prevention key for automated jobs (e.g. reminder:apt-123:24h). */
  dedupeKey?: string | null;
  createdById?: string | null;
};

export type SendClinicSmsResult =
  | { ok: true; messageId: string; provider: string; region: SmsRegion }
  | { ok: false; code: SmsBlockCode; error: string; messageId?: string };

/** Injectable deps so tests can run the full pipeline without a live provider/DB side effects. */
export type SmsSendDeps = {
  getEntitlement: typeof getSmsEntitlement;
  reserveQuota: typeof reserveSmsQuotaSlot;
  releaseQuota: typeof releaseSmsQuotaSlot;
  getProvider: typeof getSmsProvider;
};

const defaultDeps: SmsSendDeps = {
  getEntitlement: getSmsEntitlement,
  reserveQuota: reserveSmsQuotaSlot,
  releaseQuota: releaseSmsQuotaSlot,
  getProvider: getSmsProvider,
};

function pickProviderForRegion(entitlement: SmsEntitlement, region: SmsRegion): {
  providerKey: string | null;
  config: unknown;
} {
  if (region === 'tr') {
    return {
      providerKey: entitlement.settings?.turkeyProvider ?? null,
      config: entitlement.settings?.turkeyProviderConfig ?? null,
    };
  }
  if (region === 'eu') {
    return {
      providerKey: entitlement.settings?.europeProvider ?? null,
      config: entitlement.settings?.europeProviderConfig ?? null,
    };
  }
  return { providerKey: null, config: null };
}

type BlockedRecordArgs = SendClinicSmsArgs & {
  recipient: string;
  body: string;
  status: string;
  region?: SmsRegion | null;
  providerKey?: string | null;
  errorCode: string;
  errorMessage: string;
};

/** Record a blocked/failed attempt in history (best-effort, never throws). */
async function recordBlocked(args: BlockedRecordArgs): Promise<string | undefined> {
  try {
    const record = await prisma.smsMessage.create({
      data: {
        organizationId: args.organizationId,
        clinicId: args.clinicId,
        patientId: args.patientId,
        appointmentId: args.appointmentId ?? null,
        templateId: args.templateId ?? null,
        purpose: args.purpose,
        recipient: args.recipient,
        body: args.body,
        status: args.status,
        providerRegion: args.region ?? null,
        provider: args.providerKey ?? null,
        errorCode: args.errorCode,
        errorMessage: args.errorMessage,
        dedupeKey: args.dedupeKey ?? null,
        createdById: args.createdById ?? null,
      },
    });
    return record.id;
  } catch {
    return undefined;
  }
}

export async function sendClinicSms(
  args: SendClinicSmsArgs,
  deps: SmsSendDeps = defaultDeps,
): Promise<SendClinicSmsResult> {
  // 1. Add-on gate — hard stop, no history row (clinic does not have the module)
  const entitlement = await deps.getEntitlement(args.clinicId);
  if (!entitlement.enabled) {
    return { ok: false, code: 'addon_disabled', error: 'SMS add-on is not active for this clinic.' };
  }

  // Load patient (clinic-scoped) with consent fields + phone
  const patient = await prisma.patient.findFirst({
    where: { id: args.patientId, clinicId: args.clinicId, deletedAt: null },
    select: {
      id: true, firstName: true, lastName: true, phone: true,
      smsOptOut: true, communicationConsent: true, marketingConsent: true,
    },
  });
  if (!patient) {
    return { ok: false, code: 'invalid_phone', error: 'Patient not found in this clinic.' };
  }

  // 2. Phone + region routing
  const normalized = normalizeSmsPhone(args.phone ?? patient.phone);
  if (!normalized) {
    return { ok: false, code: 'invalid_phone', error: 'Recipient phone number is missing or invalid.' };
  }
  const region = resolveSmsRegion(normalized);

  // 3. Consent gate
  const consent = evaluateSmsConsent({ purpose: args.purpose, patient });
  if (!consent.allowed) {
    const messageId = await recordBlocked({
      ...args, recipient: normalized, body: '', status: 'blocked_consent',
      region, errorCode: consent.reason,
      errorMessage: 'Patient consent rules block this SMS.',
    });
    return { ok: false, code: 'consent_blocked', error: 'Patient consent rules block this SMS.', messageId };
  }

  // 4. Body: explicit or rendered template; unresolved variables block the send
  let body = (args.body ?? '').trim();
  if (args.templateId) {
    const template = await prisma.messageTemplate.findFirst({
      where: { id: args.templateId, clinicId: args.clinicId, channel: 'sms', isActive: true },
      select: { body: true },
    });
    if (!template) {
      return { ok: false, code: 'template_invalid', error: 'SMS template not found or inactive for this clinic.' };
    }
    const [clinic, appointment] = await Promise.all([
      prisma.clinic.findUnique({ where: { id: args.clinicId }, select: { id: true, name: true } }),
      args.appointmentId
        ? prisma.appointment.findFirst({
            where: { id: args.appointmentId, clinicId: args.clinicId, patientId: args.patientId },
            select: {
              startTime: true,
              practitioner: { select: { firstName: true, lastName: true } },
              appointmentType: { select: { name: true } },
            },
          })
        : Promise.resolve(null),
    ]);
    const context: SmsRenderContext = { patient, clinic, appointment };
    body = (await renderSmsBody(template.body, context)).trim();
  }

  if (!body) {
    return { ok: false, code: 'template_invalid', error: 'Message body is empty.' };
  }
  const unresolved = findUnresolvedVariables(body);
  if (unresolved.length > 0) {
    const messageId = await recordBlocked({
      ...args, recipient: normalized, body, status: 'blocked_template',
      region, errorCode: 'unresolved_variables',
      errorMessage: `Unresolved template variables: ${unresolved.join(', ')}`,
    });
    return {
      ok: false, code: 'unresolved_variables',
      error: `Message has unresolved variables (${unresolved.join(', ')}) and was not sent.`,
      messageId,
    };
  }
  body = body.slice(0, MAX_SMS_BODY_LENGTH);

  // Region + provider resolution
  if (region === 'unsupported') {
    const messageId = await recordBlocked({
      ...args, recipient: normalized, body, status: 'blocked_region',
      region, errorCode: 'region_unsupported',
      errorMessage: 'Recipient region is not supported for SMS.',
    });
    return { ok: false, code: 'region_unsupported', error: 'This phone number region is not supported for SMS.', messageId };
  }

  const { providerKey, config } = pickProviderForRegion(entitlement, region);
  const provider = deps.getProvider(providerKey);
  if (!provider) {
    const messageId = await recordBlocked({
      ...args, recipient: normalized, body, status: 'failed',
      region, providerKey, errorCode: 'provider_not_configured',
      errorMessage: `No ${region === 'tr' ? 'Turkey' : 'Europe'} SMS provider is configured.`,
    });
    return {
      ok: false, code: 'provider_not_configured',
      error: `No ${region === 'tr' ? 'Turkey' : 'Europe'} SMS provider is configured for this clinic.`,
      messageId,
    };
  }

  // 5. Duplicate prevention
  if (args.dedupeKey) {
    const existing = await prisma.smsMessage.findUnique({
      where: { dedupeKey: args.dedupeKey },
      select: { id: true },
    });
    if (existing) {
      return { ok: false, code: 'duplicate', error: 'This SMS was already queued or sent.', messageId: existing.id };
    }
  }

  // 6. Quota reservation (atomic)
  const reserved = await deps.reserveQuota(args.clinicId, entitlement.monthlyQuota);
  if (!reserved) {
    const messageId = await recordBlocked({
      ...args, recipient: normalized, body, status: 'blocked_quota',
      region, providerKey, errorCode: 'quota_exceeded',
      errorMessage: `Monthly SMS quota (${entitlement.monthlyQuota}) is exhausted.`,
    });
    recordOperationalEvent({
      organizationId: args.organizationId,
      clinicId: args.clinicId,
      severity: 'warning',
      source: 'sms',
      message: 'SMS blocked: monthly quota exhausted',
      metadata: { purpose: args.purpose, quota: entitlement.monthlyQuota },
    });
    return { ok: false, code: 'quota_exceeded', error: 'Monthly SMS quota is exhausted. Sending is blocked.', messageId };
  }

  // Create the queued record before the provider call so a crash never loses history
  let record;
  try {
    record = await prisma.smsMessage.create({
      data: {
        organizationId: args.organizationId,
        clinicId: args.clinicId,
        patientId: args.patientId,
        appointmentId: args.appointmentId ?? null,
        templateId: args.templateId ?? null,
        purpose: args.purpose,
        recipient: normalized,
        body,
        status: 'queued',
        providerRegion: region,
        provider: provider.key,
        dedupeKey: args.dedupeKey ?? null,
        createdById: args.createdById ?? null,
      },
    });
  } catch (err: unknown) {
    await deps.releaseQuota(args.clinicId);
    // Unique violation on dedupeKey → concurrent duplicate
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('dedupeKey') || msg.includes('Unique constraint')) {
      return { ok: false, code: 'duplicate', error: 'This SMS was already queued or sent.' };
    }
    throw err;
  }

  // 7. Provider send
  const sendResult = await provider.sendSms(
    { phone: normalized, text: body, senderName: entitlement.settings?.senderName ?? null },
    (config ?? null) as Record<string, unknown> | null,
  );

  if (!sendResult.success) {
    await deps.releaseQuota(args.clinicId);
    await prisma.smsMessage.update({
      where: { id: record.id },
      data: {
        status: 'failed',
        errorCode: 'send_failed',
        errorMessage: sendResult.error ?? 'Provider send failed',
      },
    });
    recordOperationalEvent({
      organizationId: args.organizationId,
      clinicId: args.clinicId,
      severity: 'error',
      source: 'sms',
      message: 'SMS provider send failed',
      metadata: { provider: provider.key, region, purpose: args.purpose, smsMessageId: record.id },
    });
    return { ok: false, code: 'send_failed', error: sendResult.error ?? 'SMS provider send failed.', messageId: record.id };
  }

  await prisma.smsMessage.update({
    where: { id: record.id },
    data: {
      status: 'sent',
      sentAt: new Date(),
      externalMessageId: sendResult.externalMessageId ?? null,
    },
  });

  return { ok: true, messageId: record.id, provider: provider.key, region };
}
