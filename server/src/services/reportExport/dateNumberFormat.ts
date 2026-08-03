/**
 * dateNumberFormat.ts — maps this project's clinic date-format preference
 * (server/src/services/clinicOperatingPreferences.ts's `dateFormat` enum) to
 * an Excel `numFmt` string, so exported date/datetime cells display
 * consistently with the clinic's configured date-format preference rather
 * than a hardcoded locale.
 */

export type ClinicDateFormatPreference = 'dd.MM.yyyy' | 'MM/dd/yyyy' | 'dd/MM/yyyy' | 'yyyy-MM-dd';

const DATE_NUMFMT_BY_PREFERENCE: Record<ClinicDateFormatPreference, string> = {
  'dd.MM.yyyy': 'dd.mm.yyyy',
  'MM/dd/yyyy': 'mm/dd/yyyy',
  'dd/MM/yyyy': 'dd/mm/yyyy',
  'yyyy-MM-dd': 'yyyy-mm-dd',
};

const DEFAULT_DATE_NUMFMT = 'yyyy-mm-dd';

export function dateNumFmtFor(preference: string | null | undefined): string {
  return DATE_NUMFMT_BY_PREFERENCE[preference as ClinicDateFormatPreference] ?? DEFAULT_DATE_NUMFMT;
}

export function datetimeNumFmtFor(preference: string | null | undefined): string {
  return `${dateNumFmtFor(preference)} hh:mm`;
}
