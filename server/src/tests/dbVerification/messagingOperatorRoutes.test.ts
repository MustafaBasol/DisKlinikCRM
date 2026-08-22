/**
 * messagingOperatorRoutes.test.ts — F5-3R against a REAL PostgreSQL.
 *
 * F5-3 proved the SERVICES. This suite proves the thing F5-3 deliberately did
 * not build: the authorization contract in front of them.
 *
 * Everything here runs the REAL Express middleware chain extracted from the
 * router's own stack — `authorize()` included — against real rows in a real
 * database. That matters more than usual for this task, because every claim
 * being made is of the form "operator X CANNOT see/do Y", and a claim like that
 * is worthless if the thing enforcing it was stubbed.
 *
 * The properties under test:
 *
 *   - a clinic-scoped operator cannot see or replay a sibling clinic's event;
 *   - an EXPLICIT scope with an empty clinic list reaches NOTHING (an empty
 *     array never means "all");
 *   - an UNROUTED event (clinicId null) is reachable only organization-wide;
 *   - cross-ORGANIZATION is 404 and cross-CLINIC is 403, and the difference is
 *     deliberate;
 *   - a request body cannot name a tenant, a provider or a payload;
 *   - no response, at any status, carries rawPayload / errorMessage / a phone
 *     number;
 *   - a successful replay writes an AuditLog row, and that row carries no PII;
 *   - two concurrent replays produce exactly ONE transition;
 *   - pagination is bounded, deterministic, and cannot be widened.
 *
 * Run: npx tsx src/tests/dbVerification/messagingOperatorRoutes.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres before import.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  createSuite,
  createClinicFixtureSet,
  cleanupAllFixtures,
  getFullChain,
  runChain,
  mockResponse,
  authRequest,
  prisma,
  type ClinicFixtureSet,
  type MockResponse,
} from './dbVerificationHarness.js';

import messagingReliabilityRouter from '../../routes/messagingReliability.js';
import { MESSAGING_DLQ_MAX_PAGE_SIZE, MESSAGING_DLQ_DEFAULT_PAGE_SIZE } from '../../messaging/messagingInboundDlq.js';

const { section, test, summary } = createSuite('messagingOperatorRoutes');

const DEAD_PATH = '/ops/messaging/reliability/dead';
const REPLAY_PATH = '/ops/messaging/reliability/dead/:id/replay';
const METRICS_PATH = '/ops/messaging/reliability/metrics';

let fixtures: ClinicFixtureSet;

/**
 * A phone number and a raw payload are written into EVERY fixture row on
 * purpose. A test that asserts "no phone number is returned" against a row that
 * never had one proves nothing at all.
 */
const FIXTURE_PHONE = '+905550001122';
const FIXTURE_PAYLOAD_MARKER = 'SYNTHETIC-PATIENT-MESSAGE-BODY';

interface EventOverrides {
  status?: string;
  channel?: string;
  provider?: string;
  clinicId?: string | null;
  organizationId?: string | null;
  connectionId?: string | null;
  replayCount?: number;
  deadLetteredAt?: Date | null;
  lastErrorCode?: string | null;
  withPayload?: boolean;
}

async function createEvent(o: EventOverrides = {}): Promise<string> {
  const status = o.status ?? 'dead';
  const row = await prisma.messagingInboundEvent.create({
    data: {
      channel: o.channel ?? 'whatsapp',
      provider: o.provider ?? 'meta_cloud_api',
      connectionId: o.connectionId === undefined ? randomUUID() : o.connectionId,
      clinicId: o.clinicId === undefined ? fixtures.defaultClinicId : o.clinicId,
      organizationId: o.organizationId === undefined ? fixtures.orgId : o.organizationId,
      providerMessageId: `wamid.${randomUUID()}`,
      status,
      attempts: 3,
      fromPhone: FIXTURE_PHONE,
      toPhone: FIXTURE_PHONE,
      // A pre-F5-3-shaped raw exception string, which the DLQ view must never
      // surface even though the column still holds one for historical rows.
      errorMessage: `provider said: ${FIXTURE_PHONE} unreachable`,
      rawPayload: o.withPayload === false ? undefined : { body: FIXTURE_PAYLOAD_MARKER },
      lastErrorCode: o.lastErrorCode === undefined ? 'MAX_ATTEMPTS_EXCEEDED' : o.lastErrorCode,
      deadLetteredAt:
        o.deadLetteredAt === undefined ? (status === 'dead' ? new Date() : null) : o.deadLetteredAt,
      ...(o.replayCount !== undefined ? { replayCount: o.replayCount } : {}),
    },
    select: { id: true },
  });
  return row.id;
}

async function clearEvents(): Promise<void> {
  await prisma.messagingInboundEvent.deleteMany({
    where: { organizationId: { in: [fixtures.orgId, fixtures.otherOrgId] } },
  });
  await prisma.auditLog.deleteMany({
    where: { organizationId: { in: [fixtures.orgId, fixtures.otherOrgId] } },
  });
}

// ─── Actors ──────────────────────────────────────────────────────────────────

type Actor = { role: string; canAccessAllClinics: boolean; allowedClinicIds: string[] };

const owner = (): Actor => ({ role: 'OWNER', canAccessAllClinics: true, allowedClinicIds: [] });
const orgAdmin = (): Actor => ({ role: 'ORG_ADMIN', canAccessAllClinics: true, allowedClinicIds: [] });
const clinicManager = (clinicIds: string[]): Actor => ({
  role: 'CLINIC_MANAGER',
  canAccessAllClinics: false,
  allowedClinicIds: clinicIds,
});

function req(
  actor: Actor,
  opts: { params?: Record<string, string>; query?: Record<string, unknown>; body?: unknown; organizationId?: string } = {},
) {
  return authRequest(
    {
      role: actor.role,
      canAccessAllClinics: actor.canAccessAllClinics,
      allowedClinicIds: actor.allowedClinicIds,
      organizationId: opts.organizationId ?? fixtures.orgId,
    },
    { params: opts.params, query: opts.query as Record<string, unknown>, body: opts.body },
  );
}

async function callDead(actor: Actor, query: Record<string, unknown> = {}, organizationId?: string): Promise<MockResponse> {
  const res = mockResponse();
  await runChain(getFullChain(messagingReliabilityRouter, 'get', DEAD_PATH), req(actor, { query, organizationId }), res);
  return res;
}

async function callMetrics(actor: Actor, organizationId?: string): Promise<MockResponse> {
  const res = mockResponse();
  await runChain(getFullChain(messagingReliabilityRouter, 'get', METRICS_PATH), req(actor, { organizationId }), res);
  return res;
}

async function callReplay(
  actor: Actor,
  eventId: string,
  body: unknown = {},
  organizationId?: string,
): Promise<MockResponse> {
  const res = mockResponse();
  await runChain(
    getFullChain(messagingReliabilityRouter, 'post', REPLAY_PATH),
    req(actor, { params: { id: eventId }, body, organizationId }),
    res,
  );
  return res;
}

/** Nothing anywhere in a response may carry message content or a phone number. */
function assertNoSensitiveContent(res: MockResponse, label: string): void {
  const serialised = JSON.stringify(res.body ?? {});
  assert.equal(serialised.includes(FIXTURE_PHONE), false, `${label}: phone number leaked`);
  assert.equal(serialised.includes(FIXTURE_PAYLOAD_MARKER), false, `${label}: message content leaked`);
  assert.equal(serialised.includes('rawPayload'), false, `${label}: rawPayload key present`);
  assert.equal(serialised.includes('errorMessage'), false, `${label}: errorMessage key present`);
  assert.equal(serialised.includes('fromPhone'), false, `${label}: fromPhone key present`);
  assert.equal(serialised.includes('toPhone'), false, `${label}: toPhone key present`);
}

// ─────────────────────────────────────────────────────────────────────────────

async function scenarioRoleGate(): Promise<void> {
  section('A. Role gate — who may reach these routes at all');

  await test('DENTIST, RECEPTIONIST, BILLING and ASSISTANT are refused on every route', async () => {
    await clearEvents();
    const eventId = await createEvent();

    for (const role of ['DENTIST', 'RECEPTIONIST', 'BILLING', 'ASSISTANT']) {
      const actor: Actor = { role, canAccessAllClinics: false, allowedClinicIds: [fixtures.defaultClinicId] };

      const dead = await callDead(actor);
      assert.equal(dead.statusCode, 403, `${role} must not list the DLQ`);
      assertNoSensitiveContent(dead, `${role} dead`);

      const metrics = await callMetrics(actor);
      assert.equal(metrics.statusCode, 403, `${role} must not read metrics`);

      const replay = await callReplay(actor, eventId);
      assert.equal(replay.statusCode, 403, `${role} must not replay`);
    }
  });

  await test('OWNER, ORG_ADMIN and CLINIC_MANAGER are admitted', async () => {
    await clearEvents();
    for (const actor of [owner(), orgAdmin(), clinicManager([fixtures.defaultClinicId])]) {
      const res = await callDead(actor);
      assert.equal(res.statusCode, 200, `${actor.role} must reach the DLQ listing`);
    }
  });
}

async function scenarioTenantIsolation(): Promise<void> {
  section('B. Tenant and clinic isolation');

  await test('a clinic-scoped operator CANNOT see a sibling clinic\'s dead event', async () => {
    await clearEvents();
    const mine = await createEvent({ clinicId: fixtures.defaultClinicId });
    const sibling = await createEvent({ clinicId: fixtures.siblingClinicId });

    const res = await callDead(clinicManager([fixtures.defaultClinicId]));
    assert.equal(res.statusCode, 200);
    const ids = res.body.rows.map((r: { id: string }) => r.id);
    assert.deepEqual(ids, [mine], 'exactly the caller\'s own clinic');
    assert.equal(ids.includes(sibling), false);
    assert.equal(res.body.total, 1, 'the total must be scoped too, not the unscoped count');
  });

  await test('a clinic manager holding TWO clinics sees both and not the third', async () => {
    await clearEvents();
    const a = await createEvent({ clinicId: fixtures.defaultClinicId });
    const b = await createEvent({ clinicId: fixtures.siblingClinicId });
    const c = await createEvent({ clinicId: fixtures.unauthorizedClinicId });

    const res = await callDead(clinicManager([fixtures.defaultClinicId, fixtures.siblingClinicId]));
    const ids = (res.body.rows as Array<{ id: string }>).map((r) => r.id).sort();
    assert.deepEqual(ids, [a, b].sort());
    assert.equal(ids.includes(c), false);
    assert.equal(res.body.total, 2);
  });

  await test('an EXPLICIT scope with an EMPTY clinic list reaches nothing', async () => {
    // The single most dangerous misreading in this codebase would be treating
    // an empty allowedClinicIds as "no restriction".
    await clearEvents();
    await createEvent({ clinicId: fixtures.defaultClinicId });
    await createEvent({ clinicId: fixtures.siblingClinicId });

    const res = await callDead(clinicManager([]));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.rows, []);
    assert.equal(res.body.total, 0);
  });

  await test('another organization\'s events are absent from an OWNER\'s listing', async () => {
    await clearEvents();
    const mine = await createEvent({ clinicId: fixtures.defaultClinicId });
    await createEvent({ organizationId: fixtures.otherOrgId, clinicId: fixtures.crossOrgClinicId });

    const res = await callDead(owner());
    const ids = (res.body.rows as Array<{ id: string }>).map((r) => r.id);
    assert.deepEqual(ids, [mine], 'organization-wide means the caller\'s OWN organization');
  });

  await test('an UNROUTED event (clinicId null) is visible organization-wide and invisible clinic-scoped', async () => {
    // Routing never resolved a clinic, so no clinic-scoped operator can
    // legitimately claim it — and it must not appear in a list they could then
    // be refused permission to act on.
    await clearEvents();
    const unrouted = await createEvent({ clinicId: null });

    const wide = await callDead(owner());
    assert.deepEqual((wide.body.rows as Array<{ id: string }>).map((r) => r.id), [unrouted]);

    const scoped = await callDead(clinicManager([fixtures.defaultClinicId]));
    assert.deepEqual(scoped.body.rows, []);
  });

  await test('requesting a clinic outside the caller\'s scope is REFUSED, not silently emptied', async () => {
    await clearEvents();
    await createEvent({ clinicId: fixtures.siblingClinicId });

    const res = await callDead(clinicManager([fixtures.defaultClinicId]), { clinicId: fixtures.siblingClinicId });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'CROSS_CLINIC_REFUSED');
  });

  await test('a clinic filter INSIDE the caller\'s scope narrows normally', async () => {
    await clearEvents();
    await createEvent({ clinicId: fixtures.defaultClinicId });
    const sibling = await createEvent({ clinicId: fixtures.siblingClinicId });

    const res = await callDead(clinicManager([fixtures.defaultClinicId, fixtures.siblingClinicId]), {
      clinicId: fixtures.siblingClinicId,
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual((res.body.rows as Array<{ id: string }>).map((r) => r.id), [sibling]);
  });
}

async function scenarioReplayAuthorization(): Promise<void> {
  section('C. Replay authorization');

  await test('CROSS-ORGANIZATION replay is 404 NOT_FOUND — never an id oracle', async () => {
    await clearEvents();
    const theirs = await createEvent({ organizationId: fixtures.otherOrgId, clinicId: fixtures.crossOrgClinicId });

    const res = await callReplay(owner(), theirs);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, 'NOT_FOUND');

    const after = await prisma.messagingInboundEvent.findUniqueOrThrow({ where: { id: theirs } });
    assert.equal(after.status, 'dead', 'a refused replay leaves the row untouched');
    assert.equal(after.replayCount, 0);
  });

  await test('a nonexistent id is ALSO 404 NOT_FOUND — indistinguishable from another tenant\'s', async () => {
    await clearEvents();
    const res = await callReplay(owner(), randomUUID());
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, 'NOT_FOUND');
  });

  await test('CROSS-CLINIC replay inside the caller\'s own organization is 403 CROSS_CLINIC_REFUSED', async () => {
    await clearEvents();
    const sibling = await createEvent({ clinicId: fixtures.siblingClinicId });

    const res = await callReplay(clinicManager([fixtures.defaultClinicId]), sibling);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'CROSS_CLINIC_REFUSED');

    const after = await prisma.messagingInboundEvent.findUniqueOrThrow({ where: { id: sibling } });
    assert.equal(after.status, 'dead');
    assert.equal(after.replayCount, 0);
  });

  await test('the SAME caller WITH the clinic in scope succeeds — proving the refusal was the scope', async () => {
    await clearEvents();
    const sibling = await createEvent({ clinicId: fixtures.siblingClinicId });

    const res = await callReplay(clinicManager([fixtures.defaultClinicId, fixtures.siblingClinicId]), sibling);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.eventId, sibling);
    assert.equal(res.body.replayCount, 1);
  });

  await test('an unrouted event cannot be replayed by a clinic-scoped operator, but can organization-wide', async () => {
    await clearEvents();
    const unrouted = await createEvent({ clinicId: null });

    const refused = await callReplay(clinicManager([fixtures.defaultClinicId]), unrouted);
    assert.equal(refused.statusCode, 403);
    assert.equal(refused.body.code, 'CROSS_CLINIC_REFUSED');

    const allowed = await callReplay(orgAdmin(), unrouted);
    assert.equal(allowed.statusCode, 200);
  });

  await test('an EMPTY clinic scope can replay nothing', async () => {
    await clearEvents();
    const mine = await createEvent({ clinicId: fixtures.defaultClinicId });

    const res = await callReplay(clinicManager([]), mine);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'CROSS_CLINIC_REFUSED');
  });
}

async function scenarioReplayState(): Promise<void> {
  section('D. Replay state and capability refusals');

  await test('replaying a PROCESSED event is refused 409 ALREADY_PROCESSED', async () => {
    await clearEvents();
    const done = await createEvent({ status: 'processed', deadLetteredAt: null, lastErrorCode: null });

    const res = await callReplay(owner(), done);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'ALREADY_PROCESSED');

    const after = await prisma.messagingInboundEvent.findUniqueOrThrow({ where: { id: done } });
    assert.equal(after.status, 'processed');
  });

  await test('replaying an ALREADY-REQUEUED event is refused 409 NOT_TERMINAL', async () => {
    await clearEvents();
    const eventId = await createEvent();

    const first = await callReplay(owner(), eventId);
    assert.equal(first.statusCode, 200);

    // The row is now `failed` — the retry job's, not the operator's.
    const second = await callReplay(owner(), eventId);
    assert.equal(second.statusCode, 409);
    assert.equal(second.body.code, 'NOT_TERMINAL');

    const after = await prisma.messagingInboundEvent.findUniqueOrThrow({ where: { id: eventId } });
    assert.equal(after.replayCount, 1, 'the refused second attempt did not bump the counter');
  });

  await test('the replay ceiling is enforced 409 REPLAY_LIMIT_EXCEEDED', async () => {
    await clearEvents();
    const eventId = await createEvent({ replayCount: 99 });

    const res = await callReplay(owner(), eventId);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'REPLAY_LIMIT_EXCEEDED');
  });

  await test('an UNSUPPORTED channel is refused 422 NO_REDELIVERY_HANDLER', async () => {
    await clearEvents();
    const instagram = await createEvent({ channel: 'instagram', provider: 'meta_instagram' });

    const res = await callReplay(owner(), instagram);
    assert.equal(res.statusCode, 422);
    assert.equal(res.body.code, 'NO_REDELIVERY_HANDLER');

    const after = await prisma.messagingInboundEvent.findUniqueOrThrow({ where: { id: instagram } });
    assert.equal(after.status, 'dead', 'refused loudly rather than reported as a success that did nothing');
  });

  await test('an UNROUTABLE event (no connection) is refused 422', async () => {
    await clearEvents();
    const orphan = await createEvent({ connectionId: null });

    const res = await callReplay(owner(), orphan);
    assert.equal(res.statusCode, 422);
    assert.equal(res.body.code, 'UNROUTABLE');
  });

  await test('an event with NO stored envelope is refused 422 NO_STORED_PAYLOAD', async () => {
    await clearEvents();
    const empty = await createEvent({ withPayload: false });

    const res = await callReplay(owner(), empty);
    assert.equal(res.statusCode, 422);
    assert.equal(res.body.code, 'NO_STORED_PAYLOAD');
  });

  await test('CONCURRENT replays produce exactly ONE transition', async () => {
    await clearEvents();
    const eventId = await createEvent();

    const results = await Promise.all([
      callReplay(owner(), eventId),
      callReplay(owner(), eventId),
      callReplay(owner(), eventId),
    ]);

    const succeeded = results.filter((r) => r.statusCode === 200);
    assert.equal(succeeded.length, 1, 'exactly one caller wins');
    for (const loser of results.filter((r) => r.statusCode !== 200)) {
      assert.equal(loser.statusCode, 409);
      assert.equal(loser.body.code, 'NOT_TERMINAL');
    }

    const after = await prisma.messagingInboundEvent.findUniqueOrThrow({ where: { id: eventId } });
    assert.equal(after.replayCount, 1, 'the counter proves one transition, not three');
    assert.equal(after.status, 'failed');
    assert.equal(after.attempts, 0);
  });
}

async function scenarioBodyOverride(): Promise<void> {
  section('E. A request body cannot name a tenant, a provider or a payload');

  const rejected: Array<[string, Record<string, unknown>]> = [
    ['organizationId', { organizationId: 'some-other-org' }],
    ['organization_id', { organization_id: 'some-other-org' }],
    ['clinicId', { clinicId: 'some-other-clinic' }],
    ['clinic_id', { clinic_id: 'some-other-clinic' }],
    ['provider', { provider: 'meta_cloud_api' }],
    ['channel', { channel: 'whatsapp' }],
    ['connectionId', { connectionId: 'x' }],
    ['providerMessageId', { providerMessageId: 'wamid.forged' }],
    ['rawPayload', { rawPayload: { body: 'attacker text' } }],
    ['payload', { payload: { body: 'attacker text' } }],
    ['status', { status: 'processed' }],
    ['attempts', { attempts: 0 }],
    ['replayCount', { replayCount: 0 }],
  ];

  for (const [field, body] of rejected) {
    await test(`a body carrying \`${field}\` is refused 400 TENANT_FIELDS_NOT_ACCEPTED`, async () => {
      await clearEvents();
      const eventId = await createEvent();

      const res = await callReplay(owner(), eventId, body);
      assert.equal(res.statusCode, 400, `${field} must be refused`);
      assert.equal(res.body.code, 'TENANT_FIELDS_NOT_ACCEPTED');

      const after = await prisma.messagingInboundEvent.findUniqueOrThrow({ where: { id: eventId } });
      assert.equal(after.status, 'dead', 'nothing was written');
      assert.equal(after.replayCount, 0);
    });
  }

  await test('a body naming another organization cannot reach that organization\'s event', async () => {
    // The belt to the suspenders above: even if the refusal were removed, the
    // organization predicate comes from the SESSION, so the forged id is inert.
    await clearEvents();
    const theirs = await createEvent({ organizationId: fixtures.otherOrgId, clinicId: fixtures.crossOrgClinicId });

    const refused = await callReplay(owner(), theirs, { organizationId: fixtures.otherOrgId });
    assert.equal(refused.statusCode, 400, 'refused before it can even be attempted');

    const plain = await callReplay(owner(), theirs, {});
    assert.equal(plain.statusCode, 404, 'and with a clean body it is simply not found');

    const after = await prisma.messagingInboundEvent.findUniqueOrThrow({ where: { id: theirs } });
    assert.equal(after.status, 'dead');
    assert.equal(after.replayCount, 0);
  });

  await test('an empty body is accepted — the refusal targets tenant fields, not all bodies', async () => {
    await clearEvents();
    const eventId = await createEvent();
    const res = await callReplay(owner(), eventId, {});
    assert.equal(res.statusCode, 200);
  });
}

async function scenarioResponseMinimisation(): Promise<void> {
  section('F. No response carries message content, a phone number, or a provider body');

  await test('the DLQ listing returns operational metadata only', async () => {
    await clearEvents();
    await createEvent({ clinicId: fixtures.defaultClinicId });

    const res = await callDead(owner());
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.rows.length, 1);
    assertNoSensitiveContent(res, 'dead listing');

    const row = res.body.rows[0];
    assert.deepEqual(
      Object.keys(row).sort(),
      [
        'ageMs', 'attempts', 'channel', 'clinicId', 'connectionId', 'createdAt',
        'deadLetteredAt', 'id', 'lastErrorCode', 'provider', 'providerMessageId', 'replayCount',
      ],
      'the field set is a closed contract, not whatever the select happened to include',
    );
  });

  await test('every replay response — success and every refusal — is content-free', async () => {
    await clearEvents();
    const ok = await createEvent();
    const processed = await createEvent({ status: 'processed', deadLetteredAt: null, lastErrorCode: null });
    const instagram = await createEvent({ channel: 'instagram', provider: 'meta_instagram' });
    const crossOrg = await createEvent({ organizationId: fixtures.otherOrgId, clinicId: fixtures.crossOrgClinicId });

    for (const [label, res] of [
      ['success', await callReplay(owner(), ok)],
      ['already-processed', await callReplay(owner(), processed)],
      ['no-handler', await callReplay(owner(), instagram)],
      ['cross-org', await callReplay(owner(), crossOrg)],
    ] as Array<[string, MockResponse]>) {
      assertNoSensitiveContent(res, `replay ${label}`);
    }
  });

  await test('the tenant-override refusal echoes the rejected FIELD NAME and never its value', async () => {
    // This case is deliberately checked separately rather than folded into the
    // sweep above. `assertNoSensitiveContent` bans the substring `rawPayload`
    // outright, because in a row-shaped response that substring can only be a
    // leaked column — but in a 400 it is the name of the field the CALLER just
    // sent, echoed back so they can fix their request. Naming what was rejected
    // is the whole usefulness of the error; echoing what was IN it would be the
    // leak. So the contract asserted here is exactly that split.
    await clearEvents();
    const eventId = await createEvent();

    const res = await callReplay(owner(), eventId, {
      rawPayload: { body: 'ATTACKER-SUPPLIED-TEXT' },
    });

    assert.equal(res.statusCode, 400);
    assert.deepEqual(Object.keys(res.body).sort(), ['code', 'error'], 'the body is a closed two-field shape');
    assert.equal(res.body.code, 'TENANT_FIELDS_NOT_ACCEPTED');

    const serialised = JSON.stringify(res.body);
    assert.ok(serialised.includes('rawPayload'), 'the operator is told WHICH field was rejected');
    assert.equal(serialised.includes('ATTACKER-SUPPLIED-TEXT'), false, 'and never what was in it');
    assert.equal(serialised.includes(FIXTURE_PHONE), false);
    assert.equal(serialised.includes(FIXTURE_PAYLOAD_MARKER), false);
  });

  await test('organization metrics are counts and ages, with no unbounded dimension', async () => {
    await clearEvents();
    await createEvent({ clinicId: fixtures.defaultClinicId });
    await createEvent({ clinicId: fixtures.siblingClinicId, status: 'failed', deadLetteredAt: null });

    const res = await callMetrics(owner());
    assert.equal(res.statusCode, 200);
    assertNoSensitiveContent(res, 'metrics');

    const serialised = JSON.stringify(res.body);
    assert.equal(serialised.includes(fixtures.defaultClinicId), false, 'no per-clinic dimension');
    assert.equal(serialised.includes(fixtures.siblingClinicId), false, 'no per-clinic dimension');
    assert.equal(serialised.includes('providerMessageId'), false, 'no per-message dimension');

    for (const entry of res.body.byChannelProvider as Array<Record<string, unknown>>) {
      assert.deepEqual(Object.keys(entry).sort(), ['channel', 'dead', 'failed', 'provider']);
    }
  });
}

async function scenarioMetricsScoping(): Promise<void> {
  section('G. Metrics are tenant-scoped');

  await test('another organization\'s failures are not counted', async () => {
    await clearEvents();
    await createEvent({ clinicId: fixtures.defaultClinicId });
    await createEvent({ organizationId: fixtures.otherOrgId, clinicId: fixtures.crossOrgClinicId });
    await createEvent({ organizationId: fixtures.otherOrgId, clinicId: fixtures.crossOrgClinicId });

    const mine = await callMetrics(owner());
    assert.equal(mine.body.dead, 1, 'one dead event, not three');
    assert.equal(mine.body.organizationId, fixtures.orgId);

    const theirs = await callMetrics(owner(), fixtures.otherOrgId);
    assert.equal(theirs.body.dead, 2, 'and the other organization sees its own two');
  });

  await test('a clinic-scoped operator\'s metrics count only their clinics', async () => {
    await clearEvents();
    await createEvent({ clinicId: fixtures.defaultClinicId });
    await createEvent({ clinicId: fixtures.siblingClinicId });
    await createEvent({ clinicId: null });

    const scoped = await callMetrics(clinicManager([fixtures.defaultClinicId]));
    assert.equal(scoped.body.dead, 1);

    const wide = await callMetrics(owner());
    assert.equal(wide.body.dead, 3, 'organization-wide includes the unrouted event');
  });

  await test('an empty clinic scope counts nothing', async () => {
    await clearEvents();
    await createEvent({ clinicId: fixtures.defaultClinicId });

    const res = await callMetrics(clinicManager([]));
    assert.equal(res.body.dead, 0);
  });
}

async function scenarioPagination(): Promise<void> {
  section('H. Pagination is bounded, deterministic and cannot be widened');

  await test('an oversized limit is CLAMPED to the maximum, never honoured', async () => {
    await clearEvents();
    await createEvent();

    const res = await callDead(owner(), { limit: '100000' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.pageSize, MESSAGING_DLQ_MAX_PAGE_SIZE);
    assert.equal(res.body.maxPageSize, MESSAGING_DLQ_MAX_PAGE_SIZE);
  });

  await test('a nonsense or negative limit falls back to the default', async () => {
    await clearEvents();
    await createEvent();

    for (const limit of ['abc', '-1', '0', '', 'NaN']) {
      const res = await callDead(owner(), { limit });
      assert.equal(res.statusCode, 200, `limit=${limit}`);
      assert.equal(res.body.pageSize, MESSAGING_DLQ_DEFAULT_PAGE_SIZE, `limit=${limit}`);
    }
  });

  await test('a nonsense or zero page falls back to the first page', async () => {
    await clearEvents();
    await createEvent();

    for (const page of ['abc', '0', '-5']) {
      const res = await callDead(owner(), { page });
      assert.equal(res.body.page, 1, `page=${page}`);
      assert.equal(res.body.rows.length, 1, `page=${page}`);
    }
  });

  await test('paging is a TOTAL order — no row is seen twice or skipped', async () => {
    // Every row shares deadLetteredAt to the millisecond, which is exactly the
    // case a `deadLetteredAt DESC` sort alone cannot page correctly.
    await clearEvents();
    const sameInstant = new Date();
    const created: string[] = [];
    for (let i = 0; i < 7; i++) {
      created.push(await createEvent({ deadLetteredAt: sameInstant }));
    }

    const seen: string[] = [];
    for (let page = 1; page <= 4; page++) {
      const res = await callDead(owner(), { page: String(page), limit: '2' });
      assert.equal(res.body.total, 7, 'the total is stable across pages');
      seen.push(...(res.body.rows as Array<{ id: string }>).map((r) => r.id));
    }

    assert.equal(new Set(seen).size, 7, 'no duplicates across pages');
    assert.deepEqual([...seen].sort(), [...created].sort(), 'and nothing was skipped');
  });

  await test('a page beyond the end is an empty page, not an error', async () => {
    await clearEvents();
    await createEvent();

    const res = await callDead(owner(), { page: '99', limit: '10' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.rows, []);
    assert.equal(res.body.total, 1);
  });
}

async function scenarioAudit(): Promise<void> {
  section('I. Audit');

  await test('a SUCCESSFUL replay writes exactly one AuditLog row, attributed to the actor', async () => {
    await clearEvents();
    const eventId = await createEvent();
    const actor = clinicManager([fixtures.defaultClinicId]);
    const request = req(actor, { params: { id: eventId }, body: {} });
    const actorUserId = request.user!.id;

    const res = mockResponse();
    await runChain(getFullChain(messagingReliabilityRouter, 'post', REPLAY_PATH), request, res);
    assert.equal(res.statusCode, 200);

    const rows = await prisma.auditLog.findMany({
      where: { organizationId: fixtures.orgId, action: 'messaging_inbound_event_replayed' },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.entityId, eventId);
    assert.equal(rows[0]!.entityType, 'messaging_inbound_event');
    assert.equal(rows[0]!.actorUserId, actorUserId, 'attributed to the session user, not a system principal');
    assert.equal(rows[0]!.clinicId, fixtures.defaultClinicId);
  });

  await test('the audit row carries NO message content and NO phone number', async () => {
    await clearEvents();
    const eventId = await createEvent();
    assert.equal((await callReplay(owner(), eventId)).statusCode, 200);

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: fixtures.orgId, action: 'messaging_inbound_event_replayed' },
    });
    const serialised = JSON.stringify(row);
    assert.equal(serialised.includes(FIXTURE_PHONE), false);
    assert.equal(serialised.includes(FIXTURE_PAYLOAD_MARKER), false);
    assert.equal(serialised.includes('rawPayload'), false);
    assert.equal(serialised.includes('errorMessage'), false);
  });

  await test('a REFUSED replay writes no audit row at all', async () => {
    // Refusals are not silently swallowed either — they are simply not an
    // AuditLog concern. Writing one per probe would turn an id-guessing script
    // into an unbounded write amplifier against the compliance trail.
    await clearEvents();
    const sibling = await createEvent({ clinicId: fixtures.siblingClinicId });

    const res = await callReplay(clinicManager([fixtures.defaultClinicId]), sibling);
    assert.equal(res.statusCode, 403);

    const rows = await prisma.auditLog.findMany({
      where: { organizationId: fixtures.orgId, action: 'messaging_inbound_event_replayed' },
    });
    assert.equal(rows.length, 0);
  });

  await test('concurrent replays write exactly ONE audit row, matching the one transition', async () => {
    await clearEvents();
    const eventId = await createEvent();

    await Promise.all([callReplay(owner(), eventId), callReplay(owner(), eventId), callReplay(owner(), eventId)]);

    const rows = await prisma.auditLog.findMany({
      where: { organizationId: fixtures.orgId, action: 'messaging_inbound_event_replayed' },
    });
    assert.equal(rows.length, 1, 'the audit trail must not claim three replays happened');
  });
}

async function main(): Promise<void> {
  fixtures = await createClinicFixtureSet('msgops');

  await scenarioRoleGate();
  await scenarioTenantIsolation();
  await scenarioReplayAuthorization();
  await scenarioReplayState();
  await scenarioBodyOverride();
  await scenarioResponseMinimisation();
  await scenarioMetricsScoping();
  await scenarioPagination();
  await scenarioAudit();

  const ok = summary();
  await clearEvents();
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
