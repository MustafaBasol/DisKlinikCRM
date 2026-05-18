import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../db.js';
import { sendTextMessage } from '../services/evolutionApi.js';
import { extractAssistantInputWithGoogleAi } from '../services/googleAiStudio.js';
import {
  buildAvailableSlots,
  loadAvailabilityForDate,
  saveSlotsForState,
  type SavedAvailableSlot,
} from '../services/whatsappAvailability.js';
import { handleAwaitingConfirmationStep, handleAwaitingDateStep, handleAwaitingServiceStep, handleAwaitingTimeStep } from '../services/whatsappBookingFlow.js';
import {
  extractExplicitRequestedTime as interpretExplicitRequestedTime,
  extractExplicitTimeThreshold as interpretExplicitTimeThreshold,
  getTimePreference as interpretTimePreference,
  isDifferentDateRequest as interpretDifferentDateRequest,
  isMoreOptionsRequest as interpretMoreOptionsRequest,
  type TimePreference,
} from '../services/whatsappInterpreter.js';
import { routeResolvedWhatsAppIntent } from '../services/whatsappResolvedIntentRouter.js';
import {
  getWebhookIgnoreReason,
  normalizeEvolutionWebhookPayload,
  type NormalizedWhatsAppMessage,
} from '../services/whatsappWebhookPayload.js';
import {
  validateOptionalWebhookSecret,
  validateWhatsappApiSecret,
  whatsappAppointmentLookupQuerySchema,
  whatsappAppointmentRequestSchema,
  whatsappAvailabilityQuerySchema,
} from '../services/whatsappPublicApi';
import { logActivity } from '../utils/activity.js';
import { formatTurkishDateLong, normalizeDateFromTurkishInput, WHATSAPP_ASSISTANT_TIME_ZONE } from '../utils/whatsappDate.js';
import { getZonedDateParts, minutesToTime, timeToMinutes, formatClinicDateTime } from '../utils/helpers.js';

const router = express.Router();

// ---- Type Definitions ----

type AssistantIntent = 'book_appointment' | 'check_appointment' | 'cancel_appointment' | 'service_info' | 'unknown';
type AssistantStep =
  | 'main_menu'
  | 'awaiting_name'
  | 'awaiting_service'
  | 'awaiting_date'
  | 'awaiting_time'
  | 'awaiting_confirmation'
  | 'awaiting_cancel_selection';

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
  date: string;
  startTime: string;
  endTime: string;
  serviceName: string | null;
  practitionerName: string | null;
  status: string;
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
};

// ---- Helper Middlewares ----

const optionalWhatsappWebhookSecret: express.RequestHandler = (req, res, next) => {
  const validationResult = validateOptionalWebhookSecret(process.env.WHATSAPP_WEBHOOK_SECRET, {
    authorization: req.headers.authorization,
    xWhatsappSecret: req.headers['x-whatsapp-secret'],
  });
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
  return ['tesekkurler', 'tesekkur ederim', 'sag olun', 'tamam', 'iyi gunler'].includes(normalized);
};

const extractNumericSelection = (text: string) => {
  const match = normalizeIntentText(text).match(/(?:^|\D)(\d{1,2})(?:\D|$)/);
  return match ? Number(match[1]) : null;
};

const readConversationStateJson = (value: unknown): ConversationStateJson => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const stateValue = value as Record<string, unknown>;
  return {
    availableSlots: Array.isArray(stateValue.availableSlots) ? stateValue.availableSlots as SavedAvailableSlot[] : undefined,
    lastShownSlots: Array.isArray(stateValue.lastShownSlots) ? stateValue.lastShownSlots as SavedAvailableSlot[] : undefined,
    cancellableAppointments: Array.isArray(stateValue.cancellableAppointments) ? stateValue.cancellableAppointments as SavedAppointmentSummary[] : undefined,
    matchedServices: Array.isArray(stateValue.matchedServices) ? stateValue.matchedServices as SavedServiceOption[] : undefined,
    pendingConfirmationSlot: stateValue.pendingConfirmationSlot && typeof stateValue.pendingConfirmationSlot === 'object' && !Array.isArray(stateValue.pendingConfirmationSlot)
      ? stateValue.pendingConfirmationSlot as SavedAvailableSlot
      : undefined,
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

const formatAppointmentLookupForMessage = (appointments: SavedAppointmentSummary[]) => {
  if (appointments.length === 0) {
    return 'Telefon numaranızla eşleşen aktif bir randevu göremedim. İsterseniz birlikte yeni bir randevu planlayabiliriz.';
  }
  return ['Sistemde görebildiğim randevularınız şunlar:',
    ...appointments.map((a, i) => `${i + 1}. ${a.date} ${a.startTime} - ${a.serviceName ?? 'Hizmet bilgisi yok'}${a.practitionerName ? ` / ${a.practitionerName}` : ''} / ${a.status}`),
  ].join('\n');
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

const logGlobalIntent = (phone: string, text: string, previousStep: string | null | undefined, globalIntent: string) => {
  console.log('[whatsapp-assistant] global-intent', { phone, text, previousStep: previousStep ?? null, globalIntent });
};

const logStateTransition = (phone: string, fromStep: string | null | undefined, toStep: string | null | undefined, reason: string) => {
  console.log('[whatsapp-assistant] state-transition', { phone, fromStep: fromStep ?? null, toStep: toStep ?? null, reason });
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
  return ['randevumu sorgulamak istiyorum', 'randevum var mi', 'randevumu ogrenmek istiyorum',
    'randevu bilgilerimi goster', 'randevu durumumu goster']
    .some(pattern => normalized.includes(pattern));
};

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
  const matchedService = findServiceSelection(text, services);
  const timeMatch = normalized.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  let intent: AssistantIntent = 'unknown';

  if (normalized === '1' || /(randevu al|randevu almak|randevu oluştur|randevu olustur|randevu istiyorum)/.test(normalized)) {
    intent = 'book_appointment';
  } else if (normalized === '2' || /(randevumu sorgu|randevu sorgu|randevum ne zaman|randevu durum|randevum var mı|randevum var mi)/.test(normalized)) {
    intent = 'check_appointment';
  } else if (normalized === '3' || /(iptal|randevumu iptal|randevu iptal)/.test(normalized)) {
    intent = 'cancel_appointment';
  } else if (normalized === '4' || /(hizmet|tedavi|bilgi almak|fiyat|servis)/.test(normalized)) {
    intent = 'service_info';
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

const mergeAssistantExtractions = (ruleBased: AssistantExtraction, aiBased: AssistantExtraction | null, services: AssistantService[]): AssistantExtraction => {
  const aiService = aiBased?.appointmentTypeId
    ? services.find(s => s.id === aiBased.appointmentTypeId) ?? null
    : aiBased?.appointmentTypeName
      ? findServiceSelection(aiBased.appointmentTypeName, services)
      : null;

  return {
    intent: ruleBased.intent !== 'unknown' ? ruleBased.intent : (aiBased?.intent ?? 'unknown'),
    name: ruleBased.name ?? aiBased?.name ?? null,
    phone: ruleBased.phone ?? aiBased?.phone ?? null,
    appointmentTypeName: ruleBased.appointmentTypeName ?? aiService?.name ?? aiBased?.appointmentTypeName ?? null,
    appointmentTypeId: ruleBased.appointmentTypeId ?? aiService?.id ?? aiBased?.appointmentTypeId ?? null,
    dateText: ruleBased.dateText ?? aiBased?.dateText ?? null,
    time: ruleBased.time ?? aiBased?.time ?? null,
    exactTime: ruleBased.exactTime ?? aiBased?.exactTime ?? null,
    afterTime: ruleBased.afterTime ?? aiBased?.afterTime ?? null,
    timePreference: ruleBased.timePreference ?? aiBased?.timePreference ?? null,
    confidence: ruleBased.confidence > 0.2 ? ruleBased.confidence : (aiBased?.confidence ?? ruleBased.confidence),
    needsClarification: aiBased?.needsClarification ?? false,
    clarificationReason: aiBased?.clarificationReason ?? null,
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
    const merged = mergeAssistantExtractions(ruleBased, aiBased, services);
    console.info('[whatsapp-assistant] extraction-source', {
      usedAi: Boolean(aiBased),
      intent: merged.intent,
      timePreference: merged.timePreference,
      exactTime: merged.exactTime,
      afterTime: merged.afterTime,
      confidence: merged.confidence,
      needsClarification: merged.needsClarification,
    });
    return merged;
  } catch (error) {
    console.error('[whatsapp-assistant] ai-extraction-error', error);
    return ruleBased;
  }
};

// ---- State Management ----

const resetWhatsAppConversationState = async (clinicId: string, phone: string, customerName?: string | null) => {
  return prisma.whatsAppConversationState.upsert({
    where: { clinicId_phone: { clinicId, phone } },
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
      phone,
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
  }
) => {
  const { stateJson: rawStateJson, ...rest } = data;
  const stateJson = toPrismaStateJson(rawStateJson);
  return prisma.whatsAppConversationState.upsert({
    where: { clinicId_phone: { clinicId, phone } },
    update: { ...rest, ...(stateJson !== undefined ? { stateJson } : {}) },
    create: { clinicId, phone, ...rest, ...(stateJson !== undefined ? { stateJson } : {}) },
  });
};

// ---- Availability / Appointment Helpers ----

const checkPractitionerAvailability = async (clinicId: string, practitionerId: string, startTime: Date, endTime: Date) => {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } });
  const timeZone = clinic?.timezone || 'Europe/Istanbul';
  const start = getZonedDateParts(startTime, timeZone);
  const end = getZonedDateParts(endTime, timeZone);
  if (start.weekday !== end.weekday) return { ok: false, slots: [], timeZone };
  const slots = await prisma.doctorAvailability.findMany({
    where: { clinicId, practitionerId, weekday: start.weekday, isActive: true },
    orderBy: { startTime: 'asc' },
  });
  const ok = slots.some(slot => {
    const slotStart = timeToMinutes(slot.startTime);
    const slotEnd = timeToMinutes(slot.endTime);
    return start.minutes >= slotStart && end.minutes <= slotEnd;
  });
  return { ok, slots, timeZone };
};

const getDefaultClinic = async () => prisma.clinic.findFirst({ orderBy: { createdAt: 'asc' } });

const getAssistantServices = async (clinicId: string): Promise<AssistantService[]> => {
  const services = await prisma.appointmentType.findMany({
    where: { clinicId, isActive: true, isService: true },
    select: { id: true, name: true, durationMinutes: true },
    orderBy: { name: 'asc' },
  });
  return services.length > 0 ? services : WHATSAPP_FALLBACK_SERVICES;
};

const findExistingPatientByPhone = async (clinicId: string, phone: string) =>
  prisma.patient.findFirst({
    where: { clinicId, phone, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });

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
      clinicId, firstName: parsedName.firstName, lastName: parsedName.lastName,
      phone, source: 'whatsapp', patientStatus: 'new', communicationConsent: false,
      notes: 'WhatsApp üzerinden ilk temas sonrası oluşturuldu.',
    },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
  const systemUserId = await getClinicSystemUserId(clinicId);
  if (systemUserId) {
    await logActivity({
      clinicId, userId: systemUserId, entityType: 'patient', entityId: patient.id,
      action: 'created',
      description: `Patient automatically created from first WhatsApp contact (${phone})`,
      patientId: patient.id,
      metadata: { systemGenerated: true, source: 'whatsapp', phone },
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
  direction: 'incoming' | 'outgoing';
  text: string;
  rawPayload?: Record<string, unknown> | null;
}) => {
  return prisma.whatsAppConversationMessage.create({
    data: {
      clinicId: args.clinicId,
      patientId: args.patientId,
      phone: args.phone,
      direction: args.direction,
      text: args.text,
      rawPayload: args.rawPayload ? args.rawPayload as Prisma.InputJsonValue : Prisma.DbNull,
    },
  });
};

const ensurePatientForWhatsApp = async (clinicId: string, phone: string, customerName: string) => {
  const patient = await ensureWhatsAppContactPatient(clinicId, phone, customerName);
  if (!patient) throw new Error('PATIENT_NAME_REQUIRED');
  return patient;
};

const getAppointmentsForPhone = async (clinicId: string, phone: string) => {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } });
  const timeZone = clinic?.timezone || 'Europe/Istanbul';
  const now = new Date();
  const appointments = await prisma.appointment.findMany({
    where: {
      clinicId, deletedAt: null, status: { notIn: ['cancelled'] },
      startTime: { gte: now }, patient: { phone, deletedAt: null },
    },
    select: {
      id: true, startTime: true, endTime: true, status: true,
      appointmentType: { select: { name: true } },
      practitioner: { select: { firstName: true, lastName: true } },
    },
    orderBy: { startTime: 'asc' },
    take: 10,
  });
  return appointments.map(a => {
    const start = formatClinicDateTime(a.startTime, timeZone);
    const end = formatClinicDateTime(a.endTime, timeZone);
    return {
      id: a.id, date: start.date, startTime: start.time, endTime: end.time,
      serviceName: a.appointmentType?.name ?? null,
      practitionerName: a.practitioner ? `${a.practitioner.firstName} ${a.practitioner.lastName}` : null,
      status: a.status,
    } satisfies SavedAppointmentSummary;
  });
};

const createAppointmentFromAssistant = async (
  clinicId: string, phone: string, customerName: string,
  appointmentTypeId: string, selectedSlot: SavedAvailableSlot, rawMessage?: string | null
) => {
  const patient = await ensurePatientForWhatsApp(clinicId, phone, customerName);
  const startTime = new Date(selectedSlot.startTime);
  const endTime = new Date(selectedSlot.endTime);

  const availability = await checkPractitionerAvailability(clinicId, selectedSlot.practitionerId, startTime, endTime);
  if (!availability.ok) throw new Error('APPOINTMENT_OUTSIDE_AVAILABILITY');

  const overlap = await prisma.appointment.findFirst({
    where: {
      clinicId, practitionerId: selectedSlot.practitionerId, deletedAt: null,
      status: { notIn: ['cancelled'] },
      OR: [{ startTime: { lt: endTime }, endTime: { gt: startTime } }],
    },
    select: { id: true },
  });
  if (overlap) throw new Error('APPOINTMENT_OVERLAP');

  const appointment = await prisma.appointment.create({
    data: {
      clinicId, patientId: patient.id, practitionerId: selectedSlot.practitionerId,
      appointmentTypeId, startTime, endTime, status: 'scheduled',
      notes: 'WhatsApp assistant üzerinden oluşturuldu.',
    },
    include: {
      appointmentType: { select: { name: true } },
      practitioner: { select: { firstName: true, lastName: true } },
      patient: { select: { firstName: true, lastName: true } },
    },
  });

  await prisma.appointmentRequest.create({
    data: {
      clinicId, patientId: patient.id,
      patientName: getPatientFullName(patient), phone, appointmentTypeId,
      practitionerId: selectedSlot.practitionerId, preferredStartTime: startTime, preferredEndTime: endTime,
      requestType: 'appointment', source: 'whatsapp', status: 'converted',
      rawMessage: rawMessage ?? null,
      notes: 'WhatsApp assistant üzerinden otomatik olarak takvime işlendi.',
      convertedAppointmentId: appointment.id,
    },
  });

  return appointment;
};

const cancelAppointmentForPhone = async (clinicId: string, appointmentId: string, phone: string) => {
  const appointment = await prisma.appointment.findFirst({
    where: {
      id: appointmentId, clinicId, deletedAt: null,
      status: { notIn: ['cancelled'] },
      patient: { phone, deletedAt: null },
    },
    include: { appointmentType: { select: { name: true } }, practitioner: { select: { firstName: true, lastName: true } } },
  });
  if (!appointment) return null;
  return prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      status: 'cancelled',
      cancellationReason: 'WhatsApp assistant tarafından iptal edildi.',
      notes: appointment.notes ? `${appointment.notes}\nWhatsApp assistant tarafından iptal edildi.` : 'WhatsApp assistant tarafından iptal edildi.',
    },
    include: { appointmentType: { select: { name: true } }, practitioner: { select: { firstName: true, lastName: true } } },
  });
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

// ---- Main Conversation Handler ----

const handleIncomingWhatsAppMessage = async (input: NormalizedWhatsAppMessage) => {
  const clinic = await getDefaultClinic();
  if (!clinic) return 'Klinik ayarlarına şu anda erişemiyorum.';

  const existingPatient = await findExistingPatientByPhone(clinic.id, input.phone);
  const state = await prisma.whatsAppConversationState.findUnique({
    where: { clinicId_phone: { clinicId: clinic.id, phone: input.phone } },
  });

  if (existingPatient) {
    await saveWhatsAppConversationMessage({
      clinicId: clinic.id, patientId: existingPatient.id, phone: input.phone,
      direction: 'incoming', text: input.text, rawPayload: input.rawPayload,
    });
  }

  const stateJson = readConversationStateJson(state?.stateJson);
  const services = await getAssistantServices(clinic.id);
  const normalizedText = normalizeIntentText(input.text);
  const persistedCustomerName = existingPatient ? getPatientFullName(existingPatient) : null;
  const customerName = state?.customerName || persistedCustomerName;
  const currentStep = (state?.step ?? null) as AssistantStep | 'main_menu' | null;
  const selectedAppointmentTypeId = state?.selectedAppointmentTypeId ?? null;
  const selectedAppointmentTypeName = state?.selectedAppointmentTypeName ?? null;
  const selectedPractitionerId = state?.selectedPractitionerId ?? null;
  const selectedDate = state?.selectedDate ?? null;
  const hasActiveBookingFlow = ['awaiting_service', 'awaiting_date', 'awaiting_time', 'awaiting_confirmation'].includes(currentStep ?? '');

  console.log('[whatsapp-assistant] route-start', { phone: input.phone, text: input.text, previousStep: state?.step ?? null });
  console.info('[whatsapp-assistant] incoming', { phone: input.phone, text: input.text.slice(0, 200) });

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

  if (isCheckAppointmentIntent(input.text)) {
    logGlobalIntent(input.phone, input.text, currentStep, 'check_appointment');
    logStateTransition(input.phone, currentStep, 'main_menu', 'global_check_appointment');
    await upsertWhatsAppConversationState(clinic.id, input.phone, { customerName, step: null, currentIntent: 'check_appointment', lastMessage: input.text, ...clearBookingState() });
    const appointments = await getAppointmentsForPhone(clinic.id, input.phone);
    return formatAppointmentLookupForMessage(appointments);
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

  if (!existingPatient && currentStep !== 'awaiting_name') {
    console.log('[whatsapp-assistant] route-handler', { phone: input.phone, handler: 'awaiting_name', selectedAppointmentTypeId: null, selectedAppointmentTypeName: null, selectedDate: null });
    await upsertWhatsAppConversationState(clinic.id, input.phone, {
      customerName: null, currentIntent: null, step: 'awaiting_name',
      selectedAppointmentTypeId: null, selectedAppointmentTypeName: null, selectedPractitionerId: null,
      selectedDate: null, selectedTime: null, lastMessage: input.text, stateJson: null,
    });
    return `Merhaba, ${formatClinicWelcomeName(clinic.name)} hoş geldiniz. Size yardımcı olabilmem için adınızı ve soyadınızı paylaşır mısınız?`;
  }

  if (currentStep === 'awaiting_name') {
    console.log('[whatsapp-assistant] route-handler', { phone: input.phone, handler: 'awaiting_name', selectedAppointmentTypeId: null, selectedAppointmentTypeName: null, selectedDate: null });
    const parsedName = splitNameForPatient(input.text);
    if (!parsedName.firstName || !hasValidLastName(parsedName.lastName)) {
      await upsertWhatsAppConversationState(clinic.id, input.phone, { customerName: null, currentIntent: null, step: 'awaiting_name', lastMessage: input.text, stateJson: null });
      return 'Kaydınızı oluşturabilmem için ad ve soyadınızı birlikte paylaşır mısınız? Örneğin Mustafa Yılmaz gibi yazabilirsiniz.';
    }
    const createdPatient = await createPatientFromWhatsAppName(clinic.id, input.phone, input.text);
    await saveWhatsAppConversationMessage({ clinicId: clinic.id, patientId: createdPatient.id, phone: input.phone, direction: 'incoming', text: input.text, rawPayload: input.rawPayload });
    const fullName = getPatientFullName(createdPatient);
    await upsertWhatsAppConversationState(clinic.id, input.phone, {
      customerName: fullName, currentIntent: null, step: 'main_menu',
      selectedAppointmentTypeId: null, selectedAppointmentTypeName: null, selectedPractitionerId: null,
      selectedDate: null, selectedTime: null, lastMessage: input.text, stateJson: null,
    });
    return formatMainMenu(fullName, false, clinic.name);
  }

  if ((!currentStep || currentStep === 'main_menu') && (isGreetingMessage(input.text) || normalizedText === '0')) {
    console.log('[whatsapp-assistant] route-handler', { phone: input.phone, handler: 'main_menu', selectedAppointmentTypeId: null, selectedAppointmentTypeName: null, selectedDate: null });
    await upsertWhatsAppConversationState(clinic.id, input.phone, { customerName, currentIntent: null, step: 'main_menu', lastMessage: input.text, stateJson: null });
    return formatMainMenu(customerName, true, clinic.name);
  }

  if (currentStep === 'main_menu') {
    console.log('[whatsapp-assistant] route-handler', { phone: input.phone, handler: 'main_menu', selectedAppointmentTypeId: null, selectedAppointmentTypeName: null, selectedDate: null });
    if (normalizedText === '1') {
      await upsertWhatsAppConversationState(clinic.id, input.phone, { customerName, currentIntent: 'book_appointment', step: 'awaiting_service', selectedAppointmentTypeId: null, selectedAppointmentTypeName: null, selectedDate: null, selectedTime: null, lastMessage: input.text, stateJson: null });
      return formatServiceList(services);
    }
    if (normalizedText === '2') {
      const appointments = await getAppointmentsForPhone(clinic.id, input.phone);
      return formatAppointmentLookupForMessage(appointments);
    }
    if (normalizedText === '3') return handleCancelIntent(clinic.id, input.phone);
    if (normalizedText === '4') {
      return ['Hizmetlerimiz şu şekilde:', ...services.map((s, i) => `${i + 1}. ${s.name}`)].join('\n');
    }
    if (/^\d+$/.test(normalizedText)) return formatMainMenu(customerName, true, clinic.name);
  }

  if (currentStep === 'awaiting_cancel_selection') {
    console.log('[whatsapp-assistant] route-handler', { phone: input.phone, handler: 'awaiting_cancel_selection', selectedAppointmentTypeId: null, selectedAppointmentTypeName: null, selectedDate: null });
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
    console.log('[whatsapp-assistant] route-handler', { phone: input.phone, handler: 'awaiting_service', selectedAppointmentTypeId: state?.selectedAppointmentTypeId ?? null, selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null, selectedDate: state?.selectedDate ?? null });
    return handleAwaitingServiceStep({
      text: input.text, phone: input.phone, customerName, services,
      state: { selectedAppointmentTypeId: state?.selectedAppointmentTypeId, selectedAppointmentTypeName: state?.selectedAppointmentTypeName, selectedDate: state?.selectedDate },
      stateJson: { matchedServices: stateJson.matchedServices },
      extractNumericSelection, findServiceMatches, formatServiceList,
      upsertState: data => upsertWhatsAppConversationState(clinic.id, input.phone, data),
    });
  }

  if (currentStep === 'awaiting_date') {
    console.log('[whatsapp-assistant] route-handler', { phone: input.phone, handler: 'awaiting_date', selectedAppointmentTypeId: state?.selectedAppointmentTypeId ?? null, selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null, selectedDate: state?.selectedDate ?? null });
    return handleAwaitingDateStep({
      prisma, clinicId: clinic.id, text: input.text, customerName,
      state: { selectedAppointmentTypeId: state?.selectedAppointmentTypeId, selectedAppointmentTypeName: state?.selectedAppointmentTypeName, selectedPractitionerId: state?.selectedPractitionerId },
      buildAvailableSlots, formatAvailabilityMessage, logAvailabilitySave, minutesToTime,
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
    console.log('[whatsapp-assistant] route-handler', { phone: input.phone, handler: 'awaiting_time', selectedAppointmentTypeId: state?.selectedAppointmentTypeId ?? null, selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null, selectedDate: state?.selectedDate ?? null });
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
      createAppointment: createAppointmentFromAssistant,
    });
  }

  if (currentStep === 'awaiting_confirmation') {
    console.log('[whatsapp-assistant] route-handler', { phone: input.phone, handler: 'awaiting_confirmation', selectedAppointmentTypeId: state?.selectedAppointmentTypeId ?? null, selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null, selectedDate: state?.selectedDate ?? null });
    return handleAwaitingConfirmationStep({
      clinicId: clinic.id, phone: input.phone, text: input.text, customerName,
      state: { selectedAppointmentTypeId: state?.selectedAppointmentTypeId, selectedAppointmentTypeName: state?.selectedAppointmentTypeName, selectedPractitionerId: state?.selectedPractitionerId, selectedDate: state?.selectedDate },
      stateJson: { availableSlots: stateJson.availableSlots, lastShownSlots: stateJson.lastShownSlots, pendingConfirmationSlot: stateJson.pendingConfirmationSlot },
      upsertState: data => upsertWhatsAppConversationState(clinic.id, input.phone, data),
      resetState: nextCustomerName => resetWhatsAppConversationState(clinic.id, input.phone, nextCustomerName),
      createAppointment: createAppointmentFromAssistant,
    });
  }

  if ((!currentStep || currentStep === 'main_menu') && isClosingMessage(input.text)) {
    const firstName = getFirstNameFromCustomerName(customerName);
    return firstName ? `Rica ederim ${firstName}. Sağlıklı günler dilerim.` : 'Rica ederim. Sağlıklı günler dilerim.';
  }

  const extracted = await resolveAssistantExtraction(input.text, services, {
    currentIntent: state?.currentIntent, step: state?.step, customerName: state?.customerName,
    selectedAppointmentTypeId: state?.selectedAppointmentTypeId, selectedAppointmentTypeName: state?.selectedAppointmentTypeName, selectedDate: state?.selectedDate,
  });

  console.info('[whatsapp-assistant] detected', {
    intent: extracted.intent, step: state?.step ?? null, confidence: extracted.confidence,
    needsClarification: extracted.needsClarification, exactTime: extracted.exactTime,
    afterTime: extracted.afterTime, timePreference: extracted.timePreference,
  });

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
router.post('/evolution-webhook', optionalWhatsappWebhookSecret, async (req, res) => {
  const normalizedPayload = normalizeEvolutionWebhookPayload(req.body);
  const ignoreReason = getWebhookIgnoreReason(normalizedPayload);
  if (ignoreReason) return res.status(200).json({ ignored: true, reason: ignoreReason });

  const incomingMessage = normalizedPayload.message;
  if (!incomingMessage) return res.status(200).json({ ignored: true, reason: 'no_text_message' });

  try {
    const responseText = await handleIncomingWhatsAppMessage(incomingMessage);
    const clinic = await getDefaultClinic();
    const patient = clinic ? await findExistingPatientByPhone(clinic.id, incomingMessage.phone) : null;
    await sendTextMessage(incomingMessage.phone, responseText);
    if (clinic && patient) {
      await saveWhatsAppConversationMessage({ clinicId: clinic.id, patientId: patient.id, phone: incomingMessage.phone, direction: 'outgoing', text: responseText });
    }
    console.info('[whatsapp-assistant] send-result', { phone: incomingMessage.phone, instance: normalizedPayload.instance ?? null });
    res.status(200).json({ ok: true });
  } catch (error) {
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
    const appointments = await prisma.appointment.findMany({
      where: { clinicId: clinic.id, deletedAt: null, patient: { phone: validation.data.phone, deletedAt: null } },
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
    const existingPatient = await prisma.patient.findFirst({ where: { clinicId: clinic.id, phone: validation.data.phone, deletedAt: null }, select: { id: true } });
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
        patientName: validation.data.patientName, phone: validation.data.phone, email: validation.data.email,
        appointmentTypeId: validation.data.appointmentTypeId, practitionerId: validation.data.practitionerId,
        preferredStartTime: validation.data.preferredStartTime, preferredEndTime: validation.data.preferredEndTime,
        requestType: validation.data.requestType, source: 'whatsapp',
        rawMessage: validation.data.rawMessage, notes: validation.data.notes,
      },
      include: { appointmentType: true, practitioner: { select: { id: true, firstName: true, lastName: true } } },
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
    const existingPatient = await prisma.patient.findFirst({ where: { clinicId: clinic.id, phone: validation.data.phone, deletedAt: null }, select: { id: true } });
    const request = await prisma.appointmentRequest.create({
      data: {
        clinicId: clinic.id, patientId: existingPatient?.id,
        patientName: validation.data.patientName, phone: validation.data.phone, email: validation.data.email,
        requestType: 'cancel', source: 'whatsapp',
        rawMessage: validation.data.rawMessage, notes: validation.data.notes,
      },
    });
    res.status(201).json(request);
  } catch {
    res.status(500).json({ error: 'Failed to create WhatsApp cancel request' });
  }
});

export default router;
