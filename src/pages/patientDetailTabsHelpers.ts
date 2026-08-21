/**
 * patientDetailTabsHelpers.ts — pure logic extracted from PatientDetail.tsx's
 * URL-backed active-tab derivation (KVKK-HIGH-008 F-2), so the
 * invalid/unauthorized/feature-disabled `?tab=` fallback behavior can be unit
 * tested without mounting the full page (which pulls in dozens of API calls).
 */

export const PATIENT_DETAIL_TAB_KEYS = [
  'overview', 'appointments', 'tasks', 'treatments', 'payments', 'insurance',
  'messages', 'files', 'imaging', 'dental', 'activity', 'privacy', 'communication',
  'emergencyContacts',
] as const;
export type PatientDetailTab = (typeof PATIENT_DETAIL_TAB_KEYS)[number];

export const DEFAULT_PATIENT_DETAIL_TAB: PatientDetailTab = 'overview';

/**
 * Only `imaging` is filtered by role/feature today (canSeeImaging) — mirrors
 * the exact filter PatientDetail.tsx applies before this function ever sees
 * the list, so an unauthorized/feature-disabled tab is simply absent from
 * `visibleTabKeys`, never present-but-blocked.
 */
export function computeVisiblePatientDetailTabs(canSeeImaging: boolean): PatientDetailTab[] {
  return PATIENT_DETAIL_TAB_KEYS.filter((tab) => tab !== 'imaging' || canSeeImaging);
}

/**
 * US-01.X: tabs kept in the always-visible primary row. Chosen as the
 * day-to-day clinical/administrative workflow tabs (record overview,
 * scheduling, treatment, billing, documents); everything else collapses into
 * the "More" menu (see splitPatientDetailTabsForNav) so the primary row stays
 * short and scannable as further patient modules are added, instead of
 * growing into an ever-longer single row. Order matches
 * PATIENT_DETAIL_TAB_KEYS — this is a grouping, not a reordering.
 *
 * DENTAL-CHART-UX-001: `dental` joins the primary row. It had been grouped
 * with the low-frequency administrative tabs, but for a dental clinic the
 * chart is a per-visit tool that sits alongside treatments and appointments in
 * daily use — burying it one click deep in the More menu cost a click on the
 * single most-opened clinical screen. Because the split preserves
 * PATIENT_DETAIL_TAB_KEYS order rather than the order of this list, adding the
 * key here yields the row: Overview · Appointments · Treatments · Payments ·
 * Files · Dental Chart, with the chart last so no existing tab moves.
 */
export const PRIMARY_PATIENT_DETAIL_TAB_KEYS: readonly PatientDetailTab[] = [
  'overview', 'appointments', 'treatments', 'payments', 'files', 'dental',
];

/**
 * Splits the caller's already-visible tab list into the primary row and the
 * "More" menu group, preserving relative order within each group (no
 * reordering — see PRIMARY_PATIENT_DETAIL_TAB_KEYS). A tab absent from
 * `visibleTabKeys` (e.g. `imaging` for a non-clinical role) never appears in
 * either group.
 */
export function splitPatientDetailTabsForNav(
  visibleTabKeys: readonly PatientDetailTab[],
): { primary: PatientDetailTab[]; more: PatientDetailTab[] } {
  const primarySet = new Set<PatientDetailTab>(PRIMARY_PATIENT_DETAIL_TAB_KEYS);
  return {
    primary: visibleTabKeys.filter((tab) => primarySet.has(tab)),
    more: visibleTabKeys.filter((tab) => !primarySet.has(tab)),
  };
}

/**
 * Derives the active tab from a `?tab=` query value and the caller's visible
 * tab list. Missing (`null`) and invalid/unauthorized/feature-disabled values
 * both fall back to `overview` — the caller (PatientDetail.tsx) is
 * responsible for distinguishing the two cases when deciding whether to
 * rewrite the URL (only ever for the latter, via `replace`, never for a
 * simply-absent param — see requiresUrlNormalization below).
 */
export function resolvePatientDetailActiveTab(
  requestedTab: string | null,
  visibleTabKeys: readonly string[],
): PatientDetailTab {
  if (requestedTab && (visibleTabKeys as readonly string[]).includes(requestedTab)) {
    return requestedTab as PatientDetailTab;
  }
  return DEFAULT_PATIENT_DETAIL_TAB;
}

/**
 * True only when the URL actually needs to be rewritten: a `tab` param is
 * present but does not resolve to a visible tab. A simply-absent param must
 * never trigger a rewrite (old bookmarked/shared URLs with no `?tab=` keep
 * defaulting to Overview without ever being rewritten to `?tab=overview`).
 */
export function requiresUrlNormalization(requestedTab: string | null, visibleTabKeys: readonly string[]): boolean {
  return Boolean(requestedTab) && !(visibleTabKeys as readonly string[]).includes(requestedTab as string);
}

/**
 * US-01.2: true when the patient is under 18 as of `now`, given their date of
 * birth (string/Date, or null/undefined when unknown — treated as "not a
 * known minor" rather than guessing). Used only to drive the non-blocking
 * "no legal decision-maker on record" warning on the Emergency Contacts tab —
 * never for blocking patient creation or consent flows (out of scope here).
 */
export function isMinorPatient(dateOfBirth: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!dateOfBirth) return false;
  const dob = typeof dateOfBirth === 'string' ? new Date(dateOfBirth) : dateOfBirth;
  if (Number.isNaN(dob.getTime())) return false;
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age--;
  }
  return age < 18;
}
