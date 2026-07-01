/**
 * smsRouting.ts — Phone normalization and Turkey/Europe provider routing.
 *
 * Turkish numbers (+90) route to the clinic's Turkey provider, European
 * numbers to the Europe provider, everything else is 'unsupported' and the
 * send is blocked safely. Pure functions — unit-testable without a DB.
 */

export type SmsRegion = 'tr' | 'eu' | 'unsupported';

// European country dial codes (EU/EEA + UK/CH and nearby European states).
// Sorted longest-first at match time so e.g. +354 is not read as +35.
const EUROPE_DIAL_CODES = [
  '30', '31', '32', '33', '34', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49',
  '351', '352', '353', '354', '355', '356', '357', '358', '359',
  '370', '371', '372', '376', '377', '378', '380', '381', '382', '383', '385', '386', '387', '389',
  '420', '421', '423',
];

const TURKEY_DIAL_CODE = '90';

/**
 * Normalize a raw phone input to E.164-ish digits.
 * Accepts '+90 532...', '0090532...', '90532...', and Turkish local '0532...'
 * (a documented heuristic for the primary market). Returns null when the
 * input cannot be normalized to a plausible international number.
 */
export function normalizeSmsPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');

  if (!hasPlus && digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (!hasPlus && digits.length === 11 && digits.startsWith('05')) {
    // Turkish local mobile format 05XX XXX XX XX
    digits = `${TURKEY_DIAL_CODE}${digits.slice(1)}`;
  }

  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}

/** Decide the routing region from a normalized E.164 number. */
export function resolveSmsRegion(e164Phone: string): SmsRegion {
  const digits = e164Phone.replace(/\D/g, '');
  if (digits.startsWith(TURKEY_DIAL_CODE)) return 'tr';

  const sorted = [...EUROPE_DIAL_CODES].sort((a, b) => b.length - a.length);
  if (sorted.some(code => digits.startsWith(code))) return 'eu';

  return 'unsupported';
}
