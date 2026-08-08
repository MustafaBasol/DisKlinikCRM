/**
 * imagingRequestConcurrencyForcedInterleaving.test.ts — F2-CT-32-R2.
 *
 * CT-32 (imagingRequestConcurrencyCharacterization.test.ts) races a real,
 * un-synchronized PATCH ({status:'scheduled'}) against a real cancel via
 * Promise.all — no sleeps, no barrier. Locally, against a low-latency
 * disposable Postgres, cancel wins every round (500/500 observed) because it
 * does strictly less work than PATCH (no validateClinicalLinks round-trips).
 * On GitHub Actions CI (run 31276844302, round 1 of 30), timing inverted:
 * PATCH's compare-and-set write committed ('requested' -> 'scheduled')
 * before cancel's OWN read (findRequestInScope) even executed. Cancel then
 * legitimately observed 'scheduled' — a real, currently-valid predecessor
 * state for cancellation per imagingRequestTransitions.ts's
 * ALLOWED_REQUEST_TRANSITIONS — and its own compare-and-set correctly
 * matched and committed 'scheduled' -> 'cancelled'. Both requests reported
 * 200; the F2-CT-32-R1 guard did not regress (it correctly rejects any
 * writer whose read is stale AT WRITE TIME), but the *pair* of otherwise-
 * correct writes still violated the required invariant: two requests
 * dispatched without either caller waiting for the other must not both
 * succeed, even when the second's fresh read happens to legitimize a
 * further, individually-valid transition.
 *
 * A NATURAL Promise.all() race cannot be forced onto this exact schedule on
 * demand (confirmed: 500 local rounds, 0 reproductions) — this file uses the
 * real, production test-only hooks (installImagingRequestRaceTestHooks,
 * server/src/routes/imaging.ts) to force cancel's read to begin only after
 * PATCH's compare-and-set write has already committed, every run, not
 * hoping timing jitter lands on it. Same technique and rationale as
 * patientEmergencyContactsCreateRaceForcedInterleaving.test.ts /
 * patientEmergencyContactsConcurrency.ts (F1-004-P1-R2-R3).
 *
 * That prior task's own resolvePrimaryPromotion header comment proves a
 * general fact this file's results are consistent with: once a competing
 * transaction has ALREADY committed before this transaction's own first
 * read executes, the two operations are — from PostgreSQL's point of view —
 * genuinely, unambiguously sequential, and no signal visible only from
 * inside the second transaction can distinguish that from deliberate,
 * caller-sequenced calls. Section 1 below proves this residual limitation
 * is real and reproduces deterministically under the forced schedule for
 * callers that do not supply the new precondition (a CHARACTERIZATION, not
 * a regression to fix — mirrored deliberately from the emergency-contacts
 * file's own "legacy best-effort mode" section, which documents the
 * identical, accepted trade-off). Section 2 proves the F2-CT-32-R2 fix
 * (optional `expectedStatus` on both PATCH and cancel — the caller's own
 * pre-request belief, immune to server-side read timing by construction)
 * closes it: under the IDENTICAL forced schedule, supplying `expectedStatus`
 * makes the 200+200 outcome impossible, deterministically, every round.
 *
 * Run: DATABASE_URL=... npx tsx src/tests/imagingRequestConcurrencyForcedInterleaving.test.ts
 */

import 'dotenv/config';

process.env.CLINIC_BEARER_FALLBACK_ENABLED = 'true';

import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import prisma from '../db.js';
import imagingRoutes, { installImagingRequestRaceTestHooks } from '../routes/imaging.js';
import { authenticate, generateToken } from '../middleware/auth.js';
import {
  createClinicFixtureSet,
  createStaffUser,
  createTestPatient,
  cleanupAllFixtures,
} from './dbVerification/dbVerificationHarness.js';

// ─── Minimal pass/fail test runner (same shape as CT-32 / the Guard suite) ───

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

// ─── Real, minimally-mounted app (same technique as CT-32: no supertest
// anywhere in this repo — real TCP via node:http against app.listen(0)) ───

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authenticate as unknown as express.RequestHandler);
  app.use('/api', imagingRoutes);
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

async function seedRequest(clinicId: string, patientId: string, userId: string) {
  return prisma.imagingRequest.create({
    data: { clinicId, patientId, requestedModality: 'PX', requestedByUserId: userId, status: 'requested' },
  });
}

function tokenFor(user: { id: string; clinicId: string; organizationId: string; allowedClinicIds: string[]; canAccessAllClinics: boolean; role: string }) {
  return generateToken({
    id: user.id,
    clinicId: user.clinicId,
    organizationId: user.organizationId,
    allowedClinicIds: user.allowedClinicIds,
    canAccessAllClinics: user.canAccessAllClinics,
    role: user.role,
  });
}

/**
 * Installs hooks that force cancel's very first read to wait until PATCH's
 * compare-and-set write has already resolved (committed) — the exact
 * schedule characterized in this file's header comment. Both HTTP requests
 * are still fired via Promise.all with zero caller-side ordering; only the
 * server-side timing of cancel's read is pinned.
 */
function installForcedSchedule(): void {
  let patchCasResolve: () => void;
  const patchCasDone = new Promise<void>((res) => {
    patchCasResolve = res;
  });
  installImagingRequestRaceTestHooks({
    patchAfterCas: () => {
      patchCasResolve();
    },
    cancelBeforeRead: async () => {
      await patchCasDone;
    },
  });
}

async function runForcedRound(
  port: number,
  token: string,
  clinicId: string,
  patientId: string,
  userId: string,
  opts: { withPrecondition: boolean },
) {
  const seeded = await seedRequest(clinicId, patientId, userId);
  installForcedSchedule();
  try {
    const [patch, cancel] = await Promise.all([
      issueJson(port, {
        method: 'PATCH',
        path: `/api/imaging/requests/${seeded.id}`,
        token,
        body: opts.withPrecondition ? { status: 'scheduled', expectedStatus: 'requested' } : { status: 'scheduled' },
      }),
      issueJson(port, {
        method: 'PATCH',
        path: `/api/imaging/requests/${seeded.id}/cancel`,
        token,
        body: opts.withPrecondition ? { expectedStatus: 'requested' } : undefined,
      }),
    ]);
    const finalRow = await prisma.imagingRequest.findUniqueOrThrow({ where: { id: seeded.id } });
    return { patch, cancel, finalStatus: finalRow.status };
  } finally {
    installImagingRequestRaceTestHooks(null);
  }
}

const FORCED_ROUNDS = 10;

async function main() {
  section('F2-CT-32-R2 — ImagingRequest PATCH/cancel forced-interleaving regression (deterministic, not timing-dependent)');

  const fixtures = await createClinicFixtureSet('ct32r2-imaging-forced');
  const staffDefault = await createStaffUser({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId, role: 'DENTIST' });
  const patientDefault = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
  const tokenDefault = tokenFor(staffDefault);

  const staffCrossOrg = await createStaffUser({ organizationId: fixtures.otherOrgId, clinicId: fixtures.crossOrgClinicId, role: 'DENTIST' });
  const tokenCrossOrg = tokenFor(staffCrossOrg);

  try {
    await withServer(async (port) => {
      // ─── 1. Legacy (no expectedStatus): forced schedule still shows the
      // known, accepted residual gap — characterization, not a regression.
      section('1. Legacy mode (no expectedStatus) — forced schedule reproduces the discovered 200/200 path (characterized, not fixed)');
      for (let round = 1; round <= FORCED_ROUNDS; round++) {
        const outcome = await runForcedRound(port, tokenDefault, fixtures.defaultClinicId, patientDefault.id, staffDefault.id, { withPrecondition: false });

        await test(`round ${round}: under the forced schedule, legacy callers (no precondition) still get both 200s — a known, accepted limitation, not this fix's target`, () => {
          assert.equal(outcome.patch.statusCode, 200, `expected PATCH 200, got ${outcome.patch.statusCode}: ${JSON.stringify(outcome.patch.body)}`);
          assert.equal(outcome.cancel.statusCode, 200, `expected cancel 200, got ${outcome.cancel.statusCode}: ${JSON.stringify(outcome.cancel.body)}`);
        });
        await test(`round ${round}: final persisted status is 'cancelled' (the later writer), matching the CI-observed signature exactly`, () => {
          assert.equal(outcome.finalStatus, 'cancelled');
        });
      }

      // ─── 2. Fixed (expectedStatus supplied): forced schedule can no
      // longer produce 200+200, deterministically, every round.
      section('2. F2-CT-32-R2 fix (expectedStatus supplied) — the identical forced schedule can no longer produce both 200s');
      for (let round = 1; round <= FORCED_ROUNDS; round++) {
        const outcome = await runForcedRound(port, tokenDefault, fixtures.defaultClinicId, patientDefault.id, staffDefault.id, { withPrecondition: true });

        await test(`round ${round}: exactly one of the two responses is 200, the other 409 — never both 200 — under the exact schedule that broke legacy mode above`, () => {
          const statuses = [outcome.patch.statusCode, outcome.cancel.statusCode].sort();
          assert.deepEqual(statuses, [200, 409], `got patch=${outcome.patch.statusCode} cancel=${outcome.cancel.statusCode}`);
        });
        await test(`round ${round}: the loser's code is concurrent_transition (the precondition mismatch, not a coincidental invalid-transition rejection)`, () => {
          const loser = outcome.patch.statusCode === 409 ? outcome.patch : outcome.cancel;
          assert.equal(loser.body?.code, 'concurrent_transition');
        });
        await test(`round ${round}: the winning response body honestly reflects its own write, and matches the final persisted row`, () => {
          const winner = outcome.patch.statusCode === 200 ? outcome.patch : outcome.cancel;
          const expectedWinnerStatus = winner === outcome.patch ? 'scheduled' : 'cancelled';
          assert.equal(winner.body?.status, expectedWinnerStatus);
          assert.equal(outcome.finalStatus, expectedWinnerStatus);
        });
      }

      // ─── E. Normal sequential PATCH then cancel remains valid ───
      section('E. Normal sequential PATCH then cancel (caller awaits the first response before issuing the second) remains valid');
      await test('E: PATCH to scheduled, awaited, then cancel (with expectedStatus matching the now-current status) both succeed', async () => {
        const seeded = await seedRequest(fixtures.defaultClinicId, patientDefault.id, staffDefault.id);
        const patchRes = await issueJson(port, {
          method: 'PATCH',
          path: `/api/imaging/requests/${seeded.id}`,
          token: tokenDefault,
          body: { status: 'scheduled', expectedStatus: 'requested' },
        });
        assert.equal(patchRes.statusCode, 200);
        assert.equal(patchRes.body?.status, 'scheduled');

        const cancelRes = await issueJson(port, {
          method: 'PATCH',
          path: `/api/imaging/requests/${seeded.id}/cancel`,
          token: tokenDefault,
          body: { expectedStatus: 'scheduled' },
        });
        assert.equal(cancelRes.statusCode, 200);
        assert.equal(cancelRes.body?.status, 'cancelled');

        const finalRow = await prisma.imagingRequest.findUniqueOrThrow({ where: { id: seeded.id } });
        assert.equal(finalRow.status, 'cancelled');
      });

      // ─── F. Normal sequential cancel then PATCH remains rejected ───
      section('F. Normal sequential cancel then PATCH remains rejected (already_terminal, per existing terminal-state rules)');
      await test('F: cancel, awaited, then PATCH to scheduled is 409 already_terminal — unchanged by this fix', async () => {
        const seeded = await seedRequest(fixtures.defaultClinicId, patientDefault.id, staffDefault.id);
        const cancelRes = await issueJson(port, {
          method: 'PATCH',
          path: `/api/imaging/requests/${seeded.id}/cancel`,
          token: tokenDefault,
        });
        assert.equal(cancelRes.statusCode, 200);

        const patchRes = await issueJson(port, {
          method: 'PATCH',
          path: `/api/imaging/requests/${seeded.id}`,
          token: tokenDefault,
          body: { status: 'scheduled' },
        });
        assert.equal(patchRes.statusCode, 409);
        assert.equal(patchRes.body?.code, 'already_terminal');
      });

      // ─── G. Two different rows under the forced schedule do not interfere ───
      //
      // installForcedSchedule() sets a single module-level hook object
      // (installImagingRequestRaceTestHooks — imaging.ts has no per-row hook
      // registry, by design: production code has no row-scoped concept to
      // hang test-only state off of). Running two forced rounds truly
      // concurrently would race each other's hook installation, not the
      // rows under test — so this proves independence back-to-back instead:
      // the second row's forced round must resolve cleanly (no leaked gate,
      // no cross-round state) immediately after the first's completes.
      section('G. Two different ImagingRequest rows, each under the forced schedule in turn, resolve independently with no leaked state');
      await test('G: forcing the same schedule on two unrelated rows in immediate succession never hangs and each resolves to exactly one winner', async () => {
        const outcomeOne = await runForcedRound(port, tokenDefault, fixtures.defaultClinicId, patientDefault.id, staffDefault.id, { withPrecondition: true });
        const outcomeTwo = await runForcedRound(port, tokenDefault, fixtures.defaultClinicId, patientDefault.id, staffDefault.id, { withPrecondition: true });
        for (const outcome of [outcomeOne, outcomeTwo]) {
          const statuses = [outcome.patch.statusCode, outcome.cancel.statusCode].sort();
          assert.deepEqual(statuses, [200, 409]);
        }
      });

      await test('G: two different rows mutated genuinely concurrently (no forced schedule, no shared hook state) do not block/interfere', async () => {
        const rowOne = await seedRequest(fixtures.defaultClinicId, patientDefault.id, staffDefault.id);
        const rowTwo = await seedRequest(fixtures.defaultClinicId, patientDefault.id, staffDefault.id);
        const [resOne, resTwo] = await Promise.all([
          issueJson(port, { method: 'PATCH', path: `/api/imaging/requests/${rowOne.id}`, token: tokenDefault, body: { status: 'scheduled' } }),
          issueJson(port, { method: 'PATCH', path: `/api/imaging/requests/${rowTwo.id}`, token: tokenDefault, body: { status: 'scheduled' } }),
        ]);
        assert.equal(resOne.statusCode, 200);
        assert.equal(resTwo.statusCode, 200);
      });

      // ─── H. Cross-tenant behavior unchanged ───
      section('H. Cross-tenant behavior unchanged by expectedStatus');
      await test('H: a cross-org caller cannot use expectedStatus to probe/affect a request outside its tenant scope (404, same shape as an unknown id)', async () => {
        const seeded = await seedRequest(fixtures.defaultClinicId, patientDefault.id, staffDefault.id);
        const res = await issueJson(port, {
          method: 'PATCH',
          path: `/api/imaging/requests/${seeded.id}/cancel`,
          token: tokenCrossOrg,
          body: { expectedStatus: 'requested' },
        });
        assert.equal(res.statusCode, 404);
        assert.equal(res.body?.error, 'Imaging request not found');

        const stillThere = await prisma.imagingRequest.findUniqueOrThrow({ where: { id: seeded.id } });
        assert.equal(stillThere.status, 'requested');
      });
    });
  } finally {
    installImagingRequestRaceTestHooks(null);
    await prisma.imagingRequest.deleteMany({ where: { clinicId: { in: [fixtures.defaultClinicId, fixtures.crossOrgClinicId] } } });
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: [fixtures.orgId, fixtures.otherOrgId] } } });
    await cleanupAllFixtures();
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`F2-CT-32-R2 forced interleaving total: ${passed + failed}  ✓ ${passed}  ✗ ${failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main().catch((err) => {
  console.error('[F2-CT-32-R2 forced interleaving] fatal error:', err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
