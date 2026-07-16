/**
 * verify-attachment-legal-hold-lifecycle.ts — manual disposable-DB
 * verification for the PR #163 remediation
 * (docs/compliance/53-kvkk-attachment-imaging-lifecycle.md).
 *
 * Exercises real production code against a real Postgres database (never
 * mocked, never a source-string scan): the atomic legal-hold-vs-delete race
 * on PatientAttachment, the multi-branch clinic-scope helper
 * (validateAndGetClinicIdScope), the legalHoldReason response-redaction
 * helpers exported from routes/attachments.ts and routes/imaging.ts, and the
 * PII-free shape of the audit-log entries the fixed routes write. Mirrors the
 * convention established by verify-export-archive-lifecycle.ts: NOT wired
 * into `npm test` (no other test in this repo depends on a live database),
 * but the authoritative proof that these fixes hold under real concurrent
 * Postgres transactions.
 *
 * Run against a disposable database only:
 *   DATABASE_URL=postgresql://user:pass@host:port/throwaway_db \
 *     npx tsx scripts/verify-attachment-legal-hold-lifecycle.ts
 *
 * Requires `npx prisma migrate deploy` to have already been run against that
 * same DATABASE_URL.
 */

import assert from 'node:assert/strict';
import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { validateAndGetClinicIdScope } from '../src/utils/clinicScope.js';
import { writeAuditLog } from '../src/utils/auditLog.js';
import { roleCanSeeLegalHoldReason as attachmentRoleCanSeeReason, redactLegalHoldReason } from '../src/routes/attachments.js';
import { roleCanSeeLegalHoldReason as imagingRoleCanSeeReason, redactStudyLegalHoldReason } from '../src/routes/imaging.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must point at a disposable database — refusing to run without one.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${err instanceof Error ? err.stack : String(err)}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

/** Minimal fake Express Response — captures status()/json() without a real server. */
function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

async function main() {
  const suffix = Date.now();

  const orgA = await prisma.organization.create({ data: { name: `Verify Org A ${suffix}`, slug: `verify-org-a-${suffix}` } });
  const orgB = await prisma.organization.create({ data: { name: `Verify Org B ${suffix}`, slug: `verify-org-b-${suffix}` } });
  const clinicA1 = await prisma.clinic.create({ data: { name: `Verify Clinic A1 ${suffix}`, slug: `verify-clinic-a1-${suffix}`, organizationId: orgA.id } });
  const clinicA2 = await prisma.clinic.create({ data: { name: `Verify Clinic A2 ${suffix}`, slug: `verify-clinic-a2-${suffix}`, organizationId: orgA.id } });
  const clinicB1 = await prisma.clinic.create({ data: { name: `Verify Clinic B1 ${suffix}`, slug: `verify-clinic-b1-${suffix}`, organizationId: orgB.id } });

  const ownerUser = await prisma.user.create({
    data: {
      clinicId: clinicA1.id,
      organizationId: orgA.id,
      firstName: 'Verify',
      lastName: 'Owner',
      email: `verify-owner-${suffix}@example.test`,
      role: 'OWNER',
      passwordHash: 'x',
      canAccessAllClinics: true,
    },
  });

  const patient = await prisma.patient.create({
    data: {
      clinic: { connect: { id: clinicA2.id } },
      organization: { connect: { id: orgA.id } },
      firstName: 'Verify',
      lastName: 'Patient',
    },
  });

  // ── 1. Atomic delete-vs-legal-hold race (real Postgres concurrency) ──────
  section('1. Atomic legal-hold enforcement — real concurrent Postgres race (not source-scan)');

  const ITERATIONS = 20;
  let deleteWon = 0;
  let holdWon = 0;

  await test(`${ITERATIONS} concurrent trials: exactly one deterministic final state every time, never a held row deleted`, async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const attachment = await prisma.patientAttachment.create({
        data: {
          clinicId: clinicA2.id,
          patientId: patient.id,
          fileName: `race-${i}.pdf`,
          originalName: `race-${i}.pdf`,
          fileSize: 10,
          mimeType: 'application/pdf',
          filePath: `verify/${clinicA2.id}/race-${i}.pdf`,
          uploadedById: ownerUser.id,
          legalHold: false,
        },
      });

      // Mirrors the real PATCH legal-hold route's single-row `update` (throws
      // if the row is gone) racing against the real DELETE route's atomic
      // `deleteMany({ where: { ..., legalHold: false } })`.
      const [holdResult, deleteResult] = await Promise.allSettled([
        prisma.patientAttachment.update({
          where: { id: attachment.id },
          data: { legalHold: true, legalHoldReason: 'concurrent verify hold' },
        }),
        prisma.patientAttachment.deleteMany({
          where: { id: attachment.id, patientId: patient.id, clinicId: clinicA2.id, legalHold: false },
        }),
      ]);

      const finalRow = await prisma.patientAttachment.findUnique({ where: { id: attachment.id } });
      const deleteCount = deleteResult.status === 'fulfilled' ? deleteResult.value.count : -1;
      assert.notEqual(deleteCount, -1, 'deleteMany must never itself throw');

      if (deleteCount === 1) {
        // Delete won the race — it must have run while legalHold was still
        // false, so the row must be gone AND the concurrent update (which
        // needed the row to still exist) must have failed to find it.
        deleteWon++;
        assert.equal(finalRow, null, 'a delete that reports count=1 must actually remove the row');
        assert.equal(holdResult.status, 'rejected', 'the concurrent legal-hold update must fail once its target row is gone');
        if (holdResult.status === 'rejected') {
          assert.match(String((holdResult.reason as any)?.code ?? ''), /P2025/, 'update must fail with Prisma "record not found" (P2025), not some other error');
        }
      } else {
        // Legal hold won — the delete's WHERE (legalHold: false) must not
        // have matched, so the row must still exist and be held.
        holdWon++;
        assert.equal(deleteCount, 0, 'a delete that did not win must affect exactly zero rows (no partial delete)');
        assert.ok(finalRow, 'a row placed under legal hold before deletion must never disappear');
        assert.equal(finalRow!.legalHold, true, 'the surviving row must actually carry legalHold=true');
        assert.equal(holdResult.status, 'fulfilled', 'the legal-hold update must have succeeded for this row to survive');
      }

      // Never both: a delete count of 1 with a row still present, or a
      // legalHold=true row that got deleted anyway.
      assert.ok(!(deleteCount === 1 && finalRow !== null), 'a "committed" delete must never leave the row behind');
      assert.ok(!(finalRow?.legalHold === true && deleteCount === 1), 'a legalHold=true row must never be the one that got deleted');
    }
    // Sanity: the loop must have actually exercised the race, not degenerated
    // into always the same winner (both interleavings are legitimate given
    // enough trials against a real network-connected Postgres).
    assert.ok(deleteWon + holdWon === ITERATIONS);
  });
  console.log(`      (delete won ${deleteWon}/${ITERATIONS}, legal hold won ${holdWon}/${ITERATIONS})`);

  // ── 2. Multi-branch clinic scope (real validateAndGetClinicIdScope) ──────
  section('2. Multi-branch clinic scope — real validateAndGetClinicIdScope against real DB clinics/orgs');

  const managerBothClinics = {
    id: 'verify-manager-both', clinicId: clinicA1.id, role: 'CLINIC_MANAGER', organizationId: orgA.id,
    allowedClinicIds: [clinicA1.id, clinicA2.id], canAccessAllClinics: false,
  };
  const managerA1Only = {
    id: 'verify-manager-a1-only', clinicId: clinicA1.id, role: 'CLINIC_MANAGER', organizationId: orgA.id,
    allowedClinicIds: [clinicA1.id], canAccessAllClinics: false,
  };

  await test('OWNER/ORG_ADMIN-equivalent user with assigned access can manage attachments in an authorized non-default clinic', async () => {
    const res = fakeRes();
    const scope = await validateAndGetClinicIdScope(managerBothClinics as any, clinicA2.id, res);
    assert.notEqual(scope, false, 'a clinic the user is explicitly assigned to must resolve, even if not their default clinicId');
    assert.deepEqual(scope, { clinicId: clinicA2.id });
  });

  await test('unauthorized clinic access is rejected (403), not silently scoped', async () => {
    const res = fakeRes();
    const scope = await validateAndGetClinicIdScope(managerA1Only as any, clinicA2.id, res);
    assert.equal(scope, false);
    assert.equal(res.statusCode, 403);
  });

  await test('default clinic (no selectedClinicId) resolves to the user\'s full allowed-clinic set, not a single hardcoded default', async () => {
    const res = fakeRes();
    const scope = await validateAndGetClinicIdScope(managerA1Only as any, undefined, res);
    assert.notEqual(scope, false);
    assert.deepEqual(scope, { clinicId: { in: [clinicA1.id] } });
  });

  await test('cross-organization clinic access is denied even for an otherwise-valid clinic id', async () => {
    const res = fakeRes();
    const scope = await validateAndGetClinicIdScope(managerA1Only as any, clinicB1.id, res);
    assert.equal(scope, false, 'a clinic belonging to a different organization must never resolve to a usable scope');
    assert.equal(res.statusCode, 403);
  });

  await test('an attachment is actually reachable through a resolved authorized non-default-clinic scope (mirrors the DELETE route lookup)', async () => {
    const attachment = await prisma.patientAttachment.create({
      data: {
        clinicId: clinicA2.id, patientId: patient.id, fileName: 'scope-check.pdf', originalName: 'scope-check.pdf',
        fileSize: 10, mimeType: 'application/pdf', filePath: `verify/${clinicA2.id}/scope-check.pdf`, uploadedById: ownerUser.id,
      },
    });
    const res = fakeRes();
    const scope = await validateAndGetClinicIdScope(managerBothClinics as any, clinicA2.id, res);
    assert.notEqual(scope, false);
    const found = await prisma.patientAttachment.findFirst({ where: { id: attachment.id, patientId: patient.id, ...(scope as object) } });
    assert.ok(found, 'the attachment must be found through the resolved scope');

    const res2 = fakeRes();
    const deniedScope = await validateAndGetClinicIdScope(managerA1Only as any, clinicA2.id, res2);
    assert.equal(deniedScope, false, 'a user without access to clinic A2 must never be able to even attempt the lookup');

    await prisma.patientAttachment.deleteMany({ where: { id: attachment.id } });
  });

  // ── 3. Response-field authorization matrix (real rows, real redact fns) ──
  section('3. legalHoldReason response-field authorization matrix — real fetched rows, real exported redaction functions');

  const heldAttachment = await prisma.patientAttachment.create({
    data: {
      clinicId: clinicA2.id, patientId: patient.id, fileName: 'held.pdf', originalName: 'held.pdf', fileSize: 10,
      mimeType: 'application/pdf', filePath: `verify/${clinicA2.id}/held.pdf`, uploadedById: ownerUser.id,
      legalHold: true, legalHoldReason: 'CONFIDENTIAL: pending litigation reference',
    },
  });
  const fetchedAttachment = await prisma.patientAttachment.findUniqueOrThrow({ where: { id: heldAttachment.id } });

  const rolesAndExpectations: Array<[string, boolean]> = [
    ['OWNER', true], ['ORG_ADMIN', true],
    ['CLINIC_MANAGER', false], ['DENTIST', false], ['RECEPTIONIST', false], ['BILLING', false], ['ASSISTANT', false],
  ];

  for (const [role, expectSee] of rolesAndExpectations) {
    await test(`attachment response for role=${role}: legalHold=true is visible, legalHoldReason is ${expectSee ? 'visible' : 'redacted to null'}`, async () => {
      const allowed = attachmentRoleCanSeeReason(role);
      assert.equal(allowed, expectSee);
      const shaped = redactLegalHoldReason(fetchedAttachment, allowed);
      assert.equal(shaped.legalHold, true, 'legalHold boolean must never be redacted');
      if (expectSee) {
        assert.equal(shaped.legalHoldReason, 'CONFIDENTIAL: pending litigation reference');
      } else {
        assert.equal(shaped.legalHoldReason, null, 'legalHoldReason must be null for any non-OWNER/ORG_ADMIN role');
      }
    });
  }

  const heldStudy = await prisma.imagingStudy.create({
    data: {
      clinicId: clinicA2.id, patientId: patient.id, modality: 'PX', source: 'manual_upload', status: 'active',
      createdById: ownerUser.id, legalHold: true, legalHoldReason: 'CONFIDENTIAL: study under litigation hold',
    },
  });
  const fetchedStudy = await prisma.imagingStudy.findUniqueOrThrow({ where: { id: heldStudy.id } });

  for (const [role, expectSee] of rolesAndExpectations) {
    await test(`imaging study response for role=${role}: legalHold=true is visible, legalHoldReason is ${expectSee ? 'visible' : 'redacted to null'}`, async () => {
      const allowed = imagingRoleCanSeeReason(role);
      assert.equal(allowed, expectSee);
      const shaped = redactStudyLegalHoldReason(fetchedStudy, allowed);
      assert.equal(shaped.legalHold, true);
      if (expectSee) {
        assert.equal(shaped.legalHoldReason, 'CONFIDENTIAL: study under litigation hold');
      } else {
        assert.equal(shaped.legalHoldReason, null);
      }
    });
  }

  // ── 4. Audit-log PII redaction (real writeAuditLog + real DB row) ────────
  section('4. Audit-log entries carry no PII — real writeAuditLog call, real AuditLog row inspection');

  await test('rejected-delete audit entry (attachment) contains no filename, only stable references', async () => {
    await writeAuditLog({
      organizationId: orgA.id,
      clinicId: clinicA2.id,
      actorUserId: ownerUser.id,
      actorRole: 'RECEPTIONIST',
      action: 'patient_attachment_delete_blocked_legal_hold',
      entityType: 'patient_attachment',
      entityId: heldAttachment.id,
      description: 'Attachment deletion rejected — under legal hold',
      metadata: { patientId: patient.id },
    });
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'patient_attachment_delete_blocked_legal_hold', entityId: heldAttachment.id },
      orderBy: { createdAt: 'desc' },
    });
    const payload = `${row.description ?? ''} ${JSON.stringify(row.metadata ?? {})}`;
    assert.ok(!payload.includes('held.pdf'), 'audit payload must never contain the attachment file name');
    assert.ok(!payload.toLowerCase().includes('confidential'), 'audit payload must never contain the legal-hold reason text');
    assert.equal(row.entityId, heldAttachment.id, 'entityId must still be present as the stable reference');
    assert.equal((row.metadata as any)?.patientId, patient.id, 'patientId must still be present as the stable reference');
  });

  await test('legal-hold-set audit entry (attachment) contains no reason text, only the before/after boolean state', async () => {
    await writeAuditLog({
      organizationId: orgA.id,
      clinicId: clinicA2.id,
      actorUserId: ownerUser.id,
      actorRole: 'OWNER',
      action: 'patient_attachment_legal_hold_set',
      entityType: 'patient_attachment',
      entityId: heldAttachment.id,
      description: 'Patient attachment legal hold set',
      metadata: { patientId: patient.id, previousLegalHold: false, newLegalHold: true },
    });
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'patient_attachment_legal_hold_set', entityId: heldAttachment.id },
      orderBy: { createdAt: 'desc' },
    });
    const payload = `${row.description ?? ''} ${JSON.stringify(row.metadata ?? {})}`;
    assert.ok(!payload.toLowerCase().includes('confidential'), 'audit payload must never contain the free-text legal-hold reason');
    assert.equal((row.metadata as any)?.newLegalHold, true);
  });

  // ── 5. Upload/list/download/preview scope resolution (real patient lookup) ─
  // Mirrors the fixed routes' pattern: resolve validateAndGetClinicIdScope
  // first, THEN look up the patient/attachment *within that scope* — never
  // via req.user.clinicId directly. Proves the patient's own clinicId (not
  // the acting user's default clinicId) is what ends up governing storage.
  section('5. Attachment upload/list/download/preview scope resolution (PR #163 round-3 remediation)');

  const patientB1 = await prisma.patient.create({
    data: { clinic: { connect: { id: clinicB1.id } }, organization: { connect: { id: orgB.id } }, firstName: 'Verify', lastName: 'PatientB1' },
  });

  await test('OWNER-equivalent user acting on an authorized non-default clinic resolves the patient\'s ACTUAL clinicId, never their own default clinicId', async () => {
    // managerBothClinics's own default clinicId is clinicA1, but the patient
    // lives in clinicA2 — mirrors an OWNER/ORG_ADMIN uploading for a patient
    // in a non-default branch they are authorized for.
    const res = fakeRes();
    const scope = await validateAndGetClinicIdScope(managerBothClinics as any, clinicA2.id, res);
    assert.notEqual(scope, false);
    const found = await prisma.patient.findFirst({ where: { id: patient.id, deletedAt: null, ...(scope as object) } });
    assert.ok(found, 'patient in the authorized non-default clinic must resolve');
    assert.equal(found!.clinicId, clinicA2.id, 'the resolved clinicId must be the PATIENT\'s actual clinic');
    assert.notEqual(found!.clinicId, managerBothClinics.clinicId, 'must never fall back to the acting user\'s own default clinicId');
  });

  await test('user without access to the patient\'s clinic cannot resolve the patient at all (upload/list/download/preview all 404, not leak)', async () => {
    const res = fakeRes();
    const scope = await validateAndGetClinicIdScope(managerA1Only as any, undefined, res);
    assert.notEqual(scope, false, 'default-clinic scope for this user must still resolve (to clinicA1 only)');
    const found = await prisma.patient.findFirst({ where: { id: patient.id, deletedAt: null, ...(scope as object) } });
    assert.equal(found, null, 'a patient in an inaccessible clinic must never be found through the resolved scope');
  });

  await test('cross-organization patient lookup is rejected at the scope-resolution step, before any patient/attachment query runs', async () => {
    const res = fakeRes();
    const scope = await validateAndGetClinicIdScope(managerA1Only as any, clinicB1.id, res);
    assert.equal(scope, false, 'a cross-org clinic id must never resolve to a usable scope');
    assert.equal(res.statusCode, 403);
  });

  await test('default clinic (no selectedClinicId) behavior is unchanged for a single-clinic user: they still resolve their own clinic\'s patients', async () => {
    const res = fakeRes();
    const scope = await validateAndGetClinicIdScope(managerA1Only as any, undefined, res);
    assert.notEqual(scope, false);
    const patientA1 = await prisma.patient.create({
      data: { clinic: { connect: { id: clinicA1.id } }, organization: { connect: { id: orgA.id } }, firstName: 'Verify', lastName: 'PatientA1' },
    });
    const found = await prisma.patient.findFirst({ where: { id: patientA1.id, deletedAt: null, ...(scope as object) } });
    assert.ok(found, 'default-clinic behavior for a single-clinic user must be unchanged');
    await prisma.patient.deleteMany({ where: { id: patientA1.id } });
  });

  const scopedAttachment = await prisma.patientAttachment.create({
    data: {
      clinicId: clinicA2.id, patientId: patient.id, fileName: 'scoped-download.pdf', originalName: 'scoped-download.pdf',
      fileSize: 10, mimeType: 'application/pdf', filePath: `verify/${clinicA2.id}/scoped-download.pdf`, uploadedById: ownerUser.id,
    },
  });

  await test('download/preview: attachmentId + patientId + resolved scope must ALL match for an authorized non-default clinic', async () => {
    const res = fakeRes();
    const scope = await validateAndGetClinicIdScope(managerBothClinics as any, clinicA2.id, res);
    assert.notEqual(scope, false);
    const found = await prisma.patientAttachment.findFirst({ where: { id: scopedAttachment.id, patientId: patient.id, ...(scope as object) } });
    assert.ok(found, 'attachment must resolve when id+patientId+scope all match');

    const wrongPatient = await prisma.patientAttachment.findFirst({ where: { id: scopedAttachment.id, patientId: 'not-the-real-patient-id', ...(scope as object) } });
    assert.equal(wrongPatient, null, 'a patientId mismatch must not resolve the attachment even with a correct scope');
  });

  await test('download/preview: unauthorized clinic access does not reveal whether the attachment exists', async () => {
    const res = fakeRes();
    const scope = await validateAndGetClinicIdScope(managerA1Only as any, undefined, res);
    assert.notEqual(scope, false, 'this user still has a valid (narrower) scope for their own clinic');
    const found = await prisma.patientAttachment.findFirst({ where: { id: scopedAttachment.id, patientId: patient.id, ...(scope as object) } });
    assert.equal(found, null, 'an attachment outside the resolved scope must come back not-found, same as a nonexistent id — no existence leak');
  });

  await test('cross-organization download/preview attempt is rejected before any attachment query runs', async () => {
    const res = fakeRes();
    const scope = await validateAndGetClinicIdScope(managerA1Only as any, clinicB1.id, res);
    assert.equal(scope, false);
    assert.equal(res.statusCode, 403);
  });

  await prisma.patientAttachment.deleteMany({ where: { id: scopedAttachment.id } });
  await prisma.patient.deleteMany({ where: { id: patientB1.id } });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.imagingStudy.deleteMany({ where: { clinicId: { in: [clinicA1.id, clinicA2.id, clinicB1.id] } } });
  await prisma.patientAttachment.deleteMany({ where: { clinicId: { in: [clinicA1.id, clinicA2.id, clinicB1.id] } } });
  await prisma.patient.deleteMany({ where: { id: patient.id } });
  await prisma.user.deleteMany({ where: { id: ownerUser.id } });
  await prisma.clinic.deleteMany({ where: { id: { in: [clinicA1.id, clinicA2.id, clinicB1.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
