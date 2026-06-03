export type TimePreference = 'afternoon' | 'morning' | 'noon' | 'evening';

export type InterpretedTimeRequest = {
  normalizedText: string;
  exactTime: string | null;
  afterTimeMinutes: number | null;
  rangeStartMinutes: number | null;
  rangeEndMinutes: number | null;
  preference: TimePreference | null;
  wantsMoreOptions: boolean;
  wantsDifferentDate: boolean;
};

const normalizeIntentText = (value: string) => value.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');

const normalizeTurkishSearchText = (value: string) => normalizeIntentText(value)
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

const includesAny = (text: string, patterns: string[]) => patterns.some(pattern => text.includes(pattern));

const normalizeTimeExpressionText = (value: string) => normalizeIntentText(value)
  .replace(/ğ/g, 'g')
  .replace(/ü/g, 'u')
  .replace(/ş/g, 's')
  .replace(/ı/g, 'i')
  .replace(/i̇/g, 'i')
  .replace(/ö/g, 'o')
  .replace(/ç/g, 'c')
  .replace(/[^a-z0-9\s:.\-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// ── Türkçe sözel saat tanıyıcı ────────────────────────────────────────────────
// "iki buçuk", "üç", "on dört buçuk", "altı çeyrek" gibi ifadeleri dakikaya çevirir.
// Normalize edilmiş (ASCII) metin üzerinde çalışır.

const TURKISH_WORD_HOURS: Record<string, number> = {
  bir: 1,
  iki: 2,
  uc: 3,
  dort: 4,
  bes: 5,
  alti: 6,
  yedi: 7,
  sekiz: 8,
  dokuz: 9,
  on: 10,
  onbir: 11,
  oniki: 12,
  onuc: 13,
  ondort: 14,
  onbes: 15,
  onalti: 16,
  onyedi: 17,
  onsekiz: 18,
  ondokuz: 19,
  yirmi: 20,
  yirmibir: 21,
  yirmiiki: 22,
  yirmiuc: 23,
};

// "on iki" gibi boşluklu kombinasyonları da tanı
const TURKISH_WORD_HOURS_SPACED: Array<[string, number]> = [
  ['on bir', 11], ['on iki', 12], ['on uc', 13], ['on dort', 14],
  ['on bes', 15], ['on alti', 16], ['on yedi', 17], ['on sekiz', 18],
  ['on dokuz', 19], ['yirmi bir', 21], ['yirmi iki', 22], ['yirmi uc', 23],
];

/**
 * Normalize edilmiş bir metin parçasında Türkçe sözel saat ifadesi arar.
 * Eşleşme bulunursa { totalMinutes, matchedLength } döner.
 * "öğleden sonra" / "ogleden sonra" bağlamı verilirse saat < 12 olanlar +12 alır.
 */
const parseTurkishWordTime = (
  normalized: string,
  pmContext: boolean,
): { totalMinutes: number; matched: string } | null => {
  // Önce boşluklu çift-kelime saatleri dene ("on iki", "yirmi bir" ...)
  for (const [phrase, hour] of TURKISH_WORD_HOURS_SPACED) {
    const idx = normalized.indexOf(phrase);
    if (idx < 0) continue;
    const rest = normalized.slice(idx + phrase.length).trimStart();
    let minute = 0;
    let suffix = '';
    if (rest.startsWith('bucuk') || rest.startsWith('bucugu')) {
      minute = 30; suffix = ' bucuk';
    } else if (rest.startsWith('ceyrek')) {
      minute = 15; suffix = ' ceyrek';
    }
    let resolvedHour = hour;
    if (pmContext && resolvedHour < 12) resolvedHour += 12;
    return { totalMinutes: resolvedHour * 60 + minute, matched: phrase + suffix };
  }

  // Tek kelime saatler
  for (const [word, hour] of Object.entries(TURKISH_WORD_HOURS)) {
    const re = new RegExp(`\\b${word}\\b`);
    const match = re.exec(normalized);
    if (!match) continue;
    const rest = normalized.slice(match.index + word.length).trimStart();
    let minute = 0;
    let suffix = '';
    if (rest.startsWith('bucuk') || rest.startsWith('bucugu')) {
      minute = 30; suffix = ' bucuk';
    } else if (rest.startsWith('ceyrek')) {
      minute = 15; suffix = ' ceyrek';
    }
    let resolvedHour = hour;
    if (pmContext && resolvedHour < 12) resolvedHour += 12;
    return { totalMinutes: resolvedHour * 60 + minute, matched: word + suffix };
  }

  return null;
};

const hasPmContext = (normalized: string) => includesAny(normalized, [
  'ogleden sonra', 'ogle sonra', 'ogleden sonraki', 'ogle sonrasi',
  'ikindi', 'aksam', 'aksam uzeri',
]);

// ── Zaman sinyali kontrolü ────────────────────────────────────────────────────

const hasTimeSignal = (normalized: string) => includesAny(normalized, [
  'saat',
  'olsun',
  'istiyorum',
  'uygun',
  'musait',
  'olur mu',
  'civari',
  'gibi',
  'var mi',
]);

export const isMoreOptionsRequest = (text: string) => {
  const normalized = normalizeTurkishSearchText(text);
  return includesAny(normalized, [
    'bunlar uygun degil',
    'baska saat var mi',
    'baska saat',
    'baska uygun saat',
    'uygun degil',
    'daha baska',
    'daha gec saat',
  ]);
};

export const isDifferentDateRequest = (text: string) => {
  const normalized = normalizeTurkishSearchText(text);
  return includesAny(normalized, [
    'baska gun',
    'farkli gun',
    'baska tarih',
    'diger gun',
    'ertesi gun',
  ]);
};

export const getTimePreference = (text: string): TimePreference | null => {
  const normalized = normalizeTurkishSearchText(text);

  if (includesAny(normalized, [
    'ikindi vakti',
    'ikindi',
    'ogleden sonra',
    'ogle sonra',
    'ogleden sonraki',
    'ogleden biraz sonra',
    'ogle sonrasi',
  ])) {
    return 'afternoon';
  }

  if (includesAny(normalized, [
    'sabah',
    'erken saat',
    'ogleden once',
    'ogle once',
    'sabah erken',
  ])) {
    return 'morning';
  }

  if (includesAny(normalized, [
    'ogle',
    'ogle civari',
    '12 civari',
    'ogleye dogru',
  ])) {
    return 'noon';
  }

  if (includesAny(normalized, [
    'aksam',
    'aksam uzeri',
    'aksama dogru',
    'mesai sonrasi',
    'gun sonu',
    'gec saat',
  ])) {
    return 'evening';
  }

  return null;
};

export const extractExplicitTimeThreshold = (text: string) => {
  const normalized = normalizeTurkishSearchText(text);

  // Rakamla yazılmış saat eşiği: "15ten sonra", "14:30 sonrası" ...
  const thresholdMatch = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:sonrasi|den sonra|dan sonra|ten sonra|tan sonra|sonrasinda)\b/);
  if (thresholdMatch) {
    const hour = Number(thresholdMatch[1]);
    const minute = thresholdMatch[2] ? Number(thresholdMatch[2]) : 0;
    return hour * 60 + minute;
  }

  // Sözel saat + "sonrası/bucuktan sonra" → saat ifadesini bul, hemen arkasında "sonra" var mı kontrol et.
  // Not: "ogleden sonra" bağlamını yanlış yorumlamamak için afterText kontrolü yap.
  {
    const pmCtx = hasPmContext(normalized);
    const wordTime = parseTurkishWordTime(normalized, pmCtx);
    if (wordTime) {
      const matchStart = normalized.indexOf(wordTime.matched);
      const afterText = matchStart >= 0 ? normalized.slice(matchStart + wordTime.matched.length) : '';
      if (/^\s*(?:tan\s+sonra|ten\s+sonra|dan\s+sonra|den\s+sonra|ve\s+sonrasi|sonrasi|sonrasinda)/.test(afterText)) {
        return wordTime.totalMinutes;
      }
    }
  }

  if (includesAny(normalized, ['daha gec', 'daha geç'])) {
    return 12 * 60;
  }

  return null;
};

export const extractExplicitTimeRange = (text: string) => {
  const normalized = normalizeTimeExpressionText(text);
  const rangeMatch = normalized.match(/\b(?:saat\s*)?(\d{1,2})(?::(\d{2}))?\s*(?:-|ile|ila)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:arasi|arasinda|araliginda)\b/);
  if (!rangeMatch) {
    return null;
  }

  const startHour = Number(rangeMatch[1]);
  const startMinute = rangeMatch[2] ? Number(rangeMatch[2]) : 0;
  const endHour = Number(rangeMatch[3]);
  const endMinute = rangeMatch[4] ? Number(rangeMatch[4]) : 0;
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;

  if (Number.isNaN(startTotal) || Number.isNaN(endTotal) || endTotal < startTotal) {
    return null;
  }

  return {
    startMinutes: startTotal,
    endMinutes: endTotal,
  };
};

export const extractExplicitRequestedTime = (text: string) => {
  const normalized = normalizeTurkishSearchText(text);
  const normalizedTimeExpression = normalizeTimeExpressionText(text);
  if (extractExplicitTimeRange(text)) {
    return null;
  }

  // "öğleden sonra" → "ogleden sonra" içindeki "den sonra"nın yanlış eşleşmesini önlemek için \b kullan.
  // Ancak "15ten sonra" gibi rakam+ek+sonra ifadeleri de yakalanmalı (\d+ten/tan/den/dan sonra).
  if (/(?:sonrasi|sonrasinda|\d(?:ten|tan|den|dan) sonra|\bten sonra\b|\bdan sonra\b|\bden sonra\b|\btan sonra\b)/.test(normalized)) {
    return null;
  }

  // Rakamla yazılmış HH:MM veya HH
  const exactTimeMatch = normalizedTimeExpression.match(/\b(?:saat\s*)?([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*(?:te|ta|de|da))?\b/);
  if (exactTimeMatch) {
    return `${exactTimeMatch[1].padStart(2, '0')}:${exactTimeMatch[2]}`;
  }

  const hourOnlyMatch = normalizedTimeExpression.match(/\b(?:saat\s*)?([01]?\d|2[0-3])(?:\s*(?:te|ta|de|da))?\b/);
  if (hourOnlyMatch && hasTimeSignal(normalized)) {
    return `${hourOnlyMatch[1].padStart(2, '0')}:00`;
  }

  // Sözel saat ifadesi: "öğleden sonra iki buçuk", "sabah sekiz", "iki buçuk"
  const pmCtx = hasPmContext(normalized);
  const wordTime = parseTurkishWordTime(normalized, pmCtx);
  if (wordTime) {
    const hour = Math.floor(wordTime.totalMinutes / 60);
    const minute = wordTime.totalMinutes % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  return null;
};

export const interpretTimeRequest = (text: string): InterpretedTimeRequest => {
  const explicitRange = extractExplicitTimeRange(text);
  return {
    normalizedText: normalizeTurkishSearchText(text),
    exactTime: extractExplicitRequestedTime(text),
    afterTimeMinutes: extractExplicitTimeThreshold(text),
    rangeStartMinutes: explicitRange?.startMinutes ?? null,
    rangeEndMinutes: explicitRange?.endMinutes ?? null,
    preference: getTimePreference(text),
    wantsMoreOptions: isMoreOptionsRequest(text),
    wantsDifferentDate: isDifferentDateRequest(text),
  };
};
