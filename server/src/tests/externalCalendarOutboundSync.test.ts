/**
 * externalCalendarOutboundSync.test.ts — Phase 2: wiring the external
 * calendar provider framework into the AppointmentRequest conversion flow.
 *
 * Mocked-Prisma unit tests (same convention as externalCalendarMapping.test.ts
 * and externalCalendarWebhookProcessor.test.ts — prisma's model delegates are
 * swapped for small in-memory fakes, then the real service module is
 * dynamically imported). The provider itself and the notification sender are
 * injected via attemptExternalCalendarSync's/scheduleExternalCalendarSyncOrNotify's
 * `deps` parameter (a test-only seam — production code never passes it),
 * since the real DigiDentiS provider makes genuine HTTP calls with no
 * fetch-injection point at the ExternalCalendarProvider interface level.
 *
 * Run with: npx tsx src/tests/externalCalendarOutboundSync.test.ts
 */

import assert from 'node:assert/strict';
import prisma from '../db.js';
import {
  ExternalCalendarAuthError,
  ExternalCalendarConflictError,
  ExternalCalendarRateLimitedError,
  ExternalCalendarTransientError,
  ExternalCalendarValidationError,
} from '../services/externalCalendar/externalCalendarErrors.js';

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

// ─── In-memory fakes ─────────────────────────────────────────────────────

type IntegrationRow = {
  id: string;
  clinicId: string;
  organizationId: string;
  provider: string;
  enabled: boolean;
  status: string;
  lastError: string | null;
  clientId: string | null;
  clientSecretEncrypted: string | null;
  webhookSecretEncrypted: string | null;
  externalCompanyId: string | null;
  externalClinicId: string | null;
  apiBaseUrl: string | null;
  lastCheckedAt: Date | null;
  lastSuccessfulCheckAt: Date | null;
  webhookReceiverKey: string;
  createdAt: Date;
  updatedAt: Date;
};

type MappingRow = {
  connectionId: string;
  clinicId: string;
  mappingType: 'practitioner' | 'service';
  localId: string;
  externalId: string;
  isActive: boolean;
};

type AppointmentRow = {
  id: string;
  clinicId: string;
  patientId: string;
  practitionerId: string;
  appointmentTypeId: string;
  startTime: Date;
  endTime: Date;
};

type PatientRow = { id: string; firstName: string; lastName: string; phone: string | null; email: string | null };
type PractitionerRow = { id: string; firstName: string; lastName: string };
type AppointmentTypeRow = { id: string; name: string };
type ClinicRow = { id: string; organizationId: string };

type AppointmentRequestRow = {
  id: string;
  convertedAppointmentId: string | null;
  source: string;
  phone: string | null;
  externalSenderId: string | null;
  sourceConnectionId: string | null;
  patientName: string;
};

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

let integrations: IntegrationRow[] = [];
let mappings: MappingRow[] = [];
let appointments: AppointmentRow[] = [];
let patients: PatientRow[] = [];
let practitioners: PractitionerRow[] = [];
let appointmentTypes: AppointmentTypeRow[] = [];
let clinics: ClinicRow[] = [];
let appointmentRequests: AppointmentRequestRow[] = [];
let links: LinkRow[] = [];
let operationalEvents: any[] = [];
let seq = 0;

function resetFixtures() {
  integrations = [];
  mappings = [];
  appointments = [];
  patients = [];
  practitioners = [];
  appointmentTypes = [];
  clinics = [];
  appointmentRequests = [];
  links = [];
  operationalEvents = [];
}

(prisma as any).externalCalendarIntegration = {
  async findUnique({ where }: any) {
    if (where.clinicId !== undefined) return integrations.find((i) => i.clinicId === where.clinicId) ?? null;
    if (where.id !== undefined) return integrations.find((i) => i.id === where.id) ?? null;
    return null;
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
    return (
      mappings.find(
        (m) =>
          m.connectionId === where.connectionId &&
          m.mappingType === where.mappingType &&
          m.localId === where.localId &&
          (where.isActive === undefined || m.isActive === where.isActive),
      ) ?? null
    );
  },
};

(prisma as any).appointment = {
  async findUnique({ where }: any) {
    const appt = appointments.find((a) => a.id === where.id);
    if (!appt) return null;
    const patient = patients.find((p) => p.id === appt.patientId) ?? null;
    const practitioner = practitioners.find((p) => p.id === appt.practitionerId) ?? null;
    const appointmentType = appointmentTypes.find((t) => t.id === appt.appointmentTypeId) ?? null;
    const clinic = clinics.find((c) => c.id === appt.clinicId) ?? null;
    return { ...appt, patient, practitioner, appointmentType, clinic };
  },
};

(prisma as any).appointmentRequest = {
  async findFirst({ where }: any) {
    return appointmentRequests.find((r) => r.convertedAppointmentId === where.convertedAppointmentId) ?? null;
  },
};

(prisma as any).externalCalendarAppointmentLink = {
  async upsert({ where, create, update }: any) {
    const key = where.connectionId_idempotencyKey;
    const existing = links.find((l) => l.connectionId === key.connectionId && l.idempotencyKey === key.idempotencyKey);
    if (existing) {
      Object.assign(existing, update, { updatedAt: new Date() });
      return { ...existing };
    }
    const now = new Date();
    const row: LinkRow = {
      id: `link-${++seq}`,
      connectionId: create.connectionId,
      organizationId: create.organizationId,
      clinicId: create.clinicId,
      appointmentId: create.appointmentId ?? null,
      externalAppointmentId: null,
      idempotencyKey: create.idempotencyKey,
      status: create.status ?? 'pending',
      attempts: 0,
      nextAttemptAt: null,
      lastAttemptAt: null,
      lastSyncedAt: null,
      lastError: null,
      errorCode: null,
      createdAt: now,
      updatedAt: now,
    };
    links.push(row);
    return { ...row };
  },
  async updateMany({ where, data }: any) {
    const now = new Date();
    let count = 0;
    for (const row of links) {
      if (row.id !== where.id) continue;
      if (where.status && !where.status.in.includes(row.status)) continue;
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
      row.updatedAt = now;
      count++;
    }
    return { count };
  },
  async findUnique({ where }: any) {
    const row = links.find((l) => l.id === where.id);
    return row ? { ...row } : null;
  },
  async findFirst({ where }: any) {
    const candidates = links
      .filter((l) => (where.appointmentId === undefined || l.appointmentId === where.appointmentId) && (where.clinicId === undefined || l.clinicId === where.clinicId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return candidates[0] ? { ...candidates[0] } : null;
  },
  async update({ where, data }: any) {
    const row = links.find((l) => l.id === where.id);
    if (!row) throw new Error('not found');
    Object.assign(row, data, { updatedAt: new Date() });
    return { ...row };
  },
};

const {
  attemptExternalCalendarSync,
  claimSyncLinkForAttempt,
  ensurePendingSyncLink,
  requeueSyncLinkForManualRetry,
  scheduleExternalCalendarSyncOrNotify,
  computeOutboundSyncIdempotencyKey,
  classifyExternalCalendarSyncError,
  MAX_SYNC_ATTEMPTS,
} = await import('../services/externalCalendar/externalCalendarOutboundSync.js');

// ─── Fixture builders ────────────────────────────────────────────────────

function makeConnection(clinicId: string, overrides: Partial<IntegrationRow> = {}): IntegrationRow {
  const row: IntegrationRow = {
    id: `conn-${clinicId}`,
    clinicId,
    organizationId: `org-${clinicId}`,
    provider: 'digidentis',
    enabled: true,
    status: 'configured',
    lastError: null,
    clientId: 'client-1',
    clientSecretEncrypted: 'enc:secret',
    webhookSecretEncrypted: 'enc:webhook',
    externalCompanyId: 'company-1',
    externalClinicId: 'ext-clinic-1',
    apiBaseUrl: null,
    lastCheckedAt: null,
    lastSuccessfulCheckAt: null,
    webhookReceiverKey: `webhook-${clinicId}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  integrations.push(row);
  clinics.push({ id: clinicId, organizationId: row.organizationId });
  return row;
}

function mapPractitioner(connectionId: string, clinicId: string, localId: string, externalId = 'ext-doctor-1') {
  mappings.push({ connectionId, clinicId, mappingType: 'practitioner', localId, externalId, isActive: true });
}

function mapService(connectionId: string, clinicId: string, localId: string, externalId = 'ext-treatment-1') {
  mappings.push({ connectionId, clinicId, mappingType: 'service', localId, externalId, isActive: true });
}

function makeAppointment(clinicId: string, overrides: Partial<AppointmentRow> = {}): AppointmentRow {
  const id = overrides.id ?? `appt-${++seq}`;
  const patientId = `patient-${id}`;
  const practitionerId = overrides.practitionerId ?? `doctor-${id}`;
  const appointmentTypeId = overrides.appointmentTypeId ?? `svc-${id}`;
  patients.push({ id: patientId, firstName: 'Ada', lastName: 'Yilmaz', phone: '+905551234567', email: null });
  practitioners.push({ id: practitionerId, firstName: 'Berk', lastName: 'Demir' });
  appointmentTypes.push({ id: appointmentTypeId, name: 'Checkup' });
  const row: AppointmentRow = {
    id,
    clinicId,
    patientId,
    practitionerId,
    appointmentTypeId,
    startTime: new Date('2026-08-03T08:00:00.000Z'),
    endTime: new Date('2026-08-03T08:30:00.000Z'),
    ...overrides,
  };
  appointments.push(row);
  return row;
}

function makeSourceRequest(appointmentId: string, overrides: Partial<AppointmentRequestRow> = {}): AppointmentRequestRow {
  const row: AppointmentRequestRow = {
    id: `req-${++seq}`,
    convertedAppointmentId: appointmentId,
    source: 'manual', // no-op path in sendAppointmentRequestConfirmationNotification if ever invoked for real
    phone: '+905551234567',
    externalSenderId: null,
    sourceConnectionId: null,
    patientName: 'Ada Yilmaz',
    ...overrides,
  };
  appointmentRequests.push(row);
  return row;
}

/** Fake ExternalCalendarProvider — only listAvailableSlots/createAppointment
 *  are exercised by attemptExternalCalendarSync; every other member throws
 *  if unexpectedly called, so a wiring bug that reaches for the wrong method
 *  fails loudly instead of silently no-op'ing. */
function makeFakeProvider(behavior: {
  slots?: Array<{ date: string; startTime: string; endTime: string; externalDoctorId: string }>;
  createResult?: { externalAppointmentId: string; status: string };
  createError?: unknown;
}) {
  const calls = { listAvailableSlots: 0, createAppointment: 0 };
  const notImplemented = () => { throw new Error('unexpected call on test fake provider'); };
  const provider = {
    testConnection: notImplemented,
    listCompanies: notImplemented,
    listClinics: notImplemented,
    listDoctors: notImplemented,
    listTreatmentTypes: notImplemented,
    async listAvailableSlots() {
      calls.listAvailableSlots++;
      return behavior.slots ?? [];
    },
    async createAppointment() {
      calls.createAppointment++;
      if (behavior.createError) throw behavior.createError;
      return behavior.createResult ?? { externalAppointmentId: 'ext-appt-1', status: 'confirmed' };
    },
    cancelAppointment: notImplemented,
    rescheduleAppointment: notImplemented,
    verifyWebhookSignature: notImplemented,
    parseWebhook: notImplemented,
  };
  return { provider, calls };
}

function fakeNotificationSpy() {
  const calls: any[] = [];
  const fn = async (args: any) => { calls.push(args); };
  return { fn: fn as any, calls };
}

function defaultAvailableSlot(appt: AppointmentRow) {
  return { date: '2026-08-03', startTime: '11:00', endTime: '11:30', externalDoctorId: 'ext-doctor-1' };
}

async function main() {
  // ─── 1. No integration enabled — behavior preserved exactly ────────────
  section('1. No integration enabled');
  resetFixtures();
  {
    const clinicId = 'clinic-none';
    const appt = makeAppointment(clinicId);
    const notif = fakeNotificationSpy();

    await test('sends the confirmation notification directly, with the given args, and creates no sync record', async () => {
      await scheduleExternalCalendarSyncOrNotify(
        {
          appointmentId: appt.id,
          clinicId,
          notification: {
            source: 'whatsapp',
            phone: '+905550000000',
            externalSenderId: null,
            sourceConnectionId: null,
            patientName: 'Test Patient',
            organizationId: 'org-x',
            patientId: appt.patientId,
            appointment: { startTime: appt.startTime, appointmentType: { name: 'Checkup' }, practitioner: { firstName: 'Berk', lastName: 'Demir' } },
          },
        },
        { sendConfirmation: notif.fn },
      );
      assert.equal(notif.calls.length, 1);
      assert.equal(notif.calls[0].clinicId, clinicId);
      assert.equal(notif.calls[0].source, 'whatsapp');
      assert.equal(links.filter((l) => l.clinicId === clinicId).length, 0, 'no ExternalCalendarAppointmentLink should be created when no integration is enabled');
    });
  }

  // ─── 2. Enabled integration — success ───────────────────────────────────
  section('2. Enabled integration, successful sync');
  resetFixtures();
  {
    const clinicId = 'clinic-success';
    const conn = makeConnection(clinicId);
    const appt = makeAppointment(clinicId);
    mapPractitioner(conn.id, clinicId, appt.practitionerId);
    mapService(conn.id, clinicId, appt.appointmentTypeId);
    makeSourceRequest(appt.id);
    const notif = fakeNotificationSpy();
    const { provider, calls } = makeFakeProvider({
      slots: [defaultAvailableSlot(appt)],
      createResult: { externalAppointmentId: 'ext-appt-success-1', status: 'confirmed' },
    });

    await test('creates a pending link, recheck slots, creates externally, marks synced, and sends the confirmation', async () => {
      await scheduleExternalCalendarSyncOrNotify(
        {
          appointmentId: appt.id,
          clinicId,
          notification: { source: 'manual', phone: null, externalSenderId: null, sourceConnectionId: null, patientName: 'x', organizationId: 'org-x', patientId: appt.patientId, appointment: { startTime: appt.startTime, appointmentType: { name: 'x' }, practitioner: { firstName: 'x', lastName: 'x' } } },
        },
        { getProvider: () => provider as any, sendConfirmation: notif.fn },
      );

      const link = links.find((l) => l.appointmentId === appt.id)!;
      assert.ok(link, 'a link row must exist');
      assert.equal(link.status, 'synced');
      assert.equal(link.externalAppointmentId, 'ext-appt-success-1');
      assert.equal(link.attempts, 1);
      assert.equal(calls.listAvailableSlots, 1, 'must recheck the slot immediately before create');
      assert.equal(calls.createAppointment, 1);
      assert.equal(notif.calls.length, 1, 'confirmation must be sent exactly once, only after sync succeeds');
    });
  }

  // ─── 3. Missing practitioner mapping ─────────────────────────────────────
  section('3. Missing practitioner mapping');
  resetFixtures();
  {
    const clinicId = 'clinic-no-prac-map';
    const conn = makeConnection(clinicId);
    const appt = makeAppointment(clinicId);
    mapService(conn.id, clinicId, appt.appointmentTypeId); // service mapped, practitioner is NOT
    const { provider, calls } = makeFakeProvider({});
    const link = await ensurePendingSyncLink({ connection: conn as any, appointmentId: appt.id, clinicId });

    await test('classifies as failed_terminal / MAPPING_MISSING and never calls the provider', async () => {
      const result = await attemptExternalCalendarSync(link.id, { getProvider: () => provider as any });
      assert.equal(result.outcome, 'failed_terminal');
      assert.equal(result.errorCode, 'MAPPING_MISSING');
      assert.equal(calls.listAvailableSlots, 0);
      assert.equal(calls.createAppointment, 0);
      const dbLink = links.find((l) => l.id === link.id)!;
      assert.equal(dbLink.status, 'failed_terminal');
      assert.ok(dbLink.lastError && !dbLink.lastError.includes('secret'), 'error message must not leak secrets');
    });
  }

  // ─── 4. Missing service mapping ──────────────────────────────────────────
  section('4. Missing service mapping');
  resetFixtures();
  {
    const clinicId = 'clinic-no-svc-map';
    const conn = makeConnection(clinicId);
    const appt = makeAppointment(clinicId);
    mapPractitioner(conn.id, clinicId, appt.practitionerId); // practitioner mapped, service is NOT
    const { provider, calls } = makeFakeProvider({});
    const link = await ensurePendingSyncLink({ connection: conn as any, appointmentId: appt.id, clinicId });

    await test('classifies as failed_terminal / MAPPING_MISSING and never calls the provider', async () => {
      const result = await attemptExternalCalendarSync(link.id, { getProvider: () => provider as any });
      assert.equal(result.outcome, 'failed_terminal');
      assert.equal(calls.createAppointment, 0);
    });
  }

  // ─── 5. Unavailable external slot (recheck) ─────────────────────────────
  section('5. Provider slot no longer available on recheck');
  resetFixtures();
  {
    const clinicId = 'clinic-slot-gone';
    const conn = makeConnection(clinicId);
    const appt = makeAppointment(clinicId);
    mapPractitioner(conn.id, clinicId, appt.practitionerId);
    mapService(conn.id, clinicId, appt.appointmentTypeId);
    const { provider, calls } = makeFakeProvider({ slots: [] }); // recheck returns nothing
    const link = await ensurePendingSyncLink({ connection: conn as any, appointmentId: appt.id, clinicId });

    await test('classifies as failed_terminal / SLOT_NOT_AVAILABLE and never calls createAppointment', async () => {
      const result = await attemptExternalCalendarSync(link.id, { getProvider: () => provider as any });
      assert.equal(result.outcome, 'failed_terminal');
      if ('errorCode' in result) assert.equal(result.errorCode, 'SLOT_NOT_AVAILABLE');
      assert.equal(calls.createAppointment, 0, 'must never create when the recheck shows the slot is gone');
    });
  }

  // ─── 6. Provider auth failure ────────────────────────────────────────────
  section('6. Provider authentication failure');
  resetFixtures();
  {
    const clinicId = 'clinic-auth-fail';
    const conn = makeConnection(clinicId);
    const appt = makeAppointment(clinicId);
    mapPractitioner(conn.id, clinicId, appt.practitionerId);
    mapService(conn.id, clinicId, appt.appointmentTypeId);
    const { provider } = makeFakeProvider({
      slots: [defaultAvailableSlot(appt)],
      createError: new ExternalCalendarAuthError('DigiDentiS', 'bad token'),
    });
    const link = await ensurePendingSyncLink({ connection: conn as any, appointmentId: appt.id, clinicId });

    await test('classifies as failed_terminal / AUTH_ERROR (never retried automatically)', async () => {
      const result = await attemptExternalCalendarSync(link.id, { getProvider: () => provider as any });
      assert.equal(result.outcome, 'failed_terminal');
      if ('errorCode' in result) assert.equal(result.errorCode, 'AUTH_ERROR');
    });
  }

  // ─── 7. Provider validation failure ──────────────────────────────────────
  section('7. Provider validation failure');
  resetFixtures();
  {
    const clinicId = 'clinic-validation-fail';
    const conn = makeConnection(clinicId);
    const appt = makeAppointment(clinicId);
    mapPractitioner(conn.id, clinicId, appt.practitionerId);
    mapService(conn.id, clinicId, appt.appointmentTypeId);
    const { provider } = makeFakeProvider({
      slots: [defaultAvailableSlot(appt)],
      createError: new ExternalCalendarValidationError('DigiDentiS', 422, 'bad payload', 'INVALID_FIELD'),
    });
    const link = await ensurePendingSyncLink({ connection: conn as any, appointmentId: appt.id, clinicId });

    await test('classifies as failed_terminal / VALIDATION_ERROR', async () => {
      const result = await attemptExternalCalendarSync(link.id, { getProvider: () => provider as any });
      assert.equal(result.outcome, 'failed_terminal');
      if ('errorCode' in result) assert.equal(result.errorCode, 'VALIDATION_ERROR');
    });
  }

  // ─── 8. Transient / 429 / 5xx are retryable ──────────────────────────────
  section('8. Transient network / 429 / 5xx failures are retryable');
  resetFixtures();
  {
    const clinicId = 'clinic-transient';
    const conn = makeConnection(clinicId);

    await test('ExternalCalendarTransientError -> failed_retryable with a future nextAttemptAt', async () => {
      const appt = makeAppointment(clinicId);
      mapPractitioner(conn.id, clinicId, appt.practitionerId);
      mapService(conn.id, clinicId, appt.appointmentTypeId);
      const { provider } = makeFakeProvider({ slots: [defaultAvailableSlot(appt)], createError: new ExternalCalendarTransientError('DigiDentiS', 503, 'down') });
      const link = await ensurePendingSyncLink({ connection: conn as any, appointmentId: appt.id, clinicId });
      const result = await attemptExternalCalendarSync(link.id, { getProvider: () => provider as any });
      assert.equal(result.outcome, 'failed_retryable');
      const dbLink = links.find((l) => l.id === link.id)!;
      assert.ok(dbLink.nextAttemptAt && dbLink.nextAttemptAt.getTime() > Date.now(), 'backoff must schedule a future retry');
    });

    await test('ExternalCalendarRateLimitedError (429) -> failed_retryable', async () => {
      const appt = makeAppointment(clinicId);
      mapPractitioner(conn.id, clinicId, appt.practitionerId);
      mapService(conn.id, clinicId, appt.appointmentTypeId);
      const { provider } = makeFakeProvider({ slots: [defaultAvailableSlot(appt)], createError: new ExternalCalendarRateLimitedError('DigiDentiS', 2000) });
      const link = await ensurePendingSyncLink({ connection: conn as any, appointmentId: appt.id, clinicId });
      const result = await attemptExternalCalendarSync(link.id, { getProvider: () => provider as any });
      assert.equal(result.outcome, 'failed_retryable');
      if ('errorCode' in result) assert.equal(result.errorCode, 'RATE_LIMITED');
    });

    await test('a genuine conflict (non-SLOT_NOT_AVAILABLE) is classified terminal, not retried blindly', async () => {
      const appt = makeAppointment(clinicId);
      mapPractitioner(conn.id, clinicId, appt.practitionerId);
      mapService(conn.id, clinicId, appt.appointmentTypeId);
      const { provider } = makeFakeProvider({ slots: [defaultAvailableSlot(appt)], createError: new ExternalCalendarConflictError('DigiDentiS', 'SLOT_IN_PAST', 'too late') });
      const link = await ensurePendingSyncLink({ connection: conn as any, appointmentId: appt.id, clinicId });
      const result = await attemptExternalCalendarSync(link.id, { getProvider: () => provider as any });
      assert.equal(result.outcome, 'failed_terminal');
    });
  }

  // ─── 9. Successful automatic retry ───────────────────────────────────────
  section('9. Successful automatic retry after a transient failure');
  resetFixtures();
  {
    const clinicId = 'clinic-retry-success';
    const conn = makeConnection(clinicId);
    const appt = makeAppointment(clinicId);
    mapPractitioner(conn.id, clinicId, appt.practitionerId);
    mapService(conn.id, clinicId, appt.appointmentTypeId);
    const link = await ensurePendingSyncLink({ connection: conn as any, appointmentId: appt.id, clinicId });

    await test('first attempt fails transiently, second (simulated retry-job) attempt succeeds', async () => {
      const failing = makeFakeProvider({ slots: [defaultAvailableSlot(appt)], createError: new ExternalCalendarTransientError('DigiDentiS', 500) });
      const first = await attemptExternalCalendarSync(link.id, { getProvider: () => failing.provider as any });
      assert.equal(first.outcome, 'failed_retryable');

      // Retry job would normally wait for nextAttemptAt; force it due now to simulate the backoff having elapsed.
      const dbLink = links.find((l) => l.id === link.id)!;
      dbLink.nextAttemptAt = new Date(Date.now() - 1000);

      const succeeding = makeFakeProvider({ slots: [defaultAvailableSlot(appt)], createResult: { externalAppointmentId: 'ext-appt-retry-1', status: 'confirmed' } });
      const second = await attemptExternalCalendarSync(link.id, { getProvider: () => succeeding.provider as any });
      assert.equal(second.outcome, 'synced');
      assert.equal(dbLink.attempts, 2, 'attempts must accumulate across tries');
      assert.equal(dbLink.status, 'synced');
    });
  }

  // ─── 10. Retry exhaustion ─────────────────────────────────────────────────
  section('10. Retry exhaustion after MAX_SYNC_ATTEMPTS');
  resetFixtures();
  {
    const clinicId = 'clinic-exhaust';
    const conn = makeConnection(clinicId);
    const appt = makeAppointment(clinicId);
    mapPractitioner(conn.id, clinicId, appt.practitionerId);
    mapService(conn.id, clinicId, appt.appointmentTypeId);
    const link = await ensurePendingSyncLink({ connection: conn as any, appointmentId: appt.id, clinicId });

    await test(`after ${MAX_SYNC_ATTEMPTS} transient failures the row becomes failed_terminal`, async () => {
      let lastResult;
      for (let i = 0; i < MAX_SYNC_ATTEMPTS; i++) {
        const dbLink = links.find((l) => l.id === link.id)!;
        dbLink.nextAttemptAt = null; // always due
        const { provider } = makeFakeProvider({ slots: [defaultAvailableSlot(appt)], createError: new ExternalCalendarTransientError('DigiDentiS', 500) });
        lastResult = await attemptExternalCalendarSync(link.id, { getProvider: () => provider as any });
      }
      assert.equal(lastResult!.outcome, 'failed_terminal', 'the final attempt must be reclassified as terminal once attempts are exhausted');
      const dbLink = links.find((l) => l.id === link.id)!;
      assert.equal(dbLink.attempts, MAX_SYNC_ATTEMPTS);
      assert.ok(dbLink.lastError?.includes('exhausted'));
      assert.equal(dbLink.nextAttemptAt, null, 'a terminal row must not be scheduled for further automatic retry');
    });
  }

  // ─── 11. Concurrent worker/manual retry claim ────────────────────────────
  section('11. Concurrent claim safety (worker vs. manual retry)');
  resetFixtures();
  {
    const clinicId = 'clinic-concurrent-claim';
    const conn = makeConnection(clinicId);
    const appt = makeAppointment(clinicId);
    mapPractitioner(conn.id, clinicId, appt.practitionerId);
    mapService(conn.id, clinicId, appt.appointmentTypeId);
    const link = await ensurePendingSyncLink({ connection: conn as any, appointmentId: appt.id, clinicId });

    await test('exactly one of two concurrent claims on the same pending row succeeds', async () => {
      const [a, b] = await Promise.all([claimSyncLinkForAttempt(link.id), claimSyncLinkForAttempt(link.id)]);
      const claimedCount = [a, b].filter((r) => r !== null).length;
      assert.equal(claimedCount, 1, 'exactly one caller must claim the row — no double-processing');
      const dbLink = links.find((l) => l.id === link.id)!;
      assert.equal(dbLink.attempts, 1, 'attempts must only increment once, not twice');
      assert.equal(dbLink.status, 'syncing');
    });

    await test('once syncing, a manual-retry requeue attempt cannot resurrect it mid-flight', async () => {
      const { requeued } = await requeueSyncLinkForManualRetry(link.id);
      assert.equal(requeued, false, 'a row already claimed into syncing must not be requeued to pending underneath the in-flight attempt');
    });
  }

  // ─── 12. Repeated AppointmentRequest conversion is idempotent ────────────
  section('12. Repeated conversion / repeated ensurePendingSyncLink calls are idempotent');
  resetFixtures();
  {
    const clinicId = 'clinic-idempotent';
    const conn = makeConnection(clinicId);
    const appt = makeAppointment(clinicId);
    mapPractitioner(conn.id, clinicId, appt.practitionerId);
    mapService(conn.id, clinicId, appt.appointmentTypeId);

    await test('two ensurePendingSyncLink calls for the same appointment resolve to the SAME row, never a second pending record', async () => {
      const first = await ensurePendingSyncLink({ connection: conn as any, appointmentId: appt.id, clinicId });
      const second = await ensurePendingSyncLink({ connection: conn as any, appointmentId: appt.id, clinicId });
      assert.equal(first.id, second.id);
      assert.equal(links.filter((l) => l.appointmentId === appt.id).length, 1);
      assert.equal(first.idempotencyKey, computeOutboundSyncIdempotencyKey(appt.id));
    });

    await test('re-calling ensurePendingSyncLink after the row is already synced never resets it back to pending', async () => {
      const link = links.find((l) => l.appointmentId === appt.id)!;
      link.status = 'synced';
      link.externalAppointmentId = 'ext-appt-already-synced';
      await ensurePendingSyncLink({ connection: conn as any, appointmentId: appt.id, clinicId });
      const dbLink = links.find((l) => l.id === link.id)!;
      assert.equal(dbLink.status, 'synced', 'a repeated conversion request must not reset an already-synced record');
      assert.equal(dbLink.externalAppointmentId, 'ext-appt-already-synced');
    });
  }

  // ─── 13. Patient confirmation gating ─────────────────────────────────────
  section('13. Patient confirmation is gated on synchronization success');
  resetFixtures();
  {
    const clinicId = 'clinic-gating';
    const conn = makeConnection(clinicId);
    const appt = makeAppointment(clinicId);
    mapPractitioner(conn.id, clinicId, appt.practitionerId);
    mapService(conn.id, clinicId, appt.appointmentTypeId);
    makeSourceRequest(appt.id);
    const link = await ensurePendingSyncLink({ connection: conn as any, appointmentId: appt.id, clinicId });

    await test('no confirmation is sent while the sync attempt fails (retryable or terminal)', async () => {
      const notif = fakeNotificationSpy();
      const { provider } = makeFakeProvider({ slots: [defaultAvailableSlot(appt)], createError: new ExternalCalendarTransientError('DigiDentiS', 500) });
      await attemptExternalCalendarSync(link.id, { getProvider: () => provider as any, sendConfirmation: notif.fn });
      assert.equal(notif.calls.length, 0, 'must not notify the patient while sync has not succeeded');
    });

    await test('confirmation is sent exactly once synchronization succeeds', async () => {
      const dbLink = links.find((l) => l.id === link.id)!;
      dbLink.nextAttemptAt = null;
      const notif = fakeNotificationSpy();
      const { provider } = makeFakeProvider({ slots: [defaultAvailableSlot(appt)], createResult: { externalAppointmentId: 'ext-appt-gate-1', status: 'confirmed' } });
      await attemptExternalCalendarSync(link.id, { getProvider: () => provider as any, sendConfirmation: notif.fn });
      assert.equal(notif.calls.length, 1);
    });
  }

  // ─── 14. Tenant isolation ─────────────────────────────────────────────────
  section('14. Tenant isolation — mappings and connections never cross clinics');
  resetFixtures();
  {
    const clinicA = 'clinic-tenant-a';
    const clinicB = 'clinic-tenant-b';
    const connA = makeConnection(clinicA);
    const connB = makeConnection(clinicB);
    const apptA = makeAppointment(clinicA);
    // Deliberately do NOT map apptA's practitioner/service under clinic B's connection.
    mapPractitioner(connB.id, clinicB, apptA.practitionerId, 'ext-doctor-should-not-resolve');
    mapService(connB.id, clinicB, apptA.appointmentTypeId, 'ext-treatment-should-not-resolve');
    const linkA = await ensurePendingSyncLink({ connection: connA as any, appointmentId: apptA.id, clinicId: clinicA });

    await test('an appointment in clinic A cannot resolve a mapping that only exists under clinic B\'s connection', async () => {
      const { provider, calls } = makeFakeProvider({});
      const result = await attemptExternalCalendarSync(linkA.id, { getProvider: () => provider as any });
      assert.equal(result.outcome, 'failed_terminal');
      if ('errorCode' in result) assert.equal(result.errorCode, 'MAPPING_MISSING');
      assert.equal(calls.createAppointment, 0);
    });
  }

  // ─── 15. Integration health degrade/short-circuit/restore ───────────────
  section('15. Auth failure degrades integration health and blocks further provider calls');
  resetFixtures();
  {
    const clinicId = 'clinic-unhealthy';
    const conn = makeConnection(clinicId);
    const apptA = makeAppointment(clinicId);
    const apptB = makeAppointment(clinicId);
    mapPractitioner(conn.id, clinicId, apptA.practitionerId);
    mapService(conn.id, clinicId, apptA.appointmentTypeId);
    mapPractitioner(conn.id, clinicId, apptB.practitionerId);
    mapService(conn.id, clinicId, apptB.appointmentTypeId);
    const linkA = await ensurePendingSyncLink({ connection: conn as any, appointmentId: apptA.id, clinicId });
    const linkB = await ensurePendingSyncLink({ connection: conn as any, appointmentId: apptB.id, clinicId });

    await test('an AUTH_ERROR marks the link failed_terminal, degrades the integration to status=error with a safe lastError, and records an OperationalEvent', async () => {
      const { provider } = makeFakeProvider({
        slots: [defaultAvailableSlot(apptA)],
        createError: new ExternalCalendarAuthError('DigiDentiS', 'bad token'),
      });
      const result = await attemptExternalCalendarSync(linkA.id, { getProvider: () => provider as any });
      assert.equal(result.outcome, 'failed_terminal');
      if ('errorCode' in result) assert.equal(result.errorCode, 'AUTH_ERROR');

      const integration = integrations.find((i) => i.clinicId === clinicId)!;
      assert.equal(integration.status, 'error', 'the integration must be marked unhealthy after an auth failure');
      assert.ok(integration.lastError && !integration.lastError.toLowerCase().includes('secret'), 'lastError must never leak secrets');

      const event = operationalEvents.find((e) => e.metadata?.linkId === linkA.id);
      assert.ok(event, 'a staff-visible OperationalEvent must be recorded for a terminal failure');
      assert.equal(event.severity, 'error');
      assert.equal(event.source, 'external_calendar');
      assert.ok(!JSON.stringify(event).toLowerCase().includes('client-1'), 'OperationalEvent must never include credentials');
    });

    await test('a second, unrelated appointment at the SAME clinic short-circuits as INTEGRATION_UNHEALTHY without calling the provider again', async () => {
      const { provider, calls } = makeFakeProvider({ slots: [defaultAvailableSlot(apptB)] });
      const result = await attemptExternalCalendarSync(linkB.id, { getProvider: () => provider as any });
      assert.equal(result.outcome, 'failed_terminal');
      if ('errorCode' in result) assert.equal(result.errorCode, 'INTEGRATION_UNHEALTHY');
      assert.equal(calls.listAvailableSlots, 0, 'must never call the provider while the integration is marked unhealthy');
      assert.equal(calls.createAppointment, 0);
    });

    await test('restoring the integration (simulating a credential update / successful connection test) unblocks future attempts', async () => {
      const integration = integrations.find((i) => i.clinicId === clinicId)!;
      integration.status = 'configured';
      integration.lastError = null;
      await requeueSyncLinkForManualRetry(linkB.id);

      const { provider, calls } = makeFakeProvider({
        slots: [defaultAvailableSlot(apptB)],
        createResult: { externalAppointmentId: 'ext-appt-restored-1', status: 'confirmed' },
      });
      const result = await attemptExternalCalendarSync(linkB.id, { getProvider: () => provider as any });
      assert.equal(result.outcome, 'synced', 'once the integration is healthy again, the retry must actually call the provider and succeed');
      assert.equal(calls.listAvailableSlots, 1);
      assert.equal(calls.createAppointment, 1);
    });
  }

  // ─── classification unit checks (no DB) ──────────────────────────────────
  section('Error classification');
  await test('unknown/unexpected errors default to retryable (safe default), not silently dropped', () => {
    const classification = classifyExternalCalendarSyncError(new Error('boom'));
    assert.equal(classification.retryable, true);
    assert.equal(classification.errorCode, 'UNKNOWN');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
