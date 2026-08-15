/**
 * F4-CI-L4-STORAGE-GATE-001-R1 — mutation/negative proof harness.
 *
 * Spawned as a child process by minioReadiness.test.ts. It reproduces the
 * orchestrator's fail-closed trap around ONE readiness call, so the two
 * readiness shapes can be compared as whole-process outcomes rather than as
 * in-process assertions:
 *
 *   legacy-unbounded  the pre-R1 loop shape — `await probe(endpoint)` with no
 *                     caller-side bound. Must reproduce the PR #423 failure:
 *                     the event loop drains with the run still pending and the
 *                     trap forces exit 91.
 *   bounded           the shipped `selectReadyMinioEndpoint`. Must terminate
 *                     normally with a deterministic readiness failure.
 *
 * The `legacy-unbounded` branch is the only place the unbounded shape still
 * exists in this repository. It is kept deliberately: if someone reverts the
 * bound, the `bounded` branch starts behaving like this one and the test that
 * pins them apart goes red.
 *
 * The probe here never settles. That is not a contrivance — it is exactly what
 * Node 20's bundled undici does to a `fetch()` whose TCP connection is
 * accepted and then closed by the peer before any response byte is written
 * (a just-published Docker port whose container is still starting). Modelling
 * it as a never-settling promise makes the proof deterministic on every Node
 * version, including ones where that undici bug is already fixed.
 *
 * Not run directly. Usage: tsx readinessDrainHarness.ts <mode>
 */
import { writeSync } from 'node:fs';
import { EXIT_ABNORMAL_TERMINATION } from '../../lib/outcome.js';
import {
  selectReadyMinioEndpoint,
  type MinioEndpointCandidate,
  type MinioReadinessProbe,
} from '../../lib/minio.js';

const mode = process.argv[2];

// ── The fail-closed trap, mirroring orchestrator.ts ──────────────────────────
let runCompleted = false;
let currentStage = 'process-start';

function writeSyncStderr(message: string): void {
  try {
    writeSync(2, message.endsWith('\n') ? message : `${message}\n`);
  } catch {
    /* ignore */
  }
}

process.on('beforeExit', () => {
  if (!runCompleted) writeSyncStderr(`HARNESS_DRAINED_AT:${currentStage}`);
});

process.on('exit', (code) => {
  if (runCompleted) return;
  if (code === 0) {
    writeSyncStderr(`HARNESS_FORCED_EXIT_AT:${currentStage}`);
    process.exitCode = EXIT_ABNORMAL_TERMINATION;
  }
});

/** Never settles, and holds no ref'd libuv handle — see the file header. */
const neverSettlingProbe: MinioReadinessProbe = () => new Promise<never>(() => {});

const candidates: MinioEndpointCandidate[] = [{ endpoint: 'http://172.18.0.3:9000', mode: 'container-network' }];

async function main(): Promise<void> {
  currentStage = 'storage:minio-readiness';

  if (mode === 'legacy-unbounded') {
    // Verbatim pre-R1 shape. Control never returns from this await.
    const result = await neverSettlingProbe(candidates[0].endpoint);
    console.log(`HARNESS_LEGACY_REACHED_UNREACHABLE_LINE ${JSON.stringify(result)}`);
    runCompleted = true;
    return;
  }

  if (mode === 'bounded') {
    try {
      await selectReadyMinioEndpoint({
        candidates,
        probe: neverSettlingProbe,
        timeoutMs: 300,
        pollIntervalMs: 10,
        attemptTimeoutMs: 50,
      });
      console.log('HARNESS_BOUNDED_UNEXPECTED_SUCCESS');
    } catch (err) {
      console.log(`HARNESS_BOUNDED_FAILED_DETERMINISTICALLY ${err instanceof Error ? err.name : String(err)}`);
    }
    runCompleted = true;
    return;
  }

  writeSyncStderr(`HARNESS_UNKNOWN_MODE:${String(mode)}`);
  process.exitCode = 2;
  runCompleted = true;
}

void main();
