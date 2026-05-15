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
import { interpretTimeRequest } from './whatsappInterpreter.js';
import { formatTurkishDateLong, normalizeDateFromTurkishInput, WHATSAPP_ASSISTANT_TIME_ZONE } from '../utils/whatsappDate.js';

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
  ) => Promise<{ appointmentType: { name: string } }>;
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

export type AwaitingDateDependencies = {
  prisma: PrismaClient;
  clinicId: string;
  text: string;
  customerName: string | null;
  state: AwaitingDateState;
  buildAvailableSlots: typeof import('./whatsappAvailability.js').buildAvailableSlots;
  formatAvailabilityMessage: (date: string, slots: SavedAvailableSlot[]) => string;
  logAvailabilitySave: (totalSlots: number, shownSlots: number) => void;
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

  const normalizedDate = normalizeDateFromTurkishInput(text, new Date(), WHATSAPP_ASSISTANT_TIME_ZONE);
  if (!normalizedDate) {
    await upsertState({
      customerName,
      currentIntent: 'book_appointment',
      step: 'awaiting_date',
      selectedAppointmentTypeId: state.selectedAppointmentTypeId,
      selectedAppointmentTypeName: state.selectedAppointmentTypeName,
      lastMessage: text,
    });
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
    const lastShownSlots = availabilitySnapshot.shownSlots;

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
      return 'Bu tarih için uygun saat görünmüyor. İsterseniz başka bir gün kontrol edebilirim.';
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
    matchedSlotIndex: selectedSlotIndex >= 0 ? selectedSlotIndex + 1 : null,
  });

  const interpretedTimeRequest = interpretTimeRequest(text);
  const preference = interpretedTimeRequest.preference;
  const explicitTimeThreshold = interpretedTimeRequest.afterTimeMinutes;
  const explicitRequestedTime = interpretedTimeRequest.exactTime;
  const normalizedDifferentDate = normalizeDateFromTurkishInput(text, new Date(), WHATSAPP_ASSISTANT_TIME_ZONE);

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

  if (!numericSlotSelection && !slotMatch.hasPractitionerFragment && explicitRequestedTime) {
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

  console.info('[whatsapp-assistant] appointment-create', {
    appointmentTypeId: state.selectedAppointmentTypeId,
    date: state.selectedDate,
    time: selectedSlot.localStartTime,
  });

  if (!customerName) {
    await upsertState({
      currentIntent: null,
      step: 'awaiting_name',
      lastMessage: text,
      stateJson: null,
    });
    return 'Devam edebilmem için önce adınızı ve soyadınızı paylaşır mısınız?';
  }

  try {
    const appointment = await createAppointment(
      clinicId,
      phone,
      customerName,
      state.selectedAppointmentTypeId,
      selectedSlot,
      text
    );

    await resetState(customerName);
    return `Randevunuzu oluşturdum. ${state.selectedAppointmentTypeName ?? appointment.appointmentType.name} için ${formatTurkishDateLong(state.selectedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} tarihinde saat ${selectedSlot.localStartTime} sizi planladım. Dilerseniz başka bir konuda da yardımcı olabilirim.`;
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
    return 'Randevunuzu oluştururken teknik bir sorun oluştu. Birkaç dakika sonra tekrar deneyebiliriz.';
  }
};
