/**
 * platformRecoverySafety.test.ts — F4-FCR-001
 *
 * Proves the four safety properties added to services/backupService.ts, all
 * of which exist because the host-side backup script
 * (/usr/local/sbin/noramedi-db-backup.sh) is NOT in this repository and has
 * never been reviewed:
 *
 *  1. LOG REDACTION — getBackupLogs() tails that unreviewed script's log and
 *     returns it over HTTP. Connection URIs, PGPASSWORD values, AWS access
 *     key ids and accessKeyId/secretAccessKey assignments must be replaced
 *     with a fixed token, while ordinary operational lines pass through
 *     untouched (an operator still has to be able to debug a failed backup).
 *  2. STALENESS — "no backup has ever been taken" must read as STALE, never
 *     as healthy. Silence is the most dangerous way for a backup system to
 *     fail. Threshold comparison is strict, matching noramedi-opscheck.sh.
 *  3. ENV NARROWING — runBackup() hands the script an environment. The
 *     default is unchanged (whole process env, because nobody has read what
 *     the script needs); BACKUP_SCRIPT_ENV_ALLOWLIST opts into narrowing.
 *  4. ERROR SANITIZATION — pg_restore errors embed key VALUES, e.g.
 *     `Key (email)=(...) already exists`, which is patient data on a
 *     multi-tenant dump. Nothing from an external tool's message or stderr
 *     may reach an HTTP client.
 *
 * Pure functions only: no database, no network, no child processes, and no
 * wall-clock dependence (every time assertion injects `now`).
 *
 * Run with: tsx src/tests/platformRecoverySafety.test.ts
 */

import assert from 'node:assert/strict';
import {
  redactBackupLogLine,
  REDACTED_TOKEN,
  computeArtifactAgeMinutes,
  isBackupStale,
  resolveMaxAgeHours,
  getDbBackupMaxAgeHours,
  DEFAULT_BACKUP_MAX_AGE_HOURS,
  buildBackupScriptEnv,
  externalFailureCode,
} from '../services/backupService.js';

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

function envWith(vars: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return vars as unknown as NodeJS.ProcessEnv;
}

async function main() {
  // ── 1. Log redaction ───────────────────────────────────────────────────────

  section('redactBackupLogLine — secrets in the unreviewed script log');

  await test('postgres:// connection URI is redacted (password and host both gone)', () => {
    const line = redactBackupLogLine(
      '2026-08-14 03:15:02 connecting to postgres://noramedi:s3cr3t@10.0.0.5:5432/noramedi_crm ok',
    );
    assert.ok(!line.includes('s3cr3t'), `password survived redaction: ${line}`);
    assert.ok(!line.includes('10.0.0.5'), `db host survived redaction: ${line}`);
    assert.ok(!line.includes('postgres://'), `uri scheme survived redaction: ${line}`);
    assert.ok(line.includes(REDACTED_TOKEN), `no redaction token present: ${line}`);
    assert.ok(line.startsWith('2026-08-14 03:15:02 connecting to '), `line context was destroyed: ${line}`);
    assert.ok(line.endsWith(' ok'), `trailing context was destroyed: ${line}`);
  });

  await test('postgresql:// (long scheme spelling) is redacted too', () => {
    const line = redactBackupLogLine('dumping from postgresql://noramedi:hunter2@db.internal/noramedi_crm');
    assert.ok(!line.includes('hunter2'), `password survived redaction: ${line}`);
    assert.ok(!line.includes('db.internal'), `db host survived redaction: ${line}`);
    assert.equal(line, `dumping from ${REDACTED_TOKEN}`);
  });

  await test('PGPASSWORD= value is redacted, and only the value', () => {
    const line = redactBackupLogLine('2026-08-14 03:15:00 exporting PGPASSWORD=hunter2 PGUSER=noramedi');
    assert.ok(!line.includes('hunter2'), `PGPASSWORD value survived redaction: ${line}`);
    assert.ok(line.includes(`PGPASSWORD=${REDACTED_TOKEN}`), `key was not preserved: ${line}`);
    assert.ok(line.includes('PGUSER=noramedi'), `unrelated assignment was destroyed: ${line}`);
  });

  await test('lowercase password= value is redacted', () => {
    const line = redactBackupLogLine('retrying with password=letmein');
    assert.ok(!line.includes('letmein'), `password value survived redaction: ${line}`);
    assert.equal(line, `retrying with password=${REDACTED_TOKEN}`);
  });

  await test('AKIA-prefixed AWS access key id is redacted', () => {
    const line = redactBackupLogLine('uploading dump as AKIAIOSFODNN7EXAMPLE to offsite bucket');
    assert.ok(!line.includes('AKIAIOSFODNN7EXAMPLE'), `AWS key id survived redaction: ${line}`);
    assert.equal(line, `uploading dump as ${REDACTED_TOKEN} to offsite bucket`);
  });

  await test('accessKeyId= and secretAccessKey= assignments are redacted', () => {
    const line = redactBackupLogLine('s3 config accessKeyId=ABCDEF123456 secretAccessKey=wJalrXUtnFEMIK7MDENG');
    assert.ok(!line.includes('ABCDEF123456'), `accessKeyId value survived redaction: ${line}`);
    assert.ok(!line.includes('wJalrXUtnFEMIK7MDENG'), `secretAccessKey value survived redaction: ${line}`);
    assert.ok(line.includes(`accessKeyId=${REDACTED_TOKEN}`), `accessKeyId key was not preserved: ${line}`);
    assert.ok(line.includes(`secretAccessKey=${REDACTED_TOKEN}`), `secretAccessKey key was not preserved: ${line}`);
  });

  await test('an ordinary operational log line passes through completely unchanged', () => {
    const original = '2026-08-14 03:15:41 [backup] completed noramedi_crm-20260814-031501.dump (128.4 MB) in 40s';
    assert.equal(redactBackupLogLine(original), original);
  });

  await test('a second ordinary line (rotation notice) passes through unchanged', () => {
    const original = '2026-08-14 03:15:42 [backup] retention: removed 1 dump older than 7 days';
    assert.equal(redactBackupLogLine(original), original);
  });

  await test('a pathological single line is length-bounded rather than flooding the response', () => {
    const line = redactBackupLogLine('x'.repeat(5000));
    assert.ok(line.length < 1100, `line was not bounded, length=${line.length}`);
    assert.ok(line.endsWith('...[truncated]'), `no truncation marker: ...${line.slice(-30)}`);
  });

  // ── 2. Staleness ───────────────────────────────────────────────────────────

  section('Backup staleness — never-taken must read as stale, never as healthy');

  // Frozen clock: every assertion below injects `now`, so a slow CI runner can
  // never flip a result.
  const now = new Date('2026-08-14T12:00:00.000Z');
  const thresholdHours = DEFAULT_BACKUP_MAX_AGE_HOURS; // 30
  const thresholdMinutes = thresholdHours * 60;        // 1800

  await test('no backup at all (null) -> age null and stale = true', () => {
    assert.equal(computeArtifactAgeMinutes(null, now), null);
    assert.equal(computeArtifactAgeMinutes(undefined, now), null);
    assert.equal(isBackupStale(null, thresholdHours), true);
  });

  await test('an unparseable timestamp -> age null and stale = true (never silently healthy)', () => {
    assert.equal(computeArtifactAgeMinutes('not-a-date', now), null);
    assert.equal(isBackupStale(computeArtifactAgeMinutes('not-a-date', now), thresholdHours), true);
  });

  await test('age exactly AT the threshold -> NOT stale (strict comparison, matches opscheck)', () => {
    const at = new Date(now.getTime() - thresholdMinutes * 60_000);
    const age = computeArtifactAgeMinutes(at, now);
    assert.equal(age, thresholdMinutes);
    assert.equal(isBackupStale(age, thresholdHours), false);
  });

  await test('age one minute OVER the threshold -> stale', () => {
    const over = new Date(now.getTime() - (thresholdMinutes + 1) * 60_000);
    const age = computeArtifactAgeMinutes(over, now);
    assert.equal(age, thresholdMinutes + 1);
    assert.equal(isBackupStale(age, thresholdHours), true);
  });

  await test('age one minute UNDER the threshold -> not stale', () => {
    const under = new Date(now.getTime() - (thresholdMinutes - 1) * 60_000);
    const age = computeArtifactAgeMinutes(under, now);
    assert.equal(age, thresholdMinutes - 1);
    assert.equal(isBackupStale(age, thresholdHours), false);
  });

  await test('ISO string timestamps are accepted (getBackupStatus stores createdAt as ISO text)', () => {
    const age = computeArtifactAgeMinutes('2026-08-14T09:30:00.000Z', now);
    assert.equal(age, 150);
    assert.equal(isBackupStale(age, thresholdHours), false);
  });

  await test('a future timestamp (clock skew) floors at 0 rather than going negative', () => {
    const future = new Date(now.getTime() + 60 * 60_000);
    assert.equal(computeArtifactAgeMinutes(future, now), 0);
    assert.equal(isBackupStale(0, thresholdHours), false);
  });

  section('Staleness threshold resolution');

  await test('DEFAULT_BACKUP_MAX_AGE_HOURS is 30, matching noramedi-opscheck.sh', () => {
    assert.equal(DEFAULT_BACKUP_MAX_AGE_HOURS, 30);
  });

  await test('unset / empty / non-numeric / non-positive values all fall back to 30', () => {
    assert.equal(resolveMaxAgeHours(undefined), 30);
    assert.equal(resolveMaxAgeHours(null), 30);
    assert.equal(resolveMaxAgeHours(''), 30);
    assert.equal(resolveMaxAgeHours('abc'), 30);
    assert.equal(resolveMaxAgeHours('0'), 30);
    assert.equal(resolveMaxAgeHours('-5'), 30);
  });

  await test('a valid override is honoured', () => {
    assert.equal(resolveMaxAgeHours('48'), 48);
    assert.equal(getDbBackupMaxAgeHours(envWith({ DB_BACKUP_MAX_AGE_HOURS: '6' })), 6);
    assert.equal(getDbBackupMaxAgeHours(envWith({})), 30);
  });

  // ── 3. Backup script environment allowlist ────────────────────────────────

  section('buildBackupScriptEnv — opt-in allowlist, default behaviour unchanged');

  const processEnvLike = {
    PATH: '/usr/local/sbin:/usr/bin',
    HOME: '/root',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'C',
    DATABASE_URL: 'postgresql://noramedi:s3cr3t@10.0.0.5:5432/noramedi_crm',
    JWT_SECRET: 'jwt-secret-value',
    PLATFORM_JWT_SECRET: 'platform-jwt-secret-value',
    ENCRYPTION_KEY: 'encryption-key-value',
    PGSSLMODE: 'require',
  };

  await test('allowlist UNSET -> the full environment is passed through, exactly as before', () => {
    const result = buildBackupScriptEnv(envWith(processEnvLike));
    assert.deepEqual(Object.keys(result).sort(), Object.keys(processEnvLike).sort());
    assert.equal(result.JWT_SECRET, 'jwt-secret-value');
    assert.equal(result.ENCRYPTION_KEY, 'encryption-key-value');
  });

  await test('allowlist set to whitespace only -> still treated as unset (backward compatible)', () => {
    const result = buildBackupScriptEnv(envWith({ ...processEnvLike, BACKUP_SCRIPT_ENV_ALLOWLIST: '   ' }));
    assert.equal(result.JWT_SECRET, 'jwt-secret-value');
  });

  await test('allowlist SET -> only allowlisted vars plus PATH/HOME/LANG/LC_ALL survive', () => {
    const result = buildBackupScriptEnv(
      envWith({ ...processEnvLike, BACKUP_SCRIPT_ENV_ALLOWLIST: 'DATABASE_URL, PGSSLMODE' }),
    );
    assert.deepEqual(
      Object.keys(result).sort(),
      ['DATABASE_URL', 'HOME', 'LANG', 'LC_ALL', 'PATH', 'PGSSLMODE'],
    );
    assert.equal(result.DATABASE_URL, processEnvLike.DATABASE_URL);
    assert.equal(result.PATH, processEnvLike.PATH);
  });

  await test('allowlist SET -> application secrets are NOT handed to the external script', () => {
    const result = buildBackupScriptEnv(
      envWith({ ...processEnvLike, BACKUP_SCRIPT_ENV_ALLOWLIST: 'DATABASE_URL' }),
    );
    assert.equal(result.JWT_SECRET, undefined);
    assert.equal(result.PLATFORM_JWT_SECRET, undefined);
    assert.equal(result.ENCRYPTION_KEY, undefined);
    assert.equal(result.BACKUP_SCRIPT_ENV_ALLOWLIST, undefined);
  });

  await test('an allowlisted name that is not present in the environment is simply omitted', () => {
    const result = buildBackupScriptEnv(
      envWith({ ...processEnvLike, BACKUP_SCRIPT_ENV_ALLOWLIST: 'DATABASE_URL,NOT_SET_ANYWHERE' }),
    );
    assert.ok(!Object.prototype.hasOwnProperty.call(result, 'NOT_SET_ANYWHERE'));
  });

  // ── 4. Error sanitization ─────────────────────────────────────────────────

  section('externalFailureCode — no external tool output crosses the HTTP boundary');

  await test('a pg_restore error carrying a patient email produces NO trace of it', () => {
    const raw = Object.assign(
      new Error(
        'pg_restore: error: could not execute query: ERROR:  duplicate key value violates unique constraint "User_email_key"\n' +
        'DETAIL:  Key (email)=(someone@example.com) already exists.',
      ),
      { code: 1, stderr: 'DETAIL:  Key (email)=(someone@example.com) already exists.' },
    );

    const sanitized = externalFailureCode(raw);
    assert.ok(!sanitized.includes('someone@example.com'), `patient email leaked: ${sanitized}`);
    assert.ok(!sanitized.includes('@'), `an address-shaped fragment leaked: ${sanitized}`);
    assert.ok(!sanitized.toLowerCase().includes('email'), `column name leaked: ${sanitized}`);
    assert.ok(!sanitized.toLowerCase().includes('user_email_key'), `constraint name leaked: ${sanitized}`);
    assert.ok(!sanitized.includes('pg_restore'), `external tool output leaked: ${sanitized}`);
    assert.equal(sanitized, 'Error:exit_1');
  });

  await test('a backup script failure exposes only the exit code, never its stderr', () => {
    const raw = Object.assign(new Error('Command failed: /usr/local/sbin/noramedi-db-backup.sh'), {
      code: 127,
      stderr: 'PGPASSWORD=hunter2 not accepted by postgres://noramedi@10.0.0.5:5432/noramedi_crm',
    });
    const sanitized = externalFailureCode(raw);
    assert.ok(!sanitized.includes('hunter2'), `stderr password leaked: ${sanitized}`);
    assert.ok(!sanitized.includes('10.0.0.5'), `stderr db host leaked: ${sanitized}`);
    assert.ok(!sanitized.includes('/usr/local/sbin'), `absolute script path leaked: ${sanitized}`);
    assert.equal(sanitized, 'Error:exit_127');
  });

  await test('a string errno code (ENOENT) is preserved — it is bounded and non-sensitive', () => {
    const raw = Object.assign(new Error('spawn /usr/local/sbin/noramedi-db-backup.sh ENOENT'), { code: 'ENOENT' });
    const sanitized = externalFailureCode(raw);
    assert.equal(sanitized, 'Error:ENOENT');
    assert.ok(!sanitized.includes('/usr/local/sbin'), `absolute script path leaked: ${sanitized}`);
  });

  await test('an error whose `code` is itself sensitive free text collapses to UNKNOWN', () => {
    const raw = Object.assign(new Error('boom'), { code: 'Key (email)=(someone@example.com) already exists' });
    const sanitized = externalFailureCode(raw);
    assert.ok(!sanitized.includes('someone@example.com'), `patient email leaked via err.code: ${sanitized}`);
    assert.equal(sanitized, 'Error:UNKNOWN');
  });

  await test('a non-Error throw collapses to a fixed label', () => {
    assert.equal(externalFailureCode('someone@example.com'), 'UnknownError:UNKNOWN');
    assert.equal(externalFailureCode(null), 'UnknownError:UNKNOWN');
    assert.equal(externalFailureCode(undefined), 'UnknownError:UNKNOWN');
  });

  await test('a bare Error with no code reports the bounded type only', () => {
    assert.equal(externalFailureCode(new Error('Key (email)=(someone@example.com) already exists')), 'Error:UNKNOWN');
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
