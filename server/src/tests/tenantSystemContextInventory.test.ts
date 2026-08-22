/**
 * tenantSystemContextInventory.test.ts — F3-2 system-execution inventory.
 *
 * `runAsSystem` is the guard's only exemption, so the question that decides
 * whether Layer 2 is real is not "does the guard work" but "who is exempt, and
 * did anyone check". This suite is that check, expressed as two enforced
 * inventories:
 *
 *   §A BACKGROUND WORK. AsyncLocalStorage does not cross a scheduler boundary:
 *      a cron callback starts a fresh async chain with no context, so under the
 *      guard every job would refuse every tenant-owned model — at 03:00, with
 *      nobody watching. Most jobs take a JobLock lease, so `withJobLock`
 *      establishes the context for all of them at one choke point. Three do
 *      not, for three different and legitimate reasons, and writing this suite
 *      is what found them: `fileBackupJob` takes its lease one level deeper
 *      (inside `runFileBackup`), while `recoveryStatusJob` and
 *      `clinicBulkExportWorker` are deliberately lock-free and had NO context
 *      at all until F3-2 gave them one. The exception list is held to exactly
 *      the files that are genuinely lock-free, each with a recorded reason.
 *
 *   §B THE FIVE UNRESOLVED MODELS. F3-1 classified `SecuritySignalEvent`,
 *      `SecurityIncident`, `SecurityIncidentActivity`, `MessagingInboundEvent`
 *      and `ExternalCalendarInboundEvent` as `EXPLICIT_REVIEW_REQUIRED`. The
 *      F3-2 decision is that all five are SYSTEM-OWNED (see the evidence
 *      document §F for the per-model reasoning, which is not the same reasoning
 *      for all five). A decision recorded only in prose is a decision that
 *      lasts until the next refactor, so every file that touches one of those
 *      models is enumerated here with the mechanism that supplies its context,
 *      and a new file touching one fails CI until it is classified.
 *
 * DATABASE-FREE: text scanning plus registry imports.
 *
 * Run with: tsx src/tests/tenantSystemContextInventory.test.ts
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TENANT_MODEL_CLASSIFICATION } from '../utils/tenantModelClassification.js';
import { SYSTEM_CONTEXT_REASONS, type SystemContextReason } from '../tenancy/tenantContext.js';

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

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '../..');
const REPO_ROOT = resolve(SERVER_ROOT, '..');
const SRC_ROOT = join(SERVER_ROOT, 'src');
const JOBS_ROOT = join(SRC_ROOT, 'jobs');

function repoRelative(absolutePath: string): string {
  return absolutePath.slice(REPO_ROOT.length + 1).split(sep).join('/');
}

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'tests') continue;
      listSourceFiles(full, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*');
}

/**
 * Whether a token appears in EXECUTABLE code, not merely in prose.
 *
 * This is not pedantry: the first version of this suite matched bare
 * `withJobLock` anywhere in the file, and recoveryStatusJob.ts — the one job
 * that deliberately does NOT take a lease — passed, because its doc comment
 * EXPLAINS that it does not take one. A scanner that reads comments as code
 * reports the exact opposite of the truth.
 */
function usesInCode(relative: string, pattern: RegExp): boolean {
  return read(relative)
    .split(String.fromCharCode(10))
    .filter((line) => !isCommentLine(line))
    .some((line) => pattern.test(line));
}

function read(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8').replace(/\r/g, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// §A — background jobs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Job files that do NOT take a JobLock lease, and therefore must establish
 * their own system context. Each needs a reason a reviewer can check.
 */
const JOB_FILES_WITHOUT_JOB_LOCK: Readonly<Record<string, string>> = Object.freeze({
  'startBackgroundJobs.ts':
    'Schedules the other jobs and performs no database work of its own; there is nothing to give a context to. ' +
    'This is the only entry here that does NOT need to declare a context.',
  'recoveryStatusJob.ts':
    'Deliberately lock-free — the status write is atomic (temp file + rename) and idempotent, so a lease ' +
    'would add a round trip to protect against a harmless outcome. It declares runAsSystem itself.',
  'clinicBulkExportWorker.ts':
    'Deliberately lock-free — a cluster-wide named lock would serialize every replica and defeat the ' +
    'multi-replica export throughput this worker exists for; non-overlap is process-local plus a guarded ' +
    'per-row claim. It declares runAsSystem itself.',
  'fileBackupJob.ts':
    'Takes its lease one level deeper: fileBackupService.runFileBackup() owns the withJobLock so that the ' +
    'cron tick and the manual admin route share one lock name. Re-wrapping here would double-acquire it. ' +
    'The system context therefore arrives through that inner withJobLock, so this file declares nothing.',
  'outboxDispatcherJob.ts':
    'F5-2. Deliberately lock-free for the same reason as clinicBulkExportWorker, only more so: a cluster-wide ' +
    'named lock would mean only ONE replica could ever drain the outbox, which is exactly what the ' +
    'FOR UPDATE SKIP LOCKED claim exists to avoid (F5-1P E16b measured four concurrent dispatchers, 60 ' +
    'claims, 60 distinct). Non-overlap is process-local; cross-replica correctness is the claim statement. ' +
    'It declares runAsSystem itself and narrows to runAsTenant per claimed row.',
});

/**
 * The subset of the above that must NEVER touch the database without declaring
 * a context in this very file. `fileBackupJob.ts` is excluded because its lease
 * — and so its context — is established inside `fileBackupService.ts`;
 * `startBackgroundJobs.ts` because it performs no database work at all.
 */
const LOCK_FREE_JOBS_THAT_MUST_DECLARE_THEIR_OWN: readonly string[] = Object.freeze([
  'recoveryStatusJob.ts',
  'clinicBulkExportWorker.ts',
  'outboxDispatcherJob.ts',
]);

// ─────────────────────────────────────────────────────────────────────────────
// §B — the five EXPLICIT_REVIEW_REQUIRED models
// ─────────────────────────────────────────────────────────────────────────────

type ContextMechanism = 'runAsSystem' | 'withJobLock';

interface ReviewModelAccessEntry {
  readonly file: string;
  readonly callSites: number;
  readonly mechanism: ContextMechanism;
  readonly reason: SystemContextReason;
  readonly justification: string;
}

/**
 * Every runtime file that touches one of the five unresolved models, with the
 * mechanism that supplies its system context. `callSites` is asserted against a
 * live scan, so adding an access to a listed file also fails until reviewed.
 */
const REVIEW_MODEL_ACCESS: readonly ReviewModelAccessEntry[] = Object.freeze([
  {
    file: 'server/src/jobs/dataRetentionCleanupJob.ts',
    callSites: 6,
    mechanism: 'withJobLock',
    reason: 'background-job',
    justification:
      'Retention sweep over MessagingInboundEvent and ExternalCalendarInboundEvent by age. It is ' +
      'cross-tenant by definition — the envelopes it deletes include ones whose tenant was never resolved.',
  },
  {
    file: 'server/src/jobs/externalCalendarInboundRetryJob.ts',
    callSites: 1,
    mechanism: 'withJobLock',
    reason: 'background-job',
    justification: 'Re-drives stuck calendar webhook envelopes across all connections.',
  },
  {
    file: 'server/src/jobs/inboundEventRetryJob.ts',
    callSites: 5,
    mechanism: 'withJobLock',
    reason: 'background-job',
    justification:
      'Re-drives stuck messaging webhook envelopes across all connections. F5-3 added two sweeps ' +
      '(retry-window-expired and unsupported-channel) that dead-letter events nothing would ever ' +
      'retry; both are cross-tenant by definition, exactly like the retry scan itself.',
  },
  {
    file: 'server/src/messaging/messagingInboundDlq.ts',
    callSites: 9,
    mechanism: 'runAsSystem',
    reason: 'inbound-webhook-envelope',
    justification:
      'F5-3 terminal-state transition, dead-letter inspection and platform metrics over the inbound ' +
      'ledger. Reuses the SAME reason messagingInboundIdempotency.ts already declares for this model ' +
      '— no new system reason. System execution is what lets the row be read at all; tenant safety ' +
      'comes from a REQUIRED organizationId predicate on every caller-facing function (the metrics ' +
      'snapshot is deliberately platform-wide, and exposes only status/channel/provider counts).',
  },
  {
    file: 'server/src/messaging/messagingInboundReplay.ts',
    callSites: 2,
    mechanism: 'runAsSystem',
    reason: 'inbound-webhook-envelope',
    justification:
      'F5-3 authorized replay of a terminal inbound event. Same reason as the ledger writer, for the ' +
      'same reason: the row may still have a null clinicId (routing never resolved). The caller must ' +
      'pass an already-authorized organization + clinic scope, which is applied as a predicate on ' +
      'the read and re-checked before any write.',
  },
  {
    file: 'server/src/services/externalCalendar/externalCalendarIdempotency.ts',
    callSites: 4,
    mechanism: 'runAsSystem',
    reason: 'inbound-webhook-envelope',
    justification:
      'Writes the raw calendar-provider envelope BEFORE the connection (and therefore the clinic) is ' +
      'resolved. Called only from public webhook routes, above the authenticate mount.',
  },
  {
    file: 'server/src/services/messagingInboundIdempotency.ts',
    callSites: 3,
    mechanism: 'runAsSystem',
    reason: 'inbound-webhook-envelope',
    justification:
      'Same pre-resolution envelope shape for WhatsApp/Instagram/Messenger inbound webhooks.',
  },
  {
    file: 'server/src/services/security/securityDetectionRules.ts',
    callSites: 2,
    mechanism: 'runAsSystem',
    reason: 'security-signal-recording',
    justification:
      'Counts DISTINCT resources/clinics in a signal window. The breadth IS the detection: a tenant ' +
      'predicate would force the answer to 1 and disable both rules.',
  },
  {
    file: 'server/src/services/security/securityIncidentService.ts',
    callSites: 24,
    mechanism: 'runAsSystem',
    reason: 'security-incident-lifecycle',
    justification:
      'The whole SecurityIncident/SecurityIncidentActivity lifecycle. Platform-admin-only, and a ' +
      'cross-tenant incident is a real state that no single-tenant predicate describes.',
  },
  {
    file: 'server/src/services/security/securitySignalService.ts',
    callSites: 2,
    mechanism: 'runAsSystem',
    reason: 'security-signal-recording',
    justification:
      'Records and counts SecuritySignalEvent. Fires from inside the very tenant request being denied, ' +
      'and the row is deliberately not owned by the organization that triggered it.',
  },
]);

const REVIEW_MODELS = ['SecuritySignalEvent', 'SecurityIncident', 'SecurityIncidentActivity', 'MessagingInboundEvent', 'ExternalCalendarInboundEvent'] as const;

/** `.securityIncidentActivity.create` must not be matched as `.securityIncident` + junk. */
function buildDelegatePattern(models: readonly string[]): RegExp {
  const delegates = models
    .map((m) => m.charAt(0).toLowerCase() + m.slice(1))
    .sort((a, b) => b.length - a.length);
  return new RegExp(`\\.(${delegates.join('|')})\\s*\\.\\s*\\w+`, 'g');
}

function scanReviewModelAccess(): Map<string, number> {
  const pattern = buildDelegatePattern(REVIEW_MODELS);
  const found = new Map<string, number>();
  for (const file of listSourceFiles(SRC_ROOT)) {
    const relative = repoRelative(file);
    const source = readFileSync(file, 'utf8').replace(/\r/g, '');
    let count = 0;
    for (const line of source.split('\n')) {
      if (isCommentLine(line)) continue;
      count += (line.match(pattern) ?? []).length;
    }
    if (count > 0) found.set(relative, count);
  }
  return found;
}

async function main() {
  // ── §A background jobs ─────────────────────────────────────────────────────
  section('A. Background jobs establish a system context');

  const jobFiles = readdirSync(JOBS_ROOT).filter((f) => f.endsWith('.ts'));

  await test('there are background job files to check (a broken listing would pass vacuously)', () => {
    assert.ok(jobFiles.length >= 10, `expected the full job set, found ${jobFiles.length}`);
  });

  await test('withJobLock is the single choke point, and it really does run fn as system', () => {
    const source = read('server/src/utils/jobLock.ts');
    assert.match(
      source,
      /runAsSystem\(\{\s*reason:\s*'background-job',\s*detail:\s*name\s*\},\s*fn\)/,
      'withJobLock must execute the job body inside runAsSystem — this one call covers 11 of the 13 database-touching jobs',
    );
  });

  await test('every job file either takes a JobLock lease or declares its own system context', () => {
    const undeclared: string[] = [];
    for (const file of jobFiles) {
      const relative = `server/src/jobs/${file}`;
      const usesLock = usesInCode(relative, /withJobLock\(/);
      const declaresOwn = usesInCode(relative, /runAsSystem\(/);
      const isKnownException = Object.prototype.hasOwnProperty.call(JOB_FILES_WITHOUT_JOB_LOCK, file);
      if (usesLock) continue;
      if (declaresOwn && isKnownException) continue;
      if (isKnownException && !LOCK_FREE_JOBS_THAT_MUST_DECLARE_THEIR_OWN.includes(file)) continue;
      undeclared.push(file);
    }
    assert.deepEqual(
      undeclared,
      [],
      'these job files run outside both mechanisms, so under the guard they would refuse every ' +
        `tenant-owned model at 03:00 with no one watching:\n  ${undeclared.join('\n  ')}`,
    );
  });

  await test('the lock-free exception list is exactly the files that are genuinely lock-free', () => {
    const actuallyLockFree = jobFiles.filter((f) => !usesInCode(`server/src/jobs/${f}`, /withJobLock\(/)).sort();
    assert.deepEqual(
      actuallyLockFree,
      Object.keys(JOB_FILES_WITHOUT_JOB_LOCK).sort(),
      'a job stopped (or started) using withJobLock; update the exception list with a recorded reason',
    );
  });

  await test('each lock-free job that touches the database declares its own system context', () => {
    for (const file of LOCK_FREE_JOBS_THAT_MUST_DECLARE_THEIR_OWN) {
      assert.ok(
        usesInCode(`server/src/jobs/${file}`, /runAsSystem\(\{\s*reason:\s*'background-job'/),
        `${file} takes no JobLock lease and declares no system context — under the guard it would ` +
          'refuse every tenant-owned model it touches',
      );
    }
  });

  await test('fileBackupJob’s context really does come from the lease inside fileBackupService', () => {
    // The one indirection in the inventory, asserted rather than asserted-in-prose:
    // if runFileBackup ever stops taking the lease, this job silently loses its context.
    assert.ok(
      usesInCode('server/src/services/fileBackupService.ts', /withJobLock\(/),
      'fileBackupJob relies on runFileBackup() taking the JobLock lease; it no longer does',
    );
  });

  await test('every recorded exception carries a reason a reviewer can check', () => {
    for (const [file, reason] of Object.entries(JOB_FILES_WITHOUT_JOB_LOCK)) {
      assert.ok(reason.trim().length >= 40, `${file}: exception reason is too thin to review`);
    }
  });

  // ── §B the five unresolved models ──────────────────────────────────────────
  section('B. The five EXPLICIT_REVIEW_REQUIRED models are system-owned everywhere');

  await test('the five models are still exactly the five (the F3-1 registry has not moved under us)', () => {
    const blocked = TENANT_MODEL_CLASSIFICATION
      .filter((e) => e.classification === 'EXPLICIT_REVIEW_REQUIRED')
      .map((e) => e.model)
      .sort();
    assert.deepEqual(blocked, [...REVIEW_MODELS].sort());
  });

  const scanned = scanReviewModelAccess();
  const declared = new Map(REVIEW_MODEL_ACCESS.map((e) => [e.file, e]));

  await test('the scanner finds the access sites (a broken pattern would report "all clear")', () => {
    assert.ok(scanned.size >= 6, `expected several files, found ${scanned.size}`);
  });

  await test('no runtime file touches one of the five models without a declared system context', () => {
    const missing = [...scanned.keys()].filter((f) => !declared.has(f)).sort();
    assert.deepEqual(
      missing,
      [],
      'these files access an EXPLICIT_REVIEW_REQUIRED model with no recorded execution context. ' +
        'Under the guard every one of these calls refuses; decide and record which mechanism ' +
        `supplies the context:\n  ${missing.join('\n  ')}`,
    );
  });

  await test('no declared entry is stale', () => {
    const stale = [...declared.keys()].filter((f) => !scanned.has(f)).sort();
    assert.deepEqual(stale, [], `these entries no longer access any of the five models:\n  ${stale.join('\n  ')}`);
  });

  await test('every declared call-site count matches the source exactly', () => {
    const drift: string[] = [];
    for (const entry of REVIEW_MODEL_ACCESS) {
      const actual = scanned.get(entry.file);
      if (actual !== undefined && actual !== entry.callSites) {
        drift.push(`${entry.file}: declared ${entry.callSites}, source has ${actual}`);
      }
    }
    assert.deepEqual(drift, [], `access-site counts drifted:\n  ${drift.join('\n  ')}`);
  });

  await test('each file really imports the mechanism it claims', () => {
    const wrong: string[] = [];
    for (const entry of REVIEW_MODEL_ACCESS) {
      const source = read(entry.file);
      if (!usesInCode(entry.file, new RegExp(`${entry.mechanism}\\(`))) {
        wrong.push(`${entry.file}: claims ${entry.mechanism} but does not use it`);
      }
      if (entry.mechanism === 'runAsSystem' && !source.includes(`'${entry.reason}'`)) {
        wrong.push(`${entry.file}: claims reason ${entry.reason} but never names it`);
      }
    }
    assert.deepEqual(wrong, []);
  });

  await test('every declared reason is a real member of the closed reason set', () => {
    for (const entry of REVIEW_MODEL_ACCESS) {
      assert.ok(SYSTEM_CONTEXT_REASONS.includes(entry.reason), `${entry.file}: unknown reason ${entry.reason}`);
    }
  });

  await test('every declared entry carries a justification specific to the model, not boilerplate', () => {
    const seen = new Set<string>();
    for (const entry of REVIEW_MODEL_ACCESS) {
      assert.ok(entry.justification.trim().length >= 60, `${entry.file}: justification too thin`);
      seen.add(entry.justification.trim());
    }
    assert.ok(seen.size >= 6, 'justifications look copy-pasted; the five models did NOT get one blanket answer');
  });

  await test('the decision did not quietly become "everything is a background job"', () => {
    const reasons = new Set(REVIEW_MODEL_ACCESS.map((e) => e.reason));
    assert.ok(
      reasons.size >= 3,
      'all five models under a single reason would mean the reason carries no information',
    );
  });

  // ── Loud reporting ─────────────────────────────────────────────────────────
  section('System-execution inventory (reported on every run)');
  console.log(`  Background job files:            ${jobFiles.length}`);
  console.log(`  ... calling withJobLock() directly: ${jobFiles.length - Object.keys(JOB_FILES_WITHOUT_JOB_LOCK).length}`);
  console.log(`  ... lock-free exceptions:           ${Object.keys(JOB_FILES_WITHOUT_JOB_LOCK).length}`);
  for (const file of Object.keys(JOB_FILES_WITHOUT_JOB_LOCK)) {
    const mechanism = LOCK_FREE_JOBS_THAT_MUST_DECLARE_THEIR_OWN.includes(file)
      ? 'declares runAsSystem itself'
      : file === 'fileBackupJob.ts'
        ? 'context arrives via runFileBackup()’s own lease'
        : 'performs no database work';
    console.log(`      ${file.padEnd(30)} ${mechanism}`);
  }
  console.log(`\n  Files touching the five EXPLICIT_REVIEW_REQUIRED models: ${REVIEW_MODEL_ACCESS.length}`);
  for (const entry of REVIEW_MODEL_ACCESS) {
    console.log(`    ${entry.file.padEnd(62)} ${String(entry.callSites).padStart(3)} sites  ${entry.mechanism} / ${entry.reason}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
