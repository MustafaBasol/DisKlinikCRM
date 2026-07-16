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
 */

export function isClinicBulkExportEnabled(): boolean {
  return process.env.CLINIC_BULK_EXPORT_ENABLED === 'true';
}

export function isClinicBulkExportCleanupEnabled(): boolean {
  return process.env.CLINIC_BULK_EXPORT_CLEANUP_ENABLED !== 'false';
}
