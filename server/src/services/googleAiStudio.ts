import { z } from 'zod';

const allowedIntents = new Set([
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
]);
const allowedTimePreferences = new Set(['afternoon', 'morning', 'noon', 'evening']);

const assistantExtractionSchema = z.object({
  intent: z.enum([
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
  ]),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  appointmentTypeName: z.string().nullable(),
  appointmentTypeId: z.string().nullable(),
  dateText: z.string().nullable(),
  time: z.string().nullable(),
  exactTime: z.string().nullable(),
  afterTime: z.string().nullable(),
  timePreference: z.enum(['afternoon', 'morning', 'noon', 'evening']).nullable(),
  confidence: z.number().min(0).max(1),
  needsClarification: z.boolean(),
  clarificationReason: z.string().nullable(),
});

type StructuredAssistantExtraction = z.infer<typeof assistantExtractionSchema>;

type ServiceOption = {
  id: string;
  name: string;
};

type ExtractAssistantInputArgs = {
  text: string;
  services: ServiceOption[];
  currentIntent?: string | null;
  currentStep?: string | null;
  customerName?: string | null;
  selectedAppointmentTypeName?: string | null;
  selectedDate?: string | null;
};

const getGoogleAiStudioConfig = () => {
  const apiKey = process.env.GOOGLE_AI_STUDIO_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GOOGLE_AI_MODEL?.trim() || 'gemini-2.0-flash';

  return {
    apiKey,
    model,
  };
};

const readResponseText = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidates = Array.isArray((payload as any).candidates) ? (payload as any).candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        return part.text.trim();
      }
    }
  }

  return null;
};

const stripCodeFence = (value: string) => value.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();

const readNullableString = (value: unknown) => typeof value === 'string' ? value : null;

const sanitizeAssistantExtraction = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const rawIntent = typeof record.intent === 'string' ? record.intent : 'unknown';

  return {
    intent: allowedIntents.has(rawIntent) ? rawIntent : 'unknown',
    name: readNullableString(record.name),
    phone: readNullableString(record.phone),
    appointmentTypeName: readNullableString(record.appointmentTypeName),
    appointmentTypeId: readNullableString(record.appointmentTypeId),
    dateText: readNullableString(record.dateText),
    time: readNullableString(record.time),
    exactTime: readNullableString(record.exactTime),
    afterTime: readNullableString(record.afterTime),
    timePreference: typeof record.timePreference === 'string' && allowedTimePreferences.has(record.timePreference)
      ? record.timePreference
      : null,
    confidence: typeof record.confidence === 'number'
      ? Math.max(0, Math.min(1, record.confidence))
      : 0.4,
    needsClarification: record.needsClarification === true,
    clarificationReason: readNullableString(record.clarificationReason),
  };
};

export const extractAssistantInputWithGoogleAi = async (
  args: ExtractAssistantInputArgs
): Promise<StructuredAssistantExtraction | null> => {
  const config = getGoogleAiStudioConfig();
  if (!config.apiKey) {
    return null;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

  const prompt = [
    'You are extracting structured data for a Turkish dental clinic WhatsApp assistant.',
    'Return JSON only. Do not wrap in markdown.',
    'Do not decide whether backend tools should be called. Do not invent dates or times.',
    'If a field is not clearly present or cannot be inferred from the latest user message plus current conversation context, return null.',
    'Recognize natural Turkish phrasing, shorthand and casual WhatsApp style.',
    'Allowed intents: greeting, book_appointment, appointment_query, cancel_appointment, human_handoff, clinic_info, service_info, symptom_or_complaint, off_topic_or_smalltalk, unknown.',
    'IMPORTANT intent rules:',
    '- greeting: simple hello/opening messages.',
    '- book_appointment: user wants to schedule a NEW appointment.',
    '- appointment_query: user wants to see their OWN existing appointments ("randevum var mı", "randevuma bakar mısın"). Do NOT use this for questions about whether the clinic is open.',
    '- cancel_appointment: user wants to cancel an existing appointment.',
    '- human_handoff: user wants a human, authorized staff, representative, doctor, receptionist, or live support.',
    '- clinic_info: user asks about clinic facts such as working hours, lunch break, address, phone, how many doctors work there, whether the clinic is open.',
    '- service_info: user asks about available services, prices, or treatments.',
    '- symptom_or_complaint: user describes a symptom or complaint such as toothache, swelling, bleeding, broken tooth, pain. Do not diagnose.',
    '- off_topic_or_smalltalk: user asks casual or unrelated questions such as current time, weather, jokes, or small talk.',
    '- unknown: anything else that cannot be safely classified.',
    '',
    `Current intent: ${args.currentIntent ?? 'null'}`,
    `Current step: ${args.currentStep ?? 'null'}`,
    `Known customer name: ${args.customerName ?? 'null'}`,
    `Selected appointment type: ${args.selectedAppointmentTypeName ?? 'null'}`,
    `Selected date: ${args.selectedDate ?? 'null'}`,
    `Available services: ${JSON.stringify(args.services)}`,
    `Latest customer message: ${JSON.stringify(args.text)}`,
    '',
    'JSON shape:',
    '{',
    '  "intent": "greeting" | "book_appointment" | "appointment_query" | "cancel_appointment" | "human_handoff" | "clinic_info" | "service_info" | "symptom_or_complaint" | "off_topic_or_smalltalk" | "unknown",',
    '  "name": string | null,',
    '  "phone": string | null,',
    '  "appointmentTypeName": string | null,',
    '  "appointmentTypeId": string | null,',
    '  "dateText": string | null,',
    '  "time": string | null,',
    '  "exactTime": string | null,',
    '  "afterTime": string | null,',
    '  "timePreference": "afternoon" | "morning" | "noon" | "evening" | null,',
    '  "confidence": number,',
    '  "needsClarification": boolean,',
    '  "clarificationReason": string | null',
    '}',
    '',
    'Interpretation rules:',
    '- exactTime should be normalized like 09:30 or 10:00 when the user asks for a specific time.',
    '- afterTime should be normalized like 11:00 when the user says 11 den sonra / 11 sonrası / after 11.',
    '- timePreference should be used for broad phrases like ikindi vakti, öğleden sonra, akşam üzeri, sabah erken.',
    '- If the user does not know the service but describes pain or a complaint, use symptom_or_complaint, not service_info.',
    '- If the user asks for a human, human_handoff has priority over the current conversation state.',
    '- If the user asks clinic information while also mentioning appointment availability, classify as book_appointment when scheduling is clearly requested.',
    '- confidence must reflect how certain you are about the extraction from the latest message and current context.',
    '- needsClarification should be true when the message is ambiguous enough that the backend should ask a short follow-up instead of assuming.',
  ].join('\n');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google AI Studio extraction failed with ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  const text = readResponseText(payload);
  if (!text) {
    return null;
  }

  const parsed = JSON.parse(stripCodeFence(text));
  const sanitized = sanitizeAssistantExtraction(parsed);
  if (!sanitized) {
    return null;
  }

  const result = assistantExtractionSchema.safeParse(sanitized);
  return result.success ? result.data : null;
};
