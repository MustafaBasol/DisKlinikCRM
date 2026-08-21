/**
 * rlsPocEnvironment.ts — F3-3 disposable PoC environment.
 *
 * ISOLATED, DISPOSABLE, NON-PRODUCTION. Everything this module creates lives in
 * throwaway Docker containers on a throwaway Docker network, is named with a
 * per-run random suffix, and is destroyed in a `finally` block. It never reads
 * `DATABASE_URL`, never touches a shared development database, and creates no
 * Prisma migration.
 *
 * WHY IT PROVISIONS RATHER THAN REUSING scripts/test-runtime
 * ----------------------------------------------------------
 * The existing orchestrator provisions one PostgreSQL and runs a package
 * script against it. This PoC needs three things it does not offer: a second
 * container (PgBouncer) on a shared network, MULTIPLE database roles with
 * different privileges, and the ability to run raw SQL between phases. The
 * PostgreSQL image digest is deliberately the SAME one
 * (`scripts/test-runtime/lib/postgres.ts`), so the PoC and CI Layer 3 are not
 * measuring two different PostgreSQL builds.
 *
 * CREDENTIALS ARE GENERATED, NEVER COMMITTED. Three random hex passwords per
 * run, written only into a scratch directory and the container environment.
 * The committed artifacts under docs/architecture/poc/f3-3-rls-pgbouncer/
 * contain placeholders only.
 */

import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '../../..');
const REPO_ROOT = resolve(SERVER_ROOT, '..');
export const POC_SQL_DIR = join(REPO_ROOT, 'docs', 'architecture', 'poc', 'f3-3-rls-pgbouncer', 'sql');
const POC_PGBOUNCER_DIR = join(REPO_ROOT, 'docs', 'architecture', 'poc', 'f3-3-rls-pgbouncer', 'pgbouncer');

/** Same digest as scripts/test-runtime/lib/postgres.ts — one PostgreSQL build across the programme. */
export const POSTGRES_IMAGE =
  'postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
/** Resolved and recorded at first run; PgBouncer 1.25.2. */
export const PGBOUNCER_IMAGE =
  'edoburu/pgbouncer@sha256:4c1ca296ef525f108f5d3552cc337c0c09587cf8dae7f0067fd93349e47dc1cd';

export const DATABASE_NAME = 'noramedi_poc';
export const MIGRATOR_ROLE = 'noramedi_migrator';
export const APP_ROLE = 'noramedi_app';
export const PLATFORM_ROLE = 'noramedi_platform';

export interface PocEnvironment {
  readonly runId: string;
  readonly networkName: string;
  readonly postgresContainer: string;
  readonly pgbouncerContainer: string;
  readonly postgresHostPort: number;
  pgbouncerHostPort: number | null;
  readonly scratchDir: string;
  /** Direct-to-PostgreSQL URLs. */
  readonly directUrls: Record<'migrator' | 'app' | 'platform', string>;
  /** Through-PgBouncer URLs; null until PgBouncer starts (or forever, if it cannot). */
  pooledUrls: Record<'migrator' | 'app' | 'platform', string> | null;
  pgbouncerStatus: 'NOT_STARTED' | 'RUNNING' | 'BLOCKED_EXTERNAL_ENVIRONMENT';
  pgbouncerBlockReason: string | null;
}

function run(
  command: string,
  args: string[],
  opts: { input?: string; cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean } = {},
) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input: opts.input,
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
    // `docker` is a real executable and runs fine without a shell. `npx` on
    // Windows is `npx.cmd`, which `spawnSync` cannot execute directly — it
    // fails with an EMPTY stdout AND stderr, which is exactly as confusing to
    // debug as it sounds. Only the npx path opts in.
    shell: opts.shell ?? false,
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function docker(args: string[], opts: { input?: string } = {}) {
  return run('docker', args, opts);
}

function dockerOrThrow(args: string[], what: string, opts: { input?: string } = {}) {
  const result = docker(args, opts);
  if (result.code !== 0) {
    throw new Error(`${what} failed (exit ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result;
}

export function assertDockerAvailable(): string {
  const version = docker(['version', '--format', '{{.Server.Version}}']);
  if (version.code !== 0) {
    throw new Error(
      'Docker is not available, so the F3-3 PoC cannot run. This is an environment blocker, not a ' +
        `result: ${version.stderr.trim()}`,
    );
  }
  return version.stdout.trim();
}

export function pgbouncerVersion(): string {
  const result = docker(['run', '--rm', '--entrypoint', 'pgbouncer', PGBOUNCER_IMAGE, '--version']);
  return result.code === 0 ? result.stdout.split('\n')[0].trim() : 'unknown';
}

function hostPort(container: string, containerPort: string): number {
  const result = dockerOrThrow(['port', container, containerPort], `docker port ${container}`);
  const line = result.stdout.trim().split('\n')[0];
  const port = Number(line.slice(line.lastIndexOf(':') + 1));
  if (!Number.isFinite(port) || port <= 0) throw new Error(`Could not parse host port from "${line}"`);
  return port;
}

function waitForPostgres(container: string, user: string): void {
  const deadline = Date.now() + 90_000;
  let last = '';
  while (Date.now() < deadline) {
    const probe = docker(['exec', container, 'pg_isready', '-U', user, '-d', DATABASE_NAME]);
    if (probe.code === 0) return;
    last = probe.stderr.trim() || probe.stdout.trim();
    // Busy-wait rather than sleep: this module runs in a short-lived script and
    // a blocking sleep here would be indistinguishable from a hang.
    const spin = Date.now() + 400;
    while (Date.now() < spin) { /* intentional */ }
  }
  throw new Error(`PostgreSQL did not become ready within 90s. Last probe: ${last}`);
}

export interface PsqlOptions {
  readonly role?: 'migrator' | 'app' | 'platform';
  readonly variables?: Record<string, string>;
  readonly allowFailure?: boolean;
}

/**
 * Runs SQL inside the PostgreSQL container. `ON_ERROR_STOP=1` so a failing
 * statement is a failing run rather than a partially-applied file.
 */
export function psql(env: PocEnvironment, sql: string, opts: PsqlOptions = {}) {
  const role = opts.role ?? 'migrator';
  const roleName = role === 'migrator' ? MIGRATOR_ROLE : role === 'app' ? APP_ROLE : PLATFORM_ROLE;
  const args = ['exec', '-i', env.postgresContainer, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', roleName, '-d', DATABASE_NAME];
  for (const [key, value] of Object.entries(opts.variables ?? {})) args.push('-v', `${key}=${value}`);
  args.push('-f', '-');
  const result = docker(args, { input: sql });
  if (result.code !== 0 && !opts.allowFailure) {
    throw new Error(`psql failed (exit ${result.code}):\n${result.stderr.trim()}`);
  }
  return result;
}

export function psqlFile(env: PocEnvironment, fileName: string, opts: PsqlOptions = {}) {
  return psql(env, readFileSync(join(POC_SQL_DIR, fileName), 'utf8'), opts);
}

export function provisionPocEnvironment(): PocEnvironment {
  const runId = randomUUID().slice(0, 8);
  const networkName = `noramedi-f33-net-${runId}`;
  const postgresContainer = `noramedi-f33-pg-${runId}`;
  const pgbouncerContainer = `noramedi-f33-pgb-${runId}`;
  const scratchDir = mkdtempSync(join(tmpdir(), `noramedi-f33-${runId}-`));

  const migratorPassword = randomBytes(18).toString('hex');
  const appPassword = randomBytes(18).toString('hex');
  const platformPassword = randomBytes(18).toString('hex');

  dockerOrThrow(['network', 'create', networkName], 'docker network create');

  dockerOrThrow(
    [
      'run', '-d',
      '--name', postgresContainer,
      '--network', networkName,
      '-p', '127.0.0.1::5432',
      '-e', `POSTGRES_DB=${DATABASE_NAME}`,
      '-e', `POSTGRES_USER=${MIGRATOR_ROLE}`,
      '-e', `POSTGRES_PASSWORD=${migratorPassword}`,
      '--label', 'noramedi.poc=f3-3-rls-pgbouncer',
      POSTGRES_IMAGE,
    ],
    'docker run postgres',
  );

  const postgresHostPort = hostPort(postgresContainer, '5432');
  waitForPostgres(postgresContainer, MIGRATOR_ROLE);

  const url = (role: string, password: string, port: number) =>
    `postgresql://${role}:${password}@127.0.0.1:${port}/${DATABASE_NAME}?schema=public`;

  const env: PocEnvironment = {
    runId,
    networkName,
    postgresContainer,
    pgbouncerContainer,
    postgresHostPort,
    pgbouncerHostPort: null,
    scratchDir,
    directUrls: {
      migrator: url(MIGRATOR_ROLE, migratorPassword, postgresHostPort),
      app: url(APP_ROLE, appPassword, postgresHostPort),
      platform: url(PLATFORM_ROLE, platformPassword, postgresHostPort),
    },
    pooledUrls: null,
    pgbouncerStatus: 'NOT_STARTED',
    pgbouncerBlockReason: null,
  };

  // Stash the generated secrets for the PgBouncer step. Kept off the returned
  // object's public shape so they are not accidentally logged with it.
  generatedPasswords.set(env, { migrator: migratorPassword, app: appPassword, platform: platformPassword });

  return env;
}

const generatedPasswords = new WeakMap<PocEnvironment, Record<'migrator' | 'app' | 'platform', string>>();

/** Applies the real Prisma schema as the migrator role. No PoC migration is created. */
export function applyPrismaSchema(env: PocEnvironment): void {
  const result = run('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: SERVER_ROOT,
    env: { ...process.env, DATABASE_URL: env.directUrls.migrator },
    shell: process.platform === 'win32',
  });
  if (result.code !== 0) {
    throw new Error(
      `prisma migrate deploy failed (exit ${result.code}):\n${result.stdout.trim()}\n${result.stderr.trim()}`,
    );
  }
}

export function applyRolesAndPolicies(env: PocEnvironment): void {
  const passwords = generatedPasswords.get(env)!;
  // NOT `'${...}'`. psql's `:'name'` interpolation adds the quoting itself, so
  // pre-quoting here produces a password that literally contains apostrophes —
  // the role is created, every later connection fails 28P01, and the failure
  // looks like a policy problem rather than a typo.
  psqlFile(env, '01_roles.sql', {
    variables: { app_password: passwords.app, platform_password: passwords.platform },
  });
  psqlFile(env, '02_policies.sql');
  psqlFile(env, '03_force_rls_ownership_demo.sql');
}

/**
 * Starts PgBouncer in transaction-pooling mode on the same Docker network.
 *
 * Returns false — and records a reproducible reason on the environment —
 * rather than throwing, because "PgBouncer could not run here" is a legitimate
 * PoC OUTCOME (`BLOCKED_EXTERNAL_ENVIRONMENT`) that must not be allowed to
 * masquerade as a correctness failure, and must not stop the RLS experiments
 * that do not need it.
 */
export function startPgBouncer(env: PocEnvironment): boolean {
  try {
    const passwords = generatedPasswords.get(env)!;
    const configDir = join(env.scratchDir, 'pgbouncer');
    mkdirSync(configDir, { recursive: true });

    // `replaceAll`, not `replace`. The placeholder appears TWICE in the
    // template — once in the header comment that explains it, once in the
    // `[databases]` line that matters — and `String.replace` with a string
    // pattern substitutes only the FIRST. That left the real host as the
    // literal `__POSTGRES_HOST__`, and PgBouncer reported it as
    // `client_login_timeout (server down)`, which points at the client and the
    // network rather than at a templating mistake. The assertion below is what
    // turns a repeat of this into an immediate, obvious failure.
    const template = readFileSync(join(POC_PGBOUNCER_DIR, 'pgbouncer.ini.template'), 'utf8');
    const config = template.replaceAll('__POSTGRES_HOST__', env.postgresContainer);
    if (config.includes('__POSTGRES_HOST__')) {
      throw new Error('pgbouncer.ini still contains an unsubstituted __POSTGRES_HOST__ placeholder');
    }
    writeFileSync(join(configDir, 'pgbouncer.ini'), config, 'utf8');

    writeFileSync(
      join(configDir, 'userlist.txt'),
      [
        // Plaintext, because a SCRAM verifier cannot be replayed onward to
        // PostgreSQL. Generated per run, written only into a scratch directory,
        // deleted at teardown, never committed.
        `"${APP_ROLE}" "${passwords.app}"`,
        `"${PLATFORM_ROLE}" "${passwords.platform}"`,
        `"${MIGRATOR_ROLE}" "${passwords.migrator}"`,
        '',
      ].join('\n'),
      'utf8',
    );

    const started = docker([
      'run', '-d',
      '--name', env.pgbouncerContainer,
      '--network', env.networkName,
      '-p', '127.0.0.1::6432',
      '-v', `${configDir}:/etc/pgbouncer`,
      '--label', 'noramedi.poc=f3-3-rls-pgbouncer',
      '--entrypoint', 'pgbouncer',
      PGBOUNCER_IMAGE,
      '/etc/pgbouncer/pgbouncer.ini',
    ]);
    if (started.code !== 0) {
      env.pgbouncerStatus = 'BLOCKED_EXTERNAL_ENVIRONMENT';
      env.pgbouncerBlockReason = `docker run pgbouncer failed: ${started.stderr.trim()}`;
      return false;
    }

    // A bind-mounted auth file the container cannot READ is a silent failure:
    // the .ini is parsed at startup, the userlist only on the first client
    // login, so PgBouncer reports "process up" and then times clients out.
    // Checked explicitly so that possibility is ruled in or out by evidence.
    const authFileReadable = docker(['exec', env.pgbouncerContainer, 'head', '-c', '1', '/etc/pgbouncer/userlist.txt']);
    if (authFileReadable.code !== 0) {
      env.pgbouncerStatus = 'BLOCKED_EXTERNAL_ENVIRONMENT';
      env.pgbouncerBlockReason =
        `PgBouncer cannot read its mounted auth file (/etc/pgbouncer/userlist.txt): ${authFileReadable.stderr.trim()}`;
      return false;
    }

    const port = hostPort(env.pgbouncerContainer, '6432');
    const poolUrl = (role: string, password: string) =>
      `postgresql://${role}:${password}@127.0.0.1:${port}/${DATABASE_NAME}?schema=public`;

    // Readiness: a real connection through the pooler, not a port check — a
    // listening socket says nothing about whether it can reach PostgreSQL.
    const deadline = Date.now() + 45_000;
    let lastError = '';
    while (Date.now() < deadline) {
      const probe = docker([
        'exec', env.postgresContainer,
        'psql', `postgresql://${APP_ROLE}:${passwords.app}@${env.pgbouncerContainer}:6432/${DATABASE_NAME}`,
        '-t', '-c', 'SELECT 1',
      ]);
      if (probe.code === 0) {
        env.pgbouncerHostPort = port;
        env.pooledUrls = {
          migrator: poolUrl(MIGRATOR_ROLE, passwords.migrator),
          app: poolUrl(APP_ROLE, passwords.app),
          platform: poolUrl(PLATFORM_ROLE, passwords.platform),
        };
        env.pgbouncerStatus = 'RUNNING';
        return true;
      }
      lastError = probe.stderr.trim() || probe.stdout.trim();
      const spin = Date.now() + 400;
      while (Date.now() < spin) { /* intentional */ }
    }

    // Capture BOTH streams and the container state. The first failed attempt at
    // this PoC reported an empty log, which said nothing about the actual
    // cause (a password-algorithm mismatch, not a network problem).
    // Grep the WHOLE log for the lines that explain a failure rather than
    // tailing it: with verbose on, the retry loop floods the tail and pushes
    // the one line that says WHY out of view.
    const fullLogs = docker(['logs', env.pgbouncerContainer]);
    const interesting = `${fullLogs.stdout}\n${fullLogs.stderr}`
      .split('\n')
      .filter((line) => /closing because|login failed|FATAL|ERROR|WARNING|cannot|failed to|no such|refused/i.test(line))
      .slice(0, 20)
      .join('\n      ');
    const logs = { stdout: interesting, stderr: '' };
    const state = docker(['inspect', '--format', '{{.State.Status}} exit={{.State.ExitCode}}', env.pgbouncerContainer]);
    env.pgbouncerStatus = 'BLOCKED_EXTERNAL_ENVIRONMENT';
    env.pgbouncerBlockReason =
      `PgBouncer did not accept a connection within 45s.\n` +
      `      last client error: ${lastError}\n` +
      `      container state:   ${state.stdout.trim()}\n` +
      `      container stdout:  ${logs.stdout.trim() || '(empty)'}\n` +
      `      container stderr:  ${logs.stderr.trim() || '(empty)'}`;
    return false;
  } catch (err) {
    env.pgbouncerStatus = 'BLOCKED_EXTERNAL_ENVIRONMENT';
    env.pgbouncerBlockReason = err instanceof Error ? err.message : String(err);
    return false;
  }
}

export function teardownPocEnvironment(env: PocEnvironment): void {
  docker(['rm', '-f', env.pgbouncerContainer]);
  docker(['rm', '-f', env.postgresContainer]);
  docker(['network', 'rm', env.networkName]);
  try {
    rmSync(env.scratchDir, { recursive: true, force: true });
  } catch {
    // A leftover temp directory is not worth failing a teardown over; it holds
    // only generated throwaway credentials for containers that no longer exist.
  }
}
