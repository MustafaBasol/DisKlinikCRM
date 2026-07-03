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
 * - Every inbound/outbound message is persisted to WhatsAppConversationMessage
 *   (patientId null when unresolved; backfilled when staff links the inbox entry).
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
  isDeterministicConfirmationReply,
  isServiceListRequest,
  type BookingStateJson,
} from '../whatsappBookingFlow.js';
import { resolveWhatsAppConversationAgentDecision } from '../whatsappConversationAgent.js';
import { resolveStepAwareWhatsAppIntent } from '../whatsappStepAwareNlu.js';
import type { WhatsAppAgentDecision } from '../whatsappAgentSchema.js';
import {
  buildAvailableSlots,
  saveSlotsForState,
  type SavedAvailableSlot,
} from '../whatsappAvailability.js';
import { interpretTimeRequest } from '../whatsappInterpreter.js';
import { MetaCloudWhatsAppProvider } from './MetaCloudWhatsAppProvider.js';
import {
  backfillConversationMessagePatient,
  persistWhatsAppConversationMessage,
} from './conversationMessageStore.js';
import type { WhatsAppConnectionRecord } from './WhatsAppProvider.js';
import { recordOperationalEvent } from '../operationalEventService.js';
import { logActivity } from '../../utils/activity.js';
import { splitNameForPatient } from '../../utils/patientName.js';
import {
  checkPractitionerAvailability,
  formatClinicDateTime,
  minutesToTime,
} from '../../utils/helpers.js';
import {
  formatTurkishDateLong,
  formatTurkishDateWithWeekday,
  normalizeDateFromTurkishInput,
  WHATSAPP_ASSISTANT_TIME_ZONE,
} from '../../utils/whatsappDate.js';
import { sanitizeInboundMessageText } from '../../utils/messageSanitizer.js';
import { checkInboundRateLimit } from '../../utils/inboundRateLimiter.js';
import { assertSlotAvailable, acquireAppointmentSlotLock, SlotConflictError } from '../appointmentRequestSafety.js';
import { sanitizeAiMessageHistory } from '../privacy/redaction.js';
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

// ── Types ─────────────────────────────────────────────────────────────────────

export type MetaWaStep =
  | 'main_menu'
  | 'awaiting_service'
  | 'awaiting_date'
  | 'awaiting_time'
  | 'awaiting_confirmation'
  | 'awaiting_name'
  | 'post_booking'
  | 'awaiting_handoff_note'
  | 'awaiting_patient_selection'
  | 'awaiting_channel_consent'
  | null;

export type MetaWaBookingSummary = {
  serviceName: string | null;
  date: string | null;
  time: string | null;
};

export type MetaWaStateJson = BookingStateJson & {
  pendingHandoffRequestId?: string;
  pendingPatientOptions?: Array<{ id: string; firstName: string; lastName: string }> | null;
  selectedPatientId?: string | null;
  resumeAfterChannelConsent?: string | null;
  lastBookingSummary?: MetaWaBookingSummary | null;
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

export type MetaWaService = {
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

const NO_ACTIVE_SERVICES_TEXT =
  'Şu anda bu klinik için randevuya açık hizmet tanımlı görünmüyor. Talebinizi ekibe iletebilirim.';

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

const redactPhone = (phone: string) => `***${phone.slice(-4)}`;

const logWhatsAppAgentDecision = (args: {
  provider: 'meta';
  clinicId: string;
  phone: string;
  currentStep: MetaWaStep;
  deterministicMatched: boolean;
  nluUsed: boolean;
  detectedIntent: string;
  confidence: number;
  responseType: string;
}) => {
  console.info('[whatsapp-agent] decision', {
    provider: args.provider,
    clinicId: summarizeId(args.clinicId),
    phoneSuffix: redactPhone(args.phone),
    currentStep: args.currentStep,
    deterministicMatched: args.deterministicMatched,
    nluUsed: args.nluUsed,
    detectedIntent: args.detectedIntent,
    confidence: args.confidence,
    responseType: args.responseType,
  });
};

const logPostBookingDecision = (args: {
  provider: 'meta';
  clinicId: string;
  phone: string;
  detectedIntent: string;
  responseType: string;
}) => {
  console.info('[whatsapp-agent] post-booking-decision', {
    provider: args.provider,
    clinicId: summarizeId(args.clinicId),
    phoneSuffix: redactPhone(args.phone),
    detectedIntent: args.detectedIntent,
    responseType: args.responseType,
  });
};

const logIdentityResolution = (args: {
  provider: 'meta';
  clinicId: string;
  phone: string;
  matchCount: number;
  selectedPatientIdPresent: boolean;
  needsNameCollection: boolean;
  action: string;
}) => {
  console.info('[whatsapp-agent] identity-resolution', {
    provider: args.provider,
    clinicId: summarizeId(args.clinicId),
    phoneSuffix: redactPhone(args.phone),
    matchCount: args.matchCount,
    selectedPatientIdPresent: args.selectedPatientIdPresent,
    needsNameCollection: args.needsNameCollection,
    action: args.action,
  });
};

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
  return [
    'menu', 'menu goster', 'ana menu', 'basa don', 'reset', 'yeniden basla',
    'bastan basla', 'bastan baslayalim', 'iptal', 'vazgec', 'vazgectim',
  ].some(p => n === p || n.includes(p));
};

// Identifies a step where a user could get stuck behind a numeric-only
// prompt (e.g. awaiting_service) and should be able to bail out with plain
// language ("iptal", "vazgeç", "temsilci", ...).
export const isStuckBookingStep = (currentStep: MetaWaStep) =>
  currentStep === 'awaiting_service'
  || currentStep === 'awaiting_date'
  || currentStep === 'awaiting_time'
  || currentStep === 'awaiting_confirmation'
  || currentStep === 'awaiting_name'
  || currentStep === 'post_booking';

// Turkish placeholder values ("-", "bilinmiyor") are treated as no last name at all so
// a booking never gets finalized with a name that only superficially looks provided.
export const hasValidLastName = (lastName?: string | null) => {
  const normalized = (lastName ?? '').trim().toLocaleLowerCase('tr-TR');
  return Boolean(normalized) && !['-', 'unknown', 'bilinmiyor'].includes(normalized);
};

export const isHumanHandoffRequest = (text: string) => {
  const n = normalizeSearchText(text);
  return [
    'temsilci', 'yetkili', 'operator', 'canli destek', 'personelle gorusmek',
    'resepsiyonla gorusmek', 'insanla gorusmek', 'beni arasin',
  ].some(p => n === p || n.includes(p));
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
  return prisma.appointmentType.findMany({
    where: { clinicId, isActive: true, isService: true },
    select: { id: true, name: true, durationMinutes: true },
    orderBy: { name: 'asc' },
  });
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
    pendingPatientOptions: Array.isArray(r.pendingPatientOptions)
      ? (r.pendingPatientOptions as Array<{ id: string; firstName: string; lastName: string }>)
      : undefined,
    selectedPatientId: typeof r.selectedPatientId === 'string' ? r.selectedPatientId : undefined,
    resumeAfterChannelConsent: typeof r.resumeAfterChannelConsent === 'string' ? r.resumeAfterChannelConsent : undefined,
    lastBookingSummary:
      r.lastBookingSummary && typeof r.lastBookingSummary === 'object' && !Array.isArray(r.lastBookingSummary)
        ? (r.lastBookingSummary as MetaWaBookingSummary)
        : undefined,
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

const findPatientsByPhone = async (
  clinicId: string,
  phone: string,
): Promise<Array<{ id: string; firstName: string; lastName: string; phone: string | null }>> => {
  const digits = normalizePhoneDigits(phone);
  const variants = getPhoneVariants(digits);
  if (variants.length === 0) return [];

  // Fast path: exact digit-variant match (patients stored as digit-only strings)
  const exactMatches = await prisma.patient.findMany({
    where: { clinicId, phone: { in: variants }, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
  if (exactMatches.length > 0) return exactMatches;

  // Slow path: patients stored with formatting (+90 532 111 11 11) won't appear in `in` query.
  // Load all and compare via variant overlap so both storage formats match.
  const variantSet = new Set(variants);
  const candidates = await prisma.patient.findMany({
    where: { clinicId, phone: { not: null }, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
  return candidates.filter(c => {
    if (!c.phone) return false;
    const cDigits = normalizePhoneDigits(c.phone);
    return getPhoneVariants(cDigits).some(v => variantSet.has(v));
  });
};

const findExistingPatientByPhone = async (
  clinicId: string,
  phone: string,
): Promise<{ id: string; firstName: string; lastName: string; phone: string | null } | null> => {
  const matches = await findPatientsByPhone(clinicId, phone);
  // Multiple patients can share the same phone (e.g. family/guardian). Return null when
  // ambiguous so we never auto-link a message to the wrong patient.
  return matches.length === 1 ? matches[0] : null;
};

// ── Patient identity resolution / creation ───────────────────────────────────

/**
 * Links a provided full name to an existing patient on this phone, or creates a new
 * Patient record. Never guesses across a shared phone with multiple patients unless
 * the provided name exactly matches one of them — mirrors the Evolution WhatsApp
 * pattern in routes/whatsapp.ts (ensureWhatsAppContactPatient) for provider parity.
 * Returns null when providedName does not contain a valid first+last name — callers
 * must not create an AppointmentRequest without a resolved patient in that case.
 */
const ensureMetaWaContactPatient = async (
  clinic: MetaWaClinic,
  phone: string,
  providedName: string,
): Promise<{ id: string; firstName: string; lastName: string } | null> => {
  const parsedName = providedName.trim() ? splitNameForPatient(providedName) : null;
  if (!parsedName || !parsedName.firstName || !hasValidLastName(parsedName.lastName)) {
    return null;
  }

  const allMatches = await findPatientsByPhone(clinic.id, phone);
  if (allMatches.length === 1) {
    const existing = allMatches[0];
    if (!existing.firstName.trim() || !hasValidLastName(existing.lastName)) {
      return prisma.patient.update({
        where: { id: existing.id },
        data: { firstName: parsedName.firstName, lastName: parsedName.lastName },
        select: { id: true, firstName: true, lastName: true },
      });
    }
    return existing;
  }
  if (allMatches.length > 1) {
    const first = parsedName.firstName.toLocaleLowerCase('tr-TR');
    const last = parsedName.lastName.toLocaleLowerCase('tr-TR');
    return allMatches.find(
      p => p.firstName.toLocaleLowerCase('tr-TR') === first && p.lastName.toLocaleLowerCase('tr-TR') === last,
    ) ?? null; // ambiguous shared phone with no name match — never create a duplicate/guess
  }

  const patient = await prisma.patient.create({
    data: {
      clinicId: clinic.id,
      organizationId: clinic.organizationId,
      firstName: parsedName.firstName,
      lastName: parsedName.lastName,
      phone: normalizePhoneDigits(phone) || phone,
      source: 'meta_whatsapp',
      patientStatus: 'new',
      communicationConsent: false,
      notes: 'Meta WhatsApp üzerinden ilk temas sonrası oluşturuldu.',
    },
    select: { id: true, firstName: true, lastName: true },
  });

  await backfillConversationMessagePatient({ clinicId: clinic.id, phone, patientId: patient.id })
    .catch(error => console.error('[meta-wa-assistant] conversation message backfill failed', error));

  const systemUserId = await getClinicSystemUserId(clinic.id);
  if (systemUserId) {
    await logActivity({
      clinicId: clinic.id,
      userId: systemUserId,
      entityType: 'patient',
      entityId: patient.id,
      action: 'created',
      description: 'Patient automatically created from first Meta WhatsApp contact',
      patientId: patient.id,
      metadata: { systemGenerated: true, source: 'meta_whatsapp', phone: summarizeId(phone) },
    });
  }

  return patient;
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
  const normalizedPhone = normalizePhoneDigits(args.phone) || args.phone;
  const contactRequest = await upsertContactRequest({
    clinicId: args.clinic.id,
    channel: 'meta_whatsapp',
    externalSenderId: normalizedPhone,
    patientId: args.patientId ?? null,
    phone: normalizedPhone,
    name: args.customerName ?? 'WhatsApp Kullanicisi',
    type: 'staff_handoff',
    note: `Meta WhatsApp uzerinden yetkili talebi alindi.\nIlk mesaj: ${args.text}`.slice(0, 2000),
    lastMessage: args.text.slice(0, 500),
    sourceConversationId: normalizedPhone,
  });

  await upsertMetaWaState(args.clinic.id, args.conversationKey, {
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
  clinic: MetaWaClinic;
  conversationKey: string;
  stateJson: MetaWaStateJson;
  customerName: string | null;
  text: string;
}): Promise<string> => {
  const note = args.text.trim();
  if (args.stateJson.pendingHandoffRequestId) {
    await prisma.contactRequest.updateMany({
      where: { id: args.stateJson.pendingHandoffRequestId, clinicId: args.clinic.id },
      data: {
        note: `Meta WhatsApp uzerinden yetkili talebi alindi.\nKullanici notu: ${note}`.slice(0, 2000),
        lastMessage: note.slice(0, 500),
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

// ── Channel consent gate: flow-resume helpers ──────────────────────────────────

// Steps that represent an in-progress booking/selection flow. If channel consent is
// required while the conversation is on one of these steps, we must not discard the
// flow — we stash it in resumeAfterChannelConsent and restore it once consent is settled.
export const CONSENT_RESUMABLE_STEPS: MetaWaStep[] = [
  'awaiting_service',
  'awaiting_date',
  'awaiting_time',
  'awaiting_confirmation',
  'awaiting_name',
  'awaiting_patient_selection',
];

export const isConsentResumableStep = (step: string | null | undefined): step is MetaWaStep =>
  Boolean(step) && CONSENT_RESUMABLE_STEPS.includes(step as MetaWaStep);

// Builds the message shown right after consent is accepted mid-flow. Never replays the
// message that triggered the consent prompt (it was never processed) — instead it re-asks
// for whatever the interrupted step was waiting on, using already-confirmed prior context.
export const buildConsentResumeMessage = (
  step: MetaWaStep,
  ctx: {
    services: MetaWaService[];
    selectedAppointmentTypeName?: string | null;
    selectedDate?: string | null;
    stateJson: MetaWaStateJson;
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
      return `${prefix} Randevu talebinizi oluşturabilmem için adınızı ve soyadınızı paylaşır mısınız?`;
    case 'awaiting_patient_selection': {
      const options = ctx.stateJson.pendingPatientOptions ?? [];
      if (options.length > 0) {
        const list = options.map((p, i) => `${i + 1}. ${p.firstName} ${p.lastName}`).join('\n');
        return `${prefix} Bu numarayla birden fazla hasta kaydı bulunuyor. Randevu hangi hasta için?\n\n${list}\n\nLütfen numarayı girin (örneğin: 1)`;
      }
      return CONSENT_ACCEPTED_TEXT;
    }
    default:
      return CONSENT_ACCEPTED_TEXT;
  }
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

  // Stored name from a prior turn (before this message resolves anything new) — used
  // only to disambiguate a shared phone below, not as the final customerName.
  const storedCustomerName = state?.customerName ?? null;

  // Resolve patient for shared-phone scenarios.
  // If staff already linked a patient via inbox, use that. Otherwise look up by phone and
  // try to identify the correct patient via a previously stored customerName.
  const metaMatchingPatients = args.inboxEntry?.patient
    ? [args.inboxEntry.patient]
    : await findPatientsByPhone(args.clinic.id, args.phone);
  let resolvedPatient: typeof metaMatchingPatients[0] | null = args.inboxEntry?.patient ?? null;
  if (!resolvedPatient) {
    if (metaMatchingPatients.length === 1) {
      resolvedPatient = metaMatchingPatients[0];
    } else if (stateJson.selectedPatientId) {
      // Use the patient the user explicitly selected in a prior message.
      // Also handles phone-format mismatches where findPatientsByPhone returned empty.
      resolvedPatient = metaMatchingPatients.find(p => p.id === stateJson.selectedPatientId) ?? null;
      if (!resolvedPatient) {
        resolvedPatient = await prisma.patient.findFirst({
          where: { id: stateJson.selectedPatientId, clinicId: args.clinic.id, deletedAt: null },
          select: { id: true, firstName: true, lastName: true, phone: true },
        });
      }
    } else if (metaMatchingPatients.length > 1 && storedCustomerName) {
      const storedName = storedCustomerName.toLocaleLowerCase('tr-TR').trim();
      resolvedPatient =
        metaMatchingPatients.find(p => `${p.firstName} ${p.lastName}`.toLocaleLowerCase('tr-TR') === storedName) ?? null;
    }
  }

  // customerName: prefer a resolved patient record (existing patient found by phone,
  // whether or not staff has linked the inbox entry yet) so a returning patient is
  // greeted by name from their very first message, then fall back to whatever name
  // was stored in a prior conversation turn.
  const customerName =
    (args.inboxEntry?.patient
      ? `${args.inboxEntry.patient.firstName} ${args.inboxEntry.patient.lastName}`.trim()
      : null) ??
    (resolvedPatient ? `${resolvedPatient.firstName} ${resolvedPatient.lastName}`.trim() : null) ??
    storedCustomerName;

  logIdentityResolution({
    provider: 'meta',
    clinicId: args.clinic.id,
    phone: args.phone,
    matchCount: metaMatchingPatients.length,
    selectedPatientIdPresent: Boolean(resolvedPatient?.id ?? stateJson.selectedPatientId),
    needsNameCollection: !resolvedPatient && !customerName,
    action: resolvedPatient ? 'resolved_existing_patient' : metaMatchingPatients.length > 1 ? 'ambiguous_shared_phone' : 'no_patient_match',
  });

  // ── Channel consent gate ─────────────────────────────────────────────────
  if (currentStep === 'awaiting_channel_consent') {
    const reply = parseConsentReply(args.text);
    const meta = await loadConsentMetadata(args.clinic.id);
    const resumeStep = isConsentResumableStep(stateJson.resumeAfterChannelConsent) ? stateJson.resumeAfterChannelConsent : null;
    const { resumeAfterChannelConsent: _discardResume, ...resumedStateJson } = stateJson;
    const resumeAfterAccept = async () => {
      if (resumeStep) {
        await upsertMetaWaState(args.clinic.id, args.conversationKey, {
          customerName,
          step: resumeStep,
          currentIntent: state?.currentIntent ?? 'book_appointment',
          lastMessage: args.text,
          lastProviderMessageId: args.messageId ?? null,
          stateJson: resumedStateJson,
        });
        return buildConsentResumeMessage(resumeStep, {
          services, selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null, selectedDate, stateJson: resumedStateJson,
        });
      }
      await upsertMetaWaState(args.clinic.id, args.conversationKey, {
        customerName,
        step: null,
        currentIntent: null,
        lastMessage: args.text,
        lastProviderMessageId: args.messageId ?? null,
        stateJson: stateJson.selectedPatientId ? { selectedPatientId: stateJson.selectedPatientId } : null,
      });
      return CONSENT_ACCEPTED_TEXT;
    };
    if (reply === 'accepted' && meta) {
      await logChannelConsent({
        organizationId: args.clinic.organizationId,
        clinicId: args.clinic.id,
        channel: 'whatsapp',
        contactIdentifier: args.phone,
        status: 'accepted',
        consentTextVersion: meta.version,
        consentTextSnapshot: meta.consentSnapshot,
        privacyUrl: meta.privacyUrl,
        conversationId: args.conversationKey,
        sourceMessageId: args.messageId ?? null,
      });
      return resumeAfterAccept();
    }
    if (reply === 'declined' && meta) {
      await logChannelConsent({
        organizationId: args.clinic.organizationId,
        clinicId: args.clinic.id,
        channel: 'whatsapp',
        contactIdentifier: args.phone,
        status: 'declined',
        consentTextVersion: meta.version,
        consentTextSnapshot: meta.consentSnapshot,
        privacyUrl: meta.privacyUrl,
        conversationId: args.conversationKey,
        sourceMessageId: args.messageId ?? null,
      });
      await upsertMetaWaState(args.clinic.id, args.conversationKey, { customerName, step: null, currentIntent: null, lastMessage: args.text, lastProviderMessageId: args.messageId ?? null, stateJson: null });
      return CONSENT_DECLINED_TEXT;
    }
    const consentRecheck = await checkChannelConsent({ organizationId: args.clinic.organizationId, clinicId: args.clinic.id, channel: 'whatsapp', contactIdentifier: args.phone });
    if (consentRecheck.status === 'accepted') {
      return resumeAfterAccept();
    }
    if (consentRecheck.status === 'blocked_missing_legal_profile') return MISSING_LEGAL_PROFILE_BLOCK_TEXT;
    return consentRecheck.promptText ?? CONSENT_REPROMPT_TEXT;
  }

  const consentGateResult = await checkChannelConsent({
    organizationId: args.clinic.organizationId,
    clinicId: args.clinic.id,
    channel: 'whatsapp',
    contactIdentifier: args.phone,
  });
  if (consentGateResult.status === 'blocked_missing_legal_profile') {
    console.warn('[meta-wa-assistant] consent-gate blocked: missing legal profile', {
      clinicId: summarizeId(args.clinic.id),
      organizationId: args.clinic.organizationId,
    });
    return MISSING_LEGAL_PROFILE_BLOCK_TEXT;
  }
  if (consentGateResult.status === 'needs_consent' || consentGateResult.status === 'declined') {
    const isResumable = isConsentResumableStep(currentStep);
    await upsertMetaWaState(args.clinic.id, args.conversationKey, {
      customerName,
      step: 'awaiting_channel_consent',
      currentIntent: isResumable ? (state?.currentIntent ?? null) : null,
      lastMessage: args.text,
      lastProviderMessageId: args.messageId ?? null,
      stateJson: {
        ...stateJson,
        resumeAfterChannelConsent: isResumable ? currentStep : null,
      },
    });
    return consentGateResult.promptText;
  }
  // ── End consent gate ────────────────────────────────────────────────────

  // ── Patient selection step ────────────────────────────────────────────────
  if (currentStep === 'awaiting_patient_selection') {
    const pendingOptions = stateJson.pendingPatientOptions;
    if (pendingOptions && pendingOptions.length > 0) {
      let selectedPatient: typeof pendingOptions[0] | undefined;
      if (standaloneNumericSelection !== null && standaloneNumericSelection >= 1 && standaloneNumericSelection <= pendingOptions.length) {
        selectedPatient = pendingOptions[standaloneNumericSelection - 1];
      }
      if (!selectedPatient) {
        const q = args.text.trim().toLocaleLowerCase('tr-TR');
        selectedPatient = pendingOptions.find(p => {
          const full = `${p.firstName} ${p.lastName}`.toLocaleLowerCase('tr-TR');
          return full.includes(q) || q.includes(p.firstName.toLocaleLowerCase('tr-TR'));
        });
      }
      if (selectedPatient) {
        await upsertMetaWaState(args.clinic.id, args.conversationKey, {
          customerName: `${selectedPatient.firstName} ${selectedPatient.lastName}`.trim(),
          step: null,
          currentIntent: null,
          lastMessage: args.text,
          lastProviderMessageId: args.messageId ?? null,
          stateJson: { selectedPatientId: selectedPatient.id },
        });
        return formatMainMenu(args.clinic.name, `${selectedPatient.firstName} ${selectedPatient.lastName}`.trim());
      }
      const patientList = pendingOptions.map((p, i) => `${i + 1}. ${p.firstName} ${p.lastName}`).join('\n');
      return `Geçerli bir seçim yapılamadı. Lütfen listedeki numarayı girin:\n\n${patientList}`;
    }
  }

  // When multiple patients share this phone and none is identified, ask user to select.
  if (metaMatchingPatients.length > 1 && !resolvedPatient && currentStep !== 'awaiting_patient_selection') {
    const patientList = metaMatchingPatients.map((p, i) => `${i + 1}. ${p.firstName} ${p.lastName}`).join('\n');
    await upsertMetaWaState(args.clinic.id, args.conversationKey, {
      customerName,
      step: 'awaiting_patient_selection',
      currentIntent: null,
      lastMessage: args.text,
      lastProviderMessageId: args.messageId ?? null,
      stateJson: {
        pendingPatientOptions: metaMatchingPatients.map(p => ({ id: p.id, firstName: p.firstName, lastName: p.lastName })),
      },
    });
    return `Bu numarayla birden fazla hasta kaydı bulunuyor. Randevu hangi hasta için?\n\n${patientList}\n\nLütfen numarayı girin (örneğin: 1)`;
  }

  // ── Human handoff escape from a stuck booking step ──────────────────────────
  if (isStuckBookingStep(currentStep) && isHumanHandoffRequest(args.text)) {
    logWhatsAppAgentDecision({
      provider: 'meta',
      clinicId: args.clinic.id,
      phone: args.phone,
      currentStep,
      deterministicMatched: true,
      nluUsed: false,
      detectedIntent: 'human_handoff',
      confidence: 1,
      responseType: 'human_handoff',
    });
    return createHandoffRequest({
      clinic: args.clinic,
      inboxEntryId: args.inboxEntry?.id ?? null,
      connectionId: args.connectionId,
      phone: args.phone,
      customerName,
      text: args.text,
      conversationKey: args.conversationKey,
      patientId: resolvedPatient?.id ?? stateJson.selectedPatientId ?? null,
    });
  }

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
    logWhatsAppAgentDecision({
      provider: 'meta',
      clinicId: args.clinic.id,
      phone: args.phone,
      currentStep,
      deterministicMatched: true,
      nluUsed: false,
      detectedIntent: 'main_menu_reset',
      confidence: 1,
      responseType: 'main_menu',
    });
    return formatMainMenu(args.clinic.name, customerName);
  }

  // ── Greeting at top-level (including a stale awaiting_service state) ───────
  if ((!currentStep || currentStep === 'main_menu' || currentStep === 'awaiting_service') && isGreeting(args.text)) {
    await upsertMetaWaState(args.clinic.id, args.conversationKey, {
      customerName,
      currentIntent: null,
      step: 'main_menu',
      lastMessage: args.text,
      lastProviderMessageId: args.messageId ?? null,
      stateJson: null,
    });
    logWhatsAppAgentDecision({
      provider: 'meta',
      clinicId: args.clinic.id,
      phone: args.phone,
      currentStep,
      deterministicMatched: true,
      nluUsed: false,
      detectedIntent: 'greeting',
      confidence: 1,
      responseType: 'main_menu',
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
      if (services.length === 0) {
        await upsertMetaWaState(args.clinic.id, args.conversationKey, {
          customerName,
          currentIntent: null,
          step: null,
          lastMessage: args.text,
          lastProviderMessageId: args.messageId ?? null,
          stateJson: null,
        });
        return NO_ACTIVE_SERVICES_TEXT;
      }
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
    if (standaloneNumericSelection === 4) return services.length > 0 ? formatServiceList(services) : NO_ACTIVE_SERVICES_TEXT;
  }

  // ── Create appointment callback (reused by time + confirmation steps) ──────
  // Requires a real name by this point (the confirmation/name step never calls this
  // with an empty name) — no "WhatsApp Kullanicisi" placeholder is ever written to a
  // real booking's AppointmentRequest.
  const sharedCreateAppointment = async (
    _clinicId: string,
    _phone: string,
    name: string,
    appointmentTypeId: string,
    selectedSlot: SavedAvailableSlot,
    rawMessage?: string | null,
  ) => {
    let patientId =
      args.inboxEntry?.patientId ??
      args.patientId ??
      resolvedPatient?.id ??
      stateJson.selectedPatientId ??
      null;

    if (!patientId) {
      const patient = await ensureMetaWaContactPatient(args.clinic, args.phone, name);
      if (!patient) throw new Error('PATIENT_LAST_NAME_REQUIRED');
      patientId = patient.id;

      if (args.inboxEntry && !args.inboxEntry.patientId) {
        await prisma.whatsAppInboxEntry.update({
          where: { id: args.inboxEntry.id },
          data: { patientId },
        }).catch(error => console.error('[meta-wa-assistant] inbox patientId link failed', error));
      }

      logIdentityResolution({
        provider: 'meta',
        clinicId: args.clinic.id,
        phone: args.phone,
        matchCount: 1,
        selectedPatientIdPresent: true,
        needsNameCollection: false,
        action: 'patient_created_or_linked_at_booking',
      });
    }

    const request = await createMetaWaAppointmentRequest({
      clinic: args.clinic,
      inboxEntryId: args.inboxEntry?.id ?? null,
      connectionId: args.connectionId,
      phone: args.phone,
      customerName: name,
      patientId,
      appointmentTypeId,
      selectedSlot,
      rawMessage,
    });
    return { appointmentType: request.appointmentType ?? null };
  };

  // ── Booking step: awaiting_service ────────────────────────────────────────
  if (currentStep === 'awaiting_service') {
    if (services.length === 0) {
      await resetMetaWaState(args.clinic.id, args.conversationKey, customerName);
      return NO_ACTIVE_SERVICES_TEXT;
    }

    // Deterministic parser (numeric selection / list-resend / substring match) runs
    // first. Only when NONE of those can resolve the message do we escalate to the
    // step-aware semantic layer — this keeps high-confidence structured inputs fast
    // and free of any AI dependency (required-behavior rule #1/#2/#9).
    const willResolveDeterministically =
      isServiceListRequest(args.text)
      || extractNumericSelection(args.text) !== null
      || findServiceMatches(args.text, services).length > 0;

    if (!willResolveDeterministically) {
      const { decision: nluDecision, source: nluSource } = await resolveStepAwareWhatsAppIntent({
        clinicId: args.clinic.id,
        phone: args.phone,
        currentStep: 'awaiting_service',
        currentIntent: state?.currentIntent ?? null,
        lastMessage: state?.lastMessage ?? null,
        userText: args.text,
        availableServices: services,
        selectedService: state?.selectedAppointmentTypeName ?? null,
        selectedDate: nextSelectedDate,
        selectedTime: nextSelectedTime,
      });

      logWhatsAppAgentDecision({
        provider: 'meta',
        clinicId: args.clinic.id,
        phone: args.phone,
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
          await upsertMetaWaState(args.clinic.id, args.conversationKey, {
            customerName,
            currentIntent: 'book_appointment',
            step: 'awaiting_date',
            selectedAppointmentTypeId: matchedService.id,
            selectedAppointmentTypeName: matchedService.name,
            selectedDate: nextSelectedDate ?? null,
            selectedTime: nextSelectedTime ?? null,
            lastMessage: args.text,
            lastProviderMessageId: args.messageId ?? null,
            stateJson: stateJson.selectedPatientId ? { selectedPatientId: stateJson.selectedPatientId } : null,
          });
          return `${matchedService.name} hizmetini seçtiniz. Hangi gün için randevu istersiniz? Örneğin bugün, yarın, 16.05 veya 16 Mayıs yazabilirsiniz.`;
        }
      }

      if (nluDecision.intent === 'ask_service_price_or_duration' && nluDecision.confidence >= 0.5) {
        return [
          'Fiyat bilgisini bu kanaldan net olarak paylaşamıyorum, ancak hizmet süreleri şöyle:',
          ...services.map((s, i) => `${i + 1}. ${s.name} (${s.durationMinutes} dk)`),
          '',
          'Randevu oluşturmak için lütfen hizmet numarasını yazın.',
        ].join('\n');
      }
      // repeat_service_list / cannot_choose_service / unknown / low confidence:
      // fall through to the deterministic handler below, whose fallback already
      // includes the full numbered service list plus a clear instruction.
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
      upsertState: data =>
        upsertMetaWaState(args.clinic.id, args.conversationKey, {
          ...(stateJson.selectedPatientId
            ? { ...data, stateJson: { ...(data.stateJson ?? {}), selectedPatientId: stateJson.selectedPatientId } }
            : data),
          lastProviderMessageId: args.messageId ?? null,
        }),
    });

    logWhatsAppAgentDecision({
      provider: 'meta',
      clinicId: args.clinic.id,
      phone: args.phone,
      currentStep,
      deterministicMatched: true,
      nluUsed: false,
      detectedIntent: 'book_appointment',
      confidence: 1,
      responseType: 'awaiting_service',
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

    // If date was already provided in the initial message, jump straight to time slots.
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
        const savedSlots = saveSlotsForState(slots);
        const shownSlots = savedSlots.slice(0, 5);
        await upsertMetaWaState(args.clinic.id, args.conversationKey, {
          customerName,
          currentIntent: 'book_appointment',
          step: 'awaiting_time',
          selectedAppointmentTypeId: stateAfterService.selectedAppointmentTypeId,
          selectedAppointmentTypeName: stateAfterService.selectedAppointmentTypeName ?? null,
          selectedDate: nextSelectedDate,
          selectedTime: null,
          lastMessage: args.text,
          lastProviderMessageId: args.messageId ?? null,
          stateJson: { availableSlots: savedSlots, lastShownSlots: shownSlots, ...(stateJson.selectedPatientId ? { selectedPatientId: stateJson.selectedPatientId } : {}) },
        });
        return formatAvailabilityMessage(nextSelectedDate, shownSlots);
      }
      if (slots !== null) {
        // slots === [] means no availability on the requested date — stay at awaiting_date.
        return `${stateAfterService.selectedAppointmentTypeName ?? 'Seçtiğiniz hizmet'} için ${formatTurkishDateWithWeekday(nextSelectedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} tarihinde uygun saat görünmüyor. Başka bir gün kontrol etmek ister misiniz?`;
      }
    }

    return serviceReply;
  }

  // ── Booking step: awaiting_date ───────────────────────────────────────────
  if (currentStep === 'awaiting_date') {
    // extractedDateFromInput already ran normalizeDateFromTurkishInput + AI date
    // normalization for every message at the top of this function — if that (or a
    // pending past-date clarification reply) found nothing, the deterministic date
    // handler below would only produce a generic "Tarihi anlayamadım" fallback.
    // Escalate to the step-aware layer first so we can offer something more useful
    // (e.g. redirect a "hizmeti değiştirmek istiyorum" back to service selection).
    const dateWillResolveDeterministically = Boolean(extractedDateFromInput) || Boolean(stateJson.pendingPastDateClarification);
    if (!dateWillResolveDeterministically) {
      const { decision: nluDecision, source: nluSource } = await resolveStepAwareWhatsAppIntent({
        clinicId: args.clinic.id,
        phone: args.phone,
        currentStep: 'awaiting_date',
        currentIntent: state?.currentIntent ?? null,
        lastMessage: state?.lastMessage ?? null,
        userText: args.text,
        availableServices: services,
        selectedService: state?.selectedAppointmentTypeName ?? null,
        selectedDate: nextSelectedDate,
        selectedTime: nextSelectedTime,
      });

      logWhatsAppAgentDecision({
        provider: 'meta',
        clinicId: args.clinic.id,
        phone: args.phone,
        currentStep,
        deterministicMatched: false,
        nluUsed: nluSource !== 'unavailable',
        detectedIntent: nluDecision.intent,
        confidence: nluDecision.confidence,
        responseType: 'awaiting_date_nlu',
      });

      if (nluDecision.intent === 'change_service' && nluDecision.confidence >= 0.5) {
        await upsertMetaWaState(args.clinic.id, args.conversationKey, {
          customerName,
          currentIntent: 'book_appointment',
          step: 'awaiting_service',
          selectedAppointmentTypeId: null,
          selectedAppointmentTypeName: null,
          selectedDate: null,
          selectedTime: null,
          lastMessage: args.text,
          lastProviderMessageId: args.messageId ?? null,
          stateJson: stateJson.selectedPatientId ? { selectedPatientId: stateJson.selectedPatientId } : null,
        });
        return services.length > 0 ? formatServiceList(services) : NO_ACTIVE_SERVICES_TEXT;
      }

      if (nluDecision.intent === 'ask_available_dates' && nluDecision.confidence >= 0.5) {
        return `${state?.selectedAppointmentTypeName ?? 'Seçtiğiniz hizmet'} için hangi günü kontrol etmemi istersiniz? Örneğin bugün, yarın, cuma veya 16 Mayıs yazabilirsiniz.`;
      }
      // provide_date / repeat_service_list / unknown_date_request / low confidence:
      // fall through to the deterministic handler, whose own fallback is already
      // contextual ("Tarihi anlayamadım. Örneğin bugün, yarın, ...").
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
        selectedDate: state?.selectedDate,
      },
      stateJson,
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
          ...(stateJson.selectedPatientId
            ? { ...data, stateJson: { ...(data.stateJson ?? {}), selectedPatientId: stateJson.selectedPatientId } }
            : data),
          lastProviderMessageId: args.messageId ?? null,
        }),
    });
  }

  // ── Booking step: awaiting_time ───────────────────────────────────────────
  if (currentStep === 'awaiting_time') {
    const timeInterpretation = interpretTimeRequest(args.text);
    const timeWillResolveDeterministically =
      extractNumericSelection(args.text) !== null
      || timeInterpretation.exactTime !== null
      || timeInterpretation.afterTimeMinutes !== null
      || timeInterpretation.rangeStartMinutes !== null
      || Boolean(timeInterpretation.preference)
      || timeInterpretation.wantsMoreOptions
      || timeInterpretation.wantsDifferentDate
      || Boolean(normalizeDateFromTurkishInput(args.text, new Date(), args.clinic.timezone || WHATSAPP_ASSISTANT_TIME_ZONE))
      || findSlotMatches(args.text, stateJson.availableSlots ?? []).matches.length > 0;

    if (!timeWillResolveDeterministically) {
      const { decision: nluDecision, source: nluSource } = await resolveStepAwareWhatsAppIntent({
        clinicId: args.clinic.id,
        phone: args.phone,
        currentStep: 'awaiting_time',
        currentIntent: state?.currentIntent ?? null,
        lastMessage: state?.lastMessage ?? null,
        userText: args.text,
        availableServices: services,
        selectedService: state?.selectedAppointmentTypeName ?? null,
        selectedDate: state?.selectedDate ?? null,
        selectedTime: null,
      });

      logWhatsAppAgentDecision({
        provider: 'meta',
        clinicId: args.clinic.id,
        phone: args.phone,
        currentStep,
        deterministicMatched: false,
        nluUsed: nluSource !== 'unavailable',
        detectedIntent: nluDecision.intent,
        confidence: nluDecision.confidence,
        responseType: 'awaiting_time_nlu',
      });

      if (nluDecision.intent === 'change_date' && nluDecision.confidence >= 0.5) {
        await upsertMetaWaState(args.clinic.id, args.conversationKey, {
          customerName,
          currentIntent: 'book_appointment',
          step: 'awaiting_date',
          selectedAppointmentTypeId: state?.selectedAppointmentTypeId,
          selectedAppointmentTypeName: state?.selectedAppointmentTypeName,
          selectedDate: null,
          selectedTime: null,
          lastMessage: args.text,
          lastProviderMessageId: args.messageId ?? null,
          stateJson: stateJson.selectedPatientId ? { selectedPatientId: stateJson.selectedPatientId } : null,
        });
        return 'Elbette, hangi gün için randevu istersiniz?';
      }

      if (nluDecision.intent === 'change_service' && nluDecision.confidence >= 0.5) {
        await upsertMetaWaState(args.clinic.id, args.conversationKey, {
          customerName,
          currentIntent: 'book_appointment',
          step: 'awaiting_service',
          selectedAppointmentTypeId: null,
          selectedAppointmentTypeName: null,
          selectedDate: null,
          selectedTime: null,
          lastMessage: args.text,
          lastProviderMessageId: args.messageId ?? null,
          stateJson: stateJson.selectedPatientId ? { selectedPatientId: stateJson.selectedPatientId } : null,
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
          ...(stateJson.selectedPatientId
            ? { ...data, stateJson: { ...(data.stateJson ?? {}), selectedPatientId: stateJson.selectedPatientId } }
            : data),
          lastProviderMessageId: args.messageId ?? null,
        }),
      resetState: nextCustomerName =>
        resetMetaWaState(args.clinic.id, args.conversationKey, nextCustomerName),
      createAppointment: sharedCreateAppointment,
    });
  }

  // ── Shared-phone confirmation safety guard ──────────────────────────────────
  // Catches stale awaiting_confirmation state (pre-hotfix) where selectedPatientId
  // was never stored but multiple patients share the sender phone.
  if (currentStep === 'awaiting_confirmation' && metaMatchingPatients.length > 1) {
    const confirmedId = stateJson.selectedPatientId ?? null;
    const idValid = !!confirmedId && metaMatchingPatients.some(p => p.id === confirmedId);
    if (!idValid) {
      const storedName = customerName?.toLocaleLowerCase('tr-TR').trim() ?? '';
      const nameMatch = storedName
        ? metaMatchingPatients.find(p =>
            `${p.firstName} ${p.lastName}`.toLocaleLowerCase('tr-TR') === storedName)
        : null;
      if (nameMatch) {
        stateJson.selectedPatientId = nameMatch.id;
        console.log('[meta-wa-confirmation] shared-phone-guard', {
          clinicId: args.clinic.id, phoneSuffix: args.conversationKey.slice(-4), currentStep,
          matchedPatientCount: metaMatchingPatients.length, branch: 'proceed_name_match',
        });
      } else {
        const patientList = metaMatchingPatients.map((p, i) => `${i + 1}. ${p.firstName} ${p.lastName}`).join('\n');
        await upsertMetaWaState(args.clinic.id, args.conversationKey, {
          customerName: customerName ?? null,
          step: 'awaiting_patient_selection',
          currentIntent: null,
          lastMessage: args.text,
          lastProviderMessageId: args.messageId ?? null,
          stateJson: {
            availableSlots: stateJson.availableSlots,
            lastShownSlots: stateJson.lastShownSlots,
            pendingConfirmationSlot: stateJson.pendingConfirmationSlot,
            pendingPatientOptions: metaMatchingPatients.map(p => ({ id: p.id, firstName: p.firstName, lastName: p.lastName })),
          },
        });
        console.log('[meta-wa-confirmation] shared-phone-guard', {
          clinicId: args.clinic.id, phoneSuffix: args.conversationKey.slice(-4), currentStep,
          matchedPatientCount: metaMatchingPatients.length, branch: 'ask_selection',
        });
        return `Bu numarayla birden fazla hasta kaydı bulunuyor. Randevu hangi hasta için?\n\n${patientList}\n\nLütfen numarayı girin (örneğin: 1)`;
      }
    } else {
      console.log('[meta-wa-confirmation] shared-phone-guard', {
        clinicId: args.clinic.id, phoneSuffix: args.conversationKey.slice(-4), currentStep,
        matchedPatientCount: metaMatchingPatients.length, branch: 'proceed_selected_patient',
      });
    }
  }

  // ── Booking step: awaiting_confirmation ───────────────────────────────────
  if (currentStep === 'awaiting_confirmation') {
    // Explicit approve/reject ("evet", "hayır", "1", "👍", ...) is deterministic and
    // must never be reinterpreted. Anything else at this step (e.g. "saat 15 daha iyi
    // olur") is a change request or an ambiguous reply, not a confirmation — treating
    // it as one would silently book the wrong slot.
    if (!isDeterministicConfirmationReply(args.text)) {
      const pendingSlot = stateJson.pendingConfirmationSlot ?? null;
      const availableSlots = stateJson.availableSlots ?? [];
      const lastShownSlots = stateJson.lastShownSlots ?? [];
      const deterministicNewTime = interpretTimeRequest(args.text).exactTime;

      if (deterministicNewTime && pendingSlot) {
        logWhatsAppAgentDecision({
          provider: 'meta',
          clinicId: args.clinic.id,
          phone: args.phone,
          currentStep,
          deterministicMatched: true,
          nluUsed: false,
          detectedIntent: 'change_time',
          confidence: 1,
          responseType: 'awaiting_confirmation_change_time',
        });

        const matchingSlot = availableSlots.find(slot => slot.localStartTime === deterministicNewTime) ?? null;
        if (matchingSlot) {
          await upsertMetaWaState(args.clinic.id, args.conversationKey, {
            customerName,
            currentIntent: 'book_appointment',
            step: 'awaiting_confirmation',
            selectedAppointmentTypeId: state?.selectedAppointmentTypeId,
            selectedAppointmentTypeName: state?.selectedAppointmentTypeName,
            selectedPractitionerId: matchingSlot.practitionerId,
            selectedDate: state?.selectedDate,
            selectedTime: matchingSlot.localStartTime,
            lastMessage: args.text,
            lastProviderMessageId: args.messageId ?? null,
            stateJson: {
              ...(stateJson.selectedPatientId ? { selectedPatientId: stateJson.selectedPatientId } : {}),
              availableSlots,
              lastShownSlots,
              pendingConfirmationSlot: matchingSlot,
            },
          });
          return `${formatTurkishDateLong(state!.selectedDate!, WHATSAPP_ASSISTANT_TIME_ZONE)} tarihinde saat ${matchingSlot.localStartTime} için ${matchingSlot.practitionerName} uygun görünüyor. Bu saat için randevu talebinizi oluşturmamı onaylıyor musunuz?`;
        }

        // Requested time isn't directly available — hand off to the time step's
        // existing nearby-slot logic instead of silently rejecting the change.
        await upsertMetaWaState(args.clinic.id, args.conversationKey, {
          customerName,
          currentIntent: 'book_appointment',
          step: 'awaiting_time',
          selectedAppointmentTypeId: state?.selectedAppointmentTypeId,
          selectedAppointmentTypeName: state?.selectedAppointmentTypeName,
          selectedPractitionerId: null,
          selectedDate: state?.selectedDate,
          selectedTime: null,
          lastMessage: args.text,
          lastProviderMessageId: args.messageId ?? null,
          stateJson: {
            ...(stateJson.selectedPatientId ? { selectedPatientId: stateJson.selectedPatientId } : {}),
            availableSlots,
            lastShownSlots,
          },
        });
        return handleAwaitingTimeStep({
          prisma,
          clinicId: args.clinic.id,
          phone: args.conversationKey,
          text: args.text,
          customerName,
          state: {
            selectedAppointmentTypeId: state?.selectedAppointmentTypeId,
            selectedAppointmentTypeName: state?.selectedAppointmentTypeName,
            selectedPractitionerId: null,
            selectedDate: state?.selectedDate,
          },
          stateJson: { availableSlots, lastShownSlots },
          extractNumericSelection,
          findSlotMatches,
          formatAvailabilityMessage,
          minutesToTime,
          logAvailabilitySave: (total, shown) => console.debug('[meta-wa] slot-save', { total, shown }),
          interpretTimeWithAi: async messageText => {
            const interpreted = interpretTimeRequest(messageText);
            return {
              exactTime: interpreted.exactTime,
              afterTime: interpreted.afterTimeMinutes !== null ? minutesToTime(interpreted.afterTimeMinutes) : null,
              timePreference: interpreted.preference,
            };
          },
          upsertState: data =>
            upsertMetaWaState(args.clinic.id, args.conversationKey, {
              ...(stateJson.selectedPatientId
                ? { ...data, stateJson: { ...(data.stateJson ?? {}), selectedPatientId: stateJson.selectedPatientId } }
                : data),
              lastProviderMessageId: args.messageId ?? null,
            }),
          resetState: nextCustomerName => resetMetaWaState(args.clinic.id, args.conversationKey, nextCustomerName),
          createAppointment: sharedCreateAppointment,
        });
      }

      if (pendingSlot) {
        const { decision: nluDecision, source: nluSource } = await resolveStepAwareWhatsAppIntent({
          clinicId: args.clinic.id,
          phone: args.phone,
          currentStep: 'awaiting_confirmation',
          currentIntent: state?.currentIntent ?? null,
          lastMessage: state?.lastMessage ?? null,
          userText: args.text,
          availableServices: services,
          selectedService: state?.selectedAppointmentTypeName ?? null,
          selectedDate: state?.selectedDate ?? null,
          selectedTime: state?.selectedPractitionerId ? pendingSlot.localStartTime : null,
        });

        logWhatsAppAgentDecision({
          provider: 'meta',
          clinicId: args.clinic.id,
          phone: args.phone,
          currentStep,
          deterministicMatched: false,
          nluUsed: nluSource !== 'unavailable',
          detectedIntent: nluDecision.intent,
          confidence: nluDecision.confidence,
          responseType: 'awaiting_confirmation_nlu',
        });

        if (nluDecision.intent === 'change_date' && nluDecision.confidence >= 0.5) {
          await upsertMetaWaState(args.clinic.id, args.conversationKey, {
            customerName,
            currentIntent: 'book_appointment',
            step: 'awaiting_date',
            selectedAppointmentTypeId: state?.selectedAppointmentTypeId,
            selectedAppointmentTypeName: state?.selectedAppointmentTypeName,
            selectedDate: null,
            selectedTime: null,
            lastMessage: args.text,
            lastProviderMessageId: args.messageId ?? null,
            stateJson: stateJson.selectedPatientId ? { selectedPatientId: stateJson.selectedPatientId } : null,
          });
          return 'Elbette, hangi gün için randevu istersiniz?';
        }

        if (nluDecision.intent === 'change_service' && nluDecision.confidence >= 0.5) {
          await upsertMetaWaState(args.clinic.id, args.conversationKey, {
            customerName,
            currentIntent: 'book_appointment',
            step: 'awaiting_service',
            selectedAppointmentTypeId: null,
            selectedAppointmentTypeName: null,
            selectedDate: null,
            selectedTime: null,
            lastMessage: args.text,
            lastProviderMessageId: args.messageId ?? null,
            stateJson: stateJson.selectedPatientId ? { selectedPatientId: stateJson.selectedPatientId } : null,
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

    // After a successful booking, land on post_booking (not a full reset) so a
    // follow-up "teşekkürler" / "durumu nedir" gets a contextual reply instead of
    // falling through to the generic top-level fallback.
    const resetToPostBooking = (nextCustomerName?: string | null) =>
      upsertMetaWaState(args.clinic.id, args.conversationKey, {
        customerName: nextCustomerName ?? customerName ?? null,
        currentIntent: null,
        step: 'post_booking',
        selectedAppointmentTypeId: null,
        selectedAppointmentTypeName: null,
        selectedPractitionerId: null,
        selectedDate: null,
        selectedTime: null,
        stateJson: {
          lastBookingSummary: {
            serviceName: state?.selectedAppointmentTypeName ?? null,
            date: state?.selectedDate ?? null,
            time: stateJson.pendingConfirmationSlot?.localStartTime ?? null,
          },
          ...(stateJson.selectedPatientId ? { selectedPatientId: stateJson.selectedPatientId } : {}),
        },
      });

    return handleAwaitingConfirmationStep({
      clinicId: args.clinic.id,
      phone: args.conversationKey,
      text: args.text,
      // No placeholder fallback: a falsy customerName here must reach the
      // handler's own `!customerName` gate and route to awaiting_name — never
      // silently substitute "WhatsApp Kullanicisi" as if a name were provided.
      customerName,
      state: {
        selectedAppointmentTypeId: state?.selectedAppointmentTypeId,
        selectedAppointmentTypeName: state?.selectedAppointmentTypeName,
        selectedPractitionerId: state?.selectedPractitionerId,
        selectedDate: state?.selectedDate,
      },
      stateJson,
      resetState: resetToPostBooking,
      upsertState: data =>
        upsertMetaWaState(args.clinic.id, args.conversationKey, {
          ...(stateJson.selectedPatientId
            ? { ...data, stateJson: { ...(data.stateJson ?? {}), selectedPatientId: stateJson.selectedPatientId } }
            : data),
          lastProviderMessageId: args.messageId ?? null,
        }),
      createAppointment: sharedCreateAppointment,
    });
  }

  // ── Name collection (only reached from awaiting_confirmation when customerName
  // is missing) ──────────────────────────────────────────────────────────────
  if (currentStep === 'awaiting_name') {
    const parsedName = splitNameForPatient(args.text);
    if (!parsedName.firstName || !hasValidLastName(parsedName.lastName)) {
      const { decision: nluDecision, source: nluSource } = await resolveStepAwareWhatsAppIntent({
        clinicId: args.clinic.id,
        phone: args.phone,
        currentStep: 'awaiting_name',
        currentIntent: state?.currentIntent ?? null,
        lastMessage: state?.lastMessage ?? null,
        userText: args.text,
        availableServices: services,
        selectedService: state?.selectedAppointmentTypeName ?? null,
        selectedDate: state?.selectedDate ?? null,
        selectedTime: null,
      });
      logWhatsAppAgentDecision({
        provider: 'meta',
        clinicId: args.clinic.id,
        phone: args.phone,
        currentStep,
        deterministicMatched: false,
        nluUsed: nluSource !== 'unavailable',
        detectedIntent: nluDecision.intent,
        confidence: nluDecision.confidence,
        responseType: 'awaiting_name_nlu',
      });
      if (nluDecision.intent === 'ask_why_name_needed') {
        return 'Randevu talebinizi doğru şekilde kaydedebilmemiz ve klinik ekibinin size ulaşabilmesi için ad soyad bilgisine ihtiyacımız var.';
      }
      return 'Randevu talebinizi oluşturabilmem için lütfen ad ve soyadınızı birlikte yazar mısınız? (Örnek: Ayşe Yılmaz)';
    }

    logWhatsAppAgentDecision({
      provider: 'meta',
      clinicId: args.clinic.id,
      phone: args.phone,
      currentStep,
      deterministicMatched: true,
      nluUsed: false,
      detectedIntent: 'provide_name',
      confidence: 1,
      responseType: 'awaiting_name_provided',
    });

    const fullName = `${parsedName.firstName} ${parsedName.lastName}`.trim();
    const resetToPostBooking = (nextCustomerName?: string | null) =>
      upsertMetaWaState(args.clinic.id, args.conversationKey, {
        customerName: nextCustomerName ?? fullName,
        currentIntent: null,
        step: 'post_booking',
        selectedAppointmentTypeId: null,
        selectedAppointmentTypeName: null,
        selectedPractitionerId: null,
        selectedDate: null,
        selectedTime: null,
        stateJson: {
          lastBookingSummary: {
            serviceName: state?.selectedAppointmentTypeName ?? null,
            date: state?.selectedDate ?? null,
            time: stateJson.pendingConfirmationSlot?.localStartTime ?? null,
          },
          ...(stateJson.selectedPatientId ? { selectedPatientId: stateJson.selectedPatientId } : {}),
        },
      });

    // The user already answered "evet" before being asked for their name (see
    // handleAwaitingConfirmationStep's `!customerName` gate) — re-run that same
    // deterministic approval path now that a valid name exists, rather than
    // re-asking for confirmation a second time.
    return handleAwaitingConfirmationStep({
      clinicId: args.clinic.id,
      phone: args.conversationKey,
      text: 'evet',
      customerName: fullName,
      state: {
        selectedAppointmentTypeId: state?.selectedAppointmentTypeId,
        selectedAppointmentTypeName: state?.selectedAppointmentTypeName,
        selectedPractitionerId: state?.selectedPractitionerId,
        selectedDate: state?.selectedDate,
      },
      stateJson,
      resetState: resetToPostBooking,
      upsertState: data =>
        upsertMetaWaState(args.clinic.id, args.conversationKey, {
          ...(stateJson.selectedPatientId
            ? { ...data, stateJson: { ...(data.stateJson ?? {}), selectedPatientId: stateJson.selectedPatientId } }
            : data),
          lastProviderMessageId: args.messageId ?? null,
        }),
      createAppointment: sharedCreateAppointment,
    });
  }

  // ── Post-booking follow-up (gratitude/closing/status/change/cancel) ────────
  if (currentStep === 'post_booking') {
    const { decision: nluDecision, source: nluSource } = await resolveStepAwareWhatsAppIntent({
      clinicId: args.clinic.id,
      phone: args.phone,
      currentStep: 'post_booking',
      currentIntent: state?.currentIntent ?? null,
      lastMessage: state?.lastMessage ?? null,
      userText: args.text,
      availableServices: services,
      selectedService: null,
      selectedDate: null,
      selectedTime: null,
    });

    logWhatsAppAgentDecision({
      provider: 'meta',
      clinicId: args.clinic.id,
      phone: args.phone,
      currentStep,
      deterministicMatched: false,
      nluUsed: nluSource !== 'unavailable',
      detectedIntent: nluDecision.intent,
      confidence: nluDecision.confidence,
      responseType: 'post_booking_nlu',
    });
    logPostBookingDecision({
      provider: 'meta',
      clinicId: args.clinic.id,
      phone: args.phone,
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
        inboxEntryId: args.inboxEntry?.id ?? null,
        connectionId: args.connectionId,
        phone: args.phone,
        customerName,
        text: args.text,
        conversationKey: args.conversationKey,
        patientId: resolvedPatient?.id ?? stateJson.selectedPatientId ?? null,
      });
    }
    return 'Randevu talebinizin durumunu sorabilir, saat veya tarih değişikliği isteyebilir, iptal talep edebilir ya da yetkili biriyle görüşmek isteyebilirsiniz. Nasıl yardımcı olabilirim?';
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
    recentMessages: sanitizeAiMessageHistory(
      recentState?.lastMessage
        ? [{ direction: 'incoming' as const, text: recentState.lastMessage }]
        : [],
    ),
    clinicFacts,
  });

  console.debug('[meta-wa-assistant] agent decision', {
    clinicId: summarizeId(args.clinic.id),
    agentSource,
    action: decision?.action ?? null,
    intent: decision?.intent ?? null,
  });

  logWhatsAppAgentDecision({
    provider: 'meta',
    clinicId: args.clinic.id,
    phone: args.phone,
    currentStep,
    deterministicMatched: false,
    nluUsed: agentSource !== 'unavailable',
    detectedIntent: decision?.intent ?? 'unknown',
    confidence: decision?.confidence ?? 0,
    responseType: decision?.action ?? 'unresolved',
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
    return services.length > 0 ? formatServiceList(services) : NO_ACTIVE_SERVICES_TEXT;
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
    // AI may have extracted the customer's name from the initial message (e.g. "adım Faruk Duman").
    // Prefer existing linked-patient name, then stored state name, then AI-extracted name.
    const resolvedCustomerName = customerName ?? decision.slots.name ?? null;
    if (services.length === 0) {
      await resetMetaWaState(args.clinic.id, args.conversationKey, resolvedCustomerName);
      return NO_ACTIVE_SERVICES_TEXT;
    }
    await upsertMetaWaState(args.clinic.id, args.conversationKey, {
      customerName: resolvedCustomerName,
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

  // Persist the inbound message before any AI processing so history survives
  // reply failures. patientId stays null for unresolved/ambiguous senders and
  // is backfilled when staff links the inbox entry to a patient.
  const resolvedPatientId = inboxEntry?.patientId ?? existingPatient?.id ?? null;
  try {
    await persistWhatsAppConversationMessage({
      clinicId: clinic.id,
      patientId: resolvedPatientId,
      phone: args.phone,
      direction: 'incoming',
      text,
      providerMessageId: args.messageId ?? null,
      rawPayload: args.rawPayload ?? null,
    });
  } catch (error) {
    console.error('[meta-wa-assistant] failed to persist incoming conversation message', {
      clinicId: summarizeId(clinic.id),
      error: error instanceof Error ? error.message : String(error),
    });
  }

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

  try {
    await persistWhatsAppConversationMessage({
      clinicId: clinic.id,
      patientId: resolvedPatientId,
      phone: args.phone,
      direction: 'outgoing',
      text: replyText,
      providerMessageId: result.externalMessageId ?? null,
    });
  } catch (error) {
    console.error('[meta-wa-assistant] failed to persist outgoing conversation message', {
      clinicId: summarizeId(clinic.id),
      error: error instanceof Error ? error.message : String(error),
    });
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
