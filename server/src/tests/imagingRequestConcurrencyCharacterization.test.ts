/**
 * imagingRequestConcurrencyCharacterization.test.ts — F2-PREP-007-D / CT-32
 *
 * HISTORY (preserved per the F2-PREP-006-E contract's own instruction for
 * CT-32 — revise, do not delete, when the characterized gap is closed):
 *
 * As originally written (F2-PREP-007-D, Stage 0), this file characterized —
 * proved, did not fix — the ImagingRequest PATCH concurrency gap tracked as
 * CR-03 / BLK-02 / FP-06: PATCH /api/imaging/requests/:id and PATCH
 * /api/imaging/requests/:id/cancel each read the row via a plain findFirst,
 * validated the requested transition against that in-memory snapshot, then
 * called prisma.imagingRequest.update({ where: { id } }) unconditionally —
 * no SELECT ... FOR UPDATE, no transaction, no WHERE-status guard, no
 * version/updatedAt column on the model. Two concurrent requests that both
 * read the row before either committed its write both passed transition
 * validation and both writes landed — last-write-wins, with no 409 and no
 * re-validation after the race window. Across 30 real, concurrent,
 * un-synchronized HTTP-request rounds (no sleeps, Promise.all only, real
 * disposable-Postgres-backed server), this reproduced on literally every
 * round — a deterministic baseline, not a rare flake.
 *
 * FIX (F2-CT-32-R1, this revision): server/src/routes/imaging.ts's PATCH and
 * cancel handlers now use a compare-and-set write — the WHERE clause is
 * conditioned on the EXACT status value read (`status: existing.status`,
 * combined with the same clinic scope already used for the read), via
 * `prisma.imagingRequest.updateMany`. Whichever request's write reaches
 * Postgres first commits; the row is then locked/re-evaluated for the
 * second writer's WHERE clause, which no longer matches (status already
 * changed) — `count !== 1` is surfaced as a controlled `409
 * concurrent_transition`, never a silent second success. Same pattern as
 * server/src/services/security/securityIncidentService.ts's
 * applyLifecycleTransition() and this file's own sibling LinkImagingStudy
 * guard (imaging.ts, POST /imaging/studies). No schema/migration, no
 * process-local mutex, no serializable transaction, no sleeps, no
 * hidden-conflict retry loop.
 *
 * This file is REVISED, not deleted: it now asserts the corrected,
 * regression-proof behavior (exactly one winner, the loser gets a
 * controlled 409, no clobber) instead of the original defect. The original
 * per-round/aggregate assertions it replaces are preserved above in this
 * comment block and in git history (this revision's commit), per the
 * contract's instruction not to pretend the defect never existed.
 *
 * Run with: tsx src/tests/imagingRequestConcurrencyCharacterization.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres (F1-003-P2A
 * pattern) BEFORE this file is imported — server/src/db.ts opens a live pg
 * pool at import time. Wired into `test:imaging-characterization` (see
 * server/package.json), which runs as part of `server:test:disposable-db`.
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

// ─── Round outcome classification (post-fix) ───
//
// Two concurrent requests race the same ImagingRequest row, seeded fresh at
// 'requested' each round:
//   - PATCH /api/imaging/requests/:id       { status: 'scheduled' }
//   - PATCH /api/imaging/requests/:id/cancel  (-> status: 'cancelled')
//
// Both target statuses are reachable from 'requested' per
// imagingRequestTransitions.ts's ALLOWED_REQUEST_TRANSITIONS, so a
// transition-validity rejection is never the reason either request could
// fail. Pre-fix, this repo's own evidence (30/30 rounds) showed the two
// requests' reads deterministically overlap in this exact harness (no
// sleeps, Promise.all only) — every round hit the race window. Post-fix,
// the compare-and-set write means the race window no longer matters: at
// most one write can ever commit against a given read snapshot.
//
//   EXACTLY_ONE_WINNER — exactly one response is 200 and the other is 409.
//     This is the ONLY expected/passing shape now — whether the requests
//     genuinely overlapped (loser's code is 'concurrent_transition', the
//     CAS guard) or happened not to (loser's code is 'already_terminal',
//     the pre-existing transition-validation rejection) is recorded for
//     visibility below but is not itself asserted, since both are correct,
//     non-clobbering outcomes.
//
//   BOTH_SUCCESS_SILENT_CLOBBER — both requests report 200. This was the
//     CR-03/BLK-02/FP-06 defect this file originally characterized (see the
//     header comment's HISTORY section) and must never occur again now that
//     the guard is implemented — asserted to never occur, below.
//
//   UNEXPECTED — anything else (a 404/500/other status pair, or a 409 with
//     neither expected code). Would indicate a fixture/harness defect or a
//     genuine regression, not a known-good concurrency outcome — asserted
//     to never occur, below.

type RoundClassification = 'EXACTLY_ONE_WINNER' | 'BOTH_SUCCESS_SILENT_CLOBBER' | 'UNEXPECTED';

interface RoundOutcome {
  round: number;
  requestId: string;
  patch: HttpJsonResult;
  cancel: HttpJsonResult;
  finalPersistedStatus: string;
  classification: RoundClassification;
  loserCode: string | undefined;
}

function classifyRound(patch: HttpJsonResult, cancel: HttpJsonResult): RoundClassification {
  if (patch.statusCode === 200 && cancel.statusCode === 200) return 'BOTH_SUCCESS_SILENT_CLOBBER';
  if ((patch.statusCode === 200 && cancel.statusCode === 409) || (patch.statusCode === 409 && cancel.statusCode === 200)) {
    return 'EXACTLY_ONE_WINNER';
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
  const loser = patch.statusCode === 409 ? patch : cancel.statusCode === 409 ? cancel : undefined;

  return {
    round,
    requestId: seeded.id,
    patch,
    cancel,
    finalPersistedStatus: finalRow.status,
    classification: classifyRound(patch, cancel),
    loserCode: loser?.body?.code,
  };
}

// ─── Main ───

const DEFAULT_ROUND_COUNT = 30;

/**
 * CT32_ROUNDS must be a positive integer or unset — `Number(process.env.X ?? 30)`
 * previously turned an unparsable value (e.g. "abc") into NaN, which made
 * `round <= ROUND_COUNT` false on the very first iteration: zero rounds ran,
 * `outcomes` stayed empty, and every aggregate assertion below (`0 === 0`,
 * `[].length === 0`) passed vacuously — a misconfigured CI run would report
 * green while characterizing nothing. Fail fast instead: an invalid value is
 * a configuration error, not something to silently coerce to the default.
 */
function resolveRoundCount(): number {
  const raw = process.env.CT32_ROUNDS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_ROUND_COUNT;
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(
      `Invalid CT32_ROUNDS="${raw}": must be a positive integer (e.g. "30"), or unset to use the default (${DEFAULT_ROUND_COUNT}). ` +
        'Refusing to silently fall back, so a CI misconfiguration is never masked as a vacuously-passing 0-round run.',
    );
  }
  return Number.parseInt(trimmed, 10);
}

async function main() {
  section('CT-32 — ImagingRequest PATCH concurrency characterization (F2-PREP-007-D)');

  // Resolved and logged before any fixture/DB work starts, so an invalid
  // CT32_ROUNDS fails fast without leaving any test data behind. Only the
  // resolved round count is logged — never a token, URL, or DB credential.
  const roundCount = resolveRoundCount();
  console.log(`  Effective round count: ${roundCount}`);

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
      for (let round = 1; round <= roundCount; round++) {
        const outcome = await runRound(port, token, fixtures.defaultClinicId, patient.id, staffUser.id, round);
        outcomes.push(outcome);

        await test(`round ${round}: neither response is an unexpected status (never a crash/404/500, and never both-200, under raw concurrency)`, () => {
          assert.notEqual(
            outcome.classification,
            'UNEXPECTED',
            `round ${round}: got patch=${outcome.patch.statusCode} cancel=${outcome.cancel.statusCode} (final=${outcome.finalPersistedStatus}) — not the expected EXACTLY_ONE_WINNER shape`,
          );
        });

        await test(`round ${round}: the CR-03/BLK-02/FP-06 silent-clobber gap does not reproduce — both requests never report 200`, () => {
          assert.notEqual(
            outcome.classification,
            'BOTH_SUCCESS_SILENT_CLOBBER',
            `round ${round}: got patch=${outcome.patch.statusCode} cancel=${outcome.cancel.statusCode} — the guarded write must reject the loser with 409, not silently accept both`,
          );
        });

        await test(`round ${round}: exactly one of the two concurrent requests wins (the other receives a controlled 409)`, () => {
          const statuses = [outcome.patch.statusCode, outcome.cancel.statusCode].sort();
          assert.deepEqual(statuses, [200, 409]);
        });

        await test(`round ${round}: the winning response body honestly reflects its own write, and matches the final persisted row`, () => {
          const winner = outcome.patch.statusCode === 200 ? outcome.patch : outcome.cancel;
          const expectedWinnerStatus = winner === outcome.patch ? 'scheduled' : 'cancelled';
          assert.equal(winner.body?.status, expectedWinnerStatus);
          assert.equal(outcome.finalPersistedStatus, expectedWinnerStatus, 'final persisted row must match the winner, never a corrupted/third value');
        });

        await test(`round ${round}: the losing response carries a known conflict code (concurrent_transition or already_terminal), never a silent success`, () => {
          assert.ok(
            outcome.loserCode === 'concurrent_transition' || outcome.loserCode === 'already_terminal',
            `round ${round}: unexpected loser code "${outcome.loserCode}"`,
          );
        });
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

  // Guards against the exact vacuous-pass failure mode resolveRoundCount()
  // exists to prevent: if the round loop above somehow ran zero times,
  // every filter/count below would be trivially "0 === 0" and pass without
  // characterizing anything. Fails loudly instead of silently.
  await test('aggregate: at least one round actually executed (guards against a vacuously-passing 0-round run)', () => {
    assert.ok(outcomes.length >= 1, `expected roundCount=${roundCount} to produce at least 1 outcome, got ${outcomes.length}`);
  });

  const clobberRounds = outcomes.filter((o) => o.classification === 'BOTH_SUCCESS_SILENT_CLOBBER');
  const winnerRounds = outcomes.filter((o) => o.classification === 'EXACTLY_ONE_WINNER');
  const unexpectedRounds = outcomes.filter((o) => o.classification === 'UNEXPECTED');
  const scheduledWon = winnerRounds.filter((o) => o.finalPersistedStatus === 'scheduled').length;
  const cancelledWon = winnerRounds.filter((o) => o.finalPersistedStatus === 'cancelled').length;
  const concurrentConflicts = winnerRounds.filter((o) => o.loserCode === 'concurrent_transition').length;
  const sequentialConflicts = winnerRounds.filter((o) => o.loserCode === 'already_terminal').length;

  console.log(`  Rounds run: ${outcomes.length}`);
  console.log(`  EXACTLY_ONE_WINNER (guard held, no clobber): ${winnerRounds.length}/${outcomes.length}`);
  console.log(`    -> PATCH (scheduled) won: ${scheduledWon}, cancel (cancelled) won: ${cancelledWon}`);
  console.log(`    -> loser code concurrent_transition (genuine race caught by CAS): ${concurrentConflicts}`);
  console.log(`    -> loser code already_terminal (no overlap this round): ${sequentialConflicts}`);
  console.log(`  BOTH_SUCCESS_SILENT_CLOBBER (the CR-03/BLK-02/FP-06 gap — must be 0 post-fix): ${clobberRounds.length}/${outcomes.length}`);
  console.log(`  UNEXPECTED: ${unexpectedRounds.length}/${outcomes.length}`);

  await test('aggregate: zero UNEXPECTED outcomes across all rounds (raw concurrency never crashes or 4xx/5xx-misbehaves outside the known shape)', () => {
    assert.equal(unexpectedRounds.length, 0, `${unexpectedRounds.length} round(s) produced an unexpected status pairing`);
  });

  await test('aggregate: the silent-clobber gap (CR-03/BLK-02/FP-06) never reproduces — regression proof, not a rare-pass', () => {
    assert.equal(
      clobberRounds.length,
      0,
      `expected 0 of ${outcomes.length} rounds to hit BOTH_SUCCESS_SILENT_CLOBBER; got ${clobberRounds.length}. ` +
        'This means the F2-CT-32-R1 compare-and-set guard in server/src/routes/imaging.ts has regressed — investigate before merging.',
    );
  });

  await test('aggregate: every round produced exactly one winner (guard held on every round, not just most)', () => {
    assert.equal(
      winnerRounds.length,
      outcomes.length,
      `expected all ${outcomes.length} rounds to resolve EXACTLY_ONE_WINNER; ${unexpectedRounds.length} were unexpected and ${clobberRounds.length} clobbered`,
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
