export const DEFAULT_CLINIC_TIME_ZONE = 'Europe/Paris';

const asDate = (value: string | Date) => value instanceof Date ? value : new Date(value);

export const formatDateInTimeZone = (
  value: string | Date,
  locale: string | string[] | undefined = 'tr-TR',
  timeZone = DEFAULT_CLINIC_TIME_ZONE,
  options: Intl.DateTimeFormatOptions = {}
) => new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(asDate(value));

export const formatTimeInTimeZone = (
  value: string | Date,
  locale: string | string[] | undefined = 'tr-TR',
  timeZone = DEFAULT_CLINIC_TIME_ZONE,
  options: Intl.DateTimeFormatOptions = {}
) => new Intl.DateTimeFormat(locale, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  ...options,
  timeZone,
}).format(asDate(value));

export const formatDateTimeInTimeZone = (
  value: string | Date,
  locale: string | string[] | undefined = 'tr-TR',
  timeZone = DEFAULT_CLINIC_TIME_ZONE,
  options: Intl.DateTimeFormatOptions = {}
) => new Intl.DateTimeFormat(locale, {
  dateStyle: 'medium',
  timeStyle: 'short',
  ...options,
  timeZone,
}).format(asDate(value));

export const getDateKeyInTimeZone = (value: string | Date, timeZone = DEFAULT_CLINIC_TIME_ZONE) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(asDate(value));

  const year = parts.find(part => part.type === 'year')?.value ?? '0000';
  const month = parts.find(part => part.type === 'month')?.value ?? '00';
  const day = parts.find(part => part.type === 'day')?.value ?? '00';

  return `${year}-${month}-${day}`;
};