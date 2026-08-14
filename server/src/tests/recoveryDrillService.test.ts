/**
 * recoveryDrillService.test.ts — F4-FCR-001 infra-free unit tests for the
 * recovery drill RPO/RTO evidence ledger.
 *
 * Run: cd server && npx tsx src/tests/recoveryDrillService.test.ts
 *
 * No database, no filesystem, no network. The Prisma `recoveryDrillRun`
 * delegate is replaced with an in-memory fake BEFORE the service module is
 * imported — the same mocked-Prisma convention already used by
 * externalCalendarOutboundSyncJob.test.ts.
 *
 * DELIBERATE ANTI-FLAKE DISCIPLINE (this suite must never fail on a slow CI
 * runner):
 *   - Every pure helper is tested with an INJECTED `now`, never the ambient
 *     clock, so age/duration arithmetic is exact and deterministic.
 *   - The two functions that must call the real clock internally
 *     (finishRecoveryDrill's durationMs, reapStaleRecoveryDrills' cutoff) are
 *     asserted as generous RANGES around a known lower bound, never as an
 *     equality against Date.now(). A runner that stalls for seconds between
 *     statements still passes; a genuinely wrong computation still fails.
 */

import assert from 'node:assert/strict';
import prisma from '../db.js';
// Type-only import: erased at runtime, so it does NOT execute the service
// module before the fake Prisma delegate below is installed.
import type { RecoveryDrillRunRow } from '../services/recoveryDrillService.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ─── In-memory fake of the RecoveryDrillRun Prisma delegate ─────────────────

type DrillRow = {
  id: string;
  kind: string;
  trigger: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  sourceArtifactAt: Date | null;
  sourceArtifactAgeMinutes: number | null;
  samplesAttempted: number;
  samplesPassed: number;
  samplesFailed: number;
  cleanupVerified: boolean;
  residualArtifact: string | null;
  errorCode: string | null;
  createdAt: Date;
};

let rows: DrillRow[] = [];
let seq = 0;

/** When set, every fake delegate call rejects — used to prove swallow-and-log. */
let forcedFailure: Error | null = null;

function resetStore() {
  rows = [];
  seq = 0;
  forcedFailure = null;
}

function guard() {
  if (forcedFailure) throw forcedFailure;
}

function makeRow(data: Record<string, unknown>): DrillRow {
  const now = new Date();
  return {
    id: `drill-${++seq}`,
    kind: String(data.kind ?? 'file_restore_rehearsal'),
    trigger: String(data.trigger ?? 'scheduled'),
    status: String(data.status ?? 'running'),
    startedAt: (data.startedAt as Date) ?? now,
    finishedAt: (data.finishedAt as Date | null) ?? null,
    durationMs: (data.durationMs as number | null) ?? null,
    sourceArtifactAt: (data.sourceArtifactAt as Date | null) ?? null,
    sourceArtifactAgeMinutes: (data.sourceArtifactAgeMinutes as number | null) ?? null,
    samplesAttempted: (data.samplesAttempted as number) ?? 0,
    samplesPassed: (data.samplesPassed as number) ?? 0,
    samplesFailed: (data.samplesFailed as number) ?? 0,
    cleanupVerified: (data.cleanupVerified as boolean) ?? false,
    residualArtifact: (data.residualArtifact as string | null) ?? null,
    errorCode: (data.errorCode as string | null) ?? null,
    createdAt: now,
  };
}

function matches(row: DrillRow, where: any): boolean {
  if (!where) return true;
  if (where.id !== undefined && row.id !== where.id) return false;
  if (typeof where.kind === 'string' && row.kind !== where.kind) return false;
  if (typeof where.status === 'string' && row.status !== where.status) return false;
  if (where.startedAt?.lt !== undefined && !(row.startedAt < where.startedAt.lt)) return false;
  if (where.residualArtifact?.not === null && row.residualArtifact === null) return false;
  return true;
}

function sortByStartedAtDesc(list: DrillRow[]): DrillRow[] {
  return [...list].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

(prisma as any).recoveryDrillRun = {
  async create({ data, select }: any) {
    guard();
    const row = makeRow(data);
    rows.push(row);
    return select?.id ? { id: row.id } : { ...row };
  },
  async findUnique({ where, select }: any) {
    guard();
    const row = rows.find((r) => r.id === where.id);
    if (!row) return null;
    return select?.startedAt ? { startedAt: row.startedAt } : { ...row };
  },
  async update({ where, data }: any) {
    guard();
    const row = rows.find((r) => r.id === where.id);
    if (!row) throw new Error('record not found');
    Object.assign(row, data);
    return { ...row };
  },
  async updateMany({ where, data }: any) {
    guard();
    let count = 0;
    for (const row of rows) {
      if (!matches(row, where)) continue;
      Object.assign(row, data);
      count++;
    }
    return { count };
  },
  async findFirst({ where }: any) {
    guard();
    const found = sortByStartedAtDesc(rows.filter((r) => matches(r, where)))[0];
    return found ? { ...found } : null;
  },
  async findMany({ where, take }: any) {
    guard();
    const found = sortByStartedAtDesc(rows.filter((r) => matches(r, where)));
    return (take ? found.slice(0, take) : found).map((r) => ({ ...r }));
  },
  async count({ where }: any) {
    guard();
    return rows.filter((r) => matches(r, where)).length;
  },
};

const svc = await import('../services/recoveryDrillService.js');

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function baseRow(overrides: Partial<RecoveryDrillRunRow> = {}): RecoveryDrillRunRow {
  return {
    id: 'row-1',
    kind: 'file_restore_rehearsal',
    trigger: 'scheduled',
    status: 'passed',
    startedAt: new Date('2026-08-14T00:00:00.000Z'),
    finishedAt: new Date('2026-08-14T00:03:20.000Z'),
    durationMs: 200_000,
    sourceArtifactAt: new Date('2026-08-13T21:00:00.000Z'),
    sourceArtifactAgeMinutes: 180,
    samplesAttempted: 6,
    samplesPassed: 6,
    samplesFailed: 0,
    cleanupVerified: true,
    residualArtifact: null,
    errorCode: null,
    ...overrides,
  };
}

async function main() {
  // ── Pure time arithmetic (frozen clock, exact assertions) ────────────────
  section('computeAgeMinutes / computeDurationMs — injected clock, exact');

  await test('computeAgeMinutes floors to whole minutes', () => {
    const now = new Date('2026-08-14T12:00:00.000Z');
    assert.equal(svc.computeAgeMinutes(new Date('2026-08-14T11:00:00.000Z'), now), 60);
    assert.equal(svc.computeAgeMinutes(new Date('2026-08-14T11:59:00.500Z'), now), 0);
    assert.equal(svc.computeAgeMinutes(new Date('2026-08-14T11:58:59.000Z'), now), 1);
  });

  await test('computeAgeMinutes returns null for missing/invalid input, 0 for a future timestamp', () => {
    const now = new Date('2026-08-14T12:00:00.000Z');
    assert.equal(svc.computeAgeMinutes(null, now), null);
    assert.equal(svc.computeAgeMinutes(undefined, now), null);
    assert.equal(svc.computeAgeMinutes(new Date('not-a-date'), now), null);
    // Clock skew must never produce a negative age.
    assert.equal(svc.computeAgeMinutes(new Date('2026-08-14T13:00:00.000Z'), now), 0);
  });

  await test('computeDurationMs is exact milliseconds and never negative', () => {
    const now = new Date('2026-08-14T12:00:10.250Z');
    assert.equal(svc.computeDurationMs(new Date('2026-08-14T12:00:00.000Z'), now), 10_250);
    assert.equal(svc.computeDurationMs(new Date('2026-08-14T12:00:20.000Z'), now), 0);
    assert.equal(svc.computeDurationMs(null, now), null);
  });

  // ── Summary mapping ──────────────────────────────────────────────────────
  section('toRecoveryDrillSummary — pure row mapping');

  await test('maps every field and derives ageMinutes from the injected clock', () => {
    const now = new Date('2026-08-14T02:00:00.000Z');
    const summary = svc.toRecoveryDrillSummary(baseRow(), now);
    assert.equal(summary.id, 'row-1');
    assert.equal(summary.kind, 'file_restore_rehearsal');
    assert.equal(summary.startedAt, '2026-08-14T00:00:00.000Z');
    assert.equal(summary.finishedAt, '2026-08-14T00:03:20.000Z');
    assert.equal(summary.durationMs, 200_000);
    assert.equal(summary.sourceArtifactAt, '2026-08-13T21:00:00.000Z');
    assert.equal(summary.sourceArtifactAgeMinutes, 180);
    assert.equal(summary.samplesAttempted, 6);
    assert.equal(summary.cleanupVerified, true);
    assert.equal(summary.residualArtifact, null);
    assert.equal(summary.ageMinutes, 120);
  });

  await test('a never-finished run maps finishedAt/durationMs to null, not to 0', () => {
    const now = new Date('2026-08-14T00:30:00.000Z');
    const summary = svc.toRecoveryDrillSummary(baseRow({ status: 'running', finishedAt: null, durationMs: null }), now);
    assert.equal(summary.finishedAt, null);
    assert.equal(summary.durationMs, null);
    assert.equal(summary.ageMinutes, 30);
  });

  // ── Staleness boundary ───────────────────────────────────────────────────
  section('isRecoveryDrillStale — threshold boundary');

  await test('EXACTLY at the threshold is NOT stale; one minute over IS stale', () => {
    const thresholdHours = 168;
    const thresholdMinutes = thresholdHours * 60; // 10080
    const now = new Date('2026-08-14T12:00:00.000Z');

    const exactlyAt = svc.toRecoveryDrillSummary(baseRow({ startedAt: new Date(now.getTime() - thresholdMinutes * MINUTE) }), now);
    assert.equal(exactlyAt.ageMinutes, thresholdMinutes);
    assert.equal(svc.isRecoveryDrillStale(exactlyAt, thresholdHours), false);

    const oneMinuteOver = svc.toRecoveryDrillSummary(baseRow({ startedAt: new Date(now.getTime() - (thresholdMinutes + 1) * MINUTE) }), now);
    assert.equal(oneMinuteOver.ageMinutes, thresholdMinutes + 1);
    assert.equal(svc.isRecoveryDrillStale(oneMinuteOver, thresholdHours), true);
  });

  await test('one minute UNDER the threshold is not stale, and "never drilled" (null) is stale', () => {
    const thresholdHours = 168;
    const now = new Date('2026-08-14T12:00:00.000Z');
    const oneMinuteUnder = svc.toRecoveryDrillSummary(baseRow({ startedAt: new Date(now.getTime() - (thresholdHours * 60 - 1) * MINUTE) }), now);
    assert.equal(svc.isRecoveryDrillStale(oneMinuteUnder, thresholdHours), false);
    // Silence must never read as success.
    assert.equal(svc.isRecoveryDrillStale(null, thresholdHours), true);
  });

  await test('getRecoveryDrillMaxAgeHours defaults to 168 and honours a valid override', () => {
    const original = process.env.RECOVERY_DRILL_MAX_AGE_HOURS;
    try {
      delete process.env.RECOVERY_DRILL_MAX_AGE_HOURS;
      assert.equal(svc.getRecoveryDrillMaxAgeHours(), 168);
      assert.equal(svc.getRecoveryDrillMaxAgeHours(), svc.DEFAULT_RECOVERY_DRILL_MAX_AGE_HOURS);
      process.env.RECOVERY_DRILL_MAX_AGE_HOURS = '24';
      assert.equal(svc.getRecoveryDrillMaxAgeHours(), 24);
      process.env.RECOVERY_DRILL_MAX_AGE_HOURS = 'not-a-number';
      assert.equal(svc.getRecoveryDrillMaxAgeHours(), 168);
      process.env.RECOVERY_DRILL_MAX_AGE_HOURS = '0';
      assert.equal(svc.getRecoveryDrillMaxAgeHours(), 168);
    } finally {
      if (original === undefined) delete process.env.RECOVERY_DRILL_MAX_AGE_HOURS;
      else process.env.RECOVERY_DRILL_MAX_AGE_HOURS = original;
    }
  });

  // ── Label sanitization (nothing unsafe reaches the ledger) ───────────────
  section('sanitizeDrillLabel — bounded, control-character-free persistence');

  await test('keeps a leaked temp database name intact (operators need it verbatim)', () => {
    const leaked = 'noramedi_restore_test_1723545600000_ab12cd34';
    assert.equal(svc.sanitizeDrillLabel(leaked), leaked);
  });

  await test('trims, drops empties, strips control characters, and clamps length', () => {
    assert.equal(svc.sanitizeDrillLabel('  padded  '), 'padded');
    assert.equal(svc.sanitizeDrillLabel(''), null);
    assert.equal(svc.sanitizeDrillLabel('   '), null);
    assert.equal(svc.sanitizeDrillLabel(null), null);
    assert.equal(svc.sanitizeDrillLabel(undefined), null);
    const withControls = `a${String.fromCharCode(10)}b${String.fromCharCode(0)}c`;
    assert.equal(svc.sanitizeDrillLabel(withControls), 'a b c');
    const long = 'x'.repeat(500);
    assert.equal(svc.sanitizeDrillLabel(long)?.length, 200);
  });

  // ── startRecoveryDrill ───────────────────────────────────────────────────
  section('startRecoveryDrill — opens the ledger row and measures the RPO window');

  await test('records sourceArtifactAgeMinutes from sourceArtifactAt at drill start', async () => {
    resetStore();
    const artifactAt = new Date(Date.now() - 3 * HOUR);
    const id = await svc.startRecoveryDrill({ kind: 'file_restore_rehearsal', trigger: 'scheduled', sourceArtifactAt: artifactAt });
    const row = rows.find((r) => r.id === id);
    assert.ok(row, 'row created');
    assert.equal(row!.status, 'running');
    assert.equal(row!.kind, 'file_restore_rehearsal');
    // 3h ago, allowing for arbitrarily slow execution between the two clock
    // reads (the value can only ever grow, never shrink, so a lower bound of
    // exactly 180 plus a wide upper bound is both tight and flake-proof).
    assert.ok(row!.sourceArtifactAgeMinutes !== null, 'age recorded');
    assert.ok(row!.sourceArtifactAgeMinutes! >= 180, `expected >=180, got ${row!.sourceArtifactAgeMinutes}`);
    assert.ok(row!.sourceArtifactAgeMinutes! <= 185, `expected <=185, got ${row!.sourceArtifactAgeMinutes}`);
  });

  await test('leaves sourceArtifactAt/AgeMinutes null when no artifact timestamp is known', async () => {
    resetStore();
    const id = await svc.startRecoveryDrill({ kind: 'db_restore_test', trigger: 'manual' });
    const row = rows.find((r) => r.id === id);
    assert.equal(row!.sourceArtifactAt, null);
    assert.equal(row!.sourceArtifactAgeMinutes, null);
    assert.equal(row!.trigger, 'manual');
  });

  await test('MAY throw: a ledger create failure propagates to the caller', async () => {
    resetStore();
    forcedFailure = new Error('db down');
    await assert.rejects(() => svc.startRecoveryDrill({ kind: 'db_restore_test', trigger: 'cli' }));
    resetStore();
  });

  // ── finishRecoveryDrill ──────────────────────────────────────────────────
  section('finishRecoveryDrill — closes the row and never throws');

  await test('stamps finishedAt and a durationMs measured from the row startedAt', async () => {
    resetStore();
    const id = await svc.startRecoveryDrill({ kind: 'file_restore_rehearsal', trigger: 'scheduled' });
    // Backdate the stored startedAt so a known minimum elapsed time exists
    // without the test ever sleeping.
    const row = rows.find((r) => r.id === id)!;
    row.startedAt = new Date(row.startedAt.getTime() - 5_000);

    await svc.finishRecoveryDrill({ id, status: 'passed', samplesAttempted: 4, samplesPassed: 4, samplesFailed: 0, cleanupVerified: true });

    assert.equal(row.status, 'passed');
    assert.ok(row.finishedAt instanceof Date, 'finishedAt stamped');
    assert.ok(row.durationMs !== null, 'durationMs computed');
    // Range, not equality: a stalled runner only makes this bigger.
    assert.ok(row.durationMs! >= 5_000, `expected >=5000ms, got ${row.durationMs}`);
    assert.ok(row.durationMs! < 5 * MINUTE, `expected a sane duration, got ${row.durationMs}`);
    assert.equal(row.samplesAttempted, 4);
    assert.equal(row.samplesPassed, 4);
    assert.equal(row.cleanupVerified, true);
  });

  await test('defaults counts to 0 and cleanupVerified to false when the caller omits them', async () => {
    resetStore();
    const id = await svc.startRecoveryDrill({ kind: 'db_restore_test', trigger: 'cli' });
    await svc.finishRecoveryDrill({ id, status: 'failed', errorCode: 'ENOENT' });
    const row = rows.find((r) => r.id === id)!;
    assert.equal(row.status, 'failed');
    assert.equal(row.samplesAttempted, 0);
    assert.equal(row.samplesPassed, 0);
    assert.equal(row.samplesFailed, 0);
    // "We never checked" must not be recorded as verified cleanup.
    assert.equal(row.cleanupVerified, false);
    assert.equal(row.errorCode, 'ENOENT');
  });

  await test('persists a residual temp-database label through sanitization', async () => {
    resetStore();
    const id = await svc.startRecoveryDrill({ kind: 'db_restore_test', trigger: 'scheduled' });
    await svc.finishRecoveryDrill({
      id,
      status: 'failed',
      cleanupVerified: false,
      residualArtifact: '  noramedi_restore_test_1723545600000_ab12cd34  ',
      errorCode: 'ECONNRESET',
    });
    const row = rows.find((r) => r.id === id)!;
    assert.equal(row.residualArtifact, 'noramedi_restore_test_1723545600000_ab12cd34');
    assert.equal(row.cleanupVerified, false);
  });

  await test('NEVER throws when the ledger read rejects', async () => {
    resetStore();
    const id = await svc.startRecoveryDrill({ kind: 'file_restore_rehearsal', trigger: 'scheduled' });
    forcedFailure = new Error('findUnique exploded');
    await svc.finishRecoveryDrill({ id, status: 'passed' }); // must resolve, not reject
    resetStore();
  });

  await test('NEVER throws when the ledger row no longer exists (update rejects)', async () => {
    resetStore();
    await svc.finishRecoveryDrill({ id: 'does-not-exist', status: 'failed', errorCode: 'gone' });
  });

  await test('NEVER throws for a rejected write even when a real drill passed', async () => {
    resetStore();
    const id = await svc.startRecoveryDrill({ kind: 'db_restore_test', trigger: 'manual' });
    forcedFailure = new Error('update exploded');
    let threw = false;
    try {
      await svc.finishRecoveryDrill({ id, status: 'passed', samplesAttempted: 1, samplesPassed: 1 });
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'a ledger write failure must never surface as a drill failure');
    resetStore();
  });

  // ── getRecoveryDrillStatus ───────────────────────────────────────────────
  section('getRecoveryDrillStatus — staleness, residuals, in-flight count');

  await test('reports both kinds stale when no drill has ever run', async () => {
    resetStore();
    const status = await svc.getRecoveryDrillStatus();
    assert.equal(status.lastDbRestoreTest, null);
    assert.equal(status.lastFileRestoreRehearsal, null);
    assert.equal(status.dbRestoreTestStale, true);
    assert.equal(status.fileRestoreRehearsalStale, true);
    assert.equal(status.runningDrills, 0);
    assert.deepEqual(status.residualArtifacts, []);
  });

  await test('reports a fresh drill as not stale and an old one of the other kind as stale', async () => {
    resetStore();
    const original = process.env.RECOVERY_DRILL_MAX_AGE_HOURS;
    try {
      process.env.RECOVERY_DRILL_MAX_AGE_HOURS = '168';
      rows.push(makeRow({ kind: 'file_restore_rehearsal', status: 'passed', startedAt: new Date(Date.now() - 2 * HOUR) }));
      rows.push(makeRow({ kind: 'db_restore_test', status: 'passed', startedAt: new Date(Date.now() - 200 * HOUR) }));

      const status = await svc.getRecoveryDrillStatus();
      assert.equal(status.staleThresholdHours, 168);
      assert.equal(status.fileRestoreRehearsalStale, false);
      assert.equal(status.dbRestoreTestStale, true);
      assert.equal(status.lastFileRestoreRehearsal?.kind, 'file_restore_rehearsal');
      assert.equal(status.lastDbRestoreTest?.kind, 'db_restore_test');
    } finally {
      if (original === undefined) delete process.env.RECOVERY_DRILL_MAX_AGE_HOURS;
      else process.env.RECOVERY_DRILL_MAX_AGE_HOURS = original;
    }
  });

  await test('surfaces residual artifacts and counts running drills', async () => {
    resetStore();
    rows.push(makeRow({ kind: 'db_restore_test', status: 'failed', residualArtifact: 'noramedi_restore_test_1_leaked' }));
    rows.push(makeRow({ kind: 'file_restore_rehearsal', status: 'passed', residualArtifact: null }));
    rows.push(makeRow({ kind: 'file_restore_rehearsal', status: 'running' }));

    const status = await svc.getRecoveryDrillStatus();
    assert.equal(status.residualArtifacts.length, 1);
    assert.equal(status.residualArtifacts[0]!.residualArtifact, 'noramedi_restore_test_1_leaked');
    assert.equal(status.runningDrills, 1);
  });

  // ── reapStaleRecoveryDrills ──────────────────────────────────────────────
  section('reapStaleRecoveryDrills — crash-recovery reaper');

  await test('sweeps a long-running row to failed/drill_abandoned and leaves fresh ones alone', async () => {
    resetStore();
    const abandoned = makeRow({ kind: 'db_restore_test', status: 'running', startedAt: new Date(Date.now() - 4 * HOUR) });
    const inFlight = makeRow({ kind: 'file_restore_rehearsal', status: 'running', startedAt: new Date(Date.now() - 5 * MINUTE) });
    const alreadyDone = makeRow({ kind: 'db_restore_test', status: 'passed', startedAt: new Date(Date.now() - 9 * HOUR) });
    rows.push(abandoned, inFlight, alreadyDone);

    const count = await svc.reapStaleRecoveryDrills();
    assert.equal(count, 1);
    assert.equal(abandoned.status, 'failed');
    assert.equal(abandoned.errorCode, svc.RECOVERY_DRILL_ABANDONED_ERROR_CODE);
    assert.equal(abandoned.errorCode, 'drill_abandoned');
    assert.ok(abandoned.finishedAt instanceof Date, 'reaped row gets a finishedAt');
    // No observer measured this run, so there is no honest RTO to record.
    assert.equal(abandoned.durationMs, null);
    assert.equal(inFlight.status, 'running', 'a genuinely in-flight drill must not be reaped');
    assert.equal(alreadyDone.status, 'passed', 'a terminal row must not be touched');
  });

  await test('honours an explicit maxRunningMinutes and falls back to 180 for invalid input', async () => {
    resetStore();
    const tenMinutesOld = makeRow({ kind: 'db_restore_test', status: 'running', startedAt: new Date(Date.now() - 10 * MINUTE) });
    rows.push(tenMinutesOld);
    assert.equal(await svc.reapStaleRecoveryDrills(5), 1);
    assert.equal(tenMinutesOld.status, 'failed');

    resetStore();
    const twoHoursOld = makeRow({ kind: 'db_restore_test', status: 'running', startedAt: new Date(Date.now() - 2 * HOUR) });
    rows.push(twoHoursOld);
    // Invalid input falls back to the 180-minute default, which 2h does not exceed.
    assert.equal(await svc.reapStaleRecoveryDrills(Number.NaN), 0);
    assert.equal(twoHoursOld.status, 'running');
    assert.equal(svc.DEFAULT_RECOVERY_DRILL_MAX_RUNNING_MINUTES, 180);
  });

  await test('NEVER throws and reports 0 when the reaper write rejects', async () => {
    resetStore();
    forcedFailure = new Error('updateMany exploded');
    const count = await svc.reapStaleRecoveryDrills();
    assert.equal(count, 0);
    resetStore();
  });

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`recoveryDrillService: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

main()
  .then((ok) => {
    process.exitCode = ok ? 0 : 1;
  })
  .catch((err) => {
    console.error('[recovery-drill-service-test] Fatal:', err);
    process.exitCode = 1;
  });
