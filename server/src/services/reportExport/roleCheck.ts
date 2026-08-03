/**
 * roleCheck.ts — mirrors middleware/auth.ts's authorize() role-check logic
 * exactly, for use OUTSIDE the static Express middleware factory pattern.
 *
 * The export route's allowed-role set is data-driven (looked up from the
 * requested report's definition at request time), so it cannot be wired as
 * a fixed `authorize([...])` array at router-registration time the way every
 * other route in this codebase is. This performs the identical
 * canonical-role-or-raw-role check so the export path never grants access
 * authorize() would have denied for the same report (and vice versa).
 */

import { normalizeRole } from '../../utils/roles.js';

export function isRoleAllowedForReport(
  user: { role: string; canAccessAllClinics: boolean },
  allowedRoles: string[],
): boolean {
  const normalizedList = allowedRoles.map((r) => r.toLowerCase());
  const canonicalRole = normalizeRole(user.role, user.canAccessAllClinics).toLowerCase();
  const rawRole = user.role.toLowerCase();
  return normalizedList.includes(canonicalRole) || normalizedList.includes(rawRole);
}
