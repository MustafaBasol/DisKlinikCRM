// One-shot guard for UX-001D's automatic last-route restore (see
// DashboardEntry in App.tsx): the restore must fire at most once per
// authenticated session, so a manual mid-session click on "Dashboard" never
// hijacks the user back to where they were before.
//
// Session boundary = login/logout, not page load. This module used to be a
// plain module-level flag inside App.tsx that was only ever set to `true`,
// never reset — since login/logout navigate client-side without a full page
// reload, that silently disabled restore for every login after the first in
// a browser tab (e.g. a shared reception-desk machine, or the same user
// re-logging in after a session timeout). Callers must invoke
// resetLastRouteRestoreGuard() when a session ends (auth: true -> false).
let attempted = false;

/**
 * Returns true the first time it's called for the current session, and
 * false on every call after that until the guard is reset.
 */
export function consumeLastRouteRestoreAttempt(): boolean {
  if (attempted) return false;
  attempted = true;
  return true;
}

export function resetLastRouteRestoreGuard(): void {
  attempted = false;
}
