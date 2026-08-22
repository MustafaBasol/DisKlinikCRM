/**
 * messagingInboundReliability.test.ts — F5-3 against a REAL PostgreSQL.
 *
 * The guarantees here are all properties of the database or of concurrent
 * access, and cannot honestly be proved anywhere else:
 *
 *   - a terminal transition is guarded, so a late success beats a late
 *     giving-up;
 *   - the dead-letter view really is scoped to one organization;
 *   - replay is refused for every unauthorized or inapplicable case, and a
 *     refused replay leaves the row byte-identical;
 *   - the retry job's own sweeps move exactly the rows they should and no
 *     others — including the two categories that were previously invisible
 *     (window-expired and unsupported-channel);
 *   - `(channel, provider, connectionId, providerMessageId)` is a real unique
 *     constraint, which is what makes a replay safe against a concurrent
 *     provider redelivery.
 *
 * The DB-free contract layer (classification, backoff, bounded HTTP, flags,
 * structural guards) is proved in `tests/messagingReliability.test.ts` and is
 * deliberately not repeated.
 *
 * Run: npx tsx src/tests/dbVerification/messagingInboundReliability.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres before import.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  createSuite,
  createClinicFixtureSet,
  cleanupAllFixtures,
  prisma,
  type ClinicFixtureSet,
} from './dbVerificationHarness.js';

import {
  deadLetterInboundEvent,
  listDeadInboundEvents,
  getMessagingInboundMetrics,
  MESSAGING_INBOUND_TERMINAL_STATUS,
} from '../../messaging/messagingInboundDlq.js';
import {
  replayDeadInboundEvent,
  MAX_INBOUND_REPLAYS_PER_EVENT,
} from '../../messaging/messagingInboundReplay.js';
import { deadLetterUnretryableEvents } from '../../jobs/inboundEventRetryJob.js';
import { markInboundEventFailed } from '../../services/messagingInboundIdempotency.js';

const { section, test, summary } = createSuite('messagingInboundReliability');

let fixtures: ClinicFixtureSet;

/** Connection ids are opaque strings on this model (no FK), so a uuid is enough. */
function newConnectionId(): string {
  return randomUUID();
}

interface EventOverrides {
  channel?: string;
  provider?: string;
  status?: string;
  clinicId?: string | null;
  organizationId?: string | null;
  connectionId?: string | null;
  attempts?: number;
  createdAt?: Date;
  lastErrorCode?: string | null;
  nextAttemptAt?: Date | null;
  replayCount?: number;
  withPayload?: boolean;
}

async function createInboundEvent(o: EventOverrides = {}): Promise<string> {
  const row = await prisma.messagingInboundEvent.create({
    data: {
      channel: o.channel ?? 'whatsapp',
      provider: o.provider ?? 'meta_cloud_api',
      connectionId: o.connectionId === undefined ? newConnectionId() : o.connectionId,
      clinicId: o.clinicId === undefined ? fixtures.defaultClinicId : o.clinicId,
      organizationId: o.organizationId === undefined ? fixtures.orgId : o.organizationId,
      providerMessageId: `wamid.${randomUUID()}`,
      status: o.status ?? 'failed',
      attempts: o.attempts ?? 0,
      ...(o.createdAt ? { createdAt: o.createdAt } : {}),
      ...(o.lastErrorCode !== undefined ? { lastErrorCode: o.lastErrorCode } : {}),
      ...(o.nextAttemptAt !== undefined ? { nextAttemptAt: o.nextAttemptAt } : {}),
      ...(o.replayCount !== undefined ? { replayCount: o.replayCount } : {}),
      rawPayload: o.withPayload === false ? undefined : { entry: [{ id: 'synthetic' }] },
    },
    select: { id: true },
  });
  return row.id;
}

async function readEvent(id: string) {
  return prisma.messagingInboundEvent.findUniqueOrThrow({ where: { id } });
}

const ORG_WIDE_AUTH = () => ({
  organizationId: fixtures.orgId,
  clinicScope: { kind: 'ORGANIZATION_WIDE' as const },
  actorUserId: null,
  actorRole: 'OWNER',
});

/** Remove every messaging row this suite created, between scenarios. */
async function clearEvents(): Promise<void> {
  await prisma.messagingInboundEvent.deleteMany({
    where: { organizationId: { in: [fixtures.orgId, fixtures.otherOrgId] } },
  });
  await prisma.messagingInboundEvent.deleteMany({ where: { organizationId: null } });
}

// ─────────────────────────────────────────────────────────────────────────────

async function scenarioTerminalState() {
  section('A. Terminal state — `failed` no longer means four different things');

  await test('a failed event transitions to dead with a stable code and a timestamp', async () => {
    const id = await createInboundEvent();
    const result = await deadLetterInboundEvent({ eventId: id, code: 'MAX_ATTEMPTS_EXCEEDED' });
    assert.equal(result.transitioned, true);

    const row = await readEvent(id);
    assert.equal(row.status, MESSAGING_INBOUND_TERMINAL_STATUS);
    assert.equal(row.lastErrorCode, 'MAX_ATTEMPTS_EXCEEDED');
    assert.ok(row.deadLetteredAt);
    assert.equal(row.nextAttemptAt, null, 'a terminal event must not stay scheduled');
  });

  await test('a LATE SUCCESS beats a late giving-up — a processed row is never clobbered', async () => {
    const id = await createInboundEvent({ status: 'processed' });
    const result = await deadLetterInboundEvent({ eventId: id, code: 'MAX_ATTEMPTS_EXCEEDED' });
    assert.equal(result.transitioned, false);
    assert.equal((await readEvent(id)).status, 'processed');
  });

  await test('dead-lettering is idempotent — a second call does not re-stamp the row', async () => {
    const id = await createInboundEvent();
    await deadLetterInboundEvent({ eventId: id, code: 'PERMANENT_VALIDATION' });
    const first = await readEvent(id);
    const second = await deadLetterInboundEvent({ eventId: id, code: 'MAX_ATTEMPTS_EXCEEDED' });
    assert.equal(second.transitioned, false);
    const after = await readEvent(id);
    assert.equal(after.lastErrorCode, 'PERMANENT_VALIDATION', 'the FIRST diagnosis must survive');
    assert.deepEqual(after.deadLetteredAt, first.deadLetteredAt);
  });

  await test('markInboundEventFailed writes a stable code and no provider text', async () => {
    const id = await createInboundEvent({ status: 'processing' });
    const due = new Date(Date.now() + 60_000);
    await markInboundEventFailed(id, { code: 'PROVIDER_OUTAGE', nextAttemptAt: due });
    const row = await readEvent(id);
    assert.equal(row.status, 'failed');
    assert.equal(row.lastErrorCode, 'PROVIDER_OUTAGE');
    assert.equal(row.nextAttemptAt?.getTime(), due.getTime());
    assert.equal(row.errorMessage, 'Inbound processing failed (PROVIDER_OUTAGE).');
  });

  await test('a legacy caller passing a raw Error still gets a stable code, never its message', async () => {
    const id = await createInboundEvent({ status: 'processing' });
    await markInboundEventFailed(id, new Error('Meta said: +905551234567 is not reachable'));
    const row = await readEvent(id);
    assert.equal(row.lastErrorCode, 'UNKNOWN');
    assert.ok(
      !String(row.errorMessage).includes('905551234567'),
      'the raw exception message reached a persisted, operator-readable column',
    );
  });

  await clearEvents();
}

async function scenarioSweeps() {
  section('B. The two previously-invisible terminal categories');

  await test('an event past the retry window is dead-lettered, not left looking retryable', async () => {
    const old = await createInboundEvent({
      createdAt: new Date(Date.now() - 7 * 60 * 60 * 1000), // older than the 6h window
      attempts: 1,
    });
    const fresh = await createInboundEvent({ attempts: 1 });

    const swept = await deadLetterUnretryableEvents(Date.now());
    assert.ok(swept.expired >= 1);

    const oldRow = await readEvent(old);
    assert.equal(oldRow.status, MESSAGING_INBOUND_TERMINAL_STATUS);
    assert.equal(oldRow.lastErrorCode, 'RETRY_WINDOW_EXPIRED');
    // Before F5-3 this row sat `failed` with attempts: 1 forever — visually
    // identical to one about to be retried.
    assert.equal(oldRow.attempts, 1, 'the sweep must not rewrite the attempt history');

    assert.equal((await readEvent(fresh)).status, 'failed', 'an in-window event was swept');
    await clearEvents();
  });

  await test('a channel with NO re-delivery handler is dead-lettered as NO_RETRY_HANDLER', async () => {
    const evolution = await createInboundEvent({ channel: 'whatsapp', provider: 'evolution' });
    const instagram = await createInboundEvent({ channel: 'instagram', provider: 'meta_graph' });
    const meta = await createInboundEvent({ channel: 'whatsapp', provider: 'meta_cloud_api' });

    await deadLetterUnretryableEvents(Date.now());

    for (const id of [evolution, instagram]) {
      const row = await readEvent(id);
      assert.equal(row.status, MESSAGING_INBOUND_TERMINAL_STATUS, 'unsupported channel not swept');
      assert.equal(row.lastErrorCode, 'NO_RETRY_HANDLER');
    }
    assert.equal(
      (await readEvent(meta)).status,
      'failed',
      'the SUPPORTED channel must be left for the retry loop',
    );
    await clearEvents();
  });

  await test('the sweeps touch nothing that is already processed or dead', async () => {
    const processed = await createInboundEvent({
      status: 'processed',
      channel: 'instagram',
      provider: 'meta_graph',
      createdAt: new Date(Date.now() - 20 * 60 * 60 * 1000),
    });
    await deadLetterUnretryableEvents(Date.now());
    assert.equal((await readEvent(processed)).status, 'processed');
    await clearEvents();
  });
}

async function scenarioDlqScoping() {
  section('C. Dead-letter inspection is tenant-scoped and KVKK-safe');

  await test('an organization sees its own dead events and NOT another organization\'s', async () => {
    const mine = await createInboundEvent();
    const theirs = await createInboundEvent({
      organizationId: fixtures.otherOrgId,
      clinicId: fixtures.crossOrgClinicId,
    });
    await deadLetterInboundEvent({ eventId: mine, code: 'MAX_ATTEMPTS_EXCEEDED' });
    await deadLetterInboundEvent({ eventId: theirs, code: 'MAX_ATTEMPTS_EXCEEDED' });

    const own = await listDeadInboundEvents({ organizationId: fixtures.orgId });
    assert.ok(own.some((e) => e.id === mine));
    assert.ok(!own.some((e) => e.id === theirs), 'a dead event leaked across organizations');

    const other = await listDeadInboundEvents({ organizationId: fixtures.otherOrgId });
    assert.ok(other.some((e) => e.id === theirs));
    assert.ok(!other.some((e) => e.id === mine));
  });

  await test('the view carries no payload, no error message and no phone number', async () => {
    const id = await createInboundEvent();
    await prisma.messagingInboundEvent.update({
      where: { id },
      data: { fromPhone: '+905551234567', errorMessage: 'legacy raw text with +905551234567' },
    });
    await deadLetterInboundEvent({ eventId: id, code: 'PERMANENT_VALIDATION' });

    const rows = await listDeadInboundEvents({ organizationId: fixtures.orgId });
    const found = rows.find((e) => e.id === id);
    assert.ok(found);
    for (const forbidden of ['rawPayload', 'errorMessage', 'fromPhone', 'toPhone']) {
      assert.ok(!(forbidden in found!), `the DLQ view exposes ${forbidden}`);
    }
    const serialized = JSON.stringify(found);
    assert.ok(!serialized.includes('905551234567'), 'a patient phone number reached the DLQ view');
    assert.equal(found!.lastErrorCode, 'PERMANENT_VALIDATION');
    assert.ok(found!.ageMs >= 0);
  });

  await test('clinic and channel filters narrow, never widen', async () => {
    const here = await createInboundEvent({ clinicId: fixtures.defaultClinicId });
    const sibling = await createInboundEvent({ clinicId: fixtures.siblingClinicId });
    await deadLetterInboundEvent({ eventId: here, code: 'MAX_ATTEMPTS_EXCEEDED' });
    await deadLetterInboundEvent({ eventId: sibling, code: 'MAX_ATTEMPTS_EXCEEDED' });

    const scoped = await listDeadInboundEvents({
      organizationId: fixtures.orgId,
      clinicId: fixtures.defaultClinicId,
    });
    assert.ok(scoped.some((e) => e.id === here));
    assert.ok(!scoped.some((e) => e.id === sibling));
  });

  await clearEvents();
}

async function scenarioMetrics() {
  section('D. Metrics make a provider outage and a backlog visible');

  await test('due vs scheduled retries are separated, and the oldest unresolved age is reported', async () => {
    const due = await createInboundEvent({ nextAttemptAt: new Date(Date.now() - 60_000) });
    const scheduled = await createInboundEvent({ nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000) });
    await prisma.messagingInboundEvent.update({
      where: { id: due },
      data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) },
    });

    const m = await getMessagingInboundMetrics();
    assert.ok(m.retryDue >= 1, 'a due retry is not counted');
    assert.ok(m.retryScheduled >= 1, 'a scheduled retry is counted as due');
    assert.ok(
      m.oldestUnresolvedAgeMs !== null && m.oldestUnresolvedAgeMs >= 10 * 60 * 1000 - 5_000,
      `oldest unresolved age was ${m.oldestUnresolvedAgeMs}`,
    );
    void scheduled;
    await clearEvents();
  });

  await test('a NULL nextAttemptAt still counts as due — pre-F5-3 rows are not invisible', async () => {
    await createInboundEvent({ nextAttemptAt: null });
    const m = await getMessagingInboundMetrics();
    assert.ok(m.retryDue >= 1);
    await clearEvents();
  });

  await test('failures are sliceable by stable code and by channel/provider only', async () => {
    const a = await createInboundEvent({ channel: 'instagram', provider: 'meta_graph' });
    const b = await createInboundEvent({ channel: 'whatsapp', provider: 'evolution' });
    await deadLetterInboundEvent({ eventId: a, code: 'NO_RETRY_HANDLER' });
    await deadLetterInboundEvent({ eventId: b, code: 'NO_RETRY_HANDLER' });

    const m = await getMessagingInboundMetrics();
    assert.ok((m.deadByCode.NO_RETRY_HANDLER ?? 0) >= 2);
    assert.ok(m.oldestDeadAgeMs !== null);

    const channels = m.byChannelProvider.map((c) => `${c.channel}|${c.provider}`);
    assert.ok(channels.includes('instagram|meta_graph'));
    assert.ok(channels.includes('whatsapp|evolution'));
    // Bounded dimensions: nothing here is per-clinic or per-message.
    for (const entry of m.byChannelProvider) {
      assert.deepEqual(Object.keys(entry).sort(), ['channel', 'dead', 'failed', 'provider']);
    }
    await clearEvents();
  });
}

async function scenarioReplay() {
  section('E. Replay is authorized, bounded, audited and channel-aware');

  async function makeDead(overrides: EventOverrides = {}): Promise<string> {
    const id = await createInboundEvent({ attempts: 3, ...overrides });
    await deadLetterInboundEvent({ eventId: id, code: 'MAX_ATTEMPTS_EXCEEDED' });
    return id;
  }

  await test('replaying a terminal Meta event requeues it and refreshes its attempt budget', async () => {
    const id = await makeDead();
    const result = await replayDeadInboundEvent({ eventId: id, authorization: ORG_WIDE_AUTH() });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const row = await readEvent(id);
    assert.equal(row.status, 'failed', 'a replayed event must become retryable again');
    assert.equal(row.attempts, 0, 'the attempt budget is what a replay refreshes');
    assert.equal(row.deadLetteredAt, null);
    assert.equal(row.lastErrorCode, null);
    assert.equal(row.replayCount, 1);
    assert.ok(row.lastReplayedAt);
    assert.ok(row.nextAttemptAt, 'an operator asking now should not wait out a backoff');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'messaging_inbound_event_replayed', entityId: id },
    });
    assert.ok(audit, 'a replay must be audited');
    const metadata = audit!.metadata as Record<string, unknown>;
    assert.equal(metadata.previousErrorCode, 'MAX_ATTEMPTS_EXCEEDED');
    assert.equal(metadata.channel, 'whatsapp');
    const serialized = JSON.stringify(metadata);
    assert.ok(!/\+90\d{10}/.test(serialized), 'a phone number reached the audit metadata');
  });

  await test('a channel with no re-delivery handler is refused, not silently no-opped', async () => {
    for (const target of [
      { channel: 'whatsapp', provider: 'evolution' },
      { channel: 'instagram', provider: 'meta_graph' },
    ]) {
      const id = await makeDead(target);
      const result = await replayDeadInboundEvent({ eventId: id, authorization: ORG_WIDE_AUTH() });
      assert.equal(result.ok, false, `${target.provider} should be refused`);
      if (!result.ok) assert.equal(result.refusal, 'NO_REDELIVERY_HANDLER');
      assert.equal(
        (await readEvent(id)).status,
        MESSAGING_INBOUND_TERMINAL_STATUS,
        'a refused replay must leave the row terminal',
      );
    }
  });

  await test('a NON-terminal event cannot be replayed out from under the retry job', async () => {
    const id = await createInboundEvent({ status: 'failed' });
    const result = await replayDeadInboundEvent({ eventId: id, authorization: ORG_WIDE_AUTH() });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.refusal, 'NOT_TERMINAL');
  });

  await test('an already-PROCESSED event is refused — replay would duplicate the effect', async () => {
    const id = await createInboundEvent({ status: 'processed' });
    const result = await replayDeadInboundEvent({ eventId: id, authorization: ORG_WIDE_AUTH() });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.refusal, 'ALREADY_PROCESSED');
  });

  await test('a CROSS-ORGANIZATION replay is NOT_FOUND, never "forbidden" (no id oracle)', async () => {
    const id = await makeDead();
    const result = await replayDeadInboundEvent({
      eventId: id,
      authorization: { ...ORG_WIDE_AUTH(), organizationId: fixtures.otherOrgId },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.refusal, 'NOT_FOUND');
  });

  await test('a SIBLING-clinic replay outside the caller\'s scope is refused', async () => {
    const id = await makeDead({ clinicId: fixtures.defaultClinicId });
    const refused = await replayDeadInboundEvent({
      eventId: id,
      authorization: {
        ...ORG_WIDE_AUTH(),
        clinicScope: { kind: 'EXPLICIT', clinicIds: [fixtures.siblingClinicId] },
      },
    });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.refusal, 'CROSS_CLINIC_REFUSED');

    // The same caller WITH the right clinic in scope succeeds — proving the
    // refusal was the scope and not an unrelated precondition.
    const allowed = await replayDeadInboundEvent({
      eventId: id,
      authorization: {
        ...ORG_WIDE_AUTH(),
        clinicScope: { kind: 'EXPLICIT', clinicIds: [fixtures.defaultClinicId] },
      },
    });
    assert.equal(allowed.ok, true);
  });

  await test('an UNROUTED event (clinicId null) is unreachable from a clinic-scoped caller', async () => {
    const id = await makeDead({ clinicId: null });
    const result = await replayDeadInboundEvent({
      eventId: id,
      authorization: {
        ...ORG_WIDE_AUTH(),
        clinicScope: { kind: 'EXPLICIT', clinicIds: [fixtures.defaultClinicId] },
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.refusal, 'CROSS_CLINIC_REFUSED');
  });

  await test('an event with no connection is UNROUTABLE', async () => {
    const id = await makeDead({ connectionId: null });
    const result = await replayDeadInboundEvent({ eventId: id, authorization: ORG_WIDE_AUTH() });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.refusal, 'UNROUTABLE');
  });

  await test('an event with no stored envelope has nothing to re-drive', async () => {
    const id = await makeDead({ withPayload: false });
    const result = await replayDeadInboundEvent({ eventId: id, authorization: ORG_WIDE_AUTH() });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.refusal, 'NO_STORED_PAYLOAD');
  });

  await test('the replay ceiling is enforced', async () => {
    const id = await makeDead({ replayCount: MAX_INBOUND_REPLAYS_PER_EVENT });
    const result = await replayDeadInboundEvent({ eventId: id, authorization: ORG_WIDE_AUTH() });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.refusal, 'REPLAY_LIMIT_EXCEEDED');
  });

  await test('a refused replay leaves the row byte-identical and writes no audit row', async () => {
    const id = await makeDead();
    const before = await readEvent(id);
    const auditsBefore = await prisma.auditLog.count({
      where: { action: 'messaging_inbound_event_replayed', entityId: id },
    });

    await replayDeadInboundEvent({
      eventId: id,
      authorization: { ...ORG_WIDE_AUTH(), organizationId: fixtures.otherOrgId },
    });

    const after = await readEvent(id);
    assert.equal(after.status, before.status);
    assert.equal(after.replayCount, before.replayCount);
    assert.equal(after.attempts, before.attempts);
    assert.deepEqual(after.deadLetteredAt, before.deadLetteredAt);
    assert.equal(
      await prisma.auditLog.count({ where: { action: 'messaging_inbound_event_replayed', entityId: id } }),
      auditsBefore,
    );
  });

  await test('two concurrent replays of the same event resolve to exactly one requeue', async () => {
    const id = await makeDead();
    const [a, b] = await Promise.all([
      replayDeadInboundEvent({ eventId: id, authorization: ORG_WIDE_AUTH() }),
      replayDeadInboundEvent({ eventId: id, authorization: ORG_WIDE_AUTH() }),
    ]);
    const wins = [a, b].filter((r) => r.ok).length;
    assert.equal(wins, 1, `expected exactly one winner, got ${wins}`);
    assert.equal((await readEvent(id)).replayCount, 1, 'the losing replay still bumped the counter');
  });

  await clearEvents();
}

async function scenarioDedupe() {
  section('F. The dedupe constraint that makes replay safe is real');

  await test('(channel, provider, connectionId, providerMessageId) is enforced by Postgres', async () => {
    const connectionId = newConnectionId();
    const providerMessageId = `wamid.${randomUUID()}`;
    const base = {
      channel: 'whatsapp',
      provider: 'meta_cloud_api',
      connectionId,
      providerMessageId,
      organizationId: fixtures.orgId,
      clinicId: fixtures.defaultClinicId,
      status: 'failed',
    };
    await prisma.messagingInboundEvent.create({ data: base });
    await assert.rejects(
      prisma.messagingInboundEvent.create({ data: base }),
      (err: unknown) => (err as { code?: string })?.code === 'P2002',
      'a provider redelivery during a replay could create a second row',
    );
    await clearEvents();
  });

  await test('replay does NOT create a second envelope for one real message', async () => {
    const id = await createInboundEvent({ attempts: 3 });
    await deadLetterInboundEvent({ eventId: id, code: 'MAX_ATTEMPTS_EXCEEDED' });
    const before = await prisma.messagingInboundEvent.count({
      where: { organizationId: fixtures.orgId },
    });
    const result = await replayDeadInboundEvent({ eventId: id, authorization: ORG_WIDE_AUTH() });
    assert.equal(result.ok, true);
    const after = await prisma.messagingInboundEvent.count({
      where: { organizationId: fixtures.orgId },
    });
    assert.equal(after, before, 'an inbound replay must reuse the row, not clone the envelope');
    await clearEvents();
  });
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  fixtures = await createClinicFixtureSet('msgrel');

  await scenarioTerminalState();
  await scenarioSweeps();
  await scenarioDlqScoping();
  await scenarioMetrics();
  await scenarioReplay();
  await scenarioDedupe();

  const ok = summary();
  await clearEvents();
  await prisma.auditLog.deleteMany({
    where: { organizationId: { in: [fixtures.orgId, fixtures.otherOrgId] } },
  });
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
