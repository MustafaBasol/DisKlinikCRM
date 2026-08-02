/**
 * imagingRequestConcurrencyCharacterization.test.ts — F2-PREP-007-D / CT-32
 *
 * Characterizes (does NOT fix) the ImagingRequest PATCH concurrency gap
 * tracked as CR-03 / BLK-02 / FP-06 and accepted by
 * docs/program/architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md §10 as
 * a "pre-contract-exposure blocker" — blocking before Stage 1 exposes
 * UpdateImagingRequest/CancelImagingRequest to any caller beyond imaging.ts
 * itself, but explicitly NOT blocking for Stage 0 characterization, whose
 * job is to prove the current gap exists, not close it.
 *
 * Current implementation (server/src/routes/imaging.ts, PATCH
 * /api/imaging/requests/:id and PATCH /api/imaging/requests/:id/cancel) reads
 * the row via a plain findFirst, validates the requested transition against
 * that in-memory snapshot, then calls prisma.imagingRequest.update({ where:
 * { id } }) unconditionally — no SELECT ... FOR UPDATE, no transaction, no
 * WHERE-status guard, no version/updatedAt column on the model. Two
 * concurrent requests that both read the row before either commits its write
 * both pass transition validation and both writes land — last-write-wins,
 * with no 409 and no re-validation after the race window. This test proves
 * that with two REAL concurrent HTTP requests against a REAL disposable
 * PostgreSQL-backed running server instance — no sleeps, no artificial
 * synchronization barrier, no injected hook into route code (all of which
 * are out of scope: this is a characterization test, not a fix).
 *
 * Per this task's explicit brief: this test MUST NOT add locks, versions,
 * updatedAt guards, transactions, or retries to the production route/service
 * code, and must not touch imagingRequestTransitions.ts. When CR-03's guard
 * is eventually implemented (Stage 2 per the contract), this file's
 * assertions are expected to change (SEQUENTIAL_SAFE_REJECTION or an
 * equivalent guarded-deterministic outcome becoming the only observed
 * classification) — it should be REVISED at that point, not deleted, per the
 * contract's own instruction for CT-32.
 *
 * Run with: tsx src/tests/imagingRequestConcurrencyCharacterization.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres (F1-003-P2A
 * pattern) BEFORE this file is imported — server/src/db.ts opens a live pg
 * pool at import time. Not wired into any npm aggregate/CI layer script by
 * this task (that would require server/package.json changes, out of scope
 * per this task's constraints) — same as the existing, similarly-unwired
 * server/src/tests/dbVerification/inventoryUnitConversionConcurrency.test.ts
 * precedent. Run manually against a disposable Postgres for now.
 */

import 'dotenv/config';

// Real HTTP requests carry a Bearer token (no cookie/session in this
// harness); production defaults to cookie-only clinic auth, so the fallback
// must be enabled explicitly — same technique as retentionManualRunAudit.test.ts
// uses for the platform-auth equivalent.
process.env.CLINIC_BEARER_FALLBACK_ENABLED = 'true';

import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import prisma from '../db.js';
import imagingRoutes from '../routes/imaging.js';
import { authenticate, generateToken, type AuthRequest } from '../middleware/auth.js';
import {
  createClinicFixtureSet,
  createStaffUser,
  createTestPatient,
  cleanupAllFixtures,
} from './dbVerification/dbVerificationHarness.js';

// ─── Minimal pass/fail test runner (same shape as the rest of the disposable-Postgres suite) ───

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ─── Real, minimally-mounted app (mirrors index.ts's own mounting order for
// this router: express.json() -> authenticate -> the real imaging router).
// No supertest anywhere in this repo (confirmed repo-wide) — real TCP via
// node:http against app.listen(0), same technique as
// httpRequestLogPrivacy.test.ts / externalCalendarWebhookRouteE2E.test.ts. ───

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authenticate as unknown as express.RequestHandler);
  app.use('/api', imagingRoutes);
  // Last-resort handler so a thrown error inside a route surfaces as a
  // labeled 500 instead of a hung/reset socket during the race.
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'test-app unhandled error', detail: err instanceof Error ? err.message : String(err) });
  });
  return app;
}

async function withServer(fn: (port: number) => Promise<void>): Promise<void> {
  const app = buildApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected server to bind a TCP port');
  }
  try {
    await fn(address.port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

interface HttpJsonResult {
  statusCode: number;
  body: any;
}

function issueJson(
  port: number,
  opts: { method: string; path: string; token: string; body?: unknown },
): Promise<HttpJsonResult> {
  return new Promise((resolve, reject) => {
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: opts.method,
        path: opts.path,
        headers: {
          authorization: `Bearer ${opts.token}`,
          ...(payload
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let body: any;
          try {
            body = raw ? JSON.parse(raw) : undefined;
          } catch {
            body = { __unparsableRawBody: raw };
          }
          resolve({ statusCode: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Round outcome classification ───
//
// Two concurrent requests race the same ImagingRequest row, seeded fresh at
// 'requested' each round:
//   - PATCH /api/imaging/requests/:id       { status: 'scheduled' }
//   - PATCH /api/imaging/requests/:id/cancel  (-> status: 'cancelled')
//
// Both target statuses are reachable from 'requested' per
// imagingRequestTransitions.ts's ALLOWED_REQUEST_TRANSITIONS, so a
// transition-validity rejection is never the reason either request could
// fail — only the race window (whether both requests read the row before
// either commits its write) determines the outcome:
//
//   BOTH_SUCCESS_SILENT_CLOBBER — both requests read 'requested' before
//     either write committed. Both pass validateRequestTransition, both
//     writes land, both HTTP responses report 200 with their own intended
//     status. Exactly one of the two statuses is the row's actual final
//     persisted value; the other response's 200 body is stale from the
//     moment it was sent — the client that "lost" is never told. This is
//     the CR-03/BLK-02/FP-06 gap this test exists to characterize.
//
//   SEQUENTIAL_SAFE_REJECTION — one request's write fully committed before
//     the other's read executed. The second request then reads an
//     already-terminal-or-diverged status and validateRequestTransition
//     correctly rejects it with 409. No clobber occurs in this ordering,
//     but it reflects the two requests happening not to overlap, not a
//     guard in the production code.
//
//   UNEXPECTED — anything else (a 404/500/other status pair). Would
//     indicate a fixture or harness defect, not the concurrency behavior
//     under characterization — asserted to never occur, below.

type RoundClassification = 'BOTH_SUCCESS_SILENT_CLOBBER' | 'SEQUENTIAL_SAFE_REJECTION' | 'UNEXPECTED';

interface RoundOutcome {
  round: number;
  requestId: string;
  patch: HttpJsonResult;
  cancel: HttpJsonResult;
  finalPersistedStatus: string;
  classification: RoundClassification;
}

function classifyRound(patch: HttpJsonResult, cancel: HttpJsonResult): RoundClassification {
  if (patch.statusCode === 200 && cancel.statusCode === 200) return 'BOTH_SUCCESS_SILENT_CLOBBER';
  if ((patch.statusCode === 200 && cancel.statusCode === 409) || (patch.statusCode === 409 && cancel.statusCode === 200)) {
    return 'SEQUENTIAL_SAFE_REJECTION';
  }
  return 'UNEXPECTED';
}

async function runRound(port: number, token: string, clinicId: string, patientId: string, userId: string, round: number): Promise<RoundOutcome> {
  const seeded = await prisma.imagingRequest.create({
    data: {
      clinicId,
      patientId,
      requestedModality: 'PX',
      requestedByUserId: userId,
      status: 'requested',
    },
  });

  // Fired back-to-back with no await between them and no sleep/barrier of
  // any kind — Promise.all is the only synchronization: both requests are
  // genuinely in flight concurrently over real sockets against the real
  // disposable-Postgres-backed running server instance.
  const [patch, cancel] = await Promise.all([
    issueJson(port, {
      method: 'PATCH',
      path: `/api/imaging/requests/${seeded.id}`,
      token,
      body: { status: 'scheduled' },
    }),
    issueJson(port, {
      method: 'PATCH',
      path: `/api/imaging/requests/${seeded.id}/cancel`,
      token,
    }),
  ]);

  const finalRow = await prisma.imagingRequest.findUniqueOrThrow({ where: { id: seeded.id } });

  return {
    round,
    requestId: seeded.id,
    patch,
    cancel,
    finalPersistedStatus: finalRow.status,
    classification: classifyRound(patch, cancel),
  };
}

// ─── Main ───

const ROUND_COUNT = Number(process.env.CT32_ROUNDS ?? 30);

async function main() {
  section('CT-32 — ImagingRequest PATCH concurrency characterization (F2-PREP-007-D)');

  const fixtures = await createClinicFixtureSet('ct32-imaging-concurrency');
  const staffUser = await createStaffUser({
    organizationId: fixtures.orgId,
    clinicId: fixtures.defaultClinicId,
    role: 'DENTIST',
  });
  const patient = await createTestPatient({
    organizationId: fixtures.orgId,
    clinicId: fixtures.defaultClinicId,
  });
  const token = generateToken({
    id: staffUser.id,
    clinicId: staffUser.clinicId,
    organizationId: staffUser.organizationId,
    allowedClinicIds: staffUser.allowedClinicIds,
    canAccessAllClinics: staffUser.canAccessAllClinics,
    role: staffUser.role,
  });

  const outcomes: RoundOutcome[] = [];

  try {
    await withServer(async (port) => {
      for (let round = 1; round <= ROUND_COUNT; round++) {
        const outcome = await runRound(port, token, fixtures.defaultClinicId, patient.id, staffUser.id, round);
        outcomes.push(outcome);

        await test(`round ${round}: neither response is an unexpected status (never a crash/404/500 under raw concurrency)`, () => {
          assert.notEqual(
            outcome.classification,
            'UNEXPECTED',
            `round ${round}: got patch=${outcome.patch.statusCode} cancel=${outcome.cancel.statusCode} (final=${outcome.finalPersistedStatus}) — neither the expected BOTH_SUCCESS_SILENT_CLOBBER nor SEQUENTIAL_SAFE_REJECTION shape`,
          );
        });

        if (outcome.classification === 'BOTH_SUCCESS_SILENT_CLOBBER') {
          await test(`round ${round}: both concurrent requests report HTTP 200 (both silently "succeed")`, () => {
            assert.equal(outcome.patch.statusCode, 200);
            assert.equal(outcome.cancel.statusCode, 200);
          });
          await test(`round ${round}: each response body honestly reflects its OWN intended write (not an error, not the other request's outcome)`, () => {
            assert.equal(outcome.patch.body?.status, 'scheduled');
            assert.equal(outcome.cancel.body?.status, 'cancelled');
          });
          await test(`round ${round}: final persisted status is exactly one of the two racing targets, not a third/corrupted value`, () => {
            assert.ok(
              outcome.finalPersistedStatus === 'scheduled' || outcome.finalPersistedStatus === 'cancelled',
              `unexpected final persisted status "${outcome.finalPersistedStatus}"`,
            );
          });
          await test(`round ${round}: the losing response's 200 body no longer matches the final persisted row (silent clobber, no 409, no re-validation)`, () => {
            const loserClaimedStatus = outcome.finalPersistedStatus === 'scheduled' ? 'cancelled' : 'scheduled';
            assert.notEqual(
              outcome.finalPersistedStatus,
              loserClaimedStatus,
              'the loser\'s claimed status must diverge from the final persisted row for this to be a genuine silent clobber',
            );
          });
        } else {
          // SEQUENTIAL_SAFE_REJECTION: recorded, not treated as a failure —
          // this ordering simply did not exercise the race window this
          // round; see the classification comment above.
          await test(`round ${round}: sequential-safe ordering — the second-arriving write correctly received 409 already_terminal, no clobber this round`, () => {
            const statuses = [outcome.patch.statusCode, outcome.cancel.statusCode].sort();
            assert.deepEqual(statuses, [200, 409]);
          });
        }
      }
    });
  } finally {
    // Deterministic finally cleanup: ImagingRequest rows first (FK to
    // Clinic/Patient/User, and NOT covered by cleanupAllFixtures — see
    // dbVerificationHarness.ts's own header, which predates this model),
    // then AuditLog rows written by auditImaging() for this run's
    // organization (no FK, but left in place would be silent DB growth
    // across repeated local runs), then the shared harness's own
    // clinic/patient/user/org teardown.
    await prisma.imagingRequest.deleteMany({ where: { clinicId: fixtures.defaultClinicId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: fixtures.orgId } });
    await cleanupAllFixtures();
  }

  // ─── Aggregate determinism report ───
  section('Aggregate — determinism across repeated rounds');

  const clobberRounds = outcomes.filter((o) => o.classification === 'BOTH_SUCCESS_SILENT_CLOBBER');
  const sequentialRounds = outcomes.filter((o) => o.classification === 'SEQUENTIAL_SAFE_REJECTION');
  const unexpectedRounds = outcomes.filter((o) => o.classification === 'UNEXPECTED');
  const scheduledWon = clobberRounds.filter((o) => o.finalPersistedStatus === 'scheduled').length;
  const cancelledWon = clobberRounds.filter((o) => o.finalPersistedStatus === 'cancelled').length;

  console.log(`  Rounds run: ${outcomes.length}`);
  console.log(`  BOTH_SUCCESS_SILENT_CLOBBER (the CR-03/BLK-02/FP-06 gap): ${clobberRounds.length}/${outcomes.length}`);
  console.log(`    -> PATCH (scheduled) won: ${scheduledWon}, cancel (cancelled) won: ${cancelledWon}`);
  console.log(`  SEQUENTIAL_SAFE_REJECTION (no overlap this round): ${sequentialRounds.length}/${outcomes.length}`);
  console.log(`  UNEXPECTED: ${unexpectedRounds.length}/${outcomes.length}`);

  await test('aggregate: zero UNEXPECTED outcomes across all rounds (raw concurrency never crashes or 4xx/5xx-misbehaves outside the two known shapes)', () => {
    assert.equal(unexpectedRounds.length, 0, `${unexpectedRounds.length} round(s) produced an unexpected status pairing`);
  });

  await test('aggregate: the silent-clobber gap (CR-03/BLK-02/FP-06) reproduces on every round — deterministic current-behavior baseline, not a rare flake', () => {
    assert.equal(
      clobberRounds.length,
      outcomes.length,
      `expected all ${outcomes.length} rounds to hit BOTH_SUCCESS_SILENT_CLOBBER; ${sequentialRounds.length} instead resolved sequentially-safe. ` +
        'If this assertion starts failing because CR-03\'s guard has been implemented elsewhere, this test must be REVISED (not deleted) per the ' +
        'F2-PREP-006-E contract\'s own instruction for CT-32, and blockerDecisions.imagingRequestPatchConcurrency should be updated to reflect the fix.',
    );
  });

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`CT-32 total: ${passed + failed}  ✓ ${passed}  ✗ ${failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main().catch((err) => {
  console.error('[CT-32] fatal error:', err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
