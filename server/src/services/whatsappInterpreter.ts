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
  const thresholdMatch = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:sonrasi|den sonra|dan sonra|ten sonra|tan sonra)\b/);
  if (thresholdMatch) {
    const hour = Number(thresholdMatch[1]);
    const minute = thresholdMatch[2] ? Number(thresholdMatch[2]) : 0;
    return hour * 60 + minute;
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

  if (/(?:sonrasi|den sonra|dan sonra|ten sonra|tan sonra)/.test(normalized)) {
    return null;
  }

  const exactTimeMatch = normalizedTimeExpression.match(/\b(?:saat\s*)?([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*(?:te|ta|de|da))?\b/);
  if (exactTimeMatch) {
    return `${exactTimeMatch[1].padStart(2, '0')}:${exactTimeMatch[2]}`;
  }

  const hourOnlyMatch = normalizedTimeExpression.match(/\b(?:saat\s*)?([01]?\d|2[0-3])(?:\s*(?:te|ta|de|da))?\b/);
  if (!hourOnlyMatch) {
    return null;
  }

  if (!hasTimeSignal(normalized)) {
    return null;
  }

  return `${hourOnlyMatch[1].padStart(2, '0')}:00`;
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
