/**
 * _clinicBulkExportCrashChild.ts — real child process used ONLY by the
 * hard-crash temp-file test in verify-clinic-bulk-export-lifecycle.ts
 * (KVKK-HIGH-004, docs/compliance/54-kvkk-secure-clinic-bulk-export.md).
 *
 * Not a script a human ever runs directly: the verify script spawns this as
 * a genuine separate OS process (`node --import tsx ...`), against a
 * database row it already claimed into 'generating', then SIGKILLs it once
 * this process's real ZIP temp file is observed on disk — proving the
 * parent's stale-temp sweep can recover from an actual, unclean process
 * death (no catch/finally in THIS process ever runs), not merely a
 * within-process simulated failure.
 *
 * Usage: node --import tsx scripts/_clinicBulkExportCrashChild.ts <jobId>
 * Requires the same DATABASE_URL / CLINIC_BULK_EXPORT_IP_HASH_SECRET env as
 * the parent verify script (inherited via child_process.spawn's `env`).
 */
import { generateClinicBulkExport } from '../src/services/privacy/clinicBulkExportPackage.js';

const jobId = process.argv[2];
if (!jobId) {
  console.error('usage: _clinicBulkExportCrashChild.ts <jobId>');
  process.exit(2);
}

generateClinicBulkExport(jobId)
  .then(() => {
    // Only reached if the parent never kills this process in time — signal
    // that clearly so the parent test can fail loudly instead of hanging.
    console.log('CRASH_CHILD_UNEXPECTED_COMPLETION');
    process.exit(0);
  })
  .catch((err) => {
    console.error('CRASH_CHILD_UNEXPECTED_ERROR', err);
    process.exit(1);
  });
