import { buildWhatsAppAgentPrompt, type WhatsAppAgentPromptArgs } from './whatsappAgentPrompt.js';
import {
  normalizeWhatsAppAgentDecision,
  type WhatsAppAgentDecision,
  type WhatsAppAgentIntent,
} from './whatsappAgentSchema.js';

export type WhatsAppConversationAgentSource = 'ai' | 'rule_fallback' | 'unavailable' | 'ai_error';

export type ResolveWhatsAppConversationAgentArgs = WhatsAppAgentPromptArgs;

export type WhatsAppConversationAgentResolution = {
  decision: WhatsAppAgentDecision | null;
  source: WhatsAppConversationAgentSource;
};

const getGoogleAiStudioConfig = () => {
  const apiKey = process.env.GOOGLE_AI_STUDIO_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GOOGLE_AI_MODEL?.trim() || 'gemini-2.0-flash';
  const enabledFlag = process.env.WHATSAPP_AI_AGENT_ENABLED?.trim().toLocaleLowerCase('tr-TR');
  const enabled = !['0', 'false', 'off', 'disabled'].includes(enabledFlag ?? '');

  return { apiKey, model, enabled };
};

const readResponseText = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = Array.isArray((payload as any).candidates) ? (payload as any).candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      if (typeof part?.text === 'string' && part.text.trim()) return part.text.trim();
    }
  }
  return null;
};

const stripCodeFence = (value: string) => value
  .replace(/^```json\s*/i, '')
  .replace(/^```\s*/i, '')
  .replace(/```$/i, '')
  .trim();

const parseJsonObject = (text: string) => {
  const stripped = stripCodeFence(text);
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('AI response did not contain a JSON object');
    return JSON.parse(stripped.slice(start, end + 1));
  }
};

const normalizeTurkishSearchText = (value: string) => value.trim()
  .toLocaleLowerCase('tr-TR')
  .replace(/\s+/g, ' ')
  .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ı/g, 'i')
  .replace(/i̇/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const includesAny = (text: string, patterns: string[]) => patterns.some(pattern => text.includes(pattern));

const makeDecision = (args: {
  intent: WhatsAppAgentIntent;
  action: WhatsAppAgentDecision['action'];
  confidence: number;
  reply?: string | null;
  statePatch?: WhatsAppAgentDecision['statePatch'];
  safetyFlags?: string[];
}): WhatsAppAgentDecision => ({
  intent: args.intent,
  action: args.action,
  confidence: args.confidence,
  reply: args.reply ?? null,
  slots: {
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
  },
  statePatch: args.statePatch ?? {},
  needsHuman: args.action === 'human_handoff',
  safetyFlags: args.safetyFlags ?? [],
});

export const buildFallbackWhatsAppAgentDecision = (args: ResolveWhatsAppConversationAgentArgs): WhatsAppAgentDecision | null => {
  const normalized = normalizeTurkishSearchText(args.latestMessage);
  const compact = normalized.replace(/\s+/g, '');
  const currentStep = args.currentStep ?? null;

  const hasHumanTarget = /\b(yetk\w*|temsilci\w*|operator\w*|personel\w*|resepsiyon\w*|sekreter\w*|insan\w*|doktor\w*|dr|ekip\w*|ekib\w*)\b/.test(normalized)
    || normalized.includes('hasta kabul')
    || compact.includes('canlidestek');
  const hasContactVerb = /\b(bagla\w*|baglayin|gorus\w*|grs\w*|grsmk|konus\w*|ulas\w*|ara\w*|ilet\w*|yaz\w*)\b/.test(normalized)
    || compact.includes('baglabeni')
    || compact.includes('grsmk');

  const humanLike = includesAny(normalized, [
    'yetkili', 'yetklye', 'yetkiliye', 'yetklyle', 'yetkiliyle', 'temsilci', 'operator', 'canli destek', 'insanla',
    'personel', 'resepsiyon', 'sekreter', 'doktorla gorus', 'beni ara', 'beni arasin',
    'ekibe ilet', 'klinik ekibi', 'biriyle gorus', 'birisiyle gorus', 'canli biri',
  ]) || /(bagla|baglar|baglayin|gorus|konus|ulas|ara|ilet).*(yetk|temsilci|personel|insan|doktor|resepsiyon)/.test(normalized)
    || /(yetk|temsilci|personel|insan|doktor|resepsiyon).*(bagla|gorus|konus|ulas|ara|ilet)/.test(normalized)
    || /\bbeni\b.*\bara\w*\b/.test(normalized)
    || /\bara\w*\b.*\bbeni\b/.test(normalized)
    || (hasHumanTarget && hasContactVerb)
    || compact.includes('yetklyebagla')
    || compact.includes('yetkiliyebagla');

  if (humanLike) {
    return makeDecision({
      intent: 'human_handoff',
      action: currentStep === 'awaiting_handoff_note' ? 'store_handoff_note' : 'human_handoff',
      confidence: 0.96,
      statePatch: { currentIntent: 'human_handoff', step: 'awaiting_handoff_note' },
    });
  }

  const symptomLike = includesAny(normalized, [
    'disim agri', 'dis agrisi', 'agzim agri', 'cenem agri', 'agriyo', 'agriyor',
    'aciyo', 'aciyor', 'sizlama', 'sizlik', 'hassasiyet', 'sislik', 'sisti',
    'apse', 'kanama', 'kaniyor', 'kirildi', 'catladi', 'dolgu dustu',
    'kaplama dustu', 'sikayetim var', 'zonkluyor', 'iltihap', 'curuk',
    'disim sallaniyor', 'telim cikti', 'yirmilik dis', 'disimde delik',
    'parca koptu', 'kan geliyor', 'uyutmuyor', 'sicak soguk', 'dis eti sisti',
    'agzimda yara', 'damagim', 'kokuyor', 'koku', 'dolgum dustu', 'oynuyor',
    'braket', 'telim batti', 'dis eti cekil',
  ]) || /\b(dis\w*|agiz\w*|agzim|cene\w*|cenem|disetim|diseti)\b.*\b(agr|agri|ac|aci|siz|sis|kan|kir|cat|apse)\w*/.test(normalized)
    || /\b(agri|agriyo|agriyor|aciyor|sanci|sancisi|sislik|kanama|apse|zonklu\w*|iltihap|yara)\b/.test(normalized);

  if (symptomLike) {
    return makeDecision({
      intent: 'symptom_or_complaint',
      action: 'start_general_assessment',
      confidence: 0.94,
      statePatch: { currentIntent: 'symptom_or_complaint', step: 'awaiting_general_date' },
      safetyFlags: ['no_diagnosis', 'no_treatment_advice'],
    });
  }

  const clinicInfoLike = includesAny(normalized, [
    'kac doktor', 'doktor sayisi', 'kac hekim', 'hekim sayisi', 'calisan doktor',
    'adres', 'neredesiniz', 'nerede', 'nerde', 'konum', 'lokasyon', 'harita', 'yol tarifi',
    'telefon', 'numaraniz', 'mail', 'email', 'eposta', 'web sitesi', 'web siteniz', 'web',
    'calisma saat', 'mesai saat', 'kacta ac', 'kacta kapan', 'ogle arasi',
    'ogle molasi', 'oglen acik', 'oglen', 'mola', 'acik misiniz', 'acik mi',
    'hafta sonu', 'cumartesi', 'pazar', 'doktorlar kim', 'hekimler kim', 'calisiyor musunuz',
    'aciksiniz', 'hangi gunler',
  ]) || /\bkac\b.*\b(doktor|dr|hekim|hkm|hek)\b/.test(normalized)
    || /\b(doktor|dr|hekim|hkm|hek)\b.*\bkac\b/.test(normalized);

  const hasPersonalBookingAvailability = /(gelebilirim|gelebilir miyim|musaitim|uygunum|gelmek istiyorum|randev|randv|rndv)/.test(normalized);
  if (clinicInfoLike && !hasPersonalBookingAvailability) {
    return makeDecision({
      intent: 'clinic_info',
      action: 'answer_clinic_info',
      confidence: 0.9,
    });
  }

  const appointmentQueryLike = /(randevum|randevm|randevuma|randevumu|randvum|rndvum).*(var|ne zaman|sorgu|bak|kontrol|ogren|gor|goster|durum|saat|bilgi|hatirlat|kayit|liste)/.test(normalized)
    || /(benim|adima).*(randev|randv|rndv)/.test(normalized)
    || /(randev|randv|rndv).*(bilgilerim|durumum|saatim|saatimi|saatini|hatirlat|kaydim|listemi)/.test(normalized)
    || /(ne zaman|kacta).*(randevum|randevm|randevuma|randevumu|randvum|rndvum)/.test(normalized)
    || includesAny(normalized, ['randevum var mi', 'randevuma bak', 'randevumu ogren', 'randevu bilgilerim']);
  if (appointmentQueryLike) {
    return makeDecision({
      intent: 'appointment_query',
      action: 'appointment_lookup',
      confidence: 0.91,
    });
  }

  const cancelLike = /(randev|randv|rndv).*(iptal|sil|vazgec|kaldir|boz)/.test(normalized)
    || /(iptal|sil|vazgec|kaldir|boz).*(randev|randv|rndv)/.test(normalized)
    || /(yarinkini|bugunkunu|randevumu|bugunku randevu|yarinki randevu).*(iptal|sil)/
      .test(normalized)
    || ((currentStep === 'awaiting_cancel_selection' || currentStep === 'awaiting_confirmation') && includesAny(normalized, ['iptal', 'vazgectim']));
  if (cancelLike) {
    return makeDecision({
      intent: 'cancel_appointment',
      action: 'cancel_appointment',
      confidence: 0.92,
    });
  }

  const serviceInfoLike = includesAny(normalized, [
    'hizmetler', 'hangi hizmet', 'tedaviler', 'neler yapiyorsunuz', 'fiyat', 'ucret',
    'implant', 'kanal tedavisi', 'dis beyazlatma', 'ortodonti', 'tel takiyor',
    'zirkonyum', 'lamina', 'cerrahi', 'dis cekimi', 'muayene ucreti', 'fiyat listesi',
    'kaplama yapiyor', 'dolgu yapiyor', 'kanal', 'dis tasi', 'temizlik',
  ]);
  if (serviceInfoLike) {
    return makeDecision({
      intent: 'service_info',
      action: 'answer_service_info',
      confidence: 0.86,
    });
  }

  const smallTalkLike = includesAny(normalized, [
    'saat kac', 'saat kactir', 'su an saat', 'nasilsin', 'naber', 'hava nasil',
    'iyi misin', 'bugun gunlerden ne', 'sen kimsin', 'bot musun',
  ]);
  if (smallTalkLike) {
    return makeDecision({
      intent: 'off_topic_or_smalltalk',
      action: 'reply_only',
      confidence: 0.86,
    });
  }

  const bookingLike = /(randev|randv|rndv|muayene).*(\bal\w*|\bist\w*|olustur|ayarla|bak|musait|uygun|var mi|yer|yaz)/.test(normalized)
    || /(musaitim|gelebilirim|gelebilir miyim|uygunum|uygun musunuz|kontrol ettirmek|kontrole gelmek|baktirmak|baktirmak istiyorum|bakilmasini istiyorum|bakabilir misiniz|yer var mi|uygun saat|musait randevu|gelmek istiyorum)/.test(normalized)
    || /(icin randev|randev\w* icin)/.test(normalized);
  if (bookingLike) {
    return makeDecision({
      intent: 'book_appointment',
      action: currentStep && currentStep !== 'main_menu' ? 'continue_booking' : 'start_booking',
      confidence: 0.82,
      statePatch: { currentIntent: 'book_appointment' },
    });
  }

  const activeBookingStep = Boolean(currentStep && currentStep !== 'main_menu');
  const bookingContinuationLike = activeBookingStep && (
    /\b(bugun|yarin|pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar)\b/.test(normalized)
    || /\b(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\b/.test(normalized)
    || /\b(sabah|ogle|ogleden sonra|ikindi|aksam|sonra|arasi|olur|uygun)\b/.test(normalized)
    || /\b\d{1,2}([:.]\d{2})?\b/.test(normalized)
  );
  if (bookingContinuationLike) {
    return makeDecision({
      intent: 'book_appointment',
      action: 'continue_booking',
      confidence: 0.82,
      statePatch: { currentIntent: 'book_appointment' },
    });
  }

  return null;
};

const runGoogleConversationAgent = async (args: ResolveWhatsAppConversationAgentArgs): Promise<WhatsAppAgentDecision | null> => {
  const config = getGoogleAiStudioConfig();
  if (!config.enabled || !config.apiKey) return null;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
  const prompt = buildWhatsAppAgentPrompt(args);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    throw new Error(`WhatsApp conversation agent failed with ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  const text = readResponseText(payload);
  if (!text) return null;
  return normalizeWhatsAppAgentDecision(parseJsonObject(text));
};

export const resolveWhatsAppConversationAgentDecision = async (
  args: ResolveWhatsAppConversationAgentArgs,
): Promise<WhatsAppConversationAgentResolution> => {
  const config = getGoogleAiStudioConfig();
  const fallbackDecision = buildFallbackWhatsAppAgentDecision(args);

  if (!config.enabled || !config.apiKey) {
    return {
      source: fallbackDecision ? 'rule_fallback' : 'unavailable',
      decision: fallbackDecision,
    };
  }

  try {
    const aiDecision = await runGoogleConversationAgent(args);
    return {
      source: aiDecision ? 'ai' : fallbackDecision ? 'rule_fallback' : 'unavailable',
      decision: aiDecision ?? fallbackDecision,
    };
  } catch (error) {
    console.error('[whatsapp-agent] ai-error', error);
    return {
      source: fallbackDecision ? 'rule_fallback' : 'ai_error',
      decision: fallbackDecision,
    };
  }
};
