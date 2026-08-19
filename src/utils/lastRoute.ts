/**
 * Session continuity (UX-001D): remembers the last in-app route a user
 * visited so reopening/re-authenticating can restore it, instead of always
 * dumping every user back on the generic dashboard.
 *
 * Storage holds ONLY a route path + query string, scoped by user id and
 * clinic id — never tokens, names, or any patient/record content. Restoring
 * a stored route always re-checks it against the user's CURRENT permissions
 * (backend authorization remains authoritative; this is just UX) and never
 * restores an entity detail route directly — those collapse to their parent
 * list route, which sidesteps needing a "does this record still exist"
 * network call and matches the required stale-route fallback behavior
 * (deleted patient -> Patients, deleted treatment -> Treatment list, etc.).
 */
import {
  canViewPatients,
  canViewAppointments,
  canViewPayments,
  canViewNoShowDashboard,
  canViewLabOrders,
  canViewImaging,
  canViewRecallDashboard,
  canViewWhatsAppInbox,
  canViewAppointmentRequests,
  canViewContactRequests,
  canManageUsers,
  canViewInstagramInbox,
  canViewFinanceDashboard,
  canViewReports,
  canManageInventory,
  canViewOrganizationDashboard,
  canViewBranches,
  canViewUsers,
  canViewOperations,
  normalizeRole,
} from './permissions';

type RouteUser = {
  role: string;
  canAccessAllClinics?: boolean;
  permissions?: Record<string, boolean | undefined>;
};

const STORAGE_PREFIX = 'hcrm_last_route';

// Entry points that never need restoring — they're the fallback target itself.
const NON_RESTORABLE_PATHS = new Set(['/', '/dashboard']);

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteCheck = (user: RouteUser) => boolean;

// Base path -> capability required to land there. Mirrors the checks
// MainLayout already uses to decide sidebar visibility for the same routes.
const UNSORTED_ROUTE_CHECKS: Array<[string, RouteCheck]> = [
  ['/organization/dashboard', canViewOrganizationDashboard],
  ['/patients', canViewPatients],
  ['/appointments', canViewAppointments],
  ['/treatment-cases', canViewPatients],
  ['/tasks', canViewPatients],
  ['/insurance-provisions', canViewPayments],
  ['/no-shows', canViewNoShowDashboard],
  ['/lab-orders', canViewLabOrders],
  ['/imaging', canViewImaging],
  ['/recall', canViewRecallDashboard],
  ['/whatsapp-inbox', canViewWhatsAppInbox],
  // UX-001 Wave 2: unified inbox shell — permitted if the user can see
  // either channel it wraps (mirrors Inbox.tsx's own redirect logic).
  ['/inbox', (u) => canViewWhatsAppInbox(u) || canViewInstagramInbox(u)],
  ['/appointment-requests', canViewAppointmentRequests],
  ['/contact-requests', canViewContactRequests],
  ['/messages', canViewPatients],
  ['/templates', (u: RouteUser) => canManageUsers(u) || normalizeRole(u.role, u.canAccessAllClinics) === 'RECEPTIONIST'],
  ['/instagram-inbox', canViewInstagramInbox],
  ['/finance', canViewFinanceDashboard],
  ['/payment-plans', canViewPayments],
  ['/payments', canViewPayments],
  ['/practitioner-earnings', canViewReports],
  ['/my-earnings', (u: RouteUser) => normalizeRole(u.role, u.canAccessAllClinics) === 'DENTIST'],
  ['/inventory', canManageInventory],
  ['/branches', canViewBranches],
  ['/users', canViewUsers],
  ['/operations', canViewOperations],
  ['/reports', canViewReports],
  ['/settings', () => true],
];

// Longest base path first, so e.g. '/payment-plans' is checked before '/payments'.
const ROUTE_CHECKS = [...UNSORTED_ROUTE_CHECKS].sort((a, b) => b[0].length - a[0].length);

function lastRouteStorageKey(userId: string, clinicId: string): string {
  return `${STORAGE_PREFIX}:${userId}:${clinicId}`;
}

/** Records the current in-app location for later restoration. Call on every route change inside the authenticated app shell. */
export function recordLastRoute(userId: string | undefined, clinicId: string, pathname: string, search: string): void {
  if (!userId || !pathname.startsWith('/')) return;
  if (NON_RESTORABLE_PATHS.has(pathname)) return;
  try {
    localStorage.setItem(lastRouteStorageKey(userId, clinicId), JSON.stringify({ path: pathname + (search || '') }));
  } catch {
    // Storage unavailable (private mode, quota, etc.) — continuity is best-effort.
  }
}

function stripTrailingId(pathname: string): string {
  const segments = pathname.split('/');
  const last = segments[segments.length - 1];
  if (last && UUID_SEGMENT.test(last)) {
    return segments.slice(0, -1).join('/') || '/';
  }
  return pathname;
}

function isAuthorizedBase(pathname: string, user: RouteUser): boolean {
  const match = ROUTE_CHECKS.find(([base]) => pathname === base || pathname.startsWith(`${base}/`));
  if (!match) return false; // unknown/unmapped route — don't restore into the unknown
  return match[1](user);
}

/**
 * Returns a validated route to restore, or null if there is none / it's no
 * longer valid for the current user. Never returns an entity detail URL —
 * stale detail routes collapse to their parent list route.
 */
export function getValidatedLastRoute(
  userId: string | undefined,
  clinicId: string,
  user: RouteUser | null | undefined,
): string | null {
  if (!userId || !user) return null;
  try {
    const raw = localStorage.getItem(lastRouteStorageKey(userId, clinicId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { path?: unknown };
    const full = typeof parsed.path === 'string' ? parsed.path : '';
    if (!full.startsWith('/')) return null;

    const [pathname, search = ''] = full.split(/(?=\?)/);
    const basePath = stripTrailingId(pathname);
    if (NON_RESTORABLE_PATHS.has(basePath)) return null;
    if (!isAuthorizedBase(basePath, user)) return null;

    // Only keep the query string when we didn't have to truncate a detail id off the path.
    return basePath === pathname ? basePath + search : basePath;
  } catch {
    return null;
  }
}
