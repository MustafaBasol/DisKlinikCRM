/**
 * externalCalendarOutboundSyncAtomicity.test.ts — DATA-INTEGRITY / Phase 2
 *
 * Real disposable-PostgreSQL verification that wiring the external calendar
 * provider framework into POST /api/appointment-requests/:id/convert:
 *  1. Never makes the conversion transaction's success depend on external
 *     calendar reachability — the local appointment commits and the HTTP
 *     response is sent exactly as before, whether or not a clinic has an
 *     enabled (and, here, deliberately unreachable/unconfigured) integration.
 *  2. Leaves the existing advisory-lock/overlap/duplicate-conversion
 *     guarantees completely unchanged when an integration is enabled.
 *  3. Gives claimSyncLinkForAttempt() genuine atomicity under REAL concurrent
 *     Postgres connections (not just the single-threaded-JS determinism a
 *     mocked-Prisma unit test can prove) — this is the one guarantee that
 *     specifically requires a real database to verify.
 *  4. Enforces the outbound idempotency ledger (connectionId, idempotencyKey)
 *     as a real unique index, not just an application-level check.
 *
 * The integration fixture below is deliberately created with no clientId —
 * DigiDentisProvider's own resolveClientConfig() then throws
 * ExternalCalendarAuthError synchronously, before any network call or
 * secret decryption is attempted. This keeps the suite fully offline and
 * deterministic while still exercising the REAL provider factory / REAL
 * DigiDentiS provider class (no test-only provider override) — the same
 * "let an unconfigured real dependency fail fast" convention already used
 * elsewhere in this harness (WhatsApp/SMS providers left unconfigured so
 * they short-circuit before any real network call).
 *
 * Run: npx tsx src/tests/dbVerification/externalCalendarOutboundSyncAtomicity.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres before import.
 */

import assert from 'node:assert/strict';
import appointmentRequestsRouter from '../../routes/appointmentRequests.js';
import {
  createSuite,
  getFullChain,
  runChain,
  mockResponse,
  authRequest,
  createClinicFixtureSet,
  createStaffUser,
  cleanupAllFixtures,
  prisma,
  type ClinicFixtureSet,
} from './dbVerificationHarness.js';
import {
  ensurePendingSyncLink,
  claimSyncLinkForAttempt,
  requeueSyncLinkForManualRetry,
  computeOutboundSyncIdempotencyKey,
} from '../../services/externalCalendar/externalCalendarOutboundSync.js';

const { section, test, summary } = createSuite('externalCalendarOutboundSyncAtomicity');

const CONVERT_CHAIN = getFullChain(appointmentRequestsRouter as any, 'post', '/appointment-requests/:id/convert');

async function createFullyAvailablePractitioner(fixtures: ClinicFixtureSet, clinicId: string) {
  const practitioner = await createStaffUser({ organizationId: fixtures.orgId, clinicId, role: 'DENTIST' });
  await prisma.doctorAvailability.createMany({
    data: Array.from({ length: 7 }, (_, weekday) => ({
      clinicId, practitionerId: practitioner.id, weekday, startTime: '00:00', endTime: '23:59', isActive: true,
    })),
  });
  return practitioner;
}

async function createService(clinicId: string) {
  return prisma.appointmentType.create({ data: { clinicId, name: 'Checkup', durationMinutes: 30, isActive: true } });
}

let slotCounter = 0;
function nextSlot() {
  slotCounter += 1;
  const start = new Date(Date.UTC(2026, 7, 5, 8, 0) + slotCounter * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return { startTime: start, endTime: end };
}

async function createRequest(params: { clinicId: string; appointmentTypeId: string; practitionerId: string; startTime: Date; endTime: Date }) {
  return prisma.appointmentRequest.create({
    data: {
      clinicId: params.clinicId,
      patientName: 'Test Patient',
      phone: '+905551234567',
      email: 'test-patient@example.invalid',
      appointmentTypeId: params.appointmentTypeId,
      practitionerId: params.practitionerId,
      preferredStartTime: params.startTime,
      preferredEndTime: params.endTime,
      requestType: 'appointment',
      source: 'manual', // no-op notification path — irrelevant to this suite's focus
      status: 'pending',
    },
  });
}

async function ownerUser(fixtures: ClinicFixtureSet, clinicId: string = fixtures.defaultClinicId) {
  const owner = await createStaffUser({ organizationId: fixtures.orgId, clinicId, role: 'OWNER', canAccessAllClinics: true });
  return authRequest({ id: owner.id, organizationId: fixtures.orgId, clinicId, role: 'OWNER', canAccessAllClinics: true });
}

async function callConvert(requestId: string, user: ReturnType<typeof authRequest>, body: Record<string, unknown> = {}) {
  const req = { ...(user as any), params: { id: requestId }, body } as any;
  const res = mockResponse();
  await runChain(CONVERT_CHAIN, req, res);
  return res;
}

/** Deliberately unconfigured — clientId is left null so any real sync
 *  attempt fails fast with ExternalCalendarAuthError, no network, no
 *  ENCRYPTION_KEY dependency. */
async function enableIntegration(fixtures: ClinicFixtureSet, clinicId: string) {
  return prisma.externalCalendarIntegration.create({
    data: {
      clinicId,
      organizationId: fixtures.orgId,
      provider: 'digidentis',
      enabled: true,
      status: 'configured',
      webhookReceiverKey: `test-key-${clinicId}`,
    },
  });
}

async function mapPractitionerAndService(connectionId: string, clinicId: string, organizationId: string, practitionerId: string, appointmentTypeId: string) {
  await prisma.externalCalendarMapping.createMany({
    data: [
      { connectionId, clinicId, organizationId, mappingType: 'practitioner', localId: practitionerId, externalId: 'ext-doctor-1' },
      { connectionId, clinicId, organizationId, mappingType: 'service', localId: appointmentTypeId, externalId: 'ext-treatment-1' },
    ],
  });
}

async function waitForLinkTerminal(appointmentId: string, timeoutMs = 5000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const link = await prisma.externalCalendarAppointmentLink.findFirst({ where: { appointmentId } });
    if (link && ['synced', 'failed_retryable', 'failed_terminal'].includes(link.status)) return link;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for a terminal sync outcome for appointment ${appointmentId}`);
}

// ─── 1. Conversion succeeds regardless of external calendar reachability ────

async function scenarioTransactionIndependentOfExternalReachability() {
  section('1. Appointment conversion commits and responds successfully independent of external calendar reachability');
  const fixtures = await createClinicFixtureSet('ext-sync-independent');
  const clinicId = fixtures.defaultClinicId;
  const practitioner = await createFullyAvailablePractitioner(fixtures, clinicId);
  const service = await createService(clinicId);
  const integration = await enableIntegration(fixtures, clinicId);
  await mapPractitionerAndService(integration.id, clinicId, fixtures.orgId, practitioner.id, service.id);

  const { startTime, endTime } = nextSlot();
  const request = await createRequest({ clinicId, appointmentTypeId: service.id, practitionerId: practitioner.id, startTime, endTime });

  await test('201 + appointment/request converted exactly as without an integration, even though the configured provider is unreachable', async () => {
    const res = await callConvert(request.id, await ownerUser(fixtures));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.request.status, 'converted');

    const dbAppointment = await prisma.appointment.findUnique({ where: { id: res.body.appointment.id } });
    assert.ok(dbAppointment, 'the appointment must be committed regardless of external calendar state');

    const link = await waitForLinkTerminal(res.body.appointment.id);
    assert.equal(link.status, 'failed_terminal', 'an unconfigured/unreachable provider must fail safely, never revert the local appointment');
    assert.equal(link.errorCode, 'AUTH_ERROR');
    assert.equal(link.idempotencyKey, computeOutboundSyncIdempotencyKey(res.body.appointment.id));

    // The local appointment/request remain committed and unaffected by the sync outcome.
    const dbRequest = await prisma.appointmentRequest.findUnique({ where: { id: request.id } });
    assert.equal(dbRequest!.status, 'converted', 'external sync failure must never revert or cancel the local conversion');
  });
}

// ─── 2. Existing advisory-lock/duplicate-conversion guarantees unchanged ────

async function scenarioExistingConcurrencyGuaranteesUnchanged() {
  section('2. Concurrent duplicate conversion of the same request is still serialized correctly with an integration enabled');
  const fixtures = await createClinicFixtureSet('ext-sync-concurrency');
  const clinicId = fixtures.defaultClinicId;
  const practitioner = await createFullyAvailablePractitioner(fixtures, clinicId);
  const service = await createService(clinicId);
  const integration = await enableIntegration(fixtures, clinicId);
  await mapPractitionerAndService(integration.id, clinicId, fixtures.orgId, practitioner.id, service.id);

  const { startTime, endTime } = nextSlot();
  const request = await createRequest({ clinicId, appointmentTypeId: service.id, practitionerId: practitioner.id, startTime, endTime });

  await test('exactly one of two concurrent convert calls succeeds; exactly one Appointment and exactly one sync link ever exist', async () => {
    const user = await ownerUser(fixtures);
    const [resA, resB] = await Promise.all([callConvert(request.id, user), callConvert(request.id, user)]);

    const successCount = [resA, resB].filter((r) => r.statusCode === 201).length;
    assert.equal(successCount, 1, 'adding external sync must not change the existing single-winner guarantee');

    const appointmentCount = await prisma.appointment.count({ where: { clinicId, practitionerId: practitioner.id, startTime, endTime } });
    assert.equal(appointmentCount, 1);

    const winner = resA.statusCode === 201 ? resA : resB;
    await waitForLinkTerminal(winner.body.appointment.id);
    const linkCount = await prisma.externalCalendarAppointmentLink.count({ where: { appointmentId: winner.body.appointment.id } });
    assert.equal(linkCount, 1, 'exactly one sync record must exist — no duplicate outbound ledger row for one appointment');
  });
}

// ─── 3. Genuine concurrent claim safety (real Postgres) ─────────────────────

async function scenarioGenuineConcurrentClaim() {
  section('3. claimSyncLinkForAttempt is atomic under REAL concurrent Postgres connections');
  const fixtures = await createClinicFixtureSet('ext-sync-claim');
  const clinicId = fixtures.defaultClinicId;
  const practitioner = await createFullyAvailablePractitioner(fixtures, clinicId);
  const service = await createService(fixtures.defaultClinicId);
  const integration = await enableIntegration(fixtures, clinicId);
  const appointment = await prisma.appointment.create({
    data: {
      clinicId,
      patientId: (await prisma.patient.create({ data: { organizationId: fixtures.orgId, clinicId, firstName: 'Claim', lastName: 'Target', phone: '+905550000009' } })).id,
      practitionerId: practitioner.id,
      appointmentTypeId: service.id,
      startTime: new Date(),
      endTime: new Date(Date.now() + 30 * 60 * 1000),
      status: 'scheduled',
    },
  });
  const link = await ensurePendingSyncLink({ connection: { id: integration.id, clinicId, organizationId: fixtures.orgId, provider: 'digidentis' } as any, appointmentId: appointment.id, clinicId });

  await test('exactly one of many truly concurrent real-DB claims on the same pending row succeeds', async () => {
    const CONCURRENCY = 8;
    const results = await Promise.all(Array.from({ length: CONCURRENCY }, () => claimSyncLinkForAttempt(link.id)));
    const claimedCount = results.filter((r) => r !== null).length;
    assert.equal(claimedCount, 1, `exactly one of ${CONCURRENCY} concurrent real-Postgres claims must succeed`);

    const dbLink = await prisma.externalCalendarAppointmentLink.findUnique({ where: { id: link.id } });
    assert.equal(dbLink!.attempts, 1, 'attempts must be incremented exactly once despite the concurrent race');
    assert.equal(dbLink!.status, 'syncing');
  });

  await test('a manual-retry requeue cannot resurrect a row already claimed into syncing by the race above', async () => {
    const { requeued } = await requeueSyncLinkForManualRetry(link.id);
    assert.equal(requeued, false);
  });
}

// ─── 4. Idempotency ledger is a real unique constraint ──────────────────────

async function scenarioIdempotencyIsARealUniqueConstraint() {
  section('4. The outbound idempotency key is enforced by a real database unique index');
  const fixtures = await createClinicFixtureSet('ext-sync-idempotency');
  const clinicId = fixtures.defaultClinicId;
  const integration = await enableIntegration(fixtures, clinicId);
  // ExternalCalendarAppointmentLink.appointmentId is a real foreign key (even
  // though nullable) — a genuine Appointment row is required here, confirmed
  // by this scenario originally failing with a real FK violation against a
  // fabricated id.
  const practitioner = await createFullyAvailablePractitioner(fixtures, clinicId);
  const service = await createService(clinicId);
  const patient = await prisma.patient.create({ data: { organizationId: fixtures.orgId, clinicId, firstName: 'Idem', lastName: 'Potent', phone: '+905550000010' } });
  const appointment = await prisma.appointment.create({
    data: {
      clinicId,
      patientId: patient.id,
      practitionerId: practitioner.id,
      appointmentTypeId: service.id,
      startTime: new Date(),
      endTime: new Date(Date.now() + 30 * 60 * 1000),
      status: 'scheduled',
    },
  });
  const appointmentId = appointment.id;

  await test('two ensurePendingSyncLink calls with the same appointmentId resolve to the same DB row (real upsert, real unique index)', async () => {
    const first = await ensurePendingSyncLink({ connection: { id: integration.id, clinicId, organizationId: fixtures.orgId, provider: 'digidentis' } as any, appointmentId, clinicId });
    const second = await ensurePendingSyncLink({ connection: { id: integration.id, clinicId, organizationId: fixtures.orgId, provider: 'digidentis' } as any, appointmentId, clinicId });
    assert.equal(first.id, second.id);

    const count = await prisma.externalCalendarAppointmentLink.count({ where: { connectionId: integration.id, idempotencyKey: computeOutboundSyncIdempotencyKey(appointmentId) } });
    assert.equal(count, 1);
  });

  await test('a raw duplicate insert with the same (connectionId, idempotencyKey) is rejected by the real unique index (P2002)', async () => {
    await assert.rejects(
      prisma.externalCalendarAppointmentLink.create({
        data: {
          connectionId: integration.id,
          organizationId: fixtures.orgId,
          clinicId,
          idempotencyKey: computeOutboundSyncIdempotencyKey(appointmentId),
          status: 'pending',
        },
      }),
      (err: any) => err.code === 'P2002',
    );
  });
}

// ─── Run ──────────────────────────────────────────────────────────────────

async function main() {
  await scenarioTransactionIndependentOfExternalReachability();
  await scenarioExistingConcurrencyGuaranteesUnchanged();
  await scenarioGenuineConcurrentClaim();
  await scenarioIdempotencyIsARealUniqueConstraint();

  const ok = summary();
  await cleanupAllFixtures();
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  await cleanupAllFixtures().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
