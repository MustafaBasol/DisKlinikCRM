import { Prisma } from '@prisma/client';
import prisma from '../../db.js';
import { normalizeDateWithGoogleAi } from '../googleAiStudio.js';
import {
  handleAwaitingConfirmationStep,
  handleAwaitingDateStep,
  handleAwaitingServiceStep,
  handleAwaitingTimeStep,
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

type InstagramAssistantStep =
  | 'main_menu'
  | 'awaiting_service'
  | 'awaiting_date'
  | 'awaiting_time'
  | 'awaiting_confirmation'
  | 'awaiting_name'
  | 'awaiting_phone'
  | 'awaiting_handoff_note'
  | null;

type InstagramAssistantStateJson = BookingStateJson & {
  pendingHandoffRequestId?: string;
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

type InstagramAssistantService = {
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

const FALLBACK_SERVICES: InstagramAssistantService[] = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Agiz, Dis ve Cene Cerrahisi', durationMinutes: 30 },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Dis Beyazlatma', durationMinutes: 30 },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Endodonti (Kanal Tedavisi)', durationMinutes: 60 },
  { id: '44444444-4444-4444-8444-444444444444', name: 'Estetik Dis Hekimligi', durationMinutes: 45 },
  { id: 'd4e8a00f-b601-4b8d-a21b-f3a13899f336', name: 'Gulus Tasarimi', durationMinutes: 60 },
];

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

const getAssistantServices = async (clinicId: string): Promise<InstagramAssistantService[]> => {
  const services = await prisma.appointmentType.findMany({
    where: { clinicId, isActive: true, isService: true },
    select: { id: true, name: true, durationMinutes: true },
    orderBy: { name: 'asc' },
  });
  return services.length > 0 ? services : FALLBACK_SERVICES;
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
  const exactMatch = await prisma.patient.findFirst({
    where: { clinicId, phone, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
  if (exactMatch) return exactMatch;

  const candidates = await prisma.patient.findMany({
    where: { clinicId, phone: { not: null }, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
  return candidates.find(candidate => phonesMatch(candidate.phone, phone)) ?? null;
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
  const availability = await checkPractitionerAvailability(args.clinic.id, args.selectedSlot.practitionerId, startTime, endTime);
  if (!availability.ok) throw new Error('APPOINTMENT_OUTSIDE_AVAILABILITY');

  const overlap = await prisma.appointment.findFirst({
    where: {
      clinicId: args.clinic.id,
      practitionerId: args.selectedSlot.practitionerId,
      deletedAt: null,
      status: { notIn: ['cancelled'] },
      OR: [{ startTime: { lt: endTime }, endTime: { gt: startTime } }],
    },
    select: { id: true },
  });
  if (overlap) throw new Error('APPOINTMENT_OVERLAP');

  const request = await createInstagramStaffRequest({
    clinic: args.clinic,
    entry: args.entry,
    instagramConnectionId: args.instagramConnectionId,
    externalSenderId: args.externalSenderId,
    externalConversationId: args.externalConversationId,
    patientId: args.patientId,
    patientName: args.customerName,
    patientPhone: args.patientPhone,
    requestType: 'appointment',
    rawMessage: args.rawMessage ?? '',
    appointmentTypeId: args.appointmentTypeId,
    practitionerId: args.selectedSlot.practitionerId,
    preferredStartTime: startTime,
    preferredEndTime: endTime,
    notes: 'Instagram DM asistani uzerinden personel onayina gonderildi.',
  });

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
  const request = await createInstagramStaffRequest({
    clinic: args.clinic,
    entry: args.entry,
    instagramConnectionId: args.instagramConnectionId,
    externalSenderId: args.externalSenderId,
    externalConversationId: args.externalConversationId,
    patientName: args.customerName ?? 'Instagram Kullanıcısı',
    requestType: 'info',
    rawMessage: args.text,
    notes: `Instagram DM uzerinden yetkili talebi alindi.\nIlk mesaj: ${args.text}`,
  });

  await upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
    customerName: args.customerName,
    currentIntent: 'human_handoff',
    step: 'awaiting_handoff_note',
    lastMessage: args.text,
    stateJson: { pendingHandoffRequestId: request.id },
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
    await prisma.appointmentRequest.updateMany({
      where: { id: args.stateJson.pendingHandoffRequestId, clinicId: args.clinic.id },
      data: { notes: `Instagram DM uzerinden yetkili talebi alindi.\nKullanici notu: ${note}` },
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
    if (standaloneNumericSelection === 4) return formatServiceList(services);
  }

  if (currentStep === 'awaiting_service') {
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

  if (currentStep === 'awaiting_name') {
    const pendingSlot = stateJson.pendingConfirmationSlot ?? null;
    const appointmentTypeId = state?.selectedAppointmentTypeId ?? null;
    const selectedDateForRequest = state?.selectedDate ?? null;
    const providedName = args.text.trim().replace(/\s+/g, ' ');

    if (!hasUsableInstagramFullName(providedName)) {
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
      return 'Randevu talebinizi tamamlayabilmem için adınızı ve soyadınızı birlikte paylaşır mısınız? Örneğin: Anatoly Echo';
    }

    if (!pendingSlot || !appointmentTypeId || !selectedDateForRequest) {
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

      await resetInstagramConversationState(args.clinic.id, args.conversationKey, providedName);
      const serviceName = state?.selectedAppointmentTypeName ?? request.appointmentType?.name ?? 'seçtiğiniz hizmet';
      return formatInstagramBookingCreatedReply({
        customerName: providedName,
        selectedDate: selectedDateForRequest,
        localStartTime: pendingSlot.localStartTime,
        practitionerName: pendingSlot.practitionerName,
        serviceName,
      });
    } catch (error) {
      if (error instanceof Error && (error.message === 'APPOINTMENT_OUTSIDE_AVAILABILITY' || error.message === 'APPOINTMENT_OVERLAP')) {
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

      await resetInstagramConversationState(args.clinic.id, args.conversationKey, resolvedPatient.fullName);
      const serviceName = state?.selectedAppointmentTypeName ?? request.appointmentType?.name ?? 'seçtiğiniz hizmet';
      return formatInstagramBookingCreatedReply({
        customerName: resolvedPatient.fullName,
        selectedDate: selectedDateForRequest,
        localStartTime: pendingSlot.localStartTime,
        practitionerName: pendingSlot.practitionerName,
        serviceName,
      });
    } catch (error) {
      if (error instanceof Error && (error.message === 'APPOINTMENT_OUTSIDE_AVAILABILITY' || error.message === 'APPOINTMENT_OVERLAP')) {
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
    return formatServiceList(services);
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
  const text = args.text.trim().slice(0, 2000);
  if (!text) return { status: 'skipped', reason: 'empty_text' };
  if (!canProcessInstagramAi({ clinicId: args.clinicId, needsClinicResolution: args.needsClinicResolution })) {
    return { status: 'skipped', reason: 'clinic_unresolved' };
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
