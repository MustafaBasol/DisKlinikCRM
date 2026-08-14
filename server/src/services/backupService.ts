/**
 * backupService.ts — thin wrapper around the HOST-side database backup script.
 *
 * IMPORTANT CONTEXT FOR EVERYTHING BELOW: `BACKUP_SCRIPT`
 * (/usr/local/sbin/noramedi-db-backup.sh) is NOT part of this repository. Its
 * contents have never been reviewed by this program, which means:
 *
 *  - its stdout/stderr is untrusted, unbounded text (it may echo a connection
 *    string, an S3 key, or a password) — so nothing it produces may be
 *    forwarded verbatim to an HTTP client (see `getBackupLogs` /
 *    `externalFailureCode`); and
 *  - nobody knows which environment variables it actually needs — so the
 *    default remains "pass the whole environment", with an opt-in allowlist
 *    for operators who have read the script (see `buildBackupScriptEnv`).
 *
 * The safe, permanent fix for both is to bring that script into this
 * repository and review it. Until then this module bounds the blast radius.
 */
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { safeErrorFields, boundedErrorType } from '../utils/safeError.js';
// Type-only: erased at compile time, so importing the drill service (and via
// it, Prisma) never happens at module load. The runtime import is lazy and
// lives inside runRestoreTest(), which keeps this module's pure helpers unit
// testable with no database at all.
import type { RecoveryDrillTrigger } from './recoveryDrillService.js';

const execFile = promisify(execFileCb);

export const BACKUP_DIR = '/root/noramedi-backups';
export const BACKUP_SCRIPT = '/usr/local/sbin/noramedi-db-backup.sh';
export const BACKUP_LOG = '/var/log/noramedi-db-backup.log';
const BACKUP_CRON = '/etc/cron.d/noramedi-db-backup';
const RETENTION_DAYS = 7;
export const BACKUP_FILENAME_RE = /^noramedi_crm-\d{8}-\d{6}\.dump$/;

/** Fixed token substituted for any secret-looking span in a log line. */
export const REDACTED_TOKEN = '[redacted]';

/** Hard cap on a single returned log line, so one pathological line cannot flood a response. */
const MAX_LOG_LINE_LENGTH = 1000;

/**
 * Default staleness threshold for backup artifacts, in hours.
 *
 * 30 deliberately matches `NORAMEDI_OPSCHECK_BACKUP_MAX_AGE_HOURS` /
 * `NORAMEDI_OPSCHECK_FILEBACKUP_MAX_AGE_HOURS` in scripts/noramedi-opscheck.sh
 * (both default 30) — a daily backup plus 6h of slack. The in-app view and the
 * external ops check must not disagree about what "stale" means.
 */
export const DEFAULT_BACKUP_MAX_AGE_HOURS = 30;

/** Delay before the single dropdb retry in the restore-test cleanup path. */
const DROPDB_RETRY_DELAY_MS = 2_000;

let backupRunning = false;
let restoreTestRunning = false;

export function isBackupRunning(): boolean { return backupRunning; }
export function isRestoreTestRunning(): boolean { return restoreTestRunning; }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export interface BackupFileMeta {
  filename: string;
  createdAt: string;
  sizeBytes: number;
  sizeHuman: string;
}

export async function listBackupFiles(): Promise<BackupFileMeta[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(BACKUP_DIR);
  } catch {
    return [];
  }

  const files: BackupFileMeta[] = [];
  for (const name of entries) {
    if (!BACKUP_FILENAME_RE.test(name)) continue;
    try {
      const stat = await fs.stat(path.join(BACKUP_DIR, name));
      files.push({
        filename: name,
        createdAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
        sizeHuman: formatBytes(stat.size),
      });
    } catch {
      // skip unreadable files
    }
  }

  files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return files;
}

// ─── Pure helpers (no filesystem, no child process, no ambient clock) ────────
//
// Everything below is deliberately pure and exported so that
// tests/platformRecoverySafety.test.ts can prove the safety properties
// (redaction, staleness, env narrowing, error sanitization) without a
// database, a network, or a real clock.

/**
 * Collapses any error into a short, bounded, non-sensitive failure code such
 * as `Error:ENOENT` or `Error:exit_127`.
 *
 * Raw `err.message`/`err.stderr` from an external tool is NOT safe to return:
 * `pg_restore` embeds table names and key VALUES in its messages (e.g.
 * `Key (email)=(...) already exists`), and the unreviewed backup script's
 * stderr can carry anything at all, including a connection string. Only
 * `boundedErrorType()` (a fixed two-value label) plus a character-restricted
 * error/exit code survive.
 */
export function externalFailureCode(err: unknown): string {
  const type = boundedErrorType(err);
  const rawCode = (err as { code?: unknown } | null | undefined)?.code;

  let code: string;
  if (typeof rawCode === 'number' && Number.isFinite(rawCode)) {
    // execFile reports a non-zero process exit as a numeric `code`. The exit
    // status is a small integer decided by the tool, never caller data, so it
    // is safe and it is the single most useful thing an operator can get here.
    code = `exit_${Math.trunc(rawCode)}`;
  } else {
    code = safeErrorFields(err).errorCode;
  }

  // Belt and braces: `err.code` is attacker/tool-controlled in principle, so
  // anything that is not a short identifier-shaped token is discarded.
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(code)) code = 'UNKNOWN';
  return `${type}:${code}`;
}

/**
 * Redacts secret-looking spans from ONE line of the external backup script's
 * log before it is returned over HTTP.
 *
 * Root issue: the script that produces /var/log/noramedi-db-backup.log is not
 * in this repository and has never been reviewed, so its output is unbounded
 * and could contain a connection string, a PGPASSWORD, or cloud credentials.
 * Operators genuinely need these lines to debug a failed backup, so the line
 * is kept — with known secret shapes replaced by a fixed token and the length
 * bounded.
 */
export function redactBackupLogLine(line: string): string {
  if (typeof line !== 'string') return '';

  let out = line;

  // 1. Full postgres/postgresql connection URIs (which embed user:password@host).
  out = out.replace(/postgres(?:ql)?:\/\/\S*/gi, REDACTED_TOKEN);

  // 2. AWS access key ids appear verbatim in the wild (AKIA + 16 uppercase/digits).
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, REDACTED_TOKEN);

  // 3. key=value / key: value assignments for credential-bearing names. The
  //    key is preserved (it tells the operator WHICH credential appeared);
  //    only the value is replaced.
  out = out.replace(
    /\b(PGPASSWORD|PGPASS|password|passwd|pwd|secretAccessKey|secret_access_key|accessKeyId|access_key_id|aws_secret_access_key|aws_access_key_id)(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi,
    (_match, key: string, separator: string) => `${key}${separator}${REDACTED_TOKEN}`,
  );

  if (out.length > MAX_LOG_LINE_LENGTH) {
    out = `${out.slice(0, MAX_LOG_LINE_LENGTH)}...[truncated]`;
  }
  return out;
}

/**
 * Resolves a `*_MAX_AGE_HOURS` style setting, falling back to the shared
 * 30-hour default for unset / non-numeric / non-positive values.
 */
export function resolveMaxAgeHours(raw: string | undefined | null): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BACKUP_MAX_AGE_HOURS;
}

/** DB_BACKUP_MAX_AGE_HOURS, or the shared 30-hour default. */
export function getDbBackupMaxAgeHours(env: NodeJS.ProcessEnv = process.env): number {
  return resolveMaxAgeHours(env.DB_BACKUP_MAX_AGE_HOURS);
}

/**
 * Whole minutes elapsed since `at`, floored, never negative. Returns null for
 * a missing/unparseable timestamp so "we do not know" stays distinguishable
 * from "zero minutes old". `now` is injectable so tests never race the clock.
 */
export function computeArtifactAgeMinutes(
  at: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (at === null || at === undefined) return null;
  const at_ = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(at_.getTime())) return null;
  const deltaMs = now.getTime() - at_.getTime();
  if (!Number.isFinite(deltaMs)) return null;
  return Math.max(0, Math.floor(deltaMs / 60_000));
}

/**
 * "No backup has ever been taken" MUST read as stale, never as healthy —
 * silence is the single most dangerous way for a backup system to fail. Hence
 * a null age is stale.
 *
 * The comparison is strict (`>`), matching noramedi-opscheck.sh's backup
 * check: an artifact sitting EXACTLY at the threshold is still fresh, so a
 * nominally-on-time backup does not flap the alert on and off.
 */
export function isBackupStale(ageMinutes: number | null, thresholdHours: number): boolean {
  if (ageMinutes === null) return true;
  return ageMinutes > thresholdHours * 60;
}

/** Always forwarded to the backup script, allowlist or not — a script with no PATH cannot run at all. */
export const BACKUP_SCRIPT_ENV_BASE_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL'] as const;

/**
 * Builds the environment handed to the unreviewed external backup script.
 *
 * TRADEOFF, DELIBERATE: the default is unchanged — the ENTIRE API process
 * environment (DATABASE_URL, JWT_SECRET, PLATFORM_JWT_SECRET, ENCRYPTION_KEY,
 * everything) is passed through, exactly as before. That is more environment
 * than any backup script should need, but narrowing it blindly could break
 * production backups, because nobody has read what the script actually
 * consumes. Silently breaking the backups while trying to harden them is
 * strictly worse than the exposure.
 *
 * So the narrowing is OPT-IN: set `BACKUP_SCRIPT_ENV_ALLOWLIST` to a
 * comma-separated list of variable names (e.g. "DATABASE_URL,PGSSLMODE") and
 * only those, plus PATH/HOME/LANG/LC_ALL, are passed. The correct sequence is:
 * read the script, determine what it needs, then set the allowlist. Until the
 * script lives in this repository, that read cannot be automated here.
 */
export function buildBackupScriptEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const raw = env.BACKUP_SCRIPT_ENV_ALLOWLIST;
  if (typeof raw !== 'string' || raw.trim() === '') {
    // Unset -> behave exactly as before this change.
    return { ...env };
  }

  const allowed = new Set<string>(BACKUP_SCRIPT_ENV_BASE_KEYS);
  for (const name of raw.split(',')) {
    const trimmed = name.trim();
    if (trimmed) allowed.add(trimmed);
  }

  const narrowed: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    const value = env[key];
    if (value !== undefined) narrowed[key] = value;
  }
  return narrowed;
}

// ─── Filesystem / status ────────────────────────────────────────────────────

async function checkExists(filePath: string): Promise<boolean> {
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function isExecutable(filePath: string): Promise<boolean> {
  try { await fs.access(filePath, fs.constants.X_OK); return true; } catch { return false; }
}

export async function getBackupStatus() {
  const [
    backupDirAccessible,
    scriptExists,
    scriptExecutable,
    cronExists,
    logExists,
    files,
  ] = await Promise.all([
    checkExists(BACKUP_DIR),
    checkExists(BACKUP_SCRIPT),
    isExecutable(BACKUP_SCRIPT),
    checkExists(BACKUP_CRON),
    checkExists(BACKUP_LOG),
    listBackupFiles(),
  ]);

  const latest = files[0] ?? null;
  const totalSizeBytes = files.reduce((s, f) => s + f.sizeBytes, 0);

  // Staleness (F4-FCR-001): "how many backups exist" answers nothing about
  // whether backups are still HAPPENING. A cluster whose cron died six weeks
  // ago still reports seven healthy-looking files. These three fields are
  // additive — no existing field changed name or meaning.
  const staleThresholdHours = getDbBackupMaxAgeHours();
  const latestBackupAgeMinutes = computeArtifactAgeMinutes(latest?.createdAt ?? null);

  return {
    backupDirAccessible,
    scriptExists,
    scriptExecutable,
    cronExists,
    logExists,
    retentionDays: RETENTION_DAYS,
    totalBackupCount: files.length,
    totalSizeBytes,
    totalSizeHuman: formatBytes(totalSizeBytes),
    latestBackup: latest,
    recentBackups: files.slice(0, 10),
    currentlyRunning: backupRunning,
    latestBackupAgeMinutes,
    staleThresholdHours,
    stale: isBackupStale(latestBackupAgeMinutes, staleThresholdHours),
  };
}

/**
 * Tails the external backup script's log.
 *
 * Each line is passed through `redactBackupLogLine()` before it leaves this
 * function. The underlying issue is that the producing script
 * (/usr/local/sbin/noramedi-db-backup.sh) is NOT in this repository and has
 * never been reviewed, so there is no upper bound on what it may print —
 * including a DATABASE_URL or cloud credentials. Redacting at the read side
 * is a mitigation, not a fix; the fix is to vendor and review that script.
 */
export async function getBackupLogs(lines: number): Promise<string[]> {
  const n = Math.min(300, Math.max(1, lines));
  try {
    const { stdout } = await execFile('tail', ['-n', String(n), BACKUP_LOG], { timeout: 10_000 });
    return stdout.split('\n').filter(Boolean).map(redactBackupLogLine);
  } catch {
    return [];
  }
}

export async function runBackup(): Promise<{
  success: boolean;
  durationMs: number;
  latestBackup: BackupFileMeta | null;
  error?: string;
}> {
  if (backupRunning) throw new Error('A backup is already running');
  backupRunning = true;
  const start = Date.now();
  try {
    await execFile(BACKUP_SCRIPT, [], {
      timeout: 5 * 60_000,
      env: buildBackupScriptEnv(),
    });
    const files = await listBackupFiles();
    return { success: true, durationMs: Date.now() - start, latestBackup: files[0] ?? null };
  } catch (err: any) {
    // Previously this returned the external script's raw stderr (first 500
    // chars) straight to the HTTP client. That script is not in this
    // repository, so its stderr is untrusted text that may embed a connection
    // string, a storage key, or a password. Only a bounded, sanitized code
    // crosses the boundary now; the full stderr stays in the script's own log,
    // which is itself redacted on the way out by getBackupLogs().
    return {
      success: false,
      durationMs: Date.now() - start,
      latestBackup: null,
      error: externalFailureCode(err),
    };
  } finally {
    backupRunning = false;
  }
}

function parseDatabaseUrl(url: string): Record<string, string> {
  try {
    const u = new URL(url);
    return {
      PGHOST: u.hostname,
      PGPORT: u.port || '5432',
      PGUSER: decodeURIComponent(u.username),
      PGPASSWORD: decodeURIComponent(u.password),
      PGDATABASE: u.pathname.replace(/^\//, ''),
    };
  } catch {
    return {};
  }
}

function safeTempDbName(): string {
  const ts = Date.now();
  const rand = randomBytes(4).toString('hex');
  return `noramedi_restore_test_${ts}_${rand}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Drops the restore test's scratch database, retrying ONCE after a short
 * delay. Returns whether the drop was verified.
 *
 * Why this matters more than a typical cleanup: that scratch database is a
 * COMPLETE, LIVE, PLAINTEXT, CROSS-TENANT copy of the entire patient database,
 * sitting on the PRODUCTION cluster. If the drop fails and nobody is told, it
 * persists indefinitely. A single retry covers the common transient cause (a
 * connection still draining from the verification queries), and the caller
 * turns a persistent failure into durable, alerting evidence rather than a
 * console line.
 */
async function dropTempDatabase(
  tempDbName: string,
  pgArgs: string[],
  connEnv: NodeJS.ProcessEnv,
): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await execFile('dropdb', [...pgArgs, tempDbName], { env: connEnv, timeout: 30_000 });
      return true;
    } catch (dropErr: any) {
      if (attempt === 1) {
        await delay(DROPDB_RETRY_DELAY_MS);
        continue;
      }
      // Only the error CODE is logged: execFile's message is
      // "Command failed: dropdb -h <PGHOST> -p <PGPORT> -U <PGUSER> ...",
      // which leaks the production DB host/port/username (F3-IMPL-004).
      console.error('[backup] Failed to drop temp DB:', { code: dropErr?.code });
    }
  }
  return false;
}

/** Opens a drill ledger row. Ledger problems must never break the restore test, so failures are swallowed. */
async function startRestoreDrillSafely(
  trigger: RecoveryDrillTrigger,
  sourceArtifactAt: Date | null,
): Promise<string | null> {
  try {
    const { startRecoveryDrill } = await import('./recoveryDrillService.js');
    return await startRecoveryDrill({ kind: 'db_restore_test', trigger, sourceArtifactAt });
  } catch (err) {
    console.error('[backup] Failed to open recovery drill ledger row:', safeErrorFields(err));
    return null;
  }
}

/** Closes a drill ledger row. finishRecoveryDrill() never throws; the dynamic import still might. */
async function finishRestoreDrillSafely(input: {
  id: string;
  success: boolean;
  cleanupVerified: boolean;
  residualArtifact: string | null;
  errorCode: string | null;
}): Promise<void> {
  try {
    const { finishRecoveryDrill } = await import('./recoveryDrillService.js');
    await finishRecoveryDrill({
      id: input.id,
      status: input.success ? 'passed' : 'failed',
      samplesAttempted: 1,
      samplesPassed: input.success ? 1 : 0,
      samplesFailed: input.success ? 0 : 1,
      cleanupVerified: input.cleanupVerified,
      residualArtifact: input.residualArtifact,
      errorCode: input.errorCode,
    });
  } catch (err) {
    console.error('[backup] Failed to close recovery drill ledger row:', safeErrorFields(err));
  }
}

/**
 * Durable, operator-visible alert for a scratch database that could not be
 * dropped. The temp DB name is included verbatim on purpose: it is generated
 * by safeTempDbName() from a timestamp and random hex only, so it carries no
 * PHI, no clinic id and no credential — and without it an operator cannot find
 * the residual copy to remove it.
 */
async function auditResidualTempDatabase(tempDbName: string, drillRunId: string | null): Promise<void> {
  try {
    const { writePlatformAdminAuditEvent } = await import('./platformAdminAudit.js');
    await writePlatformAdminAuditEvent({
      actorPlatformAdminId: null,
      action: 'backup.restore_test.residual_artifact',
      resourceType: 'backup',
      resourceKey: 'restore_test',
      outcome: 'error',
      safeMetadata: { residualDatabase: tempDbName, drillRunId },
    });
  } catch (err) {
    console.error('[backup] Failed to write residual temp DB audit event:', safeErrorFields(err));
  }
}

/**
 * Restores a backup into a throwaway database on the production cluster and
 * sanity-checks it.
 *
 * Every execution now produces durable evidence in the recovery drill ledger
 * (`kind: 'db_restore_test'`), including `sourceArtifactAt` — the timestamp of
 * the artifact restored — which is what makes effective RPO measurable rather
 * than merely asserted. The ledger is strictly best-effort: it must never turn
 * a working restore test into a failure.
 */
export async function runRestoreTest(
  filename?: string,
  trigger: RecoveryDrillTrigger = 'manual',
): Promise<{
  backupFilename: string;
  tempDbName: string;
  success: boolean;
  cleanupVerified: boolean;
  drillRunId: string | null;
  tableCount?: number;
  platformAdminCount?: number;
  planCount?: number;
  migrationsCount?: number;
  durationMs: number;
  errorSummary?: string;
}> {
  if (restoreTestRunning) throw new Error('A restore test is already running');

  const files = await listBackupFiles();
  if (files.length === 0) throw new Error('No backup files available');

  let targetFile: BackupFileMeta;
  if (filename) {
    if (!BACKUP_FILENAME_RE.test(filename)) throw new Error('Invalid backup filename format');
    const found = files.find((f) => f.filename === filename);
    if (!found) throw new Error('Backup file not found in backup directory');
    targetFile = found;
  } else {
    targetFile = files[0];
  }

  const backupFilePath = path.join(BACKUP_DIR, targetFile.filename);

  const pgEnv = parseDatabaseUrl(process.env.DATABASE_URL ?? '');
  if (!pgEnv.PGHOST || !pgEnv.PGUSER) throw new Error('Cannot parse DATABASE_URL for restore test');

  const tempDbName = safeTempDbName();
  // Defensive check — safeTempDbName() only uses [a-z0-9_] but guard anyway
  if (!/^[a-z0-9_]+$/.test(tempDbName)) throw new Error('Generated temp DB name is invalid');

  restoreTestRunning = true;
  const start = Date.now();
  let dbCreated = false;

  const connEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PGPASSWORD: pgEnv.PGPASSWORD,
    PGHOST: pgEnv.PGHOST,
    PGPORT: pgEnv.PGPORT,
    PGUSER: pgEnv.PGUSER,
  };

  const pgArgs = ['-h', pgEnv.PGHOST, '-p', pgEnv.PGPORT, '-U', pgEnv.PGUSER];

  // Drill evidence, opened before any work so a crash mid-restore still leaves
  // a `running` row for reapStaleRecoveryDrills() to find. sourceArtifactAt is
  // the chosen dump's mtime — the RPO window this exercise actually proves.
  const drillRunId = await startRestoreDrillSafely(trigger, new Date(targetFile.createdAt));

  type RestoreOutcome = {
    success: boolean;
    tableCount?: number;
    platformAdminCount?: number;
    planCount?: number;
    migrationsCount?: number;
    durationMs: number;
    errorSummary?: string;
  };
  let outcome: RestoreOutcome;

  try {
    try {
      await execFile('createdb', [...pgArgs, tempDbName], { env: connEnv, timeout: 30_000 });
      dbCreated = true;

      await execFile('pg_restore', [
        ...pgArgs,
        '-d', tempDbName,
        '--no-privileges',
        '--no-owner',
        backupFilePath,
      ], { env: connEnv, timeout: 10 * 60_000 });

      const query = (sql: string) => execFile('psql', [
        ...pgArgs, '-d', tempDbName, '-t', '-A', '-c', sql,
      ], { env: connEnv, timeout: 30_000 });

      const tableResult = await query(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';",
      );
      const tableCount = parseInt(tableResult.stdout.trim(), 10) || 0;

      const paResult = await query('SELECT COUNT(*) FROM "PlatformAdmin";');
      const platformAdminCount = parseInt(paResult.stdout.trim(), 10) || 0;

      const planResult = await query('SELECT COUNT(*) FROM "Plan";');
      const planCount = parseInt(planResult.stdout.trim(), 10) || 0;

      let migrationsCount: number | undefined;
      try {
        const migResult = await query('SELECT COUNT(*) FROM "_prisma_migrations";');
        migrationsCount = parseInt(migResult.stdout.trim(), 10) || 0;
      } catch { /* table may not exist */ }

      outcome = {
        success: true,
        tableCount,
        platformAdminCount,
        planCount,
        migrationsCount,
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      // NOT err.message: pg_restore embeds table/column names and key VALUES in
      // its errors (e.g. `Key (email)=(...) already exists`), which is patient
      // data on a multi-tenant dump. Only a bounded failure code is returned.
      outcome = {
        success: false,
        durationMs: Date.now() - start,
        errorSummary: externalFailureCode(err),
      };
    }

    // ── Cleanup ──────────────────────────────────────────────────────────────
    // Runs after the outcome is decided (not in a `finally`) precisely so the
    // cleanup result can be reported in the response and in the drill ledger.
    // Nothing between here and the return statement throws.
    let cleanupVerified = true; // nothing was created ⇒ nothing to clean up
    let residualArtifact: string | null = null;

    if (dbCreated) {
      cleanupVerified = await dropTempDatabase(tempDbName, pgArgs, connEnv);
      if (!cleanupVerified) {
        residualArtifact = tempDbName;
        await auditResidualTempDatabase(tempDbName, drillRunId);
      }
    }

    if (drillRunId) {
      await finishRestoreDrillSafely({
        id: drillRunId,
        success: outcome.success,
        cleanupVerified,
        residualArtifact,
        errorCode: outcome.errorSummary ?? null,
      });
    }

    return {
      backupFilename: targetFile.filename,
      // Success path: the scratch DB no longer exists, so its name is pure
      // noise in an operator-facing response (and one more identifier in logs)
      // — keep it redacted. Cleanup-failed path: the operator NEEDS the exact
      // name to go drop the leftover full-database copy by hand, and the name
      // is `noramedi_restore_test_<ts>_<hex>` — timestamp plus random hex, no
      // PHI, no clinic id, no credential. Redacting it there would hide the
      // single fact that makes the incident actionable.
      tempDbName: cleanupVerified ? '[redacted-test-db]' : tempDbName,
      cleanupVerified,
      drillRunId,
      ...outcome,
    };
  } finally {
    restoreTestRunning = false;
  }
}
