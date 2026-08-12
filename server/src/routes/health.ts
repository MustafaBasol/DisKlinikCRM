/**
 * health.ts — F3-OBS-001: minimum production health-signal surface.
 *
 * Adds two endpoints alongside the pre-existing `GET /api/health` (which
 * this file does NOT touch — index.ts still defines it inline, byte-for-byte
 * unchanged, since `scripts/noramedi-healthcheck.sh` and the external
 * uptime probe are already contracted against it):
 *
 *   GET /api/livez  — process-alive signal only. No dependency checks
 *                     (that is /readyz's job) — a DB outage must not make
 *                     PM2/an orchestrator conclude the process itself is
 *                     dead and restart it, which would not fix a DB outage
 *                     and would just add restart-storm risk on top of it.
 *   GET /api/readyz — "should a load balancer send this instance traffic"
 *                     signal. Delegates the actual dependency-check policy
 *                     to utils/readiness.ts (mandatory DB, optional Redis —
 *                     see that module's docstring for why). Returns 503
 *                     when a mandatory dependency is down.
 *
 * Both are unauthenticated by design (mounted before the global `/api` auth
 * middleware in index.ts, same as `/api/health`) — an uptime prober or load
 * balancer cannot present a session. Neither ever returns a connection
 * string, stack trace, or any value derived from request input: the process
 * role and a fixed set of reason codes are the only content.
 *
 * buildHealthRouter() takes its dependency-check functions as parameters
 * (rather than importing prisma/redis directly) so tests can exercise the
 * routing/status-code/response-shape contract — including the "database
 * down" 503 path — without a real Postgres connection.
 */

import express, { Router } from 'express';
import { evaluateReadiness, ReadinessDeps } from '../utils/readiness.js';
import type { NoramediProcessRole } from '../utils/processRole.js';

export interface HealthRouterOptions {
  processRole: NoramediProcessRole;
  checkDatabase: ReadinessDeps['checkDatabase'];
  checkRedis?: ReadinessDeps['checkRedis'];
}

export function buildHealthRouter(options: HealthRouterOptions): Router {
  const router = express.Router();

  router.get('/livez', (_req, res) => {
    res.json({ status: 'ok', role: options.processRole });
  });

  router.get('/readyz', async (_req, res) => {
    const result = await evaluateReadiness({
      checkDatabase: options.checkDatabase,
      checkRedis: options.checkRedis,
    });
    res.status(result.status === 'ok' ? 200 : 503).json({
      status: result.status,
      role: options.processRole,
      checks: result.checks,
    });
  });

  return router;
}
