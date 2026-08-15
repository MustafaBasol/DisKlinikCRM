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

/**
 * F4-CI-L4-STORAGE-GATE-001-R1 — how an individual probe attempt ended.
 *
 *  - `ready`      the destination answered its health endpoint affirmatively.
 *  - `not-ready`  a transient, retryable answer: connection refused/reset, a
 *                 non-2xx status, a socket that closed mid-handshake. This is
 *                 the NORMAL state while MinIO is still starting up.
 *  - `timeout`    the attempt hit its own hard deadline. Also retryable, but
 *                 reported distinctly because "the probe never answered" and
 *                 "the probe answered 503" are different diagnostics.
 *  - `fatal`      a configuration error no amount of retrying can fix (an
 *                 unparseable endpoint, a protocol this probe cannot speak).
 *                 Retrying it would burn the whole readiness budget to reach
 *                 the same conclusion, so selection aborts immediately.
 */
export type MinioProbeStatus = 'ready' | 'not-ready' | 'timeout' | 'fatal';

export interface MinioProbeResult {
  ready: boolean;
  detail: string;
  /**
   * Optional so a probe injected by a test (or any caller predating this
   * classification) stays assignable: an absent status is read as
   * `ready`/`not-ready` from the boolean, i.e. the previous behaviour.
   */
  status?: MinioProbeStatus;
}

/**
 * Injectable so the selection logic is unit-testable without Docker or a
 * network. The `signal` is advisory — a probe that ignores it is still bounded,
 * because the bound is enforced by the CALLER (see runBoundedProbe). That
 * distinction is the whole point of this task: the readiness loop must not
 * depend on the probe being well-behaved.
 */
export type MinioReadinessProbe = (
  endpoint: string,
  options?: { signal: AbortSignal },
) => Promise<MinioProbeResult>;

/** Raised for a probe outcome that retrying cannot change. */
export class MinioReadinessConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MinioReadinessConfigurationError';
  }
}

/** Raised when every candidate stayed unready for the whole readiness budget. */
export class MinioReadinessTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MinioReadinessTimeoutError';
  }
}

/**
 * Hard ceiling for ONE probe attempt. Deliberately far below the default
 * 60s overall budget so a stalled attempt costs a retry, not the whole run.
 */
export const DEFAULT_PROBE_ATTEMPT_TIMEOUT_MS = 10_000;

function describeFailure(err: unknown): string {
  if (err instanceof Error) {
    // undici nests the useful code (ECONNREFUSED/ECONNRESET/UND_ERR_SOCKET)
    // under `cause`; the bare message is always the useless "fetch failed".
    const cause = (err as { cause?: unknown }).cause;
    const code =
      cause && typeof cause === 'object' && 'code' in cause ? String((cause as { code: unknown }).code) : undefined;
    return code ? `${err.message} (${code})` : err.message;
  }
  return String(err);
}

export const defaultMinioReadinessProbe: MinioReadinessProbe = async (endpoint, options) => {
  let url: URL;
  try {
    url = new URL(`${endpoint}/minio/health/ready`);
  } catch {
    return { ready: false, status: 'fatal', detail: `"${endpoint}" is not a usable URL` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ready: false, status: 'fatal', detail: `unsupported endpoint protocol "${url.protocol}"` };
  }

  try {
    const response = await fetch(url, { signal: options?.signal, cache: 'no-store', redirect: 'manual' });
    // The body is never read; cancel it explicitly so the connection is not
    // left half-consumed in the global dispatcher's keep-alive pool.
    await response.body?.cancel().catch(() => {});
    return {
      ready: response.ok,
      status: response.ok ? 'ready' : 'not-ready',
      detail: `HTTP ${response.status}`,
    };
  } catch (err) {
    // Every network-level failure is retryable: a destination that is still
    // starting up refuses, resets, or drops connections. Only the URL/protocol
    // checks above are fatal.
    return { ready: false, status: 'not-ready', detail: describeFailure(err) };
  }
};

function classifyProbeResult(result: MinioProbeResult): MinioProbeStatus {
  if (result.status) return result.status;
  return result.ready ? 'ready' : 'not-ready';
}

/**
 * F4-CI-L4-STORAGE-GATE-001-R1 — the load-bearing fix.
 *
 * Root cause this closes: on Node 20 (the version Layer 4 pins) the bundled
 * undici DROPS a `fetch()` whose TCP connection is accepted and then closed by
 * the peer before a single response byte is written — exactly what a
 * just-published Docker port does while the container process is still coming
 * up. The returned promise never settles AND undici keeps no ref'd libuv
 * handle, so the readiness loop parks on `await probe(...)` forever with an
 * empty event loop: Node fires `beforeExit`/`exit` with the run still pending.
 * That is the 42ms drain observed on PR #423 (run 31893589449, job
 * 95040001240), which the orchestrator's trap correctly converted to exit 91.
 *
 * So the bound cannot live inside the probe, and it cannot be an
 * `AbortSignal`:
 *
 *  - The bound must be enforced by the CALLER, because the promise being
 *    waited on may never settle no matter what the callee intended.
 *  - `AbortSignal.timeout()` is the obvious tool and is the WRONG one here.
 *    Its timer is unref'd by design ("will not keep the Node.js event loop
 *    active" — verified on both Node 20.20.2 and 24.18.0), so in an otherwise
 *    empty event loop the process drains BEFORE the abort ever fires. It
 *    cannot rescue a dropped promise; it would leave this bug exactly as it
 *    was. An explicit AbortController plus a normal, ref'd `setTimeout` is
 *    required — the ref'd timer is what keeps the loop alive long enough for
 *    the deadline to win the race.
 *
 * The race — not the abort — is what guarantees settlement. The abort is
 * best-effort tidy-up so a merely-slow (rather than dropped) request stops
 * occupying a socket.
 */
export async function runBoundedProbe(
  probe: MinioReadinessProbe,
  endpoint: string,
  attemptTimeoutMs: number,
): Promise<MinioProbeResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const deadline = new Promise<MinioProbeResult>((resolve) => {
      timer = setTimeout(() => {
        try {
          controller.abort();
        } catch {
          /* aborting is best-effort; it must never break a probe attempt */
        }
        resolve({
          ready: false,
          status: 'timeout',
          detail: `no answer within the ${attemptTimeoutMs}ms probe attempt timeout`,
        });
      }, attemptTimeoutMs);
      // NOT unref'd, on purpose. See the doc comment above: an unref'd timer
      // here re-opens the exact drain this function exists to close.
    });

    // Both handlers are attached in one `.then(onFulfilled, onRejected)`, so
    // `attempt` NEVER rejects. That matters beyond tidiness: when the deadline
    // wins, `attempt` stays pending and may reject later, and a stray late
    // rejection would hit the orchestrator's `unhandledRejection` trap and
    // kill the process with exit 92.
    const attempt: Promise<MinioProbeResult> = Promise.resolve()
      .then(() => probe(endpoint, { signal: controller.signal }))
      .then(
        (result) => result,
        (err) => ({ ready: false, status: 'not-ready' as const, detail: describeFailure(err) }),
      );

    return await Promise.race([attempt, deadline]);
  } finally {
    // Deterministic teardown on every exit path — resolved, timed out, or
    // thrown. Nothing is left armed to hold the event loop open afterwards.
    if (timer !== undefined) clearTimeout(timer);
  }
}

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
 *
 * F4-CI-L4-STORAGE-GATE-001-R1: every attempt now goes through
 * runBoundedProbe, so this loop's progress never depends on the probe
 * settling. A hung/dropped attempt becomes an ordinary `timeout` result and
 * the loop retries; it can no longer park the process. `attemptTimeoutMs` is
 * additionally clamped to the budget still remaining, so the overall wall
 * clock stays bounded by `timeoutMs` rather than by
 * `timeoutMs + candidates.length * attemptTimeoutMs`.
 */
export async function selectReadyMinioEndpoint(opts: {
  candidates: readonly MinioEndpointCandidate[];
  timeoutMs?: number;
  pollIntervalMs?: number;
  /** Hard ceiling per individual attempt. Defaults to DEFAULT_PROBE_ATTEMPT_TIMEOUT_MS. */
  attemptTimeoutMs?: number;
  probe?: MinioReadinessProbe;
  now?: () => number;
}): Promise<MinioEndpointCandidate> {
  const { candidates } = opts;
  if (candidates.length === 0) throw new Error('No MinIO endpoint candidates were supplied');
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 1_000;
  const probe = opts.probe ?? defaultMinioReadinessProbe;
  const now = opts.now ?? Date.now;
  const attemptTimeoutMs = Math.max(1, opts.attemptTimeoutMs ?? DEFAULT_PROBE_ATTEMPT_TIMEOUT_MS);

  const start = now();
  const lastDetail = new Map<string, string>();
  const remaining = (): number => timeoutMs - (now() - start);

  do {
    for (const candidate of candidates) {
      // Never let a single attempt outlive the budget it is spending.
      const attemptBudget = Math.max(1, Math.min(attemptTimeoutMs, remaining()));
      const result = await runBoundedProbe(probe, candidate.endpoint, attemptBudget);
      const status = classifyProbeResult(result);
      if (status === 'ready') return candidate;
      if (status === 'fatal') {
        // Not retryable by definition — fail now, with the reason, instead of
        // spending the remaining budget re-learning it.
        throw new MinioReadinessConfigurationError(
          `MinIO readiness probe hit a fatal configuration error for ${candidate.mode} ${candidate.endpoint}: ${result.detail}`,
        );
      }
      lastDetail.set(candidate.endpoint, `${status} — ${result.detail}`);
    }
    if (remaining() <= 0) break;
    await sleep(Math.max(0, Math.min(pollIntervalMs, remaining())));
  } while (remaining() > 0);

  const detail = candidates
    .map((c) => `${c.mode} ${c.endpoint}: ${lastDetail.get(c.endpoint) ?? 'no diagnostic output'}`)
    .join(' | ');
  throw new MinioReadinessTimeoutError(
    `MinIO readiness timeout after ${timeoutMs}ms across all candidate endpoints — ${detail}`,
  );
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
