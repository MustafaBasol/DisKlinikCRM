import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../db.js';
import { sendWhatsAppMessage } from '../services/whatsapp/whatsappService.js';
import {
  resolveClinicForIncomingMessage,
  upsertInboxEntry,
} from '../services/whatsapp/clinicResolver.js';
import { extractAssistantInputWithGoogleAi, normalizeDateWithGoogleAi } from '../services/googleAiStudio.js';
import { resolveWhatsAppConversationAgentDecision, type WhatsAppConversationAgentSource } from '../services/whatsappConversationAgent.js';
import type { WhatsAppAgentDecision } from '../services/whatsappAgentSchema.js';
import {
  buildAvailableSlots,
  loadAvailabilityForDate,
  saveSlotsForState,
  type SavedAvailableSlot,
} from '../services/whatsappAvailability.js';
import { handleAwaitingConfirmationStep, handleAwaitingDateStep, handleAwaitingServiceStep, handleAwaitingTimeStep, isDeterministicConfirmationReply } from '../services/whatsappBookingFlow.js';
import {
  extractExplicitRequestedTime as interpretExplicitRequestedTime,
  extractExplicitTimeThreshold as interpretExplicitTimeThreshold,
  getTimePreference as interpretTimePreference,
  interpretTimeRequest,
  isDifferentDateRequest as interpretDifferentDateRequest,
  isMoreOptionsRequest as interpretMoreOptionsRequest,
  type TimePreference,
} from '../services/whatsappInterpreter.js';
import { routeResolvedWhatsAppIntent } from '../services/whatsappResolvedIntentRouter.js';
import {
  createInboundEventOrDetectDuplicate,
  markInboundEventFailed,
  markInboundEventProcessed,
} from '../services/messagingInboundIdempotency.js';
import {
  getWebhookIgnoreReason,
  normalizeEvolutionWebhookPayload,
  type NormalizedWhatsAppMessage,
} from '../services/whatsappWebhookPayload.js';
import {
  validateWhatsappApiSecret,
  whatsappAppointmentLookupQuerySchema,
  whatsappAppointmentRequestSchema,
  whatsappAvailabilityQuerySchema,
} from '../services/whatsappPublicApi';
import {
  getClinicOperatingPreferences,
  type ClinicOperatingPreferences,
} from '../services/clinicOperatingPreferences.js';
import { logActivity } from '../utils/activity.js';
import { formatTurkishDateLong, normalizeDateFromTurkishInput, WHATSAPP_ASSISTANT_TIME_ZONE } from '../utils/whatsappDate.js';
import { getZonedDateParts, minutesToTime, timeToMinutes, formatClinicDateTime, localDateTimeToClinicDate } from '../utils/helpers.js';
import { isLegacyFallbackEnabled } from '../utils/legacyWhatsApp.js';
import { selectUniqueProviderConnection } from '../utils/webhookRouting.js';
import { sanitizeInboundMessageText } from '../utils/messageSanitizer.js';
import { checkInboundRateLimit } from '../utils/inboundRateLimiter.js';
import { assertSlotAvailable, acquireAppointmentSlotLock, SlotConflictError } from '../services/appointmentRequestSafety.js';
import { checkPractitionerAvailabilityForSlot } from '../services/appointments/appointmentAvailabilityService.js';
import { upsertContactRequest } from './contactRequests.js';

const router = express.Router();

// ---- Type Definitions ----

type AssistantIntent =
  | 'greeting'
  | 'book_appointment'
  | 'appointment_query'
  | 'check_appointment'
  | 'cancel_appointment'
  | 'human_handoff'
  | 'clinic_info'
  | 'service_info'
  | 'symptom_or_complaint'
  | 'off_topic_or_smalltalk'
  | 'unknown';
type AssistantStep =
  | 'main_menu'
  | 'awaiting_name'
  | 'awaiting_service'
  | 'awaiting_date'
  | 'awaiting_time'
  | 'awaiting_confirmation'
  | 'awaiting_cancel_selection'
  | 'awaiting_handoff_note'
  | 'awaiting_general_date'
  | 'awaiting_general_time'
  | 'awaiting_general_practitioner';

type AssistantExtraction = {
  intent: AssistantIntent;
  name: string | null;
  phone: string | null;
  appointmentTypeName: string | null;
  appointmentTypeId: string | null;
  dateText: string | null;
  time: string | null;
  exactTime: string | null;
  afterTime: string | null;
  timePreference: TimePreference | null;
  confidence: number;
  needsClarification: boolean;
  clarificationReason: string | null;
};

type AssistantStateRecord = {
  currentIntent?: string | null;
  step?: string | null;
  customerName?: string | null;
  selectedAppointmentTypeId?: string | null;
  selectedAppointmentTypeName?: string | null;
  selectedDate?: string | null;
};

type WhatsAppContactPatient = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
};

type AssistantService = {
  id: string;
  name: string;
  durationMinutes: number;
};

type SavedAppointmentSummary = {
  id: string;
  dateKey?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  serviceName: string | null;
  practitionerName: string | null;
  status: string;
  rawStatus?: string;
  sourceType?: 'appointment' | 'appointment_request';
  startsAt?: string | null;
};

type SavedServiceOption = {
  id: string;
  name: string;
};

type ConversationStateJson = {
  availableSlots?: SavedAvailableSlot[];
  lastShownSlots?: SavedAvailableSlot[];
  cancellableAppointments?: SavedAppointmentSummary[];
  matchedServices?: SavedServiceOption[];
  pendingConfirmationSlot?: SavedAvailableSlot | null;
  pendingHandoffRequestId?: string;
  generalRequestReason?: string;
  preferredTimeRange?: {
    startTime?: string | null;
    endTime?: string | null;
  };
  practitionerOptions?: { id: string; name: string }[];
};

// ---- Helper Middlewares ----

const authorizeWhatsappWebhook: express.RequestHandler = (req, res, next) => {
  const validationResult = validateWhatsappApiSecret(process.env.WHATSAPP_WEBHOOK_SECRET, {
    authorization: req.headers.authorization,
    xWhatsappSecret: req.headers['x-whatsapp-secret'],
  });
  if (validationResult === 'not_configured') {
    return res.status(503).json({ error: 'WhatsApp webhook secret is not configured' });
  }
  if (validationResult === 'invalid') {
    return res.status(401).json({ error: 'Invalid WhatsApp webhook secret' });
  }
  next();
};

const authorizeWhatsappApi: express.RequestHandler = (req, res, next) => {
  const validationResult = validateWhatsappApiSecret(process.env.WHATSAPP_WEBHOOK_SECRET, {
    authorization: req.headers.authorization,
    xWhatsappSecret: req.headers['x-whatsapp-secret'],
  });
  if (validationResult === 'not_configured') {
    return res.status(503).json({ error: 'WhatsApp API secret is not configured' });
  }
  if (validationResult === 'invalid') {
    return res.status(401).json({ error: 'Invalid WhatsApp API secret' });
  }
  next();
};

// ---- Constants ----

const OFF_TOPIC_REFUSAL_MESSAGE =
  'Bu kanal yalnızca klinik randevuları ve klinik bilgilendirme için kullanılmaktadır. ' +
  'Randevu almak, randevunuzu değiştirmek veya yetkiliyle görüşmek isterseniz yardımcı olabilirim.';

const WHATSAPP_FALLBACK_SERVICES: AssistantService[] = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Ağız, Diş ve Çene Cerrahisi', durationMinutes: 30 },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Diş Beyazlatma Bleaching', durationMinutes: 30 },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Endodonti (Kanal Tedavisi)', durationMinutes: 60 },
  { id: '44444444-4444-4444-8444-444444444444', name: 'Estetik Diş Hekimliği', durationMinutes: 45 },
  { id: 'd4e8a00f-b601-4b8d-a21b-f3a13899f336', name: 'Gülüş Tasarımı', durationMinutes: 60 },
];

// ---- Utility Functions ----

const toPrismaStateJson = (value: ConversationStateJson | null | undefined) => {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return value;
};

const readString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
};

const normalizePhone = (value: string) => value.replace(/@.+$/, '').replace(/\D/g, '');

const getPhoneVariants = (value?: string | null) => {
  const digits = value ? normalizePhone(value) : '';
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

const isPrismaUniqueConstraintError = (error: unknown) =>
  Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'P2002');

const normalizeIntentText = (value: string) => value.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');

const normalizeTurkishSearchText = (value: string) => normalizeIntentText(value)
  .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ı/g, 'i')
  .replace(/i̇/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const isGreetingMessage = (text: string) =>
  /^(merhaba|selam|iyi günler|günaydın|gunaydin|iyi akşamlar|iyi aksamlar|hey)\b/i.test(text.trim());

const isBotIdentityQuestion = (text: string) => {
  const normalized = normalizeTurkishSearchText(text);
  return [
    'sen kimsin', 'siz kimsiniz', 'sen bir robot musun', 'bot musun', 'yapay zeka misin',
    'asislan misin', 'asistan misin', 'kim konusuyor', 'kim bu', 'hangi sistem', 'otomatik mi',
  ].some(pattern => normalized.includes(pattern));
};

const isClosingMessage = (text: string) => {
  const normalized = normalizeTurkishSearchText(text);
  // Exact standalone phrases
  const exact = [
    'tesekkurler', 'tesekkur ederim', 'tesekkurler cok guzel', 'tesekkur ederim cok guzel',
    'sag olun', 'sag ol', 'eyvallah', 'eyval',
    'iyi gunler', 'iyi aksamlar', 'iyi geceler', 'iyi calismalar',
    'gule gule', 'gorusuruz', 'gorusmek uzere', 'hosca kalin', 'hosca kal',
    'bay bay', 'bye', 'bye bye', 'bb',
    'ihtiyacim kalmadi', 'gerek kalmadi', 'gerek yok', 'gerek yok artik',
    'olsun', 'iptal olsun', 'bos ver', 'neyse',
  ];
  if (exact.includes(normalized)) return true;
  // Phrases that start with farewell words
  const startsWithFarewell = [
    'tesekkurler', 'tesekkur ederim', 'sag olun', 'sag ol',
    'gule gule', 'gorusuruz', 'hosca kal', 'iyi gunler', 'iyi aksam', 'iyi gece',
    'tamam tesekkur', 'tamam sag ol', 'tamam iyi', 'tamam gorusuruz',
    'anladim tesekkur', 'oldu tesekkur', 'ihtiyacim kalmadi',
  ];
  return startsWithFarewell.some(prefix => normalized.startsWith(prefix));
};

const extractNumericSelection = (text: string) => {
  const match = normalizeIntentText(text).match(/(?:^|\D)(\d{1,2})(?:\D|$)/);
  return match ? Number(match[1]) : null;
};

const extractStandaloneNumericSelection = (text: string) => {
  const match = normalizeIntentText(text).match(/^(\d{1,2})(?:[.)])?$/);
  return match ? Number(match[1]) : null;
};

const readConversationStateJson = (value: unknown): ConversationStateJson => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const stateValue = value as Record<string, unknown>;
  const preferredTimeRange = stateValue.preferredTimeRange && typeof stateValue.preferredTimeRange === 'object' && !Array.isArray(stateValue.preferredTimeRange)
    ? stateValue.preferredTimeRange as ConversationStateJson['preferredTimeRange']
    : undefined;
  return {
    availableSlots: Array.isArray(stateValue.availableSlots) ? stateValue.availableSlots as SavedAvailableSlot[] : undefined,
    lastShownSlots: Array.isArray(stateValue.lastShownSlots) ? stateValue.lastShownSlots as SavedAvailableSlot[] : undefined,
    cancellableAppointments: Array.isArray(stateValue.cancellableAppointments) ? stateValue.cancellableAppointments as SavedAppointmentSummary[] : undefined,
    matchedServices: Array.isArray(stateValue.matchedServices) ? stateValue.matchedServices as SavedServiceOption[] : undefined,
    pendingConfirmationSlot: stateValue.pendingConfirmationSlot && typeof stateValue.pendingConfirmationSlot === 'object' && !Array.isArray(stateValue.pendingConfirmationSlot)
      ? stateValue.pendingConfirmationSlot as SavedAvailableSlot
      : undefined,
    pendingHandoffRequestId: typeof stateValue.pendingHandoffRequestId === 'string' ? stateValue.pendingHandoffRequestId : undefined,
    generalRequestReason: typeof stateValue.generalRequestReason === 'string' ? stateValue.generalRequestReason : undefined,
    preferredTimeRange,
  };
};

const hasValidLastName = (lastName?: string | null) => {
  const normalized = (lastName ?? '').trim().toLocaleLowerCase('tr-TR');
  return Boolean(normalized) && !['-', 'unknown', 'bilinmiyor'].includes(normalized);
};

const titleCaseName = (value: string) => value.trim().split(/\s+/)
  .map(part => part.charAt(0).toLocaleUpperCase('tr-TR') + part.slice(1).toLocaleLowerCase('tr-TR'))
  .join(' ');

const splitNameForPatient = (value: string) => {
  const normalized = titleCaseName(value);
  const [firstName, ...lastNameParts] = normalized.split(/\s+/);
  return { firstName: firstName || '', lastName: lastNameParts.join(' ') };
};

const getPatientFullName = (patient: Pick<WhatsAppContactPatient, 'firstName' | 'lastName'>) => {
  const firstName = patient.firstName.trim();
  const lastName = hasValidLastName(patient.lastName) ? patient.lastName!.trim() : '';
  return `${firstName}${lastName ? ` ${lastName}` : ''}`.trim();
};

const getFirstNameFromCustomerName = (customerName?: string | null) => {
  if (!customerName?.trim()) return null;
  return titleCaseName(customerName).split(/\s+/)[0] ?? null;
};

const formatClinicWelcomeName = (clinicName?: string | null) => {
  const normalized = clinicName?.trim();
  if (!normalized) return 'kliniğimize';
  if (/klinik|klinigi|kliniği/i.test(normalized)) return `${normalized}'ne`;
  return `${normalized} Kliniği'ne`;
};

const formatMainMenu = (customerName?: string | null, isReturningCustomer = false, clinicName?: string | null) => {
  const firstName = getFirstNameFromCustomerName(customerName);
  const clinicWelcomeName = formatClinicWelcomeName(clinicName);
  if (firstName && isReturningCustomer) {
    return [`Merhaba ${firstName}, ${clinicWelcomeName} yeniden hoş geldiniz. Size nasıl yardımcı olabilirim?`, '1. Randevu almak', '2. Randevumu sorgulamak', '3. Randevumu iptal etmek', '4. Hizmetler hakkında bilgi almak'].join('\n');
  }
  if (firstName) {
    return [`Teşekkür ederim ${firstName}. Size nasıl yardımcı olabilirim?`, '1. Randevu almak', '2. Randevumu sorgulamak', '3. Randevumu iptal etmek', '4. Hizmetler hakkında bilgi almak'].join('\n');
  }
  return `Merhaba, ${clinicWelcomeName} hoş geldiniz. Size yardımcı olabilmem için adınızı ve soyadınızı paylaşır mısınız?`;
};

const formatMainMenuOptions = (intro = 'Size nasıl yardımcı olabilirim?') =>
  [intro, '1. Randevu almak', '2. Randevumu sorgulamak', '3. Randevumu iptal etmek', '4. Hizmetler hakkında bilgi almak'].join('\n');

const clearBookingState = () => ({
  selectedAppointmentTypeId: null,
  selectedAppointmentTypeName: null,
  selectedPractitionerId: null,
  selectedDate: null,
  selectedTime: null,
  stateJson: null as ConversationStateJson | null,
});

const isPlaceholderPatientName = (patient: Pick<WhatsAppContactPatient, 'firstName' | 'lastName'>) =>
  !patient.firstName.trim() || !hasValidLastName(patient.lastName);

const formatServiceList = (services: AssistantService[]) =>
  ['Elbette, hangi hizmet için randevu planlamak istersiniz?', ...services.map((s, i) => `${i + 1}. ${s.name}`)].join('\n');

const getDatePartsForPreference = (value: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);

  return {
    year: parts.find(part => part.type === 'year')?.value ?? '0000',
    month: parts.find(part => part.type === 'month')?.value ?? '00',
    day: parts.find(part => part.type === 'day')?.value ?? '00',
  };
};

const formatDateWithClinicPreference = (value: Date, preferences: ClinicOperatingPreferences) => {
  const { day, month, year } = getDatePartsForPreference(value, preferences.timezone);
  if (preferences.dateFormat === 'MM/dd/yyyy') return `${month}/${day}/${year}`;
  if (preferences.dateFormat === 'dd/MM/yyyy') return `${day}/${month}/${year}`;
  if (preferences.dateFormat === 'yyyy-MM-dd') return `${year}-${month}-${day}`;
  return `${day}.${month}.${year}`;
};

const formatTimeWithClinicPreference = (value: Date, preferences: ClinicOperatingPreferences) =>
  new Intl.DateTimeFormat(preferences.locale, {
    timeZone: preferences.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: preferences.timeFormat === '12h',
    hourCycle: preferences.timeFormat === '24h' ? 'h23' : undefined,
  }).format(value);

const formatAppointmentStatusLabel = (status: string, sourceType: SavedAppointmentSummary['sourceType']) => {
  if (sourceType === 'appointment_request') {
    if (status === 'pending') return 'Klinik onayı bekliyor';
    if (status === 'approved') return 'Talep onaylandı';
    if (status === 'converted') return 'Randevuya dönüştürüldü';
    if (status === 'rejected') return 'Reddedildi';
    return status;
  }

  const labels: Record<string, string> = {
    scheduled: 'Planlandı',
    confirmed: 'Onaylandı',
    in_progress: 'Görüşme başladı',
    completed: 'Tamamlandı',
    rescheduled: 'Ertelendi',
    no_show: 'Gelmedi',
  };
  return labels[status] ?? status;
};

const isPendingStatusQuestion = (text?: string | null) => {
  const normalized = normalizeTurkishSearchText(text ?? '');
  return normalized.includes('neden onay bekliyor')
    || normalized.includes('niye onay bekliyor')
    || normalized.includes('onay bekliyor ne demek')
    || normalized.includes('onay bekleyen')
    || normalized.includes('onay bekliyor');
};

const isDoctorAppointmentQuestion = (text?: string | null) => {
  const normalized = normalizeTurkishSearchText(text ?? '');
  return normalized.includes('hangi doktor')
    || normalized.includes('hangi hekim')
    || normalized.includes('doktorla randevum')
    || normalized.includes('hekimle randevum')
    || normalized.includes('doktor kim')
    || normalized.includes('hekim kim');
};

const formatAppointmentSummaryLine = (appointment: SavedAppointmentSummary, index: number) => {
  const serviceText = appointment.serviceName ?? 'Hizmet bilgisi yok';
  const practitionerText = appointment.practitionerName
    ? `Hekim: ${appointment.practitionerName}`
    : 'Hekim: Henüz atanmadı';
  return `${index + 1}. ${appointment.date} saat ${appointment.startTime} - ${serviceText} - ${practitionerText} - Durum: ${appointment.status}`;
};

const formatAppointmentLookupForMessage = (appointments: SavedAppointmentSummary[], questionText?: string | null) => {
  if (appointments.length > 0) {
    const normalizedQuestionDate = questionText
      ? normalizeDateFromTurkishInput(questionText, new Date(), WHATSAPP_ASSISTANT_TIME_ZONE)
      : null;
    const dateMatches = normalizedQuestionDate
      ? appointments.filter(appointment => appointment.dateKey === normalizedQuestionDate)
      : [];
    const pendingAppointments = appointments.filter(appointment => appointment.sourceType === 'appointment_request' && appointment.rawStatus === 'pending');

    const intro = dateMatches.length > 0
      ? 'Evet, bu tarihle eşleşen randevu kaydınız var:'
      : normalizedQuestionDate
        ? 'Bu tarihte sistemde görünen bir randevu kaydı bulamadım. Kayıtlarınız şöyle:'
        : isDoctorAppointmentQuestion(questionText)
          ? 'Randevu kayıtlarınızdaki hekim bilgisi şöyle:'
          : isPendingStatusQuestion(questionText) && pendingAppointments.length > 0
            ? '“Klinik onayı bekliyor” ifadesi, talebinizin klinik ekibi tarafından henüz kesin randevu olarak onaylanmadığı anlamına gelir. Sistemde gördüğüm randevu kayıtlarınız şöyle:'
            : 'Sistemde gördüğüm randevu kayıtlarınız şunlar:';

    const rows = dateMatches.length > 0 ? dateMatches : appointments;
    return [intro, ...rows.map(formatAppointmentSummaryLine)].join('\n');
  }
  if (appointments.length === 0) {
    return 'Telefon numaranızla eşleşen randevu kaydı göremedim. İsterseniz birlikte yeni bir randevu planlayabiliriz.';
  }
  return 'Randevu kayıtlarınızı şu anda okunabilir şekilde hazırlayamadım. Lütfen biraz sonra tekrar deneyin veya klinik ekibine bağlanmak istediğinizi yazın.';
};

const formatAvailabilityMessage = (date: string, slots: SavedAvailableSlot[]) => {
  const formattedDate = formatTurkishDateLong(date, WHATSAPP_ASSISTANT_TIME_ZONE);
  return [
    `${formattedDate} için takvimi kontrol ettim. Size sunabileceğim uygun saatler şunlar:`,
    ...slots.map((slot, i) => `${i + 1}. ${slot.localStartTime}${slot.practitionerName ? ` (${slot.practitionerName})` : ''}`),
    '', 'Size uygun olan saati paylaşabilirsiniz.',
  ].join('\n');
};

const formatWarmPrompt = (message: string, customerName?: string | null) => {
  const firstName = getFirstNameFromCustomerName(customerName);
  if (!firstName) return message;
  return `${firstName}, ${message.charAt(0).toLocaleLowerCase('tr-TR')}${message.slice(1)}`;
};

const redactPhone = (phone: string | null | undefined) => {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length <= 4) return '***';
  return `***${digits.slice(-4)}`;
};

const summarizeIdentifier = (value: string | null | undefined) => {
  if (!value) return null;
  return { length: value.length, suffix: value.slice(-4) };
};

const summarizeTextForLog = (text: string | null | undefined) => ({
  length: String(text ?? '').length,
});

const logGlobalIntent = (phone: string, text: string, previousStep: string | null | undefined, globalIntent: string) => {
  console.log('[whatsapp-assistant] global-intent', { phone: redactPhone(phone), text: summarizeTextForLog(text), previousStep: previousStep ?? null, globalIntent });
};

const logStateTransition = (phone: string, fromStep: string | null | undefined, toStep: string | null | undefined, reason: string) => {
  console.log('[whatsapp-assistant] state-transition', { phone: redactPhone(phone), fromStep: fromStep ?? null, toStep: toStep ?? null, reason });
};

const logAvailabilitySave = (totalSlots: number, shownSlots: number) => {
  console.log('[whatsapp-assistant] availability-save', { totalSlots, shownSlots });
};

const isMainMenuCommand = (text: string) => {
  const normalized = normalizeTurkishSearchText(text);
  return ['menu', 'menü', 'ana menu', 'basa don', 'en basa don', 'reset', 'yeniden basla']
    .some(pattern => normalized === pattern || normalized.includes(pattern));
};

const isAppointmentCancellationIntent = (text: string) => {
  const normalized = normalizeTurkishSearchText(text);
  return ['randevu iptal etmek istiyorum', 'randevumu iptal edecegim', 'var olan randevumu iptal et',
    'randevumu sil', 'randevumu iptal', 'iptal etmek istiyorum']
    .some(pattern => normalized.includes(pattern));
};

const isCheckAppointmentIntent = (text: string) => {
  const normalized = normalizeTurkishSearchText(text);
  if (normalized.includes('randevum') && !normalized.includes('iptal')) {
    return true;
  }
  if (normalized.includes('randevu') && (
    normalized.includes('ne zaman')
    || normalized.includes('hangi doktor')
    || normalized.includes('hangi hekim')
    || normalized.includes('hangi tarih')
    || normalized.includes('onay bekliyor')
  )) {
    return true;
  }
  return ['randevumu sorgulamak istiyorum', 'randevum var mi', 'randevumu ogrenmek istiyorum',
    'randevu bilgilerimi goster', 'randevu durumumu goster', 'randevum ne zaman',
    'randevum hangi gun', 'randevum hangi tarihte', 'hangi doktor', 'hangi hekim',
    'doktorla randevum var', 'hekimle randevum var', 'neden onay bekliyor',
    'onay bekliyor ne demek', 'onay bekleyen randevum']
    .some(pattern => normalized.includes(pattern));
};

const isClinicHoursQuestion = (text: string) => {
  const normalized = normalizeTurkishSearchText(text);
  return [
    'acik misiniz', 'acik misin', 'klinik acik mi', 'klinik acik misiniz',
    'calisma saatleri', 'calisma saatiniz', 'mesai saati', 'mesai saatleri',
    'kacta aciyor', 'kacta kapaniyor', 'saat kacta aciksiniz', 'saat kacta kapaniyor',
    'hafta sonu acik misiniz', 'cumartesi acik mi', 'pazar acik mi',
    'bugun acik misiniz', 'yarin acik misiniz',
  ].some(pattern => normalized.includes(pattern))
    || /\b\d{1,2}\s*(mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik|ocak|subat|mart|nisan)\b.*acik/i.test(normalized)
    || /acik.*\b\d{1,2}\s*(mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik|ocak|subat|mart|nisan)\b/i.test(normalized);
};

const isHumanHandoffIntent = (text: string) => {
  const normalized = normalizeTurkishSearchText(text);
  return [
    'yetkili ile gorusmek',
    'yetkiliyle gorusmek',
    'yetkili istiyorum',
    'insanla gorusmek',
    'canli destek',
    'temsilci',
    'operator',
    'personelle gorusmek',
    'resepsiyonla gorusmek',
    'doktorla gorusmek',
    'beni arasin',
    'aramalarini istiyorum',
    'ekibe ilet',
    'klinik ekibiyle gorus',
  ].some(pattern => normalized.includes(pattern));
};

const isSymptomOrComplaintMessage = (text: string) => {
  const normalized = normalizeTurkishSearchText(text);
  return [
    'disim agriyor',
    'disim cok agriyor',
    'dis agrisi',
    'agzim agriyor',
    'cenem agriyor',
    'sizlama',
    'sizlik',
    'hassasiyet',
    'sislik',
    'yuzum sisti',
    'apse',
    'kanama',
    'dis etim kaniyor',
    'disim kirildi',
    'disim catladi',
    'dolgu dustu',
    'kuron dustu',
    'kaplama dustu',
    'acil',
    'sikayetim var',
  ].some(pattern => normalized.includes(pattern))
    || /\b(agri|agriyor|aciyor|sanci|sancisi)\b/.test(normalized);
};

const isClinicInfoQuestion = (text: string) => {
  const normalized = normalizeTurkishSearchText(text);
  return isClinicHoursQuestion(text)
    || [
      'kac doktor',
      'doktor sayisi',
      'hekim sayisi',
      'kac hekim',
      'klinigin adresi',
      'adresiniz',
      'neredesiniz',
      'konum',
      'telefon numaraniz',
      'telefonunuz',
      'mail adresiniz',
      'email adresiniz',
      'web siteniz',
      'ogle arasi',
      'oglen acik',
      'ogle molasi',
      'calisan doktor',
    ].some(pattern => normalized.includes(pattern));
};

const isOffTopicOrSmallTalkMessage = (text: string) => {
  const normalized = normalizeTurkishSearchText(text);
  return [
    'saat kac',
    'saat kactir',
    'su an saat',
    'nasilsin',
    'naber',
    'hava nasil',
    'fikra anlat',
    'saka yap',
  ].some(pattern => normalized.includes(pattern));
};

const hasBookingLanguage = (text: string) => {
  const normalized = normalizeTurkishSearchText(text);
  return [
    'randevu',
    'muayene',
    'gelmek istiyorum',
    'kontrol ettirmek',
    'uygunluk',
    'musaitlik',
    'musaitim',
  ].some(pattern => normalized.includes(pattern));
};

const normalizeAssistantIntentValue = (intent: string | null | undefined): AssistantIntent => {
  if (intent === 'check_appointment') return 'appointment_query';
  if ([
    'greeting',
    'book_appointment',
    'appointment_query',
    'cancel_appointment',
    'human_handoff',
    'clinic_info',
    'service_info',
    'symptom_or_complaint',
    'off_topic_or_smalltalk',
    'unknown',
  ].includes(intent ?? '')) {
    return intent as AssistantIntent;
  }
  return 'unknown';
};

const isAppointmentQueryIntentValue = (intent: string | null | undefined) =>
  normalizeAssistantIntentValue(intent) === 'appointment_query';

const isBookingFlowCancelCommand = (text: string, state: AssistantStateRecord | null | undefined) => {
  const normalized = normalizeTurkishSearchText(text);
  const isBookingStep = ['awaiting_service', 'awaiting_date', 'awaiting_time', 'awaiting_confirmation'].includes(state?.step ?? '');
  if (!isBookingStep) return false;
  return ['vazgectim', 'bu islemden vazgectim', 'randevu almaktan vazgectim', 'simdilik istemiyorum', 'iptal et']
    .some(pattern => normalized.includes(pattern));
};

const isBackCommand = (text: string) => {
  const normalized = normalizeTurkishSearchText(text);
  return ['geri', 'bir onceki adima don', 'onceki menu'].some(pattern => normalized.includes(pattern));
};

const isChangeDateRequest = (text: string) => {
  const normalized = normalizeTurkishSearchText(text);
  return Boolean(normalizeDateFromTurkishInput(text, new Date(), WHATSAPP_ASSISTANT_TIME_ZONE))
    || ['gunu degistirmek istiyorum', 'baska gun bakalim', 'tarihi degistirelim', 'yarin degil baska gun',
      'baska tarih var mi', 'baska gun', 'farkli gun'].some(pattern => normalized.includes(pattern));
};

const isChangeServiceRequest = (text: string) => {
  const normalized = normalizeTurkishSearchText(text);
  return ['hizmeti degistirmek istiyorum', 'baska islem seceyim', 'hizmeti yanlis sectim']
    .some(pattern => normalized.includes(pattern));
};

const isMoreOptionsRequest = (text: string) => interpretMoreOptionsRequest(text);
const isDifferentDateRequest = (text: string) =>
  Boolean(normalizeDateFromTurkishInput(text, new Date(), WHATSAPP_ASSISTANT_TIME_ZONE)) || interpretDifferentDateRequest(text);

const getTimePreference = (text: string) => interpretTimePreference(text);
const extractExplicitTimeThreshold = (text: string) => interpretExplicitTimeThreshold(text);
const extractExplicitRequestedTime = (text: string) => interpretExplicitRequestedTime(text);
const extractTimeSelection = (text: string) => extractExplicitRequestedTime(text);

const normalizePractitionerName = (value: string) => normalizeTurkishSearchText(value)
  .replace(/\bdt\b/g, ' ').replace(/\bdis\b/g, ' ').replace(/\bdr\b/g, ' ')
  .replace(/\bhanim\b/g, ' ').replace(/\bbey\b/g, ' ').replace(/\bhoca\b/g, ' ')
  .replace(/\bhosun\b/g, ' ').replace(/\bolsun\b/g, ' ').replace(/\buygun\b/g, ' ')
  .replace(/\bsaat\b/g, ' ').replace(/\bnumara\b/g, ' ').replace(/\brandevu\b/g, ' ')
  .replace(/\bmusait\b/g, ' ').replace(/\bvar\b/g, ' ').replace(/\s+/g, ' ').trim();

const findSlotMatches = (text: string, slots: SavedAvailableSlot[]) => {
  const extractedTime = extractTimeSelection(text);
  const normalizedQuery = normalizePractitionerName(text);
  const queryTokens = normalizedQuery.split(' ').filter(token => token.length >= 3 && !/^\d+$/.test(token));

  const matches = slots.map((slot, index) => {
    const normalizedPractitioner = normalizePractitionerName(slot.practitionerName);
    const practitionerTokens = normalizedPractitioner.split(' ').filter(token => token.length >= 3);
    const timeMatches = extractedTime ? slot.localStartTime === extractedTime : true;
    const practitionerMatches = queryTokens.length === 0
      ? true
      : queryTokens.every(token => normalizedPractitioner.includes(token) || practitionerTokens.some(nameToken => nameToken.includes(token)));
    return { slot, index, practitionerName: normalizedPractitioner, timeMatches, practitionerMatches };
  }).filter(item => item.timeMatches && item.practitionerMatches);

  return { extractedTime, hasPractitionerFragment: queryTokens.length > 0, matches };
};

const findServiceMatches = (text: string, services: AssistantService[]) => {
  const normalizedQuery = normalizeTurkishSearchText(text);
  if (!normalizedQuery || /^\d+$/.test(normalizedQuery)) return [];
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  return services.filter(service => {
    const normalizedServiceName = normalizeTurkishSearchText(service.name);
    return normalizedServiceName.includes(normalizedQuery)
      || normalizedQuery.includes(normalizedServiceName)
      || queryTokens.every(token => normalizedServiceName.includes(token));
  });
};

const findServiceSelection = (text: string, services: AssistantService[]) => {
  const normalized = normalizeIntentText(text);
  if (/^\d+$/.test(normalized)) {
    const selected = services[Number(normalized) - 1];
    return selected ?? null;
  }
  const matches = findServiceMatches(text, services);
  return matches.length === 1 ? matches[0] : null;
};

const extractAssistantInputRuleBased = (text: string, services: AssistantService[]): AssistantExtraction => {
  const normalized = normalizeIntentText(text);
  const timeRequest = interpretTimeRequest(text);
  const matchedService = findServiceSelection(text, services);
  const timeMatch = normalized.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  let intent: AssistantIntent = 'unknown';

  if (isHumanHandoffIntent(text)) {
    intent = 'human_handoff';
  } else if (isSymptomOrComplaintMessage(text)) {
    intent = 'symptom_or_complaint';
  } else if (
    normalized === '1'
    || /(randevu al|randevu almak|randevu oluştur|randevu olustur|randevu istiyorum|randevu almak istiyorum)/.test(normalized)
    || (
      hasBookingLanguage(text)
      && (
        Boolean(normalizeDateFromTurkishInput(text, new Date(), WHATSAPP_ASSISTANT_TIME_ZONE))
        || timeRequest.rangeStartMinutes !== null
        || timeRequest.exactTime !== null
        || timeRequest.afterTimeMinutes !== null
        || timeRequest.preference !== null
      )
    )
  ) {
    intent = 'book_appointment';
  } else if (normalized === '2' || /(randevumu sorgu|randevu sorgu|randevum ne zaman|randevu durum|randevum var mı|randevum var mi)/.test(normalized)) {
    intent = 'appointment_query';
  } else if (normalized === '3' || /(randevumu iptal|randevu iptal|var olan randevumu iptal)/.test(normalized)) {
    intent = 'cancel_appointment';
  } else if (isClinicInfoQuestion(text)) {
    intent = 'clinic_info';
  } else if (normalized === '4' || /(hizmet|tedavi|bilgi almak|fiyat|servis)/.test(normalized)) {
    intent = 'service_info';
  } else if (isGreetingMessage(text)) {
    intent = 'greeting';
  } else if (isOffTopicOrSmallTalkMessage(text)) {
    intent = 'off_topic_or_smalltalk';
  }

  return {
    intent,
    name: /^[\p{L} .'-]{2,}$/u.test(text.trim()) ? titleCaseName(text) : null,
    phone: /^\+?\d{6,}$/.test(text.trim()) ? normalizePhone(text.trim()) : null,
    appointmentTypeName: matchedService?.name ?? null,
    appointmentTypeId: matchedService?.id ?? null,
    dateText: normalizeDateFromTurkishInput(text, new Date(), WHATSAPP_ASSISTANT_TIME_ZONE) ? text : null,
    time: timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : null,
    exactTime: extractExplicitRequestedTime(text),
    afterTime: (() => {
      const threshold = extractExplicitTimeThreshold(text);
      return threshold !== null ? minutesToTime(threshold) : null;
    })(),
    timePreference: getTimePreference(text),
    confidence: intent !== 'unknown' || matchedService || timeMatch ? 0.95 : 0.2,
    needsClarification: false,
    clarificationReason: null,
  };
};

type AssistantExtractionSource = 'rule_based' | 'ai' | 'mixed';

const hasExtractionSlots = (extraction: AssistantExtraction | null | undefined) =>
  Boolean(
    extraction?.name
    || extraction?.phone
    || extraction?.appointmentTypeName
    || extraction?.appointmentTypeId
    || extraction?.dateText
    || extraction?.time
    || extraction?.exactTime
    || extraction?.afterTime
    || extraction?.timePreference
  );

const mergeAssistantExtractions = (ruleBased: AssistantExtraction, aiBased: AssistantExtraction | null, services: AssistantService[], text: string): { extraction: AssistantExtraction; source: AssistantExtractionSource } => {
  const aiService = aiBased?.appointmentTypeId
    ? services.find(s => s.id === aiBased.appointmentTypeId) ?? null
    : aiBased?.appointmentTypeName
      ? findServiceSelection(aiBased.appointmentTypeName, services)
      : null;
  const isDeterministicMenuSelection = /^[1-4]$/.test(normalizeIntentText(text));
  const normalizedAiIntent = normalizeAssistantIntentValue(aiBased?.intent);
  const normalizedRuleIntent = normalizeAssistantIntentValue(ruleBased.intent);
  const timeRequest = interpretTimeRequest(text);
  const hasActionableBookingTime = timeRequest.rangeStartMinutes !== null
    || timeRequest.exactTime !== null
    || timeRequest.afterTimeMinutes !== null
    || timeRequest.preference !== null
    || Boolean(normalizeDateFromTurkishInput(text, new Date(), WHATSAPP_ASSISTANT_TIME_ZONE));
  const shouldKeepRuleIntent = normalizedRuleIntent === 'human_handoff'
    || normalizedRuleIntent === 'symptom_or_complaint'
    || (normalizedRuleIntent === 'book_appointment' && hasBookingLanguage(text) && hasActionableBookingTime)
    || isDeterministicMenuSelection;
  const shouldPreferAiIntent = Boolean(aiBased)
    && normalizedAiIntent !== 'unknown'
    && (aiBased?.confidence ?? 0) >= 0.65
    && !shouldKeepRuleIntent;
  const resolvedIntent = shouldPreferAiIntent
    ? normalizedAiIntent
    : normalizedRuleIntent !== 'unknown'
      ? normalizedRuleIntent
      : normalizedAiIntent;

  const name = ruleBased.name ?? aiBased?.name ?? null;
  const phone = ruleBased.phone ?? aiBased?.phone ?? null;
  const appointmentTypeName = ruleBased.appointmentTypeName ?? aiService?.name ?? aiBased?.appointmentTypeName ?? null;
  const appointmentTypeId = ruleBased.appointmentTypeId ?? aiService?.id ?? aiBased?.appointmentTypeId ?? null;
  const dateText = ruleBased.dateText ?? aiBased?.dateText ?? null;
  const time = ruleBased.time ?? aiBased?.time ?? null;
  const exactTime = ruleBased.exactTime ?? aiBased?.exactTime ?? null;
  const afterTime = ruleBased.afterTime ?? aiBased?.afterTime ?? null;
  const timePreference = ruleBased.timePreference ?? aiBased?.timePreference ?? null;
  const aiIntentUsed = Boolean(aiBased)
    && normalizedAiIntent !== 'unknown'
    && (shouldPreferAiIntent || (normalizedRuleIntent === 'unknown' && resolvedIntent === normalizedAiIntent));
  const aiSlotsUsed = Boolean(aiBased) && (
    (!ruleBased.name && Boolean(aiBased?.name) && name === aiBased?.name)
    || (!ruleBased.phone && Boolean(aiBased?.phone) && phone === aiBased?.phone)
    || (!ruleBased.appointmentTypeName && !ruleBased.appointmentTypeId && Boolean(aiBased?.appointmentTypeName ?? aiBased?.appointmentTypeId) && Boolean(appointmentTypeName ?? appointmentTypeId))
    || (!ruleBased.dateText && Boolean(aiBased?.dateText) && dateText === aiBased?.dateText)
    || (!ruleBased.time && Boolean(aiBased?.time) && time === aiBased?.time)
    || (!ruleBased.exactTime && Boolean(aiBased?.exactTime) && exactTime === aiBased?.exactTime)
    || (!ruleBased.afterTime && Boolean(aiBased?.afterTime) && afterTime === aiBased?.afterTime)
    || (!ruleBased.timePreference && Boolean(aiBased?.timePreference) && timePreference === aiBased?.timePreference)
  );
  const ruleFieldsUsed = (normalizedRuleIntent !== 'unknown' && resolvedIntent === normalizedRuleIntent) || hasExtractionSlots(ruleBased);
  const source: AssistantExtractionSource = !aiBased || (!aiIntentUsed && !aiSlotsUsed)
    ? 'rule_based'
    : ruleFieldsUsed
      ? 'mixed'
      : 'ai';
  const useAiClarification = source !== 'rule_based' && Boolean(aiBased);

  return {
    extraction: {
      intent: resolvedIntent,
      name,
      phone,
      appointmentTypeName,
      appointmentTypeId,
      dateText,
      time,
      exactTime,
      afterTime,
      timePreference,
      confidence: shouldPreferAiIntent ? (aiBased?.confidence ?? ruleBased.confidence) : (ruleBased.confidence > 0.2 ? ruleBased.confidence : (aiBased?.confidence ?? ruleBased.confidence)),
      needsClarification: useAiClarification ? (aiBased?.needsClarification ?? false) : ruleBased.needsClarification,
      clarificationReason: useAiClarification ? (aiBased?.clarificationReason ?? null) : ruleBased.clarificationReason,
    },
    source,
  };
};

const resolveAssistantExtraction = async (text: string, services: AssistantService[], state: AssistantStateRecord): Promise<AssistantExtraction> => {
  const ruleBased = extractAssistantInputRuleBased(text, services);
  try {
    const aiBased = await extractAssistantInputWithGoogleAi({
      text,
      services: services.map(s => ({ id: s.id, name: s.name })),
      currentIntent: state.currentIntent,
      currentStep: state.step,
      customerName: state.customerName,
      selectedAppointmentTypeName: state.selectedAppointmentTypeName,
      selectedDate: state.selectedDate,
    });
    const merged = mergeAssistantExtractions(ruleBased, aiBased, services, text);
    console.info('[whatsapp-assistant] extraction-source', {
      source: merged.source,
      intent: merged.extraction.intent,
      timePreference: merged.extraction.timePreference,
      exactTime: merged.extraction.exactTime,
      afterTime: merged.extraction.afterTime,
      confidence: merged.extraction.confidence,
      needsClarification: merged.extraction.needsClarification,
    });
    return merged.extraction;
  } catch (error) {
    console.error('[whatsapp-assistant] ai-extraction-error', error);
    return ruleBased;
  }
};

const buildAssistantExtractionFromAgentDecision = (
  decision: WhatsAppAgentDecision,
  services: AssistantService[],
): AssistantExtraction => {
  const serviceFromSlot = decision.slots.appointmentTypeId
    ? services.find(service => service.id === decision.slots.appointmentTypeId) ?? null
    : decision.slots.appointmentTypeName
      ? findServiceSelection(decision.slots.appointmentTypeName, services)
      : decision.slots.serviceName
        ? findServiceSelection(decision.slots.serviceName, services)
        : null;

  return {
    intent: normalizeAssistantIntentValue(decision.intent),
    name: decision.slots.name,
    phone: decision.slots.phone,
    appointmentTypeName: serviceFromSlot?.name ?? decision.slots.appointmentTypeName ?? decision.slots.serviceName,
    appointmentTypeId: serviceFromSlot?.id ?? decision.slots.appointmentTypeId,
    dateText: decision.slots.dateText,
    time: decision.slots.time,
    exactTime: decision.slots.exactTime ?? decision.slots.time,
    afterTime: decision.slots.afterTime,
    timePreference: decision.slots.timePreference as TimePreference | null,
    confidence: decision.confidence,
    needsClarification: decision.action === 'ask_clarification' || decision.confidence < 0.6,
    clarificationReason: decision.action === 'ask_clarification' ? decision.reply : null,
  };
};

const resolveAssistantExtractionWithAgentDecision = async (
  text: string,
  services: AssistantService[],
  state: AssistantStateRecord,
  agentDecision: WhatsAppAgentDecision | null,
) => {
  if (agentDecision) {
    const ruleBased = extractAssistantInputRuleBased(text, services);
    const agentBased = buildAssistantExtractionFromAgentDecision(agentDecision, services);
    return mergeAssistantExtractions(ruleBased, agentBased, services, text).extraction;
  }

  return resolveAssistantExtraction(text, services, state);
};

// ---- State Management ----

const resetWhatsAppConversationState = async (clinicId: string, phone: string, customerName?: string | null) => {
  const normalizedPhone = normalizePhone(phone);
  return prisma.whatsAppConversationState.upsert({
    where: { clinicId_phone: { clinicId, phone: normalizedPhone } },
    update: {
      customerName: customerName ?? null,
      currentIntent: null,
      step: null,
      selectedAppointmentTypeId: null,
      selectedAppointmentTypeName: null,
      selectedPractitionerId: null,
      selectedDate: null,
      selectedTime: null,
      lastMessage: null,
      stateJson: Prisma.DbNull,
    },
    create: {
      clinicId,
      phone: normalizedPhone,
      customerName: customerName ?? null,
      stateJson: Prisma.DbNull,
    },
  });
};

const upsertWhatsAppConversationState = async (
  clinicId: string,
  phone: string,
  data: {
    customerName?: string | null;
    currentIntent?: string | null;
    step?: string | null;
    selectedAppointmentTypeId?: string | null;
    selectedAppointmentTypeName?: string | null;
    selectedPractitionerId?: string | null;
    selectedDate?: string | null;
    selectedTime?: string | null;
    lastMessage?: string | null;
    stateJson?: ConversationStateJson | null;
    lastProviderMessageId?: string | null;
  }
) => {
  const normalizedPhone = normalizePhone(phone);
  const { stateJson: rawStateJson, ...rest } = data;
  const stateJson = toPrismaStateJson(rawStateJson);
  return prisma.whatsAppConversationState.upsert({
    where: { clinicId_phone: { clinicId, phone: normalizedPhone } },
    update: { ...rest, ...(stateJson !== undefined ? { stateJson } : {}) },
    create: { clinicId, phone: normalizedPhone, ...rest, ...(stateJson !== undefined ? { stateJson } : {}) },
  });
};

// ---- Availability / Appointment Helpers ----

const getDefaultClinic = async () => prisma.clinic.findFirst({ orderBy: { createdAt: 'asc' } });

const getClinicForWhatsAppInstance = async (instanceName?: string | null) => {
  if (!isLegacyFallbackEnabled() || process.env.NODE_ENV === 'production') return null;

  const normalizedInstance = instanceName?.trim();
  if (!normalizedInstance) return null;

  const configuredInstance = process.env.EVOLUTION_INSTANCE_NAME?.trim();
  const mappedSetting = await prisma.setting.findFirst({
    where: { key: 'whatsapp.evolution_instance_name', value: normalizedInstance },
    include: { clinic: true },
  });
  if (mappedSetting?.clinic) return mappedSetting.clinic;
  if (configuredInstance && configuredInstance === normalizedInstance) return getDefaultClinic();
  return null;
};

const getAssistantServices = async (clinicId: string): Promise<AssistantService[]> => {
  const services = await prisma.appointmentType.findMany({
    where: { clinicId, isActive: true, isService: true },
    select: { id: true, name: true, durationMinutes: true },
    orderBy: { name: 'asc' },
  });
  return services.length > 0 ? services : WHATSAPP_FALLBACK_SERVICES;
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

const getClinicSystemUserId = async (clinicId: string) => {
  const user = await prisma.user.findFirst({
    where: { clinicId, isActive: true },
    select: { id: true },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });
  return user?.id ?? null;
};

const createPatientFromWhatsAppName = async (clinicId: string, phone: string, fullName: string) => {
  const parsedName = splitNameForPatient(fullName);
  if (!parsedName.firstName || !hasValidLastName(parsedName.lastName)) {
    throw new Error('PATIENT_LAST_NAME_REQUIRED');
  }
  const patient = await prisma.patient.create({
    data: {
      clinicId,
      organizationId: (await prisma.clinic.findUnique({ where: { id: clinicId }, select: { organizationId: true } }))!.organizationId,
      firstName: parsedName.firstName, lastName: parsedName.lastName,
      phone: normalizePhone(phone), source: 'whatsapp', patientStatus: 'new', communicationConsent: false,
      notes: 'WhatsApp üzerinden ilk temas sonrası oluşturuldu.',
    },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
  const systemUserId = await getClinicSystemUserId(clinicId);
  if (systemUserId) {
    await logActivity({
      clinicId, userId: systemUserId, entityType: 'patient', entityId: patient.id,
      action: 'created',
      description: `Patient automatically created from first WhatsApp contact (${normalizePhone(phone)})`,
      patientId: patient.id,
      metadata: { systemGenerated: true, source: 'whatsapp', phone: normalizePhone(phone) },
    });
  }
  return patient;
};

const ensureWhatsAppContactPatient = async (clinicId: string, phone: string, providedName?: string | null) => {
  const existingPatient = await findExistingPatientByPhone(clinicId, phone);
  const parsedProvidedName = providedName?.trim() ? splitNameForPatient(providedName) : null;
  if (existingPatient) {
    if (parsedProvidedName && hasValidLastName(parsedProvidedName.lastName) && (!existingPatient.firstName.trim() || isPlaceholderPatientName(existingPatient))) {
      return prisma.patient.update({
        where: { id: existingPatient.id },
        data: parsedProvidedName,
        select: { id: true, firstName: true, lastName: true, phone: true },
      });
    }
    return existingPatient;
  }
  if (!parsedProvidedName || !hasValidLastName(parsedProvidedName.lastName)) return null;
  return createPatientFromWhatsAppName(clinicId, phone, providedName!.trim());
};

const saveWhatsAppConversationMessage = async (args: {
  clinicId: string;
  patientId: string;
  phone: string;
  providerMessageId?: string | null;
  direction: 'incoming' | 'outgoing';
  text: string;
  rawPayload?: Record<string, unknown> | null;
}) => {
  try {
    return await prisma.whatsAppConversationMessage.create({
      data: {
        clinicId: args.clinicId,
        patientId: args.patientId,
        phone: normalizePhone(args.phone),
        providerMessageId: args.providerMessageId ?? null,
        direction: args.direction,
        text: args.text,
        rawPayload: args.rawPayload ? args.rawPayload as Prisma.InputJsonValue : Prisma.DbNull,
      },
    });
  } catch (error) {
    if (args.providerMessageId && isPrismaUniqueConstraintError(error)) {
      throw new Error('DUPLICATE_WHATSAPP_MESSAGE');
    }
    throw error;
  }
};

const loadRecentWhatsAppAgentMessages = async (clinicId: string, patientId?: string | null, phone?: string | null) => {
  // Hasta kaydı varsa patientId ile sorgula (daha verimli index kullanır).
  // Hasta kaydı henüz oluşturulmamışsa (ilk temas) telefon numarasıyla sorgula.
  const where = patientId
    ? { clinicId, patientId }
    : phone
      ? { clinicId, phone: normalizePhone(phone) }
      : null;
  if (!where) return [];
  const messages = await prisma.whatsAppConversationMessage.findMany({
    where,
    select: { direction: true, text: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  return messages.reverse().map(message => ({
    direction: message.direction === 'outgoing' ? 'outgoing' as const : 'incoming' as const,
    text: message.text,
  }));
};

const hasProcessedWhatsAppProviderMessage = async (clinicId: string, phone: string, providerMessageId?: string | null) => {
  if (!providerMessageId?.trim()) return false;
  const [message, state] = await Promise.all([
    prisma.whatsAppConversationMessage.findFirst({
      where: { clinicId, providerMessageId },
      select: { id: true },
    }),
    prisma.whatsAppConversationState.findUnique({
      where: { clinicId_phone: { clinicId, phone: normalizePhone(phone) } },
      select: { lastProviderMessageId: true },
    }),
  ]);
  return Boolean(message || state?.lastProviderMessageId === providerMessageId);
};

const markWhatsAppProviderMessageProcessed = async (clinicId: string, phone: string, providerMessageId?: string | null) => {
  if (!providerMessageId?.trim()) return null;
  return prisma.whatsAppConversationState.upsert({
    where: { clinicId_phone: { clinicId, phone: normalizePhone(phone) } },
    update: { lastProviderMessageId: providerMessageId },
    create: {
      clinicId,
      phone: normalizePhone(phone),
      lastProviderMessageId: providerMessageId,
      stateJson: Prisma.DbNull,
    },
  });
};

const ensurePatientForWhatsApp = async (clinicId: string, phone: string, customerName: string) => {
  const patient = await ensureWhatsAppContactPatient(clinicId, phone, customerName);
  if (!patient) throw new Error('PATIENT_NAME_REQUIRED');
  return patient;
};

const getAppointmentsForPhone = async (clinicId: string, phone: string) => {
  const preferences = await getClinicOperatingPreferences(clinicId);
  const timeZone = preferences.timezone || 'Europe/Istanbul';
  const now = new Date();
  const normalizedPhone = normalizePhone(phone);
  const patient = await findExistingPatientByPhone(clinicId, phone);

  const [appointments, pendingRequests] = await Promise.all([
    patient ? prisma.appointment.findMany({
      where: {
        clinicId, deletedAt: null, status: { notIn: ['cancelled', 'no_show'] },
        patientId: patient.id,
      },
      select: {
        id: true, startTime: true, endTime: true, status: true,
        appointmentType: { select: { name: true } },
        practitioner: { select: { firstName: true, lastName: true } },
      },
      orderBy: { startTime: 'asc' },
      take: 10,
    }) : Promise.resolve([]),
    // Onay bekleyen veya onaylanmış appointment request'leri de dahil et
    prisma.appointmentRequest.findMany({
      where: {
        clinicId,
        phone: normalizedPhone,
        requestType: 'appointment',
        status: { in: ['pending', 'approved'] },
        OR: [
          { preferredStartTime: { not: null } },
          { preferredEndTime: { not: null } },
          { practitionerId: { not: null } },
          { appointmentTypeId: { not: null } },
        ],
      },
      select: {
        id: true, preferredStartTime: true, preferredEndTime: true, status: true, convertedAppointmentId: true,
        appointmentType: { select: { name: true } },
        practitioner: { select: { firstName: true, lastName: true } },
        notes: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);

  const appointmentSummaries: SavedAppointmentSummary[] = appointments.map(a => {
    const start = formatClinicDateTime(a.startTime, timeZone);
    return {
      id: a.id,
      dateKey: start.date,
      date: formatDateWithClinicPreference(a.startTime, preferences),
      startTime: formatTimeWithClinicPreference(a.startTime, preferences),
      endTime: formatTimeWithClinicPreference(a.endTime, preferences),
      serviceName: a.appointmentType?.name ?? null,
      practitionerName: a.practitioner ? `${a.practitioner.firstName} ${a.practitioner.lastName}` : null,
      status: formatAppointmentStatusLabel(a.status, 'appointment'),
      rawStatus: a.status,
      sourceType: 'appointment',
      startsAt: a.startTime.toISOString(),
    };
  });

  const requestSummaries: SavedAppointmentSummary[] = pendingRequests.filter(r => !r.convertedAppointmentId).map(r => {
    const start = r.preferredStartTime ? formatClinicDateTime(r.preferredStartTime, timeZone) : null;
    const isGeneralAssessment = !r.appointmentType || r.notes?.includes('genel muayene');
    return {
      id: r.id,
      dateKey: start?.date ?? null,
      date: r.preferredStartTime ? formatDateWithClinicPreference(r.preferredStartTime, preferences) : 'Tarih netleşmedi',
      startTime: r.preferredStartTime ? formatTimeWithClinicPreference(r.preferredStartTime, preferences) : 'Saat netleşmedi',
      endTime: r.preferredEndTime ? formatTimeWithClinicPreference(r.preferredEndTime, preferences) : '',
      serviceName: r.appointmentType?.name ?? (isGeneralAssessment ? 'Genel muayene / acil değerlendirme' : null),
      practitionerName: r.practitioner ? `${r.practitioner.firstName} ${r.practitioner.lastName}` : null,
      rawStatus: r.status,
      sourceType: 'appointment_request',
      startsAt: r.preferredStartTime?.toISOString() ?? null,
      status: formatAppointmentStatusLabel(r.status, 'appointment_request'),
    };
  });

  return [...appointmentSummaries, ...requestSummaries]
    .sort((left, right) => {
      if (!left.startsAt && !right.startsAt) return 0;
      if (!left.startsAt) return 1;
      if (!right.startsAt) return -1;
      const leftTime = new Date(left.startsAt).getTime();
      const rightTime = new Date(right.startsAt).getTime();
      const leftFuture = leftTime >= now.getTime();
      const rightFuture = rightTime >= now.getTime();
      if (leftFuture !== rightFuture) return leftFuture ? -1 : 1;
      return leftFuture ? leftTime - rightTime : rightTime - leftTime;
    })
    .slice(0, 10);
};

const createAppointmentRequestFromAssistant = async (
  clinicId: string, phone: string, customerName: string,
  appointmentTypeId: string, selectedSlot: SavedAvailableSlot, rawMessage?: string | null
) => {
  const patient = await ensurePatientForWhatsApp(clinicId, phone, customerName);
  const startTime = new Date(selectedSlot.startTime);
  const endTime = new Date(selectedSlot.endTime);

  // Availability check is against stable schedule data (doctor hours/off-days)
  // and can safely run outside the transaction.
  const availability = await checkPractitionerAvailabilityForSlot(clinicId, selectedSlot.practitionerId, startTime, endTime);
  if (!availability.ok) throw new SlotConflictError('APPOINTMENT_OUTSIDE_AVAILABILITY');

  // 1. Advisory lock  →  2. overlap re-check  →  3. create — all inside one tx.
  // The lock serializes concurrent writes for the same slot; under PostgreSQL
  // READ COMMITTED a $transaction alone is not sufficient (two tx can both read
  // "no conflict" before either commits its row).
  const request = await prisma.$transaction(async (tx) => {
    await acquireAppointmentSlotLock(tx, {
      clinicId,
      practitionerId: selectedSlot.practitionerId,
      startTime,
    });

    await assertSlotAvailable(tx, {
      clinicId,
      practitionerId: selectedSlot.practitionerId,
      startTime,
      endTime,
    });

    return tx.appointmentRequest.create({
      data: {
        clinicId, patientId: patient.id,
        patientName: getPatientFullName(patient), phone: normalizePhone(phone), appointmentTypeId,
        practitionerId: selectedSlot.practitionerId, preferredStartTime: startTime, preferredEndTime: endTime,
        requestType: 'appointment', source: 'whatsapp', status: 'pending',
        externalSenderId: normalizePhone(phone),
        sourceConversationId: normalizePhone(phone),
        rawMessage: rawMessage ?? null,
        notes: 'WhatsApp assistant üzerinden personel onayına gönderildi.',
      },
      include: {
        appointmentType: { select: { name: true } },
        practitioner: { select: { firstName: true, lastName: true } },
      },
    });
  });

  // Logging runs after the transaction commits.
  console.info('[appointment-request] created', {
    channel: 'whatsapp',
    clinicId: summarizeIdentifier(clinicId),
    inboxEntryId: null,
    conversationId: redactPhone(phone),
    patientId: summarizeIdentifier(patient.id),
    serviceId: summarizeIdentifier(appointmentTypeId),
    serviceName: request.appointmentType?.name ?? null,
    practitionerId: summarizeIdentifier(selectedSlot.practitionerId),
    practitionerName: request.practitioner
      ? `${request.practitioner.firstName} ${request.practitioner.lastName}`
      : null,
    requestedDateTime: startTime.toISOString(),
    requestId: summarizeIdentifier(request.id),
  });

  const systemUserId = await getClinicSystemUserId(clinicId);
  if (systemUserId) {
    await logActivity({
      clinicId, userId: systemUserId,
      entityType: 'appointment_request', entityId: request.id,
      action: 'created',
      description: 'WhatsApp appointment request created for staff approval',
      patientId: patient.id,
      metadata: { systemGenerated: true, source: 'whatsapp', phone: normalizePhone(phone) },
    });
  }

  return request;
};

const cancelAppointmentForPhone = async (clinicId: string, appointmentId: string, phone: string) => {
  const patient = await findExistingPatientByPhone(clinicId, phone);
  if (!patient) return null;

  const appointment = await prisma.appointment.findFirst({
    where: {
      id: appointmentId, clinicId, deletedAt: null,
      status: { notIn: ['cancelled'] },
      patientId: patient.id,
    },
    include: { appointmentType: { select: { name: true } }, practitioner: { select: { firstName: true, lastName: true } } },
  });
  if (!appointment) return null;

  const cancelled = await prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      status: 'cancelled',
      cancellationReason: 'WhatsApp assistant tarafından iptal edildi.',
      notes: appointment.notes ? `${appointment.notes}\nWhatsApp assistant tarafından iptal edildi.` : 'WhatsApp assistant tarafından iptal edildi.',
    },
    include: { appointmentType: { select: { name: true } }, practitioner: { select: { firstName: true, lastName: true } } },
  });

  const systemUserId = await getClinicSystemUserId(clinicId);
  if (systemUserId) {
    await logActivity({
      clinicId, userId: systemUserId,
      entityType: 'appointment', entityId: cancelled.id,
      action: 'cancelled',
      description: 'Appointment cancelled by WhatsApp assistant',
      patientId: cancelled.patientId,
      appointmentId: cancelled.id,
      metadata: { systemGenerated: true, source: 'whatsapp', phone: normalizePhone(phone) },
    });
  }

  return cancelled;
};

const handleCancelIntent = async (clinicId: string, phone: string) => {
  const appointments = await getAppointmentsForPhone(clinicId, phone);
  if (appointments.length === 0) {
    await resetWhatsAppConversationState(clinicId, phone);
    return 'İptal edilebilecek aktif bir randevu bulamadım.';
  }
  await upsertWhatsAppConversationState(clinicId, phone, {
    currentIntent: 'cancel_appointment',
    step: 'awaiting_cancel_selection',
    stateJson: { cancellableAppointments: appointments },
  });
  return ['İptal etmek istediğiniz randevuyu seçer misiniz?',
    ...appointments.map((a, i) => `${i + 1}. ${a.date} ${a.startTime} - ${a.serviceName ?? 'Hizmet bilgisi yok'}`),
  ].join('\n');
};

const getPreferredTimeRangeFromText = (text: string): ConversationStateJson['preferredTimeRange'] => {
  const interpreted = interpretTimeRequest(text);
  if (interpreted.rangeStartMinutes !== null && interpreted.rangeEndMinutes !== null) {
    return {
      startTime: minutesToTime(interpreted.rangeStartMinutes),
      endTime: minutesToTime(interpreted.rangeEndMinutes),
    };
  }
  if (interpreted.exactTime) {
    return { startTime: interpreted.exactTime, endTime: null };
  }
  if (interpreted.afterTimeMinutes !== null) {
    return { startTime: minutesToTime(interpreted.afterTimeMinutes), endTime: null };
  }
  return undefined;
};

const mergePreferredTimeRange = (
  previous: ConversationStateJson['preferredTimeRange'],
  next: ConversationStateJson['preferredTimeRange'],
) => next?.startTime || next?.endTime ? next : previous;

const formatPreferredTimeRange = (range: ConversationStateJson['preferredTimeRange']) => {
  if (!range?.startTime) return null;
  if (range.endTime) return `${range.startTime}-${range.endTime} arası`;
  return `${range.startTime} sonrası`;
};

const prefersGeneralAssessment = (text: string) => {
  const normalized = normalizeTurkishSearchText(text);
  return [
    'hizmet adini bilmiyorum',
    'hangi hizmet oldugunu bilmiyorum',
    'tam bilmiyorum',
    'bilmiyorum sadece',
    'genel muayene',
    'acil degerlendirme',
    'muayene olsun',
  ].some(pattern => normalized.includes(pattern));
};

const buildGeneralAssessmentPrompt = (args: {
  text: string;
  customerName?: string | null;
  symptom: boolean;
  preferredTimeRange?: ConversationStateJson['preferredTimeRange'];
}) => {
  const rangeText = formatPreferredTimeRange(args.preferredTimeRange);
  const firstName = getFirstNameFromCustomerName(args.customerName);
  const prefix = args.symptom
    ? 'Geçmiş olsun. Hizmet adını bilmeniz gerekmiyor. Diş ağrısı veya benzer şikayetler için sizi genel muayene ya da acil değerlendirme randevusuna yönlendirebilirim.'
    : 'Anladım. Hizmet adını bilmeniz gerekmiyor; genel muayene veya acil değerlendirme randevusu olarak ilerleyebiliriz.';
  const rangeSentence = rangeText ? ` ${rangeText} müsait olduğunuzu not aldım.` : '';
  const question = ' Hangi gün gelmek istersiniz?';
  return `${firstName ? `${firstName}, ` : ''}${prefix}${rangeSentence}${question}`;
};

const getRequestPatientName = (customerName: string | null | undefined, input: NormalizedWhatsAppMessage) =>
  customerName?.trim() || input.name?.trim() || 'WhatsApp kullanıcısı';

const createWhatsAppStaffRequest = async (args: {
  clinicId: string;
  phone: string;
  patientName: string;
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
      clinicId: args.clinicId,
      patientId: args.patientId ?? null,
      patientName: args.patientName,
      phone: normalizePhone(args.phone),
      appointmentTypeId: args.appointmentTypeId ?? null,
      practitionerId: args.practitionerId ?? null,
      preferredStartTime: args.preferredStartTime ?? null,
      preferredEndTime: args.preferredEndTime ?? null,
      requestType: args.requestType,
      source: 'whatsapp',
      externalSenderId: normalizePhone(args.phone),
      sourceConversationId: normalizePhone(args.phone),
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
    channel: 'whatsapp',
    clinicId: summarizeIdentifier(args.clinicId),
    inboxEntryId: null,
    conversationId: redactPhone(args.phone),
    patientId: summarizeIdentifier(args.patientId),
    serviceId: summarizeIdentifier(args.appointmentTypeId),
    serviceName: request.appointmentType?.name ?? null,
    practitionerId: summarizeIdentifier(args.practitionerId),
    practitionerName: request.practitioner
      ? `${request.practitioner.firstName} ${request.practitioner.lastName}`
      : null,
    requestedDateTime: args.preferredStartTime?.toISOString() ?? null,
    requestId: summarizeIdentifier(request.id),
  });

  return request;
};

const handleHumanHandoffIntent = async (
  clinicId: string,
  input: NormalizedWhatsAppMessage,
  customerName: string | null | undefined,
) => {
  const existingPatient = await findExistingPatientByPhone(clinicId, input.phone);
  const contactRequest = await upsertContactRequest({
    clinicId,
    channel: 'whatsapp',
    externalSenderId: normalizePhone(input.phone),
    patientId: existingPatient?.id ?? null,
    phone: normalizePhone(input.phone),
    name: getRequestPatientName(customerName, input),
    type: 'staff_handoff',
    note: `WhatsApp üzerinden insan yetkili talebi alındı.\nİlk mesaj: ${input.text}`.slice(0, 2000),
    lastMessage: input.text.slice(0, 500),
    sourceConversationId: normalizePhone(input.phone),
  });

  await upsertWhatsAppConversationState(clinicId, input.phone, {
    customerName: customerName ?? input.name ?? null,
    currentIntent: 'human_handoff',
    step: 'awaiting_handoff_note',
    lastMessage: input.text,
    stateJson: { pendingHandoffRequestId: contactRequest.id },
    selectedAppointmentTypeId: null,
    selectedAppointmentTypeName: null,
    selectedPractitionerId: null,
    selectedDate: null,
    selectedTime: null,
  });

  const firstName = getFirstNameFromCustomerName(customerName ?? input.name ?? null);
  return `${firstName ? `Elbette ${firstName}.` : 'Elbette.'} Talebinizi yetkili ekibe iletiyorum. Klinik ekibinden biri size en kısa sürede dönüş yapacak. Konu hakkında kısa bir not bırakmak ister misiniz?`;
};

const handleHandoffNote = async (
  clinicId: string,
  input: NormalizedWhatsAppMessage,
  customerName: string | null | undefined,
  stateJson: ConversationStateJson,
) => {
  const note = input.text.trim();
  if (stateJson.pendingHandoffRequestId) {
    // Update the open ContactRequest that was created when handoff started
    await prisma.contactRequest.updateMany({
      where: { id: stateJson.pendingHandoffRequestId, clinicId },
      data: {
        note: `WhatsApp üzerinden insan yetkili talebi alındı.\nKullanıcı notu: ${note}`.slice(0, 2000),
        lastMessage: note.slice(0, 500),
      },
    });
  } else {
    const existingPatient = await findExistingPatientByPhone(clinicId, input.phone);
    await upsertContactRequest({
      clinicId,
      channel: 'whatsapp',
      externalSenderId: normalizePhone(input.phone),
      patientId: existingPatient?.id ?? null,
      phone: normalizePhone(input.phone),
      name: getRequestPatientName(customerName, input),
      type: 'staff_handoff',
      note: `WhatsApp yetkili görüşme notu: ${note}`.slice(0, 2000),
      lastMessage: note.slice(0, 500),
      sourceConversationId: normalizePhone(input.phone),
    });
  }

  await resetWhatsAppConversationState(clinicId, input.phone, customerName);
  return 'Notunuzu ekledim. Yetkili ekip en kısa sürede size dönüş yapacak.';
};

const getActiveDoctorCountForClinic = async (clinicId: string) => {
  const assignments = await prisma.userClinic.findMany({
    where: {
      clinicId,
      isActive: true,
      user: { isActive: true },
      OR: [{ role: 'DENTIST' }, { role: 'dentist' }, { role: 'doctor' }],
    },
    select: { userId: true },
  });
  const assignedIds = assignments.map(item => item.userId);
  const legacyDoctors = await prisma.user.findMany({
    where: {
      clinicId,
      isActive: true,
      role: { in: ['doctor', 'DENTIST', 'dentist'] },
      id: { notIn: assignedIds },
    },
    select: { id: true },
  });
  return new Set([...assignedIds, ...legacyDoctors.map(user => user.id)]).size;
};

const getClinicPractitioners = async (clinicId: string): Promise<{ id: string; firstName: string; lastName: string }[]> => {
  const assignments = await prisma.userClinic.findMany({
    where: {
      clinicId,
      isActive: true,
      user: { isActive: true },
      OR: [{ role: 'DENTIST' }, { role: 'dentist' }, { role: 'doctor' }],
    },
    select: { userId: true, user: { select: { id: true, firstName: true, lastName: true } } },
  });
  const assignedIds = new Set(assignments.map(a => a.userId));
  const assignedDoctors = assignments.map(a => ({ id: a.user.id, firstName: a.user.firstName, lastName: a.user.lastName }));
  const legacyDoctors = await prisma.user.findMany({
    where: {
      clinicId,
      isActive: true,
      role: { in: ['doctor', 'DENTIST', 'dentist'] },
      id: { notIn: [...assignedIds] },
    },
    select: { id: true, firstName: true, lastName: true },
  });
  return [...assignedDoctors, ...legacyDoctors];
};

const loadWhatsAppAgentClinicFacts = async (
  clinic: NonNullable<Awaited<ReturnType<typeof getDefaultClinic>>>,
) => {
  const [doctorCount, workingHoursCount] = await Promise.all([
    getActiveDoctorCountForClinic(clinic.id),
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

const TURKISH_WEEKDAY_LABELS: Record<number, string> = {
  0: 'Pazar',
  1: 'Pazartesi',
  2: 'Salı',
  3: 'Çarşamba',
  4: 'Perşembe',
  5: 'Cuma',
  6: 'Cumartesi',
};

const answerClinicWorkingHoursInfo = async (
  clinic: NonNullable<Awaited<ReturnType<typeof getDefaultClinic>>>,
  text: string,
) => {
  const rows = await prisma.clinicWorkingHours.findMany({
    where: { clinicId: clinic.id },
    select: { dayOfWeek: true, isClosed: true },
    orderBy: { dayOfWeek: 'asc' },
  });
  if (rows.length === 0) return null;

  const normalized = normalizeTurkishSearchText(text);
  const timeZone = clinic.timezone || WHATSAPP_ASSISTANT_TIME_ZONE;
  const currentWeekday = getZonedDateParts(new Date(), timeZone).weekday;
  const targetWeekday = normalized.includes('yarin')
    ? (currentWeekday + 1) % 7
    : normalized.includes('bugun')
      ? currentWeekday
      : null;

  if (targetWeekday !== null) {
    const row = rows.find(item => item.dayOfWeek === targetWeekday);
    if (row) {
      return row.isClosed
        ? `${TURKISH_WEEKDAY_LABELS[targetWeekday]} günü sistemde kapalı gün olarak görünüyor. Net çalışma saati aralığını sistemde göremiyorum.`
        : `${TURKISH_WEEKDAY_LABELS[targetWeekday]} günü sistemde açık gün olarak görünüyor. Net çalışma saati aralığını sistemde göremiyorum.`;
    }
  }

  const closedDays = rows.filter(row => row.isClosed).map(row => TURKISH_WEEKDAY_LABELS[row.dayOfWeek]).filter(Boolean);
  if (closedDays.length > 0) {
    return `Sistemde kapalı gün kaydı olarak ${closedDays.join(', ')} görünüyor. Net çalışma saatleri veya öğle arası saat aralığını sistemde göremiyorum.`;
  }

  return 'Sistemde çalışma günü kayıtları var, ancak net çalışma saatleri veya öğle arası saat aralığını göremiyorum.';
};

const formatBookingContinuation = (currentStep: AssistantStep | 'main_menu' | null, selectedDate?: string | null) => {
  if (currentStep === 'awaiting_service') {
    return ' Randevu için hizmet adını bilmiyorsanız genel muayene veya acil değerlendirme olarak ilerleyebiliriz. Hangi gün gelmek istersiniz?';
  }
  if (currentStep === 'awaiting_date' || currentStep === 'awaiting_general_date') {
    return ' Randevu akışına devam edebiliriz. Hangi gün için bakmamı istersiniz?';
  }
  if (currentStep === 'awaiting_time') {
    return selectedDate
      ? ' Randevu akışına devam edebiliriz. Size uygun saati veya saat aralığını yazabilirsiniz.'
      : ' Randevu akışına devam edebiliriz. Hangi gün için bakmamı istersiniz?';
  }
  if (currentStep === 'awaiting_confirmation') {
    return ' Randevu talebini oluşturmamı onaylamak isterseniz “evet” yazabilirsiniz.';
  }
  return '';
};

const answerClinicInfo = async (
  clinic: NonNullable<Awaited<ReturnType<typeof getDefaultClinic>>>,
  text: string,
  currentStep: AssistantStep | 'main_menu' | null,
  selectedDate?: string | null,
) => {
  const normalized = normalizeTurkishSearchText(text);
  let answer: string | null = null;

  if (normalized.includes('kac doktor') || normalized.includes('doktor sayisi') || normalized.includes('hekim sayisi') || normalized.includes('kac hekim') || normalized.includes('calisan doktor')) {
    const doctorCount = await getActiveDoctorCountForClinic(clinic.id);
    answer = doctorCount > 0
      ? `Sistemde bu klinik için ${doctorCount} aktif hekim kayıtlı görünüyor.`
      : 'Bu bilgiyi sistemde net olarak göremiyorum. İsterseniz talebinizi yetkili ekibe iletebilirim.';
  } else if (normalized.includes('adres') || normalized.includes('neredesiniz') || normalized.includes('konum')) {
    answer = clinic.address?.trim()
      ? `Klinik adresi: ${clinic.address.trim()}`
      : 'Bu bilgiyi sistemde net olarak göremiyorum. İsterseniz talebinizi yetkili ekibe iletebilirim.';
  } else if (normalized.includes('telefon')) {
    answer = clinic.phone?.trim()
      ? `Klinik telefon numarası: ${clinic.phone.trim()}`
      : 'Bu bilgiyi sistemde net olarak göremiyorum. İsterseniz talebinizi yetkili ekibe iletebilirim.';
  } else if (normalized.includes('mail') || normalized.includes('email')) {
    answer = clinic.email?.trim()
      ? `Klinik e-posta adresi: ${clinic.email.trim()}`
      : 'Bu bilgiyi sistemde net olarak göremiyorum. İsterseniz talebinizi yetkili ekibe iletebilirim.';
  } else if (normalized.includes('web')) {
    answer = clinic.website?.trim()
      ? `Klinik web sitesi: ${clinic.website.trim()}`
      : 'Bu bilgiyi sistemde net olarak göremiyorum. İsterseniz talebinizi yetkili ekibe iletebilirim.';
  } else if (isClinicHoursQuestion(text) || normalized.includes('ogle arasi') || normalized.includes('ogle molasi')) {
    const workingHoursAnswer = await answerClinicWorkingHoursInfo(clinic, text);
    answer = workingHoursAnswer
      ? `${workingHoursAnswer} İsterseniz randevu uygunluğunu gün ve saat tercihinize göre kontrol edebilirim.`
      : 'Çalışma saatleri veya öğle arası bilgisini sistemde net saat aralığı olarak göremiyorum. İsterseniz randevu uygunluğunu gün ve saat tercihinize göre kontrol edebilirim.';
  }

  return `${answer ?? 'Bu bilgiyi sistemde net olarak göremiyorum. İsterseniz talebinizi yetkili ekibe iletebilirim.'}${formatBookingContinuation(currentStep, selectedDate)}`;
};

const answerSmallTalk = (
  clinic: NonNullable<Awaited<ReturnType<typeof getDefaultClinic>>>,
  text: string,
  currentStep: AssistantStep | 'main_menu' | null,
  selectedDate?: string | null,
) => {
  const normalized = normalizeTurkishSearchText(text);
  if (normalized.includes('saat kac') || normalized.includes('saat kactir') || normalized.includes('su an saat')) {
    const timeZone = clinic.timezone || WHATSAPP_ASSISTANT_TIME_ZONE;
    const time = new Intl.DateTimeFormat('tr-TR', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());
    return `Klinik saatine göre şu an saat ${time}.${formatBookingContinuation(currentStep, selectedDate)}`;
  }
  return `Ben randevu, klinik bilgisi ve yetkili ekibe yönlendirme konularında yardımcı olabilirim.${formatBookingContinuation(currentStep, selectedDate)}`;
};

const createGeneralAppointmentRequest = async (args: {
  clinic: NonNullable<Awaited<ReturnType<typeof getDefaultClinic>>>;
  input: NormalizedWhatsAppMessage;
  customerName?: string | null;
  selectedDate: string;
  preferredTimeRange?: ConversationStateJson['preferredTimeRange'];
  reason?: string | null;
  selectedPractitionerId?: string | null;
}) => {
  const existingPatient = await findExistingPatientByPhone(args.clinic.id, args.input.phone);
  const patientName = getRequestPatientName(args.customerName, args.input);
  const timeZone = args.clinic.timezone || WHATSAPP_ASSISTANT_TIME_ZONE;
  const startTime = args.preferredTimeRange?.startTime
    ? localDateTimeToClinicDate(args.selectedDate, args.preferredTimeRange.startTime, timeZone)
    : null;
  const endTime = args.preferredTimeRange?.endTime
    ? localDateTimeToClinicDate(args.selectedDate, args.preferredTimeRange.endTime, timeZone)
    : null;
  const rangeText = formatPreferredTimeRange(args.preferredTimeRange);

  const request = await createWhatsAppStaffRequest({
    clinicId: args.clinic.id,
    phone: args.input.phone,
    patientId: existingPatient?.id ?? null,
    patientName,
    requestType: 'appointment',
    rawMessage: args.input.text,
    preferredStartTime: startTime,
    preferredEndTime: endTime,
    appointmentTypeId: null,
    practitionerId: args.selectedPractitionerId ?? null,
    notes: [
      'WhatsApp asistanı genel muayene / acil değerlendirme yönlendirmesi olarak aldı.',
      'Tıbbi teşhis veya tedavi önerisi verilmedi.',
      args.reason ? `Kullanıcı ifadesi: ${args.reason}` : null,
      rangeText ? `Saat tercihi: ${rangeText}` : null,
    ].filter(Boolean).join('\n'),
  });

  const systemUserId = await getClinicSystemUserId(args.clinic.id);
  if (systemUserId) {
    await logActivity({
      clinicId: args.clinic.id,
      userId: systemUserId,
      entityType: 'appointment_request',
      entityId: request.id,
      action: 'created',
      description: 'WhatsApp general assessment request created for staff approval',
      patientId: existingPatient?.id,
      metadata: { systemGenerated: true, source: 'whatsapp', phone: normalizePhone(args.input.phone) },
    });
  }

  await resetWhatsAppConversationState(args.clinic.id, args.input.phone, args.customerName ?? patientName);
  const dateText = formatTurkishDateLong(args.selectedDate, timeZone);
  return `Talebinizi klinik onay ekranına aldım. Genel muayene / acil değerlendirme için ${dateText}${rangeText ? `, ${rangeText}` : ''} tercihiniz personel tarafından kontrol edilecek. Klinik ekibi size uygunluk bilgisini iletecek.`;
};

const handleGeneralAssessmentStart = async (args: {
  clinicId: string;
  input: NormalizedWhatsAppMessage;
  customerName?: string | null;
  symptom: boolean;
}) => {
  const preferredTimeRange = getPreferredTimeRangeFromText(args.input.text);
  await upsertWhatsAppConversationState(args.clinicId, args.input.phone, {
    customerName: args.customerName ?? null,
    currentIntent: args.symptom ? 'symptom_or_complaint' : 'book_appointment',
    step: 'awaiting_general_date',
    selectedAppointmentTypeId: null,
    selectedAppointmentTypeName: 'Genel muayene / acil değerlendirme',
    selectedDate: null,
    selectedTime: null,
    lastMessage: args.input.text,
    stateJson: {
      generalRequestReason: args.input.text,
      preferredTimeRange,
    },
  });
  return buildGeneralAssessmentPrompt({
    text: args.input.text,
    customerName: args.customerName,
    symptom: args.symptom,
    preferredTimeRange,
  });
};

const handleGeneralDateStep = async (args: {
  clinic: NonNullable<Awaited<ReturnType<typeof getDefaultClinic>>>;
  input: NormalizedWhatsAppMessage;
  customerName?: string | null;
  stateJson: ConversationStateJson;
}) => {
  const normalizedDate = normalizeDateFromTurkishInput(args.input.text, new Date(), args.clinic.timezone || WHATSAPP_ASSISTANT_TIME_ZONE)
    ?? await normalizeDateWithGoogleAi(args.input.text, new Date().toISOString().slice(0, 10), args.clinic.timezone || WHATSAPP_ASSISTANT_TIME_ZONE);
  const nextRange = getPreferredTimeRangeFromText(args.input.text);
  const preferredTimeRange = mergePreferredTimeRange(args.stateJson.preferredTimeRange, nextRange);
  if (!normalizedDate) {
    await upsertWhatsAppConversationState(args.clinic.id, args.input.phone, {
      customerName: args.customerName ?? null,
      currentIntent: 'book_appointment',
      step: 'awaiting_general_date',
      selectedAppointmentTypeName: 'Genel muayene / acil değerlendirme',
      lastMessage: args.input.text,
      stateJson: {
        generalRequestReason: args.stateJson.generalRequestReason ?? args.input.text,
        preferredTimeRange,
      },
    });
    return 'Hangi gün gelmek istediğinizi anlayamadım. Örneğin bugün, yarın veya 16 Mayıs yazabilirsiniz.';
  }

  await upsertWhatsAppConversationState(args.clinic.id, args.input.phone, {
    customerName: args.customerName ?? null,
    currentIntent: 'book_appointment',
    step: 'awaiting_general_time',
    selectedAppointmentTypeName: 'Genel muayene / acil değerlendirme',
    selectedDate: normalizedDate,
    lastMessage: args.input.text,
    stateJson: {
      generalRequestReason: args.stateJson.generalRequestReason ?? args.input.text,
      preferredTimeRange,
    },
  });

  if (!preferredTimeRange?.startTime) {
    return `${formatTurkishDateLong(normalizedDate, args.clinic.timezone || WHATSAPP_ASSISTANT_TIME_ZONE)} için not aldım. Hangi saat aralığında müsaitsiniz?`;
  }

  return createGeneralAppointmentRequest({
    clinic: args.clinic,
    input: args.input,
    customerName: args.customerName,
    selectedDate: normalizedDate,
    preferredTimeRange,
    reason: args.stateJson.generalRequestReason ?? args.input.text,
  });
};

const handleGeneralTimeStep = async (args: {
  clinic: NonNullable<Awaited<ReturnType<typeof getDefaultClinic>>>;
  input: NormalizedWhatsAppMessage;
  customerName?: string | null;
  selectedDate?: string | null;
  stateJson: ConversationStateJson;
}) => {
  if (!args.selectedDate) {
    return handleGeneralDateStep({
      clinic: args.clinic,
      input: args.input,
      customerName: args.customerName,
      stateJson: args.stateJson,
    });
  }
  const preferredTimeRange = mergePreferredTimeRange(args.stateJson.preferredTimeRange, getPreferredTimeRangeFromText(args.input.text));
  if (!preferredTimeRange?.startTime) {
    await upsertWhatsAppConversationState(args.clinic.id, args.input.phone, {
      customerName: args.customerName ?? null,
      currentIntent: 'book_appointment',
      step: 'awaiting_general_time',
      selectedAppointmentTypeName: 'Genel muayene / acil değerlendirme',
      selectedDate: args.selectedDate,
      lastMessage: args.input.text,
      stateJson: {
        generalRequestReason: args.stateJson.generalRequestReason ?? args.input.text,
        preferredTimeRange,
      },
    });
    return 'Saat aralığını anlayamadım. Örneğin 12 ile 14 arası, 15:00 veya 16:00 sonrası yazabilirsiniz.';
  }

  // Saat tercihi alındı — hekim tercihi sor
  const practitioners = await getClinicPractitioners(args.clinic.id);
  if (practitioners.length === 0) {
    // Hekim kaydı yoksa direkt talebi oluştur
    return createGeneralAppointmentRequest({
      clinic: args.clinic,
      input: args.input,
      customerName: args.customerName,
      selectedDate: args.selectedDate,
      preferredTimeRange,
      reason: args.stateJson.generalRequestReason ?? args.input.text,
    });
  }

  const practitionerOptions = practitioners.map(p => ({ id: p.id, name: `Dt. ${p.firstName} ${p.lastName}` }));
  await upsertWhatsAppConversationState(args.clinic.id, args.input.phone, {
    customerName: args.customerName ?? null,
    currentIntent: 'book_appointment',
    step: 'awaiting_general_practitioner',
    selectedAppointmentTypeName: 'Genel muayene / acil değerlendirme',
    selectedDate: args.selectedDate,
    lastMessage: args.input.text,
    stateJson: {
      generalRequestReason: args.stateJson.generalRequestReason ?? args.input.text,
      preferredTimeRange,
      practitionerOptions,
    },
  });

  return [
    'Belirli bir hekimimizle görüşmek ister misiniz?',
    ...practitionerOptions.map((p, i) => `${i + 1}. ${p.name}`),
    `${practitionerOptions.length + 1}. Fark etmez, klinik ekibi atasın`,
  ].join('\n');
};

const handleGeneralPractitionerStep = async (args: {
  clinic: NonNullable<Awaited<ReturnType<typeof getDefaultClinic>>>;
  input: NormalizedWhatsAppMessage;
  customerName?: string | null;
  selectedDate?: string | null;
  stateJson: ConversationStateJson;
}) => {
  if (!args.selectedDate) {
    return handleGeneralDateStep({
      clinic: args.clinic,
      input: args.input,
      customerName: args.customerName,
      stateJson: args.stateJson,
    });
  }

  const options = args.stateJson.practitionerOptions ?? [];
  const preferredTimeRange = args.stateJson.preferredTimeRange;
  const normalized = normalizeIntentText(args.input.text);
  const normalizedSearch = normalizeTurkishSearchText(args.input.text);

  let selectedPractitionerId: string | null = null;

  if (/^\d+$/.test(normalized)) {
    const idx = Number(normalized) - 1;
    if (idx >= 0 && idx < options.length) {
      selectedPractitionerId = options[idx].id;
    }
    // idx === options.length → "Fark etmez" seçeneği, null kalır
  } else if (/fark etmez|herhangi|siz ata|siz secin|atayin|atasin|farketmez/.test(normalizedSearch)) {
    selectedPractitionerId = null;
  } else {
    // İsim bazlı eşleştirme
    const matched = options.find(p =>
      normalizeTurkishSearchText(p.name).includes(normalizedSearch)
      || normalizedSearch.includes(normalizeTurkishSearchText(p.name).replace(/^dt\.\s*/, ''))
    );
    if (matched) {
      selectedPractitionerId = matched.id;
    } else {
      // Seçim anlaşılamadıysa tekrar sor
      return [
        'Hekim seçiminizi anlayamadım. Lütfen bir numara seçin:',
        ...options.map((p, i) => `${i + 1}. ${p.name}`),
        `${options.length + 1}. Fark etmez, klinik ekibi atasın`,
      ].join('\n');
    }
  }

  return createGeneralAppointmentRequest({
    clinic: args.clinic,
    input: args.input,
    customerName: args.customerName,
    selectedDate: args.selectedDate,
    preferredTimeRange,
    reason: args.stateJson.generalRequestReason ?? args.input.text,
    selectedPractitionerId,
  });
};

const applyAgentStatePatch = async (args: {
  clinicId: string;
  phone: string;
  customerName?: string | null;
  inputText: string;
  patch: WhatsAppAgentDecision['statePatch'];
}) => {
  const data: {
    customerName?: string | null;
    currentIntent?: string | null;
    step?: string | null;
    selectedAppointmentTypeId?: string | null;
    selectedAppointmentTypeName?: string | null;
    selectedDate?: string | null;
    selectedTime?: string | null;
    lastMessage?: string | null;
  } = {
    customerName: args.customerName ?? null,
    lastMessage: args.inputText,
  };

  if ('currentIntent' in args.patch) data.currentIntent = args.patch.currentIntent ?? null;
  if ('step' in args.patch) data.step = args.patch.step ?? null;
  if ('selectedAppointmentTypeId' in args.patch) data.selectedAppointmentTypeId = args.patch.selectedAppointmentTypeId ?? null;
  if ('selectedAppointmentTypeName' in args.patch) data.selectedAppointmentTypeName = args.patch.selectedAppointmentTypeName ?? null;
  if ('selectedDate' in args.patch) data.selectedDate = args.patch.selectedDate ?? null;
  if ('selectedTime' in args.patch) data.selectedTime = args.patch.selectedTime ?? null;

  await upsertWhatsAppConversationState(args.clinicId, args.phone, data);
};

const executeAgentDecision = async (args: {
  decision: WhatsAppAgentDecision | null;
  source: WhatsAppConversationAgentSource;
  clinic: NonNullable<Awaited<ReturnType<typeof getDefaultClinic>>>;
  input: NormalizedWhatsAppMessage;
  customerName?: string | null;
  currentStep: AssistantStep | 'main_menu' | null;
  selectedDate?: string | null;
  stateJson: ConversationStateJson;
}) => {
  const decision = args.decision;
  if (!decision) return null;

  const minimumConfidence = args.source === 'ai' ? 0.6 : 0.85;
  if (decision.confidence < minimumConfidence && decision.action !== 'ask_clarification' && decision.action !== 'unknown_safe_reply') {
    console.warn('[whatsapp-agent] low-confidence', {
      source: args.source,
      intent: decision.intent,
      action: decision.action,
      confidence: decision.confidence,
      step: args.currentStep,
    });
    // Fire-and-forget: staff incelemesi için ActivityLog kaydı oluştur.
    // Hasta kaydı henüz olmayabilir; clinic-level kayıt yeterli.
    getClinicSystemUserId(args.clinic.id).then(systemUserId => {
      if (systemUserId) {
        return logActivity({
          clinicId: args.clinic.id,
          userId: systemUserId,
          entityType: 'clinic',
          entityId: args.clinic.id,
          action: 'whatsapp_low_confidence',
          description: `WhatsApp mesajı düşük güven skoru ile işlendi ve kural yönlendiricisine düştü — intent: ${decision.intent}, action: ${decision.action}, confidence: ${decision.confidence.toFixed(2)}, source: ${args.source}`,
          metadata: {
            intent: decision.intent,
            action: decision.action,
            confidence: decision.confidence,
            source: args.source,
            step: args.currentStep,
            needsReview: true,
          },
        });
      }
    }).catch(() => {});
    return null;
  }

  const intent = normalizeAssistantIntentValue(decision.intent);
  console.info('[whatsapp-agent] decision', {
    source: args.source,
    intent,
    action: decision.action,
    confidence: decision.confidence,
    step: args.currentStep,
    needsHuman: decision.needsHuman,
    safetyFlags: decision.safetyFlags,
  });

  if (decision.action === 'store_handoff_note' && args.currentStep === 'awaiting_handoff_note') {
    return handleHandoffNote(args.clinic.id, args.input, args.customerName, args.stateJson);
  }

  if (decision.action === 'human_handoff' || intent === 'human_handoff' || decision.needsHuman) {
    logGlobalIntent(args.input.phone, args.input.text, args.currentStep, 'human_handoff');
    return handleHumanHandoffIntent(args.clinic.id, args.input, args.customerName);
  }

  if (decision.action === 'answer_clinic_info' || intent === 'clinic_info') {
    logGlobalIntent(args.input.phone, args.input.text, args.currentStep, 'clinic_info');
    return answerClinicInfo(args.clinic, args.input.text, args.currentStep, args.selectedDate);
  }

  if (decision.action === 'refuse_off_topic') {
    logGlobalIntent(args.input.phone, args.input.text, args.currentStep, 'off_topic_or_smalltalk');
    await upsertWhatsAppConversationState(args.clinic.id, args.input.phone, {
      customerName: args.customerName,
      currentIntent: null,
      step: null,
      lastMessage: args.input.text,
      stateJson: null,
    });
    return OFF_TOPIC_REFUSAL_MESSAGE;
  }

  if (decision.action === 'reply_only' && intent === 'off_topic_or_smalltalk') {
    logGlobalIntent(args.input.phone, args.input.text, args.currentStep, 'off_topic_or_smalltalk');
    return answerSmallTalk(args.clinic, args.input.text, args.currentStep, args.selectedDate);
  }

  if (decision.action === 'start_general_assessment' || intent === 'symptom_or_complaint') {
    // awaiting_service adımındayken semptomu genel muayeneye yönlendirme —
    // lokal handler semptomu hizmet seçimine yardımcı olarak kullanmalı.
    if (args.currentStep === 'awaiting_service') {
      return null;
    }
    logGlobalIntent(args.input.phone, args.input.text, args.currentStep, 'symptom_or_complaint');
    return handleGeneralAssessmentStart({
      clinicId: args.clinic.id,
      input: args.input,
      customerName: args.customerName,
      symptom: intent === 'symptom_or_complaint',
    });
  }

  if (decision.action === 'appointment_lookup' || isAppointmentQueryIntentValue(intent)) {
    logGlobalIntent(args.input.phone, args.input.text, args.currentStep, 'appointment_query');
    await upsertWhatsAppConversationState(args.clinic.id, args.input.phone, {
      customerName: args.customerName,
      step: null,
      currentIntent: 'appointment_query',
      lastMessage: args.input.text,
      ...clearBookingState(),
    });
    const appointments = await getAppointmentsForPhone(args.clinic.id, args.input.phone);
    return formatAppointmentLookupForMessage(appointments, args.input.text);
  }

  if (decision.action === 'cancel_appointment' || intent === 'cancel_appointment') {
    logGlobalIntent(args.input.phone, args.input.text, args.currentStep, 'cancel_appointment');
    await upsertWhatsAppConversationState(args.clinic.id, args.input.phone, {
      customerName: args.customerName,
      step: null,
      currentIntent: 'cancel_appointment',
      lastMessage: args.input.text,
      ...clearBookingState(),
    });
    return handleCancelIntent(args.clinic.id, args.input.phone);
  }

  if (decision.action === 'answer_service_info' || intent === 'service_info') {
    await resetWhatsAppConversationState(args.clinic.id, args.input.phone, args.customerName);
    return ['Hizmetlerimiz şu şekilde:', ...((await getAssistantServices(args.clinic.id)).map((service, index) => `${index + 1}. ${service.name}`))].join('\n');
  }

  if (decision.action === 'ask_clarification') {
    await applyAgentStatePatch({
      clinicId: args.clinic.id,
      phone: args.input.phone,
      customerName: args.customerName,
      inputText: args.input.text,
      patch: decision.statePatch,
    });
    return decision.reply ?? 'Mesajınızı tam anlayamadım. Randevu, klinik bilgisi veya yetkili ekibe ulaşma konusunda nasıl yardımcı olabilirim?';
  }

  if (decision.action === 'unknown_safe_reply') {
    await upsertWhatsAppConversationState(args.clinic.id, args.input.phone, {
      customerName: args.customerName,
      currentIntent: null,
      step: null,
      lastMessage: args.input.text,
      stateJson: null,
    });
    return decision.reply ?? 'Mesajınızı tam anlayamadım. Randevu almak, mevcut randevunuzu sormak, klinik bilgisi almak veya yetkili ekibe ulaşmak istediğinizi yazabilirsiniz.';
  }

  if (decision.action === 'show_main_menu' && isMainMenuCommand(args.input.text)) {
    await upsertWhatsAppConversationState(args.clinic.id, args.input.phone, {
      customerName: args.customerName,
      currentIntent: null,
      step: 'main_menu',
      lastMessage: args.input.text,
      ...clearBookingState(),
    });
    return formatMainMenuOptions();
  }

  return null;
};

// ---- Main Conversation Handler ----

const handleIncomingWhatsAppMessage = async (input: NormalizedWhatsAppMessage, clinic: NonNullable<Awaited<ReturnType<typeof getDefaultClinic>>>) => {
  const inputPhone = normalizePhone(input.phone);
  input.phone = inputPhone;
  // Security: cap text length before any AI processing.
  input.text = sanitizeInboundMessageText(input.text);

  const existingPatient = await findExistingPatientByPhone(clinic.id, inputPhone);
  const state = await prisma.whatsAppConversationState.findUnique({
    where: { clinicId_phone: { clinicId: clinic.id, phone: inputPhone } },
  });

  if (existingPatient) {
    await saveWhatsAppConversationMessage({
      clinicId: clinic.id, patientId: existingPatient.id, phone: inputPhone,
      providerMessageId: input.messageId,
      direction: 'incoming', text: input.text, rawPayload: input.rawPayload,
    });
  }

  const stateJson = readConversationStateJson(state?.stateJson);
  const services = await getAssistantServices(clinic.id);
  const normalizedText = normalizeIntentText(input.text);
  const standaloneNumericSelection = extractStandaloneNumericSelection(input.text);
  const persistedCustomerName = existingPatient ? getPatientFullName(existingPatient) : null;
  const customerName = state?.customerName || persistedCustomerName;
  const currentStep = (state?.step ?? null) as AssistantStep | 'main_menu' | null;
  const selectedAppointmentTypeId = state?.selectedAppointmentTypeId ?? null;
  const selectedAppointmentTypeName = state?.selectedAppointmentTypeName ?? null;
  const selectedPractitionerId = state?.selectedPractitionerId ?? null;
  const selectedDate = state?.selectedDate ?? null;
  const hasActiveBookingFlow = ['awaiting_service', 'awaiting_date', 'awaiting_time', 'awaiting_confirmation', 'awaiting_general_date', 'awaiting_general_time', 'awaiting_general_practitioner'].includes(currentStep ?? '');

  // ── REMINDER CONFIRMATION: Patient replies EVET/HAYIR to an automated reminder ──
  const isReminderConfirm = /^(evet|e|yes)\s*[!.]*$/i.test(input.text.trim());
  const isReminderCancel  = /^(hayır|hayir|h|iptal|vazgeç|vazgec|no)\s*[!.]*$/i.test(input.text.trim());

  if ((isReminderConfirm || isReminderCancel) && existingPatient && !hasActiveBookingFlow && currentStep !== 'awaiting_cancel_selection') {
    const clinic2 = await prisma.clinic.findUnique({ where: { id: clinic.id }, select: { timezone: true } });
    const tz = clinic2?.timezone ?? 'Europe/Istanbul';
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    // Find the most recent reminder SentMessage for this patient that still has a scheduled appointment
    const reminderMsg = await prisma.sentMessage.findFirst({
      where: {
        clinicId: clinic.id,
        patientId: existingPatient.id,
        appointmentId: { not: null },
        status: { in: ['sent', 'delivered', 'prepared'] },
        createdAt: { gte: new Date(now.getTime() - 48 * 60 * 60 * 1000) },
      },
      include: {
        appointment: {
          include: { appointmentType: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    let targetAppointment = reminderMsg?.appointment
      && reminderMsg.appointment.deletedAt === null
      && reminderMsg.appointment.status === 'scheduled'
      && reminderMsg.appointment.startTime >= now
      && reminderMsg.appointment.startTime <= windowEnd
      ? reminderMsg.appointment
      : null;

    // Fallback: no sentMessage found (e.g. reminder sent by external system like n8n).
    // If the patient has exactly one upcoming scheduled appointment in the next 48 h,
    // treat "evet / hayır" as a reply to that reminder.
    if (!targetAppointment) {
      const directAppts = await prisma.appointment.findMany({
        where: {
          clinicId: clinic.id,
          patientId: existingPatient.id,
          deletedAt: null,
          status: 'scheduled',
          startTime: { gte: now, lte: windowEnd },
        },
        include: { appointmentType: { select: { name: true } } },
        orderBy: { startTime: 'asc' },
        take: 2,
      });
      if (directAppts.length === 1) {
        targetAppointment = directAppts[0];
        console.log(`[reminders] Reminder confirmation matched via direct appointment lookup for ${redactPhone(inputPhone)} (apptId=${directAppts[0].id})`);
      }
    }

    if (targetAppointment) {
      const start = formatClinicDateTime(targetAppointment.startTime, tz);
      const apptLabel = `${start.date} ${start.time}`;
      const serviceName = targetAppointment.appointmentType?.name ?? 'Randevunuz';
      const systemUserId = await getClinicSystemUserId(clinic.id);

      if (isReminderConfirm) {
        await prisma.appointment.update({
          where: { id: targetAppointment.id },
          data: { status: 'confirmed' },
        });
        if (systemUserId) {
          await logActivity({
            clinicId: clinic.id,
            userId: systemUserId,
            entityType: 'appointment',
            entityId: targetAppointment.id,
            action: 'confirmed',
            description: `Randevu hasta WhatsApp onayı ile teyit edildi (${apptLabel})`,
            patientId: existingPatient.id,
            appointmentId: targetAppointment.id,
            metadata: { source: 'whatsapp_reminder_reply', phone: inputPhone },
          });
        }
        console.log(`[reminders] Appointment ${targetAppointment.id} confirmed via WhatsApp reply from ${redactPhone(inputPhone)}`);
        await upsertWhatsAppConversationState(clinic.id, inputPhone, { customerName, step: null, currentIntent: null, lastMessage: input.text });
        return `Teşekkürler! ${apptLabel} tarihli ${serviceName} randevunuz onaylandı. Görüşmek üzere! 😊`;
      } else {
        await prisma.appointment.update({
          where: { id: targetAppointment.id },
          data: {
            status: 'cancelled',
            cancellationReason: 'Hasta WhatsApp hatırlatma mesajına HAYIR yanıtı verdi.',
          },
        });
        if (systemUserId) {
          await logActivity({
            clinicId: clinic.id,
            userId: systemUserId,
            entityType: 'appointment',
            entityId: targetAppointment.id,
            action: 'cancelled',
            description: `Randevu hasta WhatsApp yanıtı ile iptal edildi (${apptLabel})`,
            patientId: existingPatient.id,
            appointmentId: targetAppointment.id,
            metadata: { source: 'whatsapp_reminder_reply', phone: inputPhone },
          });
        }
        console.log(`[reminders] Appointment ${targetAppointment.id} cancelled via WhatsApp reply from ${redactPhone(inputPhone)}`);
        await upsertWhatsAppConversationState(clinic.id, inputPhone, { customerName, step: null, currentIntent: null, lastMessage: input.text });
        return `Anladım, ${apptLabel} tarihli randevunuzu iptal ettim. Yeni bir randevu almak isterseniz "randevu al" yazabilirsiniz.`;
      }
    }
  }
  // ── END REMINDER CONFIRMATION ──

  console.log('[whatsapp-assistant] route-start', { phone: redactPhone(input.phone), text: summarizeTextForLog(input.text), previousStep: state?.step ?? null });
  console.info('[whatsapp-assistant] incoming', { phone: redactPhone(input.phone), text: summarizeTextForLog(input.text) });

  if (isMainMenuCommand(input.text)) {
    logGlobalIntent(input.phone, input.text, currentStep, 'main_menu');
    logStateTransition(input.phone, currentStep, 'main_menu', 'global_main_menu');
    await upsertWhatsAppConversationState(clinic.id, input.phone, { customerName, currentIntent: null, step: 'main_menu', lastMessage: input.text, ...clearBookingState() });
    return formatMainMenuOptions();
  }

  if (isAppointmentCancellationIntent(input.text)) {
    logGlobalIntent(input.phone, input.text, currentStep, 'cancel_appointment');
    logStateTransition(input.phone, currentStep, 'awaiting_cancel_selection', 'global_cancel_appointment');
    await upsertWhatsAppConversationState(clinic.id, input.phone, { customerName, step: null, currentIntent: 'cancel_appointment', lastMessage: input.text, ...clearBookingState() });
    return handleCancelIntent(clinic.id, input.phone);
  }

  if (isBotIdentityQuestion(input.text)) {
    return `Ben ${clinic.name} kliniğinin dijital randevu asistanıyım. Randevu almak, mevcut randevunuzu sorgulamak veya iptal etmek için yardımcı olabilirim. Herhangi bir sorunuz varsa kliniği doğrudan arayabilirsiniz.`;
  }

  if (isClinicHoursQuestion(input.text) && !hasBookingLanguage(input.text)) {
    logGlobalIntent(input.phone, input.text, currentStep, 'clinic_hours');
    return answerClinicInfo(clinic, input.text, currentStep, selectedDate);
  }

  if (isCheckAppointmentIntent(input.text)) {
    logGlobalIntent(input.phone, input.text, currentStep, 'check_appointment');
    logStateTransition(input.phone, currentStep, 'main_menu', 'global_check_appointment');
    await upsertWhatsAppConversationState(clinic.id, input.phone, { customerName, step: null, currentIntent: 'check_appointment', lastMessage: input.text, ...clearBookingState() });
    const appointments = await getAppointmentsForPhone(clinic.id, input.phone);
    return formatAppointmentLookupForMessage(appointments, input.text);
  }

  // ── GLOBAL EXIT: closing/farewell detected at any step ───────────────────
  if (isClosingMessage(input.text)) {
    logGlobalIntent(input.phone, input.text, currentStep, 'conversation_end');
    logStateTransition(input.phone, currentStep, null, 'global_farewell');
    await upsertWhatsAppConversationState(clinic.id, input.phone, {
      customerName, currentIntent: null, step: null, lastMessage: input.text, ...clearBookingState(),
    });
    const firstName = getFirstNameFromCustomerName(customerName);
    return firstName
      ? `Rica ederim ${firstName}. Sağlıklı günler dilerim. Tekrar görüşmek üzere! 😊`
      : 'Rica ederim. Sağlıklı günler dilerim. Tekrar görüşmek üzere! 😊';
  }

  if (isBookingFlowCancelCommand(input.text, state)) {
    logGlobalIntent(input.phone, input.text, currentStep, 'cancel_booking_flow');
    logStateTransition(input.phone, currentStep, 'main_menu', 'cancel_booking_flow');
    await upsertWhatsAppConversationState(clinic.id, input.phone, { customerName, currentIntent: null, step: 'main_menu', lastMessage: input.text, ...clearBookingState() });
    return formatMainMenuOptions('Elbette, randevu alma işlemini iptal ettim. Size başka nasıl yardımcı olabilirim?');
  }

  if (isBackCommand(input.text)) {
    logGlobalIntent(input.phone, input.text, currentStep, 'back');
    if (currentStep === 'awaiting_service') {
      logStateTransition(input.phone, currentStep, 'main_menu', 'back_command');
      await upsertWhatsAppConversationState(clinic.id, input.phone, { customerName, currentIntent: null, step: 'main_menu', lastMessage: input.text, ...clearBookingState() });
      return formatMainMenuOptions();
    }
    if (currentStep === 'awaiting_date') {
      logStateTransition(input.phone, currentStep, 'awaiting_service', 'back_command');
      await upsertWhatsAppConversationState(clinic.id, input.phone, { customerName, currentIntent: 'book_appointment', step: 'awaiting_service', lastMessage: input.text, ...clearBookingState() });
      return formatServiceList(services);
    }
    if (currentStep === 'awaiting_time') {
      logStateTransition(input.phone, currentStep, 'awaiting_date', 'back_command');
      await upsertWhatsAppConversationState(clinic.id, input.phone, {
        customerName, currentIntent: 'book_appointment', step: 'awaiting_date',
        selectedAppointmentTypeId, selectedAppointmentTypeName, selectedPractitionerId,
        selectedDate: null, selectedTime: null, lastMessage: input.text, stateJson: null,
      });
      return 'Tabii, tarihi yeniden seçebiliriz. Hangi gün için kontrol etmemi istersiniz?';
    }
    if (currentStep === 'awaiting_confirmation') {
      logStateTransition(input.phone, currentStep, 'awaiting_time', 'back_command');
      await upsertWhatsAppConversationState(clinic.id, input.phone, {
        customerName, currentIntent: 'book_appointment', step: 'awaiting_time',
        selectedAppointmentTypeId, selectedAppointmentTypeName, selectedPractitionerId: null,
        selectedDate, selectedTime: null, lastMessage: input.text,
        stateJson: { availableSlots: stateJson.availableSlots, lastShownSlots: stateJson.lastShownSlots },
      });
      return 'Tabii, saat seçimine geri dönebiliriz. İsterseniz başka bir saat veya saat aralığı seçin.';
    }
    if (currentStep === 'awaiting_cancel_selection') {
      logStateTransition(input.phone, currentStep, 'main_menu', 'back_command');
      await upsertWhatsAppConversationState(clinic.id, input.phone, { customerName, currentIntent: null, step: 'main_menu', lastMessage: input.text, ...clearBookingState() });
      return formatMainMenuOptions();
    }
  }

  if (hasActiveBookingFlow && isChangeServiceRequest(input.text)) {
    logGlobalIntent(input.phone, input.text, currentStep, 'change_service');
    logStateTransition(input.phone, currentStep, 'awaiting_service', 'change_service');
    const matchedServices = findServiceMatches(input.text, services);
    const selectedService = matchedServices.length === 1 ? matchedServices[0] : null;
    if (selectedService) {
      await upsertWhatsAppConversationState(clinic.id, input.phone, {
        customerName, currentIntent: 'book_appointment', step: 'awaiting_date',
        selectedAppointmentTypeId: selectedService.id, selectedAppointmentTypeName: selectedService.name,
        selectedPractitionerId: null, selectedDate: null, selectedTime: null, lastMessage: input.text, stateJson: null,
      });
      return `${selectedService.name} hizmetini seçtiniz. Hangi gün için randevu istersiniz? Örneğin yarın, 22 Mayıs veya cuma yazabilirsiniz.`;
    }
    await upsertWhatsAppConversationState(clinic.id, input.phone, { customerName, currentIntent: 'book_appointment', step: 'awaiting_service', lastMessage: input.text, ...clearBookingState() });
    return formatServiceList(services);
  }

  if ((hasActiveBookingFlow || currentStep === 'awaiting_time') && selectedAppointmentTypeId && isChangeDateRequest(input.text)) {
    logGlobalIntent(input.phone, input.text, currentStep, 'change_date');
    const normalizedDate = normalizeDateFromTurkishInput(input.text, new Date(), WHATSAPP_ASSISTANT_TIME_ZONE);
    if (!normalizedDate) {
      logStateTransition(input.phone, currentStep, 'awaiting_date', 'change_date_prompt');
      await upsertWhatsAppConversationState(clinic.id, input.phone, {
        customerName, currentIntent: 'book_appointment', step: 'awaiting_date',
        selectedAppointmentTypeId, selectedAppointmentTypeName, selectedPractitionerId,
        selectedDate: null, selectedTime: null, lastMessage: input.text, stateJson: null,
      });
      return 'Tabii, hangi gün için kontrol etmemi istersiniz? Örneğin yarın, 22 Mayıs veya cuma yazabilirsiniz.';
    }
    logStateTransition(input.phone, currentStep, 'awaiting_time', 'change_date_direct');
    return handleAwaitingDateStep({
      prisma, clinicId: clinic.id, text: input.text, customerName,
      state: { selectedAppointmentTypeId, selectedAppointmentTypeName, selectedPractitionerId },
      buildAvailableSlots, formatAvailabilityMessage, logAvailabilitySave, minutesToTime,
      interpretDateWithAi: text => normalizeDateWithGoogleAi(text, new Date().toISOString().slice(0, 10), clinic.timezone || WHATSAPP_ASSISTANT_TIME_ZONE),
      interpretTimeWithAi: async messageText => {
        const extracted = await resolveAssistantExtraction(messageText, services, {
          currentIntent: state?.currentIntent, step: state?.step, customerName: state?.customerName,
          selectedAppointmentTypeId: state?.selectedAppointmentTypeId, selectedAppointmentTypeName: state?.selectedAppointmentTypeName, selectedDate: state?.selectedDate,
        });
        return { exactTime: extracted.exactTime, afterTime: extracted.afterTime, timePreference: extracted.timePreference };
      },
      upsertState: data => upsertWhatsAppConversationState(clinic.id, input.phone, data),
    });
  }

  if (currentStep === 'main_menu' && standaloneNumericSelection !== null) {
    console.log('[whatsapp-assistant] route-handler', { phone: redactPhone(input.phone), handler: 'main_menu-deterministic', selectedAppointmentTypeId: null, selectedAppointmentTypeName: null, selectedDate: null });
    if (standaloneNumericSelection === 1) {
      await upsertWhatsAppConversationState(clinic.id, input.phone, {
        customerName,
        currentIntent: 'book_appointment',
        step: 'awaiting_service',
        selectedAppointmentTypeId: null,
        selectedAppointmentTypeName: null,
        selectedDate: null,
        selectedTime: null,
        lastMessage: input.text,
        stateJson: null,
      });
      return formatServiceList(services);
    }
    if (standaloneNumericSelection === 2) {
      const appointments = await getAppointmentsForPhone(clinic.id, input.phone);
      return formatAppointmentLookupForMessage(appointments, input.text);
    }
    if (standaloneNumericSelection === 3) {
      return handleCancelIntent(clinic.id, input.phone);
    }
    if (standaloneNumericSelection === 4) {
      return ['Hizmetlerimiz şu şekilde:', ...services.map((s, i) => `${i + 1}. ${s.name}`)].join('\n');
    }
    return 'Bu numarayı mevcut seçenekler içinde anlayamadım. İsterseniz ne yapmak istediğinizi kısaca yazabilirsiniz.';
  }

  if (currentStep === 'awaiting_service' && standaloneNumericSelection !== null) {
    console.log('[whatsapp-assistant] route-handler', { phone: redactPhone(input.phone), handler: 'awaiting_service-deterministic', selectedAppointmentTypeId: state?.selectedAppointmentTypeId ?? null, selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null, selectedDate: state?.selectedDate ?? null });
    return handleAwaitingServiceStep({
      text: input.text, phone: input.phone, customerName, services,
      state: { selectedAppointmentTypeId: state?.selectedAppointmentTypeId, selectedAppointmentTypeName: state?.selectedAppointmentTypeName, selectedDate: state?.selectedDate },
      stateJson: { matchedServices: stateJson.matchedServices },
      extractNumericSelection, findServiceMatches, formatServiceList,
      upsertState: data => upsertWhatsAppConversationState(clinic.id, input.phone, data),
    });
  }

  if (currentStep === 'awaiting_time' && standaloneNumericSelection !== null) {
    console.log('[whatsapp-assistant] route-handler', { phone: redactPhone(input.phone), handler: 'awaiting_time-deterministic', selectedAppointmentTypeId: state?.selectedAppointmentTypeId ?? null, selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null, selectedDate: state?.selectedDate ?? null });
    return handleAwaitingTimeStep({
      prisma, clinicId: clinic.id, phone: input.phone, text: input.text, customerName,
      state: { selectedAppointmentTypeId: state?.selectedAppointmentTypeId, selectedAppointmentTypeName: state?.selectedAppointmentTypeName, selectedPractitionerId: state?.selectedPractitionerId, selectedDate: state?.selectedDate },
      stateJson: { availableSlots: stateJson.availableSlots, lastShownSlots: stateJson.lastShownSlots },
      extractNumericSelection, findSlotMatches, formatAvailabilityMessage, minutesToTime, logAvailabilitySave,
      upsertState: data => upsertWhatsAppConversationState(clinic.id, input.phone, data),
      resetState: nextCustomerName => resetWhatsAppConversationState(clinic.id, input.phone, nextCustomerName),
      createAppointment: createAppointmentRequestFromAssistant,
    });
  }

  if (currentStep === 'awaiting_confirmation' && isDeterministicConfirmationReply(input.text)) {
    console.log('[whatsapp-assistant] route-handler', { phone: redactPhone(input.phone), handler: 'awaiting_confirmation-deterministic', selectedAppointmentTypeId: state?.selectedAppointmentTypeId ?? null, selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null, selectedDate: state?.selectedDate ?? null });
    return handleAwaitingConfirmationStep({
      clinicId: clinic.id, phone: input.phone, text: input.text, customerName,
      state: { selectedAppointmentTypeId: state?.selectedAppointmentTypeId, selectedAppointmentTypeName: state?.selectedAppointmentTypeName, selectedPractitionerId: state?.selectedPractitionerId, selectedDate: state?.selectedDate },
      stateJson: { availableSlots: stateJson.availableSlots, lastShownSlots: stateJson.lastShownSlots, pendingConfirmationSlot: stateJson.pendingConfirmationSlot },
      upsertState: data => upsertWhatsAppConversationState(clinic.id, input.phone, data),
      resetState: nextCustomerName => resetWhatsAppConversationState(clinic.id, input.phone, nextCustomerName),
      createAppointment: createAppointmentRequestFromAssistant,
    });
  }

  const [recentMessages, clinicFacts] = await Promise.all([
    loadRecentWhatsAppAgentMessages(clinic.id, existingPatient?.id, input.phone),
    loadWhatsAppAgentClinicFacts(clinic),
  ]);
  const agentResolution = await resolveWhatsAppConversationAgentDecision({
    latestMessage: input.text,
    customerName,
    currentIntent: state?.currentIntent,
    currentStep: state?.step,
    selectedAppointmentTypeName: state?.selectedAppointmentTypeName,
    selectedDate: state?.selectedDate,
    services,
    recentMessages,
    clinicFacts,
  });

  const agentHandledResponse = await executeAgentDecision({
    decision: agentResolution.decision,
    source: agentResolution.source,
    clinic,
    input,
    customerName,
    currentStep,
    selectedDate,
    stateJson,
  });
  if (agentHandledResponse) return agentHandledResponse;

  const extracted = await resolveAssistantExtractionWithAgentDecision(input.text, services, {
    currentIntent: state?.currentIntent, step: state?.step, customerName: state?.customerName,
    selectedAppointmentTypeId: state?.selectedAppointmentTypeId, selectedAppointmentTypeName: state?.selectedAppointmentTypeName, selectedDate: state?.selectedDate,
  }, agentResolution.decision);
  const preflightIntent = normalizeAssistantIntentValue(extracted.intent);

  console.info('[whatsapp-assistant] detected', {
    agentSource: agentResolution.source,
    agentAction: agentResolution.decision?.action ?? null,
    intent: preflightIntent, rawIntent: extracted.intent, step: state?.step ?? null, confidence: extracted.confidence,
    needsClarification: extracted.needsClarification, exactTime: extracted.exactTime,
    afterTime: extracted.afterTime, timePreference: extracted.timePreference,
  });

  if (preflightIntent === 'human_handoff') {
    logGlobalIntent(input.phone, input.text, currentStep, 'human_handoff');
    return handleHumanHandoffIntent(clinic.id, input, customerName);
  }

  if (currentStep === 'awaiting_handoff_note') {
    const normalized = normalizeTurkishSearchText(input.text);
    if (['hayir', 'yok', 'gerek yok', 'not yok', 'istemiyorum'].some(pattern => normalized === pattern || normalized.includes(pattern))) {
      await resetWhatsAppConversationState(clinic.id, input.phone, customerName);
      return 'Tamam, ek not olmadan talebinizi yetkili ekibe ilettim.';
    }
    if (!['book_appointment', 'appointment_query', 'cancel_appointment', 'clinic_info', 'service_info'].includes(preflightIntent)) {
      return handleHandoffNote(clinic.id, input, customerName, stateJson);
    }
  }

  if (preflightIntent === 'clinic_info') {
    logGlobalIntent(input.phone, input.text, currentStep, 'clinic_info');
    return answerClinicInfo(clinic, input.text, currentStep, selectedDate);
  }

  if (preflightIntent === 'off_topic_or_smalltalk') {
    logGlobalIntent(input.phone, input.text, currentStep, 'off_topic_or_smalltalk');
    return answerSmallTalk(clinic, input.text, currentStep, selectedDate);
  }

  if (preflightIntent === 'symptom_or_complaint') {
    logGlobalIntent(input.phone, input.text, currentStep, 'symptom_or_complaint');
    return handleGeneralAssessmentStart({
      clinicId: clinic.id,
      input,
      customerName,
      symptom: true,
    });
  }

  if (isAppointmentQueryIntentValue(preflightIntent)) {
    logGlobalIntent(input.phone, input.text, currentStep, 'appointment_query');
    await upsertWhatsAppConversationState(clinic.id, input.phone, { customerName, step: null, currentIntent: 'appointment_query', lastMessage: input.text, ...clearBookingState() });
    const appointments = await getAppointmentsForPhone(clinic.id, input.phone);
    return formatAppointmentLookupForMessage(appointments, input.text);
  }

  if (preflightIntent === 'cancel_appointment') {
    logGlobalIntent(input.phone, input.text, currentStep, 'cancel_appointment');
    await upsertWhatsAppConversationState(clinic.id, input.phone, { customerName, step: null, currentIntent: 'cancel_appointment', lastMessage: input.text, ...clearBookingState() });
    return handleCancelIntent(clinic.id, input.phone);
  }

  if (currentStep === 'awaiting_general_date') {
    return handleGeneralDateStep({ clinic, input, customerName, stateJson });
  }

  if (currentStep === 'awaiting_general_time') {
    return handleGeneralTimeStep({ clinic, input, customerName, selectedDate, stateJson });
  }

  if (currentStep === 'awaiting_general_practitioner') {
    return handleGeneralPractitionerStep({ clinic, input, customerName, selectedDate, stateJson });
  }

  if (
    preflightIntent === 'book_appointment'
    && !extracted.appointmentTypeId
    && !extracted.appointmentTypeName
    && prefersGeneralAssessment(input.text)
    && (!currentStep || currentStep === 'main_menu' || currentStep === 'awaiting_service')
  ) {
    logGlobalIntent(input.phone, input.text, currentStep, 'general_assessment_booking');
    return handleGeneralAssessmentStart({
      clinicId: clinic.id,
      input,
      customerName,
      symptom: false,
    });
  }

  if (!existingPatient && currentStep !== 'awaiting_name') {
    console.log('[whatsapp-assistant] route-handler', { phone: redactPhone(input.phone), handler: 'awaiting_name', selectedAppointmentTypeId: null, selectedAppointmentTypeName: null, selectedDate: null });
    await upsertWhatsAppConversationState(clinic.id, input.phone, {
      customerName: null, currentIntent: preflightIntent === 'book_appointment' ? 'book_appointment' : null, step: 'awaiting_name',
      selectedAppointmentTypeId: null, selectedAppointmentTypeName: null, selectedPractitionerId: null,
      selectedDate: null, selectedTime: null, lastMessage: input.text, stateJson: null,
    });
    return `Merhaba, ${formatClinicWelcomeName(clinic.name)} hoş geldiniz. Size yardımcı olabilmem için adınızı ve soyadınızı paylaşır mısınız?`;
  }

  if (currentStep === 'awaiting_name') {
    console.log('[whatsapp-assistant] route-handler', { phone: redactPhone(input.phone), handler: 'awaiting_name', selectedAppointmentTypeId: null, selectedAppointmentTypeName: null, selectedDate: null });
    if (preflightIntent === 'book_appointment') {
      await upsertWhatsAppConversationState(clinic.id, input.phone, {
        customerName: null,
        currentIntent: 'book_appointment',
        step: 'awaiting_name',
        lastMessage: input.text,
        stateJson: null,
      });
      return 'Randevu akışına devam edebilmem için önce adınızı ve soyadınızı yazar mısınız? Örneğin Mustafa Yılmaz gibi.';
    }
    const parsedName = splitNameForPatient(input.text);
    if (!parsedName.firstName || !hasValidLastName(parsedName.lastName)) {
      await upsertWhatsAppConversationState(clinic.id, input.phone, {
        customerName: null,
        currentIntent: state?.currentIntent === 'book_appointment' ? 'book_appointment' : null,
        step: 'awaiting_name',
        lastMessage: input.text,
        stateJson: null,
      });
      return 'Kaydınızı oluşturabilmem için ad ve soyadınızı birlikte paylaşır mısınız? Örneğin Mustafa Yılmaz gibi yazabilirsiniz.';
    }
    const createdPatient = await createPatientFromWhatsAppName(clinic.id, input.phone, input.text);
    await saveWhatsAppConversationMessage({ clinicId: clinic.id, patientId: createdPatient.id, phone: input.phone, providerMessageId: input.messageId, direction: 'incoming', text: input.text, rawPayload: input.rawPayload });
    const fullName = getPatientFullName(createdPatient);
    if (state?.currentIntent === 'book_appointment') {
      const pendingSlot = stateJson.pendingConfirmationSlot ?? null;
      if (pendingSlot && state.selectedAppointmentTypeId && state.selectedDate) {
        try {
          const request = await createAppointmentRequestFromAssistant(
            clinic.id,
            input.phone,
            fullName,
            state.selectedAppointmentTypeId,
            pendingSlot,
            input.text,
          );
          await resetWhatsAppConversationState(clinic.id, input.phone, fullName);
          const serviceName = state.selectedAppointmentTypeName ?? request.appointmentType?.name ?? 'seçtiğiniz hizmet';
          return `Talebinizi klinik onay ekranına aldım. ${serviceName} için ${formatTurkishDateLong(state.selectedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} tarihinde saat ${pendingSlot.localStartTime} talebiniz personel tarafından kontrol edilecek. Klinik ekibi onay durumunu size bildirecek.`;
        } catch (error) {
          if (error instanceof Error && (error.message === 'APPOINTMENT_OUTSIDE_AVAILABILITY' || error.message === 'APPOINTMENT_OVERLAP' || error.message === 'APPOINTMENT_REQUEST_CONFLICT')) {
            await upsertWhatsAppConversationState(clinic.id, input.phone, {
              customerName: fullName,
              currentIntent: 'book_appointment',
              step: 'awaiting_date',
              selectedAppointmentTypeId: state.selectedAppointmentTypeId,
              selectedAppointmentTypeName: state.selectedAppointmentTypeName,
              selectedDate: null,
              selectedTime: null,
              lastMessage: input.text,
              stateJson: null,
            });
            return 'Seçtiğiniz saat artık uygun görünmüyor. İsterseniz başka bir gün veya saat kontrol edebilirim.';
          }
          console.error('[whatsapp-assistant] appointment-create-error', error);
          return 'Randevu talebinizi oluştururken teknik bir sorun oluştu. Birkaç dakika sonra tekrar deneyebiliriz.';
        }
      }
      await upsertWhatsAppConversationState(clinic.id, input.phone, {
        customerName: fullName, currentIntent: 'book_appointment', step: 'awaiting_service',
        selectedAppointmentTypeId: null, selectedAppointmentTypeName: null, selectedPractitionerId: null,
        selectedDate: null, selectedTime: null, lastMessage: input.text, stateJson: null,
      });
      return formatServiceList(services);
    }
    await upsertWhatsAppConversationState(clinic.id, input.phone, {
      customerName: fullName, currentIntent: null, step: 'main_menu',
      selectedAppointmentTypeId: null, selectedAppointmentTypeName: null, selectedPractitionerId: null,
      selectedDate: null, selectedTime: null, lastMessage: input.text, stateJson: null,
    });
    return formatMainMenu(fullName, false, clinic.name);
  }

  if ((!currentStep || currentStep === 'main_menu') && (isGreetingMessage(input.text) || normalizedText === '0')) {
    console.log('[whatsapp-assistant] route-handler', { phone: redactPhone(input.phone), handler: 'main_menu', selectedAppointmentTypeId: null, selectedAppointmentTypeName: null, selectedDate: null });
    await upsertWhatsAppConversationState(clinic.id, input.phone, { customerName, currentIntent: null, step: 'main_menu', lastMessage: input.text, stateJson: null });
    if (currentStep === 'main_menu') {
      const firstName = getFirstNameFromCustomerName(customerName);
      return firstName ? `Merhaba ${firstName}, size nasıl yardımcı olabilirim?` : 'Merhaba, size nasıl yardımcı olabilirim?';
    }
    return formatMainMenu(customerName, true, clinic.name);
  }

  if (currentStep === 'main_menu') {
    console.log('[whatsapp-assistant] route-handler', { phone: redactPhone(input.phone), handler: 'main_menu', selectedAppointmentTypeId: null, selectedAppointmentTypeName: null, selectedDate: null });
    if (normalizedText === '1') {
      await upsertWhatsAppConversationState(clinic.id, input.phone, { customerName, currentIntent: 'book_appointment', step: 'awaiting_service', selectedAppointmentTypeId: null, selectedAppointmentTypeName: null, selectedDate: null, selectedTime: null, lastMessage: input.text, stateJson: null });
      return formatServiceList(services);
    }
    if (normalizedText === '2') {
      const appointments = await getAppointmentsForPhone(clinic.id, input.phone);
      return formatAppointmentLookupForMessage(appointments, input.text);
    }
    if (normalizedText === '3') return handleCancelIntent(clinic.id, input.phone);
    if (normalizedText === '4') {
      return ['Hizmetlerimiz şu şekilde:', ...services.map((s, i) => `${i + 1}. ${s.name}`)].join('\n');
    }
    if (/^\d+$/.test(normalizedText)) return 'Bu numarayı mevcut seçenekler içinde anlayamadım. İsterseniz ne yapmak istediğinizi kısaca yazabilirsiniz.';
  }

  if (currentStep === 'awaiting_cancel_selection') {
    console.log('[whatsapp-assistant] route-handler', { phone: redactPhone(input.phone), handler: 'awaiting_cancel_selection', selectedAppointmentTypeId: null, selectedAppointmentTypeName: null, selectedDate: null });
    const appointments = stateJson.cancellableAppointments ?? [];
    const selectedAppointment = /^\d+$/.test(normalizedText) ? appointments[Number(normalizedText) - 1] : null;
    if (!selectedAppointment) return formatWarmPrompt('iptal etmek istediğiniz randevunun numarasını paylaşır mısınız?', customerName);
    const cancelledAppointment = await cancelAppointmentForPhone(clinic.id, selectedAppointment.id, input.phone);
    if (!cancelledAppointment) {
      await resetWhatsAppConversationState(clinic.id, input.phone, customerName);
      return formatWarmPrompt('seçtiğiniz randevuyu iptal ederken bir sorun oluştu. İsterseniz hemen yeniden deneyebiliriz.', customerName);
    }
    await resetWhatsAppConversationState(clinic.id, input.phone, customerName);
    return `${selectedAppointment.date} ${selectedAppointment.startTime} tarihli ${cancelledAppointment.appointmentType?.name ?? 'randevunuz'} iptal edildi. İhtiyacınız olursa yeni bir randevu için de yardımcı olabilirim.`;
  }

  if (currentStep === 'awaiting_service') {
    console.log('[whatsapp-assistant] route-handler', { phone: redactPhone(input.phone), handler: 'awaiting_service', selectedAppointmentTypeId: state?.selectedAppointmentTypeId ?? null, selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null, selectedDate: state?.selectedDate ?? null });
    return handleAwaitingServiceStep({
      text: input.text, phone: input.phone, customerName, services,
      state: { selectedAppointmentTypeId: state?.selectedAppointmentTypeId, selectedAppointmentTypeName: state?.selectedAppointmentTypeName, selectedDate: state?.selectedDate },
      stateJson: { matchedServices: stateJson.matchedServices },
      extractNumericSelection, findServiceMatches, formatServiceList,
      upsertState: data => upsertWhatsAppConversationState(clinic.id, input.phone, data),
    });
  }

  if (currentStep === 'awaiting_date') {
    console.log('[whatsapp-assistant] route-handler', { phone: redactPhone(input.phone), handler: 'awaiting_date', selectedAppointmentTypeId: state?.selectedAppointmentTypeId ?? null, selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null, selectedDate: state?.selectedDate ?? null });
    return handleAwaitingDateStep({
      prisma, clinicId: clinic.id, text: input.text, customerName,
      state: { selectedAppointmentTypeId: state?.selectedAppointmentTypeId, selectedAppointmentTypeName: state?.selectedAppointmentTypeName, selectedPractitionerId: state?.selectedPractitionerId },
      buildAvailableSlots, formatAvailabilityMessage, logAvailabilitySave, minutesToTime,
      interpretDateWithAi: text => normalizeDateWithGoogleAi(text, new Date().toISOString().slice(0, 10), clinic.timezone || WHATSAPP_ASSISTANT_TIME_ZONE),
      interpretTimeWithAi: async messageText => {
        const extracted = await resolveAssistantExtraction(messageText, services, {
          currentIntent: state?.currentIntent, step: state?.step, customerName: state?.customerName,
          selectedAppointmentTypeId: state?.selectedAppointmentTypeId, selectedAppointmentTypeName: state?.selectedAppointmentTypeName, selectedDate: state?.selectedDate,
        });
        return { exactTime: extracted.exactTime, afterTime: extracted.afterTime, timePreference: extracted.timePreference };
      },
      upsertState: data => upsertWhatsAppConversationState(clinic.id, input.phone, data),
    });
  }

  if (currentStep === 'awaiting_time') {
    console.log('[whatsapp-assistant] route-handler', { phone: redactPhone(input.phone), handler: 'awaiting_time', selectedAppointmentTypeId: state?.selectedAppointmentTypeId ?? null, selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null, selectedDate: state?.selectedDate ?? null });
    return handleAwaitingTimeStep({
      prisma, clinicId: clinic.id, phone: input.phone, text: input.text, customerName,
      state: { selectedAppointmentTypeId: state?.selectedAppointmentTypeId, selectedAppointmentTypeName: state?.selectedAppointmentTypeName, selectedPractitionerId: state?.selectedPractitionerId, selectedDate: state?.selectedDate },
      stateJson: { availableSlots: stateJson.availableSlots, lastShownSlots: stateJson.lastShownSlots },
      extractNumericSelection, findSlotMatches, formatAvailabilityMessage, minutesToTime, logAvailabilitySave,
      interpretTimeWithAi: async messageText => {
        const extracted = await resolveAssistantExtraction(messageText, services, {
          currentIntent: state?.currentIntent, step: state?.step, customerName: state?.customerName,
          selectedAppointmentTypeId: state?.selectedAppointmentTypeId, selectedAppointmentTypeName: state?.selectedAppointmentTypeName, selectedDate: state?.selectedDate,
        });
        return { exactTime: extracted.exactTime, afterTime: extracted.afterTime, timePreference: extracted.timePreference };
      },
      upsertState: data => upsertWhatsAppConversationState(clinic.id, input.phone, data),
      resetState: nextCustomerName => resetWhatsAppConversationState(clinic.id, input.phone, nextCustomerName),
      createAppointment: createAppointmentRequestFromAssistant,
    });
  }

  if (currentStep === 'awaiting_confirmation') {
    console.log('[whatsapp-assistant] route-handler', { phone: redactPhone(input.phone), handler: 'awaiting_confirmation', selectedAppointmentTypeId: state?.selectedAppointmentTypeId ?? null, selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null, selectedDate: state?.selectedDate ?? null });
    return handleAwaitingConfirmationStep({
      clinicId: clinic.id, phone: input.phone, text: input.text, customerName,
      state: { selectedAppointmentTypeId: state?.selectedAppointmentTypeId, selectedAppointmentTypeName: state?.selectedAppointmentTypeName, selectedPractitionerId: state?.selectedPractitionerId, selectedDate: state?.selectedDate },
      stateJson: { availableSlots: stateJson.availableSlots, lastShownSlots: stateJson.lastShownSlots, pendingConfirmationSlot: stateJson.pendingConfirmationSlot },
      upsertState: data => upsertWhatsAppConversationState(clinic.id, input.phone, data),
      resetState: nextCustomerName => resetWhatsAppConversationState(clinic.id, input.phone, nextCustomerName),
      createAppointment: createAppointmentRequestFromAssistant,
    });
  }

  // (Closing message now handled globally above — this branch is kept as a safety fallback)
  if ((!currentStep || currentStep === 'main_menu') && isClosingMessage(input.text)) {
    const firstName = getFirstNameFromCustomerName(customerName);
    return firstName ? `Rica ederim ${firstName}. Sağlıklı günler dilerim. Tekrar görüşmek üzere! 😊` : 'Rica ederim. Sağlıklı günler dilerim. Tekrar görüşmek üzere! 😊';
  }

  return routeResolvedWhatsAppIntent({
    extraction: extracted, state, customerName, clinicName: clinic.name, inputText: input.text, services,
    upsertState: data => upsertWhatsAppConversationState(clinic.id, input.phone, data),
    resetState: nextCustomerName => resetWhatsAppConversationState(clinic.id, input.phone, nextCustomerName),
    getAppointments: () => getAppointmentsForPhone(clinic.id, input.phone),
    formatAppointmentLookup: formatAppointmentLookupForMessage,
    formatServiceList, formatMainMenu,
    handleCancelIntent: () => handleCancelIntent(clinic.id, input.phone),
  });
};

// ---- Public Routes ----

// POST /evolution-webhook
router.post('/evolution-webhook', authorizeWhatsappWebhook, async (req, res) => {
  const normalizedPayload = normalizeEvolutionWebhookPayload(req.body);
  const ignoreReason = getWebhookIgnoreReason(normalizedPayload);
  if (ignoreReason) return res.status(200).json({ ignored: true, reason: ignoreReason });

  const incomingMessage = normalizedPayload.message;
  if (!incomingMessage) return res.status(200).json({ ignored: true, reason: 'no_text_message' });
  let inboundEventId: string | null = null;

  try {
    // ── Sprint 11: DB-based connection + clinic resolution (takes precedence) ──
    const normalizedInstance = normalizedPayload.instance?.trim();
    if (normalizedInstance) {
      const dbConnectionMatches = await prisma.whatsAppConnection.findMany({
        where: {
          evolutionInstanceName: normalizedInstance,
          isActive: true,
        },
        select: { id: true, organizationId: true },
      });
      const dbConnection = selectUniqueProviderConnection(dbConnectionMatches);

      if (!dbConnection && dbConnectionMatches.length > 1) {
        console.warn('[whatsapp-assistant] duplicate evolution instance match', {
          instance: normalizedInstance,
          matchCount: dbConnectionMatches.length,
        });
        return res.status(200).json({ ignored: true, reason: 'duplicate_connection_match' });
      }

      if (dbConnection) {
        const resolution = await resolveClinicForIncomingMessage(
          dbConnection.id,
          dbConnection.organizationId,
          incomingMessage.phone,
        );

        if (resolution.needsClinicResolution) {
          // Priority D — shared connection, cannot determine clinic
          // Create/update inbox entry for manual staff resolution
          await upsertInboxEntry({
            organizationId: dbConnection.organizationId,
            whatsappConnectionId: dbConnection.id,
            phone: incomingMessage.phone,
            displayName: (incomingMessage as any).pushName ?? null,
            lastMessageText: incomingMessage.text,
            externalMessageId: incomingMessage.messageId ?? null,
            rawPayload: normalizedPayload as Record<string, unknown>,
          });
          console.info('[whatsapp-assistant] inbox-unassigned', {
            phone: incomingMessage.phone,
            instance: normalizedPayload.instance,
            organizationId: dbConnection.organizationId,
          });
          return res.status(200).json({ ok: true, routed: 'inbox_unassigned' });
        }

        if (resolution.clinicId) {
          // Priority A/B/C — clinic resolved from DB connection
          const resolvedClinic = await prisma.clinic.findUnique({
            where: { id: resolution.clinicId },
          });
          if (resolvedClinic) {
            const inboundEvent = await createInboundEventOrDetectDuplicate({
              channel: 'whatsapp',
              provider: 'evolution',
              connectionId: dbConnection.id,
              clinicId: resolvedClinic.id,
              organizationId: dbConnection.organizationId,
              providerMessageId: incomingMessage.messageId,
              providerConversationId: incomingMessage.phone,
              fromExternalId: incomingMessage.phone,
              toExternalId: normalizedPayload.instance ?? null,
              fromPhone: incomingMessage.phone,
              rawPayload: normalizedPayload as Record<string, unknown>,
            });
            if (inboundEvent.status === 'duplicate') {
              console.info('[whatsapp-assistant] duplicate inbound event', {
                channel: 'whatsapp',
                provider: 'evolution',
                connectionId: dbConnection.id,
                messageId: incomingMessage.messageId ?? null,
              });
              return res.status(200).json({ ignored: true, reason: 'duplicate_message' });
            }
            if (inboundEvent.status === 'created') {
              inboundEventId = inboundEvent.eventId;
            } else {
              console.warn('[whatsapp-assistant] idempotency skipped', {
                reason: inboundEvent.reason,
                channel: 'whatsapp',
                provider: 'evolution',
                connectionId: dbConnection.id,
              });
            }

            const duplicate = await hasProcessedWhatsAppProviderMessage(
              resolvedClinic.id, incomingMessage.phone, incomingMessage.messageId,
            );
            if (duplicate) {
              await markInboundEventProcessed(inboundEventId);
              return res.status(200).json({ ignored: true, reason: 'duplicate_message' });
            }

            // Rate limiting: 8 messages per 60 seconds per sender per connection.
            if (!checkInboundRateLimit('evolution', dbConnection.id, incomingMessage.phone)) {
              await markInboundEventProcessed(inboundEventId);
              return res.status(200).json({ ignored: true, reason: 'rate_limited' });
            }

            const responseText = await handleIncomingWhatsAppMessage(incomingMessage, resolvedClinic);
            const patient = await findExistingPatientByPhone(resolvedClinic.id, incomingMessage.phone);
            await sendWhatsAppMessage(resolvedClinic.id, { phone: incomingMessage.phone, text: responseText });
            if (patient) {
              await saveWhatsAppConversationMessage({
                clinicId: resolvedClinic.id, patientId: patient.id,
                phone: incomingMessage.phone, direction: 'outgoing', text: responseText,
              });
            }
            await markWhatsAppProviderMessageProcessed(resolvedClinic.id, incomingMessage.phone, incomingMessage.messageId);
            await markInboundEventProcessed(inboundEventId);
            console.info('[whatsapp-assistant] send-result (db-resolved)', {
              phone: incomingMessage.phone,
              instance: normalizedPayload.instance ?? null,
              resolutionSource: resolution.resolutionSource,
              clinicId: resolvedClinic.id,
            });
            return res.status(200).json({ ok: true });
          }
        }

        // no_clinic_links — connection exists in DB but has no clinic assignments
        console.warn('[whatsapp-assistant] no clinic assignment for WhatsApp connection', {
          instance: normalizedPayload.instance ?? null,
          organizationId: dbConnection.organizationId,
          resolutionSource: resolution.resolutionSource,
        });
        return res.status(200).json({ ignored: true, reason: 'no_clinic_assignment' });
      }
    }

    // ── Legacy resolution (existing single-clinic behavior) ──
    if (!normalizedInstance) {
      return res.status(200).json({ ignored: true, reason: 'missing_instance' });
    }

    if (!isLegacyFallbackEnabled() || process.env.NODE_ENV === 'production') {
      console.warn('[whatsapp-assistant] no DB WhatsApp connection for webhook instance', {
        instance: normalizedPayload.instance ?? null,
      });
      return res.status(200).json({ ignored: true, reason: 'no_connection' });
    }

    const clinic = await getClinicForWhatsAppInstance(normalizedPayload.instance);
    if (!clinic) return res.status(200).json({ ignored: true, reason: 'legacy_clinic_not_found' });

    const legacyConnectionId = normalizedPayload.instance?.trim()
      ? `legacy:evolution:${normalizedPayload.instance.trim()}`
      : null;
    const inboundEvent = await createInboundEventOrDetectDuplicate({
      channel: 'whatsapp',
      provider: 'evolution',
      connectionId: legacyConnectionId,
      clinicId: clinic.id,
      organizationId: clinic.organizationId,
      providerMessageId: incomingMessage.messageId,
      providerConversationId: incomingMessage.phone,
      fromExternalId: incomingMessage.phone,
      toExternalId: normalizedPayload.instance ?? null,
      fromPhone: incomingMessage.phone,
      rawPayload: normalizedPayload as Record<string, unknown>,
    });
    if (inboundEvent.status === 'duplicate') {
      console.info('[whatsapp-assistant] duplicate inbound event', {
        channel: 'whatsapp',
        provider: 'evolution',
        connectionId: legacyConnectionId,
        messageId: incomingMessage.messageId ?? null,
      });
      return res.status(200).json({ ignored: true, reason: 'duplicate_message' });
    }
    if (inboundEvent.status === 'created') {
      inboundEventId = inboundEvent.eventId;
    } else {
      console.warn('[whatsapp-assistant] idempotency skipped', {
        reason: inboundEvent.reason,
        channel: 'whatsapp',
        provider: 'evolution',
        connectionId: legacyConnectionId,
      });
    }

    const duplicate = await hasProcessedWhatsAppProviderMessage(clinic.id, incomingMessage.phone, incomingMessage.messageId);
    if (duplicate) {
      await markInboundEventProcessed(inboundEventId);
      return res.status(200).json({ ignored: true, reason: 'duplicate_message' });
    }

    const responseText = await handleIncomingWhatsAppMessage(incomingMessage, clinic);
    const patient = await findExistingPatientByPhone(clinic.id, incomingMessage.phone);
    await sendWhatsAppMessage(clinic.id, { phone: incomingMessage.phone, text: responseText });
    if (patient) {
      await saveWhatsAppConversationMessage({ clinicId: clinic.id, patientId: patient.id, phone: incomingMessage.phone, direction: 'outgoing', text: responseText });
    }
    await markWhatsAppProviderMessageProcessed(clinic.id, incomingMessage.phone, incomingMessage.messageId);
    await markInboundEventProcessed(inboundEventId);
    console.info('[whatsapp-assistant] send-result', { phone: redactPhone(incomingMessage.phone), instance: normalizedPayload.instance ?? null });
    res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'DUPLICATE_WHATSAPP_MESSAGE') {
      await markInboundEventProcessed(inboundEventId).catch(() => {});
      return res.status(200).json({ ignored: true, reason: 'duplicate_message' });
    }
    await markInboundEventFailed(inboundEventId, error).catch(() => {});
    console.error('[whatsapp-assistant] webhook-error', error);
    res.status(500).json({ error: 'Failed to process Evolution webhook' });
  }
});

// GET /services
router.get('/services', authorizeWhatsappApi, async (_req, res) => {
  try {
    const clinic = await getDefaultClinic();
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    const services = await prisma.appointmentType.findMany({
      where: { clinicId: clinic.id, isActive: true, isService: true },
      select: { id: true, name: true, durationMinutes: true, category: true, description: true },
      orderBy: { name: 'asc' },
    });
    res.json({ clinic: { id: clinic.id, name: clinic.name }, services });
  } catch {
    res.status(500).json({ error: 'Failed to fetch WhatsApp services' });
  }
});

// GET /doctors
router.get('/doctors', authorizeWhatsappApi, async (_req, res) => {
  try {
    const clinic = await getDefaultClinic();
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    const doctors = await prisma.user.findMany({
      where: { clinicId: clinic.id, role: 'doctor', isActive: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    res.json({ clinic: { id: clinic.id, name: clinic.name }, doctors });
  } catch {
    res.status(500).json({ error: 'Failed to fetch WhatsApp doctors' });
  }
});

// GET /availability
router.get('/availability', authorizeWhatsappApi, async (req, res) => {
  const validation = whatsappAvailabilityQuerySchema.safeParse(req.query);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });
  try {
    const clinic = await getDefaultClinic();
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    const slots = await buildAvailableSlots(prisma, clinic.id, validation.data.appointmentTypeId, validation.data.date, validation.data.practitionerId);
    if (!slots) return res.status(404).json({ error: 'Service not found' });
    res.json({ clinic: { id: clinic.id, name: clinic.name }, slots });
  } catch {
    res.status(500).json({ error: 'Failed to fetch WhatsApp availability' });
  }
});

// GET /appointment-lookup
router.get('/appointment-lookup', authorizeWhatsappApi, async (req, res) => {
  const validation = whatsappAppointmentLookupQuerySchema.safeParse(req.query);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });
  try {
    const clinic = await getDefaultClinic();
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    const patient = await findExistingPatientByPhone(clinic.id, validation.data.phone);
    if (!patient) {
      return res.json({ clinic: { id: clinic.id, name: clinic.name }, appointments: [] });
    }
    const appointments = await prisma.appointment.findMany({
      where: { clinicId: clinic.id, deletedAt: null, patientId: patient.id },
      select: { id: true, startTime: true, endTime: true, status: true, appointmentType: { select: { id: true, name: true } }, practitioner: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { startTime: 'asc' },
      take: 10,
    });
    const timeZone = clinic.timezone || 'Europe/Istanbul';
    const results = appointments.map(a => {
      const start = formatClinicDateTime(a.startTime, timeZone);
      const end = formatClinicDateTime(a.endTime, timeZone);
      return {
        id: a.id, date: start.date, startTime: start.time, endTime: end.time,
        service: a.appointmentType ? { id: a.appointmentType.id, name: a.appointmentType.name } : null,
        practitioner: a.practitioner ? { id: a.practitioner.id, name: `${a.practitioner.firstName} ${a.practitioner.lastName}` } : null,
        status: a.status,
      };
    });
    res.json({ clinic: { id: clinic.id, name: clinic.name }, appointments: results });
  } catch {
    res.status(500).json({ error: 'Failed to lookup WhatsApp appointments' });
  }
});

// POST /appointment-requests
router.post('/appointment-requests', authorizeWhatsappApi, async (req, res) => {
  const validation = whatsappAppointmentRequestSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });
  try {
    const clinic = await getDefaultClinic();
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    const phone = normalizePhone(validation.data.phone);
    const existingPatient = await findExistingPatientByPhone(clinic.id, phone);
    if (validation.data.appointmentTypeId) {
      const service = await prisma.appointmentType.findFirst({ where: { id: validation.data.appointmentTypeId, clinicId: clinic.id, isActive: true } });
      if (!service) return res.status(400).json({ error: 'Invalid appointment type' });
    }
    if (validation.data.practitionerId) {
      const practitioner = await prisma.user.findFirst({ where: { id: validation.data.practitionerId, clinicId: clinic.id, role: 'doctor', isActive: true } });
      if (!practitioner) return res.status(400).json({ error: 'Invalid practitioner' });
    }
    const request = await prisma.appointmentRequest.create({
      data: {
        clinicId: clinic.id, patientId: existingPatient?.id,
        patientName: validation.data.patientName, phone, email: validation.data.email,
        appointmentTypeId: validation.data.appointmentTypeId, practitionerId: validation.data.practitionerId,
        preferredStartTime: validation.data.preferredStartTime, preferredEndTime: validation.data.preferredEndTime,
        requestType: validation.data.requestType, source: 'whatsapp',
        externalSenderId: phone,
        sourceConversationId: phone,
        rawMessage: validation.data.rawMessage, notes: validation.data.notes,
      },
      include: { appointmentType: true, practitioner: { select: { id: true, firstName: true, lastName: true } } },
    });
    console.info('[appointment-request] created', {
      channel: 'whatsapp',
      clinicId: summarizeIdentifier(clinic.id),
      inboxEntryId: null,
      conversationId: redactPhone(phone),
      patientId: summarizeIdentifier(existingPatient?.id),
      serviceId: summarizeIdentifier(validation.data.appointmentTypeId),
      serviceName: request.appointmentType?.name ?? null,
      practitionerId: summarizeIdentifier(validation.data.practitionerId),
      practitionerName: request.practitioner ? `${request.practitioner.firstName} ${request.practitioner.lastName}` : null,
      requestedDateTime: validation.data.preferredStartTime?.toISOString() ?? null,
      requestId: summarizeIdentifier(request.id),
    });
    res.status(201).json(request);
  } catch {
    res.status(500).json({ error: 'Failed to create WhatsApp appointment request' });
  }
});

// POST /cancel-request
router.post('/cancel-request', authorizeWhatsappApi, async (req, res) => {
  const validation = whatsappAppointmentRequestSchema.safeParse({ ...req.body, requestType: 'cancel' });
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });
  try {
    const clinic = await getDefaultClinic();
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    const cancelPhone = normalizePhone(validation.data.phone);
    const existingPatient = await findExistingPatientByPhone(clinic.id, cancelPhone);
    const request = await prisma.appointmentRequest.create({
      data: {
        clinicId: clinic.id, patientId: existingPatient?.id,
        patientName: validation.data.patientName, phone: cancelPhone, email: validation.data.email,
        requestType: 'cancel', source: 'whatsapp',
        externalSenderId: cancelPhone,
        sourceConversationId: cancelPhone,
        rawMessage: validation.data.rawMessage, notes: validation.data.notes,
      },
    });
    console.info('[appointment-request] created', {
      channel: 'whatsapp',
      clinicId: summarizeIdentifier(clinic.id),
      inboxEntryId: null,
      conversationId: redactPhone(cancelPhone),
      patientId: summarizeIdentifier(existingPatient?.id),
      serviceId: null,
      serviceName: null,
      practitionerId: null,
      practitionerName: null,
      requestedDateTime: null,
      requestId: summarizeIdentifier(request.id),
    });
    res.status(201).json(request);
  } catch {
    res.status(500).json({ error: 'Failed to create WhatsApp cancel request' });
  }
});

export default router;
