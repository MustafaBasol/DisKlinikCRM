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

type InstagramAssistantStep =
  | 'main_menu'
  | 'awaiting_service'
  | 'awaiting_date'
  | 'awaiting_time'
  | 'awaiting_confirmation'
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

export const buildInstagramAppointmentFallbackPhone = (externalSenderId: string) => externalSenderId.trim();

export const canProcessInstagramAi = (args: { clinicId?: string | null; needsClinicResolution?: boolean }) =>
  Boolean(args.clinicId?.trim()) && args.needsClinicResolution !== true;

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

const getFirstName = (customerName?: string | null) => customerName?.trim().split(/\s+/)[0] ?? null;

const getPatientFullName = (patient: NonNullable<InstagramInboxContext['patient']>) =>
  `${patient.firstName.trim()} ${patient.lastName.trim()}`.trim();

const formatCustomerName = (entry: InstagramInboxContext | null, externalSenderId: string, senderUsername?: string | null) => {
  if (entry?.patient) return getPatientFullName(entry.patient);
  if (entry?.senderUsername?.trim()) return `@${entry.senderUsername.trim()}`;
  if (senderUsername?.trim()) return `@${senderUsername.trim()}`;
  return externalSenderId;
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
  const match = normalizeText(text).match(/(?:^|\D)(\d{1,2})(?:\D|$)/);
  return match ? Number(match[1]) : null;
};

const extractStandaloneNumericSelection = (text: string) => {
  const match = normalizeText(text).match(/^(\d{1,2})(?:[.)])?$/);
  return match ? Number(match[1]) : null;
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

const formatMainMenu = (clinicName: string, customerName?: string | null) => {
  const firstName = getFirstName(customerName);
  return [
    firstName ? `Merhaba ${firstName}, size nasil yardimci olabilirim?` : `Merhaba, ${clinicName} asistanina hos geldiniz. Size nasil yardimci olabilirim?`,
    '1. Randevu almak',
    '2. Randevumu sorgulamak',
    '3. Randevumu iptal etmek',
    '4. Hizmetler hakkinda bilgi almak',
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
        phone: buildInstagramAppointmentFallbackPhone(externalSenderId),
        requestType: 'appointment',
        status: { in: ['pending', 'approved'] },
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
  externalSenderId: string;
  patientName: string;
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
      patientId: args.entry?.patientId ?? null,
      patientName: args.patientName,
      phone: buildInstagramAppointmentFallbackPhone(args.externalSenderId),
      appointmentTypeId: args.appointmentTypeId ?? null,
      practitionerId: args.practitionerId ?? null,
      preferredStartTime: args.preferredStartTime ?? null,
      preferredEndTime: args.preferredEndTime ?? null,
      requestType: args.requestType,
      source: 'instagram',
      status: 'pending',
      rawMessage: args.rawMessage,
      notes: args.notes,
    },
    include: { appointmentType: { select: { name: true } } },
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
      metadata: { systemGenerated: true, source: 'instagram', externalSenderId: args.externalSenderId },
    });
  }

  return request;
};

const createInstagramAppointmentRequest = async (args: {
  clinic: InstagramAssistantClinic;
  entry: InstagramInboxContext | null;
  externalSenderId: string;
  customerName: string;
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
    externalSenderId: args.externalSenderId,
    patientName: args.customerName,
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

const createHandoffRequest = async (args: {
  clinic: InstagramAssistantClinic;
  entry: InstagramInboxContext | null;
  externalSenderId: string;
  customerName: string;
  text: string;
  conversationKey: string;
}) => {
  const request = await createInstagramStaffRequest({
    clinic: args.clinic,
    entry: args.entry,
    externalSenderId: args.externalSenderId,
    patientName: args.customerName,
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
  customerName: string;
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
  customerName: string;
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
  externalSenderId: string;
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
  const customerName = state?.customerName || formatCustomerName(args.entry, args.externalSenderId, args.senderUsername);
  const currentStep = (state?.step ?? null) as InstagramAssistantStep;
  const selectedDate = state?.selectedDate ?? null;
  const standaloneNumericSelection = extractStandaloneNumericSelection(args.text);

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
        externalSenderId: args.externalSenderId,
        customerName,
        text: args.text,
        conversationKey: args.conversationKey,
      });
    }
    if (standaloneNumericSelection === 4) return formatServiceList(services);
  }

  if (currentStep === 'awaiting_service') {
    return handleAwaitingServiceStep({
      text: args.text,
      phone: args.conversationKey,
      customerName,
      services,
      state: {
        selectedAppointmentTypeId: state?.selectedAppointmentTypeId,
        selectedAppointmentTypeName: state?.selectedAppointmentTypeName,
        selectedDate: state?.selectedDate,
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
      upsertState: data => upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
        ...data,
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
      upsertState: data => upsertInstagramConversationState(args.clinic.id, args.conversationKey, {
        ...data,
        lastProviderMessageId: args.externalMessageId ?? null,
      }),
      resetState: nextCustomerName => resetInstagramConversationState(args.clinic.id, args.conversationKey, nextCustomerName),
      createAppointment: (_clinicId, _phone, name, appointmentTypeId, selectedSlot, rawMessage) =>
        createInstagramAppointmentRequest({
          clinic: args.clinic,
          entry: args.entry,
          externalSenderId: args.externalSenderId,
          customerName: name,
          appointmentTypeId,
          selectedSlot,
          rawMessage,
        }),
    });
  }

  if (currentStep === 'awaiting_confirmation' && isDeterministicConfirmationReply(args.text)) {
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
      createAppointment: (_clinicId, _phone, name, appointmentTypeId, selectedSlot, rawMessage) =>
        createInstagramAppointmentRequest({
          clinic: args.clinic,
          entry: args.entry,
          externalSenderId: args.externalSenderId,
          customerName: name,
          appointmentTypeId,
          selectedSlot,
          rawMessage,
        }),
    });
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
      externalSenderId: args.externalSenderId,
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
      externalSenderId: args.externalSenderId,
      customerName,
      text: args.text,
      conversationKey: args.conversationKey,
    });
  }

  if (decision.action === 'start_general_assessment' || intent === 'symptom_or_complaint') {
    return createHandoffRequest({
      clinic: args.clinic,
      entry: args.entry,
      externalSenderId: args.externalSenderId,
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
      selectedDate: null,
      selectedTime: null,
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

  const conversationKey = buildInstagramConversationKey(args.instagramConnectionId, args.externalSenderId);
  const replyText = await buildReplyText({
    clinic,
    entry: inboxEntry,
    externalSenderId: args.externalSenderId,
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

  return { status: 'processed', replySent: true, replyText };
};
