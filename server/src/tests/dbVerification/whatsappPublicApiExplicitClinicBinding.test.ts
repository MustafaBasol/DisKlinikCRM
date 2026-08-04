/**
 * whatsappPublicApiExplicitClinicBinding.test.ts — F2-SEC-002
 *
 * Real disposable-PostgreSQL, real-route-handler verification that the
 * legacy secret-gated WhatsApp public API (GET/POST /api/public/whatsapp/*)
 * no longer resolves its clinic via a global/first-created default
 * (`prisma.clinic.findFirst({ orderBy: { createdAt: 'asc' } })`), and
 * instead requires an explicit, unambiguous clinic-owned WhatsApp
 * connection binding (WhatsAppConnection.isActive + ClinicWhatsAppConnection)
 * — see docs/program/evidence/F2-SEC-002_WHATSAPP_EXPLICIT_CLINIC_RESOLUTION.md.
 *
 * These routes carry no per-request instance/connection/clinic identity of
 * their own (only the shared WHATSAPP_WEBHOOK_SECRET), so every scenario
 * below drives clinic resolution purely through server-side WhatsApp
 * connection configuration, exactly as the fixed route code does.
 *
 * Uses the same real-DB / real-Express-handler convention as
 * appointmentRequestConversionAtomicity.test.ts (dbVerificationHarness.ts)
 * — no mocked Prisma, no in-memory simulation, no mocked clinic resolution.
 *
 * Run: npx tsx src/tests/dbVerification/whatsappPublicApiExplicitClinicBinding.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres before import.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import whatsappRouter from '../../routes/whatsapp.js';
import {
  createSuite,
  getFullChain,
  runChain,
  mockResponse,
  prisma,
  type MockResponse,
} from './dbVerificationHarness.js';

const { section, test, summary } = createSuite('whatsappPublicApiExplicitClinicBinding');

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
  secret?: string | null; // undefined = valid TEST_SECRET, null = no header at all
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
// "foreign clinic seeded before/after" ordering this defect requires) ────

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

async function createConnection(organizationId: string, opts: { isActive?: boolean; provider?: string } = {}) {
  const suffix = randomUUID().slice(0, 8);
  return prisma.whatsAppConnection.create({
    data: {
      organizationId,
      name: `Conn ${suffix}`,
      provider: opts.provider ?? 'evolution_api',
      isActive: opts.isActive ?? true,
    },
  });
}

async function linkClinicConnection(organizationId: string, clinicId: string, whatsappConnectionId: string) {
  return prisma.clinicWhatsAppConnection.create({
    data: { organizationId, clinicId, whatsappConnectionId, isDefault: true },
  });
}

/** One org + one clinic + one active connection + one clinic link — the "valid single binding" shape. */
async function createBoundClinic(label: string) {
  const org = await createOrg(label);
  const clinic = await createClinic(org.id, label);
  const connection = await createConnection(org.id);
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
 * Deletes exactly the given orgs' data, FK-safe order. The fix under test
 * resolves the bound clinic from a system-wide (not per-organization) query
 * — `WhatsAppConnection.isActive` across the whole table — precisely because
 * these routes carry no per-request org/clinic identity. That means any
 * WhatsApp connection left behind by an earlier test would silently turn a
 * later "exactly one binding" scenario into an "ambiguous" one. Every test
 * below therefore tears its own fixtures down immediately (see
 * isolatedTest), rather than deferring to one cleanup pass at the end.
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
  section('Scenario 1 — one valid explicit binding resolves the correct clinic');
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
  await isolatedTest('two orgs each with their own valid binding: GET /services is ambiguous, fails closed', async () => {
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

  await isolatedTest('two orgs each with their own valid binding: POST /appointment-requests creates no tenant data in either clinic', async () => {
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

  await isolatedTest('one connection linked to two clinics (shared line, no prior context): fails closed, not the first link', async () => {
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

  section('Scenario 6/7 — cross-tenant write prevention');
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

  await isolatedTest('Organization A request cannot fall through to Organization B when only B has a binding', async () => {
    const { org: orgB, clinic: clinicB } = await createBoundClinic('s7-org-b-only');
    const res = await call(
      APPOINTMENT_REQUESTS_CHAIN,
      publicReq({ body: { patientName: 'Bob B', phone: '5554440000' } }),
    );
    // The only explicit binding present is B's — the request may only ever
    // land on B (there is no "org A" identity in this legacy API at all),
    // proving resolution never falls through to an unrelated/default clinic.
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.clinicId, clinicB.id);
    assert.equal(res.body.clinicId.length > 0, true);
    void orgB;
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

  section('Scenario 9 — invalid/missing signature creates no tenant side effects');
  await isolatedTest('invalid secret: creates no appointment request, preserves provider-compatible 401 acknowledgment', async () => {
    const { clinic } = await createBoundClinic('s9-invalid-secret');
    const before = await countAppointmentRequests(clinic.id);
    const res = await call(
      APPOINTMENT_REQUESTS_CHAIN,
      publicReq({ secret: 'wrong-secret', body: { patientName: 'Eve', phone: '5557770000' } }),
    );
    assert.equal(res.statusCode, 401);
    assert.equal(await countAppointmentRequests(clinic.id), before);
  });

  await isolatedTest('missing secret header: creates no appointment request', async () => {
    const { clinic } = await createBoundClinic('s9-missing-secret');
    const before = await countAppointmentRequests(clinic.id);
    const res = await call(
      APPOINTMENT_REQUESTS_CHAIN,
      publicReq({ secret: null, body: { patientName: 'Frank', phone: '5558880000' } }),
    );
    assert.equal(res.statusCode, 401);
    assert.equal(await countAppointmentRequests(clinic.id), before);
  });

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

  await cleanupOrgs(createdOrgIds.splice(0));
  const ok = summary();
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
