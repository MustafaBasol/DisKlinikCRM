/**
 * readiness.ts — F3-OBS-001: explicit, tested readiness decision for GET /readyz.
 *
 * Before this, the only dependency probe was `/api/health`'s inline
 * `prisma.$queryRaw` call directly inside index.ts — untested in isolation
 * and not reusable by a dedicated readiness endpoint. This extracts the
 * decision (which dependencies are mandatory, how each is checked, how
 * failures are reported) into a pure function so it can be unit-tested with
 * injected fake checks, mirroring the existing
 * resolveApiBackgroundJobsOwnership()/resolveWorkerBackgroundJobsOwnership()
 * pattern (utils/backgroundJobsOwnership.ts).
 *
 * Mandatory-vs-optional dependency policy (deliberate, matches existing
 * runtime behavior elsewhere in this codebase — not invented here):
 *   - Database: MANDATORY. Every request handler needs Prisma; if it is
 *     unreachable the API cannot serve traffic. A failed DB check fails
 *     readiness (503).
 *   - Redis: OPTIONAL. utils/redis.ts already documents Redis as an optional
 *     shared rate-limit store with an in-memory fallback when REDIS_URL is
 *     unset, and `getRedis()` itself is fail-open (`enableOfflineQueue:
 *     false`, callers fall back rather than block) when REDIS_URL *is* set
 *     but the connection drops. Making Redis unavailability fail /readyz
 *     would contradict that existing fail-open design and could take a
 *     healthy API out of a load balancer's rotation over a non-critical
 *     dependency. When REDIS_URL is configured, its reachability is still
 *     reported in the response body for operator visibility — just not
 *     treated as a readiness-blocking condition.
 *
 * No secrets are ever included in the result: only a fixed, closed set of
 * reason codes (never a raw driver/connection-string error message).
 */

export type DependencyCheckStatus = 'ok' | 'fail' | 'skipped';

export interface DependencyCheckResult {
  name: string;
  status: DependencyCheckStatus;
  /** Fixed reason code only — never the raw error/exception message. */
  reason?: 'timeout' | 'error' | 'not_configured';
}

export interface ReadinessResult {
  status: 'ok' | 'degraded';
  checks: DependencyCheckResult[];
}

export interface ReadinessDeps {
  /** Resolves/rejects; rejection or timeout is treated as a DB failure. */
  checkDatabase: () => Promise<unknown>;
  /**
   * Optional Redis reachability probe. Return `null` (not a function) when
   * REDIS_URL is not configured — evaluateReadiness reports it as
   * `skipped`/`not_configured` rather than calling anything.
   */
  checkRedis?: (() => Promise<unknown>) | null;
  /** Per-check timeout; defaults to 3000ms (matches the pre-existing /api/health budget). */
  timeoutMs?: number;
}

async function withTimeout(fn: () => Promise<unknown>, timeoutMs: number): Promise<'ok' | 'timeout' | 'error'> {
  try {
    await Promise.race([
      fn(),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return 'ok';
  } catch (err) {
    return err instanceof Error && err.message === 'timeout' ? 'timeout' : 'error';
  }
}

export async function evaluateReadiness(deps: ReadinessDeps): Promise<ReadinessResult> {
  const timeoutMs = deps.timeoutMs ?? 3_000;
  const checks: DependencyCheckResult[] = [];

  const dbOutcome = await withTimeout(deps.checkDatabase, timeoutMs);
  checks.push(
    dbOutcome === 'ok'
      ? { name: 'database', status: 'ok' }
      : { name: 'database', status: 'fail', reason: dbOutcome },
  );

  if (deps.checkRedis) {
    const redisOutcome = await withTimeout(deps.checkRedis, timeoutMs);
    // Redis is optional (see module docstring): reported for visibility,
    // never allowed to flip the overall status to degraded.
    checks.push(
      redisOutcome === 'ok'
        ? { name: 'redis', status: 'ok' }
        : { name: 'redis', status: 'fail', reason: redisOutcome },
    );
  } else {
    checks.push({ name: 'redis', status: 'skipped', reason: 'not_configured' });
  }

  const mandatoryFailed = checks.some(c => c.name === 'database' && c.status === 'fail');
  return { status: mandatoryFailed ? 'degraded' : 'ok', checks };
}
