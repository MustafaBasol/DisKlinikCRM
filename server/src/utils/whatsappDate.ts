export const WHATSAPP_ASSISTANT_TIME_ZONE = 'Europe/Paris';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const turkishMonths: Record<string, number> = {
  ocak: 1,
  subat: 2,
  şubat: 2,
  mart: 3,
  nisan: 4,
  mayis: 5,
  mayıs: 5,
  haziran: 6,
  temmuz: 7,
  agustos: 8,
  ağustos: 8,
  eylul: 9,
  eylül: 9,
  ekim: 10,
  kasim: 11,
  kasım: 11,
  aralik: 12,
  aralık: 12,
};

const turkishWeekdays: Record<string, number> = {
  pazar: 0,
  pazartesi: 1,
  sali: 2,
  salı: 2,
  carsamba: 3,
  çarşamba: 3,
  persembe: 4,
  perşembe: 4,
  cuma: 5,
  cumartesi: 6,
};

const getTimeZoneDateParts = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  return {
    year: Number(parts.find(part => part.type === 'year')?.value ?? '0'),
    month: Number(parts.find(part => part.type === 'month')?.value ?? '0'),
    day: Number(parts.find(part => part.type === 'day')?.value ?? '0'),
  };
};

const buildUtcDate = (year: number, month: number, day: number) => {
  const value = new Date(Date.UTC(year, month - 1, day));

  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) {
    return null;
  }

  return value;
};

const addUtcDays = (date: Date, days: number) => new Date(date.getTime() + days * ONE_DAY_MS);

const formatIsoDate = (date: Date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const normalizeText = (input: string) => input.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');

const getTodayInTimeZone = (now: Date, timeZone: string) => {
  const parts = getTimeZoneDateParts(now, timeZone);
  return buildUtcDate(parts.year, parts.month, parts.day)!;
};

const resolveYearIfMissing = (month: number, day: number, today: Date) => {
  const currentYear = today.getUTCFullYear();
  const currentYearDate = buildUtcDate(currentYear, month, day);
  if (!currentYearDate) {
    return null;
  }

  if (currentYearDate.getTime() >= today.getTime()) {
    return currentYearDate;
  }

  return buildUtcDate(currentYear + 1, month, day);
};

export const normalizeDateFromTurkishInput = (input: string, now: Date, timeZone = WHATSAPP_ASSISTANT_TIME_ZONE): string | null => {
  const normalized = normalizeText(input);
  if (!normalized) {
    return null;
  }

  const today = getTodayInTimeZone(now, timeZone);

  if (
    normalized === 'bugün'
    || normalized === 'bugun'
    || normalized.includes('bugün')
    || normalized.includes('bugun')
  ) {
    return formatIsoDate(today);
  }

  if (
    normalized === 'yarın'
    || normalized === 'yarin'
    || normalized.includes('yarın')
    || normalized.includes('yarin')
  ) {
    return formatIsoDate(addUtcDays(today, 1));
  }

  if (
    normalized === 'yarından sonra'
    || normalized === 'yarindan sonra'
    || normalized.includes('yarından sonra')
    || normalized.includes('yarindan sonra')
  ) {
    return formatIsoDate(addUtcDays(today, 2));
  }

  const isoMatch = normalized.match(/(?:^|\D)(\d{4})-(\d{2})-(\d{2})(?:\D|$)/);
  if (isoMatch) {
    const parsed = buildUtcDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    return parsed ? formatIsoDate(parsed) : null;
  }

  const slashOrDotMatch = normalized.match(/(?:^|\D)(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?(?:\D|$)/);
  if (slashOrDotMatch) {
    const day = Number(slashOrDotMatch[1]);
    const month = Number(slashOrDotMatch[2]);
    const year = slashOrDotMatch[3] ? Number(slashOrDotMatch[3]) : undefined;
    const parsed = year ? buildUtcDate(year, month, day) : resolveYearIfMissing(month, day, today);
    return parsed ? formatIsoDate(parsed) : null;
  }

  const dayMonthTextMatch = normalized.match(/(?:^|\D)(\d{1,2})\s+([a-zçğıöşü]+)(?:\s+(\d{4}))?(?:\D|$)/i);
  if (dayMonthTextMatch) {
    const day = Number(dayMonthTextMatch[1]);
    const month = turkishMonths[dayMonthTextMatch[2]];
    if (!month) {
      return null;
    }

    const year = dayMonthTextMatch[3] ? Number(dayMonthTextMatch[3]) : undefined;
    const parsed = year ? buildUtcDate(year, month, day) : resolveYearIfMissing(month, day, today);
    return parsed ? formatIsoDate(parsed) : null;
  }

  let modifier: 'plain' | 'this' | 'next' = 'plain';
  let weekdayLabel = normalized;

  if (weekdayLabel.startsWith('bu ')) {
    modifier = 'this';
    weekdayLabel = weekdayLabel.slice(3).trim();
  } else if (weekdayLabel.startsWith('gelecek ')) {
    modifier = 'next';
    weekdayLabel = weekdayLabel.slice(8).trim();
  }

  const targetWeekday = turkishWeekdays[weekdayLabel];
  if (targetWeekday !== undefined) {
    let delta = targetWeekday - today.getUTCDay();
    if (delta < 0) {
      delta += 7;
    }
    if (modifier === 'next') {
      delta += 7;
    }

    return formatIsoDate(addUtcDays(today, delta));
  }

  return null;
};

export const formatTurkishDateLong = (isoDate: string, timeZone = WHATSAPP_ASSISTANT_TIME_ZONE) => {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${isoDate}T12:00:00Z`));
};