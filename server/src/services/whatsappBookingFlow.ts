import type { PrismaClient } from '@prisma/client';
import {
  createAvailabilitySnapshot,
  findNearbySlotsForTime,
  filterSlotsByTimePreference,
  filterSlotsByTimeThreshold,
  formatSlotListMessage,
  loadAvailabilityForDate,
  slotIdentity,
  type SavedAvailableSlot,
} from './whatsappAvailability.js';
import { interpretTimeRequest, type TimePreference } from './whatsappInterpreter.js';
import {
  formatTurkishDateLong,
  formatTurkishDateWithWeekday,
  normalizeDateFromTurkishInput,
  WHATSAPP_ASSISTANT_TIME_ZONE,
} from '../utils/whatsappDate.js';

export type BookingServiceOption = {
  id: string;
  name: string;
  durationMinutes: number;
};

export type SavedServiceOption = {
  id: string;
  name: string;
};

export type BookingStateJson = {
  availableSlots?: SavedAvailableSlot[];
  lastShownSlots?: SavedAvailableSlot[];
  matchedServices?: SavedServiceOption[];
  pendingConfirmationSlot?: SavedAvailableSlot | null;
};

export type AwaitingServiceState = {
  selectedAppointmentTypeId?: string | null;
  selectedAppointmentTypeName?: string | null;
  selectedDate?: string | null;
};

export type AwaitingDateState = {
  selectedAppointmentTypeId?: string | null;
  selectedAppointmentTypeName?: string | null;
  selectedPractitionerId?: string | null;
};

export type AwaitingConfirmationState = {
  selectedAppointmentTypeId?: string | null;
  selectedAppointmentTypeName?: string | null;
  selectedPractitionerId?: string | null;
  selectedDate?: string | null;
};

export type AwaitingTimeState = {
  selectedAppointmentTypeId?: string | null;
  selectedAppointmentTypeName?: string | null;
  selectedPractitionerId?: string | null;
  selectedDate?: string | null;
};

export type SlotMatchResult = {
  extractedTime: string | null;
  hasPractitionerFragment: boolean;
  matches: Array<{ slot: SavedAvailableSlot; index: number }>;
};

export type AwaitingTimeDependencies = {
  prisma: PrismaClient;
  clinicId: string;
  phone: string;
  text: string;
  customerName: string | null;
  state: AwaitingTimeState;
  stateJson: BookingStateJson;
  extractNumericSelection: (text: string) => number | null;
  findSlotMatches: (text: string, slots: SavedAvailableSlot[]) => SlotMatchResult;
  formatAvailabilityMessage: (date: string, slots: SavedAvailableSlot[]) => string;
  minutesToTime: (minutes: number) => string;
  logAvailabilitySave: (totalSlots: number, shownSlots: number) => void;
  interpretTimeWithAi?: (text: string) => Promise<{
    exactTime: string | null;
    afterTime: string | null;
    timePreference: TimePreference | null;
  } | null>;
  upsertState: (data: {
    customerName?: string | null;
    currentIntent?: string | null;
    step?: string | null;
    selectedAppointmentTypeId?: string | null;
    selectedAppointmentTypeName?: string | null;
    selectedPractitionerId?: string | null;
    selectedDate?: string | null;
    selectedTime?: string | null;
    lastMessage?: string | null;
    stateJson?: BookingStateJson | null;
  }) => Promise<unknown>;
  resetState: (customerName?: string | null) => Promise<unknown>;
  createAppointment: (
    clinicId: string,
    phone: string,
    customerName: string,
    appointmentTypeId: string,
    selectedSlot: SavedAvailableSlot,
    rawMessage?: string | null,
  ) => Promise<{ appointmentType: { name: string } | null }>;
};

export type AwaitingServiceDependencies = {
  text: string;
  phone: string;
  customerName: string | null;
  services: BookingServiceOption[];
  state: AwaitingServiceState;
  stateJson: BookingStateJson;
  extractNumericSelection: (text: string) => number | null;
  findServiceMatches: (text: string, services: BookingServiceOption[]) => BookingServiceOption[];
  formatServiceList: (services: BookingServiceOption[]) => string;
  upsertState: (data: {
    customerName?: string | null;
    currentIntent?: string | null;
    step?: string | null;
    selectedAppointmentTypeId?: string | null;
    selectedAppointmentTypeName?: string | null;
    selectedPractitionerId?: string | null;
    selectedDate?: string | null;
    selectedTime?: string | null;
    lastMessage?: string | null;
    stateJson?: BookingStateJson | null;
  }) => Promise<unknown>;
};

const parseTimeStringToMinutes = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const match = value.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
};

const filterSlotsByTimeRange = (slots: SavedAvailableSlot[], startMinutes: number, endMinutes: number) => {
  return slots.filter(slot => {
    const [hours, minutes] = slot.localStartTime.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes;
    return totalMinutes >= startMinutes && totalMinutes <= endMinutes;
  });
};

const normalizeConfirmationText = (value: string) => value
  .trim()
  .toLocaleLowerCase('tr-TR')
  .replace(/ğ/g, 'g')
  .replace(/ü/g, 'u')
  .replace(/ş/g, 's')
  .replace(/ı/g, 'i')
  .replace(/i̇/g, 'i')
  .replace(/ö/g, 'o')
  .replace(/ç/g, 'c')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const isConfirmationApproved = (text: string) => {
  if (/[👍✅👌]/u.test(text)) {
    return true;
  }

  const normalized = normalizeConfirmationText(text);
  return [
    'evet',
    'olur',
    'tamam',
    'onayliyorum',
    'onay veriyorum',
    'olustur',
    'randevuyu olustur',
    'olusturabilirsin',
    '1',
  ].some(pattern => normalized === pattern || (!/^\d+$/.test(pattern) && normalized.includes(pattern)));
};

const isShortAffirmation = (text: string) => {
  if (/[👍✅👌]/u.test(text)) {
    return true;
  }

  const normalized = normalizeConfirmationText(text);
  return [
    'evet',
    'olur',
    'tamam',
    'peki',
    'tabii',
    'tabi',
    'ok',
  ].includes(normalized);
};

const isStandaloneNumericDateExpression = (text: string) => {
  return /^\s*\d{1,2}[./]\d{1,2}(?:[./]\d{4})?\s*$/i.test(text);
};

const isConfirmationRejected = (text: string) => {
  const normalized = normalizeConfirmationText(text);
  return [
    'hayir',
    'istemiyorum',
    'gerek yok',
    'olusturma',
    'randevu olusturma',
    'sadece uygun mu diye sordum',
    'sadece uygun mu diye sormustum',
    'sadece sordum',
    'yalniz uygun mu diye sordum',
    '2',
  ].some(pattern => normalized === pattern || (!/^\d+$/.test(pattern) && normalized.includes(pattern)));
};

export const isDeterministicConfirmationReply = (text: string) =>
  isConfirmationApproved(text) || isConfirmationRejected(text);

const resolveTimeInterpretation = async (
  text: string,
  interpretTimeWithAi?: (text: string) => Promise<{
    exactTime: string | null;
    afterTime: string | null;
    timePreference: TimePreference | null;
  } | null>
) => {
  const interpretedTimeRequest = interpretTimeRequest(text);
  const hasPreciseLocalTimeSignal = interpretedTimeRequest.exactTime !== null
    || interpretedTimeRequest.afterTimeMinutes !== null
    || interpretedTimeRequest.rangeStartMinutes !== null;
  const aiInterpretedTimeRequest = !hasPreciseLocalTimeSignal && interpretTimeWithAi
    ? await interpretTimeWithAi(text)
    : null;
  const aiAfterTimeMinutes = parseTimeStringToMinutes(aiInterpretedTimeRequest?.afterTime);
  const exactTime = interpretedTimeRequest.exactTime ?? aiInterpretedTimeRequest?.exactTime ?? null;
  const afterTimeMinutes = interpretedTimeRequest.afterTimeMinutes ?? aiAfterTimeMinutes;
  const preference = exactTime || afterTimeMinutes !== null
    ? interpretedTimeRequest.preference
    : interpretedTimeRequest.preference ?? aiInterpretedTimeRequest?.timePreference ?? null;

  return {
    interpretedTimeRequest,
    exactTime,
    afterTimeMinutes,
    preference,
    rangeStartMinutes: interpretedTimeRequest.rangeStartMinutes,
    rangeEndMinutes: interpretedTimeRequest.rangeEndMinutes,
  };
};

export type AwaitingDateDependencies = {
  prisma: PrismaClient;
  clinicId: string;
  text: string;
  customerName: string | null;
  state: AwaitingDateState;
  buildAvailableSlots: typeof import('./whatsappAvailability.js').buildAvailableSlots;
  formatAvailabilityMessage: (date: string, slots: SavedAvailableSlot[]) => string;
  logAvailabilitySave: (totalSlots: number, shownSlots: number) => void;
  minutesToTime: (minutes: number) => string;
  now?: Date;
  interpretDateWithAi?: (text: string) => Promise<string | null>;
  interpretTimeWithAi?: (text: string) => Promise<{
    exactTime: string | null;
    afterTime: string | null;
    timePreference: TimePreference | null;
  } | null>;
  upsertState: (data: {
    customerName?: string | null;
    currentIntent?: string | null;
    step?: string | null;
    selectedAppointmentTypeId?: string | null;
    selectedAppointmentTypeName?: string | null;
    selectedPractitionerId?: string | null;
    selectedDate?: string | null;
    selectedTime?: string | null;
    lastMessage?: string | null;
    stateJson?: BookingStateJson | null;
  }) => Promise<unknown>;
};

export type AwaitingConfirmationDependencies = {
  clinicId: string;
  phone: string;
  text: string;
  customerName: string | null;
  state: AwaitingConfirmationState;
  stateJson: BookingStateJson;
  resetState: (customerName?: string | null) => Promise<unknown>;
  upsertState: (data: {
    customerName?: string | null;
    currentIntent?: string | null;
    step?: string | null;
    selectedAppointmentTypeId?: string | null;
    selectedAppointmentTypeName?: string | null;
    selectedPractitionerId?: string | null;
    selectedDate?: string | null;
    selectedTime?: string | null;
    lastMessage?: string | null;
    stateJson?: BookingStateJson | null;
  }) => Promise<unknown>;
  createAppointment: (
    clinicId: string,
    phone: string,
    customerName: string,
    appointmentTypeId: string,
    selectedSlot: SavedAvailableSlot,
    rawMessage?: string | null,
  ) => Promise<{ appointmentType: { name: string } | null }>;
};

const normalizeBookingText = (value: string) => value
  .trim()
  .toLocaleLowerCase('tr-TR')
  .replace(/ğ/g, 'g')
  .replace(/ü/g, 'u')
  .replace(/ş/g, 's')
  .replace(/ı/g, 'i')
  .replace(/i̇/g, 'i')
  .replace(/ö/g, 'o')
  .replace(/ç/g, 'c')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const isServiceListRequest = (text: string) => {
  const normalized = normalizeBookingText(text);
  return [
    'hangi hizmetleriniz var',
    'hangi hizmetler var',
    'hizmetleriniz neler',
    'hizmetler neler',
    'hizmetleri goster',
    'listeyi goster',
    'listeyi ver',
    'listeyi vermedin',
    'listeyi vermedin ki',
    'liste yok',
    'liste gelsin',
  ].some(pattern => normalized.includes(pattern));
};

export const handleAwaitingServiceStep = async ({
  text,
  phone,
  customerName,
  services,
  state,
  stateJson,
  extractNumericSelection,
  findServiceMatches,
  formatServiceList,
  upsertState,
}: AwaitingServiceDependencies) => {
  const previousMatchedServices = stateJson.matchedServices?.length
    ? services.filter(service => stateJson.matchedServices?.some(match => match.id === service.id))
    : [];
  const selectableServices = previousMatchedServices.length > 0 ? previousMatchedServices : services;

  if (isServiceListRequest(text)) {
    await upsertState({
      customerName,
      currentIntent: 'book_appointment',
      step: 'awaiting_service',
      lastMessage: text,
      stateJson: previousMatchedServices.length > 0
        ? {
            matchedServices: previousMatchedServices.map(service => ({ id: service.id, name: service.name } satisfies SavedServiceOption)),
          }
        : null,
    });
    return formatServiceList(selectableServices);
  }

  const extractedServiceNumber = extractNumericSelection(text);
  const matchedServices = extractedServiceNumber
    ? selectableServices
    : findServiceMatches(text, services);
  const selectedService = extractedServiceNumber && extractedServiceNumber >= 1 && extractedServiceNumber <= selectableServices.length
    ? selectableServices[extractedServiceNumber - 1] ?? null
    : matchedServices.length === 1
      ? matchedServices[0]
      : null;

  console.log('[whatsapp-assistant] route-handler', {
    phone,
    handler: 'awaiting_service-selection',
    extractedServiceNumber,
    matchedServiceName: selectedService?.name ?? null,
  });

  if (!extractedServiceNumber && matchedServices.length > 1) {
    await upsertState({
      customerName,
      currentIntent: 'book_appointment',
      step: 'awaiting_service',
      lastMessage: text,
      stateJson: {
        matchedServices: matchedServices.map(service => ({ id: service.id, name: service.name } satisfies SavedServiceOption)),
      },
    });
    return [
      'Birden fazla uygun hizmet buldum. Lütfen aşağıdaki seçeneklerden birini numarasıyla seçin:',
      ...matchedServices.map((service, index) => `${index + 1}. ${service.name}`),
    ].join('\n');
  }

  if (!selectedService) {
    await upsertState({
      customerName,
      currentIntent: 'book_appointment',
      step: 'awaiting_service',
      lastMessage: text,
      stateJson: previousMatchedServices.length > 0
        ? {
            matchedServices: previousMatchedServices.map(service => ({ id: service.id, name: service.name } satisfies SavedServiceOption)),
          }
        : null,
    });
    return 'Lütfen listedeki hizmet numarasını seçin. Örneğin 1, 2 veya 5 yazabilirsiniz.';
  }

  await upsertState({
    customerName,
    currentIntent: 'book_appointment',
    step: 'awaiting_date',
    selectedAppointmentTypeId: selectedService.id,
    selectedAppointmentTypeName: selectedService.name,
    selectedDate: null,
    selectedTime: null,
    lastMessage: text,
    stateJson: null,
  });
  return `${selectedService.name} hizmetini seçtiniz. Hangi gün için randevu istersiniz? Örneğin bugün, yarın, 16.05 veya 16 Mayıs yazabilirsiniz.`;
};

export const handleAwaitingDateStep = async ({
  prisma,
  clinicId,
  text,
  customerName,
  state,
  buildAvailableSlots,
  formatAvailabilityMessage,
  logAvailabilitySave,
  minutesToTime,
  now,
  interpretDateWithAi,
  interpretTimeWithAi,
  upsertState,
}: AwaitingDateDependencies) => {
  if (!state.selectedAppointmentTypeId) {
    await upsertState({
      customerName,
      currentIntent: 'book_appointment',
      step: 'awaiting_service',
      selectedAppointmentTypeId: null,
      selectedAppointmentTypeName: null,
      selectedDate: null,
      selectedTime: null,
      lastMessage: text,
      stateJson: null,
    });
    return 'Önce hizmet seçelim. Lütfen listedeki hizmet numarasını paylaşın.';
  }

  const normalizedDate = normalizeDateFromTurkishInput(text, now ?? new Date(), WHATSAPP_ASSISTANT_TIME_ZONE)
    ?? (interpretDateWithAi ? await interpretDateWithAi(text) : null);
  if (!normalizedDate) {
    await upsertState({
      customerName,
      currentIntent: 'book_appointment',
      step: 'awaiting_date',
      selectedAppointmentTypeId: state.selectedAppointmentTypeId,
      selectedAppointmentTypeName: state.selectedAppointmentTypeName,
      lastMessage: text,
    });

    if (isShortAffirmation(text)) {
      return 'Tabii, hangi günü kontrol etmemi istersiniz? Örneğin yarın, 22 Mayıs veya cuma yazabilirsiniz.';
    }

    return 'Tarihi anlayamadım. Örneğin bugün, yarın, cumartesi, 16.05 veya 16 Mayıs yazabilirsiniz.';
  }

  console.info('[whatsapp-assistant] availability-check', {
    appointmentTypeId: state.selectedAppointmentTypeId,
    date: normalizedDate,
  });

  try {
    const slots = await buildAvailableSlots(prisma, clinicId, state.selectedAppointmentTypeId, normalizedDate, state.selectedPractitionerId ?? undefined);
    if (!slots) {
      await upsertState({
        customerName,
        currentIntent: 'book_appointment',
        step: 'awaiting_service',
        selectedAppointmentTypeId: null,
        selectedAppointmentTypeName: null,
        selectedDate: null,
        selectedTime: null,
        lastMessage: text,
        stateJson: null,
      });
      return 'Önce hizmet seçelim. Lütfen listedeki hizmet numarasını paylaşın.';
    }

    const availabilitySnapshot = createAvailabilitySnapshot(slots);
    const savedSlots = availabilitySnapshot.allSlots;
    let lastShownSlots = availabilitySnapshot.shownSlots;
    const timeInterpretation = await resolveTimeInterpretation(text, interpretTimeWithAi);
    const shouldTreatAsDateOnly = isStandaloneNumericDateExpression(text);

    console.info('[whatsapp-assistant] availability-result', { count: savedSlots.length });

    if (savedSlots.length === 0) {
      await upsertState({
        customerName,
        currentIntent: 'book_appointment',
        step: 'awaiting_date',
        selectedAppointmentTypeId: state.selectedAppointmentTypeId,
        selectedAppointmentTypeName: state.selectedAppointmentTypeName,
        selectedDate: null,
        selectedTime: null,
        lastMessage: text,
        stateJson: null,
      });
      return `${formatTurkishDateWithWeekday(normalizedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} için uygun saat görünmüyor. İsterseniz başka bir gün kontrol edebilirim.`;
    }

    if (timeInterpretation.exactTime && !shouldTreatAsDateOnly) {
      const exactSlots = savedSlots.filter(slot => slot.localStartTime === timeInterpretation.exactTime);
      lastShownSlots = exactSlots.slice(0, 8);
    } else if (timeInterpretation.rangeStartMinutes !== null && timeInterpretation.rangeEndMinutes !== null) {
      const filteredSlots = filterSlotsByTimeRange(savedSlots, timeInterpretation.rangeStartMinutes, timeInterpretation.rangeEndMinutes);
      lastShownSlots = filteredSlots.slice(0, 8);
    } else if (timeInterpretation.afterTimeMinutes !== null) {
      const filteredSlots = filterSlotsByTimeThreshold(savedSlots, timeInterpretation.afterTimeMinutes);
      lastShownSlots = filteredSlots.slice(0, 8);
    } else if (timeInterpretation.preference) {
      const filteredSlots = filterSlotsByTimePreference(savedSlots, timeInterpretation.preference);
      lastShownSlots = filteredSlots.slice(0, 8);
    }

    await upsertState({
      customerName,
      currentIntent: 'book_appointment',
      step: 'awaiting_time',
      selectedAppointmentTypeId: state.selectedAppointmentTypeId,
      selectedAppointmentTypeName: state.selectedAppointmentTypeName,
      selectedDate: normalizedDate,
      selectedTime: null,
      lastMessage: text,
      stateJson: { availableSlots: savedSlots, lastShownSlots },
    });
    logAvailabilitySave(savedSlots.length, lastShownSlots.length);

    if (timeInterpretation.exactTime && !shouldTreatAsDateOnly) {
      if (lastShownSlots.length === 0) {
        const nearbySlots = findNearbySlotsForTime(savedSlots, timeInterpretation.exactTime);
        if (nearbySlots.length > 0) {
          await upsertState({
            customerName,
            currentIntent: 'book_appointment',
            step: 'awaiting_time',
            selectedAppointmentTypeId: state.selectedAppointmentTypeId,
            selectedAppointmentTypeName: state.selectedAppointmentTypeName,
            selectedDate: normalizedDate,
            selectedTime: null,
            lastMessage: text,
            stateJson: { availableSlots: savedSlots, lastShownSlots: nearbySlots },
          });

          return formatSlotListMessage(`${formatTurkishDateWithWeekday(normalizedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} saat ${timeInterpretation.exactTime} için uygun saat görünmüyor; ancak yakın saatler şunlar:`, nearbySlots);
        }

        return `${formatTurkishDateWithWeekday(normalizedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} saat ${timeInterpretation.exactTime} için uygun saat görünmüyor. İsterseniz başka bir saat aralığı veya farklı bir gün kontrol edebilirim.`;
      }

      return formatSlotListMessage(`${formatTurkishDateWithWeekday(normalizedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} saat ${timeInterpretation.exactTime} için uygun seçenekler şunlar:`, lastShownSlots);
    }

    if (timeInterpretation.rangeStartMinutes !== null && timeInterpretation.rangeEndMinutes !== null) {
      if (lastShownSlots.length === 0) {
        return `${formatTurkishDateLong(normalizedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} için saat ${minutesToTime(timeInterpretation.rangeStartMinutes)} ile ${minutesToTime(timeInterpretation.rangeEndMinutes)} arasında uygun saat görünmüyor. İsterseniz başka bir saat aralığı veya farklı bir gün kontrol edebilirim.`;
      }

      return formatSlotListMessage(`Elbette, ${formatTurkishDateLong(normalizedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} için saat ${minutesToTime(timeInterpretation.rangeStartMinutes)} ile ${minutesToTime(timeInterpretation.rangeEndMinutes)} arasındaki uygun saatler şunlar:`, lastShownSlots);
    }

    if (timeInterpretation.afterTimeMinutes !== null) {
      if (lastShownSlots.length === 0) {
        return `${formatTurkishDateLong(normalizedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} için saat ${minutesToTime(timeInterpretation.afterTimeMinutes)} sonrası uygun saat görünmüyor. İsterseniz başka bir saat aralığı veya farklı bir gün kontrol edebilirim.`;
      }

      return formatSlotListMessage(`Elbette, ${formatTurkishDateLong(normalizedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} için saat ${minutesToTime(timeInterpretation.afterTimeMinutes)} sonrası uygun saatler şunlar:`, lastShownSlots);
    }

    if (timeInterpretation.preference) {
      if (lastShownSlots.length === 0) {
        return `${formatTurkishDateLong(normalizedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} için bu zaman tercihinize uygun saat görünmüyor. İsterseniz başka bir saat aralığı veya farklı bir gün kontrol edebilirim.`;
      }

      const heading = timeInterpretation.preference === 'afternoon'
        ? `${formatTurkishDateLong(normalizedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} için öğleden sonraki uygun saatler şunlar:`
        : timeInterpretation.preference === 'morning'
          ? `${formatTurkishDateLong(normalizedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} için sabah uygun saatler şunlar:`
          : timeInterpretation.preference === 'noon'
            ? `${formatTurkishDateLong(normalizedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} için öğle civarındaki uygun saatler şunlar:`
            : `${formatTurkishDateLong(normalizedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} için geç saatlerde uygun seçenekler şunlar:`;
      return formatSlotListMessage(heading, lastShownSlots);
    }

    return formatAvailabilityMessage(normalizedDate, lastShownSlots);
  } catch (error) {
    console.error('[whatsapp-assistant] availability-error', error);
    return 'Şu anda randevu takvimine erişirken teknik bir sorun oluştu. Lütfen biraz sonra tekrar deneyin veya klinik ekibine iletilmek üzere talebinizi not edebilirim.';
  }
};

export const handleAwaitingTimeStep = async ({
  prisma,
  clinicId,
  phone,
  text,
  customerName,
  state,
  stateJson,
  extractNumericSelection,
  findSlotMatches,
  formatAvailabilityMessage,
  minutesToTime,
  logAvailabilitySave,
  interpretTimeWithAi,
  upsertState,
  resetState,
  createAppointment,
}: AwaitingTimeDependencies) => {
  const availableSlots = stateJson.availableSlots ?? [];
  const lastShownSlots = stateJson.lastShownSlots?.length ? stateJson.lastShownSlots : availableSlots.slice(0, 8);
  const selectedAppointmentTypeId = state.selectedAppointmentTypeId ?? null;
  const selectedAppointmentTypeName = state.selectedAppointmentTypeName ?? null;
  const selectedDate = state.selectedDate ?? null;
  const selectedPractitionerId = state.selectedPractitionerId ?? null;
  const numericSelection = extractNumericSelection(text);
  const hasNumericSlotReply = numericSelection !== null;
  const numericSlotSelection = numericSelection && numericSelection >= 1 && numericSelection <= lastShownSlots.length
    ? numericSelection
    : null;
  const slotMatch = findSlotMatches(text, availableSlots);
  let selectedSlotIndex = numericSlotSelection
    ? availableSlots.findIndex(slot => slotIdentity(slot) === slotIdentity(lastShownSlots[numericSlotSelection - 1]))
    : slotMatch.extractedTime && slotMatch.hasPractitionerFragment && slotMatch.matches.length === 1
      ? slotMatch.matches[0].index
      : -1;
  let selectedSlot = selectedSlotIndex >= 0 ? availableSlots[selectedSlotIndex] : null;

  console.log('[whatsapp-assistant] route-handler', {
    phone,
    handler: 'awaiting_time-selection',
    extractedTime: slotMatch.extractedTime,
    matchedPractitioner: selectedSlot?.practitionerName ?? (slotMatch.matches.length === 1 ? slotMatch.matches[0].slot.practitionerName : null),
    matchedSlotIndex: numericSlotSelection ?? (selectedSlotIndex >= 0 ? selectedSlotIndex + 1 : null),
    matchedAvailableSlotIndex: selectedSlotIndex >= 0 ? selectedSlotIndex + 1 : null,
  });

  if (hasNumericSlotReply && !numericSlotSelection) {
    return `Lütfen listedeki saat numaralarından birini seçin. Bu listede 1 ile ${lastShownSlots.length} arasında bir numara yazabilirsiniz.`;
  }

  const timeInterpretation = hasNumericSlotReply
    ? null
    : await resolveTimeInterpretation(text, interpretTimeWithAi);
  const interpretedTimeRequest = timeInterpretation?.interpretedTimeRequest ?? {
    normalizedText: '',
    exactTime: null,
    afterTimeMinutes: null,
    rangeStartMinutes: null,
    rangeEndMinutes: null,
    preference: null,
    wantsMoreOptions: false,
    wantsDifferentDate: false,
  };
  const explicitRequestedTime = timeInterpretation?.exactTime ?? null;
  const explicitTimeThreshold = timeInterpretation?.afterTimeMinutes ?? null;
  const preference = timeInterpretation?.preference ?? null;
  const rangeStartMinutes = timeInterpretation?.rangeStartMinutes ?? null;
  const rangeEndMinutes = timeInterpretation?.rangeEndMinutes ?? null;
  const normalizedDifferentDate = normalizeDateFromTurkishInput(text, new Date(), WHATSAPP_ASSISTANT_TIME_ZONE);
  const shouldTreatAsDateOnly = Boolean(normalizedDifferentDate) && isStandaloneNumericDateExpression(text);

  if (!numericSlotSelection && slotMatch.extractedTime && slotMatch.hasPractitionerFragment && slotMatch.matches.length > 1) {
    const matchingSlots = slotMatch.matches.map(item => item.slot);
    await upsertState({
      customerName,
      currentIntent: 'book_appointment',
      step: 'awaiting_time',
      selectedAppointmentTypeId,
      selectedAppointmentTypeName,
      selectedDate,
      selectedTime: null,
      lastMessage: text,
      stateJson: { availableSlots, lastShownSlots: matchingSlots },
    });

    return formatSlotListMessage(`${slotMatch.extractedTime} için birden fazla hekim uygun görünüyor:`, matchingSlots);
  }

  if (!numericSlotSelection && !shouldTreatAsDateOnly && (!slotMatch.hasPractitionerFragment || slotMatch.matches.length === 0) && explicitRequestedTime) {
    const exactMatches = availableSlots
      .map((slot, index) => ({ slot, index }))
      .filter(item => item.slot.localStartTime === explicitRequestedTime);

    console.log('[whatsapp-assistant] time-request', {
      phone,
      text,
      type: 'exact_time',
      requestedTime: explicitRequestedTime,
      totalAvailableSlots: availableSlots.length,
      matchedCount: exactMatches.length,
    });

    if (exactMatches.length === 1) {
      selectedSlotIndex = exactMatches[0].index;
      selectedSlot = exactMatches[0].slot;
    } else if (exactMatches.length > 1) {
      const matchingSlots = exactMatches.map(item => item.slot);
      await upsertState({
        customerName,
        currentIntent: 'book_appointment',
        step: 'awaiting_time',
        selectedAppointmentTypeId,
        selectedAppointmentTypeName,
        selectedDate,
        selectedTime: null,
        lastMessage: text,
        stateJson: { availableSlots, lastShownSlots: matchingSlots },
      });

      return formatSlotListMessage(`${explicitRequestedTime} için birden fazla hekim uygun görünüyor:`, matchingSlots);
    } else {
      const nearbySlots = findNearbySlotsForTime(availableSlots, explicitRequestedTime);
      if (nearbySlots.length > 0) {
        await upsertState({
          customerName,
          currentIntent: 'book_appointment',
          step: 'awaiting_time',
          selectedAppointmentTypeId,
          selectedAppointmentTypeName,
          selectedDate,
          selectedTime: null,
          lastMessage: text,
          stateJson: { availableSlots, lastShownSlots: nearbySlots },
        });

        return formatSlotListMessage(`${explicitRequestedTime} için uygun saat görünmüyor; ancak yakın saatler şunlar:`, nearbySlots);
      }

      return `${explicitRequestedTime} için uygun saat görünmüyor. İsterseniz başka bir saat aralığı veya farklı bir gün kontrol edebilirim.`;
    }
  }

  if (!numericSlotSelection && rangeStartMinutes !== null && rangeEndMinutes !== null) {
    const filteredSlots = filterSlotsByTimeRange(availableSlots, rangeStartMinutes, rangeEndMinutes);
    const shownSlots = filteredSlots.slice(0, 8);

    console.log('[whatsapp-assistant] time-request', {
      phone,
      text,
      type: 'time_range',
      requestedStartTime: minutesToTime(rangeStartMinutes),
      requestedEndTime: minutesToTime(rangeEndMinutes),
      totalAvailableSlots: availableSlots.length,
      matchedCount: filteredSlots.length,
    });

    await upsertState({
      customerName,
      currentIntent: 'book_appointment',
      step: 'awaiting_time',
      selectedAppointmentTypeId,
      selectedAppointmentTypeName,
      selectedDate,
      selectedTime: null,
      lastMessage: text,
      stateJson: { availableSlots, lastShownSlots: shownSlots },
    });

    if (filteredSlots.length === 0) {
      return `${formatTurkishDateLong(selectedDate!, WHATSAPP_ASSISTANT_TIME_ZONE)} için saat ${minutesToTime(rangeStartMinutes)} ile ${minutesToTime(rangeEndMinutes)} arasında uygun saat görünmüyor. İsterseniz başka bir saat aralığı veya farklı bir gün kontrol edebilirim.`;
    }

    return formatSlotListMessage(`Elbette, ${formatTurkishDateLong(selectedDate!, WHATSAPP_ASSISTANT_TIME_ZONE)} için saat ${minutesToTime(rangeStartMinutes)} ile ${minutesToTime(rangeEndMinutes)} arasındaki uygun saatler şunlar:`, shownSlots);
  }

  if (!numericSlotSelection && explicitTimeThreshold !== null) {
    const filteredSlots = filterSlotsByTimeThreshold(availableSlots, explicitTimeThreshold);
    const shownSlots = filteredSlots.slice(0, 8);
    console.log('[whatsapp-assistant] time-request', {
      phone,
      text,
      type: 'after_time',
      requestedTime: minutesToTime(explicitTimeThreshold),
      totalAvailableSlots: availableSlots.length,
      matchedCount: filteredSlots.length,
    });

    await upsertState({
      customerName,
      currentIntent: 'book_appointment',
      step: 'awaiting_time',
      selectedAppointmentTypeId,
      selectedAppointmentTypeName,
      selectedDate,
      selectedTime: null,
      lastMessage: text,
      stateJson: { availableSlots, lastShownSlots: shownSlots },
    });

    if (filteredSlots.length === 0) {
      return `${formatTurkishDateLong(selectedDate!, WHATSAPP_ASSISTANT_TIME_ZONE)} için saat ${minutesToTime(explicitTimeThreshold)} sonrası uygun saat görünmüyor. İsterseniz başka bir gün kontrol edebilirim ya da listedeki diğer saatlerden birini seçebilirsiniz.`;
    }

    return formatSlotListMessage(`Elbette, ${formatTurkishDateLong(selectedDate!, WHATSAPP_ASSISTANT_TIME_ZONE)} için saat ${minutesToTime(explicitTimeThreshold)} sonrası uygun saatler şunlar:`, shownSlots);
  }

  if (!numericSlotSelection && preference) {
    const filteredSlots = filterSlotsByTimePreference(availableSlots, preference);
    const shownSlots = filteredSlots.slice(0, 8);
    console.log('[whatsapp-assistant] time-request', {
      phone,
      text,
      type: 'preference',
      requestedTime: preference,
      totalAvailableSlots: availableSlots.length,
      matchedCount: filteredSlots.length,
    });

    await upsertState({
      customerName,
      currentIntent: 'book_appointment',
      step: 'awaiting_time',
      selectedAppointmentTypeId,
      selectedAppointmentTypeName,
      selectedDate,
      selectedTime: null,
      lastMessage: text,
      stateJson: { availableSlots, lastShownSlots: shownSlots },
    });

    if (filteredSlots.length === 0) {
      const preferenceText = preference === 'afternoon'
        ? 'öğleden sonra'
        : preference === 'morning'
          ? 'sabah'
          : preference === 'noon'
            ? 'öğle civarı'
            : 'akşam';
      return `${formatTurkishDateLong(selectedDate!, WHATSAPP_ASSISTANT_TIME_ZONE)} için ${preferenceText} uygun saat görünmüyor. İsterseniz başka bir gün kontrol edebilirim ya da listedeki diğer saatlerden birini seçebilirsiniz.`;
    }

    const heading = preference === 'afternoon'
      ? `${formatTurkishDateLong(selectedDate!, WHATSAPP_ASSISTANT_TIME_ZONE)} için öğleden sonraki uygun saatler şunlar:`
      : preference === 'morning'
        ? `${formatTurkishDateLong(selectedDate!, WHATSAPP_ASSISTANT_TIME_ZONE)} için sabah uygun saatler şunlar:`
        : preference === 'noon'
          ? `${formatTurkishDateLong(selectedDate!, WHATSAPP_ASSISTANT_TIME_ZONE)} için öğle civarındaki uygun saatler şunlar:`
          : `${formatTurkishDateLong(selectedDate!, WHATSAPP_ASSISTANT_TIME_ZONE)} için geç saatlerde uygun seçenekler şunlar:`;
    return formatSlotListMessage(heading, shownSlots);
  }

  if (!numericSlotSelection && (Boolean(normalizedDifferentDate) || interpretedTimeRequest.wantsDifferentDate)) {
    if (!selectedAppointmentTypeId) {
      return 'Önce hizmet seçelim. Lütfen listedeki hizmet numarasını paylaşın.';
    }

    if (!normalizedDifferentDate) {
      return 'Elbette, başka bir gün de kontrol edebilirim. Lütfen tarihi örneğin yarın, 22 Mayıs veya cuma gibi paylaşın.';
    }

    console.info('[whatsapp-assistant] availability-check', {
      appointmentTypeId: selectedAppointmentTypeId,
      date: normalizedDifferentDate,
    });

    try {
      const availability = await loadAvailabilityForDate(prisma, clinicId, selectedAppointmentTypeId, normalizedDifferentDate, selectedPractitionerId);
      if (!availability) {
        return 'Önce hizmet seçelim. Lütfen listedeki hizmet numarasını paylaşın.';
      }

      if (availability.allSlots.length === 0) {
        await upsertState({
          customerName,
          currentIntent: 'book_appointment',
          step: 'awaiting_time',
          selectedAppointmentTypeId,
          selectedAppointmentTypeName,
          selectedDate: normalizedDifferentDate,
          selectedTime: null,
          lastMessage: text,
          stateJson: { availableSlots: [], lastShownSlots: [] },
        });
        logAvailabilitySave(0, 0);
        return 'Bu tarih için uygun saat görünmüyor. İsterseniz başka bir gün kontrol edebilirim.';
      }

      await upsertState({
        customerName,
        currentIntent: 'book_appointment',
        step: 'awaiting_time',
        selectedAppointmentTypeId,
        selectedAppointmentTypeName,
        selectedDate: normalizedDifferentDate,
        selectedTime: null,
        lastMessage: text,
        stateJson: { availableSlots: availability.allSlots, lastShownSlots: availability.shownSlots },
      });
      logAvailabilitySave(availability.allSlots.length, availability.shownSlots.length);
      return formatAvailabilityMessage(normalizedDifferentDate, availability.shownSlots);
    } catch (error) {
      console.error('[whatsapp-assistant] availability-error', error);
      return 'Şu anda randevu takvimine erişirken teknik bir sorun oluştu. Lütfen biraz sonra tekrar deneyin.';
    }
  }

  if (!numericSlotSelection && interpretedTimeRequest.wantsMoreOptions) {
    const shownSlotKeys = new Set(lastShownSlots.map(slot => slotIdentity(slot)));
    const nextSlots = availableSlots.filter(slot => !shownSlotKeys.has(slotIdentity(slot))).slice(0, 8);

    console.log('[whatsapp-assistant] time-refinement', {
      preference: 'more_options',
      totalSlots: availableSlots.length,
      filteredCount: nextSlots.length,
      shownCount: nextSlots.length,
    });

    if (nextSlots.length === 0) {
      return 'Bu tarih için başka uygun saat görünmüyor. Dilerseniz farklı bir gün kontrol edebilirim.';
    }

    await upsertState({
      customerName,
      currentIntent: 'book_appointment',
      step: 'awaiting_time',
      selectedAppointmentTypeId,
      selectedAppointmentTypeName,
      selectedDate,
      selectedTime: null,
      lastMessage: text,
      stateJson: { availableSlots, lastShownSlots: nextSlots },
    });

    return formatSlotListMessage(`${formatTurkishDateLong(selectedDate!, WHATSAPP_ASSISTANT_TIME_ZONE)} için başka uygun saatler şunlar:`, nextSlots);
  }

  if (!numericSlotSelection && !selectedSlot && slotMatch.matches.length > 1) {
    return formatSlotListMessage('Birden fazla uygun saat buldum. Lütfen aşağıdaki seçeneklerden birini seçin:', slotMatch.matches.map(item => item.slot));
  }

  if (!selectedSlot || !state.selectedAppointmentTypeId || !state.selectedDate) {
    return "Bu aşamada listedeki saatlerden birini seçebilir, başka bir saat aralığı sorabilir ya da farklı bir gün isteyebilirsiniz. Örneğin: '5', 'öğleden sonra var mı' veya '22 Mayıs olur mu' yazabilirsiniz.";
  }

  await upsertState({
    customerName,
    currentIntent: 'book_appointment',
    step: 'awaiting_confirmation',
    selectedAppointmentTypeId: state.selectedAppointmentTypeId,
    selectedAppointmentTypeName: state.selectedAppointmentTypeName,
    selectedPractitionerId: selectedSlot.practitionerId,
    selectedDate: state.selectedDate,
    selectedTime: selectedSlot.localStartTime,
    lastMessage: text,
    stateJson: {
      availableSlots,
      lastShownSlots,
      pendingConfirmationSlot: selectedSlot,
    },
  });

  return `${formatTurkishDateLong(state.selectedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} tarihinde saat ${selectedSlot.localStartTime} için ${selectedSlot.practitionerName} uygun görünüyor. ${state.selectedAppointmentTypeName ?? 'Bu hizmet'} için randevu talebinizi klinik onay ekranına almamı onaylıyor musunuz?`;
};

export const handleAwaitingConfirmationStep = async ({
  clinicId,
  phone,
  text,
  customerName,
  state,
  stateJson,
  resetState,
  upsertState,
  createAppointment,
}: AwaitingConfirmationDependencies) => {
  const pendingSlot = stateJson.pendingConfirmationSlot ?? null;
  const availableSlots = stateJson.availableSlots ?? [];
  const lastShownSlots = stateJson.lastShownSlots ?? [];

  if (!pendingSlot || !state.selectedAppointmentTypeId || !state.selectedDate) {
    await upsertState({
      customerName,
      currentIntent: 'book_appointment',
      step: 'awaiting_time',
      selectedAppointmentTypeId: state.selectedAppointmentTypeId ?? null,
      selectedAppointmentTypeName: state.selectedAppointmentTypeName ?? null,
      selectedPractitionerId: null,
      selectedDate: state.selectedDate ?? null,
      selectedTime: null,
      lastMessage: text,
      stateJson: { availableSlots, lastShownSlots },
    });
    return 'Saat seçimini yeniden yapalım. İsterseniz listedeki saatlerden birini seçebilir veya başka bir saat aralığı sorabilirsiniz.';
  }

  if (isConfirmationRejected(text)) {
    await upsertState({
      customerName,
      currentIntent: 'book_appointment',
      step: 'awaiting_time',
      selectedAppointmentTypeId: state.selectedAppointmentTypeId,
      selectedAppointmentTypeName: state.selectedAppointmentTypeName,
      selectedPractitionerId: null,
      selectedDate: state.selectedDate,
      selectedTime: null,
      lastMessage: text,
      stateJson: { availableSlots, lastShownSlots },
    });
    return 'Tamam, yalnız uygunluğu teyit etmiş oldum. Dilerseniz başka bir saat seçebilir, başka bir saat aralığı sorabilir ya da farklı bir gün isteyebilirsiniz.';
  }

  if (!isConfirmationApproved(text)) {
    return `Randevu talebinizi klinik onay ekranına almadan önce onayınızı almam gerekiyor. ${formatTurkishDateLong(state.selectedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} tarihinde saat ${pendingSlot.localStartTime} için ${pendingSlot.practitionerName} uygun görünüyor. Talebi oluşturmamı onaylıyor musunuz?`;
  }

  if (!customerName) {
    await upsertState({
      customerName: null,
      currentIntent: 'book_appointment',
      step: 'awaiting_name',
      selectedAppointmentTypeId: state.selectedAppointmentTypeId,
      selectedAppointmentTypeName: state.selectedAppointmentTypeName,
      selectedPractitionerId: pendingSlot.practitionerId,
      selectedDate: state.selectedDate,
      selectedTime: pendingSlot.localStartTime,
      lastMessage: text,
      stateJson: {
        availableSlots,
        lastShownSlots,
        pendingConfirmationSlot: pendingSlot,
      },
    });
    return 'Devam edebilmem için önce adınızı ve soyadınızı paylaşır mısınız?';
  }

  console.info('[whatsapp-assistant] appointment-request-create', {
    appointmentTypeId: state.selectedAppointmentTypeId,
    date: state.selectedDate,
    time: pendingSlot.localStartTime,
    practitionerId: pendingSlot.practitionerId,
    practitionerName: pendingSlot.practitionerName,
  });

  try {
    const request = await createAppointment(
      clinicId,
      phone,
      customerName,
      state.selectedAppointmentTypeId,
      pendingSlot,
      text
    );

    await resetState(customerName);
    const serviceName = state.selectedAppointmentTypeName ?? request.appointmentType?.name ?? 'seçtiğiniz hizmet';
    return `Talebinizi klinik onay ekranına aldım. ${serviceName} için ${formatTurkishDateLong(state.selectedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} tarihinde saat ${pendingSlot.localStartTime} talebiniz personel tarafından kontrol edilecek. Klinik ekibi onay durumunu size bildirecek.`;
  } catch (error) {
    if (error instanceof Error && (error.message === 'APPOINTMENT_OUTSIDE_AVAILABILITY' || error.message === 'APPOINTMENT_OVERLAP')) {
      await upsertState({
        customerName,
        currentIntent: 'book_appointment',
        step: 'awaiting_date',
        selectedAppointmentTypeId: state.selectedAppointmentTypeId,
        selectedAppointmentTypeName: state.selectedAppointmentTypeName,
        selectedDate: null,
        selectedTime: null,
        lastMessage: text,
        stateJson: null,
      });
      return 'Seçtiğiniz saat artık uygun görünmüyor. İsterseniz başka bir gün veya saat kontrol edebilirim.';
    }

    console.error('[whatsapp-assistant] appointment-create-error', error);
    return 'Randevu talebinizi oluştururken teknik bir sorun oluştu. Birkaç dakika sonra tekrar deneyebiliriz.';
  }
};
