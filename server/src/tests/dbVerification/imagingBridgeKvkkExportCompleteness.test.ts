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
 * F2-IMG-AUDIT-003-R1 additions — global 500-row cardinality cap and
 * deterministic ordering for the MERGED `activityHistory` (see
 * `mergePatientActivityHistory`'s doc comment for the full rationale: before
 * R1, two independently-500-capped sources could merge into up to 1000
 * exported rows, silently breaking the pre-existing global-500 contract):
 *
 *  11.  staff-only 600 candidates -> exactly newest 500 exported.
 *  12.  bridge-only 600 candidates -> exactly newest 500 exported.
 *  13.  mixed staff + bridge, >500 combined -> exactly 500 total.
 *  14.  the newest 500 rows across BOTH sources win the cap (not
 *       per-source-proportional, not first-source-priority).
 *  15.  older staff rows are displaced by newer bridge rows once the
 *       combined total exceeds the cap.
 *  16.  older bridge rows are displaced by newer staff rows once the
 *       combined total exceeds the cap.
 *  17.  equal `createdAt` across sources produces deterministic ordering,
 *       stable across repeated runs and independent of input array order
 *       (i.e. not reliant on Map insertion order).
 *  18.  two legitimate bridge rows sharing the same underlying action
 *       (duplicate-retry ingest for one study) both survive when both fall
 *       within the top 500 — the cap must not resurrect the entityId+action
 *       collapse the dedupe rule deliberately rejects.
 *  19.  tenant isolation predicates (wrong clinic, wrong organization)
 *       still block cross-tenant rows even against a >500-candidate,
 *       cap-triggering dataset.
 *  20.  poisoned metadata (storageKey/path/token/raw metadata) still cannot
 *       leak through the capped, sorted export.
 *  21.  the staff-only `activityHistory` shape stays compatible (original
 *       field set plus additive `source`) once the cap is engaged.
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
  MAX_PATIENT_ACTIVITY_HISTORY_ROWS,
  type StaffActivityLogRow,
  type PatientActivityHistoryEntry,
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

// ─── F2-IMG-AUDIT-003-R1: synthetic row builders for pure, DB-free tests of
// mergePatientActivityHistory's cap/ordering logic. Per-source fetch caps
// (`take: 500`) are unchanged, real-DB behavior; the cap/ordering bug lived
// entirely in the merge function's own logic, so exercising it directly with
// controlled counts/timestamps/ids is both correct and far faster than
// round-tripping 600+ rows through Postgres per scenario. ───

/** `baseTime - index` minutes, so index 0 is newest, ascending index is older. */
function syntheticStaffRow(index: number, opts: { baseTime?: Date; idPrefix?: string } = {}): StaffActivityLogRow {
  const baseTime = opts.baseTime ?? new Date('2026-01-01T00:00:00.000Z');
  return {
    id: `${opts.idPrefix ?? 'staff'}-${String(index).padStart(4, '0')}-${randomUUID()}`,
    action: 'create',
    entityType: 'imaging_study',
    description: `synthetic staff row ${index}`,
    createdAt: new Date(baseTime.getTime() - index * 60_000),
  };
}

function syntheticBridgeRow(index: number, opts: { baseTime?: Date; idPrefix?: string } = {}): PatientActivityHistoryEntry {
  const baseTime = opts.baseTime ?? new Date('2026-01-01T00:00:00.000Z');
  return {
    id: `${opts.idPrefix ?? 'bridge'}-${String(index).padStart(4, '0')}-${randomUUID()}`,
    action: 'imaging_bridge_study_ingested',
    entityType: 'imaging_study',
    description: `synthetic bridge row ${index}`,
    createdAt: new Date(baseTime.getTime() - index * 60_000),
    source: 'bridge',
  };
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

    // ═══ F2-IMG-AUDIT-003-R1: pure unit tests (no DB) for mergePatientActivityHistory's
    // global cap + deterministic ordering. See file-header items 11-18. ═══
    section('11: staff-only 600 candidates -> exactly newest 500 exported');
    {
      const staffRows = Array.from({ length: 600 }, (_, i) => syntheticStaffRow(i));
      const merged = mergePatientActivityHistory(staffRows, []);
      await test('11. staff-only 600 candidates collapse to exactly the newest 500', () => {
        assert.equal(merged.length, MAX_PATIENT_ACTIVITY_HISTORY_ROWS);
        const expectedIds = new Set(staffRows.slice(0, 500).map((r) => r.id));
        assert.ok(merged.every((r) => expectedIds.has(r.id)));
        assert.ok(!merged.some((r) => r.id === staffRows[500].id), 'the 501st-newest row must be dropped');
      });
    }

    section('12: bridge-only 600 candidates -> exactly newest 500 exported');
    {
      const bridgeRows = Array.from({ length: 600 }, (_, i) => syntheticBridgeRow(i));
      const merged = mergePatientActivityHistory([], bridgeRows);
      await test('12. bridge-only 600 candidates collapse to exactly the newest 500', () => {
        assert.equal(merged.length, MAX_PATIENT_ACTIVITY_HISTORY_ROWS);
        const expectedIds = new Set(bridgeRows.slice(0, 500).map((r) => r.id));
        assert.ok(merged.every((r) => expectedIds.has(r.id)));
        assert.ok(!merged.some((r) => r.id === bridgeRows[500].id), 'the 501st-newest row must be dropped');
      });
    }

    section('13-14: mixed staff + bridge, >500 combined -> exactly 500, newest across both sources win');
    {
      // A single interleaved timeline: even position -> bridge, odd position -> staff,
      // strictly newest-first, no ties. 300 staff + 300 bridge = 600 candidates.
      const baseTime = new Date('2026-02-01T00:00:00.000Z');
      const staffRows: StaffActivityLogRow[] = [];
      const bridgeRows: PatientActivityHistoryEntry[] = [];
      for (let i = 0; i < 300; i++) {
        staffRows.push(syntheticStaffRow(2 * i + 1, { baseTime, idPrefix: 'staff' }));
        bridgeRows.push(syntheticBridgeRow(2 * i, { baseTime, idPrefix: 'bridge' }));
      }
      const merged = mergePatientActivityHistory(staffRows, bridgeRows);

      await test('13. 600 combined candidates collapse to exactly 500', () => {
        assert.equal(merged.length, MAX_PATIENT_ACTIVITY_HISTORY_ROWS);
      });

      await test('14. the newest 500 timeline positions win, regardless of which source they came from', () => {
        // Timeline positions 0..499 are the newest 500; positions 500..599 must be dropped.
        const survivingStaffIndices = staffRows.filter((_, i) => 2 * i + 1 < 500).length;
        const survivingBridgeIndices = bridgeRows.filter((_, i) => 2 * i < 500).length;
        assert.equal(merged.length, survivingStaffIndices + survivingBridgeIndices);
        assert.ok(!merged.some((r) => r.id === staffRows[299].id), 'oldest staff row (position 599) must be dropped');
        assert.ok(!merged.some((r) => r.id === bridgeRows[299].id), 'oldest-but-one bridge row (position 598) must be dropped');
        assert.ok(merged.some((r) => r.id === bridgeRows[0].id), 'newest bridge row must survive');
        assert.ok(merged.some((r) => r.id === staffRows[0].id), 'newest staff row must survive');
      });
    }

    section('15: older staff rows displaced by newer bridge rows once combined total exceeds the cap');
    {
      const oldBaseTime = new Date('2020-01-01T00:00:00.000Z');
      const newBaseTime = new Date('2026-01-01T00:00:00.000Z');
      const staffRows = Array.from({ length: 500 }, (_, i) => syntheticStaffRow(i, { baseTime: oldBaseTime, idPrefix: 'oldstaff' }));
      const bridgeRows = Array.from({ length: 50 }, (_, i) => syntheticBridgeRow(i, { baseTime: newBaseTime, idPrefix: 'newbridge' }));
      const merged = mergePatientActivityHistory(staffRows, bridgeRows);

      await test('15. all 50 newer bridge rows survive, 450 newest staff rows survive, 50 oldest staff rows are displaced', () => {
        assert.equal(merged.length, MAX_PATIENT_ACTIVITY_HISTORY_ROWS);
        assert.ok(bridgeRows.every((b) => merged.some((r) => r.id === b.id)), 'every bridge row must survive (all newer than every staff row)');
        const survivingStaffIds = new Set(staffRows.slice(0, 450).map((r) => r.id));
        assert.ok(merged.filter((r) => r.source === 'staff').every((r) => survivingStaffIds.has(r.id)));
        assert.equal(merged.filter((r) => r.source === 'staff').length, 450);
        const displacedStaffIds = staffRows.slice(450).map((r) => r.id);
        assert.ok(displacedStaffIds.every((id) => !merged.some((r) => r.id === id)), 'the 50 oldest staff rows must be displaced');
      });
    }

    section('16: older bridge rows displaced by newer staff rows once combined total exceeds the cap');
    {
      const oldBaseTime = new Date('2020-01-01T00:00:00.000Z');
      const newBaseTime = new Date('2026-01-01T00:00:00.000Z');
      const bridgeRows = Array.from({ length: 500 }, (_, i) => syntheticBridgeRow(i, { baseTime: oldBaseTime, idPrefix: 'oldbridge' }));
      const staffRows = Array.from({ length: 50 }, (_, i) => syntheticStaffRow(i, { baseTime: newBaseTime, idPrefix: 'newstaff' }));
      const merged = mergePatientActivityHistory(staffRows, bridgeRows);

      await test('16. all 50 newer staff rows survive, 450 newest bridge rows survive, 50 oldest bridge rows are displaced', () => {
        assert.equal(merged.length, MAX_PATIENT_ACTIVITY_HISTORY_ROWS);
        assert.ok(staffRows.every((s) => merged.some((r) => r.id === s.id)), 'every staff row must survive (all newer than every bridge row)');
        assert.equal(merged.filter((r) => r.source === 'bridge').length, 450);
        const displacedBridgeIds = bridgeRows.slice(450).map((r) => r.id);
        assert.ok(displacedBridgeIds.every((id) => !merged.some((r) => r.id === id)), 'the 50 oldest bridge rows must be displaced');
      });
    }

    section('17: equal createdAt across sources produces deterministic, input-order-independent ordering');
    {
      const tiedAt = new Date('2026-03-01T12:00:00.000Z');
      const staffA: StaffActivityLogRow = { id: 'aaa-staff', action: 'create', entityType: 'imaging_study', description: null, createdAt: tiedAt };
      const staffB: StaffActivityLogRow = { id: 'zzz-staff', action: 'create', entityType: 'imaging_study', description: null, createdAt: tiedAt };
      const bridgeA: PatientActivityHistoryEntry = { id: 'aaa-bridge', action: 'imaging_bridge_study_ingested', entityType: 'imaging_study', description: null, createdAt: tiedAt, source: 'bridge' };
      const bridgeB: PatientActivityHistoryEntry = { id: 'bbb-bridge', action: 'imaging_bridge_study_ingested', entityType: 'imaging_study', description: null, createdAt: tiedAt, source: 'bridge' };

      const run1 = mergePatientActivityHistory([staffA, staffB], [bridgeA, bridgeB]);
      // Same rows, reversed input array order — must not change the result if the
      // tie-break is genuinely deterministic rather than Map-insertion-order-derived.
      const run2 = mergePatientActivityHistory([staffB, staffA], [bridgeB, bridgeA]);

      await test('17a. equal-timestamp rows sort by source rank (staff before bridge), then id lexical', () => {
        assert.deepEqual(
          run1.map((r) => r.id),
          [staffA.id, staffB.id, bridgeA.id, bridgeB.id],
        );
      });

      await test('17b. the tie-break order is identical regardless of input array order (not Map-insertion-order-derived)', () => {
        assert.deepEqual(
          run1.map((r) => r.id),
          run2.map((r) => r.id),
        );
      });
    }

    section('18: two legitimate same-action bridge rows both survive when within the top 500');
    {
      const baseTime = new Date('2026-04-01T00:00:00.000Z');
      // Newest 2 rows: a legitimate original-ingest + duplicate-retry pair for
      // the same underlying study (both share the real `imaging_bridge_study_ingested`
      // action — the dedupe/cap logic must key off each row's own id, never
      // action, or one of this pair would be silently dropped).
      const originalIngest = syntheticBridgeRow(0, { baseTime, idPrefix: 'study7-original' });
      const duplicateRetry = syntheticBridgeRow(1, { baseTime, idPrefix: 'study7-retry' });
      // 499 older filler rows push total candidates to 501 — one over the cap —
      // so the boundary is genuinely exercised, not just "everything fits".
      const filler = Array.from({ length: 499 }, (_, i) => syntheticBridgeRow(i + 2, { baseTime, idPrefix: 'filler' }));

      const merged = mergePatientActivityHistory([], [originalIngest, duplicateRetry, ...filler]);

      await test('18. both the original-ingest and duplicate-retry rows survive as distinct entries within the top 500', () => {
        assert.equal(merged.length, MAX_PATIENT_ACTIVITY_HISTORY_ROWS);
        assert.ok(merged.some((r) => r.id === originalIngest.id));
        assert.ok(merged.some((r) => r.id === duplicateRetry.id));
        assert.ok(!merged.some((r) => r.id === filler[filler.length - 1].id), 'the oldest filler row (501st) must be displaced');
      });
    }

    // ═══ F2-IMG-AUDIT-003-R1: real-DB, cap-triggering end-to-end scenario.
    // See file-header items 19-21. Proves the fetch-level `take: 500` per
    // source PLUS the merge-level final cap work together in the true code
    // path, and that tenant isolation / leak-prevention / shape-compatibility
    // all survive once the cap is actually engaged (not just under the small
    // datasets used by sections 1-10 above, none of which ever approached 500). ═══
    section('19-21: real-DB cap-triggering dataset — isolation, leak-prevention, and shape hold once the cap engages');
    {
      const fx = await createClinicFixtureSet('f2img3-r1-cap');
      trackClinics(fx.defaultClinicId, fx.siblingClinicId, fx.crossOrgClinicId);
      const staff = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER' });
      const patient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'CapTarget' });
      const userOverrides = {
        id: staff.id,
        organizationId: fx.orgId,
        clinicId: fx.defaultClinicId,
        role: 'OWNER',
        canAccessAllClinics: false,
        allowedClinicIds: [fx.defaultClinicId],
      };

      const STAFF_COUNT = 260;
      const BRIDGE_COUNT = 260;
      const staffBaseTime = new Date('2026-05-01T00:00:00.000Z');
      const bridgeBaseTime = new Date(staffBaseTime.getTime() + 1000); // 1s ahead, spacing below is 2s -> no ties, deterministic interleave

      const staffPlanned = Array.from({ length: STAFF_COUNT }, (_, i) => ({
        id: randomUUID(),
        clinicId: fx.defaultClinicId,
        userId: staff.id,
        entityType: 'imaging_study',
        entityId: randomUUID(),
        patientId: patient.id,
        action: 'create',
        description: `bulk staff ${i}`,
        createdAt: new Date(staffBaseTime.getTime() - i * 2000),
      }));
      await prisma.activityLog.createMany({ data: staffPlanned });

      const study = await createBridgeImagingStudy({ clinicId: fx.defaultClinicId, patientId: patient.id });
      const POISON_INDEX = 5; // comfortably inside the surviving top-500 range
      const bridgePlanned = Array.from({ length: BRIDGE_COUNT }, (_, i) => {
        const metadata: Record<string, unknown> = { modality: 'PX', duplicate: false };
        if (i === POISON_INDEX) {
          metadata.storageKey = `${fx.defaultClinicId}/secret-bulk.dcm`;
          metadata.filePath = '/var/uploads/secret-bulk.dcm';
          metadata.token = 'super-secret-bulk-token';
          metadata.rawDicomMetadata = { PatientName: 'REAL PATIENT NAME BULK LEAK' };
        }
        return {
          id: randomUUID(),
          organizationId: fx.orgId,
          clinicId: fx.defaultClinicId,
          action: 'imaging_bridge_study_ingested',
          entityType: 'imaging_study',
          entityId: study.id,
          metadata: metadata as any,
          createdAt: new Date(bridgeBaseTime.getTime() - i * 2000),
        };
      });
      await prisma.auditLog.createMany({ data: bridgePlanned });

      // Unrelated same-clinic and cross-org bridge data, so the cap-triggering
      // export for `patient` has real cross-tenant rows to wrongly include if
      // isolation broke — not just an empty-by-construction absence.
      const siblingPatient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.siblingClinicId, firstName: 'SiblingCapNoise' });
      const siblingStudy = await createBridgeImagingStudy({ clinicId: fx.siblingClinicId, patientId: siblingPatient.id });
      const siblingAudit = await createBridgeAuditRow({ organizationId: fx.orgId, clinicId: fx.siblingClinicId, studyId: siblingStudy.id, metadata: { modality: 'CT', duplicate: false } });

      const crossOrgPatient = await createTestPatient({ organizationId: fx.otherOrgId, clinicId: fx.crossOrgClinicId, firstName: 'CrossOrgCapNoise' });
      const crossOrgStudy = await createBridgeImagingStudy({ clinicId: fx.crossOrgClinicId, patientId: crossOrgPatient.id });
      const crossOrgAudit = await createBridgeAuditRow({ organizationId: fx.otherOrgId, clinicId: fx.crossOrgClinicId, studyId: crossOrgStudy.id, metadata: { modality: 'CEPH', duplicate: false } });

      const result = await runExport(patient.id, userOverrides);
      const history: any[] = result.body.activityHistory;

      await test('19a. real fetch+merge pipeline caps the export at exactly 500 rows for a 520-candidate patient', () => {
        assert.equal(result.statusCode, 200);
        assert.equal(history.length, MAX_PATIENT_ACTIVITY_HISTORY_ROWS);
      });

      await test('19b. newest-first displacement holds in the real pipeline: the newest 250 of each source survive, the oldest 10 of each are dropped', () => {
        const staffIds = new Set(history.filter((h) => h.source === 'staff').map((h) => h.id));
        const bridgeIds = new Set(history.filter((h) => h.source === 'bridge').map((h) => h.id));
        assert.equal(staffIds.size, 250);
        assert.equal(bridgeIds.size, 250);
        for (let i = 0; i < 250; i++) {
          assert.ok(staffIds.has(staffPlanned[i].id), `staff row ${i} (newest 250) must survive`);
          assert.ok(bridgeIds.has(bridgePlanned[i].id), `bridge row ${i} (newest 250) must survive`);
        }
        for (let i = 250; i < 260; i++) {
          assert.ok(!staffIds.has(staffPlanned[i].id), `staff row ${i} (oldest 10) must be displaced`);
          assert.ok(!bridgeIds.has(bridgePlanned[i].id), `bridge row ${i} (oldest 10) must be displaced`);
        }
      });

      await test('19c. tenant isolation (wrong clinic, wrong organization) still blocks cross-tenant rows under a cap-triggering dataset', () => {
        assert.ok(!history.some((h) => h.id === siblingAudit.id), 'sibling-clinic bridge row must never appear');
        assert.ok(!history.some((h) => h.id === crossOrgAudit.id), 'cross-org bridge row must never appear');
      });

      await test('20. poisoned metadata still cannot leak through the capped, sorted export', () => {
        const entry = history.find((h) => h.id === bridgePlanned[POISON_INDEX].id);
        assert.ok(entry, 'the poisoned row must itself survive the cap (it is within the newest 250)');
        const json = JSON.stringify(entry);
        assert.ok(!json.includes('secret-bulk.dcm'));
        assert.ok(!json.includes('/var/uploads'));
        assert.ok(!json.includes('super-secret-bulk-token'));
        assert.ok(!json.includes('REAL PATIENT NAME BULK LEAK'));
        assert.ok(!('metadata' in entry));
      });

      await test('21. staff-only entry shape stays backward compatible (original fields + additive source) once the cap is engaged', () => {
        const staffEntry = history.find((h) => h.source === 'staff');
        assert.ok(staffEntry);
        assert.deepEqual(Object.keys(staffEntry).sort(), ['action', 'createdAt', 'description', 'entityType', 'id', 'source'].sort());
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
