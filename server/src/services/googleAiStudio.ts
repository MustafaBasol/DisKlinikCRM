import { z } from 'zod';

const assistantExtractionSchema = z.object({
  intent: z.enum(['book_appointment', 'check_appointment', 'cancel_appointment', 'service_info', 'unknown']),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  appointmentTypeName: z.string().nullable(),
  appointmentTypeId: z.string().nullable(),
  dateText: z.string().nullable(),
  time: z.string().nullable(),
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
    'Allowed intents: book_appointment, check_appointment, cancel_appointment, service_info, unknown.',
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
    '  "intent": "book_appointment" | "check_appointment" | "cancel_appointment" | "service_info" | "unknown",',
    '  "name": string | null,',
    '  "phone": string | null,',
    '  "appointmentTypeName": string | null,',
    '  "appointmentTypeId": string | null,',
    '  "dateText": string | null,',
    '  "time": string | null',
    '}',
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
  return assistantExtractionSchema.parse(parsed);
};