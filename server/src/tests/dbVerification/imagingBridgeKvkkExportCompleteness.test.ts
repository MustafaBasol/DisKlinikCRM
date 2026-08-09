/**
 * imagingBridgeKvkkExportCompleteness.test.ts — F2-IMG-AUDIT-003
 *
 * Proves, against a REAL disposable PostgreSQL instance via the real Prisma
 * client and the REAL patientPrivacy.ts export route handler, the KVKK
 * per-patient export completeness fix for bridge-linked imaging (see
 * server/src/services/privacy/patientActivityHistoryExport.ts and
 * docs/program/evidence/F2-IMG-AUDIT-002_MACHINE_ACTOR_ACTIVITYLOG_DECISION.md §11):
 *
 *   1.  A bridge-linked imaging ingest AuditLog event appears in the correct
 *       patient's KVKK export activityHistory.
 *   2.  A same-clinic, different patient's bridge audit event is excluded.
 *   3.  A same-org sibling-clinic patient's bridge audit event is excluded,
 *       including an adversarial check that the clinicId predicate is
 *       load-bearing (not incidental) by querying that patient's own real
 *       id under the wrong clinicId.
 *   4.  A different-organization patient's bridge audit event is excluded,
 *       including the same adversarial organizationId-predicate check.
 *   5.  Manual staff ActivityLog entries remain present alongside bridge
 *       entries (no regression, no table replacement).
 *   6.  Two genuinely distinct duplicate-ingest-detection AuditLog rows for
 *       the same ImagingStudy both survive as distinct entries (the merge
 *       does not naively collapse on entityId+action, which would drop
 *       real evidence), and the projection is deterministic across reruns.
 *   7.  An unrelated AuditLog row (same clinic/org, different action or
 *       entityType) is excluded.
 *   8.  Bridge entries are truthfully labeled `source: 'bridge'` — never a
 *       fabricated/borrowed `User` identity (no userId/user field).
 *   9.  No storageKey/filesystem path/token/raw metadata ever reaches an
 *       exported entry, even when planted on the source AuditLog row.
 *  10.  The export's `activityHistory` shape remains backward compatible
 *       when a patient has zero bridge-linked imaging (staff-only rows,
 *       original field set intact).
 *
 * Run: cd server && npx tsx src/tests/dbVerification/imagingBridgeKvkkExportCompleteness.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres with migrations applied.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import patientPrivacyRouter from '../../routes/patientPrivacy.js';
import {
  collectBridgeImagingActivityForPatient,
  mergePatientActivityHistory,
} from '../../services/privacy/patientActivityHistoryExport.js';
import {
  createSuite,
  getHandlerOnly,
  authRequest,
  createClinicFixtureSet,
  createStaffUser,
  createTestPatient,
  cleanupAllFixtures,
  prisma,
} from './dbVerificationHarness.js';

const { section, test, summary } = createSuite('KVKK Imaging-Bridge Export Completeness (F2-IMG-AUDIT-003)');

// dbVerificationHarness's shared mockResponse() has no setHeader — the real
// /export handler calls res.setHeader() before res.json(), so a local mock
// is used here (same convention as imagingCharacterizationAuthShape.test.ts).
function mockExportResponse() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
  return res as Response & { statusCode: number; body: any; headers: Record<string, string> };
}

const EXPORT_HANDLER = getHandlerOnly(patientPrivacyRouter as any, 'post', '/patients/:id/privacy/export');

async function runExport(patientId: string, user: Parameters<typeof authRequest>[0]) {
  const req = authRequest(user, { params: { id: patientId } });
  const res = mockExportResponse();
  await EXPORT_HANDLER(req, res as unknown as Response, () => {});
  return res;
}

async function createBridgeImagingStudy(params: { clinicId: string; patientId: string | null }) {
  return prisma.imagingStudy.create({
    data: { clinicId: params.clinicId, patientId: params.patientId, modality: 'PX', source: 'bridge', status: 'active' },
  });
}

async function createBridgeAuditRow(params: {
  organizationId: string;
  clinicId: string;
  studyId: string;
  metadata: Record<string, unknown>;
  action?: string;
  entityType?: string;
  createdAt?: Date;
}) {
  return prisma.auditLog.create({
    data: {
      organizationId: params.organizationId,
      clinicId: params.clinicId,
      action: params.action ?? 'imaging_bridge_study_ingested',
      entityType: params.entityType ?? 'imaging_study',
      entityId: params.studyId,
      metadata: params.metadata as any,
      ...(params.createdAt ? { createdAt: params.createdAt } : {}),
    },
  });
}

// ─── Cleanup tracking (AuditLog/ImagingStudy/ActivityLog/PatientPrivacyRequest
// are not covered by dbVerificationHarness's cleanupAllFixtures) ───

const trackedClinicIds: string[] = [];
function trackClinics(...ids: string[]) {
  trackedClinicIds.push(...ids);
}

async function cleanupImagingBridgeFixtures(): Promise<void> {
  if (trackedClinicIds.length === 0) return;
  const clinicId = { in: trackedClinicIds };
  await prisma.patientPrivacyRequest.deleteMany({ where: { clinicId } });
  await prisma.auditLog.deleteMany({ where: { clinicId } });
  await prisma.activityLog.deleteMany({ where: { clinicId } });
  await prisma.imagingStudy.deleteMany({ where: { clinicId } });
}

async function main() {
  try {
    // ═══ 1, 5, 8, 10 — end-to-end export via the real route handler ═══
    section('1, 5, 8, 10: bridge event surfaced, staff ActivityLog preserved, truthful actor, shape backward compatible');
    {
      const fx = await createClinicFixtureSet('f2img3-e2e');
      trackClinics(fx.defaultClinicId);
      const staff = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER' });
      const patient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'BridgeExportTarget' });
      const userOverrides = {
        id: staff.id,
        organizationId: fx.orgId,
        clinicId: fx.defaultClinicId,
        role: 'OWNER',
        canAccessAllClinics: false,
        allowedClinicIds: [fx.defaultClinicId],
      };

      // Backward-compat baseline: only a manual staff ActivityLog row, zero bridge imaging.
      const manualLog = await prisma.activityLog.create({
        data: {
          clinicId: fx.defaultClinicId,
          userId: staff.id,
          entityType: 'imaging_study',
          entityId: randomUUID(),
          patientId: patient.id,
          action: 'create',
          description: 'Görüntüleme çalışması yüklendi (manual)',
        },
      });

      const baseline = await runExport(patient.id, userOverrides);

      await test('10. baseline export (no bridge imaging) contains exactly the manual ActivityLog row with original fields intact', () => {
        assert.equal(baseline.statusCode, 200);
        const history = baseline.body.activityHistory;
        assert.equal(history.length, 1);
        assert.equal(history[0].id, manualLog.id);
        assert.equal(history[0].action, 'create');
        assert.equal(history[0].entityType, 'imaging_study');
        assert.equal(history[0].description, manualLog.description);
        assert.ok('createdAt' in history[0]);
        assert.equal(history[0].source, 'staff');
      });

      const study = await createBridgeImagingStudy({ clinicId: fx.defaultClinicId, patientId: patient.id });
      const bridgeAudit = await createBridgeAuditRow({
        organizationId: fx.orgId,
        clinicId: fx.defaultClinicId,
        studyId: study.id,
        metadata: { deviceId: 'dev-1', modality: 'PX', fileSize: 12345, mimeType: 'image/jpeg', duplicate: false },
      });

      const withBridge = await runExport(patient.id, userOverrides);

      await test('1. bridge-linked imaging ingest event appears in the correct patient export', () => {
        assert.equal(withBridge.statusCode, 200);
        const history = withBridge.body.activityHistory;
        const bridgeEntry = history.find((h: any) => h.id === bridgeAudit.id);
        assert.ok(bridgeEntry, 'bridge AuditLog row must appear in activityHistory');
        assert.equal(bridgeEntry.entityType, 'imaging_study');
        assert.equal(bridgeEntry.action, 'imaging_bridge_study_ingested');
      });

      await test('5. manual staff ActivityLog entry remains present alongside the bridge entry', () => {
        const history = withBridge.body.activityHistory;
        const staffEntry = history.find((h: any) => h.id === manualLog.id);
        assert.ok(staffEntry, 'manual ActivityLog row must still be present');
        assert.equal(staffEntry.source, 'staff');
        assert.equal(history.length, 2, 'exactly staff + bridge, no extra/dropped rows');
      });

      await test('8. bridge entry is truthfully labeled as a machine actor, never a fabricated/borrowed User', () => {
        const history = withBridge.body.activityHistory;
        const bridgeEntry = history.find((h: any) => h.id === bridgeAudit.id);
        assert.equal(bridgeEntry.source, 'bridge');
        assert.ok(!('userId' in bridgeEntry), 'bridge entry must never carry a userId field');
        assert.ok(!('user' in bridgeEntry), 'bridge entry must never carry a user object');
      });
    }

    // ═══ 2 — same clinic, other patient excluded ═══
    section('2: same-clinic other patient excluded');
    {
      const fx = await createClinicFixtureSet('f2img3-sameclinic');
      trackClinics(fx.defaultClinicId);
      const patientA = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'PatientA' });
      const patientB = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'PatientB' });

      const studyA = await createBridgeImagingStudy({ clinicId: fx.defaultClinicId, patientId: patientA.id });
      const studyB = await createBridgeImagingStudy({ clinicId: fx.defaultClinicId, patientId: patientB.id });
      const auditA = await createBridgeAuditRow({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, studyId: studyA.id, metadata: { modality: 'PX', duplicate: false } });
      const auditB = await createBridgeAuditRow({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, studyId: studyB.id, metadata: { modality: 'PX', duplicate: false } });

      const resultA = await collectBridgeImagingActivityForPatient(patientA.id, fx.defaultClinicId, fx.orgId);

      await test('2. same-clinic other patient bridge event excluded', () => {
        assert.equal(resultA.length, 1);
        assert.equal(resultA[0].id, auditA.id);
        assert.ok(!resultA.some((r) => r.id === auditB.id));
      });
    }

    // ═══ 3 — same-org sibling clinic excluded ═══
    section('3: same-org sibling-clinic patient excluded');
    {
      const fx = await createClinicFixtureSet('f2img3-siblingclinic');
      trackClinics(fx.defaultClinicId, fx.siblingClinicId);
      const patientDefault = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'DefaultClinicPatient' });
      const patientSibling = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.siblingClinicId, firstName: 'SiblingClinicPatient' });

      const studySibling = await createBridgeImagingStudy({ clinicId: fx.siblingClinicId, patientId: patientSibling.id });
      const auditSibling = await createBridgeAuditRow({ organizationId: fx.orgId, clinicId: fx.siblingClinicId, studyId: studySibling.id, metadata: { modality: 'CT', duplicate: false } });

      const resultDefault = await collectBridgeImagingActivityForPatient(patientDefault.id, fx.defaultClinicId, fx.orgId);
      await test('3a. defaultClinic patient sees zero sibling-clinic bridge events', () => {
        assert.equal(resultDefault.length, 0);
      });

      // Adversarial: sibling patient's own real id, queried under the WRONG
      // clinicId — proves the clinicId predicate is load-bearing, not
      // incidental (i.e. not merely "happens to be empty" because no
      // fixture data was created there).
      const resultCrossClinic = await collectBridgeImagingActivityForPatient(patientSibling.id, fx.defaultClinicId, fx.orgId);
      await test('3b. sibling patient real id queried under the wrong clinicId returns zero rows (clinicId predicate enforced, not incidental)', () => {
        assert.equal(resultCrossClinic.length, 0);
      });

      const resultOwnClinic = await collectBridgeImagingActivityForPatient(patientSibling.id, fx.siblingClinicId, fx.orgId);
      await test('3c. sibling patient queried under their own real clinicId sees their own bridge event (sanity control)', () => {
        assert.equal(resultOwnClinic.length, 1);
        assert.equal(resultOwnClinic[0].id, auditSibling.id);
      });
    }

    // ═══ 4 — other organization excluded ═══
    section('4: other-organization patient excluded');
    {
      const fx = await createClinicFixtureSet('f2img3-crossorg');
      trackClinics(fx.defaultClinicId, fx.crossOrgClinicId);
      const patientOrg1 = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'Org1Patient' });
      const patientOrg2 = await createTestPatient({ organizationId: fx.otherOrgId, clinicId: fx.crossOrgClinicId, firstName: 'Org2Patient' });

      const studyOrg2 = await createBridgeImagingStudy({ clinicId: fx.crossOrgClinicId, patientId: patientOrg2.id });
      const auditOrg2 = await createBridgeAuditRow({ organizationId: fx.otherOrgId, clinicId: fx.crossOrgClinicId, studyId: studyOrg2.id, metadata: { modality: 'CEPH', duplicate: false } });

      const resultOrg1 = await collectBridgeImagingActivityForPatient(patientOrg1.id, fx.defaultClinicId, fx.orgId);
      await test('4a. org1 patient sees zero org2 bridge events', () => {
        assert.equal(resultOrg1.length, 0);
      });

      // Adversarial: org2's own patient/clinic id, queried under org1's
      // organizationId — proves the organizationId predicate is
      // load-bearing.
      const resultWrongOrg = await collectBridgeImagingActivityForPatient(patientOrg2.id, fx.crossOrgClinicId, fx.orgId);
      await test('4b. org2 patient/clinic queried under the wrong organizationId returns zero rows', () => {
        assert.equal(resultWrongOrg.length, 0);
      });

      const resultOwnOrg = await collectBridgeImagingActivityForPatient(patientOrg2.id, fx.crossOrgClinicId, fx.otherOrgId);
      await test('4c. org2 patient queried under their own real organizationId sees their own bridge event (sanity control)', () => {
        assert.equal(resultOwnOrg.length, 1);
        assert.equal(resultOwnOrg[0].id, auditOrg2.id);
      });
    }

    // ═══ 6 — duplicate-equivalent events handled deterministically ═══
    section('6: duplicate-equivalent bridge ingest events preserved as distinct entries');
    {
      const fx = await createClinicFixtureSet('f2img3-dup');
      trackClinics(fx.defaultClinicId);
      const patient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'DupTarget' });
      const study = await createBridgeImagingStudy({ clinicId: fx.defaultClinicId, patientId: patient.id });

      const firstIngest = await createBridgeAuditRow({
        organizationId: fx.orgId,
        clinicId: fx.defaultClinicId,
        studyId: study.id,
        metadata: { modality: 'IO', duplicate: false },
        createdAt: new Date('2026-01-01T10:00:00.000Z'),
      });
      const retryDuplicate = await createBridgeAuditRow({
        organizationId: fx.orgId,
        clinicId: fx.defaultClinicId,
        studyId: study.id,
        metadata: { modality: 'IO', duplicate: true },
        createdAt: new Date('2026-01-01T10:05:00.000Z'),
      });

      const run1 = await collectBridgeImagingActivityForPatient(patient.id, fx.defaultClinicId, fx.orgId);
      const run2 = await collectBridgeImagingActivityForPatient(patient.id, fx.defaultClinicId, fx.orgId);

      await test('6a. both genuinely distinct ingest-attempt audit rows for the same study survive as two entries (not collapsed)', () => {
        assert.equal(run1.length, 2);
        const ids = run1.map((r) => r.id).sort();
        assert.deepEqual(ids, [firstIngest.id, retryDuplicate.id].sort());
      });

      await test('6b. re-running the projection is deterministic (identical ids across runs)', () => {
        assert.deepEqual(
          run1.map((r) => r.id).sort(),
          run2.map((r) => r.id).sort(),
        );
      });

      await test('6c. mergePatientActivityHistory dedupes a repeated source row by structured id, not naive concat', () => {
        const merged = mergePatientActivityHistory([], [...run1, run1[0]]);
        assert.equal(merged.length, 2, 'the repeated row must collapse to one entry, not three');
      });
    }

    // ═══ 7 — unrelated AuditLog rows excluded ═══
    section('7: unrelated AuditLog rows excluded');
    {
      const fx = await createClinicFixtureSet('f2img3-unrelated');
      trackClinics(fx.defaultClinicId);
      const patient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'UnrelatedTarget' });
      const study = await createBridgeImagingStudy({ clinicId: fx.defaultClinicId, patientId: patient.id });

      const relevant = await createBridgeAuditRow({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, studyId: study.id, metadata: { modality: 'PX', duplicate: false } });
      // Same clinic/org/entityId, but a different action — must not be treated as a bridge ingest event.
      await createBridgeAuditRow({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, studyId: study.id, metadata: { modality: 'PX' }, action: 'imaging_study_linked' });
      // Same clinic/org, unrelated entityType entirely.
      await prisma.auditLog.create({ data: { organizationId: fx.orgId, clinicId: fx.defaultClinicId, action: 'user_login', entityType: 'user', entityId: randomUUID(), metadata: {} } });

      const result = await collectBridgeImagingActivityForPatient(patient.id, fx.defaultClinicId, fx.orgId);
      await test('7. only the exact action+entityType bridge-ingest row is included', () => {
        assert.equal(result.length, 1);
        assert.equal(result[0].id, relevant.id);
      });
    }

    // ═══ 9 — no storageKey/path/token/raw metadata leakage ═══
    section('9: no storageKey/path/token/raw metadata leakage');
    {
      const fx = await createClinicFixtureSet('f2img3-leak');
      trackClinics(fx.defaultClinicId);
      const patient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'LeakTarget' });
      const study = await createBridgeImagingStudy({ clinicId: fx.defaultClinicId, patientId: patient.id });

      const poisoned = await createBridgeAuditRow({
        organizationId: fx.orgId,
        clinicId: fx.defaultClinicId,
        studyId: study.id,
        metadata: {
          modality: 'PX',
          duplicate: false,
          storageKey: `${fx.defaultClinicId}/secret-study.dcm`,
          filePath: '/var/uploads/secret-study.dcm',
          token: 'super-secret-bridge-token',
          rawDicomMetadata: { PatientName: 'REAL PATIENT NAME LEAK' },
        },
      });

      const result = await collectBridgeImagingActivityForPatient(patient.id, fx.defaultClinicId, fx.orgId);
      await test('9. exported entry never contains storageKey/path/token/raw metadata, even when present on the source row', () => {
        const entry = result.find((r) => r.id === poisoned.id);
        assert.ok(entry);
        const json = JSON.stringify(entry);
        assert.ok(!json.includes('secret-study.dcm'));
        assert.ok(!json.includes('/var/uploads'));
        assert.ok(!json.includes('super-secret-bridge-token'));
        assert.ok(!json.includes('REAL PATIENT NAME LEAK'));
        assert.ok(!('metadata' in (entry as object)), 'raw metadata object must never be spread onto the export entry');
      });
    }
  } finally {
    await cleanupImagingBridgeFixtures();
    await cleanupAllFixtures();
  }
}

main()
  .then(() => {
    const ok = summary();
    process.exitCode = ok ? 0 : 1;
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
