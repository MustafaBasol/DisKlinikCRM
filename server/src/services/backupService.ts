import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const execFile = promisify(execFileCb);

export const BACKUP_DIR = '/root/noramedi-backups';
export const BACKUP_SCRIPT = '/usr/local/sbin/noramedi-db-backup.sh';
export const BACKUP_LOG = '/var/log/noramedi-db-backup.log';
const BACKUP_CRON = '/etc/cron.d/noramedi-db-backup';
const RETENTION_DAYS = 7;
export const BACKUP_FILENAME_RE = /^noramedi_crm-\d{8}-\d{6}\.dump$/;

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
  };
}

export async function getBackupLogs(lines: number): Promise<string[]> {
  const n = Math.min(300, Math.max(1, lines));
  try {
    const { stdout } = await execFile('tail', ['-n', String(n), BACKUP_LOG], { timeout: 10_000 });
    return stdout.split('\n').filter(Boolean);
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
      env: { ...process.env },
    });
    const files = await listBackupFiles();
    return { success: true, durationMs: Date.now() - start, latestBackup: files[0] ?? null };
  } catch (err: any) {
    return {
      success: false,
      durationMs: Date.now() - start,
      latestBackup: null,
      error: err?.stderr ? String(err.stderr).substring(0, 500) : (err?.message ?? 'Unknown error'),
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

export async function runRestoreTest(filename?: string): Promise<{
  backupFilename: string;
  tempDbName: string;
  success: boolean;
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

  const connEnv = {
    ...process.env,
    PGPASSWORD: pgEnv.PGPASSWORD,
    PGHOST: pgEnv.PGHOST,
    PGPORT: pgEnv.PGPORT,
    PGUSER: pgEnv.PGUSER,
  };

  const pgArgs = ['-h', pgEnv.PGHOST, '-p', pgEnv.PGPORT, '-U', pgEnv.PGUSER];

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

    return {
      backupFilename: targetFile.filename,
      tempDbName: '[redacted-test-db]',
      success: true,
      tableCount,
      platformAdminCount,
      planCount,
      migrationsCount,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      backupFilename: targetFile.filename,
      tempDbName: '[redacted-test-db]',
      success: false,
      durationMs: Date.now() - start,
      errorSummary: (err?.message ?? 'Unknown error').substring(0, 500),
    };
  } finally {
    if (dbCreated) {
      try {
        await execFile('dropdb', [...pgArgs, tempDbName], { env: connEnv, timeout: 30_000 });
      } catch (dropErr: any) {
        console.error('[backup] Failed to drop temp DB:', dropErr?.message);
      }
    }
    restoreTestRunning = false;
  }
}
