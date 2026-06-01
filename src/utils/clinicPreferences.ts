export type RegionPreset = 'TR' | 'US' | 'GB' | 'CA' | 'DE' | 'FR' | 'EU';
export type DateFormatPreference = 'dd.MM.yyyy' | 'MM/dd/yyyy' | 'dd/MM/yyyy' | 'yyyy-MM-dd';
export type TimeFormatPreference = '24h' | '12h';
export type FirstDayOfWeekPreference = 'monday' | 'sunday';

export type ClinicOperatingPreferences = {
  regionPreset: RegionPreset;
  locale: string;
  currency: string;
  timezone: string;
  dateFormat: DateFormatPreference;
  timeFormat: TimeFormatPreference;
  firstDayOfWeek: FirstDayOfWeekPreference;
};

export const DEFAULT_CLINIC_OPERATING_PREFERENCES: ClinicOperatingPreferences = {
  regionPreset: 'TR',
  locale: 'tr-TR',
  currency: 'TRY',
  timezone: 'Europe/Istanbul',
  dateFormat: 'dd.MM.yyyy',
  timeFormat: '24h',
  firstDayOfWeek: 'monday',
};

export const REGION_DEFAULTS: Record<RegionPreset, ClinicOperatingPreferences> = {
  TR: DEFAULT_CLINIC_OPERATING_PREFERENCES,
  US: {
    regionPreset: 'US',
    locale: 'en-US',
    currency: 'USD',
    timezone: 'America/New_York',
    dateFormat: 'MM/dd/yyyy',
    timeFormat: '12h',
    firstDayOfWeek: 'sunday',
  },
  GB: {
    regionPreset: 'GB',
    locale: 'en-GB',
    currency: 'GBP',
    timezone: 'Europe/London',
    dateFormat: 'dd/MM/yyyy',
    timeFormat: '24h',
    firstDayOfWeek: 'monday',
  },
  CA: {
    regionPreset: 'CA',
    locale: 'en-CA',
    currency: 'CAD',
    timezone: 'America/Toronto',
    dateFormat: 'yyyy-MM-dd',
    timeFormat: '12h',
    firstDayOfWeek: 'sunday',
  },
  DE: {
    regionPreset: 'DE',
    locale: 'de-DE',
    currency: 'EUR',
    timezone: 'Europe/Berlin',
    dateFormat: 'dd.MM.yyyy',
    timeFormat: '24h',
    firstDayOfWeek: 'monday',
  },
  FR: {
    regionPreset: 'FR',
    locale: 'fr-FR',
    currency: 'EUR',
    timezone: 'Europe/Paris',
    dateFormat: 'dd/MM/yyyy',
    timeFormat: '24h',
    firstDayOfWeek: 'monday',
  },
  EU: {
    regionPreset: 'EU',
    locale: 'en-GB',
    currency: 'EUR',
    timezone: 'Europe/Paris',
    dateFormat: 'dd/MM/yyyy',
    timeFormat: '24h',
    firstDayOfWeek: 'monday',
  },
};

export const regionPresetValues: RegionPreset[] = ['TR', 'US', 'GB', 'CA', 'DE', 'FR', 'EU'];
export const localeValues = ['tr-TR', 'en-US', 'en-GB', 'en-CA', 'de-DE', 'fr-FR', 'es-ES', 'it-IT', 'nl-NL'];
export const currencyValues = ['TRY', 'USD', 'EUR', 'GBP', 'CAD', 'CHF'];
export const timezoneValues = [
  'Europe/Istanbul',
  'America/New_York',
  'America/Toronto',
  'America/Vancouver',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'UTC',
];
export const dateFormatValues: DateFormatPreference[] = ['dd.MM.yyyy', 'MM/dd/yyyy', 'dd/MM/yyyy', 'yyyy-MM-dd'];
export const timeFormatValues: TimeFormatPreference[] = ['24h', '12h'];
export const firstDayOfWeekValues: FirstDayOfWeekPreference[] = ['monday', 'sunday'];

type ClinicDefaults = {
  currency?: string | null;
  timezone?: string | null;
};

const asDate = (value: string | Date) => value instanceof Date ? value : new Date(value);

function isSupportedCurrency(currency?: string | null): currency is string {
  return Boolean(currency && currencyValues.includes(currency));
}

function isSupportedTimezone(timezone?: string | null): timezone is string {
  return Boolean(timezone && timezoneValues.includes(timezone));
}

export function cloneClinicOperatingPreferences(): ClinicOperatingPreferences {
  return { ...DEFAULT_CLINIC_OPERATING_PREFERENCES };
}

export function defaultPreferencesForClinic(clinic?: ClinicDefaults | null): ClinicOperatingPreferences {
  return {
    ...DEFAULT_CLINIC_OPERATING_PREFERENCES,
    currency: isSupportedCurrency(clinic?.currency) ? clinic!.currency! : DEFAULT_CLINIC_OPERATING_PREFERENCES.currency,
    timezone: isSupportedTimezone(clinic?.timezone) ? clinic!.timezone! : DEFAULT_CLINIC_OPERATING_PREFERENCES.timezone,
  };
}

export function getDateParts(value: string | Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(asDate(value));

  return {
    year: parts.find(part => part.type === 'year')?.value ?? '0000',
    month: parts.find(part => part.type === 'month')?.value ?? '00',
    day: parts.find(part => part.type === 'day')?.value ?? '00',
  };
}

export function formatDateWithPreference(value: string | Date | null | undefined, preferences: ClinicOperatingPreferences): string {
  if (!value) return '-';
  const { day, month, year } = getDateParts(value, preferences.timezone);

  if (preferences.dateFormat === 'MM/dd/yyyy') return `${month}/${day}/${year}`;
  if (preferences.dateFormat === 'dd/MM/yyyy') return `${day}/${month}/${year}`;
  if (preferences.dateFormat === 'yyyy-MM-dd') return `${year}-${month}-${day}`;
  return `${day}.${month}.${year}`;
}

export function formatTimeWithPreference(value: string | Date | null | undefined, preferences: ClinicOperatingPreferences): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat(preferences.locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: preferences.timeFormat === '12h',
    timeZone: preferences.timezone,
  }).format(asDate(value));
}

export function formatDateTimeWithPreference(value: string | Date | null | undefined, preferences: ClinicOperatingPreferences): string {
  if (!value) return '-';
  return `${formatDateWithPreference(value, preferences)} ${formatTimeWithPreference(value, preferences)}`;
}

export function formatNumberWithPreference(value: number | null | undefined, preferences: ClinicOperatingPreferences, options: Intl.NumberFormatOptions = {}): string {
  if (value == null || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat(preferences.locale, options).format(value);
}

export function formatCurrencyWithPreference(
  value: number | null | undefined,
  preferences: ClinicOperatingPreferences,
  currency = preferences.currency,
  options: Intl.NumberFormatOptions = {},
): string {
  if (value == null || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat(preferences.locale, {
    style: 'currency',
    currency,
    ...options,
  }).format(value);
}
