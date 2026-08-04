/**
 * whatsappPublicApiExplicitClinicBinding.test.ts — F2-SEC-002 (R0 + R1)
 *
 * Real disposable-PostgreSQL, real-route-handler verification of the legacy
 * secret-gated WhatsApp public API (GET/POST /api/public/whatsapp/*) clinic
 * resolution — see docs/program/evidence/F2-SEC-002_WHATSAPP_EXPLICIT_CLINIC_RESOLUTION.md.
 *
 * R0 removed the global/first-created-clinic fallback but only required
 * *uniqueness* of the active Evolution WhatsAppConnection — not that the
 * request's own credential identify *which* connection. R1 (this file's
 * primary addition) requires the caller-presented secret to resolve to
 * exactly one connection via that connection's own `webhookSecret`, then
 * verifies connection.organizationId === clinicLink.organizationId ===
 * clinic.organizationId before any tenant read/write. The pre-existing
 * global WHATSAPP_WEBHOOK_SECRET is retained ONLY as
 * LEGACY_SINGLE_CONNECTION_COMPATIBILITY (exactly one active Evolution
 * connection deployed, org-consistent) — never as the normal multi-tenant
 * resolution mechanism.
 *
 * Uses the same real-DB / real-Express-handler convention as
 * appointmentRequestConversionAtomicity.test.ts (dbVerificationHarness.ts)
 * — no mocked Prisma, no in-memory simulation, no mocked clinic resolution,
 * no mocked secret comparison.
 *
 * Run: npx tsx src/tests/dbVerification/whatsappPublicApiExplicitClinicBinding.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres before import.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import whatsappRouter from '../../routes/whatsapp.js';
import { encryptSecretTagged } from '../../utils/encryption.js';
import {
  createSuite,
  getFullChain,
  runChain,
  mockResponse,
  prisma,
  type MockResponse,
} from './dbVerificationHarness.js';

const { section, test, summary } = createSuite('whatsappPublicApiExplicitClinicBinding');

process.env.ENCRYPTION_KEY = 'c'.repeat(64);

const TEST_SECRET = `test-whatsapp-secret-${randomUUID()}`;
process.env.WHATSAPP_WEBHOOK_SECRET = TEST_SECRET;

const SERVICES_CHAIN = getFullChain(whatsappRouter as any, 'get', '/services');
const DOCTORS_CHAIN = getFullChain(whatsappRouter as any, 'get', '/doctors');
const AVAILABILITY_CHAIN = getFullChain(whatsappRouter as any, 'get', '/availability');
const APPOINTMENT_LOOKUP_CHAIN = getFullChain(whatsappRouter as any, 'get', '/appointment-lookup');
const APPOINTMENT_REQUESTS_CHAIN = getFullChain(whatsappRouter as any, 'post', '/appointment-requests');
const CANCEL_REQUEST_CHAIN = getFullChain(whatsappRouter as any, 'post', '/cancel-request');

// ─── Request builder (unauthenticated public API — no AuthRequest.user) ────

function publicReq(opts: {
  secret?: string | null; // undefined = valid TEST_SECRET (legacy global), null = no header at all
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}): any {
  const headers: Record<string, string> =
    opts.secret === null ? {} : { 'x-whatsapp-secret': opts.secret ?? TEST_SECRET };
  return { headers, query: opts.query ?? {}, body: opts.body ?? {} };
}

async function call(chain: any[], req: any): Promise<MockResponse> {
  const res = mockResponse();
  await runChain(chain, req, res);
  return res;
}

// ─── Local fixture builders (full control over creation order / topology —
// deliberately not reusing dbVerificationHarness's createClinicFixtureSet,
// which batches all clinics in one Promise.all and cannot express the
// "foreign clinic seeded before/after" / "corrupted cross-org link" ordering
// this defect requires) ────

const createdOrgIds: string[] = [];

async function createOrg(label: string) {
  const suffix = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({
    data: { name: `${label} ${suffix}`, slug: `${label}-${suffix}`.toLowerCase() },
  });
  createdOrgIds.push(org.id);
  return org;
}

async function createClinic(organizationId: string, label: string) {
  const suffix = randomUUID().slice(0, 8);
  return prisma.clinic.create({
    data: { name: `${label} ${suffix}`, slug: `${label}-${suffix}`.toLowerCase(), organizationId },
  });
}

async function createConnection(
  organizationId: string,
  opts: { isActive?: boolean; provider?: string; webhookSecret?: string } = {},
) {
  const suffix = randomUUID().slice(0, 8);
  return prisma.whatsAppConnection.create({
    data: {
      organizationId,
      name: `Conn ${suffix}`,
      provider: opts.provider ?? 'evolution_api',
      isActive: opts.isActive ?? true,
      webhookSecret: opts.webhookSecret ? encryptSecretTagged(opts.webhookSecret) : undefined,
    },
  });
}

async function linkClinicConnection(organizationId: string, clinicId: string, whatsappConnectionId: string) {
  return prisma.clinicWhatsAppConnection.create({
    data: { organizationId, clinicId, whatsappConnectionId, isDefault: true },
  });
}

/**
 * One org + one clinic + one active connection + one clinic link — the
 * "valid single binding" shape. Pass `webhookSecret` to give the connection
 * its own R1 credential; omit it to exercise LEGACY_SINGLE_CONNECTION_COMPATIBILITY
 * (the connection has no secret of its own, so only the global
 * WHATSAPP_WEBHOOK_SECRET — under a strict single-connection topology — can
 * resolve it).
 */
async function createBoundClinic(label: string, opts: { webhookSecret?: string } = {}) {
  const org = await createOrg(label);
  const clinic = await createClinic(org.id, label);
  const connection = await createConnection(org.id, { webhookSecret: opts.webhookSecret });
  await linkClinicConnection(org.id, clinic.id, connection.id);
  return { org, clinic, connection };
}

/** Org + clinic with NO WhatsApp connection at all — the "foreign/unrelated clinic" that must never be selected. */
async function createUnboundClinic(label: string) {
  const org = await createOrg(label);
  const clinic = await createClinic(org.id, label);
  return { org, clinic };
}

async function countAppointmentRequests(clinicId: string) {
  return prisma.appointmentRequest.count({ where: { clinicId } });
}

/**
 * Deletes exactly the given orgs' data, FK-safe order. Several scenarios
 * below (legacy-path fixtures) resolve the bound clinic from a system-wide
 * (not per-organization) query — `WhatsAppConnection.isActive` across the
 * whole table — precisely because these routes carry no per-request
 * org/clinic identity when relying on the legacy global secret. That means
 * any WhatsApp connection left behind by an earlier test would silently turn
 * a later "exactly one binding" scenario into an "ambiguous" one. Every test
 * below therefore tears its own fixtures down immediately (see
 * isolatedTest), rather than deferring to one cleanup pass at the end.
 * Also handles the "missing clinic row" scenario, where the clinic row is
 * already gone before this runs — every step here is a no-op-safe deleteMany.
 */
async function cleanupOrgs(orgIds: string[]) {
  if (orgIds.length === 0) return;
  const clinics = await prisma.clinic.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } });
  const clinicIds = clinics.map((c) => c.id);

  await prisma.appointmentRequest.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.appointmentType.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.clinicWhatsAppConnection.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.whatsAppConnection.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.clinic.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
}

/** Runs `fn`, then deletes every org `fn` created (via createOrg), regardless of pass/fail. */
async function isolatedTest(name: string, fn: () => void | Promise<void>) {
  await test(name, async () => {
    const startLen = createdOrgIds.length;
    try {
      await fn();
    } finally {
      const ids = createdOrgIds.splice(startLen);
      await cleanupOrgs(ids);
    }
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────

async function main() {
  section('Scenario 1 — one valid explicit binding resolves the correct clinic (LEGACY_SINGLE_CONNECTION_COMPATIBILITY)');
  await isolatedTest('GET /services resolves the explicitly bound clinic and preserves successful behavior', async () => {
    const { clinic } = await createBoundClinic('s1-services');
    const res = await call(SERVICES_CHAIN, publicReq({}));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.clinic.id, clinic.id);
    assert.ok(Array.isArray(res.body.services));
  });

  await isolatedTest('GET /doctors resolves the explicitly bound clinic', async () => {
    const { clinic } = await createBoundClinic('s1-doctors');
    const res = await call(DOCTORS_CHAIN, publicReq({}));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.clinic.id, clinic.id);
  });

  await isolatedTest('GET /appointment-lookup resolves the explicitly bound clinic', async () => {
    const { clinic } = await createBoundClinic('s1-lookup');
    const res = await call(APPOINTMENT_LOOKUP_CHAIN, publicReq({ query: { phone: '5551234567' } }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.clinic.id, clinic.id);
    assert.deepEqual(res.body.appointments, []);
  });

  await isolatedTest('GET /availability resolves the explicitly bound clinic and returns slots for its own service', async () => {
    const { clinic } = await createBoundClinic('s1-availability');
    const appointmentType = await prisma.appointmentType.create({
      data: { clinicId: clinic.id, name: 'Checkup', durationMinutes: 30, isActive: true, isService: true },
    });
    const res = await call(
      AVAILABILITY_CHAIN,
      publicReq({ query: { appointmentTypeId: appointmentType.id, date: '2026-08-10' } }),
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.clinic.id, clinic.id);
  });

  await isolatedTest('an active Meta Cloud API connection elsewhere does not make the Evolution-only legacy API ambiguous', async () => {
    // This legacy public API (and /evolution-webhook in the same file) is
    // Evolution-only — Meta Cloud API has its own separate webhook route
    // (routes/metaWhatsAppWebhook.ts). A clinic that also happens to run an
    // active Meta connection must not turn this resolver's uniqueness check
    // ambiguous; only evolution_api connections are relevant here.
    const { clinic } = await createBoundClinic('s1-mixed-provider');
    const metaOrg = await createOrg('s1-mixed-provider-meta');
    await createConnection(metaOrg.id, { provider: 'meta_cloud_api' });
    const res = await call(SERVICES_CHAIN, publicReq({}));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.clinic.id, clinic.id);
  });

  section('Scenario 2 — no matching binding fails closed');
  await isolatedTest('zero active WhatsApp connections: GET /services fails closed with generic 404', async () => {
    const res = await call(SERVICES_CHAIN, publicReq({}));
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'Clinic not found');
    assert.equal(res.body.clinic, undefined);
  });

  await isolatedTest('zero active WhatsApp connections: POST /appointment-requests creates no row, calls no downstream processing', async () => {
    const { clinic } = await createUnboundClinic('s2-no-binding');
    const before = await countAppointmentRequests(clinic.id);
    const res = await call(
      APPOINTMENT_REQUESTS_CHAIN,
      publicReq({ body: { patientName: 'Jane Doe', phone: '5551110000' } }),
    );
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'Clinic not found');
    const after = await countAppointmentRequests(clinic.id);
    assert.equal(after, before);
  });

  section('Scenario 3 — multiple matching bindings fail closed (never chooses the first)');
  await isolatedTest('two orgs each with their own legacy-compatible binding: GET /services is ambiguous, fails closed', async () => {
    // Neither connection carries its own webhookSecret, so both rely solely on
    // the shared global secret — with two active connections, the
    // LEGACY_SINGLE_CONNECTION_COMPATIBILITY topology check fails and the
    // request can no longer resolve to either org. This is BLOCKING FINDING 1
    // from the R1 review, reproduced directly: the public API fails closed
    // rather than silently routing to whichever org happens to be selected.
    const { clinic: clinicA } = await createBoundClinic('s3-org-a');
    const { clinic: clinicB } = await createBoundClinic('s3-org-b');
    const res = await call(SERVICES_CHAIN, publicReq({}));
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'Clinic not found');
    // Explicit non-enumeration check: the 404 payload must carry no clinic
    // field at all, not merely one that happens to differ from A/B (a
    // `notEqual` against `clinic?.id` would pass vacuously if `clinic` were
    // ever added to the 404 body with an unrelated id).
    assert.equal(res.body.clinic, undefined);
    void clinicA;
    void clinicB;
  });

  await isolatedTest('two orgs each with their own legacy-compatible binding: POST /appointment-requests creates no tenant data in either clinic', async () => {
    const { clinic: clinicA } = await createBoundClinic('s3-write-a');
    const { clinic: clinicB } = await createBoundClinic('s3-write-b');
    const beforeA = await countAppointmentRequests(clinicA.id);
    const beforeB = await countAppointmentRequests(clinicB.id);
    const res = await call(
      APPOINTMENT_REQUESTS_CHAIN,
      publicReq({ body: { patientName: 'Ambiguous Caller', phone: '5552220000' } }),
    );
    assert.equal(res.statusCode, 404);
    assert.equal(await countAppointmentRequests(clinicA.id), beforeA);
    assert.equal(await countAppointmentRequests(clinicB.id), beforeB);
  });

  await isolatedTest('one legacy-compatible connection linked to two clinics (shared line, no prior context): fails closed, not the first link', async () => {
    const org = await createOrg('s3-shared');
    const clinicX = await createClinic(org.id, 's3-shared-x');
    const clinicY = await createClinic(org.id, 's3-shared-y');
    const connection = await createConnection(org.id);
    await linkClinicConnection(org.id, clinicX.id, connection.id);
    await linkClinicConnection(org.id, clinicY.id, connection.id);
    const res = await call(SERVICES_CHAIN, publicReq({}));
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'Clinic not found');
  });

  section('Scenario 4/5 — a foreign/default/first-active clinic is never selected without explicit binding');
  await isolatedTest('foreign clinic seeded BEFORE the bound clinic (would be "oldest") is never selected', async () => {
    const { clinic: foreignClinic } = await createUnboundClinic('s4-foreign-first');
    const { clinic: boundClinic } = await createBoundClinic('s4-bound-second');
    const res = await call(SERVICES_CHAIN, publicReq({}));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.clinic.id, boundClinic.id);
    assert.notEqual(res.body.clinic.id, foreignClinic.id);
  });

  await isolatedTest('foreign clinic seeded AFTER the bound clinic: resolution is unaffected by seeding order', async () => {
    const { clinic: boundClinic } = await createBoundClinic('s5-bound-first');
    const { clinic: foreignClinic } = await createUnboundClinic('s5-foreign-second');
    const res = await call(SERVICES_CHAIN, publicReq({}));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.clinic.id, boundClinic.id);
    assert.notEqual(res.body.clinic.id, foreignClinic.id);
  });

  await isolatedTest('inactive connection is not selected — zero ACTIVE connections still fails closed even though a row exists', async () => {
    const org = await createOrg('s-inactive');
    const clinic = await createClinic(org.id, 's-inactive');
    const connection = await createConnection(org.id, { isActive: false });
    await linkClinicConnection(org.id, clinic.id, connection.id);
    const res = await call(SERVICES_CHAIN, publicReq({}));
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'Clinic not found');
  });

  section('Scenario 6 — cross-tenant write prevention (single-tenant legacy-compatible topology)');
  await isolatedTest('Organization A request creates data under Clinic A only — never Organization B, never a foreign clinic', async () => {
    const { org: orgA, clinic: clinicA, connection } = await createBoundClinic('s6-org-a');
    const { clinic: foreignClinic } = await createUnboundClinic('s6-foreign');
    const res = await call(
      APPOINTMENT_REQUESTS_CHAIN,
      publicReq({ body: { patientName: 'Alice A', phone: '5553330000' } }),
    );
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.clinicId, clinicA.id);
    assert.equal(await countAppointmentRequests(foreignClinic.id), 0);
    assert.equal(connection.organizationId, orgA.id);
  });

  section('Scenario 8 — spoofed client-supplied clinicId is ignored');
  await isolatedTest('a clinicId in the request body cannot override the trusted binding', async () => {
    const { clinic: trustedClinic } = await createBoundClinic('s8-trusted');
    const { clinic: spoofedTargetClinic } = await createUnboundClinic('s8-spoof-target');
    const res = await call(
      APPOINTMENT_REQUESTS_CHAIN,
      publicReq({
        body: { patientName: 'Spoofer', phone: '5555550000', clinicId: spoofedTargetClinic.id },
      }),
    );
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.clinicId, trustedClinic.id);
    assert.notEqual(res.body.clinicId, spoofedTargetClinic.id);
    assert.equal(await countAppointmentRequests(spoofedTargetClinic.id), 0);
  });

  await isolatedTest('cancel-request: a clinicId in the request body cannot override the trusted binding', async () => {
    const { clinic: trustedClinic } = await createBoundClinic('s8-cancel-trusted');
    const { clinic: spoofedTargetClinic } = await createUnboundClinic('s8-cancel-spoof-target');
    const res = await call(
      CANCEL_REQUEST_CHAIN,
      publicReq({
        body: { patientName: 'Canceler', phone: '5556660000', clinicId: spoofedTargetClinic.id },
      }),
    );
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.clinicId, trustedClinic.id);
    assert.equal(await countAppointmentRequests(spoofedTargetClinic.id), 0);
  });

  section('Scenario 9 — invalid/missing credential creates no tenant side effects');
  await isolatedTest('missing secret header: creates no appointment request, 401 (no DB read of any kind — pure request-shape check)', async () => {
    const { clinic } = await createBoundClinic('s9-missing-secret');
    const before = await countAppointmentRequests(clinic.id);
    const res = await call(
      APPOINTMENT_REQUESTS_CHAIN,
      publicReq({ secret: null, body: { patientName: 'Frank', phone: '5558880000' } }),
    );
    assert.equal(res.statusCode, 401);
    assert.equal(await countAppointmentRequests(clinic.id), before);
  });

  await isolatedTest(
    'a secret that is present but matches nothing (not a connection secret, not the legacy global secret): creates no appointment request, generic 404 — ' +
      'R1 non-enumeration: once a credential is presented, "wrong secret" and "right secret but ambiguous/cross-org topology" must be indistinguishable ' +
      'from the outside (see NON-ENUMERATION requirement), so this is no longer 401 the way a purely-missing header is',
    async () => {
      const { clinic } = await createBoundClinic('s9-invalid-secret');
      const before = await countAppointmentRequests(clinic.id);
      const res = await call(
        APPOINTMENT_REQUESTS_CHAIN,
        publicReq({ secret: `wrong-secret-${randomUUID()}`, body: { patientName: 'Eve', phone: '5557770000' } }),
      );
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.error, 'Clinic not found');
      assert.equal(await countAppointmentRequests(clinic.id), before);
    },
  );

  section('Scenario 10 — backward compatibility of the existing valid single-tenant path');
  await isolatedTest('GET /services and POST /appointment-requests remain consistent for the same explicitly bound clinic', async () => {
    const { clinic } = await createBoundClinic('s10-compat');
    const servicesRes = await call(SERVICES_CHAIN, publicReq({}));
    assert.equal(servicesRes.statusCode, 200);
    assert.equal(servicesRes.body.clinic.id, clinic.id);

    const createRes = await call(
      APPOINTMENT_REQUESTS_CHAIN,
      publicReq({ body: { patientName: 'Grace', phone: '5559990000' } }),
    );
    assert.equal(createRes.statusCode, 201);
    assert.equal(createRes.body.clinicId, clinic.id);
  });

  // ─── R1 — connection-specific credential binding (BLOCKING FINDING 1) ──
  //
  // Everything above this point is the R0 "uniqueness" model, preserved
  // exactly (only the invalid-secret status code changed, per the
  // non-enumeration note in Scenario 9). Everything below is new: it proves
  // the caller's OWN secret — not merely "is there exactly one connection
  // anywhere" — determines which clinic a request binds to. This is the
  // corrected replacement for the R0 test "Organization A request cannot
  // fall through to Organization B when only B has a binding", which the R1
  // review correctly flagged as not actually testing an Org-A-owned
  // credential at all (there was no Org A identity in that scenario — the
  // request succeeded only because B was the *only* configured org, which is
  // precisely BLOCKING FINDING 1). No test below calls a request
  // "Organization A's" unless it carries and verifies an A-owned
  // connection-specific secret.

  section('R1 — connection-specific secret binds the request to exactly one connection-owned clinic');

  await isolatedTest(
    'two simultaneously active connections, each with its own secret: GET /services, /doctors, /appointment-lookup, /availability resolve strictly to their own connection-owned clinic',
    async () => {
      const secretA = `secret-a-${randomUUID()}`;
      const secretB = `secret-b-${randomUUID()}`;
      const { clinic: clinicA } = await createBoundClinic('r1-get-a', { webhookSecret: secretA });
      const { clinic: clinicB } = await createBoundClinic('r1-get-b', { webhookSecret: secretB });
      const appointmentTypeA = await prisma.appointmentType.create({
        data: { clinicId: clinicA.id, name: 'Checkup A', durationMinutes: 30, isActive: true, isService: true },
      });
      const appointmentTypeB = await prisma.appointmentType.create({
        data: { clinicId: clinicB.id, name: 'Checkup B', durationMinutes: 30, isActive: true, isService: true },
      });

      for (const [secret, clinic] of [
        [secretA, clinicA],
        [secretB, clinicB],
      ] as const) {
        const servicesRes = await call(SERVICES_CHAIN, publicReq({ secret }));
        assert.equal(servicesRes.statusCode, 200);
        assert.equal(servicesRes.body.clinic.id, clinic.id);

        const doctorsRes = await call(DOCTORS_CHAIN, publicReq({ secret }));
        assert.equal(doctorsRes.statusCode, 200);
        assert.equal(doctorsRes.body.clinic.id, clinic.id);

        const lookupRes = await call(APPOINTMENT_LOOKUP_CHAIN, publicReq({ secret, query: { phone: '5551230000' } }));
        assert.equal(lookupRes.statusCode, 200);
        assert.equal(lookupRes.body.clinic.id, clinic.id);
      }

      const availA = await call(
        AVAILABILITY_CHAIN,
        publicReq({ secret: secretA, query: { appointmentTypeId: appointmentTypeA.id, date: '2026-08-10' } }),
      );
      assert.equal(availA.statusCode, 200);
      assert.equal(availA.body.clinic.id, clinicA.id);

      const availB = await call(
        AVAILABILITY_CHAIN,
        publicReq({ secret: secretB, query: { appointmentTypeId: appointmentTypeB.id, date: '2026-08-10' } }),
      );
      assert.equal(availB.statusCode, 200);
      assert.equal(availB.body.clinic.id, clinicB.id);

      // Cross-check: secret A resolves clinic A, but clinic A has no service
      // named appointmentTypeB — proves A's binding, not just "some 200".
      const crossA = await call(
        AVAILABILITY_CHAIN,
        publicReq({ secret: secretA, query: { appointmentTypeId: appointmentTypeB.id, date: '2026-08-10' } }),
      );
      assert.equal(crossA.statusCode, 404);
    },
  );

  await isolatedTest(
    'two simultaneously active connections, each with its own secret: POST /appointment-requests and /cancel-request write strictly to their own clinic — secret A cannot write to Clinic B and vice versa; a spoofed clinicId cannot override the connection-specific binding',
    async () => {
      const secretA = `secret-a-${randomUUID()}`;
      const secretB = `secret-b-${randomUUID()}`;
      const { clinic: clinicA } = await createBoundClinic('r1-post-a', { webhookSecret: secretA });
      const { clinic: clinicB } = await createBoundClinic('r1-post-b', { webhookSecret: secretB });

      const reqA = await call(
        APPOINTMENT_REQUESTS_CHAIN,
        publicReq({ secret: secretA, body: { patientName: 'Alice A', phone: '5551110001' } }),
      );
      assert.equal(reqA.statusCode, 201);
      assert.equal(reqA.body.clinicId, clinicA.id);

      const cancelB = await call(
        CANCEL_REQUEST_CHAIN,
        publicReq({ secret: secretB, body: { patientName: 'Bob B', phone: '5551110002' } }),
      );
      assert.equal(cancelB.statusCode, 201);
      assert.equal(cancelB.body.clinicId, clinicB.id);

      // Secret A's write never landed on B, and secret B's write never landed on A.
      assert.equal(await countAppointmentRequests(clinicA.id), 1);
      assert.equal(await countAppointmentRequests(clinicB.id), 1);

      // Secret A with a spoofed clinicId=B in the body still resolves/writes to A only.
      const spoofed = await call(
        APPOINTMENT_REQUESTS_CHAIN,
        publicReq({ secret: secretA, body: { patientName: 'Spoofer', phone: '5551110003', clinicId: clinicB.id } }),
      );
      assert.equal(spoofed.statusCode, 201);
      assert.equal(spoofed.body.clinicId, clinicA.id);
      assert.equal(await countAppointmentRequests(clinicB.id), 1); // unchanged — still just cancelB's row
    },
  );

  await isolatedTest(
    'unknown secret with connection-specific secrets already configured: fails closed, no side effects',
    async () => {
      const secretA = `secret-a-${randomUUID()}`;
      const { clinic: clinicA } = await createBoundClinic('r1-unknown-secret', { webhookSecret: secretA });
      const before = await countAppointmentRequests(clinicA.id);
      const res = await call(
        APPOINTMENT_REQUESTS_CHAIN,
        publicReq({ secret: `mallory-${randomUUID()}`, body: { patientName: 'Mallory', phone: '5551110004' } }),
      );
      assert.equal(res.statusCode, 404);
      assert.equal(await countAppointmentRequests(clinicA.id), before);
    },
  );

  await isolatedTest(
    'the same webhookSecret configured on two different active connections (misconfiguration): ambiguous credential fails closed, no first-match, no write to either clinic',
    async () => {
      const sharedSecret = `secret-dup-${randomUUID()}`;
      const { clinic: clinicA } = await createBoundClinic('r1-dup-secret-a', { webhookSecret: sharedSecret });
      const { clinic: clinicB } = await createBoundClinic('r1-dup-secret-b', { webhookSecret: sharedSecret });

      const beforeA = await countAppointmentRequests(clinicA.id);
      const beforeB = await countAppointmentRequests(clinicB.id);
      const res = await call(
        APPOINTMENT_REQUESTS_CHAIN,
        publicReq({ secret: sharedSecret, body: { patientName: 'Dup Secret', phone: '5551230033' } }),
      );
      assert.equal(res.statusCode, 404);
      assert.equal(await countAppointmentRequests(clinicA.id), beforeA);
      assert.equal(await countAppointmentRequests(clinicB.id), beforeB);
    },
  );

  await isolatedTest(
    'one connection (with its own secret) linked to two clinics: fails closed, not the first link',
    async () => {
      const secret = `secret-shared-${randomUUID()}`;
      const org = await createOrg('r1-shared-secret');
      const connection = await createConnection(org.id, { webhookSecret: secret });
      const clinicX = await createClinic(org.id, 'r1-shared-secret-x');
      const clinicY = await createClinic(org.id, 'r1-shared-secret-y');
      await linkClinicConnection(org.id, clinicX.id, connection.id);
      await linkClinicConnection(org.id, clinicY.id, connection.id);

      const res = await call(SERVICES_CHAIN, publicReq({ secret }));
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.clinic, undefined);
    },
  );

  await isolatedTest(
    'cross-org denormalization — ClinicWhatsAppConnection.organizationId does not match the connection\'s organization: fails closed, no write (BLOCKING FINDING 2)',
    async () => {
      const orgA = await createOrg('r1-xorg-link-a');
      const orgB = await createOrg('r1-xorg-link-b');
      const secret = `secret-xorg-link-${randomUUID()}`;
      const connectionA = await createConnection(orgA.id, { webhookSecret: secret });
      const clinicA = await createClinic(orgA.id, 'r1-xorg-link-clinic-a');
      // Corrupted/stale link: organizationId falsely claims orgB even though
      // both the connection and the clinic it points at are genuinely orgA's.
      await prisma.clinicWhatsAppConnection.create({
        data: { organizationId: orgB.id, clinicId: clinicA.id, whatsappConnectionId: connectionA.id, isDefault: true },
      });

      const before = await countAppointmentRequests(clinicA.id);
      const res = await call(
        APPOINTMENT_REQUESTS_CHAIN,
        publicReq({ secret, body: { patientName: 'Xorg Link', phone: '5551230011' } }),
      );
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.error, 'Clinic not found');
      assert.equal(await countAppointmentRequests(clinicA.id), before);
    },
  );

  await isolatedTest(
    'cross-org denormalization — the linked Clinic itself belongs to a different organization than the connection: fails closed, no write (BLOCKING FINDING 2)',
    async () => {
      const orgA = await createOrg('r1-xorg-clinic-a');
      const orgB = await createOrg('r1-xorg-clinic-b');
      const secret = `secret-xorg-clinic-${randomUUID()}`;
      const connectionA = await createConnection(orgA.id, { webhookSecret: secret });
      const clinicB = await createClinic(orgB.id, 'r1-xorg-clinic-clinic-b'); // genuinely belongs to org B
      // Link's own organizationId matches the connection (passes the first
      // consistency check) but points at a clinic that actually belongs to
      // org B — this must be caught by the connection-vs-clinic check.
      await prisma.clinicWhatsAppConnection.create({
        data: { organizationId: orgA.id, clinicId: clinicB.id, whatsappConnectionId: connectionA.id, isDefault: true },
      });

      const before = await countAppointmentRequests(clinicB.id);
      const res = await call(
        APPOINTMENT_REQUESTS_CHAIN,
        publicReq({ secret, body: { patientName: 'Xorg Clinic', phone: '5551230022' } }),
      );
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.error, 'Clinic not found');
      assert.equal(await countAppointmentRequests(clinicB.id), before);
    },
  );

  await isolatedTest(
    'a resolved clinic link pointing at a deleted clinic row fails closed (missing clinic row) — simulated via a temporary FK trigger disable on Clinic, since real FK constraints make this unreachable through normal writes',
    async () => {
      const secret = `secret-missing-clinic-${randomUUID()}`;
      const org = await createOrg('r1-missing-clinic');
      const connection = await createConnection(org.id, { webhookSecret: secret });
      const doomedClinic = await createClinic(org.id, 'r1-missing-clinic-doomed');
      await linkClinicConnection(org.id, doomedClinic.id, connection.id);

      await prisma.$executeRawUnsafe('ALTER TABLE "Clinic" DISABLE TRIGGER ALL');
      try {
        await prisma.clinic.delete({ where: { id: doomedClinic.id } });
      } finally {
        await prisma.$executeRawUnsafe('ALTER TABLE "Clinic" ENABLE TRIGGER ALL');
      }

      const res = await call(SERVICES_CHAIN, publicReq({ secret }));
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.error, 'Clinic not found');
      assert.equal(res.body.clinic, undefined);
    },
  );

  await isolatedTest(
    'inactive connection: its own connection-specific secret never matches, even though correctly provided',
    async () => {
      const secret = `secret-inactive-${randomUUID()}`;
      const org = await createOrg('r1-inactive-secret');
      const connection = await createConnection(org.id, { isActive: false, webhookSecret: secret });
      const clinic = await createClinic(org.id, 'r1-inactive-secret-clinic');
      await linkClinicConnection(org.id, clinic.id, connection.id);

      const res = await call(SERVICES_CHAIN, publicReq({ secret }));
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.clinic, undefined);
    },
  );

  await isolatedTest(
    'a Meta Cloud connection carrying the same secret value does not satisfy the Evolution-only resolver',
    async () => {
      const secret = `secret-meta-${randomUUID()}`;
      const org = await createOrg('r1-meta-secret');
      const clinic = await createClinic(org.id, 'r1-meta-secret-clinic');
      const metaConnection = await createConnection(org.id, { provider: 'meta_cloud_api', webhookSecret: secret });
      await linkClinicConnection(org.id, clinic.id, metaConnection.id);

      const res = await call(SERVICES_CHAIN, publicReq({ secret }));
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.clinic, undefined);
    },
  );

  await cleanupOrgs(createdOrgIds.splice(0));
  const ok = summary();
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
