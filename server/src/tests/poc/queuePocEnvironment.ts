/**
 * queuePocEnvironment.ts — disposable environment for the F5-1P queue-platform PoC.
 *
 * Brings up PostgreSQL 16 and Redis 7.0 in throwaway Docker containers, applies
 * the PoC-only schema, hands out clients, and destroys everything at the end.
 *
 * Non-negotiables, enforced here rather than merely documented:
 *   - Credentials and ports are GENERATED per run. Nothing reads DATABASE_URL
 *     or REDIS_URL from the environment or from any .env file, so this harness
 *     structurally cannot reach production. assertNoProductionEnvLeak() fails
 *     the run if a caller ever tries.
 *   - Containers bind to 127.0.0.1 only, on non-default ports.
 *   - Storage is tmpfs; nothing survives the run.
 *   - Teardown runs in a finally block, including on failure.
 *
 * This file is test-only. It is never imported by any runtime path.
 */

import { spawn } from 'child_process';
import { randomBytes, randomUUID } from 'crypto';
import { createServer } from 'net';
import { fileURLToPath } from 'url';
import path from 'path';
import { Client, Pool } from 'pg';
import { readFile } from 'fs/promises';
import { closeAllQueueResources } from './queuePocCandidates.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POC_DIR = path.resolve(HERE, '../../../../docs/architecture/poc/f5-1p-queue-platform');
// Compose is invoked with cwd=POC_DIR and a RELATIVE filename on purpose: the
// repository path contains a space, and spawning through a shell concatenates
// argv without quoting, which corrupts an absolute path here.
const COMPOSE_FILE = 'docker-compose.yml';
const SCHEMA_FILE = path.join(POC_DIR, 'sql/01_schema.sql');

export interface PocEnvironment {
  projectName: string;
  pg: { host: string; port: number; user: string; password: string; database: string; url: string };
  redis: { host: string; port: number; password: string };
  pool: Pool;
  /**
   * Stop the Redis container without removing it.
   * `graceful` sends SIGTERM and waits, letting Redis flush its AOF.
   * `kill` is an abrupt SIGKILL, which exposes the appendfsync-everysec
   * loss window.
   */
  stopRedis(mode?: 'graceful' | 'kill'): Promise<void>;
  /** Start it again (reconnect experiments). */
  startRedis(): Promise<void>;
  /** Truncate all PoC tables between experiments. */
  reset(): Promise<void>;
  destroy(): Promise<void>;
}

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export function run(
  cmd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {},
): Promise<CommandResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...opts.env },
      cwd: opts.cwd,
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr?.on('data', (d) => {
      stderr += String(d);
    });
    // Bound with a ref'd timer: AbortSignal.timeout() is unref'd and would let
    // the process exit while a command is still hanging.
    const timer = setTimeout(
      () => {
        child.kill('SIGKILL');
        reject(new Error(`Command timed out after ${opts.timeoutMs ?? 180_000}ms: ${cmd} ${args.join(' ')}`));
      },
      opts.timeoutMs ?? 180_000,
    );
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, durationMs: Date.now() - started });
    });
  });
}

/**
 * Fails the run if anything in this process is pointed at a real database or
 * Redis. The PoC must never inherit a production connection string, so this is
 * checked rather than assumed.
 */
export function assertNoProductionEnvLeak(): void {
  for (const key of ['DATABASE_URL', 'REDIS_URL', 'DIRECT_DATABASE_URL']) {
    const value = process.env[key];
    if (value && value.trim().length > 0) {
      throw new Error(
        `${key} is set in this process. The F5-1P PoC refuses to run with a real ` +
          `connection string present, to guarantee it cannot touch production. ` +
          `Unset it and re-run.`,
      );
    }
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (typeof addr === 'object' && addr) {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('could not allocate a port')));
      }
    });
  });
}

const token = (n = 18) => randomBytes(n).toString('base64url');

async function waitForPostgres(cfg: PocEnvironment['pg'], timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    const client = new Client({ ...cfg, connectionTimeoutMillis: 2_000 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (err) {
      lastErr = err;
      await client.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`PostgreSQL did not become ready in ${timeoutMs}ms: ${String(lastErr)}`);
}

export async function startPocEnvironment(): Promise<PocEnvironment> {
  assertNoProductionEnvLeak();

  const projectName = `noramedi-f5-1p-${randomUUID().slice(0, 8)}`;
  const pgPort = await freePort();
  const redisPort = await freePort();

  const pgCfg = {
    host: '127.0.0.1',
    port: pgPort,
    user: `poc_${randomBytes(4).toString('hex')}`,
    password: token(),
    database: `poc_${randomBytes(4).toString('hex')}`,
    url: '',
  };
  pgCfg.url = `postgresql://${pgCfg.user}:${encodeURIComponent(pgCfg.password)}@127.0.0.1:${pgPort}/${pgCfg.database}`;
  const redisCfg = { host: '127.0.0.1', port: redisPort, password: token() };

  const composeEnv: NodeJS.ProcessEnv = {
    POC_PG_USER: pgCfg.user,
    POC_PG_PASSWORD: pgCfg.password,
    POC_PG_DB: pgCfg.database,
    POC_PG_PORT: String(pgPort),
    POC_REDIS_PORT: String(redisPort),
    POC_REDIS_PASSWORD: redisCfg.password,
  };

  const compose = (args: string[], timeoutMs = 180_000) =>
    run('docker', ['compose', '-f', COMPOSE_FILE, '-p', projectName, ...args], {
      env: composeEnv,
      cwd: POC_DIR,
      timeoutMs,
    });

  const up = await compose(['up', '-d', '--wait']);
  if (up.code !== 0) {
    await compose(['down', '-v', '--remove-orphans']).catch(() => {});
    throw new Error(`docker compose up failed (${up.code}):\n${up.stderr || up.stdout}`);
  }

  await waitForPostgres(pgCfg);

  const pool = new Pool({
    host: pgCfg.host,
    port: pgCfg.port,
    user: pgCfg.user,
    password: pgCfg.password,
    database: pgCfg.database,
    max: 30,
  });

  // A pooled client whose backend is terminated (the PostgreSQL-reconnect
  // experiment does exactly that) emits 'error' on the Pool. Without a listener
  // Node treats it as an unhandled 'error' event and kills the process, which
  // would take the whole run down mid-matrix. Swallow it: pg discards the
  // broken client and opens a new one on the next checkout, which IS the
  // recovery behaviour the experiment is measuring.
  pool.on('error', () => {});

  const schema = await readFile(SCHEMA_FILE, 'utf8');
  await pool.query(schema);

  let destroyed = false;
  const destroyOnce = async () => {
    if (destroyed) return;
    destroyed = true;
    // Order matters. Redis clients are closed while Redis is still
    // running, so each one completes a real QUIT instead of being left
    // reconnecting to a container that no longer exists — which is what
    // previously kept the event loop alive after the run had finished.
    await closeAllQueueResources().catch(() => {});
    await pool.end().catch(() => {});
    await compose(['down', '-v', '--remove-orphans'], 120_000).catch(() => {});
  };

  /**
   * A `finally` block is not enough. An unhandled 'error' event or an uncaught
   * exception terminates the process without unwinding, which during this PoC's
   * development left two containers running for four hours. These handlers make
   * teardown survive a hard crash or a Ctrl-C.
   */
  const emergencyTeardown = (why: string) => (payload?: unknown) => {
    process.stderr.write(`\n[f5-1p] ${why} - destroying disposable environment\n`);
    if (payload instanceof Error) process.stderr.write(`[f5-1p] ${payload.stack ?? payload.message}\n`);
    void destroyOnce().finally(() => process.exit(1));
  };
  process.once('uncaughtException', emergencyTeardown('uncaught exception'));
  process.once('unhandledRejection', emergencyTeardown('unhandled rejection'));
  process.once('SIGINT', emergencyTeardown('SIGINT'));
  process.once('SIGTERM', emergencyTeardown('SIGTERM'));

  const env: PocEnvironment = {
    projectName,
    pg: pgCfg,
    redis: redisCfg,
    pool,
    async stopRedis(mode: 'graceful' | 'kill' = 'graceful') {
      const res =
        mode === 'kill'
          ? await compose(['kill', '-s', 'SIGKILL', 'redis'], 60_000)
          : await compose(['stop', '-t', '10', 'redis'], 60_000);
      if (res.code !== 0) throw new Error(`failed to stop redis (${mode}): ${res.stderr}`);
    },
    async startRedis() {
      const res = await compose(['start', 'redis'], 60_000);
      if (res.code !== 0) throw new Error(`failed to start redis: ${res.stderr}`);
      // Wait for the port to accept connections again.
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const probe = await run(
          'docker',
          ['compose', '-f', COMPOSE_FILE, '-p', projectName, 'exec', '-T', 'redis', 'redis-cli', '-a', redisCfg.password, 'ping'],
          { env: composeEnv, cwd: POC_DIR, timeoutMs: 10_000 },
        ).catch(() => null);
        if (probe && probe.code === 0 && probe.stdout.includes('PONG')) return;
        await new Promise((r) => setTimeout(r, 400));
      }
      throw new Error('redis did not come back within 30s');
    },
    async reset() {
      await pool.query(`
        TRUNCATE poc_appointment, poc_outbox_event, poc_side_effect,
                 poc_side_effect_attempt, poc_dead_letter, poc_inbound_event,
                 poc_metric_sample
        RESTART IDENTITY
      `);
    },
    async destroy() {
      await destroyOnce();
    },
  };

  return env;
}
