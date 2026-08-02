/**
 * externalCalendarOutboundSyncJob.test.ts — bounded retry job for
 * ExternalCalendarAppointmentLink rows. Mocked-Prisma (same convention as
 * externalCalendarOutboundSync.test.ts), exercising the REAL
 * attemptExternalCalendarSync (no test-only provider override) via the
 * genuine DigiDentiS provider: connections are deliberately left without a
 * clientId/clientSecret, so DigiDentisProvider's own resolveClientConfig()
 * throws ExternalCalendarAuthError before any network call is attempted —
 * this gives a fully deterministic, network-free way to prove the job
 * actually drives due rows through the real sync function end-to-end.
 *
 * Run with: npx tsx src/tests/externalCalendarOutboundSyncJob.test.ts
 */

import assert from 'node:assert/strict';
import prisma from '../db.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

type LinkRow = {
  id: string;
  connectionId: string;
  organizationId: string;
  clinicId: string;
  appointmentId: string | null;
  externalAppointmentId: string | null;
  idempotencyKey: string;
  status: string;
  attempts: number;
  nextAttemptAt: Date | null;
  lastAttemptAt: Date | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

let links: LinkRow[] = [];
let integrations: any[] = [];
let mappings: any[] = [];
let appointments: any[] = [];
let patients: any[] = [];
let practitioners: any[] = [];
let appointmentTypes: any[] = [];
let clinics: any[] = [];
let operationalEvents: any[] = [];
let seq = 0;

function resetFixtures() {
  links = [];
  integrations = [];
  mappings = [];
  appointments = [];
  patients = [];
  practitioners = [];
  appointmentTypes = [];
  clinics = [];
  operationalEvents = [];
}

(prisma as any).externalCalendarIntegration = {
  async findUnique({ where }: any) {
    if (where.clinicId !== undefined) return integrations.find((i) => i.clinicId === where.clinicId) ?? null;
    return integrations.find((i) => i.id === where.id) ?? null;
  },
  async update({ where, data }: any) {
    const row = integrations.find((i) => i.clinicId === where.clinicId);
    if (!row) throw new Error('not found');
    Object.assign(row, data);
    return { ...row };
  },
};
(prisma as any).operationalEvent = {
  async create({ data }: any) {
    operationalEvents.push(data);
    return { id: `opevent-${++seq}`, createdAt: new Date(), resolvedAt: null, resolvedById: null, ...data };
  },
};
(prisma as any).externalCalendarMapping = {
  async findFirst({ where }: any) {
    return mappings.find((m) => m.connectionId === where.connectionId && m.mappingType === where.mappingType && m.localId === where.localId && m.isActive) ?? null;
  },
};
(prisma as any).appointment = {
  async findUnique({ where }: any) {
    const appt = appointments.find((a) => a.id === where.id);
    if (!appt) return null;
    return {
      ...appt,
      patient: patients.find((p) => p.id === appt.patientId) ?? null,
      practitioner: practitioners.find((p) => p.id === appt.practitionerId) ?? null,
      appointmentType: appointmentTypes.find((t) => t.id === appt.appointmentTypeId) ?? null,
      clinic: clinics.find((c) => c.id === appt.clinicId) ?? null,
    };
  },
};
(prisma as any).appointmentRequest = {
  async findFirst() { return null; },
};
(prisma as any).externalCalendarAppointmentLink = {
  async findMany({ where, orderBy, take }: any) {
    let results = links.filter((l) => {
      if (where.status && l.status !== where.status) return false;
      if (where.attempts?.lt !== undefined && !(l.attempts < where.attempts.lt)) return false;
      if (where.createdAt?.lt !== undefined && !(l.createdAt < where.createdAt.lt)) return false;
      if (where.OR) {
        const matches = where.OR.some((clause: any) => {
          if ('nextAttemptAt' in clause) {
            if (clause.nextAttemptAt === null) return l.nextAttemptAt === null;
            if (clause.nextAttemptAt?.lte) return l.nextAttemptAt !== null && l.nextAttemptAt <= clause.nextAttemptAt.lte;
          }
          return false;
        });
        if (!matches) return false;
      }
      return true;
    });
    if (orderBy?.updatedAt === 'asc') results = results.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
    if (orderBy?.createdAt === 'asc') results = results.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (take) results = results.slice(0, take);
    return results.map((r) => ({ ...r }));
  },
  async updateMany({ where, data }: any) {
    let count = 0;
    for (const row of links) {
      if (where.id !== undefined && row.id !== where.id) continue;
      if (where.status?.in && !where.status.in.includes(row.status)) continue;
      if (where.status && typeof where.status === 'string' && row.status !== where.status) continue;
      if (where.updatedAt?.lt && !(row.updatedAt < where.updatedAt.lt)) continue;
      if (where.OR) {
        const matches = where.OR.some((clause: any) => {
          if ('nextAttemptAt' in clause) {
            if (clause.nextAttemptAt === null) return row.nextAttemptAt === null;
            if (clause.nextAttemptAt?.lte) return row.nextAttemptAt !== null && row.nextAttemptAt <= clause.nextAttemptAt.lte;
          }
          return false;
        });
        if (!matches) continue;
      }
      if (data.status !== undefined) row.status = data.status;
      if (data.attempts?.increment !== undefined) row.attempts += data.attempts.increment;
      if (data.lastAttemptAt !== undefined) row.lastAttemptAt = data.lastAttemptAt;
      if (data.nextAttemptAt !== undefined) row.nextAttemptAt = data.nextAttemptAt;
      if (data.lastError !== undefined) row.lastError = data.lastError;
      if (data.errorCode !== undefined) row.errorCode = data.errorCode;
      row.updatedAt = new Date();
      count++;
    }
    return { count };
  },
  async findUnique({ where }: any) {
    const row = links.find((l) => l.id === where.id);
    return row ? { ...row } : null;
  },
  async update({ where, data }: any) {
    const row = links.find((l) => l.id === where.id);
    if (!row) throw new Error('not found');
    Object.assign(row, data, { updatedAt: new Date() });
    return { ...row };
  },
};

const { runExternalCalendarOutboundSyncJob } = await import('../jobs/externalCalendarOutboundSyncJob.js');

function makeUnconfiguredConnection(clinicId: string) {
  const row = {
    id: `conn-${clinicId}`,
    clinicId,
    organizationId: `org-${clinicId}`,
    provider: 'digidentis',
    enabled: true,
    status: 'configured',
    lastError: null,
    // Deliberately no clientId/clientSecret — forces a deterministic,
    // network-free ExternalCalendarAuthError from DigiDentisProvider itself.
    clientId: null,
    clientSecretEncrypted: null,
    webhookSecretEncrypted: null,
    externalCompanyId: null,
    externalClinicId: null,
    apiBaseUrl: null,
    lastCheckedAt: null,
    lastSuccessfulCheckAt: null,
    webhookReceiverKey: `webhook-${clinicId}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  integrations.push(row);
  clinics.push({ id: clinicId, organizationId: row.organizationId });
  return row;
}

function makeAppointmentWithMappings(clinicId: string, connectionId: string) {
  const id = `appt-${++seq}`;
  const patientId = `patient-${id}`;
  const practitionerId = `doctor-${id}`;
  const appointmentTypeId = `svc-${id}`;
  patients.push({ id: patientId, firstName: 'Ada', lastName: 'Yilmaz', phone: null, email: null });
  practitioners.push({ id: practitionerId, firstName: 'Berk', lastName: 'Demir' });
  appointmentTypes.push({ id: appointmentTypeId, name: 'Checkup' });
  mappings.push({ connectionId, clinicId, mappingType: 'practitioner', localId: practitionerId, externalId: 'ext-doctor-1', isActive: true });
  mappings.push({ connectionId, clinicId, mappingType: 'service', localId: appointmentTypeId, externalId: 'ext-treatment-1', isActive: true });
  const appt = { id, clinicId, patientId, practitionerId, appointmentTypeId, startTime: new Date(), endTime: new Date(Date.now() + 30 * 60 * 1000) };
  appointments.push(appt);
  return appt;
}

function makeLink(overrides: Partial<LinkRow>): LinkRow {
  const now = new Date();
  const row: LinkRow = {
    id: `link-${++seq}`,
    connectionId: 'conn-x',
    organizationId: 'org-x',
    clinicId: 'clinic-x',
    appointmentId: null,
    externalAppointmentId: null,
    idempotencyKey: `appt:${seq}`,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    lastSyncedAt: null,
    lastError: null,
    errorCode: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  links.push(row);
  return row;
}

async function main() {
  section('Crash recovery: rows stuck in syncing are recovered, then re-attempted in the same tick');
  resetFixtures();
  {
    const clinicId = 'clinic-job-stuck';
    const conn = makeUnconfiguredConnection(clinicId);
    const appt = makeAppointmentWithMappings(clinicId, conn.id);
    const stuckSince = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    const stuck = makeLink({
      connectionId: conn.id, clinicId, appointmentId: appt.id, idempotencyKey: `appt:${appt.id}`,
      status: 'syncing', updatedAt: stuckSince, attempts: 1,
    });
    const fresh = makeLink({ status: 'syncing', updatedAt: new Date(), attempts: 1 });

    await test('a row stuck in syncing for over the threshold is recovered to failed_retryable and re-attempted (not left stuck forever)', async () => {
      await runExternalCalendarOutboundSyncJob();
      const dbStuck = links.find((l) => l.id === stuck.id)!;
      assert.notEqual(dbStuck.status, 'syncing', 'must never remain stuck in syncing indefinitely');
      assert.equal(dbStuck.attempts, 2, 'recovery must feed back into a real retry attempt, not just a status flip');
    });

    await test('a row recently in syncing (not stuck) is left untouched', async () => {
      const dbFresh = links.find((l) => l.id === fresh.id)!;
      assert.equal(dbFresh.status, 'syncing');
    });
  }

  section('Due rows are actually processed via the real sync function');
  resetFixtures();
  {
    const clinicId = 'clinic-job-due';
    const conn = makeUnconfiguredConnection(clinicId);
    const appt = makeAppointmentWithMappings(clinicId, conn.id);
    const due = makeLink({
      connectionId: conn.id,
      clinicId,
      appointmentId: appt.id,
      idempotencyKey: `appt:${appt.id}`,
      status: 'failed_retryable',
      attempts: 1,
      nextAttemptAt: new Date(Date.now() - 1000),
    });

    await test('a due failed_retryable row is claimed and attempted, ending in a real classified outcome (AUTH_ERROR, no credentials configured)', async () => {
      await runExternalCalendarOutboundSyncJob();
      const dbLink = links.find((l) => l.id === due.id)!;
      assert.equal(dbLink.attempts, 2, 'the job must have driven exactly one more attempt');
      assert.equal(dbLink.status, 'failed_terminal');
      assert.equal(dbLink.errorCode, 'AUTH_ERROR');

      const integration = integrations.find((i) => i.clinicId === clinicId)!;
      assert.equal(integration.status, 'error', 'an AUTH_ERROR surfaced by the retry job must degrade the integration health, same as an immediate attempt');
    });
  }

  section('Stale pending rows (durable link created by the conversion transaction, never attempted — e.g. process restart) are swept');
  resetFixtures();
  {
    const clinicId = 'clinic-job-stale-pending';
    const conn = makeUnconfiguredConnection(clinicId);
    const apptStale = makeAppointmentWithMappings(clinicId, conn.id);
    const stalePending = makeLink({
      connectionId: conn.id, clinicId, appointmentId: apptStale.id, idempotencyKey: `appt:${apptStale.id}`,
      status: 'pending', attempts: 0, createdAt: new Date(Date.now() - 10 * 60 * 1000), updatedAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    const apptFresh = makeAppointmentWithMappings(clinicId, conn.id);
    const freshPending = makeLink({
      connectionId: conn.id, clinicId, appointmentId: apptFresh.id, idempotencyKey: `appt:${apptFresh.id}`,
      status: 'pending', attempts: 0, createdAt: new Date(), updatedAt: new Date(),
    });

    await test('a pending row older than the grace period is claimed and attempted by the job, not left stuck forever', async () => {
      await runExternalCalendarOutboundSyncJob();
      const dbStale = links.find((l) => l.id === stalePending.id)!;
      assert.equal(dbStale.attempts, 1, 'the sweep must drive a real attempt on the stale pending row');
      assert.notEqual(dbStale.status, 'pending', 'must have transitioned out of pending');
    });

    await test('a freshly-created pending row (within the grace period) is left for the immediate post-response attempt, not raced by the sweep', async () => {
      const dbFresh = links.find((l) => l.id === freshPending.id)!;
      assert.equal(dbFresh.attempts, 0);
      assert.equal(dbFresh.status, 'pending');
    });
  }

  section('Not-yet-due and exhausted rows are skipped');
  resetFixtures();
  {
    const clinicId = 'clinic-job-not-due';
    const conn = makeUnconfiguredConnection(clinicId);
    const apptFuture = makeAppointmentWithMappings(clinicId, conn.id);
    const notDueYet = makeLink({
      connectionId: conn.id, clinicId, appointmentId: apptFuture.id, idempotencyKey: `appt:${apptFuture.id}`,
      status: 'failed_retryable', attempts: 1, nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const apptExhausted = makeAppointmentWithMappings(clinicId, conn.id);
    const exhausted = makeLink({
      connectionId: conn.id, clinicId, appointmentId: apptExhausted.id, idempotencyKey: `appt:${apptExhausted.id}`,
      status: 'failed_retryable', attempts: 5, nextAttemptAt: new Date(Date.now() - 1000),
    });

    await test('a row whose backoff has not elapsed yet is left untouched', async () => {
      await runExternalCalendarOutboundSyncJob();
      const dbLink = links.find((l) => l.id === notDueYet.id)!;
      assert.equal(dbLink.attempts, 1, 'must not be retried before nextAttemptAt');
    });

    await test('a row that already exhausted MAX_SYNC_ATTEMPTS is excluded from the retry query entirely', async () => {
      const dbLink = links.find((l) => l.id === exhausted.id)!;
      assert.equal(dbLink.attempts, 5, 'must not be picked up again once attempts reached the max');
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
