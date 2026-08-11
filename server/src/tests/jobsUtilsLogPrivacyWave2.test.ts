/**
 * jobsUtilsLogPrivacyWave2.test.ts — F3-IMPL-006 (PII/PHI Runtime Log Hygiene
 * Wave 2) regression tests for the `jobs/`, `middleware/`, and `utils/`
 * RAW_ERROR_REQUIRES_SAFE_ERROR_FIELDS sites that are NOT covered by a
 * dedicated runtime-spy test elsewhere (see
 * metaTemplateSyncJobLogPrivacy section in metaTemplateSyncJob.test.ts,
 * the data-retention runCategory section in dataRetentionCleanupJob.test.ts,
 * and jobLockAuditLogSafeErrorPrivacy.test.ts for jobLock.ts/auditLog.ts).
 *
 * Root cause (same as Wave 1 / F3-IMPL-004): each site below logged a raw
 * `err`/`error`/`err.message` (or an inline `err instanceof Error ?
 * err.message : String(err)`) argument that could echo PII/PHI/secret
 * content back from a Prisma write, a WhatsApp/Meta/DigiDentiS provider
 * call, or a filesystem/Redis operation whose inputs carry patient data,
 * message text, file paths, or connection details. The fix routes every
 * site through `safeErrorFields(err)` (or a `...safeErrorFields(err)`
 * spread for structured pino/console object args), matching the
 * already-merged Wave 1 pattern.
 *
 * A source scan (rather than a full runtime capture) is used for these
 * sites per this repo's documented convention for call sites that aren't
 * easily unit-testable in isolation — most are one-line console.error/warn
 * or logger.error calls buried inside `cron.schedule(...)` closures, inside
 * `withJobLock`'s process-local error handling around real Prisma/service
 * calls, or gated behind a live network/filesystem dependency (Redis
 * connection, node-cron) not available in this test environment (see
 * platformBackup.test.ts's "dropdb failure log privacy" section and
 * routeErrorLogPrivacy.test.ts for the established precedent).
 *
 * Run with: cd server && npx tsx src/tests/jobsUtilsLogPrivacyWave2.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

function readSource(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

/** Extracts the source text of a console.* / logger.* call by its distinguishing
 * literal (the log label string), from the console./logger. token through a
 * generous window past the closing paren. Mirrors
 * routeErrorLogPrivacy.test.ts's extractLogCallBlock. */
function extractLogCallBlock(
  source: string,
  distinguishingLiteral: string,
  windowSize = 260,
): string {
  const literalIndex = source.indexOf(distinguishingLiteral);
  assert.ok(literalIndex >= 0, `expected to find "${distinguishingLiteral}" in source`);
  const consoleStart = source.lastIndexOf('console.', literalIndex);
  const loggerStart = source.lastIndexOf('logger.', literalIndex);
  const callStart = Math.max(consoleStart, loggerStart);
  assert.ok(callStart >= 0, `expected a console.*/logger.* call before "${distinguishingLiteral}"`);
  return source.slice(callStart, callStart + windowSize);
}

function assertUsesSafeErrorFields(block: string, rawPatterns: RegExp[], label: string) {
  assert.ok(/safeErrorFields\(/.test(block), `[${label}] expected safeErrorFields(...) call in: ${block}`);
  for (const raw of rawPatterns) {
    assert.ok(!raw.test(block), `[${label}] found raw-error leak pattern ${raw} in: ${block}`);
  }
}

async function main() {
  // ── jobs/reminders.ts ──────────────────────────────────────────────────
  section('jobs/reminders.ts — WhatsApp send-failure and unhandled-job-error logs');

  const remindersSource = readSource('../jobs/reminders.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(remindersSource),
      'expected safeErrorFields import',
    );
  });

  await test('appointment reminder send-failure log uses safeErrorFields(sendErr), not raw sendErr.message', () => {
    const block = extractLogCallBlock(remindersSource, 'Failed to send appointment reminder to');
    assertUsesSafeErrorFields(block, [/\$\{sendErr\.message\}/, /sendErr\.message/], 'appointment reminder');
    assert.ok(/redactPhone\(patient\.phone\)/.test(block), 'expected redactPhone(...) masking to remain in place');
  });

  await test('practitioner schedule send-failure log uses safeErrorFields(sendErr), not raw sendErr.message', () => {
    const block = extractLogCallBlock(remindersSource, 'Failed to send practitioner schedule to');
    assertUsesSafeErrorFields(block, [/\$\{sendErr\.message\}/, /sendErr\.message/], 'practitioner schedule');
  });

  await test('payment reminder send-failure log uses safeErrorFields(sendErr), not raw sendErr.message', () => {
    const block = extractLogCallBlock(remindersSource, 'Failed to send payment reminder to');
    assertUsesSafeErrorFields(block, [/\$\{sendErr\.message\}/, /sendErr\.message/], 'payment reminder');
    assert.ok(/redactPhone\(patient\.phone\)/.test(block), 'expected redactPhone(...) masking to remain in place');
  });

  await test('per-clinic processing error log uses safeErrorFields(clinicErr), not raw clinicErr.message', () => {
    const block = extractLogCallBlock(remindersSource, 'Error processing clinic');
    assertUsesSafeErrorFields(block, [/\$\{clinicErr\.message\}/, /clinicErr\.message/], 'clinic processing');
  });

  await test('unhandled notification-reminder-job error log uses safeErrorFields(err), not raw err', () => {
    const block = extractLogCallBlock(remindersSource, 'Unhandled error in notification reminder job');
    assertUsesSafeErrorFields(block, [/,\s*err\s*\)/], 'notification reminder job');
  });

  await test('unhandled post-treatment-messaging-job error log uses safeErrorFields(err), not raw err', () => {
    const block = extractLogCallBlock(remindersSource, 'Unhandled error in post-treatment messaging job');
    assertUsesSafeErrorFields(block, [/,\s*err\s*\)/], 'post-treatment messaging job');
  });

  // ── jobs/publicBookingNoticeEvidenceCleanupJob.ts ─────────────────────
  section('jobs/publicBookingNoticeEvidenceCleanupJob.ts — cleanup-job unhandled error');

  const noticeEvidenceSource = readSource('../jobs/publicBookingNoticeEvidenceCleanupJob.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(noticeEvidenceSource),
      'expected safeErrorFields import',
    );
  });

  await test('unhandled cleanup error log uses safeErrorFields(err), not raw err.message', () => {
    const block = extractLogCallBlock(noticeEvidenceSource, '[notice-evidence-cleanup] Unhandled error');
    assertUsesSafeErrorFields(
      block,
      [/err instanceof Error \? err\.message/, /err\.message/],
      'notice-evidence-cleanup',
    );
  });

  // ── jobs/patientPrivacyExportCleanupJob.ts ────────────────────────────
  section('jobs/patientPrivacyExportCleanupJob.ts — export-archive cleanup unhandled error');

  const privacyExportSource = readSource('../jobs/patientPrivacyExportCleanupJob.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(privacyExportSource),
      'expected safeErrorFields import',
    );
  });

  await test('unhandled cleanup error log uses safeErrorFields(err), not raw err.message (export ZIP path/storage key risk)', () => {
    const block = extractLogCallBlock(privacyExportSource, '[privacy-export-cleanup] Unhandled error');
    assertUsesSafeErrorFields(
      block,
      [/err instanceof Error \? err\.message/, /err\.message/],
      'privacy-export-cleanup',
    );
  });

  // ── jobs/inboundEventRetryJob.ts ──────────────────────────────────────
  section('jobs/inboundEventRetryJob.ts — inbound WhatsApp event retry failure logs');

  const inboundRetrySource = readSource('../jobs/inboundEventRetryJob.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(inboundRetrySource),
      'expected safeErrorFields import',
    );
  });

  await test('per-event retry-failure log uses ...safeErrorFields(error), not raw error (inbound WhatsApp text/phone risk)', () => {
    const block = extractLogCallBlock(inboundRetrySource, 'Retry failed for event');
    assertUsesSafeErrorFields(block, [/eventId:\s*event\.id,\s*error\s*\}/], 'inbound-retry per-event');
  });

  await test('job-run-failed log uses safeErrorFields(error), not raw error', () => {
    const block = extractLogCallBlock(inboundRetrySource, 'Job run failed:');
    assertUsesSafeErrorFields(block, [/,\s*error\)/], 'inbound-retry job run');
  });

  // ── jobs/fileBackupJob.ts ─────────────────────────────────────────────
  section('jobs/fileBackupJob.ts — scheduled backup run failure log');

  const fileBackupJobSource = readSource('../jobs/fileBackupJob.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(fileBackupJobSource),
      'expected safeErrorFields import',
    );
  });

  await test('run-skipped-or-failed log uses safeErrorFields(err), not raw err.message (S3/local destination path risk)', () => {
    const block = extractLogCallBlock(fileBackupJobSource, 'Run skipped or failed');
    assertUsesSafeErrorFields(
      block,
      [/err instanceof Error \? err\.message/, /err\.message/],
      'file-backup run',
    );
  });

  // ── jobs/imagingBridgeOfflineJob.ts ───────────────────────────────────
  section('jobs/imagingBridgeOfflineJob.ts — offline-sweep job run failure log');

  const imagingBridgeSource = readSource('../jobs/imagingBridgeOfflineJob.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(imagingBridgeSource),
      'expected safeErrorFields import',
    );
  });

  await test('job-run-failed log uses safeErrorFields(error), not raw error', () => {
    const block = extractLogCallBlock(imagingBridgeSource, '[imaging-bridge-offline] Job run failed');
    assertUsesSafeErrorFields(block, [/,\s*error\)/], 'imaging-bridge-offline job run');
  });

  // ── jobs/externalCalendarInboundRetryJob.ts ───────────────────────────
  section('jobs/externalCalendarInboundRetryJob.ts — stuck-event recovery failure logs');

  const externalCalInboundSource = readSource('../jobs/externalCalendarInboundRetryJob.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(externalCalInboundSource),
      'expected safeErrorFields import',
    );
  });

  await test('per-event recovery-failure log uses ...safeErrorFields(error), not raw error (DigiDentiS patient-name/email/phone rawPayload risk)', () => {
    const block = extractLogCallBlock(externalCalInboundSource, 'Failed to recover event');
    assertUsesSafeErrorFields(block, [/eventId:\s*event\.id,\s*error\s*\}/], 'external-calendar-retry per-event');
  });

  await test('job-run-failed log uses safeErrorFields(error), not raw error', () => {
    const block = extractLogCallBlock(externalCalInboundSource, '[external-calendar-retry] Job run failed');
    assertUsesSafeErrorFields(block, [/,\s*error\)/], 'external-calendar-retry job run');
  });

  // ── jobs/clinicBulkExportWorker.ts ────────────────────────────────────
  section('jobs/clinicBulkExportWorker.ts — stale-temp sweep and tick failure logs');

  const clinicBulkWorkerSource = readSource('../jobs/clinicBulkExportWorker.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(clinicBulkWorkerSource),
      'expected safeErrorFields import',
    );
  });

  await test('stale-temp sweep failure log uses safeErrorFields(err), not raw err.message (temp export ZIP path risk)', () => {
    const block = extractLogCallBlock(clinicBulkWorkerSource, 'stale-temp sweep failed');
    assertUsesSafeErrorFields(
      block,
      [/err instanceof Error \? err\.message/, /err\.message/],
      'clinic-bulk-export-worker stale-temp sweep',
    );
  });

  await test('tick-failed log uses safeErrorFields(err), not raw err.message', () => {
    const block = extractLogCallBlock(clinicBulkWorkerSource, 'tick failed');
    assertUsesSafeErrorFields(
      block,
      [/err instanceof Error \? err\.message/, /err\.message/],
      'clinic-bulk-export-worker tick',
    );
  });

  // ── jobs/clinicBulkExportCleanupJob.ts ────────────────────────────────
  section('jobs/clinicBulkExportCleanupJob.ts — cleanup-sweep unhandled error');

  const clinicBulkCleanupSource = readSource('../jobs/clinicBulkExportCleanupJob.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(clinicBulkCleanupSource),
      'expected safeErrorFields import',
    );
  });

  await test('unhandled cleanup error log uses safeErrorFields(err), not raw err.message', () => {
    const block = extractLogCallBlock(clinicBulkCleanupSource, '[clinic-bulk-export-cleanup] Unhandled error');
    assertUsesSafeErrorFields(
      block,
      [/err instanceof Error \? err\.message/, /err\.message/],
      'clinic-bulk-export-cleanup',
    );
  });

  // ── jobs/externalCalendarOutboundSyncJob.ts (logger.* sites) ──────────
  section('jobs/externalCalendarOutboundSyncJob.ts — unexpected-retry and job-run-failed pino logs');

  const externalCalOutboundJobSource = readSource('../jobs/externalCalendarOutboundSyncJob.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(externalCalOutboundJobSource),
      'expected safeErrorFields import',
    );
  });

  await test('unexpected-error-retrying-sync-record log spreads ...safeErrorFields(error), not raw error', () => {
    const block = extractLogCallBlock(externalCalOutboundJobSource, 'unexpected error retrying sync record');
    assertUsesSafeErrorFields(block, [/linkId:\s*row\.id,\s*error\s*\}/], 'outbound-sync unexpected-error');
  });

  await test('job-run-failed pino log uses safeErrorFields(error), not raw { error }', () => {
    const block = extractLogCallBlock(externalCalOutboundJobSource, 'job run failed');
    assertUsesSafeErrorFields(block, [/\{\s*error\s*\}/], 'outbound-sync job run failed');
  });

  // ── jobs/dataRetentionCleanupJob.ts — cron-wrapped unhandled error ────
  section('jobs/dataRetentionCleanupJob.ts — scheduled-run unhandled error (cron-wrapped, not directly callable)');

  const dataRetentionSource = readSource('../jobs/dataRetentionCleanupJob.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(dataRetentionSource),
      'expected safeErrorFields import',
    );
  });

  await test('unhandled cleanup-job error log uses safeErrorFields(err), not raw err.message', () => {
    const block = extractLogCallBlock(dataRetentionSource, 'Unhandled error in cleanup job');
    assertUsesSafeErrorFields(
      block,
      [/\$\{msg\}/],
      'data-retention unhandled cleanup job',
    );
  });

  // ── jobs/metaTemplateSyncJob.ts — cron-wrapped unhandled error ────────
  section('jobs/metaTemplateSyncJob.ts — scheduled-run unhandled error (cron-wrapped, not directly callable)');

  const metaTemplateSyncSource = readSource('../jobs/metaTemplateSyncJob.ts');

  await test('unhandled-error log uses safeErrorFields(err), not a truncated raw err.message', () => {
    const block = extractLogCallBlock(metaTemplateSyncSource, '[meta-template-sync] unhandled-error');
    assertUsesSafeErrorFields(
      block,
      [/err instanceof Error \? err\.message/, /err\.message/],
      'meta-template-sync unhandled-error',
    );
  });

  // ── utils/redis.ts — connection-error log (real network I/O, not exercised at runtime here) ──
  section('utils/redis.ts — Redis connection-error log (static scan — requires a live/failing Redis connection)');

  const redisSource = readSource('../utils/redis.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\/safeError\.js['"]/.test(redisSource),
      'expected safeErrorFields import',
    );
  });

  await test('connection-error log uses safeErrorFields(err), not raw err?.message ?? err (may embed REDIS_URL host/credentials)', () => {
    const block = extractLogCallBlock(redisSource, '[redis] connection error');
    assertUsesSafeErrorFields(block, [/err\?\.message\s*\?\?\s*err/], 'redis connection error');
  });

  // ── utils/activity.ts — activity-log write failure (separate, unexported PrismaClient instance) ──
  section('utils/activity.ts — activity log write failure (static scan — module owns its own unexported PrismaClient)');

  const activitySource = readSource('../utils/activity.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\/safeError\.js['"]/.test(activitySource),
      'expected safeErrorFields import',
    );
  });

  await test('activity-log write-failure log uses safeErrorFields(error), not raw error (description embeds formatted patient names)', () => {
    const block = extractLogCallBlock(activitySource, 'Failed to log activity');
    assertUsesSafeErrorFields(block, [/,\s*error\)/], 'activity log write failure');
  });

  // ── safeErrorFields — shared helper sanity check (mirrors routeErrorLogPrivacy.test.ts) ──
  section('safeErrorFields — shared helper behavior');

  const { safeErrorFields } = await import('../utils/safeError.js');

  await test('drops a PHI-bearing description string and a WhatsApp phone/text fixture, keeps only name/code', () => {
    const phiFixture =
      'Argument `description` must not exceed 500 characters. Attempted data: ' +
      '{ description: "Otomatik randevu hatırlatması gönderildi: Ayşe Yılmaz (12.08.2026 14:30)", ' +
      'recipient: "905551234567" }';
    const err = Object.assign(new Error(phiFixture), { name: 'PrismaClientValidationError', code: 'P2009' });
    const fields = safeErrorFields(err);
    const serialized = JSON.stringify(fields);
    assert.equal(fields.errorName, 'PrismaClientValidationError');
    assert.equal(fields.errorCode, 'P2009');
    assert.ok(!serialized.includes('Ayşe Yılmaz'), 'formatted patient name leaked through safeErrorFields output');
    assert.ok(!serialized.includes('905551234567'), 'raw phone leaked through safeErrorFields output');
    assert.ok(!serialized.includes(phiFixture), 'raw message leaked through safeErrorFields output');
  });

  section('Summary');
  console.log('\n─────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
