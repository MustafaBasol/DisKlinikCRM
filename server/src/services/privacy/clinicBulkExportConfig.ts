/**
 * clinicBulkExportConfig.ts — KVKK-HIGH-004 feature flags.
 *
 * CLINIC_BULK_EXPORT_ENABLED gates creation of new export jobs. Fail-closed:
 * only the exact string 'true' enables it (mirrors
 * services/imaging/bridgeOnboardingConfig.ts's fail-closed idiom, not the
 * fail-open '!== "false"' idiom used by most background-job kill switches —
 * this is a security-sensitive feature, absent means off). Production ships
 * with this flag false; emergency disable is flipping it back and
 * redeploying/restarting (no runtime admin toggle in this PR).
 *
 * CLINIC_BULK_EXPORT_CLEANUP_ENABLED is a deliberately SEPARATE flag,
 * default ON, so expired artifacts/rows keep being swept even while
 * creation is disabled.
 *
 * CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS is an optional, server-
 * enforced tenant rollout allowlist: a comma-separated list of
 * organization ids. When unset/empty, every organization is treated as
 * allowed (subject to CLINIC_BULK_EXPORT_ENABLED still being 'true') — this
 * is what makes a global flip of CLINIC_BULK_EXPORT_ENABLED=true a
 * genuinely global enablement. When set, only the listed organizations may
 * create new export jobs; every other authorized (correct role,
 * correct clinic scope) organization gets the identical
 * CLINIC_BULK_EXPORT_DISABLED response an org gets when the flag itself is
 * off — the allowlist is a rollout control, not a new user-facing error
 * class, and never distinguishes "flag off" from "not on the allowlist" in
 * the response.
 */

export function isClinicBulkExportEnabled(): boolean {
  return process.env.CLINIC_BULK_EXPORT_ENABLED === 'true';
}

export function isClinicBulkExportCleanupEnabled(): boolean {
  return process.env.CLINIC_BULK_EXPORT_CLEANUP_ENABLED !== 'false';
}

/** `null` means no allowlist is configured — every organization is in scope. */
export function getClinicBulkExportAllowedOrganizationIds(): Set<string> | null {
  const raw = process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS;
  if (!raw || raw.trim().length === 0) return null;
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return ids.length > 0 ? new Set(ids) : null;
}

/**
 * The single decision every route must use to gate export-job CREATION
 * (config visibility and the create route itself) — combines the global
 * kill switch with the optional per-organization rollout allowlist so the
 * two can never be checked separately and drift apart.
 */
export function isClinicBulkExportEnabledForOrganization(organizationId: string): boolean {
  if (!isClinicBulkExportEnabled()) return false;
  const allowlist = getClinicBulkExportAllowedOrganizationIds();
  if (allowlist === null) return true;
  return allowlist.has(organizationId);
}
