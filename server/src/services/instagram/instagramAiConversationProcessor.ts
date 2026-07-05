import { Prisma } from '@prisma/client';
import prisma from '../../db.js';
import { normalizeDateWithGoogleAi } from '../googleAiStudio.js';
import {
  handleAwaitingConfirmationStep,
  handleAwaitingDateStep,
  handleAwaitingServiceStep,
  handleAwaitingTimeStep,
  isDeterministicConfirmationReply,
  type BookingStateJson,
} from '../whatsappBookingFlow.js';
import { resolveWhatsAppConversationAgentDecision } from '../whatsappConversationAgent.js';
import type { WhatsAppAgentDecision } from '../whatsappAgentSchema.js';
import {
  buildAvailableSlots,
  type SavedAvailableSlot,
} from '../whatsappAvailability.js';
import { interpretTimeRequest } from '../whatsappInterpreter.js';
import { sendMessage } from './InstagramMessagingProvider.js';
import type { InstagramConnectionRecord } from './InstagramMessagingProvider.js';
import { recordOperationalEvent } from '../operationalEventService.js';
import { logActivity } from '../../utils/activity.js';
import {
  checkPractitionerAvailability,
  formatClinicDateTime,
  minutesToTime,
} from '../../utils/helpers.js';
import {
  formatTurkishDateLong,
  WHATSAPP_ASSISTANT_TIME_ZONE,
} from '../../utils/whatsappDate.js';
import { sanitizeInboundMessageText } from '../../utils/messageSanitizer.js';
import { checkInboundRateLimit } from '../../utils/inboundRateLimiter.js';
import { assertSlotAvailable, acquireAppointmentSlotLock, SlotConflictError } from '../appointmentRequestSafety.js';
import { upsertContactRequest } from '../../routes/contactRequests.js';
import {
  checkChannelConsent,
  parseConsentReply,
  logChannelConsent,
  loadConsentMetadata,
  MISSING_LEGAL_PROFILE_BLOCK_TEXT,
  CONSENT_DECLINED_TEXT,
  CONSENT_ACCEPTED_TEXT,
  CONSENT_REPROMPT_TEXT,
} from '../channelConsentGate.js';
import { resolveStepAwareWhatsAppIntent } from '../whatsappStepAwareNlu.js';

export type InstagramAssistantStep =
  | 'main_menu'
  | 'awaiting_service'
  | 'awaiting_date'
  | 'awaiting_time'
  | 'awaiting_confirmation'
  | 'awaiting_name'
  | 'awaiting_phone'
  | 'awaiting_handoff_note'
  | 'awaiting_channel_consent'
  | 'post_booking'
  | null;

export type InstagramBookingSummary = {
  serviceName: string | null;
  date: string | null;
  time: string | null;
};

export type InstagramAssistantStateJson = BookingStateJson & {
  pendingHandoffRequestId?: string;
  resumeAfterChannelConsent?: string | null;
  lastBookingSummary?: InstagramBookingSummary | null;
};

type InstagramAssistantClinic = {
  id: string;
  organizationId: string;
  name: string;
  timezone: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
};

export type InstagramAssistantService = {
  id: string;
  name: string;
  durationMinutes: number;
};

const INSTAGRAM_UNKNOWN_PHONE = '0000000000';

type InstagramInboxContext = {
  id: string;
  patientId: string | null;
  senderUsername: string | null;
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
  } | null;
};

export type ProcessInstagramIncomingMessageArgs = {
  organizationId: string;
  clinicId: string | null;
  needsClinicResolution: boolean;
  instagramConnectionId: string;
  externalSenderId: string;
  externalConversationId?: string | null;
  externalMessageId?: string | null;
  senderUsername?: string | null;
  text: string;
  rawPayload?: Record<string, unknown> | null;
};

export type ProcessInstagramIncomingMessageResult =
  | { status: 'processed'; replySent: boolean; replyText: string }
  | { status: 'skipped'; reason: 'clinic_unresolved' | 'connection_unavailable' | 'empty_text' };

const NO_ACTIVE_SERVICES_TEXT =
  'Şu anda bu klinik için randevuya açık hizmet tanımlı görünmüyor. Talebinizi ekibe iletebilirim.';

export const buildInstagramConversationKey = (connectionId: string, externalSenderId: string) =>
  `instagram:${connectionId}:${externalSenderId}`;

const normalizePhoneDigits = (value: string) => value.replace(/@.+$/, '').replace(/\D/g, '');

export const normalizeInstagramPatientPhone = (value: string | null | undefined) => {
  if (!value?.trim()) return null;
  const digits = normalizePhoneDigits(value);
  if (digits.length < 6 || digits.length > 15) return null;
  return digits;
};

export const buildInstagramAppointmentFallbackPhone = (externalSenderId: string) =>
  normalizeInstagramPatientPhone(externalSenderId) ?? INSTAGRAM_UNKNOWN_PHONE;

const hasRealPatientPhone = (value: string | null | undefined) => Boolean(normalizeInstagramPatientPhone(value));

export const canProcessInstagramAi = (args: { clinicId?: string | null; needsClinicResolution?: boolean }) =>
  Boolean(args.clinicId?.trim()) && args.needsClinicResolution !== true;

const summarizeIdentifier = (value: string | null | undefined) => {
  if (!value) return null;
  return { length: value.length, suffix: value.slice(-4) };
};

const senderSuffix = (externalSenderId: string) => externalSenderId.slice(-4);

const logInstagramAgentDecision = (args: {
  clinicId: string;
  externalSenderId: string;
  currentStep: InstagramAssistantStep;
  deterministicMatched: boolean;
  nluUsed: boolean;
  detectedIntent: string;
  confidence: number;
  responseType: string;
}) => {
  console.info('[instagram-agent] decision', {
    provider: 'instagram',
    clinicId: summarizeIdentifier(args.clinicId),
    senderSuffix: senderSuffix(args.externalSenderId),
    currentStep: args.currentStep,
    deterministicMatched: args.deterministicMatched,
    nluUsed: args.nluUsed,
    detectedIntent: args.detectedIntent,
    confidence: args.confidence,
    responseType: args.responseType,
  });
};

const logInstagramIdentityResolution = (args: {
  clinicId: string;
  externalSenderId: string;
  matchCount: number;
  selectedPatientIdPresent: boolean;
  needsNameCollection: boolean;
  needsPhoneCollection: boolean;
  action: string;
}) => {
  console.info('[instagram-agent] identity-resolution', {
    provider: 'instagram',
    clinicId: summarizeIdentifier(args.clinicId),
    senderSuffix: senderSuffix(args.externalSenderId),
    matchCount: args.matchCount,
    selectedPatientIdPresent: args.selectedPatientIdPresent,
    needsNameCollection: args.needsNameCollection,
    needsPhoneCollection: args.needsPhoneCollection,
    action: args.action,
  });
};

const logInstagramPostBookingDecision = (args: {
  clinicId: string;
  externalSenderId: string;
  detectedIntent: string;
  responseType: string;
}) => {
  console.info('[instagram-agent] post-booking-decision', {
    provider: 'instagram',
    clinicId: summarizeIdentifier(args.clinicId),
    senderSuffix: senderSuffix(args.externalSenderId),
    detectedIntent: args.detectedIntent,
    responseType: args.responseType,
  });
};

const normalizeText = (value: string) => value.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');

const normalizeSearchText = (value: string) => normalizeText(value)
  .replace(/ğ/g, 'g')
  .replace(/ü/g, 'u')
  .replace(/ş/g, 's')
  .replace(/ı/g, 'i')
  .replace(/İ/g, 'i')
  .replace(/ö/g, 'o')
  .replace(/ç/g, 'c')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const isNumericPlatformId = (value?: string | null) => Boolean(value?.trim()) && /^\d{8,}$/.test(value!.trim());

const getFirstName = (customerName?: string | null) => {
  if (!customerName?.trim() || isNumericPlatformId(customerName)) return null;
  return customerName.trim().split(/\s+/)[0] ?? null;
};

export const hasUsableInstagramFullName = (value: string | null | undefined) => {
  const parts = value?.trim().split(/\s+/).filter(Boolean) ?? [];
  return parts.length >= 2 && !parts.some(part => /^\d+$/.test(part));
};

export function buildInstagramAppointmentRequestSourceMetadata(args: {
  instagramConnectionId?: string | null;
  externalSenderId: string;
  externalConversationId?: string | null;
  inboxEntryId?: string | null;
}) {
  return {
    source: 'instagram',
    externalSenderId: args.externalSenderId,
    sourceConnectionId: args.instagramConnectionId ?? null,
    sourceInboxEntryId: args.inboxEntryId ?? null,
    sourceConversationId: args.externalConversationId ?? null,
  };
}

export function formatInstagramBookingCreatedReply(args: {
  customerName: string;
  selectedDate: string;
  localStartTime: string;
  practitionerName: string;
  serviceName: string;
}) {
  return `Teşekkürler ${args.customerName}. ${formatTurkishDateLong(args.selectedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} saat ${args.localStartTime} için ${args.practitionerName} adına ${args.serviceName} randevu talebinizi klinik onay ekranına aldım. Klinik ekibi onayladığında size bilgi verilecektir.`;
}

const getPatientFullName = (patient: NonNullable<InstagramInboxContext['patient']>) =>
  `${patient.firstName.trim()} ${patient.lastName.trim()}`.trim();

export const formatInstagramCustomerName = (
  entry: InstagramInboxContext | null,
  _externalSenderId: string,
  senderUsername?: string | null,
): string | null => {
  if (entry?.patient) return getPatientFullName(entry.patient);
  if (entry?.senderUsername?.trim() && !isNumericPlatformId(entry.senderUsername)) return `@${entry.senderUsername.trim()}`;
  if (senderUsername?.trim() && !isNumericPlatformId(senderUsername)) return `@${senderUsername.trim()}`;
  return null;
};

const isGreeting = (text: string) =>
  /^(merhaba|selam|iyi gunler|iyi akşamlar|iyi aksamlar|gunaydin|günaydın|hey)\b/i.test(text.trim());

const isMainMenuCommand = (text: string) => {
  const normalized = normalizeSearchText(text);
  return ['menu', 'menu goster', 'ana menu', 'basa don', 'reset', 'yeniden basla']
    .some(pattern => normalized === pattern || normalized.includes(pattern));
};

const isNegativeHandoffNote = (text: string) => {
  const normalized = normalizeSearchText(text);
  return ['hayir', 'yok', 'gerek yok', 'not yok', 'istemiyorum']
    .some(pattern => normalized === pattern || normalized.includes(pattern));
};

const extractNumericSelection = (text: string) => {
  const match = normalizeText(text).match(/^(\d{1,2})(?:[.)])?$/);
  return match ? Number(match[1]) : null;
};

const extractStandaloneNumericSelection = (text: string) => {
  const match = normalizeText(text).match(/^(\d{1,2})(?:[.)])?$/);
  return match ? Number(match[1]) : null;
};

const isPoliteClosingMessage = (text: string) => {
  const normalized = normalizeSearchText(text);
  return [
    'tesekkurler',
    'tesekkur ederim',
    'cok sag ol',
    'sag ol',
    'sag olun',
    'tamam',
    'iyi gunler',
    'oldun zaten',
  ].some(pattern => normalized === pattern || normalized.includes(pattern));
};

const readStateJson = (value: unknown): InstagramAssistantStateJson => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    availableSlots: Array.isArray(record.availableSlots) ? record.availableSlots as SavedAvailableSlot[] : undefined,
    lastShownSlots: Array.isArray(record.lastShownSlots) ? record.lastShownSlots as SavedAvailableSlot[] : undefined,
    matchedServices: Array.isArray(record.matchedServices)
      ? record.matchedServices as Array<{ id: string; name: string }>
      : undefined,
    pendingConfirmationSlot: record.pendingConfirmationSlot && typeof record.pendingConfirmationSlot === 'object' && !Array.isArray(record.pendingConfirmationSlot)
      ? record.pendingConfirmationSlot as SavedAvailableSlot
      : undefined,
    pendingHandoffRequestId: typeof record.pendingHandoffRequestId === 'string' ? record.pendingHandoffRequestId : undefined,
    resumeAfterChannelConsent: typeof record.resumeAfterChannelConsent === 'string' ? record.resumeAfterChannelConsent : undefined,
    lastBookingSummary: record.lastBookingSummary && typeof record.lastBookingSummary === 'object' && !Array.isArray(record.lastBookingSummary)
      ? record.lastBookingSummary as InstagramBookingSummary
      : undefined,
  };
};

const toPrismaJson = (value: InstagramAssistantStateJson | null | undefined) => {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
};

const buildStateData = (data: {
  customerName?: string | null;
  currentIntent?: string | null;
  step?: string | null;
  selectedAppointmentTypeId?: string | null;
  selectedAppointmentTypeName?: string | null;
  selectedPractitionerId?: string | null;
  selectedDate?: string | null;
  selectedTime?: string | null;
  lastMessage?: string | null;
  lastProviderMessageId?: string | null;
  stateJson?: InstagramAssistantStateJson | null;
}) => {
  const payload: Record<string, unknown> = {};
  if ('customerName' in data) payload.customerName = data.customerName ?? null;
  if ('currentIntent' in data) payload.currentIntent = data.currentIntent ?? null;
  if ('step' in data) payload.step = data.step ?? null;
  if ('selectedAppointmentTypeId' in data) payload.selectedAppointmentTypeId = data.selectedAppointmentTypeId ?? null;
  if ('selectedAppointmentTypeName' in data) payload.selectedAppointmentTypeName = data.selectedAppointmentTypeName ?? null;
  if ('selectedPractitionerId' in data) payload.selectedPractitionerId = data.selectedPractitionerId ?? null;
  if ('selectedDate' in data) payload.selectedDate = data.selectedDate ?? null;
  if ('selectedTime' in data) payload.selectedTime = data.selectedTime ?? null;
  if ('lastMessage' in data) payload.lastMessage = data.lastMessage ?? null;
  if ('lastProviderMessageId' in data) payload.lastProviderMessageId = data.lastProviderMessageId ?? null;
  if ('stateJson' in data) payload.stateJson = toPrismaJson(data.stateJson);
  return payload;
};

const upsertInstagramConversationState = async (
  clinicId: string,
  conversationKey: string,
  data: Parameters<typeof buildStateData>[0],
) => {
  const payload = buildStateData(data);
  return prisma.whatsAppConversationState.upsert({
    where: { clinicId_phone: { clinicId, phone: conversationKey } },
    update: payload,
    create: {
      clinicId,
      phone: conversationKey,
      ...payload,
      stateJson: payload.stateJson ?? Prisma.DbNull,
    } as Prisma.WhatsAppConversationStateUncheckedCreateInput,
  });
};

const resetInstagramConversationState = async (
  clinicId: string,
  conversationKey: string,
  customerName?: string | null,
) => upsertInstagramConversationState(clinicId, conversationKey, {
  customerName: customerName ?? null,
  currentIntent: null,
  step: null,
  selectedAppointmentTypeId: null,
  selectedAppointmentTypeName: null,
  selectedPractitionerId: null,
  selectedDate: null,
  selectedTime: null,
  stateJson: null,
});

// After a successful booking, land on post_booking (not a full reset) so a
// follow-up "teşekkürler" / "durumu nedir" gets a contextual reply instead of
// falling through to the generic top-level fallback.
const resetInstagramConversationToPostBooking = async (
  clinicId: string,
  conversationKey: string,
  customerName: string | null,
  summary: InstagramBookingSummary,
) => upsertInstagramConversationState(clinicId, conversationKey, {
  customerName: customerName ?? null,
  currentIntent: null,
  step: 'post_booking',
  selectedAppointmentTypeId: null,
  selectedAppointmentTypeName: null,
  selectedPractitionerId: null,
  selectedDate: null,
  selectedTime: null,
  stateJson: { lastBookingSummary: summary },
});

const getAssistantServices = async (clinicId: string): Promise<InstagramAssistantService[]> => {
  return prisma.appointmentType.findMany({
    where: { clinicId, isActive: true, isService: true },
    select: { id: true, name: true, durationMinutes: true },
    orderBy: { name: 'asc' },
  });
};

const formatServiceList = (services: InstagramAssistantService[]) =>
  ['Elbette, hangi hizmet icin randevu planlamak istersiniz?', ...services.map((service, index) => `${index + 1}. ${service.name}`)].join('\n');

export const formatMainMenu = (_clinicName: string, customerName?: string | null) => {
  const firstName = getFirstName(customerName);
  return [
    firstName ? `Merhaba ${firstName}, size nasıl yardımcı olabilirim?` : 'Merhaba, size nasıl yardımcı olabilirim?',
    '',
    '1. Randevu almak',
    '2. Randevumu sorgulamak',
    '3. Randevumu iptal etmek',
    '4. Hizmetler hakkında bilgi almak',
  ].join('\n');
};

const formatAvailabilityMessage = (date: string, slots: SavedAvailableSlot[]) => [
  `${formatTurkishDateLong(date, WHATSAPP_ASSISTANT_TIME_ZONE)} icin takvimi kontrol ettim. Uygun saatler:`,
  ...slots.map((slot, index) => `${index + 1}. ${slot.localStartTime}${slot.practitionerName ? ` (${slot.practitionerName})` : ''}`),
  '',
  'Size uygun olan saati numarasiyla veya saat olarak yazabilirsiniz.',
].join('\n');

const normalizePractitionerName = (value: string) => normalizeSearchText(value)
  .replace(/\bdt\b/g, ' ')
  .replace(/\bdis\b/g, ' ')
  .replace(/\bdr\b/g, ' ')
  .replace(/\bsaat\b/g, ' ')
  .replace(/\bnumara\b/g, ' ')
  .replace(/\brandevu\b/g, ' ')
  .replace(/\bmusait\b/g, ' ')
  .replace(/\bvar\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const findSlotMatches = (text: string, slots: SavedAvailableSlot[]) => {
  const extractedTime = interpretTimeRequest(text).exactTime;
  const normalizedQuery = normalizePractitionerName(text);
  const queryTokens = normalizedQuery.split(' ').filter(token => token.length >= 3 && !/^\d+$/.test(token));
  const matches = slots.map((slot, index) => {
    const normalizedPractitioner = normalizePractitionerName(slot.practitionerName);
    const practitionerTokens = normalizedPractitioner.split(' ').filter(token => token.length >= 3);
    const timeMatches = extractedTime ? slot.localStartTime === extractedTime : true;
    const practitionerMatches = queryTokens.length === 0
      ? true
      : queryTokens.every(token => normalizedPractitioner.includes(token) || practitionerTokens.some(nameToken => nameToken.includes(token)));
    return { slot, index, timeMatches, practitionerMatches };
  }).filter(item => item.timeMatches && item.practitionerMatches);
  return { extractedTime, hasPractitionerFragment: queryTokens.length > 0, matches };
};

const findServiceMatches = (text: string, services: InstagramAssistantService[]) => {
  const normalizedQuery = normalizeSearchText(text);
  if (!normalizedQuery || /^\d+$/.test(normalizedQuery)) return [];
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  return services.filter(service => {
    const normalizedServiceName = normalizeSearchText(service.name);
    return normalizedServiceName.includes(normalizedQuery)
      || normalizedQuery.includes(normalizedServiceName)
      || queryTokens.every(token => normalizedServiceName.includes(token));
  });
};

const formatAppointmentLookup = (appointments: Array<{
  date: string;
  startTime: string;
  serviceName: string | null;
  practitionerName: string | null;
  status: string;
}>) => {
  if (appointments.length === 0) {
    return 'Bu Instagram gorusmesi icin aktif randevu veya bekleyen randevu talebi bulamadim.';
  }
  return [
    'Sistemde gorunen randevu/talep bilgileri:',
    ...appointments.map((item, index) =>
      `${index + 1}. ${item.date} ${item.startTime} - ${item.serviceName ?? 'Hizmet bilgisi yok'}${item.practitionerName ? ` (${item.practitionerName})` : ''} - ${item.status}`),
  ].join('\n');
};

const loadAppointmentLookup = async (
  clinic: InstagramAssistantClinic,
  entry: InstagramInboxContext | null,
  externalSenderId: string,
) => {
  const timeZone = clinic.timezone || WHATSAPP_ASSISTANT_TIME_ZONE;
  const [appointments, pendingRequests] = await Promise.all([
    entry?.patientId
      ? prisma.appointment.findMany({
          where: {
            clinicId: clinic.id,
            patientId: entry.patientId,
            deletedAt: null,
            status: { notIn: ['cancelled', 'no_show'] },
          },
          select: {
            startTime: true,
            status: true,
            appointmentType: { select: { name: true } },
            practitioner: { select: { firstName: true, lastName: true } },
          },
          orderBy: { startTime: 'asc' },
          take: 5,
        })
      : Promise.resolve([]),
    prisma.appointmentRequest.findMany({
      where: {
        clinicId: clinic.id,
        requestType: 'appointment',
        status: { in: ['pending', 'approved'] },
        OR: [
          ...(entry?.patientId ? [{ patientId: entry.patientId }] : []),
          {
            source: 'instagram',
            externalSenderId: externalSenderId.trim(),
          },
        ],
      },
      select: {
        preferredStartTime: true,
        status: true,
        appointmentType: { select: { name: true } },
        practitioner: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);

  return [
    ...appointments.map(appointment => {
      const formatted = formatClinicDateTime(appointment.startTime, timeZone);
      return {
        date: formatted.date,
        startTime: formatted.time,
        serviceName: appointment.appointmentType?.name ?? null,
        practitionerName: appointment.practitioner ? `${appointment.practitioner.firstName} ${appointment.practitioner.lastName}` : null,
        status: appointment.status,
      };
    }),
    ...pendingRequests.map(request => {
      const formatted = request.preferredStartTime ? formatClinicDateTime(request.preferredStartTime, timeZone) : null;
      return {
        date: formatted?.date ?? 'Tarih netlesmedi',
        startTime: formatted?.time ?? 'Saat netlesmedi',
        serviceName: request.appointmentType?.name ?? null,
        practitionerName: request.practitioner ? `${request.practitioner.firstName} ${request.practitioner.lastName}` : null,
        status: request.status,
      };
    }),
  ];
};

const getClinicSystemUserId = async (clinicId: string) => {
  const user = await prisma.user.findFirst({
    where: { clinicId, isActive: true },
    select: { id: true },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });
  return user?.id ?? null;
};

const getPhoneVariants = (value?: string | null) => {
  const digits = value ? normalizePhoneDigits(value) : '';
  const variants = new Set<string>();
  if (!digits) return variants;
  variants.add(digits);
  if (digits.startsWith('90') && digits.length === 12) {
    variants.add(digits.slice(2));
    variants.add(`0${digits.slice(2)}`);
  } else if (digits.startsWith('0') && digits.length === 11) {
    variants.add(digits.slice(1));
    variants.add(`90${digits.slice(1)}`);
  } else if (digits.length === 10) {
    variants.add(`0${digits}`);
    variants.add(`90${digits}`);
  }
  return variants;
};

const phonesMatch = (left?: string | null, right?: string | null) => {
  const leftVariants = getPhoneVariants(left);
  const rightVariants = getPhoneVariants(right);
  return [...leftVariants].some(variant => rightVariants.has(variant));
};

const findExistingPatientByPhone = async (clinicId: string, phone: string) => {
  const exactMatches = await prisma.patient.findMany({
    where: { clinicId, phone, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) return null; // multiple patients share this phone — avoid wrong assignment

  const candidates = await prisma.patient.findMany({
    where: { clinicId, phone: { not: null }, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
  const matches = candidates.filter(candidate => phonesMatch(candidate.phone, phone));
  return matches.length === 1 ? matches[0] : null;
};

const logInstagramReplyFailure = async (args: {
  organizationId: string;
  clinic: InstagramAssistantClinic;
  entry: InstagramInboxContext | null;
  instagramConnectionId: string;
  externalSenderId: string;
  externalMessageId?: string | null;
  errorMessage: string;
}) => {
  const metadata = {
    instagramConnectionId: args.instagramConnectionId,
    externalSenderId: args.externalSenderId,
    externalMessageId: args.externalMessageId ?? null,
    inboxEntryId: args.entry?.id ?? null,
    error: args.errorMessage.slice(0, 500),
  };

  console.error('[instagram-assistant] reply send failed', {
    organizationId: args.organizationId,
    clinicId: args.clinic.id,
    ...metadata,
  });

  await recordOperationalEvent({
    organizationId: args.organizationId,
    clinicId: args.clinic.id,
    severity: 'error',
    source: 'instagram',
    message: 'Instagram DM assistant reply failed',
    metadata,
  });

  if (!args.entry) return;

  try {
    const systemUserId = await getClinicSystemUserId(args.clinic.id);
    if (!systemUserId) return;

    await logActivity({
      clinicId: args.clinic.id,
      userId: systemUserId,
      entityType: 'instagram_inbox_entry',
      entityId: args.entry.id,
      action: 'reply_failed',
      description: 'Instagram DM assistant reply could not be sent. The inbound event is left failed for staff follow-up.',
      patientId: args.entry.patientId ?? undefined,
      metadata,
    });
  } catch (error) {
    console.error('[instagram-assistant] reply failure activity log failed', {
      clinicId: args.clinic.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const createInstagramStaffRequest = async (args: {
  clinic: InstagramAssistantClinic;
  entry: InstagramInboxContext | null;
  instagramConnectionId?: string | null;
  externalSenderId: string;
  externalConversationId?: string | null;
  patientId?: string | null;
  patientName: string;
  patientPhone?: string | null;
  requestType: 'appointment' | 'info' | 'cancel' | 'reschedule';
  rawMessage: string;
  notes: string;
  appointmentTypeId?: string | null;
  practitionerId?: string | null;
  preferredStartTime?: Date | null;
  preferredEndTime?: Date | null;
}) => {
  const request = await prisma.appointmentRequest.create({
    data: {
      clinicId: args.clinic.id,
      patientId: args.patientId ?? args.entry?.patientId ?? null,
      patientName: args.patientName,
      phone: normalizeInstagramPatientPhone(args.patientPhone) ?? INSTAGRAM_UNKNOWN_PHONE,
      appointmentTypeId: args.appointmentTypeId ?? null,
      practitionerId: args.practitionerId ?? null,
      preferredStartTime: args.preferredStartTime ?? null,
      preferredEndTime: args.preferredEndTime ?? null,
      requestType: args.requestType,
      ...buildInstagramAppointmentRequestSourceMetadata({
        instagramConnectionId: args.instagramConnectionId,
        externalSenderId: args.externalSenderId,
        externalConversationId: args.externalConversationId,
        inboxEntryId: args.entry?.id ?? null,
      }),
      status: 'pending',
      rawMessage: args.rawMessage,
      notes: args.notes,
    },
    include: {
      appointmentType: { select: { name: true } },
      practitioner: { select: { firstName: true, lastName: true } },
    },
  });

  console.info('[appointment-request] created', {
    channel: 'instagram',
    clinicId: summarizeIdentifier(args.clinic.id),
    inboxEntryId: summarizeIdentifier(args.entry?.id),
    conversationId: summarizeIdentifier(args.externalConversationId),
    patientId: summarizeIdentifier(args.entry?.patientId),
    serviceId: summarizeIdentifier(args.appointmentTypeId),
    serviceName: request.appointmentType?.name ?? null,
    practitionerId: summarizeIdentifier(args.practitionerId),
    practitionerName: request.practitioner
      ? `${request.practitioner.firstName} ${request.practitioner.lastName}`
      : null,
    requestedDateTime: args.preferredStartTime?.toISOString() ?? null,
    requestId: summarizeIdentifier(request.id),
  });

  const systemUserId = await getClinicSystemUserId(args.clinic.id);
  if (systemUserId) {
    await logActivity({
      clinicId: args.clinic.id,
      userId: systemUserId,
      entityType: 'appointment_request',
      entityId: request.id,
      action: 'created',
      description: 'Instagram DM assistant created appointment request for staff approval',
      patientId: args.entry?.patientId ?? undefined,
      metadata: {
        systemGenerated: true,
        source: 'instagram',
        externalSenderId: args.externalSenderId,
        instagramConnectionId: args.instagramConnectionId ?? null,
        inboxEntryId: args.entry?.id ?? null,
        conversationId: args.externalConversationId ?? null,
      },
    });
  }

  return request;
};

const createInstagramAppointmentRequest = async (args: {
  clinic: InstagramAssistantClinic;
  entry: InstagramInboxContext | null;
  instagramConnectionId?: string | null;
  externalSenderId: string;
  externalConversationId?: string | null;
  customerName: string;
  patientPhone: string;
  patientId?: string | null;
  appointmentTypeId: string;
  selectedSlot: SavedAvailableSlot;
  rawMessage?: string | null;
}) => {
  const startTime = new Date(args.selectedSlot.startTime);
  const endTime = new Date(args.selectedSlot.endTime);

  // Availability check is against stable schedule data and can run outside tx.
  const availability = await checkPractitionerAvailability(args.clinic.id, args.selectedSlot.practitionerId, startTime, endTime);
  if (!availability.ok) throw new SlotConflictError('APPOINTMENT_OUTSIDE_AVAILABILITY');

  // 1. Advisory lock  →  2. overlap re-check  →  3. create — all inside one tx.
  // Under PostgreSQL READ COMMITTED, $transaction alone is insufficient.
  const request = await prisma.$transaction(async (tx) => {
    await acquireAppointmentSlotLock(tx, {
      clinicId: args.clinic.id,
      practitionerId: args.selectedSlot.practitionerId,
      startTime,
    });

    await assertSlotAvailable(tx, {
      clinicId: args.clinic.id,
      practitionerId: args.selectedSlot.practitionerId,
      startTime,
      endTime,
    });

    return tx.appointmentRequest.create({
      data: {
        clinicId: args.clinic.id,
        patientId: args.patientId ?? args.entry?.patientId ?? null,
        patientName: args.customerName,
        phone: normalizeInstagramPatientPhone(args.patientPhone) ?? INSTAGRAM_UNKNOWN_PHONE,
        appointmentTypeId: args.appointmentTypeId,
        practitionerId: args.selectedSlot.practitionerId,
        preferredStartTime: startTime,
        preferredEndTime: endTime,
        requestType: 'appointment',
        ...buildInstagramAppointmentRequestSourceMetadata({
          instagramConnectionId: args.instagramConnectionId,
          externalSenderId: args.externalSenderId,
          externalConversationId: args.externalConversationId,
          inboxEntryId: args.entry?.id ?? null,
        }),
        status: 'pending',
        rawMessage: args.rawMessage ?? '',
        notes: 'Instagram DM asistani uzerinden personel onayina gonderildi.',
      },
      include: {
        appointmentType: { select: { name: true } },
        practitioner: { select: { firstName: true, lastName: true } },
      },
    });
  });

  // Logging runs after the transaction commits.
  console.info('[appointment-request] created', {
    channel: 'instagram',
    clinicId: summarizeIdentifier(args.clinic.id),
    inboxEntryId: summarizeIdentifier(args.entry?.id),
    conversationId: summarizeIdentifier(args.externalConversationId),
    patientId: summarizeIdentifier(args.entry?.patientId),
    serviceId: summarizeIdentifier(args.appointmentTypeId),
    serviceName: request.appointmentType?.name ?? null,
    practitionerId: summarizeIdentifier(args.selectedSlot.practitionerId),
    practitionerName: request.practitioner
      ? `${request.practitioner.firstName} ${request.practitioner.lastName}`
      : null,
    requestedDateTime: startTime.toISOString(),
    requestId: summarizeIdentifier(request.id),
  });

  const systemUserId = await getClinicSystemUserId(args.clinic.id);
  if (systemUserId) {
    await logActivity({
      clinicId: args.clinic.id,
      userId: systemUserId,
      entityType: 'appointment_request',
      entityId: request.id,
      action: 'created',
      description: 'Instagram DM assistant created appointment request for staff approval',
      patientId: args.entry?.patientId ?? undefined,
      metadata: {
        systemGenerated: true,
        source: 'instagram',
        externalSenderId: args.externalSenderId,
        instagramConnectionId: args.instagramConnectionId ?? null,
        inboxEntryId: args.entry?.id ?? null,
        conversationId: args.externalConversationId ?? null,
      },
    });
  }

  if (args.entry) {
    await prisma.instagramInboxEntry.update({
      where: { id: args.entry.id },
      data: { status: 'converted', resolvedAt: new Date() },
    });
  }

  return request;
};

const ensureInstagramPatientProfile = async (args: {
  clinic: InstagramAssistantClinic;
  entry: InstagramInboxContext | null;
  instagramConnectionId: string;
  externalSenderId: string;
  fullName: string;
  phoneInput: string;
}) => {
  const normalizedPhone = normalizeInstagramPatientPhone(args.phoneInput);
  if (!normalizedPhone) return null;

  const parsedName = args.fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = parsedName[0] ?? 'Instagram';
  const lastName = parsedName.slice(1).join(' ') || 'Kullanicisi';

  const existingByPhone = await findExistingPatientByPhone(args.clinic.id, normalizedPhone);
  if (existingByPhone) {
    await prisma.instagramInboxEntry.updateMany({
      where: {
        organizationId: args.clinic.organizationId,
        instagramConnectionId: args.instagramConnectionId,
        externalSenderId: args.externalSenderId,
      },
      data: { patientId: existingByPhone.id },
    });
    logInstagramIdentityResolution({
      clinicId: args.clinic.id,
      externalSenderId: args.externalSenderId,
      matchCount: 1,
      selectedPatientIdPresent: true,
      needsNameCollection: false,
      needsPhoneCollection: false,
      action: 'existing_patient_linked_by_phone',
    });
    return {
      id: existingByPhone.id,
      fullName: `${existingByPhone.firstName} ${existingByPhone.lastName}`.trim(),
      phone: normalizeInstagramPatientPhone(existingByPhone.phone) ?? normalizedPhone,
    };
  }

  const createdPatient = await prisma.patient.create({
    data: {
      clinicId: args.clinic.id,
      organizationId: args.clinic.organizationId,
      firstName,
      lastName,
      phone: normalizedPhone,
      source: 'instagram',
      patientStatus: 'new',
      communicationConsent: false,
      notes: 'Instagram üzerinden ilk temas sonrası oluşturuldu.',
    },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });

  await prisma.instagramInboxEntry.updateMany({
    where: {
      organizationId: args.clinic.organizationId,
      instagramConnectionId: args.instagramConnectionId,
      externalSenderId: args.externalSenderId,
    },
    data: { patientId: createdPatient.id },
  });

  logInstagramIdentityResolution({
    clinicId: args.clinic.id,
    externalSenderId: args.externalSenderId,
    matchCount: 0,
    selectedPatientIdPresent: true,
    needsNameCollection: false,
    needsPhoneCollection: false,
    action: 'patient_created_at_booking',
  });

  return {
    id: createdPatient.id,
    fullName: `${createdPatient.firstName} ${createdPatient.lastName}`.trim(),
    phone: normalizeInstagramPatientPhone(createdPatient.phone) ?? normalizedPhone,
  };
};

const createHandoffRequest = async (args: {
  clinic: InstagramAssistantClinic;
  entry: InstagramInboxContext | null;
  instagramConnectionId?: string | null;
  externalSenderId: string;
  externalConversationId?: string | null;
  customerName: string | null;
  text: string;
  conversationKey: string;
}) => {
  const contactRequest = await upsertContactRequest({
    clinicId: args.clinic.id,
    channel: 'instagram',
    externalSenderId: args.externalSenderId,
    patientId: args.entry?.patientId ?? null,
    phone: hasRealPatientPhone(args.entry?.patient?.phone) ? normalizeInstagramPatientPhone(args.entry?.patient?.phone ?? '') : null,
    name: args.customerName ?? 'Instagram Kullanıcısı',
    type: 'staff_handoff',
    note: `Instagram DM uzerinden yetkili talebi alindi.\nIlk mesaj: ${args.text}`.slice(0, 2000),
    lastMessage: args.text.slice(0, 500),
    sourceConversationId: args.externalConversationId ?? args.externalSenderId,
  });

  await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
    customerName: args.customerName,
    currentIntent: 'human_handoff',
    step: 'awaiting_handoff_note',
    lastMessage: args.text,
    stateJson: { pendingHandoffRequestId: contactRequest.id },
  });

  const firstName = getFirstName(args.customerName);
  return `${firstName ? `Elbette ${firstName}.` : 'Elbette.'} Talebinizi yetkili ekibe iletiyorum. Klinik ekibinden biri size en kisa surede donus yapacak. Konu hakkinda kisa bir not birakmak ister misiniz?`;
};

const handleHandoffNote = async (args: {
  clinic: InstagramAssistantClinic;
  conversationKey: string;
  stateJson: InstagramAssistantStateJson;
  customerName: string | null;
  text: string;
}) => {
  const note = args.text.trim();
  if (args.stateJson.pendingHandoffRequestId) {
    await prisma.contactRequest.updateMany({
      where: { id: args.stateJson.pendingHandoffRequestId, clinicId: args.clinic.id },
      data: {
        note: `Instagram DM uzerinden yetkili talebi alindi.\nKullanici notu: ${note}`.slice(0, 2000),
        lastMessage: note.slice(0, 500),
      },
    });
  }
  await resetInstagramConversationState(args.clinic.id, args.conversationKey, args.customerName);
  return 'Notunuzu ekledim. Yetkili ekip en kisa surede size donus yapacak.';
};

const answerClinicInfo = (clinic: InstagramAssistantClinic, text: string, currentStep: InstagramAssistantStep) => {
  const normalized = normalizeSearchText(text);
  const continuation = currentStep && currentStep !== 'main_menu'
    ? ' Randevu akisina devam etmek isterseniz kaldigimiz yerden ilerleyebiliriz.'
    : '';
  if (normalized.includes('adres') || normalized.includes('neredesiniz') || normalized.includes('konum')) {
    return clinic.address?.trim()
      ? `Klinik adresi: ${clinic.address.trim()}${continuation}`
      : `Adres bilgisini sistemde net olarak goremiyorum. Isterseniz talebinizi yetkili ekibe iletebilirim.${continuation}`;
  }
  if (normalized.includes('telefon')) {
    return clinic.phone?.trim()
      ? `Klinik telefon numarasi: ${clinic.phone.trim()}${continuation}`
      : `Telefon bilgisini sistemde net olarak goremiyorum. Isterseniz talebinizi yetkili ekibe iletebilirim.${continuation}`;
  }
  if (normalized.includes('mail') || normalized.includes('email')) {
    return clinic.email?.trim()
      ? `Klinik e-posta adresi: ${clinic.email.trim()}${continuation}`
      : `E-posta bilgisini sistemde net olarak goremiyorum. Isterseniz talebinizi yetkili ekibe iletebilirim.${continuation}`;
  }
  if (normalized.includes('web')) {
    return clinic.website?.trim()
      ? `Klinik web sitesi: ${clinic.website.trim()}${continuation}`
      : `Web sitesi bilgisini sistemde net olarak goremiyorum. Isterseniz talebinizi yetkili ekibe iletebilirim.${continuation}`;
  }
  return `Bu bilgiyi sistemde net olarak goremiyorum. Isterseniz talebinizi yetkili ekibe iletebilirim.${continuation}`;
};

const answerSmallTalk = (clinic: InstagramAssistantClinic, text: string, currentStep: InstagramAssistantStep) => {
  const normalized = normalizeSearchText(text);
  const continuation = currentStep && currentStep !== 'main_menu'
    ? ' Randevu akisina devam etmek isterseniz kaldigimiz yerden ilerleyebiliriz.'
    : '';
  if (!continuation && isPoliteClosingMessage(text)) {
    return 'Rica ederim, sağlıklı günler dilerim.';
  }
  if (normalized.includes('saat kac') || normalized.includes('su an saat')) {
    const time = new Intl.DateTimeFormat('tr-TR', {
      timeZone: clinic.timezone || WHATSAPP_ASSISTANT_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());
    return `Klinik saatine gore su an saat ${time}.${continuation}`;
  }
  return `Ben randevu, klinik bilgisi ve yetkili ekibe yonlendirme konularinda yardimci olabilirim.${continuation}`;
};

const loadClinicFacts = async (clinic: InstagramAssistantClinic) => {
  const [doctorCount, workingHoursCount] = await Promise.all([
    prisma.user.count({
      where: {
        clinicId: clinic.id,
        isActive: true,
        role: { in: ['doctor', 'DENTIST', 'dentist'] },
      },
    }),
    prisma.clinicWorkingHours.count({ where: { clinicId: clinic.id } }),
  ]);

  return {
    clinicName: clinic.name,
    timezone: clinic.timezone || WHATSAPP_ASSISTANT_TIME_ZONE,
    hasAddress: Boolean(clinic.address?.trim()),
    hasPhone: Boolean(clinic.phone?.trim()),
    hasEmail: Boolean(clinic.email?.trim()),
    hasWebsite: Boolean(clinic.website?.trim()),
    doctorCountKnown: doctorCount > 0,
    doctorCount: doctorCount > 0 ? doctorCount : null,
    workingHoursKnown: workingHoursCount > 0,
    workingHoursDetail: workingHoursCount > 0 ? 'closed_days_only' as const : 'none' as const,
  };
};

const applyAgentStatePatch = async (args: {
  clinicId: string;
  conversationKey: string;
  customerName: string | null;
  inputText: string;
  patch: WhatsAppAgentDecision['statePatch'];
}) => {
  const patchData: Parameters<typeof upsertInstagramConversationState>[2] = {
    customerName: args.customerName,
    lastMessage: args.inputText,
  };
  if ('currentIntent' in args.patch) patchData.currentIntent = args.patch.currentIntent ?? null;
  if ('step' in args.patch) patchData.step = args.patch.step ?? null;
  if ('selectedAppointmentTypeId' in args.patch) patchData.selectedAppointmentTypeId = args.patch.selectedAppointmentTypeId ?? null;
  if ('selectedAppointmentTypeName' in args.patch) patchData.selectedAppointmentTypeName = args.patch.selectedAppointmentTypeName ?? null;
  if ('selectedDate' in args.patch) patchData.selectedDate = args.patch.selectedDate ?? null;
  if ('selectedTime' in args.patch) patchData.selectedTime = args.patch.selectedTime ?? null;

  await upsertInstagramConversationState(args.clinicId, args.conversationKey, patchData);
};

// ── Channel consent gate: flow-resume helpers ──────────────────────────────────

// Steps that represent an in-progress booking/selection flow. If channel consent is
// required while the conversation is on one of these steps, we must not discard the
// flow — we stash it in resumeAfterChannelConsent and restore it once consent is settled.
export const CONSENT_RESUMABLE_STEPS: InstagramAssistantStep[] = [
  'awaiting_service',
  'awaiting_date',
  'awaiting_time',
  'awaiting_confirmation',
  'awaiting_name',
  'awaiting_phone',
];

export const isConsentResumableStep = (step: string | null | undefined): step is InstagramAssistantStep =>
  Boolean(step) && CONSENT_RESUMABLE_STEPS.includes(step as InstagramAssistantStep);

// Builds the message shown right after consent is accepted mid-flow. Never replays the
// message that triggered the consent prompt (it was never processed) — instead it re-asks
// for whatever the interrupted step was waiting on, using already-confirmed prior context.
export const buildConsentResumeMessage = (
  step: InstagramAssistantStep,
  ctx: {
    services: InstagramAssistantService[];
    selectedAppointmentTypeName?: string | null;
    selectedDate?: string | null;
    stateJson: InstagramAssistantStateJson;
  },
): string => {
  const prefix = 'Teşekkürler, onayınızı aldık.';
  switch (step) {
    case 'awaiting_service':
      return ctx.services.length > 0
        ? `${prefix} ${formatServiceList(ctx.services)}`
        : `${prefix} ${NO_ACTIVE_SERVICES_TEXT}`;
    case 'awaiting_date':
      return ctx.selectedAppointmentTypeName
        ? `${prefix} ${ctx.selectedAppointmentTypeName} için hangi gün randevu istersiniz?`
        : `${prefix} Lütfen randevu istediğiniz günü tekrar yazar mısınız?`;
    case 'awaiting_time': {
      const slots = ctx.stateJson.lastShownSlots ?? ctx.stateJson.availableSlots ?? [];
      if (ctx.selectedDate && slots.length > 0) {
        return `${prefix} ${formatAvailabilityMessage(ctx.selectedDate, slots)}`;
      }
      return `${prefix} Lütfen randevu istediğiniz saati tekrar yazar mısınız?`;
    }
    case 'awaiting_confirmation':
      return `${prefix} Randevunuzu onaylıyor musunuz? Lütfen evet veya hayır yazın.`;
    case 'awaiting_name':
      return `${prefix} Randevu için ad soyadınızı öğrenebilir miyim?`;
    case 'awaiting_phone':
      return `${prefix} Sizinle iletişime geçebilmemiz için telefon numaranızı paylaşır mısınız?`;
    default:
      return CONSENT_ACCEPTED_TEXT;
  }
};

const buildReplyText = async (args: {
  clinic: InstagramAssistantClinic;
  entry: InstagramInboxContext | null;
  instagramConnectionId: string;
  externalSenderId: string;
  externalConversationId?: string | null;
  senderUsername?: string | null;
  conversationKey: string;
  text: string;
  externalMessageId?: string | null;
}) => {
  const state = await prisma.whatsAppConversationState.findUnique({
    where: { clinicId_phone: { clinicId: args.clinic.id, phone: args.conversationKey } },
  });
  const stateJson = readStateJson(state?.stateJson);
  const services = await getAssistantServices(args.clinic.id);
  const customerName = formatInstagramCustomerName(args.entry, args.externalSenderId, args.senderUsername)
    ?? (state?.customerName && !isNumericPlatformId(state.customerName) ? state.customerName : null);
  const currentStep = (state?.step ?? null) as InstagramAssistantStep;
  const selectedDate = state?.selectedDate ?? null;
  const selectedTime = state?.selectedTime ?? null;
  const parsedTime = interpretTimeRequest(args.text);
  const normalizedDateCandidate = await normalizeDateWithGoogleAi(
    args.text,
    new Date().toISOString().slice(0, 10),
    args.clinic.timezone || WHATSAPP_ASSISTANT_TIME_ZONE,
  );
  const extractedDateFromInput = normalizedDateCandidate ?? null;
  const extractedTimeFromInput = parsedTime.exactTime ?? null;
  const extractedThresholdMinutes = parsedTime.afterTimeMinutes;
  const extractedThresholdTime = extractedThresholdMinutes !== null ? minutesToTime(extractedThresholdMinutes) : null;
  const standaloneNumericSelection = extractStandaloneNumericSelection(args.text);

  const nextSelectedDate = selectedDate ?? extractedDateFromInput;
  const nextSelectedTime = selectedTime ?? extractedTimeFromInput ?? extractedThresholdTime;

  // ── Channel consent gate ─────────────────────────────────────────────────
  if (currentStep === 'awaiting_channel_consent') {
    const reply = parseConsentReply(args.text);
    const meta = await loadConsentMetadata(args.clinic.id);
    const resumeStep = isConsentResumableStep(stateJson.resumeAfterChannelConsent) ? stateJson.resumeAfterChannelConsent : null;
    const { resumeAfterChannelConsent: _discardResume, ...resumedStateJson } = stateJson;
    const resumeAfterAccept = async () => {
      if (resumeStep) {
        await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
          customerName,
          step: resumeStep,
          currentIntent: state?.currentIntent ?? 'book_appointment',
          lastMessage: args.text,
          lastProviderMessageId: args.externalMessageId ?? null,
          stateJson: resumedStateJson,
        });
        return buildConsentResumeMessage(resumeStep, {
          services, selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null, selectedDate, stateJson: resumedStateJson,
        });
      }
      await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
        customerName,
        step: null,
        currentIntent: null,
        lastMessage: args.text,
        lastProviderMessageId: args.externalMessageId ?? null,
        stateJson: null,
      });
      return CONSENT_ACCEPTED_TEXT;
    };
    if (reply === 'accepted' && meta) {
      await logChannelConsent({
        organizationId: args.clinic.organizationId,
        clinicId: args.clinic.id,
        channel: 'instagram',
        contactIdentifier: args.externalSenderId,
        status: 'accepted',
        consentTextVersion: meta.version,
        consentTextSnapshot: meta.consentSnapshot,
        privacyUrl: meta.privacyUrl,
        conversationId: args.externalConversationId ?? args.conversationKey,
        sourceMessageId: args.externalMessageId ?? null,
      });
      return resumeAfterAccept();
    }
    if (reply === 'declined' && meta) {
      await logChannelConsent({
        organizationId: args.clinic.organizationId,
        clinicId: args.clinic.id,
        channel: 'instagram',
        contactIdentifier: args.externalSenderId,
        status: 'declined',
        consentTextVersion: meta.version,
        consentTextSnapshot: meta.consentSnapshot,
        privacyUrl: meta.privacyUrl,
        conversationId: args.externalConversationId ?? args.conversationKey,
        sourceMessageId: args.externalMessageId ?? null,
      });
      await upsertInstagramConversationState(args.clinic.id, args.conversationKey, { customerName, step: null, currentIntent: null, lastMessage: args.text, lastProviderMessageId: args.externalMessageId ?? null, stateJson: null });
      return CONSENT_DECLINED_TEXT;
    }
    const consentRecheck = await checkChannelConsent({ organizationId: args.clinic.organizationId, clinicId: args.clinic.id, channel: 'instagram', contactIdentifier: args.externalSenderId });
    if (consentRecheck.status === 'accepted') {
      return resumeAfterAccept();
    }
    if (consentRecheck.status === 'blocked_missing_legal_profile') return MISSING_LEGAL_PROFILE_BLOCK_TEXT;
    return consentRecheck.promptText ?? CONSENT_REPROMPT_TEXT;
  }

  const consentGateResult = await checkChannelConsent({
    organizationId: args.clinic.organizationId,
    clinicId: args.clinic.id,
    channel: 'instagram',
    contactIdentifier: args.externalSenderId,
  });
  if (consentGateResult.status === 'blocked_missing_legal_profile') {
    console.warn('[instagram-assistant] consent-gate blocked: missing legal profile', {
      clinicId: summarizeIdentifier(args.clinic.id),
      organizationId: args.clinic.organizationId,
    });
    return MISSING_LEGAL_PROFILE_BLOCK_TEXT;
  }
  if (consentGateResult.status === 'needs_consent' || consentGateResult.status === 'declined') {
    const isResumable = isConsentResumableStep(currentStep);
    await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
      customerName,
      step: 'awaiting_channel_consent',
      currentIntent: isResumable ? (state?.currentIntent ?? null) : null,
      lastMessage: args.text,
      lastProviderMessageId: args.externalMessageId ?? null,
      stateJson: {
        ...stateJson,
        resumeAfterChannelConsent: isResumable ? currentStep : null,
      },
    });
    return consentGateResult.promptText;
  }
  // ── End consent gate ────────────────────────────────────────────────────

  if (isMainMenuCommand(args.text)) {
    await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
      customerName,
      currentIntent: null,
      step: 'main_menu',
      lastMessage: args.text,
      lastProviderMessageId: args.externalMessageId ?? null,
      stateJson: null,
    });
    return formatMainMenu(args.clinic.name, customerName);
  }

  if ((!currentStep || currentStep === 'main_menu') && isGreeting(args.text)) {
    await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
      customerName,
      currentIntent: null,
      step: 'main_menu',
      lastMessage: args.text,
      lastProviderMessageId: args.externalMessageId ?? null,
      stateJson: null,
    });
    return formatMainMenu(args.clinic.name, customerName);
  }

  if (currentStep === 'awaiting_handoff_note') {
    if (isNegativeHandoffNote(args.text)) {
      await resetInstagramConversationState(args.clinic.id, args.conversationKey, customerName);
      return 'Tamam, ek not olmadan talebinizi yetkili ekibe ilettim.';
    }
    return handleHandoffNote({
      clinic: args.clinic,
      conversationKey: args.conversationKey,
      stateJson,
      customerName,
      text: args.text,
    });
  }

  if (currentStep === 'main_menu' && standaloneNumericSelection !== null) {
    if (standaloneNumericSelection === 1) {
      if (services.length === 0) {
        await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
          customerName,
          currentIntent: null,
          step: null,
          lastMessage: args.text,
          lastProviderMessageId: args.externalMessageId ?? null,
          stateJson: null,
        });
        return NO_ACTIVE_SERVICES_TEXT;
      }
      await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
        customerName,
        currentIntent: 'book_appointment',
        step: 'awaiting_service',
        lastMessage: args.text,
        lastProviderMessageId: args.externalMessageId ?? null,
        stateJson: null,
      });
      return formatServiceList(services);
    }
    if (standaloneNumericSelection === 2) {
      return formatAppointmentLookup(await loadAppointmentLookup(args.clinic, args.entry, args.externalSenderId));
    }
    if (standaloneNumericSelection === 3) {
      return createHandoffRequest({
        clinic: args.clinic,
        entry: args.entry,
        instagramConnectionId: args.instagramConnectionId,
        externalSenderId: args.externalSenderId,
        externalConversationId: args.externalConversationId,
        customerName,
        text: args.text,
        conversationKey: args.conversationKey,
      });
    }
    if (standaloneNumericSelection === 4) return services.length > 0 ? formatServiceList(services) : NO_ACTIVE_SERVICES_TEXT;
  }

  if (currentStep === 'awaiting_service') {
    if (services.length === 0) {
      await resetInstagramConversationState(args.clinic.id, args.conversationKey, customerName);
      return NO_ACTIVE_SERVICES_TEXT;
    }

    // Deterministic parser (numeric selection / substring match) runs first. Only
    // when neither can resolve the message do we escalate to the step-aware
    // semantic layer, keeping high-confidence structured input AI-free.
    const serviceWillResolveDeterministically =
      extractNumericSelection(args.text) !== null || findServiceMatches(args.text, services).length > 0;

    if (!serviceWillResolveDeterministically) {
      const { decision: nluDecision, source: nluSource } = await resolveStepAwareWhatsAppIntent({
        clinicId: args.clinic.id,
        phone: args.externalSenderId,
        currentStep: 'awaiting_service',
        currentIntent: state?.currentIntent ?? null,
        lastMessage: state?.lastMessage ?? null,
        userText: args.text,
        availableServices: services,
        selectedService: state?.selectedAppointmentTypeName ?? null,
        selectedDate: nextSelectedDate,
        selectedTime: nextSelectedTime,
      });

      logInstagramAgentDecision({
        clinicId: args.clinic.id,
        externalSenderId: args.externalSenderId,
        currentStep,
        deterministicMatched: false,
        nluUsed: nluSource !== 'unavailable',
        detectedIntent: nluDecision.intent,
        confidence: nluDecision.confidence,
        responseType: 'awaiting_service_nlu',
      });

      if (nluDecision.intent === 'select_service_by_name_or_description' && nluDecision.confidence >= 0.5) {
        const matchedService = services.find(s => s.id === nluDecision.extractedServiceId);
        if (matchedService) {
          await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
            customerName,
            currentIntent: 'book_appointment',
            step: 'awaiting_date',
            selectedAppointmentTypeId: matchedService.id,
            selectedAppointmentTypeName: matchedService.name,
            selectedDate: nextSelectedDate ?? null,
            selectedTime: nextSelectedTime ?? null,
            lastMessage: args.text,
            lastProviderMessageId: args.externalMessageId ?? null,
            stateJson: null,
          });
          return `${matchedService.name} hizmetini seçtiniz. Hangi gün için randevu istersiniz? Örneğin bugün, yarın, 16.05 veya 16 Mayıs yazabilirsiniz.`;
        }
      }

      if (nluDecision.intent === 'repeat_service_list' && nluDecision.confidence >= 0.5) {
        return formatServiceList(services);
      }

      if (nluDecision.intent === 'ask_service_price_or_duration' && nluDecision.confidence >= 0.5) {
        return [
          'Fiyat bilgisini bu kanaldan net olarak paylaşamıyorum, ancak hizmet süreleri şöyle:',
          ...services.map((s, i) => `${i + 1}. ${s.name} (${s.durationMinutes} dk)`),
          '',
          'Randevu oluşturmak için lütfen hizmet numarasını yazın.',
        ].join('\n');
      }
      // cannot_choose_service / unknown / low confidence: fall through to the
      // deterministic handler, whose fallback already resends the service list.
    }

    const serviceReply = await handleAwaitingServiceStep({
      text: args.text,
      phone: args.conversationKey,
      customerName,
      services,
      state: {
        selectedAppointmentTypeId: state?.selectedAppointmentTypeId,
        selectedAppointmentTypeName: state?.selectedAppointmentTypeName,
        selectedDate: nextSelectedDate,
        selectedTime: nextSelectedTime,
      },
      stateJson: { matchedServices: stateJson.matchedServices },
      extractNumericSelection,
      findServiceMatches,
      formatServiceList,
      upsertState: data => upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
        ...data,
        lastProviderMessageId: args.externalMessageId ?? null,
      }),
    });

    const stateAfterService = await prisma.whatsAppConversationState.findUnique({
      where: { clinicId_phone: { clinicId: args.clinic.id, phone: args.conversationKey } },
      select: {
        step: true,
        selectedAppointmentTypeId: true,
        selectedAppointmentTypeName: true,
        selectedPractitionerId: true,
        selectedDate: true,
      },
    });

    const shouldAutoContinueToDate = stateAfterService?.step === 'awaiting_date'
      && Boolean(stateAfterService.selectedAppointmentTypeId)
      && Boolean(nextSelectedDate);

    if (!shouldAutoContinueToDate) return serviceReply;

    return handleAwaitingDateStep({
      prisma,
      clinicId: args.clinic.id,
      text: nextSelectedDate!,
      customerName,
      state: {
        selectedAppointmentTypeId: stateAfterService?.selectedAppointmentTypeId,
        selectedAppointmentTypeName: stateAfterService?.selectedAppointmentTypeName,
        selectedPractitionerId: stateAfterService?.selectedPractitionerId,
      },
      buildAvailableSlots,
      formatAvailabilityMessage,
      logAvailabilitySave: (totalSlots, shownSlots) => {
        console.log('[instagram-assistant] availability-save', { totalSlots, shownSlots });
      },
      minutesToTime,
      interpretDateWithAi: () => Promise.resolve(nextSelectedDate!),
      interpretTimeWithAi: async () => ({
        exactTime: nextSelectedTime,
        afterTime: nextSelectedTime,
        timePreference: parsedTime.preference,
      }),
      upsertState: data => upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
        ...data,
        selectedDate: data.selectedDate ?? nextSelectedDate,
        selectedTime: data.selectedTime ?? nextSelectedTime,
        lastProviderMessageId: args.externalMessageId ?? null,
      }),
    });
  }

  if (currentStep === 'awaiting_date') {
    if (!extractedDateFromInput) {
      const { decision: nluDecision, source: nluSource } = await resolveStepAwareWhatsAppIntent({
        clinicId: args.clinic.id,
        phone: args.externalSenderId,
        currentStep: 'awaiting_date',
        currentIntent: state?.currentIntent ?? null,
        lastMessage: state?.lastMessage ?? null,
        userText: args.text,
        availableServices: services,
        selectedService: state?.selectedAppointmentTypeName ?? null,
        selectedDate: nextSelectedDate,
        selectedTime: nextSelectedTime,
      });

      logInstagramAgentDecision({
        clinicId: args.clinic.id,
        externalSenderId: args.externalSenderId,
        currentStep,
        deterministicMatched: false,
        nluUsed: nluSource !== 'unavailable',
        detectedIntent: nluDecision.intent,
        confidence: nluDecision.confidence,
        responseType: 'awaiting_date_nlu',
      });

      if (nluDecision.intent === 'change_service' && nluDecision.confidence >= 0.5) {
        await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
          customerName,
          currentIntent: 'book_appointment',
          step: 'awaiting_service',
          selectedAppointmentTypeId: null,
          selectedAppointmentTypeName: null,
          selectedPractitionerId: null,
          selectedDate: null,
          selectedTime: null,
          lastMessage: args.text,
          lastProviderMessageId: args.externalMessageId ?? null,
          stateJson: null,
        });
        return services.length > 0 ? formatServiceList(services) : NO_ACTIVE_SERVICES_TEXT;
      }

      if (nluDecision.intent === 'repeat_service_list' && nluDecision.confidence >= 0.5) {
        return services.length > 0 ? formatServiceList(services) : NO_ACTIVE_SERVICES_TEXT;
      }

      if (nluDecision.intent === 'ask_available_dates' && nluDecision.confidence >= 0.5) {
        return `${state?.selectedAppointmentTypeName ?? 'Seçtiğiniz hizmet'} için hangi günü kontrol etmemi istersiniz? Örneğin bugün, yarın, cuma veya 16 Mayıs yazabilirsiniz.`;
      }
      // provide_date / unknown_date_request / low confidence: fall through to the
      // deterministic handler, whose own fallback is already contextual.
    }

    return handleAwaitingDateStep({
      prisma,
      clinicId: args.clinic.id,
      text: args.text,
      customerName,
      state: {
        selectedAppointmentTypeId: state?.selectedAppointmentTypeId,
        selectedAppointmentTypeName: state?.selectedAppointmentTypeName,
        selectedPractitionerId: state?.selectedPractitionerId,
      },
      buildAvailableSlots,
      formatAvailabilityMessage,
      logAvailabilitySave: (totalSlots, shownSlots) => {
        console.log('[instagram-assistant] availability-save', { totalSlots, shownSlots });
      },
      minutesToTime,
      interpretDateWithAi: text => normalizeDateWithGoogleAi(
        text,
        new Date().toISOString().slice(0, 10),
        args.clinic.timezone || WHATSAPP_ASSISTANT_TIME_ZONE,
      ),
      interpretTimeWithAi: async messageText => {
        const interpreted = interpretTimeRequest(messageText);
        return {
          exactTime: interpreted.exactTime,
          afterTime: interpreted.afterTimeMinutes !== null ? minutesToTime(interpreted.afterTimeMinutes) : null,
          timePreference: interpreted.preference,
        };
      },
      upsertState: data => upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
        ...data,
        selectedDate: data.selectedDate ?? nextSelectedDate,
        selectedTime: data.selectedTime ?? nextSelectedTime,
        lastProviderMessageId: args.externalMessageId ?? null,
      }),
    });
  }

  if (currentStep === 'awaiting_time') {
    const timeInterpretation = interpretTimeRequest(args.text);
    const timeWillResolveDeterministically =
      extractNumericSelection(args.text) !== null
      || timeInterpretation.exactTime !== null
      || timeInterpretation.afterTimeMinutes !== null
      || Boolean(extractedDateFromInput)
      || findSlotMatches(args.text, stateJson.availableSlots ?? []).matches.length > 0;

    if (!timeWillResolveDeterministically) {
      const { decision: nluDecision, source: nluSource } = await resolveStepAwareWhatsAppIntent({
        clinicId: args.clinic.id,
        phone: args.externalSenderId,
        currentStep: 'awaiting_time',
        currentIntent: state?.currentIntent ?? null,
        lastMessage: state?.lastMessage ?? null,
        userText: args.text,
        availableServices: services,
        selectedService: state?.selectedAppointmentTypeName ?? null,
        selectedDate: state?.selectedDate ?? null,
        selectedTime: null,
      });

      logInstagramAgentDecision({
        clinicId: args.clinic.id,
        externalSenderId: args.externalSenderId,
        currentStep,
        deterministicMatched: false,
        nluUsed: nluSource !== 'unavailable',
        detectedIntent: nluDecision.intent,
        confidence: nluDecision.confidence,
        responseType: 'awaiting_time_nlu',
      });

      if (nluDecision.intent === 'change_date' && nluDecision.confidence >= 0.5) {
        await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
          customerName,
          currentIntent: 'book_appointment',
          step: 'awaiting_date',
          selectedAppointmentTypeId: state?.selectedAppointmentTypeId,
          selectedAppointmentTypeName: state?.selectedAppointmentTypeName,
          selectedDate: null,
          selectedTime: null,
          lastMessage: args.text,
          lastProviderMessageId: args.externalMessageId ?? null,
          stateJson: null,
        });
        return 'Elbette, hangi gün için randevu istersiniz?';
      }

      if (nluDecision.intent === 'change_service' && nluDecision.confidence >= 0.5) {
        await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
          customerName,
          currentIntent: 'book_appointment',
          step: 'awaiting_service',
          selectedAppointmentTypeId: null,
          selectedAppointmentTypeName: null,
          selectedDate: null,
          selectedTime: null,
          lastMessage: args.text,
          lastProviderMessageId: args.externalMessageId ?? null,
          stateJson: null,
        });
        return services.length > 0 ? formatServiceList(services) : NO_ACTIVE_SERVICES_TEXT;
      }

      if (nluDecision.intent === 'ask_available_times' && nluDecision.confidence >= 0.5 && state?.selectedDate) {
        const lastShown = stateJson.lastShownSlots ?? stateJson.availableSlots ?? [];
        if (lastShown.length > 0) {
          return formatAvailabilityMessage(state.selectedDate, lastShown);
        }
      }
      // provide_time / unknown_time_request / low confidence: fall through to the
      // deterministic handler, whose own fallback already lists next-step options.
    }

    return handleAwaitingTimeStep({
      prisma,
      clinicId: args.clinic.id,
      phone: args.conversationKey,
      text: args.text,
      customerName,
      state: {
        selectedAppointmentTypeId: state?.selectedAppointmentTypeId,
        selectedAppointmentTypeName: state?.selectedAppointmentTypeName,
        selectedPractitionerId: state?.selectedPractitionerId,
        selectedDate: state?.selectedDate,
      },
      stateJson: {
        availableSlots: stateJson.availableSlots,
        lastShownSlots: stateJson.lastShownSlots,
      },
      extractNumericSelection,
      findSlotMatches,
      formatAvailabilityMessage,
      minutesToTime,
      logAvailabilitySave: (totalSlots, shownSlots) => {
        console.log('[instagram-assistant] availability-save', { totalSlots, shownSlots });
      },
      interpretTimeWithAi: async messageText => {
        const interpreted = interpretTimeRequest(messageText);
        return {
          exactTime: interpreted.exactTime,
          afterTime: interpreted.afterTimeMinutes !== null ? minutesToTime(interpreted.afterTimeMinutes) : null,
          timePreference: interpreted.preference,
        };
      },
      upsertState: data => upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
        ...data,
        lastProviderMessageId: args.externalMessageId ?? null,
      }),
      resetState: nextCustomerName => resetInstagramConversationState(args.clinic.id, args.conversationKey, nextCustomerName),
      createAppointment: async (_clinicId, _phone, name, appointmentTypeId, selectedSlot, rawMessage) => {
        if (!hasUsableInstagramFullName(name)) {
          await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
            customerName: null,
            currentIntent: 'book_appointment',
            step: 'awaiting_name',
            selectedAppointmentTypeId: appointmentTypeId,
            selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null,
            selectedPractitionerId: selectedSlot.practitionerId,
            selectedDate: state?.selectedDate ?? null,
            selectedTime: selectedSlot.localStartTime,
            lastMessage: args.text,
            lastProviderMessageId: args.externalMessageId ?? null,
            stateJson: {
              availableSlots: stateJson.availableSlots,
              lastShownSlots: stateJson.lastShownSlots,
              pendingConfirmationSlot: selectedSlot,
            },
          });
          throw new Error('INSTAGRAM_NAME_REQUIRED');
        }

        const patientPhone = hasRealPatientPhone(args.entry?.patient?.phone) ? normalizeInstagramPatientPhone(args.entry?.patient?.phone)! : null;
        if (!patientPhone) {
          await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
            customerName: name,
            currentIntent: 'book_appointment',
            step: 'awaiting_phone',
            selectedAppointmentTypeId: appointmentTypeId,
            selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null,
            selectedPractitionerId: selectedSlot.practitionerId,
            selectedDate: state?.selectedDate ?? null,
            selectedTime: selectedSlot.localStartTime,
            lastMessage: args.text,
            lastProviderMessageId: args.externalMessageId ?? null,
            stateJson: {
              availableSlots: stateJson.availableSlots,
              lastShownSlots: stateJson.lastShownSlots,
              pendingConfirmationSlot: selectedSlot,
            },
          });
          throw new Error('INSTAGRAM_PHONE_REQUIRED');
        }

        return createInstagramAppointmentRequest({
          clinic: args.clinic,
          entry: args.entry,
          instagramConnectionId: args.instagramConnectionId,
          externalSenderId: args.externalSenderId,
          externalConversationId: args.externalConversationId,
          customerName: name,
          patientPhone,
          patientId: args.entry?.patientId ?? null,
          appointmentTypeId,
          selectedSlot,
          rawMessage,
        });
      },
    });
  }

  if (currentStep === 'awaiting_confirmation') {
    // Explicit approve/reject is deterministic and must never be reinterpreted.
    // Anything else here (e.g. "saat 15 olsun") is a change request, not a
    // confirmation — treating it as one would silently book the wrong slot.
    if (!isDeterministicConfirmationReply(args.text)) {
      const pendingSlot = stateJson.pendingConfirmationSlot ?? null;
      const deterministicNewTime = interpretTimeRequest(args.text).exactTime;

      if (deterministicNewTime && pendingSlot) {
        const matchingSlot = (stateJson.availableSlots ?? []).find(slot => slot.localStartTime === deterministicNewTime) ?? null;
        logInstagramAgentDecision({
          clinicId: args.clinic.id,
          externalSenderId: args.externalSenderId,
          currentStep,
          deterministicMatched: true,
          nluUsed: false,
          detectedIntent: 'change_time',
          confidence: 1,
          responseType: 'awaiting_confirmation_change_time',
        });

        if (matchingSlot) {
          await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
            customerName,
            currentIntent: 'book_appointment',
            step: 'awaiting_confirmation',
            selectedAppointmentTypeId: state?.selectedAppointmentTypeId,
            selectedAppointmentTypeName: state?.selectedAppointmentTypeName,
            selectedPractitionerId: matchingSlot.practitionerId,
            selectedDate: state?.selectedDate,
            selectedTime: matchingSlot.localStartTime,
            lastMessage: args.text,
            lastProviderMessageId: args.externalMessageId ?? null,
            stateJson: {
              availableSlots: stateJson.availableSlots,
              lastShownSlots: stateJson.lastShownSlots,
              pendingConfirmationSlot: matchingSlot,
            },
          });
          return `${formatTurkishDateLong(state!.selectedDate!, WHATSAPP_ASSISTANT_TIME_ZONE)} tarihinde saat ${matchingSlot.localStartTime} için ${matchingSlot.practitionerName} uygun görünüyor. Bu saat için randevu talebinizi oluşturmamı onaylıyor musunuz?`;
        }

        await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
          customerName,
          currentIntent: 'book_appointment',
          step: 'awaiting_time',
          selectedAppointmentTypeId: state?.selectedAppointmentTypeId,
          selectedAppointmentTypeName: state?.selectedAppointmentTypeName,
          selectedPractitionerId: null,
          selectedDate: state?.selectedDate,
          selectedTime: null,
          lastMessage: args.text,
          lastProviderMessageId: args.externalMessageId ?? null,
          stateJson: {
            availableSlots: stateJson.availableSlots,
            lastShownSlots: stateJson.lastShownSlots,
          },
        });
        // Handled below by re-entering awaiting_time on the next message; give a
        // contextual nudge now rather than silently confirming the old slot.
        return 'Belirttiğiniz saat şu anda listede yok. Uygun saatlerden birini seçmek ister misiniz?';
      }

      if (pendingSlot) {
        const { decision: nluDecision, source: nluSource } = await resolveStepAwareWhatsAppIntent({
          clinicId: args.clinic.id,
          phone: args.externalSenderId,
          currentStep: 'awaiting_confirmation',
          currentIntent: state?.currentIntent ?? null,
          lastMessage: state?.lastMessage ?? null,
          userText: args.text,
          availableServices: services,
          selectedService: state?.selectedAppointmentTypeName ?? null,
          selectedDate: state?.selectedDate ?? null,
          selectedTime: pendingSlot.localStartTime,
        });

        logInstagramAgentDecision({
          clinicId: args.clinic.id,
          externalSenderId: args.externalSenderId,
          currentStep,
          deterministicMatched: false,
          nluUsed: nluSource !== 'unavailable',
          detectedIntent: nluDecision.intent,
          confidence: nluDecision.confidence,
          responseType: 'awaiting_confirmation_nlu',
        });

        if (nluDecision.intent === 'change_date' && nluDecision.confidence >= 0.5) {
          await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
            customerName,
            currentIntent: 'book_appointment',
            step: 'awaiting_date',
            selectedAppointmentTypeId: state?.selectedAppointmentTypeId,
            selectedAppointmentTypeName: state?.selectedAppointmentTypeName,
            selectedDate: null,
            selectedTime: null,
            lastMessage: args.text,
            lastProviderMessageId: args.externalMessageId ?? null,
            stateJson: null,
          });
          return `${state?.selectedAppointmentTypeName ?? 'Seçtiğiniz hizmet'} için hangi günü kontrol etmemi istersiniz?`;
        }

        if (nluDecision.intent === 'change_service' && nluDecision.confidence >= 0.5) {
          await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
            customerName,
            currentIntent: 'book_appointment',
            step: 'awaiting_service',
            selectedAppointmentTypeId: null,
            selectedAppointmentTypeName: null,
            selectedPractitionerId: null,
            selectedDate: null,
            selectedTime: null,
            lastMessage: args.text,
            lastProviderMessageId: args.externalMessageId ?? null,
            stateJson: null,
          });
          return services.length > 0 ? formatServiceList(services) : NO_ACTIVE_SERVICES_TEXT;
        }

        if (nluDecision.intent === 'ask_summary' && nluDecision.confidence >= 0.5) {
          return `Randevu özeti: ${state?.selectedAppointmentTypeName ?? 'Seçtiğiniz hizmet'}, ${formatTurkishDateLong(state!.selectedDate!, WHATSAPP_ASSISTANT_TIME_ZONE)} tarihinde saat ${pendingSlot.localStartTime} (${pendingSlot.practitionerName}). Bu randevu talebini oluşturmamı onaylıyor musunuz?`;
        }
        // reject_or_change_booking / human_handoff / unknown / low confidence:
        // fall through to the deterministic handler below, which safely re-asks
        // for an explicit evet/hayır without losing the pending slot.
      }
    }

    return handleAwaitingConfirmationStep({
      clinicId: args.clinic.id,
      phone: args.conversationKey,
      text: args.text,
      customerName,
      state: {
        selectedAppointmentTypeId: state?.selectedAppointmentTypeId,
        selectedAppointmentTypeName: state?.selectedAppointmentTypeName,
        selectedPractitionerId: state?.selectedPractitionerId,
        selectedDate: state?.selectedDate,
      },
      stateJson: {
        availableSlots: stateJson.availableSlots,
        lastShownSlots: stateJson.lastShownSlots,
        pendingConfirmationSlot: stateJson.pendingConfirmationSlot,
      },
      upsertState: data => upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
        ...data,
        lastProviderMessageId: args.externalMessageId ?? null,
      }),
      resetState: nextCustomerName => resetInstagramConversationToPostBooking(args.clinic.id, args.conversationKey, nextCustomerName ?? null, {
        serviceName: state?.selectedAppointmentTypeName ?? null,
        date: state?.selectedDate ?? null,
        time: stateJson.pendingConfirmationSlot?.localStartTime ?? null,
      }),
      createAppointment: async (_clinicId, _phone, name, appointmentTypeId, selectedSlot, rawMessage) => {
        if (!hasUsableInstagramFullName(name)) {
          await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
            customerName: null,
            currentIntent: 'book_appointment',
            step: 'awaiting_name',
            selectedAppointmentTypeId: appointmentTypeId,
            selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null,
            selectedPractitionerId: selectedSlot.practitionerId,
            selectedDate: state?.selectedDate ?? null,
            selectedTime: selectedSlot.localStartTime,
            lastMessage: args.text,
            lastProviderMessageId: args.externalMessageId ?? null,
            stateJson: {
              availableSlots: stateJson.availableSlots,
              lastShownSlots: stateJson.lastShownSlots,
              pendingConfirmationSlot: selectedSlot,
            },
          });
          throw new Error('INSTAGRAM_NAME_REQUIRED');
        }

        const patientPhone = hasRealPatientPhone(args.entry?.patient?.phone) ? normalizeInstagramPatientPhone(args.entry?.patient?.phone)! : null;
        if (!patientPhone) {
          await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
            customerName: name,
            currentIntent: 'book_appointment',
            step: 'awaiting_phone',
            selectedAppointmentTypeId: appointmentTypeId,
            selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null,
            selectedPractitionerId: selectedSlot.practitionerId,
            selectedDate: state?.selectedDate ?? null,
            selectedTime: selectedSlot.localStartTime,
            lastMessage: args.text,
            lastProviderMessageId: args.externalMessageId ?? null,
            stateJson: {
              availableSlots: stateJson.availableSlots,
              lastShownSlots: stateJson.lastShownSlots,
              pendingConfirmationSlot: selectedSlot,
            },
          });
          throw new Error('INSTAGRAM_PHONE_REQUIRED');
        }

        return createInstagramAppointmentRequest({
          clinic: args.clinic,
          entry: args.entry,
          instagramConnectionId: args.instagramConnectionId,
          externalSenderId: args.externalSenderId,
          externalConversationId: args.externalConversationId,
          customerName: name,
          patientPhone,
          patientId: args.entry?.patientId ?? null,
          appointmentTypeId,
          selectedSlot,
          rawMessage,
        });
      },
    });
  }

  if (currentStep === 'awaiting_name') {
    const pendingSlot = stateJson.pendingConfirmationSlot ?? null;
    const appointmentTypeId = state?.selectedAppointmentTypeId ?? null;
    const selectedDateForRequest = state?.selectedDate ?? null;
    const providedName = args.text.trim().replace(/\s+/g, ' ');

    if (!hasUsableInstagramFullName(providedName)) {
      const { decision: nluDecision, source: nluSource } = await resolveStepAwareWhatsAppIntent({
        clinicId: args.clinic.id,
        phone: args.externalSenderId,
        currentStep: 'awaiting_name',
        currentIntent: state?.currentIntent ?? null,
        lastMessage: state?.lastMessage ?? null,
        userText: args.text,
        availableServices: services,
        selectedService: state?.selectedAppointmentTypeName ?? null,
        selectedDate: selectedDateForRequest,
        selectedTime: null,
      });
      logInstagramAgentDecision({
        clinicId: args.clinic.id,
        externalSenderId: args.externalSenderId,
        currentStep,
        deterministicMatched: false,
        nluUsed: nluSource !== 'unavailable',
        detectedIntent: nluDecision.intent,
        confidence: nluDecision.confidence,
        responseType: 'awaiting_name_nlu',
      });
      logInstagramIdentityResolution({
        clinicId: args.clinic.id,
        externalSenderId: args.externalSenderId,
        matchCount: 0,
        selectedPatientIdPresent: Boolean(args.entry?.patientId),
        needsNameCollection: true,
        needsPhoneCollection: !hasRealPatientPhone(args.entry?.patient?.phone),
        action: 'awaiting_name_retry',
      });

      await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
        customerName: null,
        currentIntent: 'book_appointment',
        step: 'awaiting_name',
        selectedAppointmentTypeId: appointmentTypeId,
        selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null,
        selectedPractitionerId: pendingSlot?.practitionerId ?? state?.selectedPractitionerId ?? null,
        selectedDate: selectedDateForRequest,
        selectedTime: pendingSlot?.localStartTime ?? state?.selectedTime ?? null,
        lastMessage: args.text,
        lastProviderMessageId: args.externalMessageId ?? null,
        stateJson: {
          availableSlots: stateJson.availableSlots,
          lastShownSlots: stateJson.lastShownSlots,
          pendingConfirmationSlot: pendingSlot,
        },
      });

      if (nluDecision.intent === 'ask_why_name_needed') {
        return 'Randevu talebinizi doğru şekilde kaydedebilmemiz ve klinik ekibinin size ulaşabilmesi için ad soyad bilgisine ihtiyacımız var.';
      }
      return 'Randevu talebinizi tamamlayabilmem için adınızı ve soyadınızı birlikte paylaşır mısınız? Örneğin: Anatoly Echo';
    }

    if (!pendingSlot || !appointmentTypeId || !selectedDateForRequest) {
      if (services.length === 0) {
        await resetInstagramConversationState(args.clinic.id, args.conversationKey, providedName);
        return NO_ACTIVE_SERVICES_TEXT;
      }
      await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
        customerName: providedName,
        currentIntent: 'book_appointment',
        step: 'awaiting_service',
        selectedAppointmentTypeId: null,
        selectedAppointmentTypeName: null,
        selectedPractitionerId: null,
        selectedDate: null,
        selectedTime: null,
        lastMessage: args.text,
        lastProviderMessageId: args.externalMessageId ?? null,
        stateJson: null,
      });
      return formatServiceList(services);
    }

    try {
      const patientPhone = hasRealPatientPhone(args.entry?.patient?.phone) ? normalizeInstagramPatientPhone(args.entry?.patient?.phone)! : null;
      if (!patientPhone) {
        await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
          customerName: providedName,
          currentIntent: 'book_appointment',
          step: 'awaiting_phone',
          selectedAppointmentTypeId: appointmentTypeId,
          selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null,
          selectedPractitionerId: pendingSlot.practitionerId,
          selectedDate: selectedDateForRequest,
          selectedTime: pendingSlot.localStartTime,
          lastMessage: args.text,
          lastProviderMessageId: args.externalMessageId ?? null,
          stateJson: {
            availableSlots: stateJson.availableSlots,
            lastShownSlots: stateJson.lastShownSlots,
            pendingConfirmationSlot: pendingSlot,
          },
        });
        return `Teşekkürler ${providedName}. Randevu talebinizi tamamlamak için telefon numaranızı da paylaşır mısınız?`;
      }

      const request = await createInstagramAppointmentRequest({
        clinic: args.clinic,
        entry: args.entry,
        instagramConnectionId: args.instagramConnectionId,
        externalSenderId: args.externalSenderId,
        externalConversationId: args.externalConversationId,
        customerName: providedName,
        patientPhone,
        patientId: args.entry?.patientId ?? null,
        appointmentTypeId,
        selectedSlot: pendingSlot,
        rawMessage: args.text,
      });

      const serviceName = state?.selectedAppointmentTypeName ?? request.appointmentType?.name ?? 'seçtiğiniz hizmet';
      await resetInstagramConversationToPostBooking(args.clinic.id, args.conversationKey, providedName, {
        serviceName,
        date: selectedDateForRequest,
        time: pendingSlot.localStartTime,
      });
      return formatInstagramBookingCreatedReply({
        customerName: providedName,
        selectedDate: selectedDateForRequest,
        localStartTime: pendingSlot.localStartTime,
        practitionerName: pendingSlot.practitionerName,
        serviceName,
      });
    } catch (error) {
      if (error instanceof Error && (error.message === 'APPOINTMENT_OUTSIDE_AVAILABILITY' || error.message === 'APPOINTMENT_OVERLAP' || error.message === 'APPOINTMENT_REQUEST_CONFLICT')) {
        await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
          customerName: providedName,
          currentIntent: 'book_appointment',
          step: 'awaiting_date',
          selectedAppointmentTypeId: appointmentTypeId,
          selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null,
          selectedDate: null,
          selectedTime: null,
          lastMessage: args.text,
          lastProviderMessageId: args.externalMessageId ?? null,
          stateJson: null,
        });
        return 'Seçtiğiniz saat artık uygun görünmüyor. İsterseniz başka bir gün veya saat kontrol edebilirim.';
      }

      console.error('[instagram-assistant] appointment-create-error', error);
      return 'Randevu talebinizi oluştururken teknik bir sorun oluştu. Birkaç dakika sonra tekrar deneyebiliriz.';
    }
  }

  if (currentStep === 'awaiting_phone') {
    const pendingSlot = stateJson.pendingConfirmationSlot ?? null;
    const appointmentTypeId = state?.selectedAppointmentTypeId ?? null;
    const selectedDateForRequest = state?.selectedDate ?? null;
    const persistedName = customerName?.trim() || null;

    if (!persistedName || !pendingSlot || !appointmentTypeId || !selectedDateForRequest) {
      if (services.length === 0) {
        await resetInstagramConversationState(args.clinic.id, args.conversationKey, persistedName);
        return NO_ACTIVE_SERVICES_TEXT;
      }
      await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
        customerName: persistedName,
        currentIntent: 'book_appointment',
        step: 'awaiting_service',
        selectedAppointmentTypeId: null,
        selectedAppointmentTypeName: null,
        selectedPractitionerId: null,
        selectedDate: null,
        selectedTime: null,
        lastMessage: args.text,
        lastProviderMessageId: args.externalMessageId ?? null,
        stateJson: null,
      });
      return formatServiceList(services);
    }

    const resolvedPatient = await ensureInstagramPatientProfile({
      clinic: args.clinic,
      entry: args.entry,
      instagramConnectionId: args.instagramConnectionId,
      externalSenderId: args.externalSenderId,
      fullName: persistedName,
      phoneInput: args.text,
    });

    if (!resolvedPatient?.phone) {
      const { decision: nluDecision, source: nluSource } = await resolveStepAwareWhatsAppIntent({
        clinicId: args.clinic.id,
        phone: args.externalSenderId,
        currentStep: 'awaiting_phone',
        currentIntent: state?.currentIntent ?? null,
        lastMessage: state?.lastMessage ?? null,
        userText: args.text,
        availableServices: services,
        selectedService: state?.selectedAppointmentTypeName ?? null,
        selectedDate: selectedDateForRequest,
        selectedTime: null,
      });
      logInstagramAgentDecision({
        clinicId: args.clinic.id,
        externalSenderId: args.externalSenderId,
        currentStep,
        deterministicMatched: false,
        nluUsed: nluSource !== 'unavailable',
        detectedIntent: nluDecision.intent,
        confidence: nluDecision.confidence,
        responseType: 'awaiting_phone_nlu',
      });
      logInstagramIdentityResolution({
        clinicId: args.clinic.id,
        externalSenderId: args.externalSenderId,
        matchCount: 0,
        selectedPatientIdPresent: false,
        needsNameCollection: false,
        needsPhoneCollection: true,
        action: 'awaiting_phone_retry',
      });

      await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
        customerName: persistedName,
        currentIntent: 'book_appointment',
        step: 'awaiting_phone',
        selectedAppointmentTypeId: appointmentTypeId,
        selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null,
        selectedPractitionerId: pendingSlot.practitionerId,
        selectedDate: selectedDateForRequest,
        selectedTime: pendingSlot.localStartTime,
        lastMessage: args.text,
        lastProviderMessageId: args.externalMessageId ?? null,
        stateJson: {
          availableSlots: stateJson.availableSlots,
          lastShownSlots: stateJson.lastShownSlots,
          pendingConfirmationSlot: pendingSlot,
        },
      });

      if (nluDecision.intent === 'ask_why_phone_needed') {
        return 'Randevu talebinizi klinik ekibine iletebilmemiz ve size ulaşabilmemiz için telefon numaranıza ihtiyacımız var.';
      }
      return 'Telefon numarasını tam anlayamadım. Lütfen ülke koduyla birlikte yazabilir misiniz? Örneğin: +33 6 ...';
    }

    try {
      const request = await createInstagramAppointmentRequest({
        clinic: args.clinic,
        entry: args.entry,
        instagramConnectionId: args.instagramConnectionId,
        externalSenderId: args.externalSenderId,
        externalConversationId: args.externalConversationId,
        customerName: resolvedPatient.fullName,
        patientPhone: resolvedPatient.phone,
        patientId: resolvedPatient.id,
        appointmentTypeId,
        selectedSlot: pendingSlot,
        rawMessage: args.text,
      });

      const serviceName = state?.selectedAppointmentTypeName ?? request.appointmentType?.name ?? 'seçtiğiniz hizmet';
      await resetInstagramConversationToPostBooking(args.clinic.id, args.conversationKey, resolvedPatient.fullName, {
        serviceName,
        date: selectedDateForRequest,
        time: pendingSlot.localStartTime,
      });
      return formatInstagramBookingCreatedReply({
        customerName: resolvedPatient.fullName,
        selectedDate: selectedDateForRequest,
        localStartTime: pendingSlot.localStartTime,
        practitionerName: pendingSlot.practitionerName,
        serviceName,
      });
    } catch (error) {
      if (error instanceof Error && (error.message === 'APPOINTMENT_OUTSIDE_AVAILABILITY' || error.message === 'APPOINTMENT_OVERLAP' || error.message === 'APPOINTMENT_REQUEST_CONFLICT')) {
        await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
          customerName: resolvedPatient.fullName,
          currentIntent: 'book_appointment',
          step: 'awaiting_date',
          selectedAppointmentTypeId: appointmentTypeId,
          selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null,
          selectedDate: null,
          selectedTime: null,
          lastMessage: args.text,
          lastProviderMessageId: args.externalMessageId ?? null,
          stateJson: null,
        });
        return 'Seçtiğiniz saat artık uygun görünmüyor. İsterseniz başka bir gün veya saat kontrol edebilirim.';
      }

      console.error('[instagram-assistant] appointment-create-error', error);
      return 'Randevu talebinizi oluştururken teknik bir sorun oluştu. Birkaç dakika sonra tekrar deneyebiliriz.';
    }
  }

  // ── Post-booking follow-up (gratitude/closing/status/change/cancel) ────────
  if (currentStep === 'post_booking') {
    const { decision: nluDecision, source: nluSource } = await resolveStepAwareWhatsAppIntent({
      clinicId: args.clinic.id,
      phone: args.externalSenderId,
      currentStep: 'post_booking',
      currentIntent: state?.currentIntent ?? null,
      lastMessage: state?.lastMessage ?? null,
      userText: args.text,
      availableServices: services,
      selectedService: null,
      selectedDate: null,
      selectedTime: null,
    });

    logInstagramAgentDecision({
      clinicId: args.clinic.id,
      externalSenderId: args.externalSenderId,
      currentStep,
      deterministicMatched: false,
      nluUsed: nluSource !== 'unavailable',
      detectedIntent: nluDecision.intent,
      confidence: nluDecision.confidence,
      responseType: 'post_booking_nlu',
    });
    logInstagramPostBookingDecision({
      clinicId: args.clinic.id,
      externalSenderId: args.externalSenderId,
      detectedIntent: nluDecision.intent,
      responseType: 'post_booking',
    });

    const summary = stateJson.lastBookingSummary ?? null;

    if (nluDecision.intent === 'gratitude') {
      return 'Rica ederiz. Talebiniz klinik ekibine iletildi. Onay durumunu size bildireceğiz.';
    }
    if (nluDecision.intent === 'closing') {
      return 'Rica ederiz, sağlıklı günler dileriz.';
    }
    if (nluDecision.intent === 'ask_request_status') {
      return summary?.serviceName
        ? `${summary.serviceName} için ${summary.date ? formatTurkishDateLong(summary.date, WHATSAPP_ASSISTANT_TIME_ZONE) : ''}${summary.time ? ` saat ${summary.time}` : ''} talebiniz klinik ekibi tarafından inceleniyor; onaylandığında size bildirilecek.`
        : 'Randevu talebiniz klinik ekibi tarafından inceleniyor; onaylandığında size bildirilecek.';
    }
    if (nluDecision.intent === 'change_request' || nluDecision.intent === 'cancel_request') {
      return createHandoffRequest({
        clinic: args.clinic,
        entry: args.entry,
        instagramConnectionId: args.instagramConnectionId,
        externalSenderId: args.externalSenderId,
        externalConversationId: args.externalConversationId,
        customerName,
        text: args.text,
        conversationKey: args.conversationKey,
      });
    }
    return 'Randevu talebinizin durumunu sorabilir, saat veya tarih değişikliği isteyebilir, iptal talep edebilir ya da yetkili biriyle görüşmek isteyebilirsiniz. Nasıl yardımcı olabilirim?';
  }

  const clinicFacts = await loadClinicFacts(args.clinic);
  const agentResolution = await resolveWhatsAppConversationAgentDecision({
    latestMessage: args.text,
    customerName,
    currentIntent: state?.currentIntent,
    currentStep: state?.step,
    selectedAppointmentTypeName: state?.selectedAppointmentTypeName,
    selectedDate: state?.selectedDate,
    services,
    recentMessages: [],
    clinicFacts,
  });

  const decision = agentResolution.decision;
  const intent = decision?.intent === 'check_appointment' ? 'appointment_query' : decision?.intent ?? 'unknown';
  const minimumConfidence = agentResolution.source === 'ai' ? 0.6 : 0.8;

  console.info('[instagram-assistant] decision', {
    source: agentResolution.source,
    intent,
    action: decision?.action ?? null,
    confidence: decision?.confidence ?? null,
    step: currentStep,
    clinicFactsKnown: clinicFacts.workingHoursKnown || clinicFacts.doctorCountKnown,
  });

  if (!decision || (decision.confidence < minimumConfidence && !['ask_clarification', 'unknown_safe_reply'].includes(decision.action))) {
    await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
      customerName,
      currentIntent: null,
      step: null,
      lastMessage: args.text,
      lastProviderMessageId: args.externalMessageId ?? null,
      stateJson: null,
    });
    return 'Mesajinizi tam anlayamadim. Randevu almak, klinik bilgisi sormak veya yetkili ekibe ulasmak istediginizi yazabilirsiniz.';
  }

  if (decision.action === 'human_handoff' || intent === 'human_handoff' || decision.needsHuman) {
    return createHandoffRequest({
      clinic: args.clinic,
      entry: args.entry,
      instagramConnectionId: args.instagramConnectionId,
      externalSenderId: args.externalSenderId,
      externalConversationId: args.externalConversationId,
      customerName,
      text: args.text,
      conversationKey: args.conversationKey,
    });
  }

  if (decision.action === 'answer_clinic_info' || intent === 'clinic_info') {
    return answerClinicInfo(args.clinic, args.text, currentStep);
  }

  if (decision.action === 'answer_service_info' || intent === 'service_info') {
    await resetInstagramConversationState(args.clinic.id, args.conversationKey, customerName);
    return services.length > 0 ? formatServiceList(services) : NO_ACTIVE_SERVICES_TEXT;
  }

  if (decision.action === 'appointment_lookup' || intent === 'appointment_query') {
    await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
      customerName,
      currentIntent: 'appointment_query',
      step: null,
      lastMessage: args.text,
      lastProviderMessageId: args.externalMessageId ?? null,
      stateJson: null,
    });
    return formatAppointmentLookup(await loadAppointmentLookup(args.clinic, args.entry, args.externalSenderId));
  }

  if (decision.action === 'cancel_appointment' || intent === 'cancel_appointment') {
    return createHandoffRequest({
      clinic: args.clinic,
      entry: args.entry,
      instagramConnectionId: args.instagramConnectionId,
      externalSenderId: args.externalSenderId,
      externalConversationId: args.externalConversationId,
      customerName,
      text: args.text,
      conversationKey: args.conversationKey,
    });
  }

  if (decision.action === 'start_general_assessment' || intent === 'symptom_or_complaint') {
    return createHandoffRequest({
      clinic: args.clinic,
      entry: args.entry,
      instagramConnectionId: args.instagramConnectionId,
      externalSenderId: args.externalSenderId,
      externalConversationId: args.externalConversationId,
      customerName,
      text: args.text,
      conversationKey: args.conversationKey,
    });
  }

  if (decision.action === 'refuse_off_topic') {
    return 'Bu kanal yalnızca klinik randevuları ve klinik bilgilendirme için kullanılmaktadır. Randevu almak, randevunuzu değiştirmek veya yetkiliyle görüşmek isterseniz yardımcı olabilirim.';
  }

  if (decision.action === 'reply_only' && intent === 'off_topic_or_smalltalk') {
    return answerSmallTalk(args.clinic, args.text, currentStep);
  }

  if (decision.action === 'ask_clarification') {
    await applyAgentStatePatch({
      clinicId: args.clinic.id,
      conversationKey: args.conversationKey,
      customerName,
      inputText: args.text,
      patch: decision.statePatch,
    });
    return decision.reply ?? 'Size yardimci olabilmem icin randevu, klinik bilgisi veya yetkili ekip ihtiyacinizi kisaca yazar misiniz?';
  }

  if (decision.action === 'start_booking' || decision.action === 'continue_booking' || intent === 'book_appointment') {
    if (services.length === 0) {
      await resetInstagramConversationState(args.clinic.id, args.conversationKey, customerName);
      return NO_ACTIVE_SERVICES_TEXT;
    }
    await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
      customerName,
      currentIntent: 'book_appointment',
      step: 'awaiting_service',
      selectedAppointmentTypeId: null,
      selectedAppointmentTypeName: null,
      selectedPractitionerId: null,
      selectedDate: nextSelectedDate,
      selectedTime: nextSelectedTime,
      lastMessage: args.text,
      lastProviderMessageId: args.externalMessageId ?? null,
      stateJson: null,
    });
    return formatServiceList(services);
  }

  await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
    customerName,
    currentIntent: null,
    step: null,
    lastMessage: args.text,
    lastProviderMessageId: args.externalMessageId ?? null,
    stateJson: null,
  });
  return 'Mesajinizi tam anlayamadim. Randevu almak, mevcut randevunuzu sormak, klinik bilgisi almak veya yetkili ekibe ulasmak istediginizi yazabilirsiniz.';
};

export const processInstagramIncomingMessage = async (
  args: ProcessInstagramIncomingMessageArgs,
): Promise<ProcessInstagramIncomingMessageResult> => {
  // Security: sanitize and cap text length before reaching AI.
  const text = sanitizeInboundMessageText(args.text);
  if (!text) return { status: 'skipped', reason: 'empty_text' };
  if (!canProcessInstagramAi({ clinicId: args.clinicId, needsClinicResolution: args.needsClinicResolution })) {
    return { status: 'skipped', reason: 'clinic_unresolved' };
  }

  // Rate limiting: 8 messages per 60 seconds per sender per connection.
  if (!checkInboundRateLimit('instagram', args.instagramConnectionId, args.externalSenderId)) {
    return { status: 'skipped', reason: 'empty_text' };
  }

  const [connection, clinic, inboxEntry] = await Promise.all([
    prisma.instagramConnection.findFirst({
      where: { id: args.instagramConnectionId, organizationId: args.organizationId, isActive: true },
    }),
    prisma.clinic.findFirst({
      where: { id: args.clinicId!, organizationId: args.organizationId },
      select: {
        id: true,
        organizationId: true,
        name: true,
        timezone: true,
        address: true,
        phone: true,
        email: true,
        website: true,
      },
    }),
    prisma.instagramInboxEntry.findFirst({
      where: {
        organizationId: args.organizationId,
        instagramConnectionId: args.instagramConnectionId,
        externalSenderId: args.externalSenderId,
        status: 'open',
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  if (!connection || !clinic) return { status: 'skipped', reason: 'connection_unavailable' };

  // Save inbound message for conversation history
  await prisma.instagramConversationMessage.create({
    data: {
      organizationId: args.organizationId,
      clinicId: args.clinicId ?? null,
      patientId: inboxEntry?.patientId ?? null,
      instagramConnectionId: args.instagramConnectionId,
      externalSenderId: args.externalSenderId,
      senderUsername: args.senderUsername ?? null,
      externalMessageId: args.externalMessageId ?? null,
      direction: 'incoming',
      text,
      rawPayload: args.rawPayload ? (args.rawPayload as import('@prisma/client').Prisma.InputJsonValue) : undefined,
    },
  }).catch(err => {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
      console.error('[instagram] inbound message save failed', err);
    }
  });

  const conversationKey = buildInstagramConversationKey(args.instagramConnectionId, args.externalSenderId);
  const replyText = await buildReplyText({
    clinic,
    entry: inboxEntry,
    instagramConnectionId: args.instagramConnectionId,
    externalSenderId: args.externalSenderId,
    externalConversationId: args.externalConversationId,
    senderUsername: args.senderUsername,
    conversationKey,
    text,
    externalMessageId: args.externalMessageId,
  });

  const result = await sendMessage(connection as InstagramConnectionRecord, {
    recipientIgsid: args.externalSenderId,
    text: replyText,
  });

  if (!result.success) {
    const errorMessage = result.error ?? 'Instagram reply send failed';
    await logInstagramReplyFailure({
      organizationId: args.organizationId,
      clinic,
      entry: inboxEntry,
      instagramConnectionId: args.instagramConnectionId,
      externalSenderId: args.externalSenderId,
      externalMessageId: args.externalMessageId,
      errorMessage,
    });
    throw new Error(errorMessage);
  }

  await prisma.instagramInboxEntry.updateMany({
    where: {
      organizationId: args.organizationId,
      instagramConnectionId: args.instagramConnectionId,
      externalSenderId: args.externalSenderId,
      status: 'open',
    },
    data: { updatedAt: new Date() },
  });

  // Save outbound reply and log activity
  const latestEntry = await prisma.instagramInboxEntry.findFirst({
    where: {
      organizationId: args.organizationId,
      instagramConnectionId: args.instagramConnectionId,
      externalSenderId: args.externalSenderId,
    },
    select: { patientId: true },
    orderBy: { updatedAt: 'desc' },
  });
  const linkedPatientId = latestEntry?.patientId ?? inboxEntry?.patientId ?? null;

  await prisma.instagramConversationMessage.create({
    data: {
      organizationId: args.organizationId,
      clinicId: args.clinicId ?? null,
      patientId: linkedPatientId,
      instagramConnectionId: args.instagramConnectionId,
      externalSenderId: args.externalSenderId,
      direction: 'outgoing',
      text: replyText,
    },
  }).catch(err => {
    console.error('[instagram] outbound message save failed', err);
  });

  if (linkedPatientId) {
    const systemUserId = await getClinicSystemUserId(clinic.id);
    if (systemUserId) {
      logActivity({
        clinicId: clinic.id,
        userId: systemUserId,
        entityType: 'patient',
        entityId: linkedPatientId,
        action: 'instagram_message_received',
        description: `Instagram DM alındı ve yanıtlandı${args.senderUsername ? ` (@${args.senderUsername})` : ''}`,
        patientId: linkedPatientId,
        metadata: {
          systemGenerated: true,
          source: 'instagram',
          externalSenderId: args.externalSenderId,
          instagramConnectionId: args.instagramConnectionId,
          messagePreview: text.slice(0, 100),
        },
      }).catch(() => {});
    }

    // Back-fill patientId on any inbound messages saved before patient was linked
    prisma.instagramConversationMessage.updateMany({
      where: {
        organizationId: args.organizationId,
        instagramConnectionId: args.instagramConnectionId,
        externalSenderId: args.externalSenderId,
        patientId: null,
      },
      data: { patientId: linkedPatientId, clinicId: args.clinicId ?? undefined },
    }).catch(() => {});
  }

  return { status: 'processed', replySent: true, replyText };
};
