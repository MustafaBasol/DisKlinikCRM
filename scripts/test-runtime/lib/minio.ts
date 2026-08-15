import { runDockerSync, getHostPort, dockerRemoveContainer, getContainerNetworkAddress } from './docker.js';
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

/** MinIO's in-container S3 API port (the published host port is Docker-assigned). */
export const MINIO_CONTAINER_API_PORT = 9000;

/**
 * F4-CI-L4-STORAGE-GATE-001 (Lane C) — how the test process addresses the
 * disposable MinIO destination.
 *
 *  - `container-network`: the container's OWN IPv4 address inside this run's
 *    user-defined Docker network (e.g. 172.18.0.3:9000). This is a genuinely
 *    non-loopback network identity in a separate network namespace, so the
 *    UNMODIFIED production predicate `isFileBackupDestinationOffHost()`
 *    answers `true` for it on its own merits. Nothing in production logic is
 *    relaxed to make this work.
 *  - `loopback-fallback`: the Docker-published `127.0.0.1:<hostPort>` mapping.
 *    Used where container networks are not routable from the host (Docker
 *    Desktop on Windows/macOS). In this mode the destination IS the same host,
 *    the production predicate correctly answers `false`, and the suite asserts
 *    that answer rather than pretending otherwise.
 */
export type MinioAddressMode = 'container-network' | 'loopback-fallback';

export interface MinioInstance {
  containerName: string;
  hostPort: number;
  consolePort: number;
  /** The endpoint handed to the suite under test. Never carries credentials. */
  endpoint: string;
  addressMode: MinioAddressMode;
  /** Always present — the published loopback mapping, used as the fallback. */
  loopbackEndpoint: string;
  /** The container's own network address, when Docker reported one. */
  containerAddress: string | null;
  containerEndpoint: string | null;
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

  const loopbackEndpoint = `http://127.0.0.1:${hostPort}`;
  const containerAddress = opts.networkName
    ? getContainerNetworkAddress(opts.containerName, opts.networkName)
    : null;
  const containerEndpoint = containerAddress ? `http://${containerAddress}:${MINIO_CONTAINER_API_PORT}` : null;

  return {
    containerName: opts.containerName,
    hostPort,
    consolePort,
    // Provisional. The orchestrator replaces this with whichever candidate
    // actually answered its health probe (see selectReadyMinioEndpoint) —
    // an address that is not reachable is not a destination.
    endpoint: containerEndpoint ?? loopbackEndpoint,
    addressMode: containerEndpoint ? 'container-network' : 'loopback-fallback',
    loopbackEndpoint,
    containerAddress,
    containerEndpoint,
    accessKey: opts.accessKey,
    secretKey: opts.secretKey,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface MinioEndpointCandidate {
  endpoint: string;
  mode: MinioAddressMode;
}

/** Injectable so the selection logic is unit-testable without Docker or a network. */
export type MinioReadinessProbe = (endpoint: string) => Promise<{ ready: boolean; detail: string }>;

export const defaultMinioReadinessProbe: MinioReadinessProbe = async (endpoint) => {
  try {
    const response = await fetch(`${endpoint}/minio/health/ready`);
    // The body is never read; cancel it explicitly so the connection is not
    // left half-consumed in the global dispatcher's keep-alive pool.
    await response.body?.cancel().catch(() => {});
    return { ready: response.ok, detail: `HTTP ${response.status}` };
  } catch (err) {
    return { ready: false, detail: err instanceof Error ? err.message : String(err) };
  }
};

/**
 * Bounded readiness wait that also DECIDES which address the suite will use.
 *
 * Candidates are probed in order, round-robin, until one answers or the
 * overall budget expires. The container-network candidate is listed first by
 * the orchestrator so the off-host-shaped topology wins whenever it is
 * genuinely reachable; the loopback candidate is the honest fallback.
 *
 * Throws (never returns a "maybe") when nothing became ready — no candidate
 * answering is a hard setup failure, not a silently-degraded run.
 */
export async function selectReadyMinioEndpoint(opts: {
  candidates: readonly MinioEndpointCandidate[];
  timeoutMs?: number;
  pollIntervalMs?: number;
  probe?: MinioReadinessProbe;
  now?: () => number;
}): Promise<MinioEndpointCandidate> {
  const { candidates } = opts;
  if (candidates.length === 0) throw new Error('No MinIO endpoint candidates were supplied');
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 1_000;
  const probe = opts.probe ?? defaultMinioReadinessProbe;
  const now = opts.now ?? Date.now;

  const start = now();
  const lastDetail = new Map<string, string>();
  do {
    for (const candidate of candidates) {
      const result = await probe(candidate.endpoint);
      if (result.ready) return candidate;
      lastDetail.set(candidate.endpoint, result.detail);
    }
    if (now() - start >= timeoutMs) break;
    await sleep(pollIntervalMs);
  } while (now() - start < timeoutMs);

  const detail = candidates
    .map((c) => `${c.mode} ${c.endpoint}: ${lastDetail.get(c.endpoint) ?? 'no diagnostic output'}`)
    .join(' | ');
  throw new Error(`MinIO readiness timeout after ${timeoutMs}ms across all candidate endpoints — ${detail}`);
}

/**
 * Back-compatible single-endpoint readiness wait (loopback host port). Kept so
 * any caller outside this task's scope keeps working unchanged.
 */
export async function waitForMinioReady(hostPort: number, timeoutMs = 60_000, pollIntervalMs = 1_000): Promise<void> {
  await selectReadyMinioEndpoint({
    candidates: [{ endpoint: `http://127.0.0.1:${hostPort}`, mode: 'loopback-fallback' }],
    timeoutMs,
    pollIntervalMs,
  });
}
