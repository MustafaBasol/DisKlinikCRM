/**
 * patientDetailTabsHelpers.ts — pure logic extracted from PatientDetail.tsx's
 * URL-backed active-tab derivation (KVKK-HIGH-008 F-2), so the
 * invalid/unauthorized/feature-disabled `?tab=` fallback behavior can be unit
 * tested without mounting the full page (which pulls in dozens of API calls).
 */

export const PATIENT_DETAIL_TAB_KEYS = [
  'overview', 'appointments', 'tasks', 'treatments', 'payments', 'insurance',
  'messages', 'files', 'imaging', 'dental', 'activity', 'privacy', 'communication',
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
