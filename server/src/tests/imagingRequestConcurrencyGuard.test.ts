/**
 * imagingRequestConcurrencyGuard.test.ts — F2-CT-32-R1
 *
 * Real disposable-Postgres proof for the ImagingRequest PATCH/cancel
 * compare-and-set guard added in server/src/routes/imaging.ts to close
 * CR-03/BLK-02/FP-06 (see imagingRequestConcurrencyCharacterization.test.ts
 * / CT-32 for the original defect and the PATCH-vs-cancel race proof this
 * file complements). This file covers the remaining scenarios from the
 * task brief that CT-32 alone does not exercise:
 *
 *   A. PATCH vs PATCH on the same row, same starting state, two different
 *      (both individually valid) target statuses.
 *   C. CANCEL vs CANCEL — both the concurrent race and the pre-existing
 *      sequential (non-idempotent) contract.
 *   D. Two different ImagingRequest rows in the same clinic, mutated
 *      concurrently — must not block or interfere with each other.
 *   E. Two different clinics/organizations, mutated concurrently — same,
 *      plus tenant-isolation regression checks (unauthorized same-org
 *      clinic, cross-org clinic, non-existent id) to prove the
 *      findRequestInScope refactor (now returning { request, scope } so the
 *      CAS write can reuse the same scope as the read) did not change
 *      authorization semantics: cross-tenant and non-existent requests must
 *      remain indistinguishable (same 404 shape).
 *   F. F2-CT-32-R2 architecture-review fix: the post-CAS reload
 *      (`prisma.imagingRequest.findFirstOrThrow` run immediately after
 *      `cas.count === 1`, in both the PATCH and cancel handlers) must reuse
 *      the exact same resolved `scope` as the CAS write instead of falling
 *      back to an id-only `where`. Proven directly via a spy on
 *      `prisma.imagingRequest.findFirstOrThrow` that records the `where`
 *      clause actually sent for the reload, rather than only observing HTTP
 *      status codes (which can't distinguish "reload is scoped" from
 *      "reload happens to return the right row because ids are globally
 *      unique").
 *
 * Scenario A deliberately races two TERMINAL targets ('received' and
 * 'failed', both reachable from 'requested' per
 * imagingRequestTransitions.ts's ALLOWED_REQUEST_TRANSITIONS) rather than a
 * chainable pair like ('scheduled' -> then 'cancelled' is also valid from
 * 'scheduled'). This removes any ambiguity between "genuine race, guard
 * caught it" and "legitimate two-step sequential transition, both 200 is
 * correct" — once either terminal write commits, the loser's own
 * pre-write transition validation (against whatever it reads) can never
 * again see a non-terminal status, so at most one 200 is possible under
 * every interleaving, not just the empirically-observed one.
 *
 * Same real-HTTP-over-real-TCP technique as CT-32 (no supertest anywhere in
 * this repo; app.listen(0) + node:http): no sleeps, no artificial
 * synchronization barrier, no injected hook into route code.
 *
 * Run with: tsx src/tests/imagingRequestConcurrencyGuard.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres before import —
 * server/src/db.ts opens a live pg pool at import time. Wired into
 * `test:imaging-characterization` (see server/package.json).
 */

import 'dotenv/config';

process.env.CLINIC_BEARER_FALLBACK_ENABLED = 'true';

import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
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

// ─── Minimal pass/fail test runner (same shape as CT-32 / the rest of the disposable-Postgres suite) ───

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

// ─── Real, minimally-mounted app (mirrors CT-32 / index.ts's own mounting order) ───

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

// ─── F2-CT-32-R2: spy on the post-CAS reload's `where` clause ───
//
// Wraps prisma.imagingRequest.findFirstOrThrow for the duration of `fn`,
// recording each call's `where` argument before delegating to the real
// implementation (real DB round-trip, no mocked data). Restores the
// original method in `finally` so no other test observes the spy.

interface ReloadCall {
  where: Record<string, unknown>;
}

async function withReloadSpy<T>(fn: (calls: ReloadCall[]) => Promise<T>): Promise<T> {
  const calls: ReloadCall[] = [];
  const original = prisma.imagingRequest.findFirstOrThrow.bind(prisma.imagingRequest);
  (prisma.imagingRequest as any).findFirstOrThrow = (args: any) => {
    calls.push({ where: args.where });
    return original(args);
  };
  try {
    return await fn(calls);
  } finally {
    (prisma.imagingRequest as any).findFirstOrThrow = original;
  }
}

// ─── Fixture/token helpers ───

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

async function main() {
  section('F2-CT-32-R1 — ImagingRequest PATCH/cancel concurrency guard (A/C/D/E)');

  const fixtures = await createClinicFixtureSet('ct32r1-imaging-guard');
  const staffDefault = await createStaffUser({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId, role: 'DENTIST' });
  const patientDefault = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
  const tokenDefault = tokenFor(staffDefault);

  const staffSibling = await createStaffUser({ organizationId: fixtures.orgId, clinicId: fixtures.siblingClinicId, role: 'DENTIST' });
  const patientSibling = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.siblingClinicId });
  const tokenSibling = tokenFor(staffSibling);

  const staffCrossOrg = await createStaffUser({ organizationId: fixtures.otherOrgId, clinicId: fixtures.crossOrgClinicId, role: 'DENTIST' });
  const patientCrossOrg = await createTestPatient({ organizationId: fixtures.otherOrgId, clinicId: fixtures.crossOrgClinicId });
  const tokenCrossOrg = tokenFor(staffCrossOrg);

  const trackedClinicIds = [fixtures.defaultClinicId, fixtures.siblingClinicId, fixtures.unauthorizedClinicId, fixtures.crossOrgClinicId];

  try {
    await withServer(async (port) => {
      // ─── A. PATCH vs PATCH — same row, same starting state, two terminal targets ───
      section('A. PATCH vs PATCH (same row, both terminal targets)');
      for (let round = 1; round <= 10; round++) {
        const seeded = await seedRequest(fixtures.defaultClinicId, patientDefault.id, staffDefault.id);
        const [toReceived, toFailed] = await Promise.all([
          issueJson(port, { method: 'PATCH', path: `/api/imaging/requests/${seeded.id}`, token: tokenDefault, body: { status: 'received' } }),
          issueJson(port, { method: 'PATCH', path: `/api/imaging/requests/${seeded.id}`, token: tokenDefault, body: { status: 'failed' } }),
        ]);
        const finalRow = await prisma.imagingRequest.findUniqueOrThrow({ where: { id: seeded.id } });

        await test(`A round ${round}: exactly one of the two PATCHes wins (never both 200, never both 409)`, () => {
          const statuses = [toReceived.statusCode, toFailed.statusCode].sort();
          assert.deepEqual(statuses, [200, 409], `got received=${toReceived.statusCode} failed=${toFailed.statusCode}`);
        });
        await test(`A round ${round}: final persisted status matches whichever response reported 200`, () => {
          const winnerStatus = toReceived.statusCode === 200 ? 'received' : 'failed';
          assert.equal(finalRow.status, winnerStatus);
        });
        await test(`A round ${round}: the loser carries a known conflict code`, () => {
          const loser = toReceived.statusCode === 409 ? toReceived : toFailed;
          assert.ok(
            loser.body?.code === 'concurrent_transition' || loser.body?.code === 'already_terminal',
            `unexpected loser code "${loser.body?.code}"`,
          );
        });
      }

      // ─── C. CANCEL vs CANCEL ───
      section('C. CANCEL vs CANCEL');
      for (let round = 1; round <= 10; round++) {
        const seeded = await seedRequest(fixtures.defaultClinicId, patientDefault.id, staffDefault.id);
        const [cancelA, cancelB] = await Promise.all([
          issueJson(port, { method: 'PATCH', path: `/api/imaging/requests/${seeded.id}/cancel`, token: tokenDefault }),
          issueJson(port, { method: 'PATCH', path: `/api/imaging/requests/${seeded.id}/cancel`, token: tokenDefault }),
        ]);
        const finalRow = await prisma.imagingRequest.findUniqueOrThrow({ where: { id: seeded.id } });

        await test(`C round ${round}: exactly one concurrent cancel wins`, () => {
          const statuses = [cancelA.statusCode, cancelB.statusCode].sort();
          assert.deepEqual(statuses, [200, 409], `got a=${cancelA.statusCode} b=${cancelB.statusCode}`);
        });
        await test(`C round ${round}: final persisted status is cancelled exactly once, not double-applied`, () => {
          assert.equal(finalRow.status, 'cancelled');
        });
        await test(`C round ${round}: the losing concurrent cancel carries a known conflict code`, () => {
          const loser = cancelA.statusCode === 409 ? cancelA : cancelB;
          assert.ok(
            loser.body?.code === 'concurrent_transition' || loser.body?.code === 'already_terminal',
            `unexpected loser code "${loser.body?.code}"`,
          );
        });
      }

      await test('C: sequential double-cancel preserves the existing non-idempotent contract (second cancel is 409 already_terminal, not 200)', async () => {
        const seeded = await seedRequest(fixtures.defaultClinicId, patientDefault.id, staffDefault.id);
        const first = await issueJson(port, { method: 'PATCH', path: `/api/imaging/requests/${seeded.id}/cancel`, token: tokenDefault });
        const second = await issueJson(port, { method: 'PATCH', path: `/api/imaging/requests/${seeded.id}/cancel`, token: tokenDefault });
        assert.equal(first.statusCode, 200);
        assert.equal(second.statusCode, 409);
        assert.equal(second.body?.code, 'already_terminal');
      });

      // ─── D. Different ImagingRequests, same clinic, concurrently ───
      section('D. Different ImagingRequest rows, same clinic, concurrently');
      await test('D: two independent rows in the same clinic both succeed concurrently — no cross-row interference', async () => {
        const rowOne = await seedRequest(fixtures.defaultClinicId, patientDefault.id, staffDefault.id);
        const rowTwo = await seedRequest(fixtures.defaultClinicId, patientDefault.id, staffDefault.id);

        const [resOne, resTwo] = await Promise.all([
          issueJson(port, { method: 'PATCH', path: `/api/imaging/requests/${rowOne.id}`, token: tokenDefault, body: { status: 'scheduled' } }),
          issueJson(port, { method: 'PATCH', path: `/api/imaging/requests/${rowTwo.id}`, token: tokenDefault, body: { status: 'scheduled' } }),
        ]);

        assert.equal(resOne.statusCode, 200, `row one unexpectedly rejected: ${JSON.stringify(resOne.body)}`);
        assert.equal(resTwo.statusCode, 200, `row two unexpectedly rejected: ${JSON.stringify(resTwo.body)}`);

        const [finalOne, finalTwo] = await Promise.all([
          prisma.imagingRequest.findUniqueOrThrow({ where: { id: rowOne.id } }),
          prisma.imagingRequest.findUniqueOrThrow({ where: { id: rowTwo.id } }),
        ]);
        assert.equal(finalOne.status, 'scheduled');
        assert.equal(finalTwo.status, 'scheduled');
      });

      // ─── E. Different clinics/organizations, concurrently ───
      section('E. Different clinics/organizations, concurrently');
      await test('E: concurrent mutations in two different same-org clinics both succeed, no interference', async () => {
        const rowDefault = await seedRequest(fixtures.defaultClinicId, patientDefault.id, staffDefault.id);
        const rowSibling = await seedRequest(fixtures.siblingClinicId, patientSibling.id, staffSibling.id);

        const [resDefault, resSibling] = await Promise.all([
          issueJson(port, { method: 'PATCH', path: `/api/imaging/requests/${rowDefault.id}`, token: tokenDefault, body: { status: 'scheduled' } }),
          issueJson(port, { method: 'PATCH', path: `/api/imaging/requests/${rowSibling.id}`, token: tokenSibling, body: { status: 'scheduled' } }),
        ]);

        assert.equal(resDefault.statusCode, 200);
        assert.equal(resSibling.statusCode, 200);
      });

      await test('E: concurrent mutations across two different organizations both succeed, no interference', async () => {
        const rowDefault = await seedRequest(fixtures.defaultClinicId, patientDefault.id, staffDefault.id);
        const rowCrossOrg = await seedRequest(fixtures.crossOrgClinicId, patientCrossOrg.id, staffCrossOrg.id);

        const [resDefault, resCrossOrg] = await Promise.all([
          issueJson(port, { method: 'PATCH', path: `/api/imaging/requests/${rowDefault.id}/cancel`, token: tokenDefault }),
          issueJson(port, { method: 'PATCH', path: `/api/imaging/requests/${rowCrossOrg.id}/cancel`, token: tokenCrossOrg }),
        ]);

        assert.equal(resDefault.statusCode, 200);
        assert.equal(resCrossOrg.statusCode, 200);
      });

      // ─── Tenant-isolation regression checks — the CAS refactor (findRequestInScope
      // now returns { request, scope }) must not change authorization semantics. ───
      section('Tenant isolation (unchanged by the CAS refactor)');

      await test('same-clinic valid mutation still succeeds (control case)', async () => {
        const row = await seedRequest(fixtures.defaultClinicId, patientDefault.id, staffDefault.id);
        const res = await issueJson(port, { method: 'PATCH', path: `/api/imaging/requests/${row.id}`, token: tokenDefault, body: { status: 'scheduled' } });
        assert.equal(res.statusCode, 200);
      });

      let unauthorizedClinicResponse: HttpJsonResult;
      await test('unauthorized same-org clinic: PATCH on a request outside the caller\'s allowedClinicIds is 404 (no cross-tenant existence oracle)', async () => {
        const unauthorizedRow = await prisma.imagingRequest.create({
          data: {
            clinicId: fixtures.unauthorizedClinicId,
            patientId: (await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.unauthorizedClinicId })).id,
            requestedModality: 'PX',
            requestedByUserId: staffDefault.id,
            status: 'requested',
          },
        });
        unauthorizedClinicResponse = await issueJson(port, {
          method: 'PATCH',
          path: `/api/imaging/requests/${unauthorizedRow.id}`,
          token: tokenDefault,
          body: { status: 'scheduled' },
        });
        assert.equal(unauthorizedClinicResponse.statusCode, 404);
      });

      let crossOrgResponse: HttpJsonResult;
      await test('cross-org clinic: PATCH on a request in a different organization entirely is 404', async () => {
        const row = await seedRequest(fixtures.crossOrgClinicId, patientCrossOrg.id, staffCrossOrg.id);
        crossOrgResponse = await issueJson(port, {
          method: 'PATCH',
          path: `/api/imaging/requests/${row.id}`,
          token: tokenDefault,
          body: { status: 'scheduled' },
        });
        assert.equal(crossOrgResponse.statusCode, 404);
      });

      let nonExistentResponse: HttpJsonResult;
      await test('non-existent request id is 404', async () => {
        nonExistentResponse = await issueJson(port, {
          method: 'PATCH',
          path: `/api/imaging/requests/${randomUUID()}`,
          token: tokenDefault,
          body: { status: 'scheduled' },
        });
        assert.equal(nonExistentResponse.statusCode, 404);
      });

      await test('cross-tenant and non-existent responses are indistinguishable (same status + body shape)', () => {
        assert.equal(unauthorizedClinicResponse.statusCode, crossOrgResponse.statusCode);
        assert.equal(crossOrgResponse.statusCode, nonExistentResponse.statusCode);
        assert.deepEqual(unauthorizedClinicResponse.body, crossOrgResponse.body);
        assert.deepEqual(crossOrgResponse.body, nonExistentResponse.body);
      });

      await test('cancel endpoint: unauthorized same-org clinic is also 404 (same guard reused by the cancel handler)', async () => {
        const patientUnauth = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.unauthorizedClinicId });
        const row = await seedRequest(fixtures.unauthorizedClinicId, patientUnauth.id, staffDefault.id);
        const res = await issueJson(port, { method: 'PATCH', path: `/api/imaging/requests/${row.id}/cancel`, token: tokenDefault });
        assert.equal(res.statusCode, 404);
      });

      // ─── F. F2-CT-32-R2 — post-CAS reload must reuse the resolved scope ───
      section('F. Post-CAS reload preserves the resolved tenant/clinic scope (F2-CT-32-R2)');

      await test('PATCH: post-CAS reload where-clause carries the resolved clinic scope, not id-only, and the reload succeeds', async () => {
        const row = await seedRequest(fixtures.defaultClinicId, patientDefault.id, staffDefault.id);
        let statusCode = 0;
        const calls = await withReloadSpy(async (calls) => {
          const res = await issueJson(port, {
            method: 'PATCH',
            path: `/api/imaging/requests/${row.id}`,
            token: tokenDefault,
            body: { status: 'scheduled' },
          });
          statusCode = res.statusCode;
          return calls;
        });

        assert.equal(statusCode, 200, 'PATCH with a valid CAS transition must still succeed after the R2 fix');
        assert.equal(calls.length, 1, 'expected exactly one post-CAS reload');
        assert.equal(calls[0].where.id, row.id);
        assert.ok(
          'clinicId' in calls[0].where,
          `post-CAS reload where-clause must include the resolved clinic scope, got keys: ${Object.keys(calls[0].where)}`,
        );
      });

      await test('cancel: post-CAS reload where-clause carries the resolved clinic scope, not id-only, and the reload succeeds', async () => {
        const row = await seedRequest(fixtures.defaultClinicId, patientDefault.id, staffDefault.id);
        let statusCode = 0;
        const calls = await withReloadSpy(async (calls) => {
          const res = await issueJson(port, {
            method: 'PATCH',
            path: `/api/imaging/requests/${row.id}/cancel`,
            token: tokenDefault,
          });
          statusCode = res.statusCode;
          return calls;
        });

        assert.equal(statusCode, 200, 'cancel of a cancellable request must still succeed after the R2 fix');
        assert.equal(calls.length, 1, 'expected exactly one post-CAS reload');
        assert.equal(calls[0].where.id, row.id);
        assert.ok(
          'clinicId' in calls[0].where,
          `post-CAS reload where-clause must include the resolved clinic scope, got keys: ${Object.keys(calls[0].where)}`,
        );
      });

      await test('PATCH: post-CAS reload scope matches the same-org sibling clinic caller, not the default clinic', async () => {
        const row = await seedRequest(fixtures.siblingClinicId, patientSibling.id, staffSibling.id);
        const calls = await withReloadSpy(async (calls) => {
          const res = await issueJson(port, {
            method: 'PATCH',
            path: `/api/imaging/requests/${row.id}`,
            token: tokenSibling,
            body: { status: 'scheduled' },
          });
          assert.equal(res.statusCode, 200);
          return calls;
        });

        assert.equal(calls.length, 1);
        // findRequestInScope resolves scope via validateAndGetClinicIdScope(user, undefined, res)
        // with no selectedClinicId, so a single-clinic staff user's scope is
        // `{ clinicId: { in: [theirOneAllowedClinicId] } }` (see buildClinicIdScope
        // in clinicScope.ts), not a bare string.
        assert.deepEqual(
          calls[0].where.clinicId,
          { in: [fixtures.siblingClinicId] },
          'reload scope must reflect the caller\'s own resolved clinic, not a stale/default one',
        );
      });
    });
  } finally {
    await prisma.imagingRequest.deleteMany({ where: { clinicId: { in: trackedClinicIds } } });
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: [fixtures.orgId, fixtures.otherOrgId] } } });
    await cleanupAllFixtures();
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`F2-CT-32-R1 guard suite total: ${passed + failed}  ✓ ${passed}  ✗ ${failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main().catch((err) => {
  console.error('[F2-CT-32-R1] fatal error:', err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
