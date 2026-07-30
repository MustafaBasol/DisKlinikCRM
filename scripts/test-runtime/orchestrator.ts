#!/usr/bin/env node
/**
 * F1-003-P2 — Disposable PostgreSQL and MinIO test-runtime orchestrator.
 *
 * Test/dev tooling only. Never imported by application runtime. See
 * docs/program/evidence/F1-003-P2_DISPOSABLE_RUNTIME_IMPLEMENTATION_AND_VERIFICATION.md
 * for the full contract this implements.
 *
 * Usage (from repo root):
 *   npx tsx scripts/test-runtime/orchestrator.ts postgres
 *   npx tsx scripts/test-runtime/orchestrator.ts postgres-compat
 *     (F1-003-P3-R1: same disposable-PostgreSQL provisioning/guard/migration/
 *     cleanup path as `postgres`, but runs `server:test:legacy-db-required`
 *     instead of `server:test:disposable-db` - the 23 scripts legacy
 *     `server:test` silently chains that are PostgreSQL-required/MinIO-free
 *     and were not members of any disposable-runtime-safe aggregate before
 *     this task. Legacy `server:test` itself is untouched.)
 *   npx tsx scripts/test-runtime/orchestrator.ts storage
 *   npx tsx scripts/test-runtime/orchestrator.ts verify-parallel
 *   npx tsx scripts/test-runtime/orchestrator.ts cleanup-stale [--live] [--ttl-hours=4]
 *
 * Failure-injection (test-only, for acceptance-criteria verification):
 *   npx tsx scripts/test-runtime/orchestrator.ts postgres --inject-failure=test
 *   npx tsx scripts/test-runtime/orchestrator.ts postgres --inject-failure=migration
 *   npx tsx scripts/test-runtime/orchestrator.ts postgres --inject-failure=readiness
 *   npx tsx scripts/test-runtime/orchestrator.ts postgres --inject-failure=cleanup
 *   npx tsx scripts/test-runtime/orchestrator.ts verify-parallel --inject-failure=parent-generate
 *     (F1-003-P2-R2: forces the single parent-level `prisma generate` step to
 *     fail deterministically — verifies zero children/Docker resources are
 *     created when generation fails, before any fan-out.)
 * Production-endpoint-guard failure injection is exercised by pre-setting a
 * fake DATABASE_URL in the invoking environment (see evidence doc) — no flag
 * needed, since the guard rejects any inherited override unconditionally.
 */
import {
  generateRunId,
  containerName,
  networkName,
  databaseName,
  dbUsername,
  bucketName,
  generateSecret,
  generateAccessKeyId,
} from './lib/naming.js';
import { buildLabels, labelArgs } from './lib/labels.js';
import { provisionPostgres, waitForPostgresReady, POSTGRES_IMAGE, type PostgresInstance } from './lib/postgres.js';
import { provisionMinio, waitForMinioReady, MINIO_IMAGE_REF, type MinioInstance } from './lib/minio.js';
import { assertSafeDatabaseUrl, assertSafeMinioEndpoint, assertNoInheritedOverride } from './lib/guard.js';
import { runMigrations, runNpmScript, runInjectedFailingCommand } from './lib/process.js';
import { teardown, type TeardownTargets } from './lib/cleanup.js';
import { registerCleanupTargets, unregisterCleanupTargets, runSignalCleanupOnce } from './lib/cleanupRegistry.js';
import { combineOutcome, type TestPhaseResult, type CleanupResult } from './lib/outcome.js';
import { runSweep } from './lib/sweep.js';
import { assertValidProfile, isValidInjectFailureMode, resolvePostgresOnlyTestScript, type InjectableFailureMode } from './lib/profiles.js';
import { maybeWriteSummaryFile } from './lib/summaryFile.js';
import { redactConnectionUrl } from './lib/redact.js';
import { dockerAvailable, dockerCreateNetwork, runDockerSync, dockerRemoveContainer } from './lib/docker.js';
import {
  generatePrismaClientOnce,
  isGenerationFailure,
  type GenerationAuthorization,
} from './lib/prismaGeneration.js';

/**
 * F1-003-P2-R3 (optional supply-chain cleanup): the cleanup-failure-injection
 * sidecar previously used the mutable `alpine:latest` tag. Pinned here to the
 * exact digest already resolved and present on this machine (confirmed via
 * `docker image inspect alpine:latest --format '{{index .RepoDigests 0}}'`),
 * so a future `docker pull`/registry update of the `latest` tag can never
 * silently change what this test-only sidecar runs. This container is never
 * part of the actual disposable PostgreSQL/MinIO runtime under test — it
 * exists only to force a genuine `docker network rm` failure for the
 * `--inject-failure=cleanup` acceptance test (see the comment at its call
 * site), and is removed as test-harness hygiene immediately after that
 * measurement is taken.
 */
const CLEANUP_FAILURE_SIDECAR_IMAGE = 'alpine@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b';

interface RunOptions {
  profile: 'postgres' | 'postgres-compat' | 'storage';
  injectFailures?: InjectableFailureMode[];
  readinessTimeoutMs?: number;
  /**
   * A token from a parent-level generatePrismaClientOnce() call (used by
   * verify-parallel to eliminate the concurrent `prisma generate` race —
   * see F1-003-P2-R2). Absent for standalone postgres/storage invocations,
   * which continue to generate their own client exactly as before.
   */
  generationAuthorization?: GenerationAuthorization;
}

interface RunSummary {
  runId: string;
  profile: string;
  containerNames: string[];
  networkName: string;
  hostPorts: Record<string, number>;
  databaseName: string;
  migration: { code: number; step: string } | null;
  test: { scriptName: string; code: number } | null;
  cleanup: CleanupResult;
  outcome: { exitCode: number; reasons: string[] };
}

/**
 * F1-003-P2-R3: signal cleanup now goes through the concurrency-safe
 * registry (lib/cleanupRegistry.ts) instead of a single global
 * `activeCleanupTargets` slot. `runSignalCleanupOnce()` snapshots and
 * attempts teardown for EVERY currently-registered invocation (not just the
 * most recently started one), and caches its in-flight promise so a second
 * SIGINT/SIGTERM delivered mid-teardown does not start an overlapping pass.
 */
async function handleTerminationSignal(signal: string, exitCode: number): Promise<void> {
  console.error(`\n[test-runtime] Received ${signal} — attempting best-effort cleanup before exit (no guarantee survives a hard kill/daemon crash).`);
  const outcomes = await runSignalCleanupOnce().catch(() => []);
  const failed = outcomes.filter((o) => !o.result.success);
  if (failed.length > 0) {
    console.error(
      `[test-runtime] Cleanup failed for ${failed.length}/${outcomes.length} run(s): ${failed.map((f) => f.runId).join(', ')}`,
    );
  } else if (outcomes.length > 0) {
    console.error(`[test-runtime] Cleanup attempted for ${outcomes.length} run(s): ${outcomes.map((o) => o.runId).join(', ')}`);
  }
  process.exit(exitCode);
}
process.on('SIGINT', () => {
  void handleTerminationSignal('SIGINT', 130);
});
process.on('SIGTERM', () => {
  void handleTerminationSignal('SIGTERM', 143);
});

async function runDisposableProfile(opts: RunOptions): Promise<RunSummary> {
  const scopeTag = opts.profile;
  const { runId, createdAt } = generateRunId();
  const labels = buildLabels({ runId, profile: opts.profile, createdAt });

  const cleanupTargets: TeardownTargets = {
    containerNames: [],
    networkNames: [],
    tempDirs: [],
  };
  let cleanupFailureSidecar: string | undefined;

  let migrationResult: { code: number; step: string } | null = null;
  let testResult: { scriptName: string; code: number } | null = null;
  let testPhase: TestPhaseResult = { ranTests: false, testExitCode: null };
  let pg: PostgresInstance | undefined;
  let minio: MinioInstance | undefined;
  let netName: string | undefined;

  try {
    // Registered before any Docker resource is created (F1-003-P2-R3):
    // this invocation's own runId keys its entry in the concurrency-safe
    // registry, so a signal arriving while multiple profiles run in
    // parallel (verify-parallel's Promise.all pairs) can find and attempt
    // teardown for every active invocation, not just the last one to run.
    registerCleanupTargets(runId, cleanupTargets);

    // Production-like endpoint guard: reject any inherited DATABASE_URL/MinIO
    // override immediately, fail closed, before any Docker command or network
    // access of any kind.
    assertNoInheritedOverride(process.env);

    const dockerStatus = dockerAvailable();
    if (!dockerStatus.available) {
      throw new Error(`Docker is not available (${dockerStatus.detail}) — cannot provision disposable runtime`);
    }

    netName = networkName(scopeTag, runId);
    const netResult = dockerCreateNetwork(netName, labelArgs(labels));
    if (netResult.code !== 0) throw new Error(`Failed to create disposable-runtime network: ${netResult.stderr.trim()}`);
    cleanupTargets.networkNames.push(netName);

    if (opts.injectFailures?.includes('cleanup')) {
      // Genuine (not fabricated) cleanup-failure injection: attach an
      // untracked sidecar container to this run's network. Docker refuses
      // `network rm` while any endpoint is still attached, so the real
      // teardown path below genuinely fails at the network-removal step —
      // `docker rm -f` is idempotent (exit 0 even on an already-removed
      // container), so a fake-removal trick would not produce a real failure.
      cleanupFailureSidecar = `${netName}-sidecar`;
      const sidecarResult = runDockerSync([
        'run', '-d', '--name', cleanupFailureSidecar, '--network', netName, CLEANUP_FAILURE_SIDECAR_IMAGE, 'sleep', '300',
      ]);
      if (sidecarResult.code !== 0) {
        throw new Error(`Failed to start cleanup-failure-injection sidecar: ${sidecarResult.stderr.trim()}`);
      }
    }

    const pgContainerName = containerName('pg', scopeTag, runId);
    const dbName = databaseName(scopeTag, runId);
    const username = dbUsername(scopeTag, runId);
    const password = generateSecret();
    cleanupTargets.containerNames.push(pgContainerName);

    pg = provisionPostgres({
      containerName: pgContainerName,
      databaseName: dbName,
      username,
      password,
      labels,
      networkName: netName,
    });

    assertSafeDatabaseUrl(pg.databaseUrl, { runId });

    const readinessTimeout = opts.injectFailures?.includes('readiness') ? 200 : opts.readinessTimeoutMs ?? 60_000;
    await waitForPostgresReady(pgContainerName, username, dbName, readinessTimeout);

    if (opts.profile === 'storage') {
      const minioContainerName = containerName('minio', scopeTag, runId);
      const accessKey = generateAccessKeyId();
      const secretKey = generateSecret();
      cleanupTargets.containerNames.push(minioContainerName);

      minio = provisionMinio({ containerName: minioContainerName, accessKey, secretKey, labels, networkName: netName });
      assertSafeMinioEndpoint(minio.endpoint);
      await waitForMinioReady(minio.hostPort, readinessTimeout);
    }

    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: pg.databaseUrl };
    if (minio) {
      env.MINIO_ENDPOINT = minio.endpoint;
      env.MINIO_ACCESS_KEY = minio.accessKey;
      env.MINIO_SECRET_KEY = minio.secretKey;
    }

    if (opts.injectFailures?.includes('migration')) {
      // Controlled, invalid disposable DB config: a loopback address with no
      // listener (privileged/unbound port), producing a genuine ECONNREFUSED
      // at `prisma migrate deploy` time rather than a fabricated failure.
      env.DATABASE_URL = `postgresql://${username}:${password}@127.0.0.1:1/${dbName}?schema=public`;
    }

    migrationResult = await runMigrations(env, { authorization: opts.generationAuthorization });
    if (migrationResult.code !== 0) {
      throw new Error(`migration failed at step "${migrationResult.step}" (exit ${migrationResult.code})`);
    }

    const scriptName =
      opts.profile === 'storage' ? 'server:test:storage-integration' : resolvePostgresOnlyTestScript(opts.profile);
    const execResult =
      opts.injectFailures?.includes('test') ? await runInjectedFailingCommand(env) : await runNpmScript(scriptName, env);
    testResult = { scriptName, code: execResult.code };
    testPhase = { ranTests: true, testExitCode: execResult.code };
  } catch (err) {
    if (!testPhase.ranTests) {
      testPhase = {
        ranTests: false,
        testExitCode: null,
        setupFailureReason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const cleanupResult = await teardown(cleanupTargets);
  unregisterCleanupTargets(runId);
  const outcome = combineOutcome(testPhase, cleanupResult);

  if (cleanupFailureSidecar) {
    // Test-harness hygiene only — removes the injection sidecar and retries
    // network removal for real, so this verification run does not itself
    // leak resources. This happens AFTER combineOutcome, so it never affects
    // the measured/reported cleanup outcome above.
    dockerRemoveContainer(cleanupFailureSidecar);
    if (netName) runDockerSync(['network', 'rm', netName]);
  }

  const hostPorts: Record<string, number> = {};
  if (pg) hostPorts.postgres = pg.hostPort;
  if (minio) hostPorts.minio = minio.hostPort;

  return {
    runId,
    profile: opts.profile,
    containerNames: cleanupTargets.containerNames,
    networkName: netName ?? '(none)',
    hostPorts,
    databaseName: pg?.databaseName ?? databaseName(scopeTag, runId),
    migration: migrationResult,
    test: testResult,
    cleanup: cleanupResult,
    outcome,
  };
}

interface CollisionCheck {
  uniqueRunIds: boolean;
  uniqueContainerNames: boolean;
  uniqueDatabaseNames: boolean;
  uniqueHostPorts: boolean;
}

function checkNoCollision(summaries: RunSummary[]): CollisionCheck {
  const runIds = summaries.map((s) => s.runId);
  const containerNamesFlat = summaries.flatMap((s) => s.containerNames);
  const dbNames = summaries.map((s) => s.databaseName);
  const ports = summaries.flatMap((s) => Object.values(s.hostPorts));
  return {
    uniqueRunIds: new Set(runIds).size === runIds.length,
    uniqueContainerNames: new Set(containerNamesFlat).size === containerNamesFlat.length,
    uniqueDatabaseNames: new Set(dbNames).size === dbNames.length,
    uniqueHostPorts: new Set(ports).size === ports.length,
  };
}

interface VerifyParallelResult {
  generation: { succeeded: boolean; code: number };
  postgresPair: RunSummary[];
  storagePair: RunSummary[];
  collisionCheck: CollisionCheck;
  reasons: string[];
}

const VACUOUS_COLLISION_CHECK: CollisionCheck = {
  uniqueRunIds: true,
  uniqueContainerNames: true,
  uniqueDatabaseNames: true,
  uniqueHostPorts: true,
};

/**
 * F1-003-P2-R2: `prisma generate` is run exactly ONCE here, before any child
 * is spawned, eliminating the concurrent-generate race that previously hit
 * a real Windows EBUSY inside the storage pair (2-way concurrency at that
 * point — not full 4-way, since the postgres pair completes and tears down
 * before the storage pair starts). Generation failure aborts before any
 * Docker resource is created — zero children run.
 */
async function runVerifyParallel(injectFailures: InjectableFailureMode[] = []): Promise<VerifyParallelResult> {
  const generationEnv: NodeJS.ProcessEnv = { ...process.env };
  if (injectFailures.includes('parent-generate')) {
    generationEnv.NMTEST_INJECT_PARENT_GENERATE_FAILURE = '1';
  }

  const generation = await generatePrismaClientOnce(generationEnv);
  if (isGenerationFailure(generation)) {
    return {
      generation: { succeeded: false, code: generation.code },
      postgresPair: [],
      storagePair: [],
      collisionCheck: VACUOUS_COLLISION_CHECK,
      reasons: [
        `parent prisma generate failed (exit ${generation.code}) before any child was started — zero Docker resources created`,
      ],
    };
  }

  const postgresPair = await Promise.all([
    runDisposableProfile({ profile: 'postgres', generationAuthorization: generation }),
    runDisposableProfile({ profile: 'postgres', generationAuthorization: generation }),
  ]);
  const storagePair = await Promise.all([
    runDisposableProfile({ profile: 'storage', generationAuthorization: generation }),
    runDisposableProfile({ profile: 'storage', generationAuthorization: generation }),
  ]);
  const collisionCheck = checkNoCollision([...postgresPair, ...storagePair]);
  return { generation: { succeeded: true, code: 0 }, postgresPair, storagePair, collisionCheck, reasons: [] };
}

function redactSummary(summary: RunSummary): RunSummary {
  // No connection string/secret is ever stored on RunSummary itself — this
  // exists as an explicit, auditable no-op boundary rather than relying on
  // "we never put it there" alone.
  return summary;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const profileArg = args[0];
  const injectFlags = args.filter((a) => a.startsWith('--inject-failure=')).map((a) => a.split('=')[1]);
  for (const raw of injectFlags) {
    if (!isValidInjectFailureMode(raw)) {
      console.error(`Invalid --inject-failure value: "${raw}"`);
      process.exitCode = 2;
      return;
    }
  }
  const injectFailures = injectFlags as InjectableFailureMode[];

  if (profileArg === 'cleanup-stale') {
    const dryRun = !args.includes('--live');
    const ttlArg = args.find((a) => a.startsWith('--ttl-hours='));
    const ttlHoursOverride = ttlArg ? ttlArg.split('=')[1] : undefined;
    const report = runSweep({ dryRun, ttlHoursOverride });
    console.log(JSON.stringify(report, null, 2));
    maybeWriteSummaryFile(args, report);
    process.exitCode = report.errors.length > 0 ? 1 : 0;
    return;
  }

  const profile = assertValidProfile(profileArg);

  if (profile === 'verify-parallel') {
    const result = await runVerifyParallel(injectFailures);
    const redactedResult = { ...result, postgresPair: result.postgresPair.map(redactSummary), storagePair: result.storagePair.map(redactSummary) };
    console.log(JSON.stringify(redactedResult, null, 2));
    maybeWriteSummaryFile(args, redactedResult);
    const allChildrenRan = result.postgresPair.length === 2 && result.storagePair.length === 2;
    const allOutcomesOk = allChildrenRan && [...result.postgresPair, ...result.storagePair].every((s) => s.outcome.exitCode === 0);
    const noCollision = Object.values(result.collisionCheck).every(Boolean);
    process.exitCode = result.generation.succeeded && allChildrenRan && allOutcomesOk && noCollision ? 0 : 1;
    return;
  }

  if (profile !== 'postgres' && profile !== 'postgres-compat' && profile !== 'storage') {
    console.error(`Profile "${profile}" is not a single-invocation disposable profile.`);
    process.exitCode = 2;
    return;
  }

  const summary = await runDisposableProfile({
    profile,
    injectFailures: injectFailures.length > 0 ? injectFailures : undefined,
  });
  const redacted = redactSummary(summary);
  console.log(JSON.stringify(redacted, null, 2));
  maybeWriteSummaryFile(args, redacted);
  process.exitCode = summary.outcome.exitCode;
}

void main().catch((err) => {
  console.error('[test-runtime] Fatal orchestrator error:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

export { redactConnectionUrl, POSTGRES_IMAGE, MINIO_IMAGE_REF, bucketName };
