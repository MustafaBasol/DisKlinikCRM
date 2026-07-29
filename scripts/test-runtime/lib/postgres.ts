import { runDockerSync, getHostPort, dockerRemoveContainer, dockerExec } from './docker.js';
import { labelArgs, type RuntimeLabels } from './labels.js';

/**
 * Provisional test-runtime PostgreSQL image, per the merged F1-003-P2A
 * contract §13 — historical repository precedent (3 prior disposable-Postgres
 * uses all used version-16-family images). Production major-version parity is
 * NOT claimed; see the evidence document's explicit pre-P3/pre-release
 * verification item.
 */
export const POSTGRES_IMAGE = 'postgres:16-alpine';

export interface PostgresInstance {
  containerName: string;
  hostPort: number;
  databaseUrl: string;
  username: string;
  password: string;
  databaseName: string;
}

export function provisionPostgres(opts: {
  containerName: string;
  databaseName: string;
  username: string;
  password: string;
  labels: RuntimeLabels;
  networkName?: string;
}): PostgresInstance {
  const args = [
    'run',
    '-d',
    '--name',
    opts.containerName,
    '-p',
    '127.0.0.1::5432',
    '-e',
    `POSTGRES_DB=${opts.databaseName}`,
    '-e',
    `POSTGRES_USER=${opts.username}`,
    '-e',
    `POSTGRES_PASSWORD=${opts.password}`,
    ...labelArgs(opts.labels),
  ];
  if (opts.networkName) args.push('--network', opts.networkName);
  args.push(POSTGRES_IMAGE);

  const result = runDockerSync(args);
  if (result.code !== 0) {
    throw new Error(`Failed to start disposable PostgreSQL container: ${result.stderr.trim()}`);
  }

  let hostPort: number;
  try {
    hostPort = getHostPort(opts.containerName, '5432');
  } catch (err) {
    dockerRemoveContainer(opts.containerName);
    throw err;
  }

  const databaseUrl = `postgresql://${opts.username}:${opts.password}@127.0.0.1:${hostPort}/${opts.databaseName}?schema=public`;
  return {
    containerName: opts.containerName,
    hostPort,
    databaseUrl,
    username: opts.username,
    password: opts.password,
    databaseName: opts.databaseName,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bounded readiness wait via `pg_isready` inside the container — no indefinite retry. */
export async function waitForPostgresReady(
  containerName: string,
  username: string,
  databaseName: string,
  timeoutMs = 60_000,
  pollIntervalMs = 1_000,
): Promise<void> {
  const start = Date.now();
  let lastDetail = '';
  while (Date.now() - start < timeoutMs) {
    const result = dockerExec(containerName, ['pg_isready', '-U', username, '-d', databaseName]);
    if (result.code === 0) return;
    lastDetail = `${result.stdout.trim()} ${result.stderr.trim()}`.trim();
    await sleep(pollIntervalMs);
  }
  throw new Error(
    `PostgreSQL readiness timeout after ${timeoutMs}ms for container "${containerName}": ${lastDetail || 'no diagnostic output'}`,
  );
}
