import { z } from 'zod';

export const whatsappAgentIntentValues = [
  'greeting',
  'book_appointment',
  'appointment_query',
  'check_appointment',
  'cancel_appointment',
  'human_handoff',
  'clinic_info',
  'service_info',
  'symptom_or_complaint',
  'off_topic_or_smalltalk',
  'unknown',
] as const;

export const whatsappAgentActionValues = [
  'reply_only',
  'ask_clarification',
  'show_main_menu',
  'start_booking',
  'continue_booking',
  'start_general_assessment',
  'answer_clinic_info',
  'answer_service_info',
  'appointment_lookup',
  'cancel_appointment',
  'human_handoff',
  'store_handoff_note',
  'refuse_off_topic',
  'unknown_safe_reply',
] as const;

export const whatsappAgentStepValues = [
  'main_menu',
  'awaiting_name',
  'awaiting_service',
  'awaiting_date',
  'awaiting_time',
  'awaiting_confirmation',
  'awaiting_cancel_selection',
  'awaiting_handoff_note',
  'awaiting_general_date',
  'awaiting_general_time',
] as const;

const nullableTrimmedString = z.preprocess(
  value => (typeof value === 'string' && value.trim() ? value.trim() : null),
  z.string().nullable(),
);

export const whatsappAgentIntentSchema = z.enum(whatsappAgentIntentValues);
export const whatsappAgentActionSchema = z.enum(whatsappAgentActionValues);
export const whatsappAgentStepSchema = z.enum(whatsappAgentStepValues);
export const whatsappAgentTimePreferenceSchema = z.enum(['morning', 'noon', 'afternoon', 'evening']);

export const whatsappAgentSlotsSchema = z.object({
  name: nullableTrimmedString.optional().default(null),
  phone: nullableTrimmedString.optional().default(null),
  appointmentTypeName: nullableTrimmedString.optional().default(null),
  appointmentTypeId: nullableTrimmedString.optional().default(null),
  dateText: nullableTrimmedString.optional().default(null),
  time: nullableTrimmedString.optional().default(null),
  exactTime: nullableTrimmedString.optional().default(null),
  afterTime: nullableTrimmedString.optional().default(null),
  timePreference: whatsappAgentTimePreferenceSchema.nullable().optional().default(null),
  timeRangeStart: nullableTrimmedString.optional().default(null),
  timeRangeEnd: nullableTrimmedString.optional().default(null),
  serviceName: nullableTrimmedString.optional().default(null),
  handoffNote: nullableTrimmedString.optional().default(null),
});

export const whatsappAgentStatePatchSchema = z.object({
  currentIntent: whatsappAgentIntentSchema.nullable().optional(),
  step: whatsappAgentStepSchema.nullable().optional(),
  selectedAppointmentTypeId: nullableTrimmedString.optional(),
  selectedAppointmentTypeName: nullableTrimmedString.optional(),
  selectedDate: nullableTrimmedString.optional(),
  selectedTime: nullableTrimmedString.optional(),
});

export const whatsappAgentDecisionSchema = z.object({
  intent: whatsappAgentIntentSchema,
  confidence: z.number().min(0).max(1),
  action: whatsappAgentActionSchema,
  reply: nullableTrimmedString.optional().default(null),
  slots: whatsappAgentSlotsSchema.optional().default({
    name: null,
    phone: null,
    appointmentTypeName: null,
    appointmentTypeId: null,
    dateText: null,
    time: null,
    exactTime: null,
    afterTime: null,
    timePreference: null,
    timeRangeStart: null,
    timeRangeEnd: null,
    serviceName: null,
    handoffNote: null,
  }),
  statePatch: whatsappAgentStatePatchSchema.optional().default({}),
  needsHuman: z.boolean().optional().default(false),
  safetyFlags: z.array(z.string()).optional().default([]),
});

export type WhatsAppAgentIntent = z.infer<typeof whatsappAgentIntentSchema>;
export type WhatsAppAgentAction = z.infer<typeof whatsappAgentActionSchema>;
export type WhatsAppAgentStep = z.infer<typeof whatsappAgentStepSchema>;
export type WhatsAppAgentSlots = z.infer<typeof whatsappAgentSlotsSchema>;
export type WhatsAppAgentStatePatch = z.infer<typeof whatsappAgentStatePatchSchema>;
export type WhatsAppAgentDecision = z.infer<typeof whatsappAgentDecisionSchema>;

const allowedIntents = new Set<string>(whatsappAgentIntentValues);
const allowedActions = new Set<string>(whatsappAgentActionValues);
const allowedSteps = new Set<string>(whatsappAgentStepValues);
const allowedTimePreferences = new Set<string>(['morning', 'noon', 'afternoon', 'evening']);

const readNullableString = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const readOptionalNullableString = (value: unknown) => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value === null) return null;
  return undefined;
};

const readConfidence = (value: unknown) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.4;
  return Math.max(0, Math.min(1, value));
};

const readStringArray = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  : [];

export const normalizeWhatsAppAgentDecision = (value: unknown): WhatsAppAgentDecision | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const rawSlots = record.slots && typeof record.slots === 'object' && !Array.isArray(record.slots)
    ? record.slots as Record<string, unknown>
    : {};
  const rawStatePatch = record.statePatch && typeof record.statePatch === 'object' && !Array.isArray(record.statePatch)
    ? record.statePatch as Record<string, unknown>
    : {};

  const sanitized = {
    intent: typeof record.intent === 'string' && allowedIntents.has(record.intent) ? record.intent : 'unknown',
    confidence: readConfidence(record.confidence),
    action: typeof record.action === 'string' && allowedActions.has(record.action) ? record.action : 'unknown_safe_reply',
    reply: readNullableString(record.reply),
    slots: {
      name: readNullableString(rawSlots.name),
      phone: readNullableString(rawSlots.phone),
      appointmentTypeName: readNullableString(rawSlots.appointmentTypeName),
      appointmentTypeId: readNullableString(rawSlots.appointmentTypeId),
      dateText: readNullableString(rawSlots.dateText),
      time: readNullableString(rawSlots.time),
      exactTime: readNullableString(rawSlots.exactTime),
      afterTime: readNullableString(rawSlots.afterTime),
      timePreference: typeof rawSlots.timePreference === 'string' && allowedTimePreferences.has(rawSlots.timePreference)
        ? rawSlots.timePreference
        : null,
      timeRangeStart: readNullableString(rawSlots.timeRangeStart),
      timeRangeEnd: readNullableString(rawSlots.timeRangeEnd),
      serviceName: readNullableString(rawSlots.serviceName),
      handoffNote: readNullableString(rawSlots.handoffNote),
    },
    statePatch: {
      currentIntent: typeof rawStatePatch.currentIntent === 'string' && allowedIntents.has(rawStatePatch.currentIntent)
        ? rawStatePatch.currentIntent
        : rawStatePatch.currentIntent === null
          ? null
          : undefined,
      step: typeof rawStatePatch.step === 'string' && allowedSteps.has(rawStatePatch.step)
        ? rawStatePatch.step
        : rawStatePatch.step === null
          ? null
          : undefined,
      selectedAppointmentTypeId: readOptionalNullableString(rawStatePatch.selectedAppointmentTypeId),
      selectedAppointmentTypeName: readOptionalNullableString(rawStatePatch.selectedAppointmentTypeName),
      selectedDate: readOptionalNullableString(rawStatePatch.selectedDate),
      selectedTime: readOptionalNullableString(rawStatePatch.selectedTime),
    },
    needsHuman: record.needsHuman === true,
    safetyFlags: readStringArray(record.safetyFlags),
  };

  const parsed = whatsappAgentDecisionSchema.safeParse(sanitized);
  return parsed.success ? parsed.data : null;
};
