/**
 * recoveryDrillService.ts — the durable RPO/RTO evidence ledger for recovery
 * drills (F4-FCR-001).
 *
 * Before this module, a restore test proved "restore works" only in a console
 * line that scrolled away. Nothing in the system could answer the two
 * questions a first paying customer's data-loss conversation actually turns
 * on:
 *
 *   - RTO: how long did the last successful recovery take?  → `durationMs`
 *   - RPO: how old was the artifact it recovered from?      → `sourceArtifactAgeMinutes`
 *
 * ...nor the two follow-ups an auditor asks next: when was the last drill run
 * at all (staleness), and did the drill clean up its own scratch artifacts
 * (`cleanupVerified` / `residualArtifact`).
 *
 * DESIGN RULES THIS MODULE FOLLOWS:
 *
 *  - The ledger must never break a drill. `finishRecoveryDrill()` and
 *    `reapStaleRecoveryDrills()` swallow-and-log via `safeErrorFields()`,
 *    mirroring `recordOperationalEvent()`'s discipline: a failure to WRITE
 *    evidence is not allowed to turn a successful (or failing) recovery
 *    exercise into a crash. `startRecoveryDrill()` is the one exception — it
 *    MAY throw, because without a row id there is nothing to finish and the
 *    caller should know before it spends minutes restoring.
 *  - Nothing persisted or logged here may carry PHI, a clinic id, a file
 *    name, a storage key, an absolute path, or a raw error message. Free-text
 *    inputs (`residualArtifact`, `errorCode`) are length-clamped and stripped
 *    of control characters before they reach the database.
 *  - All time arithmetic goes through the pure, `now`-injectable helpers at
 *    the top of this file, so tests never have to race a real clock.
 */

import prisma from '../db.js';
import { safeErrorFields } from '../utils/safeError.js';

export type RecoveryDrillKind = 'db_restore_test' | 'file_restore_rehearsal';
export type RecoveryDrillTrigger = 'scheduled' | 'manual' | 'cli';

/** Default staleness threshold when RECOVERY_DRILL_MAX_AGE_HOURS is unset: 7 days. */
export const DEFAULT_RECOVERY_DRILL_MAX_AGE_HOURS = 168;

/** Default reaper cutoff: a drill still `running` after 3 hours is abandoned. */
export const DEFAULT_RECOVERY_DRILL_MAX_RUNNING_MINUTES = 180;

/** Fixed, non-sensitive label written by the crash-recovery reaper. */
export const RECOVERY_DRILL_ABANDONED_ERROR_CODE = 'drill_abandoned';

/** Upper bound on any operator-facing free-text field persisted by this module. */
const MAX_LABEL_LENGTH = 200;

export interface RecoveryDrillSummary {
  id: string;
  kind: RecoveryDrillKind;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  sourceArtifactAt: string | null;
  sourceArtifactAgeMinutes: number | null;
  samplesAttempted: number;
  samplesPassed: number;
  samplesFailed: number;
  cleanupVerified: boolean;
  residualArtifact: string | null;
  errorCode: string | null;
  /** now - startedAt, in whole minutes. Null only if startedAt is unusable. */
  ageMinutes: number | null;
}

/**
 * The subset of a RecoveryDrillRun row this module maps to a summary. Declared
 * structurally (not as the generated Prisma row type) so the pure mapper below
 * can be unit-tested with a plain object literal and no database at all.
 */
export interface RecoveryDrillRunRow {
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
}

// ─── Pure helpers (no DB, no ambient clock) ─────────────────────────────────
//
// Every one of these takes `now` explicitly (defaulted for production callers)
// so tests can freeze time instead of asserting against a real clock and
// flaking on a slow CI runner.

/**
 * Whole minutes elapsed from `from` to `now`, floored, never negative. Returns
 * null for a missing or unusable timestamp so "we do not know" stays
 * distinguishable from "zero minutes old".
 */
export function computeAgeMinutes(from: Date | null | undefined, now: Date = new Date()): number | null {
  if (!(from instanceof Date) || Number.isNaN(from.getTime())) return null;
  const deltaMs = now.getTime() - from.getTime();
  if (!Number.isFinite(deltaMs)) return null;
  return Math.max(0, Math.floor(deltaMs / 60_000));
}

/** Elapsed milliseconds from `from` to `now`, floored at 0. Null if unusable. */
export function computeDurationMs(from: Date | null | undefined, now: Date = new Date()): number | null {
  if (!(from instanceof Date) || Number.isNaN(from.getTime())) return null;
  const deltaMs = now.getTime() - from.getTime();
  if (!Number.isFinite(deltaMs)) return null;
  return Math.max(0, Math.round(deltaMs));
}

/** RECOVERY_DRILL_MAX_AGE_HOURS, or the 7-day default when unset/invalid. */
export function getRecoveryDrillMaxAgeHours(): number {
  const raw = Number(process.env.RECOVERY_DRILL_MAX_AGE_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RECOVERY_DRILL_MAX_AGE_HOURS;
}

/**
 * A drill is stale when it has never run at all, or when its age has passed
 * the threshold. Deliberately strict (`>`): a drill sitting EXACTLY at the
 * threshold is still considered fresh, so a weekly drill measured a hair over
 * a nominal week does not flap the alert on and off.
 */
export function isRecoveryDrillStale(summary: RecoveryDrillSummary | null, thresholdHours: number): boolean {
  if (!summary) return true;
  if (summary.ageMinutes === null) return true;
  return summary.ageMinutes > thresholdHours * 60;
}

/**
 * Replaces C0/C7F control characters with a space. Written with explicit code
 * point comparisons rather than a character-class regex on purpose: a regex
 * literal for this range has to embed raw control bytes (or escapes that
 * editors and formatters love to rewrite) directly into the source file.
 */
function stripControlCharacters(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return out;
}

/**
 * Clamps an operator-facing label to something safe to persist: trimmed,
 * control characters removed, bounded length. Returns null for empty input so
 * "" never masquerades as a real residual artifact.
 */
export function sanitizeDrillLabel(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = stripControlCharacters(value).trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_LABEL_LENGTH);
}

/** Pure row → API summary mapper. Dates become ISO strings for JSON-safety. */
export function toRecoveryDrillSummary(row: RecoveryDrillRunRow, now: Date = new Date()): RecoveryDrillSummary {
  return {
    id: row.id,
    kind: row.kind as RecoveryDrillKind,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    durationMs: row.durationMs,
    sourceArtifactAt: row.sourceArtifactAt ? row.sourceArtifactAt.toISOString() : null,
    sourceArtifactAgeMinutes: row.sourceArtifactAgeMinutes,
    samplesAttempted: row.samplesAttempted,
    samplesPassed: row.samplesPassed,
    samplesFailed: row.samplesFailed,
    cleanupVerified: row.cleanupVerified,
    residualArtifact: row.residualArtifact,
    errorCode: row.errorCode,
    ageMinutes: computeAgeMinutes(row.startedAt, now),
  };
}

// ─── Ledger writes ──────────────────────────────────────────────────────────

/**
 * Opens a drill ledger row and returns its id. MAY throw: without an id there
 * is nothing to finish, and the caller is better off learning that before it
 * spends minutes restoring than discovering afterwards that the evidence was
 * never recorded.
 *
 * `sourceArtifactAgeMinutes` is computed here, at drill START, on purpose:
 * that is the moment the RPO window is actually measured — the age of the
 * newest artifact recovery would have had to fall back on.
 */
export async function startRecoveryDrill(input: {
  kind: RecoveryDrillKind;
  trigger: RecoveryDrillTrigger;
  sourceArtifactAt?: Date | null;
}): Promise<string> {
  const now = new Date();
  const sourceArtifactAt =
    input.sourceArtifactAt instanceof Date && !Number.isNaN(input.sourceArtifactAt.getTime()) ? input.sourceArtifactAt : null;

  const row = await prisma.recoveryDrillRun.create({
    data: {
      kind: input.kind,
      trigger: input.trigger,
      status: 'running',
      startedAt: now,
      sourceArtifactAt,
      sourceArtifactAgeMinutes: computeAgeMinutes(sourceArtifactAt, now),
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Closes a drill ledger row: stamps `finishedAt = now` and
 * `durationMs = now - startedAt` (the drill's measured RTO).
 *
 * NEVER throws. A ledger write failure is logged with safeErrorFields() and
 * swallowed — exactly the discipline recordOperationalEvent() uses — because
 * a drill that actually succeeded must not be reported as a crash just
 * because its evidence row could not be updated.
 */
export async function finishRecoveryDrill(input: {
  id: string;
  status: 'passed' | 'failed';
  samplesAttempted?: number;
  samplesPassed?: number;
  samplesFailed?: number;
  cleanupVerified?: boolean;
  residualArtifact?: string | null;
  errorCode?: string | null;
}): Promise<void> {
  try {
    const now = new Date();
    const existing = await prisma.recoveryDrillRun.findUnique({
      where: { id: input.id },
      select: { startedAt: true },
    });

    await prisma.recoveryDrillRun.update({
      where: { id: input.id },
      data: {
        status: input.status,
        finishedAt: now,
        durationMs: existing ? computeDurationMs(existing.startedAt, now) : null,
        samplesAttempted: input.samplesAttempted ?? 0,
        samplesPassed: input.samplesPassed ?? 0,
        samplesFailed: input.samplesFailed ?? 0,
        cleanupVerified: input.cleanupVerified ?? false,
        residualArtifact: sanitizeDrillLabel(input.residualArtifact),
        errorCode: sanitizeDrillLabel(input.errorCode),
      },
    });
  } catch (err) {
    console.error('[recovery-drill] Failed to finalize drill ledger row:', safeErrorFields(err));
  }
}

// ─── Status / monitoring ────────────────────────────────────────────────────

export async function getRecoveryDrillStatus(): Promise<{
  lastDbRestoreTest: RecoveryDrillSummary | null;
  lastFileRestoreRehearsal: RecoveryDrillSummary | null;
  staleThresholdHours: number;
  dbRestoreTestStale: boolean;
  fileRestoreRehearsalStale: boolean;
  residualArtifacts: RecoveryDrillSummary[];
  runningDrills: number;
}> {
  const now = new Date();
  const staleThresholdHours = getRecoveryDrillMaxAgeHours();

  const [dbRow, fileRow, residualRows, runningDrills] = await Promise.all([
    prisma.recoveryDrillRun.findFirst({ where: { kind: 'db_restore_test' }, orderBy: { startedAt: 'desc' } }),
    prisma.recoveryDrillRun.findFirst({ where: { kind: 'file_restore_rehearsal' }, orderBy: { startedAt: 'desc' } }),
    prisma.recoveryDrillRun.findMany({ where: { residualArtifact: { not: null } }, orderBy: { startedAt: 'desc' }, take: 20 }),
    prisma.recoveryDrillRun.count({ where: { status: 'running' } }),
  ]);

  const lastDbRestoreTest = dbRow ? toRecoveryDrillSummary(dbRow, now) : null;
  const lastFileRestoreRehearsal = fileRow ? toRecoveryDrillSummary(fileRow, now) : null;

  return {
    lastDbRestoreTest,
    lastFileRestoreRehearsal,
    staleThresholdHours,
    // "Never drilled" is reported as stale, not as absent: the whole point of
    // this ledger is that silence must never read as success.
    dbRestoreTestStale: isRecoveryDrillStale(lastDbRestoreTest, staleThresholdHours),
    fileRestoreRehearsalStale: isRecoveryDrillStale(lastFileRestoreRehearsal, staleThresholdHours),
    residualArtifacts: residualRows.map((row) => toRecoveryDrillSummary(row, now)),
    runningDrills,
  };
}

/**
 * Crash-recovery reaper: a process that dies mid-drill leaves its row stuck in
 * `running` forever, which silently poisons both `runningDrills` and any
 * "is a drill in flight" check. This sweeps rows that started longer than
 * `maxRunningMinutes` ago to `failed` / `drill_abandoned` and returns how many
 * it swept.
 *
 * `durationMs` is deliberately left null on a reaped row: nobody observed the
 * drill finish, so there is no honest RTO measurement to record — the null is
 * itself the signal that this run produced no timing evidence.
 *
 * Never throws (returns 0 on failure) — it runs at the top of a job tick and
 * must not stop the real work behind it.
 */
export async function reapStaleRecoveryDrills(
  maxRunningMinutes: number = DEFAULT_RECOVERY_DRILL_MAX_RUNNING_MINUTES,
): Promise<number> {
  const minutes =
    Number.isFinite(maxRunningMinutes) && maxRunningMinutes > 0 ? maxRunningMinutes : DEFAULT_RECOVERY_DRILL_MAX_RUNNING_MINUTES;
  const cutoff = new Date(Date.now() - minutes * 60_000);

  try {
    const result = await prisma.recoveryDrillRun.updateMany({
      where: { status: 'running', startedAt: { lt: cutoff } },
      data: { status: 'failed', finishedAt: new Date(), errorCode: RECOVERY_DRILL_ABANDONED_ERROR_CODE },
    });
    if (result.count > 0) {
      console.warn(`[recovery-drill] Reaped ${result.count} abandoned drill run(s) older than ${minutes} minutes.`);
    }
    return result.count;
  } catch (err) {
    console.error('[recovery-drill] Failed to reap abandoned drill runs:', safeErrorFields(err));
    return 0;
  }
}
