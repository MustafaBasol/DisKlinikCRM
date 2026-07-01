import { buildClarificationMessage, type ClarificationExtraction, type ClarificationState } from './whatsappClarification.js';

export type ResolvedIntentRouterExtraction = ClarificationExtraction & {
  confidence: number;
  needsClarification: boolean;
};

export type ResolvedIntentRouterService = {
  id: string;
  name: string;
  durationMinutes: number;
};

export type ResolvedIntentRouterAppointment = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  serviceName: string | null;
  practitionerName: string | null;
  status: string;
};

export type ResolvedIntentRouterState = ClarificationState & {
  step?: string | null;
  customerName?: string | null;
};

export type ResolvedIntentRouterDependencies = {
  extraction: ResolvedIntentRouterExtraction;
  state: ResolvedIntentRouterState | null | undefined;
  customerName?: string | null;
  clinicName?: string | null;
  inputText: string;
  services: ResolvedIntentRouterService[];
  upsertState: (data: {
    customerName?: string | null;
    currentIntent?: string | null;
    step?: string | null;
    selectedAppointmentTypeId?: string | null;
    selectedAppointmentTypeName?: string | null;
    selectedDate?: string | null;
    selectedTime?: string | null;
    lastMessage?: string | null;
    stateJson?: null;
  }) => Promise<unknown>;
  resetState: (customerName?: string | null) => Promise<unknown>;
  getAppointments: () => Promise<ResolvedIntentRouterAppointment[]>;
  formatAppointmentLookup: (appointments: ResolvedIntentRouterAppointment[]) => string;
  formatServiceList: (services: ResolvedIntentRouterService[]) => string;
  formatMainMenu: (customerName?: string | null, isReturningCustomer?: boolean, clinicName?: string | null) => string;
  handleCancelIntent: () => Promise<string>;
  noActiveServicesText?: string;
};

const DEFAULT_NO_ACTIVE_SERVICES_TEXT =
  'Şu anda bu klinik için randevuya açık hizmet tanımlı görünmüyor. Talebinizi ekibe iletebilirim.';

export const routeResolvedWhatsAppIntent = async ({
  extraction,
  state,
  customerName,
  clinicName,
  inputText,
  services,
  upsertState,
  resetState,
  getAppointments,
  formatAppointmentLookup,
  formatServiceList,
  formatMainMenu,
  handleCancelIntent,
  noActiveServicesText = DEFAULT_NO_ACTIVE_SERVICES_TEXT,
}: ResolvedIntentRouterDependencies) => {
  const effectiveIntent = extraction.intent === 'check_appointment'
    ? 'appointment_query'
    : extraction.intent !== 'unknown'
      ? extraction.intent
      : state?.currentIntent === 'check_appointment'
        ? 'appointment_query'
        : state?.currentIntent ?? 'unknown';

  if (extraction.needsClarification || (extraction.intent === 'unknown' && extraction.confidence < 0.6)) {
    const clarification = buildClarificationMessage(extraction, state, customerName);
    if (clarification.nextState) {
      await upsertState({
        customerName,
        lastMessage: inputText,
        ...clarification.nextState,
      });
    }
    return clarification.message;
  }

  if (effectiveIntent === 'service_info') {
    await resetState(customerName);
    return services.length > 0 ? formatServiceList(services) : noActiveServicesText;
  }

  if (effectiveIntent === 'check_appointment' || effectiveIntent === 'appointment_query') {
    const appointments = await getAppointments();
    await resetState(customerName);
    return formatAppointmentLookup(appointments);
  }

  if (effectiveIntent === 'cancel_appointment') {
    return handleCancelIntent();
  }

  if (effectiveIntent === 'book_appointment') {
    if (services.length === 0) {
      await resetState(customerName);
      return noActiveServicesText;
    }
    await upsertState({
      customerName,
      currentIntent: 'book_appointment',
      step: 'awaiting_service',
      selectedAppointmentTypeId: null,
      selectedAppointmentTypeName: null,
      selectedDate: null,
      selectedTime: null,
      lastMessage: inputText,
      stateJson: null,
    });
    return formatServiceList(services);
  }

  await upsertState({
    customerName,
    currentIntent: null,
    step: null,
    lastMessage: inputText,
    stateJson: null,
  });

  const firstName = customerName?.trim().split(/\s+/)[0] ?? null;
  return `${firstName ? `${firstName}, ` : ''}mesajınızı tam anlayamadım. Randevu almak, mevcut randevunuzu sormak, klinik bilgisi almak veya yetkili ekibe ulaşmak istediğinizi yazabilirsiniz.`;
};
