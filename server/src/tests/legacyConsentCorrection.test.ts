/**
 * legacyConsentCorrection.test.ts — KVKK-HIGH-008: audited legacy consent
 * correction workflow (Patient.smsOptOut).
 *
 * Mirrors the pattern in communicationPreferencesRoute.test.ts: route
 * handlers/middleware chains are extracted directly from the router's
 * internal stack and invoked against the real disposable Postgres database —
 * no supertest/live-server dependency, no mocked Prisma.
 *
 * Run with: tsx src/tests/legacyConsentCorrection.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../db.js';
import communicationPreferencesRouter from '../routes/communicationPreferences.js';
import { setCommunicationPreference } from '../services/communicationConsent/communicationConsentAdmin.js';
import {
  correctSmsOptOut,
  LegacyConsentCorrectionError,
} from '../services/communicationConsent/legacyConsentCorrection.js';
import type { AuthRequest } from '../middleware/auth.js';
import type { Response } from 'express';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

type RouterLike = { stack: Array<any> };

function getRouteMiddlewareChain(router: RouterLike, method: 'get' | 'put' | 'post', path: string) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods?.[method]) {
      return layer.route.stack.map((s: any) => s.handle);
    }
  }
  throw new Error(`No route handler found for ${method.toUpperCase()} ${path}`);
}

async function runChain(chain: Array<(req: AuthRequest, res: Response, next: () => void) => void | Promise<void>>, req: AuthRequest, res: Response): Promise<void> {
  for (const fn of chain) {
    let calledNext = false;
    await fn(req, res, () => { calledNext = true; });
    if (!calledNext) return;
  }
}

function mockResponse(): Response & { statusCode: number; body: any } {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

function authRequest(overrides: Partial<NonNullable<AuthRequest['user']>>, params: Record<string, string>, query: Record<string, string> = {}, body: Record<string, unknown> = {}): AuthRequest {
  return {
    params,
    query,
    body,
    headers: {},
    user: {
      id: randomUUID(),
      clinicId: '',
      role: 'OWNER',
      normalizedRole: 'OWNER',
      organizationId: '',
      allowedClinicIds: [],
      canAccessAllClinics: true,
      ...overrides,
    },
  } as unknown as AuthRequest;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

type Fixture = { organizationId: string; clinicId: string; otherClinicId: string; patientId: string; userId: string };
const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

async function createFixture(opts: { smsOptOut?: boolean } = {}): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: `Legacy Correction Org ${suffix}`, slug: `legacy-corr-${suffix}` } });
  const clinic = await prisma.clinic.create({ data: { name: 'Home Clinic', slug: `legacy-home-${suffix}`, organizationId: org.id } });
  const otherClinic = await prisma.clinic.create({ data: { name: 'Other Clinic', slug: `legacy-other-${suffix}`, organizationId: org.id } });
  const patient = await prisma.patient.create({
    data: {
      // Deliberately not "Legacy"/anything resembling the AuditLog action
      // wording (e.g. "patient_legacy_sms_opt_out_corrected") — the PII test
      // below asserts the patient's name is absent from AuditLog, and a name
      // that overlaps with the product's own audit-action vocabulary would
      // produce a false positive.
      firstName: 'Aylin', lastName: 'Demir', clinicId: clinic.id, organizationId: org.id,
      phone: '+905551119900', smsOptOut: opts.smsOptOut ?? true,
    },
  });
  const user = await prisma.user.create({
    data: {
      firstName: 'Manager', lastName: 'User', email: `manager-${suffix}@example.test`,
      passwordHash: 'x', role: 'CLINIC_MANAGER', clinicId: clinic.id, organizationId: org.id,
    },
  });
  createdOrgIds.push(org.id);
  createdUserIds.push(user.id);
  return { organizationId: org.id, clinicId: clinic.id, otherClinicId: otherClinic.id, patientId: patient.id, userId: user.id };
}

function correctionBody(overrides: Record<string, unknown> = {}) {
  return {
    correctionReason: 'Patient called and confirmed they never opted out; legacy import mis-set this flag.',
    notes: 'Verified by phone on 2026-07-18, patient ID confirmed via DOB + last name.',
    evidenceType: 'patient_verbal_confirmation',
    expectedCurrentValue: true,
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

async function cleanup() {
  if (createdOrgIds.length === 0) return;
  // Fire-and-forget ActivityLog writes (see fireAndForgetActivityLog) can
  // still be in flight when a test finishes — give them a moment before
  // deleting the patients they reference, then delete ActivityLog rows
  // before Patient rows (FK).
  await new Promise((resolve) => setTimeout(resolve, 200));
  await prisma.activityLog.deleteMany({ where: { patient: { organizationId: { in: createdOrgIds } } } });
  await prisma.patientLegacyConsentCorrection.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.communicationConsentConflictBucket.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.patientCommunicationConsentEvent.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.patientCommunicationPreference.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.patient.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.clinic.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
}

async function main() {
  section('1. Authorization matrix — POST legacy-corrections/sms-opt-out');

  for (const role of ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER'] as const) {
    await test(`${role} is allowed to submit a correction`, async () => {
      const fx = await createFixture();
      const chain = getRouteMiddlewareChain(communicationPreferencesRouter, 'post', '/patients/:patientId/communication-preferences/legacy-corrections/sms-opt-out');
      const req = authRequest({ id: fx.userId, role, organizationId: fx.organizationId, allowedClinicIds: [fx.clinicId] }, { patientId: fx.patientId }, {}, correctionBody());
      const res = mockResponse();
      await runChain(chain, req, res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.equal(res.body.correction.newValue, false);
      for (const forbiddenKey of ['requestFingerprint', 'idempotencyKey']) {
        assert.equal(res.body.correction[forbiddenKey], undefined, `POST create response must never include ${forbiddenKey}`);
      }
    });
  }

  for (const role of ['RECEPTIONIST', 'DENTIST', 'BILLING'] as const) {
    await test(`${role} is denied (403), no mutation occurs`, async () => {
      const fx = await createFixture();
      const chain = getRouteMiddlewareChain(communicationPreferencesRouter, 'post', '/patients/:patientId/communication-preferences/legacy-corrections/sms-opt-out');
      const req = authRequest({ id: fx.userId, role, organizationId: fx.organizationId, allowedClinicIds: [fx.clinicId], canAccessAllClinics: false }, { patientId: fx.patientId }, {}, correctionBody());
      const res = mockResponse();
      await runChain(chain, req, res);
      assert.equal(res.statusCode, 403);
      const patient = await prisma.patient.findUnique({ where: { id: fx.patientId } });
      assert.equal(patient!.smsOptOut, true, 'denied role must never flip smsOptOut');
    });
  }

  await test('a management-role user from a different organization is denied — 404, no existence signal, no mutation, exact key/fingerprint replayed', async () => {
    const fx = await createFixture();
    const body = correctionBody();

    // Establish a real correction under the legitimate org first, so the
    // idempotencyKey genuinely exists in the correction table.
    const chain = getRouteMiddlewareChain(communicationPreferencesRouter, 'post', '/patients/:patientId/communication-preferences/legacy-corrections/sms-opt-out');
    const legitReq = authRequest({ id: fx.userId, role: 'OWNER', organizationId: fx.organizationId, allowedClinicIds: [fx.clinicId] }, { patientId: fx.patientId }, {}, body);
    const legitRes = mockResponse();
    await runChain(chain, legitReq, legitRes);
    assert.equal(legitRes.statusCode, 200);

    const otherOrg = await prisma.organization.create({ data: { name: 'Cross Org Attacker', slug: `cross-org-${randomUUID().slice(0, 8)}` } });
    createdOrgIds.push(otherOrg.id);

    const req = authRequest({ role: 'OWNER', organizationId: otherOrg.id, allowedClinicIds: [] }, { patientId: fx.patientId }, {}, body);
    const res = mockResponse();
    await runChain(chain, req, res);
    assert.equal(res.statusCode, 404, 'rejected at loadScopedPatient, before any legacy-correction table query executes');
    assert.equal(res.body?.replay, undefined, 'must never receive the prior success payload');
    assert.equal(res.body?.correction, undefined, 'must never receive any existence signal about the correction');
  });

  await test('same organization but an inaccessible clinic is denied (403), no existence signal', async () => {
    const fx = await createFixture();
    const body = correctionBody();
    const chain = getRouteMiddlewareChain(communicationPreferencesRouter, 'post', '/patients/:patientId/communication-preferences/legacy-corrections/sms-opt-out');

    const legitReq = authRequest({ id: fx.userId, role: 'OWNER', organizationId: fx.organizationId, allowedClinicIds: [fx.clinicId] }, { patientId: fx.patientId }, {}, body);
    const legitRes = mockResponse();
    await runChain(chain, legitReq, legitRes);
    assert.equal(legitRes.statusCode, 200);

    const req = authRequest({ role: 'CLINIC_MANAGER', organizationId: fx.organizationId, allowedClinicIds: [fx.otherClinicId], canAccessAllClinics: false }, { patientId: fx.patientId }, {}, body);
    const res = mockResponse();
    await runChain(chain, req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body?.replay, undefined);
    assert.equal(res.body?.correction, undefined);
  });

  await test('a denied role cannot use replay to bypass authorization — reusing the exact idempotencyKey+payload of an existing correction still gets 403, never a replay success', async () => {
    const fx = await createFixture();
    const body = correctionBody();
    const chain = getRouteMiddlewareChain(communicationPreferencesRouter, 'post', '/patients/:patientId/communication-preferences/legacy-corrections/sms-opt-out');

    const legitReq = authRequest({ id: fx.userId, role: 'OWNER', organizationId: fx.organizationId, allowedClinicIds: [fx.clinicId] }, { patientId: fx.patientId }, {}, body);
    const legitRes = mockResponse();
    await runChain(chain, legitReq, legitRes);
    assert.equal(legitRes.statusCode, 200);
    assert.equal(legitRes.body.replay, false);

    for (const role of ['RECEPTIONIST', 'DENTIST', 'BILLING'] as const) {
      const req = authRequest({ role, organizationId: fx.organizationId, allowedClinicIds: [fx.clinicId], canAccessAllClinics: false }, { patientId: fx.patientId }, {}, body);
      const res = mockResponse();
      await runChain(chain, req, res);
      assert.equal(res.statusCode, 403, `${role} must be denied even when replaying an existing, already-succeeded idempotencyKey+payload`);
      assert.equal(res.body?.replay, undefined, `${role} must never receive replay:true — authorize() runs before any idempotency lookup`);
      assert.equal(res.body?.correction, undefined);
    }
  });

  section('2. Correction behavior');

  await test('active smsOptOut=true can be corrected; previous value + timestamp captured', async () => {
    const fx = await createFixture();
    const priorTimestamp = new Date('2026-01-01T00:00:00.000Z');
    await prisma.patient.update({ where: { id: fx.patientId }, data: { smsOptOutAt: priorTimestamp } });

    const result = await correctSmsOptOut({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      correctionReason: 'Stale legacy import', evidenceType: 'documented_import_error',
      notes: 'Confirmed the 2024 CSV import script incorrectly set this flag for all rows starting with "05".',
      expectedCurrentValue: true, correctedById: fx.userId, idempotencyKey: randomUUID(),
    });

    assert.equal(result.replay, false);
    assert.equal(result.correction.previousValue, true);
    assert.equal(result.correction.newValue, false);
    assert.equal(result.correction.previousRecordedAt?.toISOString(), priorTimestamp.toISOString());

    const patient = await prisma.patient.findUnique({ where: { id: fx.patientId } });
    assert.equal(patient!.smsOptOut, false);
    assert.equal(patient!.smsOptOutAt, null, 'live smsOptOutAt is nulled on correction — historical value lives only in the correction record');
  });

  await test('smsOptOut=false with no prior correction cannot be corrected (legacy_signal_not_present)', async () => {
    const fx = await createFixture({ smsOptOut: false });
    await assert.rejects(
      () => correctSmsOptOut({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        ...correctionBody(), correctedById: fx.userId,
      } as any),
      (err: any) => err instanceof LegacyConsentCorrectionError && err.code === 'legacy_signal_not_present',
    );
  });

  await test('smsOptOut=false after a prior correction cannot be corrected again (legacy_signal_already_corrected)', async () => {
    const fx = await createFixture();
    await correctSmsOptOut({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      ...correctionBody(), correctedById: fx.userId,
    } as any);

    await assert.rejects(
      () => correctSmsOptOut({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        ...correctionBody({ idempotencyKey: randomUUID() }), correctedById: fx.userId,
      } as any),
      (err: any) => err instanceof LegacyConsentCorrectionError && err.code === 'legacy_signal_already_corrected',
    );
  });

  await test('reason is required (service-level guard, independent of zod)', async () => {
    const fx = await createFixture();
    await assert.rejects(
      () => correctSmsOptOut({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        ...correctionBody({ correctionReason: '   ' }), correctedById: fx.userId,
      } as any),
      (err: any) => err instanceof LegacyConsentCorrectionError && err.code === 'correction_reason_required',
    );
  });

  await test('notes are required (service-level guard, independent of zod)', async () => {
    const fx = await createFixture();
    await assert.rejects(
      () => correctSmsOptOut({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        ...correctionBody({ notes: '' }), correctedById: fx.userId,
      } as any),
      (err: any) => err instanceof LegacyConsentCorrectionError && err.code === 'correction_notes_required',
    );
  });

  await test('evidenceType must be one of the closed set (invalid_evidence_type)', async () => {
    const fx = await createFixture();
    await assert.rejects(
      () => correctSmsOptOut({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        ...correctionBody({ evidenceType: 'made_up_type' }), correctedById: fx.userId,
      } as any),
      (err: any) => err instanceof LegacyConsentCorrectionError && err.code === 'invalid_evidence_type',
    );
  });

  await test('no central preference is created and no consent is granted', async () => {
    const fx = await createFixture();
    await correctSmsOptOut({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      ...correctionBody(), correctedById: fx.userId,
    } as any);

    const count = await prisma.patientCommunicationPreference.count({ where: { patientId: fx.patientId } });
    assert.equal(count, 0, 'correction must never create/alter a central PatientCommunicationPreference row');
    const eventCount = await prisma.patientCommunicationConsentEvent.count({ where: { patientId: fx.patientId } });
    assert.equal(eventCount, 0);
  });

  await test('central preference explicitly granted before correction remains completely unchanged', async () => {
    const fx = await createFixture();
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'marketing', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record', notes: 'pre-existing grant',
    });
    const before = await prisma.patientCommunicationPreference.findUnique({
      where: { patientId_clinicId_channel_purpose: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'sms', purpose: 'marketing' } },
    });

    await correctSmsOptOut({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      ...correctionBody(), correctedById: fx.userId,
    } as any);

    const after = await prisma.patientCommunicationPreference.findUnique({
      where: { patientId_clinicId_channel_purpose: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'sms', purpose: 'marketing' } },
    });
    assert.deepEqual(after, before, 'the pre-existing central grant must be byte-for-byte unchanged by the legacy correction');
  });

  await test('AuditLog entry is written safely — no notes/reason/patient-name PII in metadata or description', async () => {
    const fx = await createFixture();
    const secretReason = 'UNIQUE-REASON-MARKER-nurcan-ozel-05551234567';
    const patientBefore = await prisma.patient.findUnique({ where: { id: fx.patientId } });
    await correctSmsOptOut({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      ...correctionBody({ correctionReason: 'This patient explicitly requested SMS re-enablement, reason: ' + secretReason }),
      correctedById: fx.userId,
    } as any);

    const log = await prisma.auditLog.findFirst({ where: { organizationId: fx.organizationId, action: 'patient_legacy_sms_opt_out_corrected' } });
    assert.ok(log, 'AuditLog entry must exist');
    assert.equal(log!.entityType, 'Patient');
    assert.equal(log!.entityId, fx.patientId);
    const serialized = JSON.stringify(log!.metadata) + (log!.description ?? '');
    assert.ok(!serialized.includes(secretReason), 'AuditLog must never contain the free-text correction reason');
    assert.ok(!serialized.includes(patientBefore!.firstName), 'AuditLog must never contain the patient first name');
    assert.ok(!serialized.includes(patientBefore!.lastName), 'AuditLog must never contain the patient last name');
    assert.ok(!(log!.metadata as any)?.patientId, 'patientId must not be duplicated into metadata — entityId already carries it');
  });

  await test('matrix legacy_central_conflict disappears after correction; historical conflict bucket remains', async () => {
    const fx = await createFixture();
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'marketing', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record', notes: 'x',
    });
    await prisma.communicationConsentConflictBucket.create({
      data: {
        organizationId: fx.organizationId, clinicId: fx.clinicId, channel: 'sms', purpose: 'marketing',
        reasonCode: 'legacy_central_conflict', bucketStartedAt: new Date('2026-07-19T10:00:00.000Z'),
        firstDetectedAt: new Date('2026-07-19T10:05:00.000Z'), lastDetectedAt: new Date('2026-07-19T10:05:00.000Z'),
      },
    });

    const matrixHandler = getRouteMiddlewareChain(communicationPreferencesRouter, 'get', '/patients/:patientId/communication-preferences');
    const beforeReq = authRequest({ organizationId: fx.organizationId, allowedClinicIds: [fx.clinicId] }, { patientId: fx.patientId });
    const beforeRes = mockResponse();
    await runChain(matrixHandler, beforeReq, beforeRes);
    const beforeCell = beforeRes.body.matrix.find((m: any) => m.channel === 'sms' && m.purpose === 'marketing');
    assert.equal(beforeCell.legacyConflict?.detected, true);

    await correctSmsOptOut({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      ...correctionBody(), correctedById: fx.userId,
    } as any);

    const afterReq = authRequest({ organizationId: fx.organizationId, allowedClinicIds: [fx.clinicId] }, { patientId: fx.patientId });
    const afterRes = mockResponse();
    await runChain(matrixHandler, afterReq, afterRes);
    const afterCell = afterRes.body.matrix.find((m: any) => m.channel === 'sms' && m.purpose === 'marketing');
    assert.equal(afterCell.legacyConflict, null, 'legacy_central_conflict must disappear once the legacy field is corrected');

    const bucket = await prisma.communicationConsentConflictBucket.findFirst({ where: { organizationId: fx.organizationId, clinicId: fx.clinicId, reasonCode: 'legacy_central_conflict' } });
    assert.ok(bucket, 'historical conflict bucket must remain available for audit reporting — never deleted by a correction');
  });

  section('3. Idempotency + concurrency (real Postgres, not mocked)');

  await test('duplicate request with the same idempotencyKey + same payload returns the original safe result', async () => {
    const fx = await createFixture();
    const body = correctionBody();
    const first = await correctSmsOptOut({ organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, ...body, correctedById: fx.userId } as any);
    const second = await correctSmsOptOut({ organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, ...body, correctedById: fx.userId } as any);
    assert.equal(first.replay, false);
    assert.equal(second.replay, true);
    assert.equal(second.correction.id, first.correction.id);
    for (const forbiddenKey of ['requestFingerprint', 'idempotencyKey']) {
      assert.equal((first.correction as any)[forbiddenKey], undefined, `create result must never include ${forbiddenKey}`);
      assert.equal((second.correction as any)[forbiddenKey], undefined, `replay result must never include ${forbiddenKey}`);
    }

    const count = await prisma.patientLegacyConsentCorrection.count({ where: { patientId: fx.patientId } });
    assert.equal(count, 1, 'exactly one immutable correction row, regardless of the duplicate submission');
  });

  await test('HTTP-level replay: POSTing the same idempotencyKey+payload twice returns replay:true on the second call, neither response ever includes requestFingerprint/idempotencyKey', async () => {
    const fx = await createFixture();
    const body = correctionBody();
    const chain = getRouteMiddlewareChain(communicationPreferencesRouter, 'post', '/patients/:patientId/communication-preferences/legacy-corrections/sms-opt-out');

    const firstReq = authRequest({ id: fx.userId, role: 'OWNER', organizationId: fx.organizationId, allowedClinicIds: [fx.clinicId] }, { patientId: fx.patientId }, {}, body);
    const firstRes = mockResponse();
    await runChain(chain, firstReq, firstRes);
    assert.equal(firstRes.statusCode, 200);
    assert.equal(firstRes.body.replay, false);

    const secondReq = authRequest({ id: fx.userId, role: 'OWNER', organizationId: fx.organizationId, allowedClinicIds: [fx.clinicId] }, { patientId: fx.patientId }, {}, body);
    const secondRes = mockResponse();
    await runChain(chain, secondReq, secondRes);
    assert.equal(secondRes.statusCode, 200);
    assert.equal(secondRes.body.replay, true);
    assert.equal(secondRes.body.correction.id, firstRes.body.correction.id);

    for (const res of [firstRes, secondRes]) {
      for (const forbiddenKey of ['requestFingerprint', 'idempotencyKey']) {
        assert.equal(res.body.correction[forbiddenKey], undefined, `HTTP response must never include ${forbiddenKey}`);
      }
    }
  });

  await test('same idempotencyKey with different payload is rejected (idempotency_conflict)', async () => {
    const fx = await createFixture();
    const key = randomUUID();
    await correctSmsOptOut({ organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, ...correctionBody({ idempotencyKey: key }), correctedById: fx.userId } as any);

    await assert.rejects(
      () => correctSmsOptOut({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        ...correctionBody({ idempotencyKey: key, notes: 'A completely different justification text.' }),
        correctedById: fx.userId,
      } as any),
      (err: any) => err instanceof LegacyConsentCorrectionError && err.code === 'idempotency_conflict',
    );
  });

  await test('two concurrent requests with DIFFERENT idempotency keys for the same patient: exactly one succeeds, the loser gets a definitive rejection (never a lost update)', async () => {
    const fx = await createFixture();
    const [a, b] = await Promise.allSettled([
      correctSmsOptOut({ organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, ...correctionBody({ idempotencyKey: randomUUID() }), correctedById: fx.userId } as any),
      correctSmsOptOut({ organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, ...correctionBody({ idempotencyKey: randomUUID() }), correctedById: fx.userId } as any),
    ]);

    const outcomes = [a, b];
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const rejected = outcomes.filter((o) => o.status === 'rejected') as PromiseRejectedResult[];
    assert.equal(fulfilled.length, 1, 'exactly one request must succeed');
    assert.equal(rejected.length, 1, 'exactly one request must be rejected');
    // Depending on exact timing, the loser is caught either by the guarded
    // updateMany (stale_legacy_signal_state — it read smsOptOut=true, then
    // lost the race) or, if it started late enough to read the row AFTER the
    // winner's commit, by the smsOptOut!==true branch
    // (legacy_signal_already_corrected). Both are correct, safe outcomes of
    // the same race — never a lost update, never a double correction.
    const code = rejected[0].reason instanceof LegacyConsentCorrectionError ? rejected[0].reason.code : null;
    assert.ok(
      code === 'stale_legacy_signal_state' || code === 'legacy_signal_already_corrected',
      `expected a definitive race-loser rejection, got: ${code} (${rejected[0].reason})`,
    );

    const count = await prisma.patientLegacyConsentCorrection.count({ where: { patientId: fx.patientId } });
    assert.equal(count, 1, 'no lost update — exactly one immutable correction row was written');
    const patient = await prisma.patient.findUnique({ where: { id: fx.patientId } });
    assert.equal(patient!.smsOptOut, false);
  });

  await test('two concurrent requests with the SAME idempotency key + same payload: exactly one correction row, both resolve safely', async () => {
    const fx = await createFixture();
    const body = correctionBody();
    const [a, b] = await Promise.all([
      correctSmsOptOut({ organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, ...body, correctedById: fx.userId } as any),
      correctSmsOptOut({ organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, ...body, correctedById: fx.userId } as any),
    ]);
    assert.equal(a.correction.id, b.correction.id, 'both concurrent callers observe the same single correction row');
    const count = await prisma.patientLegacyConsentCorrection.count({ where: { patientId: fx.patientId } });
    assert.equal(count, 1);
  });

  await test('transaction rollback: a downstream constraint failure leaves Patient and correction history unchanged', async () => {
    const fx = await createFixture();
    const bogusUserId = randomUUID(); // not a real User row -> FK violation on correctedById inside the transaction, AFTER the patient updateMany already ran
    await assert.rejects(
      () => correctSmsOptOut({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        ...correctionBody(), correctedById: bogusUserId,
      } as any),
    );

    const patient = await prisma.patient.findUnique({ where: { id: fx.patientId } });
    assert.equal(patient!.smsOptOut, true, 'the updateMany inside the failed transaction must have been rolled back');
    const count = await prisma.patientLegacyConsentCorrection.count({ where: { patientId: fx.patientId } });
    assert.equal(count, 0, 'no correction row survives a rolled-back transaction');
    const auditCount = await prisma.auditLog.count({ where: { organizationId: fx.organizationId, action: 'patient_legacy_sms_opt_out_corrected' } });
    assert.equal(auditCount, 0, 'the AuditLog write is in the same transaction — it rolls back too');
  });

  section('4. History API — pagination, ordering, field allowlist');

  await test('list endpoint returns summary fields only — never correctionReason/notes/sourceReference/requestFingerprint/idempotencyKey', async () => {
    const fx = await createFixture();
    await correctSmsOptOut({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      ...correctionBody({ sourceReference: 'call log #4471' }), correctedById: fx.userId,
    } as any);

    const chain = getRouteMiddlewareChain(communicationPreferencesRouter, 'get', '/patients/:patientId/communication-preferences/legacy-corrections');
    const req = authRequest({ role: 'OWNER', organizationId: fx.organizationId, allowedClinicIds: [fx.clinicId] }, { patientId: fx.patientId });
    const res = mockResponse();
    await runChain(chain, req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.items.length, 1);
    const item = res.body.items[0];
    for (const forbiddenKey of ['correctionReason', 'notes', 'sourceReference', 'requestFingerprint', 'idempotencyKey']) {
      assert.equal(item[forbiddenKey], undefined, `list item must never include ${forbiddenKey}`);
    }
    assert.ok(item.evidenceType);
    assert.ok(item.createdAt);
  });

  await test('detail endpoint returns full free text but still never requestFingerprint/idempotencyKey', async () => {
    const fx = await createFixture();
    const created = await correctSmsOptOut({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      ...correctionBody({ sourceReference: 'call log #4471' }), correctedById: fx.userId,
    } as any);

    const chain = getRouteMiddlewareChain(communicationPreferencesRouter, 'get', '/patients/:patientId/communication-preferences/legacy-corrections/:correctionId');
    const req = authRequest({ role: 'OWNER', organizationId: fx.organizationId, allowedClinicIds: [fx.clinicId] }, { patientId: fx.patientId, correctionId: created.correction.id });
    const res = mockResponse();
    await runChain(chain, req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.correction.correctionReason);
    assert.ok(res.body.correction.notes);
    assert.equal(res.body.correction.sourceReference, 'call log #4471');
    assert.equal(res.body.correction.requestFingerprint, undefined);
    assert.equal(res.body.correction.idempotencyKey, undefined);
  });

  await test('list endpoint pagination + deterministic ordering, no cross-tenant leakage', async () => {
    const fx = await createFixture();
    const otherFx = await createFixture();

    // Directly seed several correction rows (bypassing the one-correction-per-
    // patient constraint of the real workflow) purely to exercise the list
    // endpoint's own query correctness — a distinct concern from the
    // correction workflow itself.
    for (let i = 0; i < 3; i++) {
      await prisma.patientLegacyConsentCorrection.create({
        data: {
          organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
          fieldName: 'SMS_OPT_OUT', previousValue: true, newValue: false,
          correctionReason: `reason ${i}`, evidenceType: 'signed_form', notes: `notes ${i}`,
          correctedById: fx.userId, idempotencyKey: randomUUID(), requestFingerprint: randomUUID(),
        },
      });
    }
    await prisma.patientLegacyConsentCorrection.create({
      data: {
        organizationId: otherFx.organizationId, clinicId: otherFx.clinicId, patientId: otherFx.patientId,
        fieldName: 'SMS_OPT_OUT', previousValue: true, newValue: false,
        correctionReason: 'other tenant', evidenceType: 'signed_form', notes: 'other tenant notes',
        correctedById: otherFx.userId, idempotencyKey: randomUUID(), requestFingerprint: randomUUID(),
      },
    });

    const chain = getRouteMiddlewareChain(communicationPreferencesRouter, 'get', '/patients/:patientId/communication-preferences/legacy-corrections');

    const page1Req = authRequest({ role: 'OWNER', organizationId: fx.organizationId, allowedClinicIds: [fx.clinicId] }, { patientId: fx.patientId }, { limit: '2' });
    const page1Res = mockResponse();
    await runChain(chain, page1Req, page1Res);
    assert.equal(page1Res.body.items.length, 2);
    assert.equal(page1Res.body.pageInfo.hasMore, true);

    const page2Req = authRequest({ role: 'OWNER', organizationId: fx.organizationId, allowedClinicIds: [fx.clinicId] }, { patientId: fx.patientId }, { limit: '2', cursor: page1Res.body.pageInfo.nextCursor });
    const page2Res = mockResponse();
    await runChain(chain, page2Req, page2Res);
    assert.equal(page2Res.body.items.length, 1);
    assert.equal(page2Res.body.pageInfo.hasMore, false);

    const allIds = [...page1Res.body.items, ...page2Res.body.items].map((i: any) => i.id);
    assert.equal(new Set(allIds).size, 3, 'no duplicate/overlapping rows across pages');

    for (let i = 1; i < page1Res.body.items.length; i++) {
      assert.ok(new Date(page1Res.body.items[i - 1].createdAt).getTime() >= new Date(page1Res.body.items[i].createdAt).getTime(), 'deterministic createdAt desc ordering');
    }
  });

  await cleanup();
  await prisma.$disconnect();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exitCode = 1;
});
