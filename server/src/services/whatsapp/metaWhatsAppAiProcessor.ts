/**
 * metaWhatsAppAiProcessor.ts — Meta Cloud WhatsApp AI Conversation Processor
 *
 * Processes incoming Meta Cloud WhatsApp messages through the shared AI
 * conversation agent + booking flow + handoff + reply pipeline.
 *
 * Architecture notes:
 * - Mirrors instagramAiConversationProcessor.ts adapted for WhatsApp specifics.
 * - State stored in WhatsAppConversationState with key: whatsapp:{connectionId}:{phone}
 * - Reply sent via MetaCloudWhatsAppProvider.sendMessage()
 * - AppointmentRequest.source = 'meta_whatsapp'
 * - Patient lookup by phone (reliable in WA); auto-creation is intentionally skipped.
 * - No separate message history table; inbox entry updatedAt bumped after reply.
 * - Idempotency gate is enforced in the webhook BEFORE this processor is called.
 *
 * Security:
 * - clinicId / organizationId are never taken from the user message.
 * - Incoming text is truncated to 2000 chars before reaching AI.
 * - AI-returned slot IDs are validated against DB (via booking flow handlers).
 * - send failure logs OperationalEvent + ActivityLog for staff visibility.
 */

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
  saveSlotsForState,
  type SavedAvailableSlot,
} from '../whatsappAvailability.js';
import { interpretTimeRequest } from '../whatsappInterpreter.js';
import { MetaCloudWhatsAppProvider } from './MetaCloudWhatsAppProvider.js';
import type { WhatsAppConnectionRecord } from './WhatsAppProvider.js';
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

// ── Types ─────────────────────────────────────────────────────────────────────

type MetaWaStep =
  | 'main_menu'
  | 'awaiting_service'
  | 'awaiting_date'
  | 'awaiting_time'
  | 'awaiting_confirmation'
  | 'awaiting_handoff_note'
  | null;

type MetaWaStateJson = BookingStateJson & {
  pendingHandoffRequestId?: string;
};

type MetaWaClinic = {
  id: string;
  organizationId: string;
  name: string;
  timezone: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
};

type MetaWaService = {
  id: string;
  name: string;
  durationMinutes: number;
};

type MetaWaInboxContext = {
  id: string;
  patientId: string | null;
  patient: { id: string; firstName: string; lastName: string; phone: string | null } | null;
};

export type ProcessMetaWhatsAppIncomingMessageArgs = {
  organizationId: string;
  clinicId: string;
  connectionId: string;
  /** Sender phone number in E.164 format as received from Meta Cloud API */
  phone: string;
  messageId?: string | null;
  text: string;
  rawPayload?: Record<string, unknown> | null;
};

export type ProcessMetaWhatsAppIncomingMessageResult =
  | { status: 'processed'; replySent: boolean; replyText: string }
  | { status: 'skipped'; reason: 'clinic_unresolved' | 'connection_unavailable' | 'empty_text' };

// ── Fallback services ─────────────────────────────────────────────────────────

const FALLBACK_SERVICES: MetaWaService[] = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Agiz, Dis ve Cene Cerrahisi', durationMinutes: 30 },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Dis Beyazlatma', durationMinutes: 30 },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Endodonti (Kanal Tedavisi)', durationMinutes: 60 },
  { id: '44444444-4444-4444-8444-444444444444', name: 'Estetik Dis Hekimligi', durationMinutes: 45 },
];

// ── Conversation key ──────────────────────────────────────────────────────────

/**
 * Conversation key for WhatsApp Meta Cloud provider.
 * Format: whatsapp:{connectionId}:{phone}
 * Namespace intentionally differs from Evolution WA (bare phone) and Instagram.
 */
export const buildMetaWaConversationKey = (connectionId: string, phone: string): string =>
  `whatsapp:${connectionId}:${phone}`;

// ── Safe logging ──────────────────────────────────────────────────────────────

const summarizeId = (value: string | null | undefined) =>
  value ? { length: value.length, suffix: value.slice(-4) } : null;

// ── Text helpers ──────────────────────────────────────────────────────────────

const normalizePhoneDigits = (v: string) => v.replace(/\D/g, '');

const normalizeText = (v: string) =>
  v.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');

const normalizeSearchText = (v: string) =>
  normalizeText(v)
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ı/g, 'i')
    .replace(/İ/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const isGreeting = (text: string) =>
  /^(merhaba|selam|iyi gunler|iyi akşamlar|iyi aksamlar|gunaydin|günaydın|hey)\b/i.test(text.trim());

const isMainMenuCommand = (text: string) => {
  const n = normalizeSearchText(text);
  return ['menu', 'menu goster', 'ana menu', 'basa don', 'reset', 'yeniden basla']
    .some(p => n === p || n.includes(p));
};

const isNegativeHandoffNote = (text: string) => {
  const n = normalizeSearchText(text);
  return ['hayir', 'yok', 'gerek yok', 'not yok', 'istemiyorum']
    .some(p => n === p || n.includes(p));
};

const extractStandaloneNumericSelection = (text: string): number | null => {
  const m = normalizeText(text).match(/^(\d{1,2})(?:[.)])?$/);
  return m ? Number(m[1]) : null;
};

const extractNumericSelection = (text: string): number | null => {
  const m = normalizeText(text).match(/^(\d{1,2})(?:[.)])?$/);
  return m ? Number(m[1]) : null;
};

const isPoliteClosingMessage = (text: string) => {
  const n = normalizeSearchText(text);
  return ['tesekkurler', 'tesekkur ederim', 'cok sag ol', 'sag ol', 'sag olun', 'tamam', 'iyi gunler', 'oldun zaten']
    .some(p => n === p || n.includes(p));
};

const getFirstName = (name?: string | null): string | null =>
  name?.trim().split(/\s+/)[0] ?? null;

// ── Service helpers ───────────────────────────────────────────────────────────

const getAssistantServices = async (clinicId: string): Promise<MetaWaService[]> => {
  const services = await prisma.appointmentType.findMany({
    where: { clinicId, isActive: true, isService: true },
    select: { id: true, name: true, durationMinutes: true },
    orderBy: { name: 'asc' },
  });
  return services.length > 0 ? services : FALLBACK_SERVICES;
};

const formatServiceList = (services: MetaWaService[]): string =>
  [
    'Elbette, hangi hizmet icin randevu planlamak istersiniz?',
    ...services.map((s, i) => `${i + 1}. ${s.name}`),
  ].join('\n');

const formatMainMenu = (_clinicName: string, customerName?: string | null): string => {
  const firstName = getFirstName(customerName);
  return [
    firstName
      ? `Merhaba ${firstName}, size nasıl yardımcı olabilirim?`
      : 'Merhaba, size nasıl yardımcı olabilirim?',
    '',
    '1. Randevu almak',
    '2. Randevumu sorgulamak',
    '3. Randevumu iptal etmek',
    '4. Hizmetler hakkında bilgi almak',
  ].join('\n');
};

// ── Clinic facts ──────────────────────────────────────────────────────────────

const loadClinicFacts = async (clinic: MetaWaClinic) => {
  const [doctorCount, workingHoursCount] = await Promise.all([
    prisma.user.count({
      where: { clinicId: clinic.id, isActive: true, role: { in: ['doctor', 'DENTIST', 'dentist'] } },
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
    workingHoursDetail: workingHoursCount > 0 ? ('closed_days_only' as const) : ('none' as const),
  };
};

// ── Availability message ──────────────────────────────────────────────────────

const formatAvailabilityMessage = (date: string, slots: SavedAvailableSlot[]): string =>
  [
    `${formatTurkishDateLong(date, WHATSAPP_ASSISTANT_TIME_ZONE)} icin takvimi kontrol ettim. Uygun saatler:`,
    ...slots.map((s, i) => `${i + 1}. ${s.localStartTime}${s.practitionerName ? ` (${s.practitionerName})` : ''}`),
    '',
    'Size uygun olan saati numarasiyla veya saat olarak yazabilirsiniz.',
  ].join('\n');

// ── Appointment lookup ────────────────────────────────────────────────────────

const loadAppointmentLookup = async (
  clinic: MetaWaClinic,
  entry: MetaWaInboxContext | null,
  phone: string,
): Promise<string> => {
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
          { source: 'meta_whatsapp', externalSenderId: phone.trim() },
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

  const rows = [
    ...appointments.map(a => {
      const { date, time } = formatClinicDateTime(a.startTime, timeZone);
      return {
        date,
        startTime: time,
        serviceName: a.appointmentType?.name ?? null,
        practitionerName: a.practitioner
          ? `${a.practitioner.firstName} ${a.practitioner.lastName}`
          : null,
        status: a.status,
      };
    }),
    ...pendingRequests.map(r => {
      const f = r.preferredStartTime ? formatClinicDateTime(r.preferredStartTime, timeZone) : null;
      return {
        date: f?.date ?? 'Tarih netlesmedi',
        startTime: f?.time ?? 'Saat netlesmedi',
        serviceName: r.appointmentType?.name ?? null,
        practitionerName: r.practitioner
          ? `${r.practitioner.firstName} ${r.practitioner.lastName}`
          : null,
        status: r.status,
      };
    }),
  ];

  if (rows.length === 0) {
    return 'Bu numara icin aktif randevu veya bekleyen randevu talebi bulamadim.';
  }
  return [
    'Sistemde gorunen randevu/talep bilgileri:',
    ...rows.map(
      (item, i) =>
        `${i + 1}. ${item.date} ${item.startTime} - ${item.serviceName ?? 'Hizmet bilgisi yok'}` +
        `${item.practitionerName ? ` (${item.practitionerName})` : ''} - ${item.status}`,
    ),
  ].join('\n');
};

// ── Clinic info answers ───────────────────────────────────────────────────────

const answerClinicInfo = (clinic: MetaWaClinic, text: string, currentStep: MetaWaStep): string => {
  const n = normalizeSearchText(text);
  const cont =
    currentStep && currentStep !== 'main_menu'
      ? ' Randevu akisina devam etmek isterseniz kaldigimiz yerden ilerleyebiliriz.'
      : '';
  if (n.includes('adres') || n.includes('neredesiniz') || n.includes('konum'))
    return clinic.address?.trim()
      ? `Klinik adresi: ${clinic.address.trim()}${cont}`
      : `Adres bilgisini sistemde net olarak goremiyorum.${cont}`;
  if (n.includes('telefon'))
    return clinic.phone?.trim()
      ? `Klinik telefon numarasi: ${clinic.phone.trim()}${cont}`
      : `Telefon bilgisini sistemde net olarak goremiyorum.${cont}`;
  if (n.includes('mail') || n.includes('email'))
    return clinic.email?.trim()
      ? `Klinik e-posta: ${clinic.email.trim()}${cont}`
      : `E-posta bilgisini sistemde net olarak goremiyorum.${cont}`;
  if (n.includes('web'))
    return clinic.website?.trim()
      ? `Klinik web sitesi: ${clinic.website.trim()}${cont}`
      : `Web sitesi bilgisini sistemde net olarak goremiyorum.${cont}`;
  return `Bu bilgiyi sistemde net olarak goremiyorum. Isterseniz talebinizi yetkili ekibe iletebilirim.${cont}`;
};

// ── Slot/service matching ─────────────────────────────────────────────────────

const normalizePractitionerName = (v: string) =>
  normalizeSearchText(v)
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
  const queryTokens = normalizedQuery.split(' ').filter(t => t.length >= 3 && !/^\d+$/.test(t));
  const matches = slots
    .map((slot, index) => {
      const np = normalizePractitionerName(slot.practitionerName);
      const pt = np.split(' ').filter(t => t.length >= 3);
      const timeMatches = extractedTime ? slot.localStartTime === extractedTime : true;
      const practitionerMatches =
        queryTokens.length === 0
          ? true
          : queryTokens.every(t => np.includes(t) || pt.some(nt => nt.includes(t)));
      return { slot, index, timeMatches, practitionerMatches };
    })
    .filter(m => m.timeMatches && m.practitionerMatches);
  return { extractedTime, hasPractitionerFragment: queryTokens.length > 0, matches };
};

const findServiceMatches = (text: string, services: MetaWaService[]): MetaWaService[] => {
  const nq = normalizeSearchText(text);
  if (!nq || /^\d+$/.test(nq)) return [];
  const qt = nq.split(' ').filter(Boolean);
  return services.filter(s => {
    const ns = normalizeSearchText(s.name);
    return ns.includes(nq) || nq.includes(ns) || qt.every(t => ns.includes(t));
  });
};

// ── State management ──────────────────────────────────────────────────────────

type StateData = {
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
  stateJson?: MetaWaStateJson | null;
};

const toPrismaJson = (value: MetaWaStateJson | null | undefined) => {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
};

const readStateJson = (value: unknown): MetaWaStateJson => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const r = value as Record<string, unknown>;
  return {
    availableSlots: Array.isArray(r.availableSlots)
      ? (r.availableSlots as SavedAvailableSlot[])
      : undefined,
    lastShownSlots: Array.isArray(r.lastShownSlots)
      ? (r.lastShownSlots as SavedAvailableSlot[])
      : undefined,
    matchedServices: Array.isArray(r.matchedServices)
      ? (r.matchedServices as Array<{ id: string; name: string }>)
      : undefined,
    pendingConfirmationSlot:
      r.pendingConfirmationSlot &&
      typeof r.pendingConfirmationSlot === 'object' &&
      !Array.isArray(r.pendingConfirmationSlot)
        ? (r.pendingConfirmationSlot as SavedAvailableSlot)
        : undefined,
    pendingHandoffRequestId:
      typeof r.pendingHandoffRequestId === 'string' ? r.pendingHandoffRequestId : undefined,
  };
};

const upsertMetaWaState = (clinicId: string, conversationKey: string, data: StateData) => {
  const { stateJson: rawStateJson, ...rest } = data;
  const stateJsonPrisma = toPrismaJson(rawStateJson);
  return prisma.whatsAppConversationState.upsert({
    where: { clinicId_phone: { clinicId, phone: conversationKey } },
    update: {
      ...rest,
      ...(stateJsonPrisma !== undefined ? { stateJson: stateJsonPrisma } : {}),
    },
    create: {
      clinicId,
      phone: conversationKey,
      ...rest,
      ...(stateJsonPrisma !== undefined ? { stateJson: stateJsonPrisma } : {}),
    } as Prisma.WhatsAppConversationStateUncheckedCreateInput,
  });
};

const resetMetaWaState = (
  clinicId: string,
  conversationKey: string,
  customerName?: string | null,
) =>
  upsertMetaWaState(clinicId, conversationKey, {
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

// ── System user ───────────────────────────────────────────────────────────────

const getClinicSystemUserId = async (clinicId: string): Promise<string | null> => {
  const user = await prisma.user.findFirst({
    where: { clinicId, isActive: true },
    select: { id: true },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });
  return user?.id ?? null;
};

// ── Patient lookup by phone ───────────────────────────────────────────────────

const getPhoneVariants = (digits: string): string[] => {
  const vs = new Set<string>();
  if (!digits) return [];
  vs.add(digits);
  if (digits.startsWith('90') && digits.length === 12) {
    vs.add(digits.slice(2));
    vs.add(`0${digits.slice(2)}`);
  } else if (digits.startsWith('0') && digits.length === 11) {
    vs.add(digits.slice(1));
    vs.add(`90${digits.slice(1)}`);
  } else if (digits.length === 10) {
    vs.add(`0${digits}`);
    vs.add(`90${digits}`);
  }
  return [...vs];
};

const findExistingPatientByPhone = async (
  clinicId: string,
  phone: string,
): Promise<{ id: string; firstName: string; lastName: string; phone: string | null } | null> => {
  const digits = normalizePhoneDigits(phone);
  const variants = getPhoneVariants(digits);
  if (variants.length === 0) return null;
  return prisma.patient.findFirst({
    where: { clinicId, phone: { in: variants }, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
};

// ── AppointmentRequest source metadata ───────────────────────────────────────

const buildMetaWaSourceMetadata = (args: {
  connectionId: string;
  phone: string;
  inboxEntryId?: string | null;
}) => ({
  source: 'meta_whatsapp',
  externalSenderId: args.phone,
  sourceConnectionId: args.connectionId,
  sourceInboxEntryId: args.inboxEntryId ?? null,
  sourceConversationId: args.phone,
});

// ── Staff / appointment request creation ─────────────────────────────────────

const createMetaWaStaffRequest = async (args: {
  clinic: MetaWaClinic;
  inboxEntryId: string | null;
  connectionId: string;
  phone: string;
  customerName: string;
  patientId?: string | null;
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
      patientId: args.patientId ?? null,
      patientName: args.customerName,
      phone: normalizePhoneDigits(args.phone) || args.phone,
      appointmentTypeId: args.appointmentTypeId ?? null,
      practitionerId: args.practitionerId ?? null,
      preferredStartTime: args.preferredStartTime ?? null,
      preferredEndTime: args.preferredEndTime ?? null,
      requestType: args.requestType,
      ...buildMetaWaSourceMetadata({
        connectionId: args.connectionId,
        phone: args.phone,
        inboxEntryId: args.inboxEntryId,
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

  console.info('[meta-wa-assistant] appointment-request created', {
    channel: 'meta_whatsapp',
    clinicId: summarizeId(args.clinic.id),
    inboxEntryId: summarizeId(args.inboxEntryId),
    patientId: summarizeId(args.patientId),
    requestId: summarizeId(request.id),
    requestType: args.requestType,
  });

  const systemUserId = await getClinicSystemUserId(args.clinic.id);
  if (systemUserId) {
    await logActivity({
      clinicId: args.clinic.id,
      userId: systemUserId,
      entityType: 'appointment_request',
      entityId: request.id,
      action: 'created',
      description: 'Meta WhatsApp AI assistant created appointment request for staff approval',
      patientId: args.patientId ?? undefined,
      metadata: {
        systemGenerated: true,
        source: 'meta_whatsapp',
        phone: summarizeId(args.phone),
        connectionId: args.connectionId,
      },
    });
  }

  return request;
};

const createMetaWaAppointmentRequest = async (args: {
  clinic: MetaWaClinic;
  inboxEntryId: string | null;
  connectionId: string;
  phone: string;
  customerName: string;
  patientId?: string | null;
  appointmentTypeId: string;
  selectedSlot: SavedAvailableSlot;
  rawMessage?: string | null;
}) => {
  const startTime = new Date(args.selectedSlot.startTime);
  const endTime = new Date(args.selectedSlot.endTime);

  // Availability check is against stable schedule data (doctor hours/off-days)
  // and can safely run outside the transaction.
  const availability = await checkPractitionerAvailability(
    args.clinic.id,
    args.selectedSlot.practitionerId,
    startTime,
    endTime,
  );
  if (!availability.ok) throw new SlotConflictError('APPOINTMENT_OUTSIDE_AVAILABILITY');

  // 1. Advisory lock  →  2. overlap re-check  →  3. create — all inside one tx.
  // Under PostgreSQL READ COMMITTED, $transaction alone is insufficient:
  // two concurrent tx can both read "no conflict" before either commits.
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
        patientId: args.patientId ?? null,
        patientName: args.customerName,
        phone: normalizePhoneDigits(args.phone) || args.phone,
        appointmentTypeId: args.appointmentTypeId,
        practitionerId: args.selectedSlot.practitionerId,
        preferredStartTime: startTime,
        preferredEndTime: endTime,
        requestType: 'appointment',
        ...buildMetaWaSourceMetadata({
          connectionId: args.connectionId,
          phone: args.phone,
          inboxEntryId: args.inboxEntryId,
        }),
        status: 'pending',
        rawMessage: args.rawMessage ?? '',
        notes: 'Meta WhatsApp AI asistani uzerinden personel onayina gonderildi.',
      },
      include: {
        appointmentType: { select: { name: true } },
        practitioner: { select: { firstName: true, lastName: true } },
      },
    });
  });

  // Logging runs after the transaction commits to avoid coupling activity logs
  // to the transaction's rollback.
  console.info('[meta-wa-assistant] appointment-request created', {
    channel: 'meta_whatsapp',
    clinicId: summarizeId(args.clinic.id),
    inboxEntryId: summarizeId(args.inboxEntryId),
    patientId: summarizeId(args.patientId),
    requestId: summarizeId(request.id),
    requestType: 'appointment',
  });

  const systemUserId = await getClinicSystemUserId(args.clinic.id);
  if (systemUserId) {
    await logActivity({
      clinicId: args.clinic.id,
      userId: systemUserId,
      entityType: 'appointment_request',
      entityId: request.id,
      action: 'created',
      description: 'Meta WhatsApp AI assistant created appointment request for staff approval',
      patientId: args.patientId ?? undefined,
      metadata: {
        systemGenerated: true,
        source: 'meta_whatsapp',
        phone: summarizeId(args.phone),
        connectionId: args.connectionId,
      },
    });
  }

  return request;
};

// ── Handoff ───────────────────────────────────────────────────────────────────

const createHandoffRequest = async (args: {
  clinic: MetaWaClinic;
  inboxEntryId: string | null;
  connectionId: string;
  phone: string;
  customerName: string | null;
  text: string;
  conversationKey: string;
  patientId?: string | null;
}): Promise<string> => {
  const request = await createMetaWaStaffRequest({
    clinic: args.clinic,
    inboxEntryId: args.inboxEntryId,
    connectionId: args.connectionId,
    phone: args.phone,
    customerName: args.customerName ?? 'WhatsApp Kullanicisi',
    patientId: args.patientId,
    requestType: 'info',
    rawMessage: args.text,
    notes: `Meta WhatsApp uzerinden yetkili talebi alindi.\nIlk mesaj: ${args.text}`,
  });

  await upsertMetaWaState(args.clinic.id, args.conversationKey, {
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
  clinic: MetaWaClinic;
  conversationKey: string;
  stateJson: MetaWaStateJson;
  customerName: string | null;
  text: string;
}): Promise<string> => {
  if (args.stateJson.pendingHandoffRequestId) {
    await prisma.appointmentRequest.updateMany({
      where: { id: args.stateJson.pendingHandoffRequestId, clinicId: args.clinic.id },
      data: {
        notes: `Meta WhatsApp uzerinden yetkili talebi alindi.\nKullanici notu: ${args.text.trim()}`,
      },
    });
  }
  await resetMetaWaState(args.clinic.id, args.conversationKey, args.customerName);
  return 'Notunuzu ekledim. Yetkili ekip en kisa surede size donus yapacak.';
};

// ── Reply failure logging ─────────────────────────────────────────────────────

export const logMetaWaReplyFailure = async (args: {
  organizationId: string;
  clinic: MetaWaClinic;
  inboxEntryId: string | null;
  connectionId: string;
  phone: string;
  messageId?: string | null;
  errorMessage: string;
}): Promise<void> => {
  const metadata = {
    connectionId: args.connectionId,
    phone: summarizeId(args.phone),
    messageId: args.messageId ?? null,
    inboxEntryId: args.inboxEntryId,
    error: args.errorMessage.slice(0, 500),
  };

  console.error('[meta-wa-assistant] reply send failed', {
    organizationId: args.organizationId,
    clinicId: args.clinic.id,
    ...metadata,
  });

  await recordOperationalEvent({
    organizationId: args.organizationId,
    clinicId: args.clinic.id,
    severity: 'error',
    source: 'meta_whatsapp',
    message: 'Meta WhatsApp AI assistant reply failed',
    metadata,
  });

  if (!args.inboxEntryId) return;

  try {
    const systemUserId = await getClinicSystemUserId(args.clinic.id);
    if (!systemUserId) return;
    await logActivity({
      clinicId: args.clinic.id,
      userId: systemUserId,
      entityType: 'whatsapp_inbox_entry',
      entityId: args.inboxEntryId,
      action: 'reply_failed',
      description:
        'Meta WhatsApp AI assistant reply could not be sent. The inbound event is left failed for staff follow-up.',
      metadata,
    });
  } catch (err) {
    console.error('[meta-wa-assistant] reply failure activity log failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

// ── Agent state patch ─────────────────────────────────────────────────────────

const applyAgentStatePatch = (args: {
  clinicId: string;
  conversationKey: string;
  customerName: string | null;
  inputText: string;
  patch: WhatsAppAgentDecision['statePatch'];
  messageId?: string | null;
}) => {
  const data: StateData = {
    customerName: args.customerName,
    lastMessage: args.inputText,
    lastProviderMessageId: args.messageId ?? null,
  };
  if ('currentIntent' in args.patch) data.currentIntent = args.patch.currentIntent ?? null;
  if ('step' in args.patch) data.step = args.patch.step ?? null;
  if ('selectedAppointmentTypeId' in args.patch)
    data.selectedAppointmentTypeId = args.patch.selectedAppointmentTypeId ?? null;
  if ('selectedAppointmentTypeName' in args.patch)
    data.selectedAppointmentTypeName = args.patch.selectedAppointmentTypeName ?? null;
  if ('selectedDate' in args.patch) data.selectedDate = args.patch.selectedDate ?? null;
  if ('selectedTime' in args.patch) data.selectedTime = args.patch.selectedTime ?? null;
  return upsertMetaWaState(args.clinicId, args.conversationKey, data);
};

// ── Core decision tree ────────────────────────────────────────────────────────

const buildReplyText = async (args: {
  clinic: MetaWaClinic;
  inboxEntry: MetaWaInboxContext | null;
  connectionId: string;
  phone: string;
  conversationKey: string;
  text: string;
  messageId?: string | null;
  patientId?: string | null;
}): Promise<string> => {
  const state = await prisma.whatsAppConversationState.findUnique({
    where: { clinicId_phone: { clinicId: args.clinic.id, phone: args.conversationKey } },
  });
  const stateJson = readStateJson(state?.stateJson);
  const services = await getAssistantServices(args.clinic.id);
  const currentStep = (state?.step ?? null) as MetaWaStep;
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
  const extractedThresholdTime =
    extractedThresholdMinutes !== null ? minutesToTime(extractedThresholdMinutes) : null;
  const standaloneNumericSelection = extractStandaloneNumericSelection(args.text);
  const nextSelectedDate = selectedDate ?? extractedDateFromInput;
  const nextSelectedTime = selectedTime ?? extractedTimeFromInput ?? extractedThresholdTime;

  // customerName: from inbox/patient link or stored state
  const customerName =
    (args.inboxEntry?.patient
      ? `${args.inboxEntry.patient.firstName} ${args.inboxEntry.patient.lastName}`.trim()
      : null) ??
    (state?.customerName ?? null);

  // ── Main menu command ──────────────────────────────────────────────────────
  if (isMainMenuCommand(args.text)) {
    await upsertMetaWaState(args.clinic.id, args.conversationKey, {
      customerName,
      currentIntent: null,
      step: 'main_menu',
      lastMessage: args.text,
      lastProviderMessageId: args.messageId ?? null,
      stateJson: null,
    });
    return formatMainMenu(args.clinic.name, customerName);
  }

  // ── Greeting at top-level ──────────────────────────────────────────────────
  if ((!currentStep || currentStep === 'main_menu') && isGreeting(args.text)) {
    await upsertMetaWaState(args.clinic.id, args.conversationKey, {
      customerName,
      currentIntent: null,
      step: 'main_menu',
      lastMessage: args.text,
      lastProviderMessageId: args.messageId ?? null,
      stateJson: null,
    });
    return formatMainMenu(args.clinic.name, customerName);
  }

  // ── Handoff note collection ────────────────────────────────────────────────
  if (currentStep === 'awaiting_handoff_note') {
    if (isNegativeHandoffNote(args.text)) {
      await resetMetaWaState(args.clinic.id, args.conversationKey, customerName);
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

  // ── Numeric dispatch from main_menu ───────────────────────────────────────
  if (currentStep === 'main_menu' && standaloneNumericSelection !== null) {
    if (standaloneNumericSelection === 1) {
      await upsertMetaWaState(args.clinic.id, args.conversationKey, {
        customerName,
        currentIntent: 'book_appointment',
        step: 'awaiting_service',
        lastMessage: args.text,
        lastProviderMessageId: args.messageId ?? null,
        stateJson: null,
      });
      return formatServiceList(services);
    }
    if (standaloneNumericSelection === 2) {
      return loadAppointmentLookup(args.clinic, args.inboxEntry, args.phone);
    }
    if (standaloneNumericSelection === 3) {
      return createHandoffRequest({
        clinic: args.clinic,
        inboxEntryId: args.inboxEntry?.id ?? null,
        connectionId: args.connectionId,
        phone: args.phone,
        customerName,
        text: args.text,
        conversationKey: args.conversationKey,
        patientId: args.inboxEntry?.patientId ?? args.patientId,
      });
    }
    if (standaloneNumericSelection === 4) return formatServiceList(services);
  }

  // ── Create appointment callback (reused by time + confirmation steps) ──────
  const sharedCreateAppointment = async (
    _clinicId: string,
    _phone: string,
    name: string,
    appointmentTypeId: string,
    selectedSlot: SavedAvailableSlot,
    rawMessage?: string | null,
  ) => {
    const patientId =
      args.inboxEntry?.patientId ??
      args.patientId ??
      (await findExistingPatientByPhone(args.clinic.id, args.phone).then(p => p?.id ?? null));

    const request = await createMetaWaAppointmentRequest({
      clinic: args.clinic,
      inboxEntryId: args.inboxEntry?.id ?? null,
      connectionId: args.connectionId,
      phone: args.phone,
      customerName: name || customerName || 'WhatsApp Kullanicisi',
      patientId,
      appointmentTypeId,
      selectedSlot,
      rawMessage,
    });
    return { appointmentType: request.appointmentType ?? null };
  };

  // ── Booking step: awaiting_service ────────────────────────────────────────
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
      upsertState: data =>
        upsertMetaWaState(args.clinic.id, args.conversationKey, {
          ...data,
          lastProviderMessageId: args.messageId ?? null,
        }),
    });

    const stateAfterService = await prisma.whatsAppConversationState.findUnique({
      where: { clinicId_phone: { clinicId: args.clinic.id, phone: args.conversationKey } },
      select: {
        step: true,
        selectedAppointmentTypeId: true,
        selectedAppointmentTypeName: true,
        selectedDate: true,
      },
    });

    // If date was also provided in the same message, jump straight to time slots
    if (
      stateAfterService?.step === 'awaiting_date' &&
      stateAfterService.selectedAppointmentTypeId &&
      nextSelectedDate
    ) {
      const slots = await buildAvailableSlots(
        prisma,
        args.clinic.id,
        stateAfterService.selectedAppointmentTypeId,
        nextSelectedDate,
        undefined,
      );
      if (slots && slots.length > 0) {
        return formatAvailabilityMessage(nextSelectedDate, saveSlotsForState(slots).slice(0, 5));
      }
    }

    return serviceReply;
  }

  // ── Booking step: awaiting_date ───────────────────────────────────────────
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
      logAvailabilitySave: (total, shown) =>
        console.debug('[meta-wa] availability-save', { total, shown }),
      minutesToTime,
      interpretDateWithAi: text =>
        normalizeDateWithGoogleAi(
          text,
          new Date().toISOString().slice(0, 10),
          args.clinic.timezone || WHATSAPP_ASSISTANT_TIME_ZONE,
        ),
      interpretTimeWithAi: async messageText => {
        const interpreted = interpretTimeRequest(messageText);
        return {
          exactTime: interpreted.exactTime,
          afterTime:
            interpreted.afterTimeMinutes !== null
              ? minutesToTime(interpreted.afterTimeMinutes)
              : null,
          timePreference: interpreted.preference,
        };
      },
      upsertState: data =>
        upsertMetaWaState(args.clinic.id, args.conversationKey, {
          ...data,
          lastProviderMessageId: args.messageId ?? null,
        }),
    });
  }

  // ── Booking step: awaiting_time ───────────────────────────────────────────
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
      logAvailabilitySave: (total, shown) =>
        console.debug('[meta-wa] slot-save', { total, shown }),
      interpretTimeWithAi: async messageText => {
        const interpreted = interpretTimeRequest(messageText);
        return {
          exactTime: interpreted.exactTime,
          afterTime:
            interpreted.afterTimeMinutes !== null
              ? minutesToTime(interpreted.afterTimeMinutes)
              : null,
          timePreference: interpreted.preference,
        };
      },
      upsertState: data =>
        upsertMetaWaState(args.clinic.id, args.conversationKey, {
          ...data,
          lastProviderMessageId: args.messageId ?? null,
        }),
      resetState: nextCustomerName =>
        resetMetaWaState(args.clinic.id, args.conversationKey, nextCustomerName),
      createAppointment: sharedCreateAppointment,
    });
  }

  // ── Booking step: awaiting_confirmation ───────────────────────────────────
  if (currentStep === 'awaiting_confirmation') {
    return handleAwaitingConfirmationStep({
      clinicId: args.clinic.id,
      phone: args.conversationKey,
      text: args.text,
      customerName: customerName ?? 'WhatsApp Kullanicisi',
      state: {
        selectedAppointmentTypeId: state?.selectedAppointmentTypeId,
        selectedAppointmentTypeName: state?.selectedAppointmentTypeName,
        selectedPractitionerId: state?.selectedPractitionerId,
        selectedDate: state?.selectedDate,
      },
      stateJson,
      resetState: nextCustomerName =>
        resetMetaWaState(args.clinic.id, args.conversationKey, nextCustomerName),
      upsertState: data =>
        upsertMetaWaState(args.clinic.id, args.conversationKey, {
          ...data,
          lastProviderMessageId: args.messageId ?? null,
        }),
      createAppointment: sharedCreateAppointment,
    });
  }

  // ── AI agent decision ─────────────────────────────────────────────────────
  const clinicFacts = await loadClinicFacts(args.clinic);
  const recentState = await prisma.whatsAppConversationState.findUnique({
    where: { clinicId_phone: { clinicId: args.clinic.id, phone: args.conversationKey } },
    select: { lastMessage: true },
  });

  const { decision, source: agentSource } = await resolveWhatsAppConversationAgentDecision({
    latestMessage: args.text,
    customerName,
    currentIntent: state?.currentIntent ?? null,
    currentStep: state?.step ?? null,
    selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null,
    selectedDate: state?.selectedDate ?? null,
    services,
    recentMessages: recentState?.lastMessage
      ? [{ direction: 'incoming' as const, text: recentState.lastMessage }]
      : [],
    clinicFacts,
  });

  console.debug('[meta-wa-assistant] agent decision', {
    clinicId: summarizeId(args.clinic.id),
    agentSource,
    action: decision?.action ?? null,
    intent: decision?.intent ?? null,
  });

  if (!decision) {
    return 'Mesajinizi tam anlayamadim. Randevu almak, mevcut randevunuzu sormak, klinik bilgisi almak veya yetkili ekibe ulasmak istediginizi yazabilirsiniz.';
  }

  const intent = decision.intent;

  if (decision.action === 'show_main_menu') {
    await upsertMetaWaState(args.clinic.id, args.conversationKey, {
      customerName,
      currentIntent: null,
      step: 'main_menu',
      lastMessage: args.text,
      lastProviderMessageId: args.messageId ?? null,
      stateJson: null,
    });
    return formatMainMenu(args.clinic.name, customerName);
  }

  if (decision.action === 'human_handoff' || intent === 'human_handoff') {
    return createHandoffRequest({
      clinic: args.clinic,
      inboxEntryId: args.inboxEntry?.id ?? null,
      connectionId: args.connectionId,
      phone: args.phone,
      customerName,
      text: args.text,
      conversationKey: args.conversationKey,
      patientId: args.inboxEntry?.patientId ?? args.patientId,
    });
  }

  if (decision.action === 'appointment_lookup' || intent === 'appointment_query') {
    return loadAppointmentLookup(args.clinic, args.inboxEntry, args.phone);
  }

  if (decision.action === 'answer_clinic_info' || intent === 'clinic_info') {
    return answerClinicInfo(args.clinic, args.text, currentStep);
  }

  if (decision.action === 'answer_service_info' || intent === 'service_info') {
    return formatServiceList(services);
  }

  if (decision.action === 'refuse_off_topic') {
    return 'Bu kanal yalnızca klinik randevuları ve klinik bilgilendirme için kullanılmaktadır. Randevu almak, randevunuzu değiştirmek veya yetkiliyle görüşmek isterseniz yardımcı olabilirim.';
  }

  if (decision.action === 'reply_only' || intent === 'off_topic_or_smalltalk') {
    if (isPoliteClosingMessage(args.text) && !currentStep) {
      return 'Rica ederim, saglikli gunler dilerim.';
    }
    await applyAgentStatePatch({
      clinicId: args.clinic.id,
      conversationKey: args.conversationKey,
      customerName,
      inputText: args.text,
      patch: decision.statePatch,
      messageId: args.messageId,
    });
    return (
      decision.reply ??
      'Size yardimci olabilmem icin randevu, klinik bilgisi veya yetkili ekip ihtiyacinizi kisaca yazar misiniz?'
    );
  }

  if (
    decision.action === 'start_booking' ||
    decision.action === 'continue_booking' ||
    intent === 'book_appointment'
  ) {
    await upsertMetaWaState(args.clinic.id, args.conversationKey, {
      customerName,
      currentIntent: 'book_appointment',
      step: 'awaiting_service',
      selectedAppointmentTypeId: null,
      selectedAppointmentTypeName: null,
      selectedPractitionerId: null,
      selectedDate: nextSelectedDate,
      selectedTime: nextSelectedTime,
      lastMessage: args.text,
      lastProviderMessageId: args.messageId ?? null,
      stateJson: null,
    });
    return formatServiceList(services);
  }

  await upsertMetaWaState(args.clinic.id, args.conversationKey, {
    customerName,
    currentIntent: null,
    step: null,
    lastMessage: args.text,
    lastProviderMessageId: args.messageId ?? null,
    stateJson: null,
  });
  return 'Mesajinizi tam anlayamadim. Randevu almak, mevcut randevunuzu sormak, klinik bilgisi almak veya yetkili ekibe ulasmak istediginizi yazabilirsiniz.';
};

// ── Entry point ───────────────────────────────────────────────────────────────

export const processMetaWhatsAppIncomingMessage = async (
  args: ProcessMetaWhatsAppIncomingMessageArgs,
): Promise<ProcessMetaWhatsAppIncomingMessageResult> => {
  // Security: sanitize and cap text length before reaching AI.
  const text = sanitizeInboundMessageText(args.text);
  if (!text) return { status: 'skipped', reason: 'empty_text' };

  // clinicId is required — idempotency gate and webhook caller must validate before invoking.
  if (!args.clinicId?.trim()) return { status: 'skipped', reason: 'clinic_unresolved' };

  // Rate limiting: 8 messages per 60 seconds per sender per connection.
  if (!checkInboundRateLimit('meta_whatsapp', args.connectionId, args.phone)) {
    return { status: 'skipped', reason: 'empty_text' };
  }

  const [connection, clinic, inboxEntry] = await Promise.all([
    prisma.whatsAppConnection.findFirst({
      where: { id: args.connectionId, organizationId: args.organizationId, isActive: true },
      select: {
        id: true,
        organizationId: true,
        provider: true,
        status: true,
        phoneNumber: true,
        metaPhoneNumberId: true,
        metaAccessTokenEncrypted: true,
        metaBusinessId: true,
        metaWabaId: true,
        metaAppId: true,
        metaWebhookVerifyToken: true,
        metaWebhookSecret: true,
        webhookSecret: true,
        metaTokenStatus: true,
        metaTokenExpiresAt: true,
        metaTokenLastCheckedAt: true,
      },
    }),
    prisma.clinic.findFirst({
      where: { id: args.clinicId, organizationId: args.organizationId },
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
    prisma.whatsAppInboxEntry.findFirst({
      where: {
        organizationId: args.organizationId,
        whatsappConnectionId: args.connectionId,
        phone: args.phone,
        status: 'open',
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  if (!connection || !clinic) {
    return { status: 'skipped', reason: 'connection_unavailable' };
  }

  // Patient lookup by WA phone — never auto-create; staff links new patients.
  const existingPatient =
    inboxEntry?.patient ?? (await findExistingPatientByPhone(clinic.id, args.phone));
  const conversationKey = buildMetaWaConversationKey(args.connectionId, args.phone);

  const replyText = await buildReplyText({
    clinic,
    inboxEntry: inboxEntry
      ? { id: inboxEntry.id, patientId: inboxEntry.patientId, patient: inboxEntry.patient }
      : null,
    connectionId: args.connectionId,
    phone: args.phone,
    conversationKey,
    text,
    messageId: args.messageId,
    patientId: existingPatient?.id ?? null,
  });

  const provider = new MetaCloudWhatsAppProvider();
  const result = await provider.sendMessage(connection as WhatsAppConnectionRecord, {
    phone: args.phone,
    text: replyText,
  });

  if (!result.success) {
    const errorMessage = result.error ?? 'Meta WhatsApp reply send failed';
    await logMetaWaReplyFailure({
      organizationId: args.organizationId,
      clinic,
      inboxEntryId: inboxEntry?.id ?? null,
      connectionId: args.connectionId,
      phone: args.phone,
      messageId: args.messageId,
      errorMessage,
    });
    throw new Error(errorMessage);
  }

  // Bump inbox entry so it surfaces at top in staff views
  if (inboxEntry) {
    await prisma.whatsAppInboxEntry.updateMany({
      where: {
        organizationId: args.organizationId,
        whatsappConnectionId: args.connectionId,
        phone: args.phone,
        status: 'open',
      },
      data: { updatedAt: new Date() },
    });
  }

  return { status: 'processed', replySent: true, replyText };
};
