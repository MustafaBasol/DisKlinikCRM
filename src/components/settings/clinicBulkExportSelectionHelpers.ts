/**
 * clinicBulkExportSelectionHelpers.ts — KVKK-HIGH-004 (P0) pure explicit-
 * clinic-selection logic for ClinicBulkExportSection.tsx.
 *
 * Extracted so the "never silently select a clinic when the global
 * switcher is 'all'" invariant is testable without a DOM/React Testing
 * Library harness — this repo has none (see
 * src/pages/__tests__/bookingWidgetHelpers.test.ts for the established
 * pattern this file follows).
 */

export interface ClinicOption {
  id: string;
  name: string;
}

/**
 * Resolves the explicit clinic id the bulk-export section should use,
 * given the global clinic switcher's current value and the currently
 * held in-section selection.
 *
 * - The global switcher is adopted ONLY when it already names one
 *   specific, currently-accessible clinic — never when it is "all".
 * - If the global switcher does not name a usable clinic, a previously
 *   held in-section selection is kept UNLESS it has itself fallen out of
 *   the accessible list (e.g. the user's access changed), in which case
 *   it is cleared rather than left dangling.
 * - There is no path that returns a clinic id not present in
 *   `availableClinics` — the caller must never fall back to a
 *   default/first clinic itself.
 */
export function resolveExplicitClinicId(
  globalSelectedClinicId: string,
  availableClinics: ClinicOption[],
  currentClinicId: string,
): string {
  if (globalSelectedClinicId !== 'all' && availableClinics.some((c) => c.id === globalSelectedClinicId)) {
    return globalSelectedClinicId;
  }
  if (currentClinicId && !availableClinics.some((c) => c.id === currentClinicId)) {
    return '';
  }
  return currentClinicId;
}

/** True only when `clinicId` is non-empty AND present in the caller's own accessible-clinic list. */
export function isClinicSelectionValid(clinicId: string, availableClinics: ClinicOption[]): boolean {
  return clinicId !== '' && availableClinics.some((c) => c.id === clinicId);
}

/**
 * Every piece of transient/sensitive submission state that MUST be cleared
 * the moment the explicit clinic selection changes — password fields,
 * token/download state, the active job, the confirmation checkbox, and any
 * submit/download errors. Used both for the initial `useState` values and
 * for the reset performed on every clinic change, so the two can never
 * drift apart.
 */
export interface ClinicBulkExportResettableState {
  activeJobId: string | null;
  password: string;
  confirmChecked: boolean;
  downloadPassword: string;
  downloadError: string | null;
  submitError: string | null;
  purpose: string;
  restrictedNote: string;
  enabled: boolean | null;
  configError: string | null;
}

export function initialClinicBulkExportState(): ClinicBulkExportResettableState {
  return {
    activeJobId: null,
    password: '',
    confirmChecked: false,
    downloadPassword: '',
    downloadError: null,
    submitError: null,
    purpose: '',
    restrictedNote: '',
    enabled: null,
    configError: null,
  };
}

/**
 * KVKK-HIGH-004 remediation (P0): the single equality check every in-flight
 * create/token/download async operation in ClinicBulkExportSection.tsx runs
 * after every `await`, before touching any state or triggering a download.
 * `requestClinicId`/`requestEpoch` are captured by the caller at the moment
 * the operation started; `liveClinicId`/`liveEpoch` are read fresh (via refs
 * in the component, since a plain closure would be stale) at the point of
 * the check. A response is "still current" only when BOTH match — the
 * selection epoch is bumped on every explicit clinic change (or a selection
 * becoming invalid), so any mismatch means the user has since navigated
 * away from the clinic this response belongs to.
 *
 * Extracted as a pure function (no React, no refs) so the exact comparison
 * the component relies on is independently unit-testable — this repo has no
 * DOM/React Testing Library harness (see resolveExplicitClinicId above).
 */
export function isRequestStillCurrent(
  requestClinicId: string,
  requestEpoch: number,
  liveClinicId: string,
  liveEpoch: number,
): boolean {
  return requestClinicId === liveClinicId && requestEpoch === liveEpoch;
}
