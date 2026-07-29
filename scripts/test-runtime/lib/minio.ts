import { runDockerSync, getHostPort, dockerRemoveContainer } from './docker.js';
import { labelArgs, type RuntimeLabels } from './labels.js';

/**
 * Immutable MinIO image reference for the test-runtime "storage" profile.
 * Exact RELEASE tag pinned by digest (not `latest`) per F1-003-P2A §14/§H —
 * resolved and recorded at implementation time via `docker pull` +
 * `docker inspect`:
 *   tag:    RELEASE.2025-04-08T15-41-24Z
 *   digest: sha256:8834ae47a2de3509b83e0e70da9369c24bbbc22de42f2a2eddc530eee88acd1b
 * Selection rationale: first pinned MinIO release resolvable from this
 * environment at implementation time (no prior MinIO use existed in this
 * repository to match against); the tag+digest pair is recorded verbatim so a
 * future run never silently upgrades.
 */
export const MINIO_IMAGE_TAG = 'minio/minio:RELEASE.2025-04-08T15-41-24Z';
export const MINIO_IMAGE_DIGEST = 'sha256:8834ae47a2de3509b83e0e70da9369c24bbbc22de42f2a2eddc530eee88acd1b';
export const MINIO_IMAGE_REF = `minio/minio@${MINIO_IMAGE_DIGEST}`;

export interface MinioInstance {
  containerName: string;
  hostPort: number;
  consolePort: number;
  endpoint: string;
  accessKey: string;
  secretKey: string;
}

export function provisionMinio(opts: {
  containerName: string;
  accessKey: string;
  secretKey: string;
  labels: RuntimeLabels;
  networkName?: string;
}): MinioInstance {
  const args = [
    'run',
    '-d',
    '--name',
    opts.containerName,
    '-p',
    '127.0.0.1::9000',
    '-p',
    '127.0.0.1::9001',
    '-e',
    `MINIO_ROOT_USER=${opts.accessKey}`,
    '-e',
    `MINIO_ROOT_PASSWORD=${opts.secretKey}`,
    ...labelArgs(opts.labels),
  ];
  if (opts.networkName) args.push('--network', opts.networkName);
  args.push(MINIO_IMAGE_REF, 'server', '/data', '--console-address', ':9001');

  const result = runDockerSync(args);
  if (result.code !== 0) {
    throw new Error(`Failed to start disposable MinIO container: ${result.stderr.trim()}`);
  }

  let hostPort: number;
  let consolePort: number;
  try {
    hostPort = getHostPort(opts.containerName, '9000');
    consolePort = getHostPort(opts.containerName, '9001');
  } catch (err) {
    dockerRemoveContainer(opts.containerName);
    throw err;
  }

  return {
    containerName: opts.containerName,
    hostPort,
    consolePort,
    endpoint: `http://127.0.0.1:${hostPort}`,
    accessKey: opts.accessKey,
    secretKey: opts.secretKey,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bounded readiness wait via MinIO's own health endpoint — no indefinite retry. */
export async function waitForMinioReady(hostPort: number, timeoutMs = 60_000, pollIntervalMs = 1_000): Promise<void> {
  const start = Date.now();
  let lastDetail = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${hostPort}/minio/health/ready`);
      if (response.ok) return;
      lastDetail = `HTTP ${response.status}`;
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`MinIO readiness timeout after ${timeoutMs}ms on host port ${hostPort}: ${lastDetail}`);
}
