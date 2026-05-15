import type { TimePreference } from './whatsappInterpreter.js';

export type ClarificationIntent =
  | 'book_appointment'
  | 'check_appointment'
  | 'cancel_appointment'
  | 'service_info'
  | 'greeting'
  | 'unknown';

export type ClarificationExtraction = {
  intent: ClarificationIntent;
  appointmentTypeName: string | null;
  appointmentTypeId: string | null;
  dateText: string | null;
  exactTime: string | null;
  afterTime: string | null;
  timePreference: TimePreference | null;
  clarificationReason: string | null;
};

export type ClarificationState = {
  currentIntent?: string | null;
  selectedAppointmentTypeId?: string | null;
  selectedAppointmentTypeName?: string | null;
  selectedDate?: string | null;
};

export type ClarificationDecision = {
  message: string;
  nextState: {
    currentIntent?: string | null;
    step?: string | null;
    selectedAppointmentTypeId?: string | null;
    selectedAppointmentTypeName?: string | null;
    selectedPractitionerId?: string | null;
    selectedDate?: string | null;
    selectedTime?: string | null;
    stateJson?: null;
  } | null;
};

const getFirstNameFromCustomerName = (customerName?: string | null) => {
  if (!customerName?.trim()) {
    return null;
  }

  return customerName.trim().split(/\s+/)[0] ?? null;
};

const formatWarmPrompt = (message: string, customerName?: string | null) => {
  const firstName = getFirstNameFromCustomerName(customerName);
  if (!firstName) {
    return message;
  }

  return `${firstName}, ${message.charAt(0).toLocaleLowerCase('tr-TR')}${message.slice(1)}`;
};

export const buildClarificationMessage = (
  extracted: ClarificationExtraction,
  state: ClarificationState | null | undefined,
  customerName?: string | null,
): ClarificationDecision => {
  const prefix = extracted.clarificationReason
    ? `${extracted.clarificationReason.trim()} `
    : '';
  const inferredIntent = extracted.intent !== 'unknown'
    ? extracted.intent
    : (state?.currentIntent as ClarificationIntent | null) ?? 'unknown';
  const selectedAppointmentTypeId = state?.selectedAppointmentTypeId ?? extracted.appointmentTypeId ?? null;
  const selectedAppointmentTypeName = state?.selectedAppointmentTypeName ?? extracted.appointmentTypeName ?? null;
  const hasBookingSignal = inferredIntent === 'book_appointment'
    || Boolean(extracted.appointmentTypeId)
    || Boolean(extracted.appointmentTypeName)
    || Boolean(extracted.timePreference)
    || Boolean(extracted.exactTime)
    || Boolean(extracted.afterTime)
    || Boolean(extracted.dateText);

  if (hasBookingSignal && !selectedAppointmentTypeId && !selectedAppointmentTypeName) {
    return {
      message: formatWarmPrompt('Size yardımcı olayım. Önce hangi hizmet için randevu düşündüğünüzü yazar mısınız?', customerName),
      nextState: {
        currentIntent: 'book_appointment',
        step: 'awaiting_service',
        selectedAppointmentTypeId: null,
        selectedAppointmentTypeName: null,
        selectedPractitionerId: null,
        selectedDate: null,
        selectedTime: null,
        stateJson: null,
      },
    };
  }

  if (hasBookingSignal && selectedAppointmentTypeId && !state?.selectedDate && !extracted.dateText) {
    return {
      message: formatWarmPrompt('Hangi gün için bakmamı istediğinizi de paylaşır mısınız? Örneğin yarın, 22 Mayıs veya cuma yazabilirsiniz.', customerName),
      nextState: {
        currentIntent: 'book_appointment',
        step: 'awaiting_date',
        selectedAppointmentTypeId,
        selectedAppointmentTypeName,
        selectedDate: null,
        selectedTime: null,
        stateJson: null,
      },
    };
  }

  if (extracted.intent === 'unknown') {
    return {
      message: formatWarmPrompt(`${prefix}Sizi doğru yönlendirebilmem için şunu netleştirebilir misiniz: yeni randevu mu almak istiyorsunuz, mevcut randevunuzu mu sorgulamak istiyorsunuz, yoksa iptal mi etmek istiyorsunuz?`, customerName),
      nextState: null,
    };
  }

  return {
    message: formatWarmPrompt(`${prefix}Sizi doğru yönlendirebilmem için isteğinizi biraz daha açık yazabilir misiniz?`, customerName),
    nextState: null,
  };
};
