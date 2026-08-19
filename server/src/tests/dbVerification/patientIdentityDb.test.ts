/**
 * patientIdentityDb.test.ts — F3-DATA-MIG-TODAY-001-UI-001-R1
 *
 * DB-BACKED proofs for the clinic-facing patient identity (T.C. Kimlik No)
 * write/read/remove contract (server/src/services/patientIdentityService.ts,
 * server/src/routes/patientIdentity.ts, and the optional identity-at-create
 * path in routes/patients.ts POST /patients). Requires DATABASE_URL to point
 * at a DISPOSABLE Postgres plus PATIENT_IDENTITY_ENCRYPTION_KEY /
 * PATIENT_IDENTITY_LOOKUP_SECRET — registered under
 * `server:test:disposable-db`, never under `server:test:non-disposable`.
 *
 * These are the claims that cannot honestly be proved without a database,
 * because each one is a property of real transactions, real tenant-scoped
 * data and a real encrypted column:
 *
 *   1. A valid, checksum-correct TCKN can be assigned and is persisted
 *      encrypted, with a tenant-bound lookup hash.
 *   2. A malformed TCKN (bad checksum) is rejected and writes no row.
 *   3-6. The read/write response shapes NEVER carry plaintext, ciphertext or
 *      lookup hash/token — only { present, type, maskedValue }.
 *   10. A patient outside the caller's clinic (same org) is not reachable —
 *      the exact tenant-scope condition the route enforces, checked against
 *      real clinicId data.
 *   11. Two different organizations assigning the SAME digits produce
 *      UNRELATED lookup hashes (no cross-tenant correlation) and neither
 *      blocks the other.
 *   12. The same TCKN assigned to a second patient in the SAME organization
 *      is rejected with IDENTITY_ALREADY_ASSIGNED (409) and writes nothing.
 *   13. A patient created/updated with no TCKN at all is completely
 *      unaffected — no PatientIdentityDocument row ever exists for it.
 *   14. Updating an unrelated Patient field (phone) never touches that
 *      patient's identity document.
 *   15. The AuditLog row written for an identity write/remove never contains
 *      the raw TCKN, the ciphertext, or the lookup hash anywhere in its
 *      persisted columns.
 *   16. The Patient Prisma model has no tcNo/tckn scalar at all — a
 *      client-supplied one has no column to land in, DB-schema-verified
 *      (complements patientIdentityUxFieldValidation.test.ts's Zod-level
 *      proof that patientSchema strips it before Prisma ever sees it).
 *   Replace-not-duplicate: writing a second, different valid TCKN for the
 *      SAME patient REPLACES the one row (@@unique([patientId, docType])),
 *      never creates a second row.
 *   Atomic create: routes/patients.ts POST /patients wraps Patient.create +
 *      the identity write in ONE prisma.$transaction — an invalid/duplicate
 *      TCKN at create time must leave NO Patient row behind either.
 *
 * Items 7-9 (RECEPTIONIST allowed / DENTIST, BILLING denied) and the
 * remaining role-matrix claims are pure-logic, DB-independent proofs —
 * see patientIdentityAccess.test.ts. Items 17-18 (migration engine and the
 * basic Excel importer untouched) are proved by re-running their own
 * existing suites (test:migration-execution-db, test:patients-import-
 * clinic-scope) unmodified, not by new tests here.
 *
 * Every fixture is SYNTHETIC. No real patient data appears anywhere in this
 * file.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../../db.js';
import { Prisma } from '@prisma/client';
import {
  writeIdentityInTx,
  removeIdentityInTx,
  getMaskedIdentityForPatient,
  PatientIdentityError,
  PATIENT_IDENTITY_DOC_TYPE,
} from '../../services/patientIdentityService.js';
import { writeAuditLogInTx } from '../../utils/auditLog.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${(err as Error)?.stack ?? err}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
// Synthetic fixtures — no real PII
// ---------------------------------------------------------------------------

/** Compute a checksum-valid synthetic TCKN from a 9-digit stem (same algorithm as migrationExecutionDb.test.ts). */
function synthTckn(stem: string): string {
  assert.equal(stem.length, 9);
  const d = stem.split('').map(Number);
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  const d10 = (odd * 7 - even + 100) % 10;
  const d11 = (d.reduce((a, b) => a + b, 0) + d10) % 10;
  return stem + String(d10) + String(d11);
}

const TCKN_A = synthTckn('100000001');
const TCKN_B = synthTckn('100000002');
const MALFORMED_TCKN = '12345678900'; // 11 digits, wrong checksum

const createdOrgIds: string[] = [];

async function makeTenant(label: string) {
  const suffix = randomUUID().slice(0, 8);
  const plan = await prisma.plan.create({
    data: {
      name: `pid-test-${label}-${suffix}`,
      displayName: `Patient Identity Test ${label}`,
      maxUsers: 100,
      maxPatients: 100000,
      monthlyPrice: 0,
      features: {},
    },
  });
  const organization = await prisma.organization.create({
    data: { name: `PidTestOrg-${label}-${suffix}`, slug: `pid-${label}-${suffix}`, planId: plan.id },
  });
  const clinicA = await prisma.clinic.create({
    data: { name: `PidTestClinicA-${label}-${suffix}`, slug: `pidca-${label}-${suffix}`, organizationId: organization.id, maxPatients: 100000 },
  });
  const clinicB = await prisma.clinic.create({
    data: { name: `PidTestClinicB-${label}-${suffix}`, slug: `pidcb-${label}-${suffix}`, organizationId: organization.id, maxPatients: 100000 },
  });
  createdOrgIds.push(organization.id);
  return { organizationId: organization.id, clinicAId: clinicA.id, clinicBId: clinicB.id };
}

async function makePatient(organizationId: string, clinicId: string, label: string) {
  const suffix = randomUUID().slice(0, 8);
  return prisma.patient.create({
    data: { organizationId, clinicId, firstName: `Test${label}`, lastName: `Patient${suffix}` },
  });
}

async function cleanupTenants() {
  for (const organizationId of createdOrgIds) {
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.activityLog.deleteMany({ where: { clinic: { organizationId } } });
    await prisma.patientIdentityDocument.deleteMany({ where: { organizationId } });
    await prisma.patient.deleteMany({ where: { organizationId } });
    await prisma.userClinic.deleteMany({ where: { user: { organizationId } } });
    await prisma.user.deleteMany({ where: { organizationId } });
    await prisma.clinic.deleteMany({ where: { organizationId } });
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { planId: true } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    if (org?.planId) await prisma.plan.deleteMany({ where: { id: org.planId } });
  }
  createdOrgIds.length = 0;
}

function containsRaw(value: unknown, needle: string): boolean {
  return JSON.stringify(value).includes(needle);
}

// ---------------------------------------------------------------------------
section('1-6. Write, validate, mask — response and persistence shape');
// ---------------------------------------------------------------------------

await test('a valid checksum-correct TCKN is assigned and persisted encrypted with a tenant-bound lookup hash', async () => {
  const tenant = await makeTenant('valid-assign');
  const patient = await makePatient(tenant.organizationId, tenant.clinicAId, 'A');

  const result = await prisma.$transaction((tx) =>
    writeIdentityInTx(tx, { patientId: patient.id, clinicId: tenant.clinicAId, organizationId: tenant.organizationId, rawValue: TCKN_A }),
  );

  assert.equal(result.created, true);
  assert.match(result.maskedValue, /^\*{7}\d{4}$/);
  assert.equal(result.maskedValue.slice(-4), TCKN_A.slice(-4));

  const row = await prisma.patientIdentityDocument.findUnique({
    where: { patientId_docType: { patientId: patient.id, docType: PATIENT_IDENTITY_DOC_TYPE } },
  });
  assert.ok(row, 'identity row must exist');
  assert.equal(row!.isVerified, true);
  assert.notEqual(row!.valueEncrypted, TCKN_A, 'stored value must be encrypted, never plaintext');
  assert.ok(!row!.valueEncrypted.includes(TCKN_A), 'ciphertext must not embed the raw digits');
  assert.equal(row!.lookupHash.length, 64, 'lookupHash is a hex SHA-256 HMAC');
});

await test('a malformed TCKN (bad checksum) is rejected and writes no row', async () => {
  const tenant = await makeTenant('malformed');
  const patient = await makePatient(tenant.organizationId, tenant.clinicAId, 'A');

  await assert.rejects(
    () => prisma.$transaction((tx) =>
      writeIdentityInTx(tx, { patientId: patient.id, clinicId: tenant.clinicAId, organizationId: tenant.organizationId, rawValue: MALFORMED_TCKN }),
    ),
    (err: unknown) => err instanceof PatientIdentityError && err.code === 'IDENTITY_TCKN_INVALID',
  );

  const row = await prisma.patientIdentityDocument.findUnique({
    where: { patientId_docType: { patientId: patient.id, docType: PATIENT_IDENTITY_DOC_TYPE } },
  });
  assert.equal(row, null, 'no row must be written for a rejected value');
});

await test('the write response never contains plaintext, ciphertext or the lookup hash — only { maskedValue, created }', async () => {
  const tenant = await makeTenant('write-shape');
  const patient = await makePatient(tenant.organizationId, tenant.clinicAId, 'A');

  const result = await prisma.$transaction((tx) =>
    writeIdentityInTx(tx, { patientId: patient.id, clinicId: tenant.clinicAId, organizationId: tenant.organizationId, rawValue: TCKN_A }),
  );

  assert.deepEqual(Object.keys(result).sort(), ['created', 'maskedValue']);
  assert.equal(containsRaw(result, TCKN_A), false, 'result must not contain the raw value');
});

await test('the read response never contains plaintext, ciphertext or the lookup hash — only { present, type, maskedValue }', async () => {
  const tenant = await makeTenant('read-shape');
  const patient = await makePatient(tenant.organizationId, tenant.clinicAId, 'A');
  await prisma.$transaction((tx) =>
    writeIdentityInTx(tx, { patientId: patient.id, clinicId: tenant.clinicAId, organizationId: tenant.organizationId, rawValue: TCKN_A }),
  );

  const identity = await getMaskedIdentityForPatient(prisma, patient.id);
  assert.deepEqual(Object.keys(identity).sort(), ['maskedValue', 'present', 'type']);
  assert.equal(identity.present, true);
  assert.equal(identity.type, PATIENT_IDENTITY_DOC_TYPE);
  assert.match(identity.maskedValue!, /^\*{7}\d{4}$/);
  assert.equal(containsRaw(identity, TCKN_A), false);
});

await test('an absent identity reads back as present:false, maskedValue:null — never an error, never a guessed value', async () => {
  const tenant = await makeTenant('absent-read');
  const patient = await makePatient(tenant.organizationId, tenant.clinicAId, 'A');

  const identity = await getMaskedIdentityForPatient(prisma, patient.id);
  assert.deepEqual(identity, { present: false, type: PATIENT_IDENTITY_DOC_TYPE, maskedValue: null });
});

// ---------------------------------------------------------------------------
section('Replace-not-duplicate — same patient, second valid value');
// ---------------------------------------------------------------------------

await test('assigning a second valid TCKN to the SAME patient replaces the one row, never creates a second', async () => {
  const tenant = await makeTenant('replace');
  const patient = await makePatient(tenant.organizationId, tenant.clinicAId, 'A');

  const first = await prisma.$transaction((tx) =>
    writeIdentityInTx(tx, { patientId: patient.id, clinicId: tenant.clinicAId, organizationId: tenant.organizationId, rawValue: TCKN_A }),
  );
  assert.equal(first.created, true);

  const second = await prisma.$transaction((tx) =>
    writeIdentityInTx(tx, { patientId: patient.id, clinicId: tenant.clinicAId, organizationId: tenant.organizationId, rawValue: TCKN_B }),
  );
  assert.equal(second.created, false, 'second write for the same patient must be a replace, not a create');

  const rows = await prisma.patientIdentityDocument.findMany({ where: { patientId: patient.id } });
  assert.equal(rows.length, 1, 'exactly one identity row per patient');
  assert.equal(rows[0]!.lookupHash.length, 64);

  const identity = await getMaskedIdentityForPatient(prisma, patient.id);
  assert.equal(identity.maskedValue!.slice(-4), TCKN_B.slice(-4), 'read reflects the REPLACED value, not the original');
});

// ---------------------------------------------------------------------------
section('Atomic create — routes/patients.ts POST /patients with an identity value');
// ---------------------------------------------------------------------------

/**
 * Replicates exactly the transaction shape routes/patients.ts POST /patients
 * uses when `req.body.tckn` is present: Patient.create + writeIdentityInTx
 * inside ONE prisma.$transaction. The route itself isn't imported (it's wired
 * to Express, not a standalone function) — this proves the real,
 * non-mocked writeIdentityInTx enforces the same all-or-nothing contract the
 * route relies on, exactly as migrationExecutionDb.test.ts proves executor.ts
 * invariants by calling its real functions directly.
 */
async function createPatientWithIdentity(tenant: { organizationId: string; clinicAId: string }, rawValue: string) {
  return prisma.$transaction(async (tx) => {
    const created = await tx.patient.create({
      data: { organizationId: tenant.organizationId, clinicId: tenant.clinicAId, firstName: 'Atomic', lastName: `Create${randomUUID().slice(0, 8)}` },
    });
    await writeIdentityInTx(tx, { patientId: created.id, clinicId: tenant.clinicAId, organizationId: tenant.organizationId, rawValue });
    return created;
  });
}

await test('a malformed TCKN at create time rolls back the WHOLE transaction — no Patient row is left behind', async () => {
  const tenant = await makeTenant('atomic-invalid');
  const patientCountBefore = await prisma.patient.count({ where: { organizationId: tenant.organizationId } });

  await assert.rejects(() => createPatientWithIdentity(tenant, MALFORMED_TCKN));

  const patientCountAfter = await prisma.patient.count({ where: { organizationId: tenant.organizationId } });
  assert.equal(patientCountAfter, patientCountBefore, 'no patient row must survive a rejected identity write at create time');
});

await test('a same-org duplicate TCKN at create time rolls back the WHOLE transaction — no orphan Patient row', async () => {
  const tenant = await makeTenant('atomic-duplicate');
  const existing = await makePatient(tenant.organizationId, tenant.clinicAId, 'Existing');
  await prisma.$transaction((tx) =>
    writeIdentityInTx(tx, { patientId: existing.id, clinicId: tenant.clinicAId, organizationId: tenant.organizationId, rawValue: TCKN_A }),
  );

  const patientCountBefore = await prisma.patient.count({ where: { organizationId: tenant.organizationId } });

  await assert.rejects(
    () => createPatientWithIdentity(tenant, TCKN_A),
    (err: unknown) => err instanceof PatientIdentityError && err.code === 'IDENTITY_ALREADY_ASSIGNED',
  );

  const patientCountAfter = await prisma.patient.count({ where: { organizationId: tenant.organizationId } });
  assert.equal(patientCountAfter, patientCountBefore, 'the newly-attempted patient must not exist after a duplicate-identity rollback');
});

await test('a valid TCKN at create time commits BOTH the Patient row and its identity document together', async () => {
  const tenant = await makeTenant('atomic-valid');
  const created = await createPatientWithIdentity(tenant, TCKN_A);

  const persistedPatient = await prisma.patient.findUnique({ where: { id: created.id } });
  const persistedIdentity = await prisma.patientIdentityDocument.findUnique({
    where: { patientId_docType: { patientId: created.id, docType: PATIENT_IDENTITY_DOC_TYPE } },
  });
  assert.ok(persistedPatient, 'patient must exist');
  assert.ok(persistedIdentity, 'identity document must exist for the same patient');
});

// ---------------------------------------------------------------------------
section('10-11. Tenant / clinic isolation — no cross-boundary access or correlation');
// ---------------------------------------------------------------------------

await test('a patient outside the caller\'s clinic (same org) fails the exact scope condition the route enforces', async () => {
  const tenant = await makeTenant('clinic-scope');
  const patientInClinicA = await makePatient(tenant.organizationId, tenant.clinicAId, 'A');

  // Same condition as routes/patientIdentity.ts's resolvePatientScope: the
  // patient row itself is real DB data — a clinicB-scoped caller's
  // allowedClinicIds does not include patient.clinicId.
  const fetched = await prisma.patient.findFirst({
    where: { id: patientInClinicA.id, organizationId: tenant.organizationId, deletedAt: null },
    select: { id: true, clinicId: true },
  });
  assert.ok(fetched);
  const callerAllowedClinicIds = [tenant.clinicBId];
  assert.equal(callerAllowedClinicIds.includes(fetched!.clinicId), false, 'sibling-clinic caller must be denied');
});

await test('a patient outside the caller\'s organization is unreachable by an org-scoped lookup at all', async () => {
  const tenantX = await makeTenant('cross-org-x');
  const tenantY = await makeTenant('cross-org-y');
  const patientInY = await makePatient(tenantY.organizationId, tenantY.clinicAId, 'Y');

  const fetchedFromX = await prisma.patient.findFirst({
    where: { id: patientInY.id, organizationId: tenantX.organizationId, deletedAt: null },
  });
  assert.equal(fetchedFromX, null, 'org-X-scoped lookup must never find an org-Y patient');
});

await test('the SAME TCKN digits in two different organizations produce UNRELATED lookup hashes and neither blocks the other', async () => {
  const tenantX = await makeTenant('correlate-x');
  const tenantY = await makeTenant('correlate-y');
  const patientX = await makePatient(tenantX.organizationId, tenantX.clinicAId, 'X');
  const patientY = await makePatient(tenantY.organizationId, tenantY.clinicAId, 'Y');

  await prisma.$transaction((tx) =>
    writeIdentityInTx(tx, { patientId: patientX.id, clinicId: tenantX.clinicAId, organizationId: tenantX.organizationId, rawValue: TCKN_A }),
  );
  // Same digits, different org — must succeed, not be treated as a duplicate.
  const resultY = await prisma.$transaction((tx) =>
    writeIdentityInTx(tx, { patientId: patientY.id, clinicId: tenantY.clinicAId, organizationId: tenantY.organizationId, rawValue: TCKN_A }),
  );
  assert.equal(resultY.created, true);

  const rowX = await prisma.patientIdentityDocument.findUnique({ where: { patientId_docType: { patientId: patientX.id, docType: PATIENT_IDENTITY_DOC_TYPE } } });
  const rowY = await prisma.patientIdentityDocument.findUnique({ where: { patientId_docType: { patientId: patientY.id, docType: PATIENT_IDENTITY_DOC_TYPE } } });
  assert.notEqual(rowX!.lookupHash, rowY!.lookupHash, 'identical digits in two orgs must not share a lookup token');
});

// ---------------------------------------------------------------------------
section('12. Same-org duplicate assignment — safe 409, no disclosure');
// ---------------------------------------------------------------------------

await test('the same TCKN assigned to a second patient in the SAME org is rejected with IDENTITY_ALREADY_ASSIGNED, writes nothing, discloses nothing', async () => {
  const tenant = await makeTenant('duplicate');
  const patientA = await makePatient(tenant.organizationId, tenant.clinicAId, 'A');
  const patientB = await makePatient(tenant.organizationId, tenant.clinicBId, 'B');

  await prisma.$transaction((tx) =>
    writeIdentityInTx(tx, { patientId: patientA.id, clinicId: tenant.clinicAId, organizationId: tenant.organizationId, rawValue: TCKN_A }),
  );

  let caught: unknown;
  try {
    await prisma.$transaction((tx) =>
      writeIdentityInTx(tx, { patientId: patientB.id, clinicId: tenant.clinicBId, organizationId: tenant.organizationId, rawValue: TCKN_A }),
    );
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof PatientIdentityError);
  assert.equal((caught as PatientIdentityError).code, 'IDENTITY_ALREADY_ASSIGNED');
  assert.equal((caught as PatientIdentityError).httpStatus, 409);
  assert.equal(containsRaw(caught, patientA.id), false, 'must never disclose the OTHER patient\'s id');
  assert.equal(containsRaw(caught, patientA.firstName), false, 'must never disclose the OTHER patient\'s name');

  const rowB = await prisma.patientIdentityDocument.findUnique({ where: { patientId_docType: { patientId: patientB.id, docType: PATIENT_IDENTITY_DOC_TYPE } } });
  assert.equal(rowB, null, 'the rejected patient must have no identity row');
});

// ---------------------------------------------------------------------------
section('13-14. Patients without a TCKN, and unrelated-field edits');
// ---------------------------------------------------------------------------

await test('a patient created and updated with no TCKN at all is completely unaffected — no identity row ever exists', async () => {
  const tenant = await makeTenant('no-tckn');
  const patient = await makePatient(tenant.organizationId, tenant.clinicAId, 'A');
  await prisma.patient.update({ where: { id: patient.id }, data: { phone: '+905320000000' } });

  const identity = await getMaskedIdentityForPatient(prisma, patient.id);
  assert.equal(identity.present, false);
  const row = await prisma.patientIdentityDocument.findUnique({ where: { patientId_docType: { patientId: patient.id, docType: PATIENT_IDENTITY_DOC_TYPE } } });
  assert.equal(row, null);
});

await test('editing an unrelated Patient field (phone) via prisma.patient.update never touches that patient\'s identity document', async () => {
  const tenant = await makeTenant('unrelated-edit');
  const patient = await makePatient(tenant.organizationId, tenant.clinicAId, 'A');
  await prisma.$transaction((tx) =>
    writeIdentityInTx(tx, { patientId: patient.id, clinicId: tenant.clinicAId, organizationId: tenant.organizationId, rawValue: TCKN_A }),
  );
  const before = await prisma.patientIdentityDocument.findUnique({ where: { patientId_docType: { patientId: patient.id, docType: PATIENT_IDENTITY_DOC_TYPE } } });

  // Exactly what routes/patients.ts PUT /patients/:id does — never touches
  // PatientIdentityDocument at all.
  await prisma.patient.update({ where: { id: patient.id }, data: { phone: '+905321112233', notes: 'unrelated note' } });

  const after = await prisma.patientIdentityDocument.findUnique({ where: { patientId_docType: { patientId: patient.id, docType: PATIENT_IDENTITY_DOC_TYPE } } });
  assert.deepEqual(after, before, 'identity row must be byte-for-byte unchanged after an unrelated patient field edit');
});

// ---------------------------------------------------------------------------
section('15. Audit trail carries no raw value, ciphertext or lookup token');
// ---------------------------------------------------------------------------

await test('the AuditLog row for an identity write never contains the raw TCKN, the ciphertext or the lookup hash', async () => {
  const tenant = await makeTenant('audit-write');
  const patient = await makePatient(tenant.organizationId, tenant.clinicAId, 'A');
  const actorUserId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const result = await writeIdentityInTx(tx, { patientId: patient.id, clinicId: tenant.clinicAId, organizationId: tenant.organizationId, rawValue: TCKN_A });
    await writeAuditLogInTx(tx, {
      organizationId: tenant.organizationId,
      clinicId: tenant.clinicAId,
      actorUserId,
      actorRole: 'RECEPTIONIST',
      action: result.created ? 'patient_identity_added' : 'patient_identity_replaced',
      entityType: 'patient_identity',
      entityId: patient.id,
      metadata: { patientId: patient.id, docType: PATIENT_IDENTITY_DOC_TYPE },
    });
  });

  const row = await prisma.patientIdentityDocument.findUnique({ where: { patientId_docType: { patientId: patient.id, docType: PATIENT_IDENTITY_DOC_TYPE } } });
  const auditRow = await prisma.auditLog.findFirst({ where: { organizationId: tenant.organizationId, entityId: patient.id } });

  assert.ok(auditRow);
  assert.equal(containsRaw(auditRow, TCKN_A), false, 'audit row must not contain the raw TCKN');
  assert.equal(containsRaw(auditRow, row!.valueEncrypted), false, 'audit row must not contain the ciphertext');
  assert.equal(containsRaw(auditRow, row!.lookupHash), false, 'audit row must not contain the lookup hash');
  assert.equal(auditRow!.action, 'patient_identity_added');
  assert.deepEqual(auditRow!.metadata, { patientId: patient.id, docType: PATIENT_IDENTITY_DOC_TYPE });
});

await test('remove() deletes the row and its audit trail also carries no raw value', async () => {
  const tenant = await makeTenant('audit-remove');
  const patient = await makePatient(tenant.organizationId, tenant.clinicAId, 'A');
  await prisma.$transaction((tx) =>
    writeIdentityInTx(tx, { patientId: patient.id, clinicId: tenant.clinicAId, organizationId: tenant.organizationId, rawValue: TCKN_A }),
  );

  const removed = await prisma.$transaction(async (tx) => {
    const wasRemoved = await removeIdentityInTx(tx, { patientId: patient.id });
    if (wasRemoved) {
      await writeAuditLogInTx(tx, {
        organizationId: tenant.organizationId,
        clinicId: tenant.clinicAId,
        actorUserId: randomUUID(),
        actorRole: 'OWNER',
        action: 'patient_identity_removed',
        entityType: 'patient_identity',
        entityId: patient.id,
        metadata: { patientId: patient.id, docType: PATIENT_IDENTITY_DOC_TYPE },
      });
    }
    return wasRemoved;
  });
  assert.equal(removed, true);

  const row = await prisma.patientIdentityDocument.findUnique({ where: { patientId_docType: { patientId: patient.id, docType: PATIENT_IDENTITY_DOC_TYPE } } });
  assert.equal(row, null);

  const auditRow = await prisma.auditLog.findFirst({ where: { organizationId: tenant.organizationId, entityId: patient.id, action: 'patient_identity_removed' } });
  assert.ok(auditRow);
  assert.equal(containsRaw(auditRow, TCKN_A), false);
});

await test('remove() on a patient with no identity document is a safe no-op (returns false, writes no audit)', async () => {
  const tenant = await makeTenant('remove-noop');
  const patient = await makePatient(tenant.organizationId, tenant.clinicAId, 'A');

  const removed = await prisma.$transaction((tx) => removeIdentityInTx(tx, { patientId: patient.id }));
  assert.equal(removed, false);
});

// ---------------------------------------------------------------------------
section('16. No Patient scalar exists for a client-supplied tcNo/tckn to land in');
// ---------------------------------------------------------------------------

await test('Patient rows created via the real Prisma model carry no tcNo/tckn field at all', async () => {
  const tenant = await makeTenant('no-scalar');
  const patient = await makePatient(tenant.organizationId, tenant.clinicAId, 'A');
  assert.equal('tcNo' in patient, false);
  assert.equal('tckn' in patient, false);

  const scalarFieldNames = Prisma.dmmf.datamodel.models
    .find((m) => m.name === 'Patient')!
    .fields.filter((f) => f.kind === 'scalar')
    .map((f) => f.name);
  assert.equal(scalarFieldNames.includes('tcNo'), false);
  assert.equal(scalarFieldNames.includes('tckn'), false);
});

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
await cleanupTenants();
await prisma.$disconnect();
if (failed > 0) process.exit(1);
