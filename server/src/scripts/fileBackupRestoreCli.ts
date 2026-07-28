/**
 * fileBackupRestoreCli.ts — operator CLI for FILE-BACKUP-COVERAGE-001
 * restore/rehearsal.
 *
 * Two modes:
 *
 *   Restore one record to an inspection directory (never touches primary
 *   storage — output-dir must be outside the primary uploads/ tree, enforced
 *   by fileBackupService.ts's isSafeRestoreOutputDir):
 *
 *     cd server
 *     npx tsx src/scripts/fileBackupRestoreCli.ts restore \
 *       --model PatientAttachment --record <id> --out /tmp/restore-check
 *
 *   Automated restore rehearsal (samples N most-recently-verified backups,
 *   restores each to a disposable temp dir, verifies checksums, deletes the
 *   temp dir):
 *
 *     npx tsx src/scripts/fileBackupRestoreCli.ts rehearsal --sample 5
 *
 * See docs/program/evidence/FILE_BACKUP_COVERAGE_001.md for the full
 * restore procedure and production rollout plan.
 */

import 'dotenv/config';
import prisma from '../db.js';
import { restoreFileToPath, runFileBackupRestoreRehearsal } from '../services/fileBackupService.js';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (mode === 'restore') {
    const model = args.model;
    const record = args.record;
    const out = args.out;
    if (typeof model !== 'string' || typeof record !== 'string' || typeof out !== 'string') {
      console.error('Usage: fileBackupRestoreCli.ts restore --model <PatientAttachment|LabOrderAttachment|ImagingImage> --record <id> --out <dir>');
      process.exitCode = 1;
      return;
    }
    if (!['PatientAttachment', 'LabOrderAttachment', 'ImagingImage'].includes(model)) {
      console.error('--model must be one of PatientAttachment, LabOrderAttachment, ImagingImage');
      process.exitCode = 1;
      return;
    }
    const result = await restoreFileToPath({ sourceModel: model as any, sourceRecordId: record, outputDir: out });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.success && result.checksumMatch ? 0 : 1;
    return;
  }

  if (mode === 'rehearsal') {
    const sampleArg = args.sample;
    const sampleSize = typeof sampleArg === 'string' ? parseInt(sampleArg, 10) : undefined;
    const result = await runFileBackupRestoreRehearsal(Number.isFinite(sampleSize) ? sampleSize : undefined);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.success ? 0 : 1;
    return;
  }

  console.error('Usage: fileBackupRestoreCli.ts <restore|rehearsal> [options]');
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('[file-backup-restore-cli] Failed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
