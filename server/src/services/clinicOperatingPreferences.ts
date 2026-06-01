import { z } from 'zod';
import prisma from '../db.js';

export const CLINIC_OPERATING_PREFERENCES_KEY = 'clinic.operating.preferences';

const regionPresetSchema = z.enum(['TR', 'US', 'GB', 'CA', 'DE', 'FR', 'EU']);
const localeSchema = z.enum([
  'tr-TR',
  'en-US',
  'en-GB',
  'en-CA',
  'de-DE',
  'fr-FR',
  'es-ES',
  'it-IT',
  'nl-NL',
]);
const currencySchema = z.enum(['TRY', 'USD', 'EUR', 'GBP', 'CAD', 'CHF']);
const timezoneSchema = z.enum([
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
]);
const dateFormatSchema = z.enum(['dd.MM.yyyy', 'MM/dd/yyyy', 'dd/MM/yyyy', 'yyyy-MM-dd']);
const timeFormatSchema = z.enum(['24h', '12h']);
const firstDayOfWeekSchema = z.enum(['monday', 'sunday']);

export const clinicOperatingPreferencesSchema = z.object({
  regionPreset: regionPresetSchema,
  locale: localeSchema,
  currency: currencySchema,
  timezone: timezoneSchema,
  dateFormat: dateFormatSchema,
  timeFormat: timeFormatSchema,
  firstDayOfWeek: firstDayOfWeekSchema,
});

export type ClinicOperatingPreferences = z.infer<typeof clinicOperatingPreferencesSchema>;

type ClinicDefaults = {
  currency?: string | null;
  timezone?: string | null;
  defaultLanguage?: string | null;
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

const REGION_DEFAULTS: Record<ClinicOperatingPreferences['regionPreset'], ClinicOperatingPreferences> = {
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

function clonePreferences(preferences: ClinicOperatingPreferences): ClinicOperatingPreferences {
  return JSON.parse(JSON.stringify(preferences)) as ClinicOperatingPreferences;
}

function inferRegionPreset(clinic?: ClinicDefaults): ClinicOperatingPreferences['regionPreset'] {
  if (clinic?.currency === 'USD') return 'US';
  if (clinic?.currency === 'GBP') return 'GB';
  if (clinic?.currency === 'CAD') return 'CA';
  if (clinic?.timezone === 'Europe/Berlin' || clinic?.defaultLanguage === 'de') return 'DE';
  if (clinic?.timezone === 'Europe/Paris' || clinic?.defaultLanguage === 'fr') return 'FR';
  if (clinic?.currency === 'EUR') return 'EU';
  return 'TR';
}

function defaultPreferencesForClinic(clinic?: ClinicDefaults): ClinicOperatingPreferences {
  const inferred = inferRegionPreset(clinic);
  const base = clonePreferences(REGION_DEFAULTS[inferred]);

  return {
    ...base,
    currency: currencySchema.safeParse(clinic?.currency).success ? (clinic!.currency as ClinicOperatingPreferences['currency']) : base.currency,
    timezone: timezoneSchema.safeParse(clinic?.timezone).success ? (clinic!.timezone as ClinicOperatingPreferences['timezone']) : base.timezone,
  };
}

export function normalizeClinicOperatingPreferences(
  raw: unknown,
  clinic?: ClinicDefaults,
): ClinicOperatingPreferences {
  const base = defaultPreferencesForClinic(clinic);
  const merged =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? { ...base, ...(raw as Partial<ClinicOperatingPreferences>) }
      : base;

  const parsed = clinicOperatingPreferencesSchema.safeParse(merged);
  return parsed.success ? parsed.data : base;
}

export async function getClinicOperatingPreferences(clinicId: string): Promise<ClinicOperatingPreferences> {
  const [clinic, setting] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { currency: true, timezone: true, defaultLanguage: true },
    }),
    prisma.setting.findUnique({
      where: {
        clinicId_key: {
          clinicId,
          key: CLINIC_OPERATING_PREFERENCES_KEY,
        },
      },
    }),
  ]);

  if (!setting) return defaultPreferencesForClinic(clinic ?? undefined);

  try {
    return normalizeClinicOperatingPreferences(JSON.parse(setting.value), clinic ?? undefined);
  } catch {
    return defaultPreferencesForClinic(clinic ?? undefined);
  }
}

export async function upsertClinicOperatingPreferences(
  clinicId: string,
  preferences: ClinicOperatingPreferences,
): Promise<ClinicOperatingPreferences> {
  const normalized = normalizeClinicOperatingPreferences(preferences);

  await prisma.$transaction([
    prisma.setting.upsert({
      where: {
        clinicId_key: {
          clinicId,
          key: CLINIC_OPERATING_PREFERENCES_KEY,
        },
      },
      create: {
        clinicId,
        key: CLINIC_OPERATING_PREFERENCES_KEY,
        value: JSON.stringify(normalized),
      },
      update: {
        value: JSON.stringify(normalized),
      },
    }),
    prisma.clinic.update({
      where: { id: clinicId },
      data: {
        currency: normalized.currency,
        timezone: normalized.timezone,
      },
    }),
  ]);

  return normalized;
}
