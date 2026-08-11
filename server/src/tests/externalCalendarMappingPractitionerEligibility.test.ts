/**
 * externalCalendarMappingPractitionerEligibility.test.ts — F3-DIGIDENTIS-MAP-001-R1
 *
 * Closes the write-path gap architecture review found in the R1 pass of
 * F3-DIGIDENTIS-MAP-001: the local-options dropdown (platformExternalCalendar.ts)
 * only ever listed eligible practitioners, but externalCalendarMappingService.ts's
 * verifyLocalEntityBelongsToClinic() accepted ANY active clinic user as a
 * mappingType='practitioner' — so a direct API call could map a receptionist,
 * clinic manager, or billing user to a DigiDentiS doctor even though the UI no
 * longer listed them.
 *
 * Both call sites now delegate to one shared contract —
 * findClinicPractitioner()/listClinicPractitioners() in utils/relationGuards.ts —
 * so this suite proves the write path (upsertExternalCalendarMapping) rejects
 * exactly the same users the dropdown (listClinicPractitioners) would omit, and
 * accepts exactly the same users it would list. Scenario letters below match the
 * architecture-review remediation brief.
 *
 * Run with: npx tsx src/tests/externalCalendarMappingPractitionerEligibility.test.ts
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

// ── In-memory Prisma fakes ──────────────────────────────────────────────────

type UserRow = { id: string; firstName: string; lastName: string; role: string; clinicId: string; isActive: boolean };
type UserClinicRow = { userId: string; clinicId: string; role: string; isActive: boolean };

const users: UserRow[] = [
  // A — branch-scoped eligible dentist: org-wide role is NOT a practitioner role,
  // only the UserClinic.role for clinic-A grants eligibility.
  { id: 'user-branch-dentist', firstName: 'Ada', lastName: 'Yilmaz', role: 'ASSISTANT', clinicId: 'clinic-X', isActive: true },
  // B — legacy eligible dentist: primary User.clinicId + legacy lowercase role, no UserClinic row at all.
  { id: 'user-legacy-dentist', firstName: 'Berk', lastName: 'Demir', role: 'doctor', clinicId: 'clinic-A', isActive: true },
  // C — receptionist in the same clinic
  { id: 'user-receptionist', firstName: 'Cem', lastName: 'Kaya', role: 'RECEPTIONIST', clinicId: 'clinic-A', isActive: true },
  // D — clinic manager in the same clinic
  { id: 'user-clinic-manager', firstName: 'Deniz', lastName: 'Aydin', role: 'CLINIC_MANAGER', clinicId: 'clinic-A', isActive: true },
  // E — billing (non-practitioner) in the same clinic
  { id: 'user-billing', firstName: 'Ela', lastName: 'Sonmez', role: 'billing', clinicId: 'clinic-A', isActive: true },
  // F — inactive dentist in the same clinic
  { id: 'user-inactive-dentist', firstName: 'Firat', lastName: 'Demirtas', role: 'DENTIST', clinicId: 'clinic-A', isActive: false },
  // G — dentist in a different clinic, different organization
  { id: 'user-other-org-dentist', firstName: 'Gul', lastName: 'Aksoy', role: 'DENTIST', clinicId: 'clinic-B', isActive: true },
  // G — dentist in a different clinic, SAME organization as clinic-A
  { id: 'user-other-clinic-dentist', firstName: 'Hakan', lastName: 'Polat', role: 'DENTIST', clinicId: 'clinic-C', isActive: true },
];

const userClinics: UserClinicRow[] = [
  { userId: 'user-branch-dentist', clinicId: 'clinic-A', role: 'dentist', isActive: true },
];

(prisma as any).userClinic = {
  async findFirst({ where }: any) {
    return this._all(where)[0] ?? null;
  },
  async findMany({ where }: any) {
    return this._all(where);
  },
  _all(where: any) {
    const roleIn: string[] = where.role.in;
    return userClinics
      .filter((uc) => {
        if (where.userId !== undefined && uc.userId !== where.userId) return false;
        if (uc.clinicId !== where.clinicId) return false;
        if (uc.isActive !== where.isActive) return false;
        if (!roleIn.includes(uc.role)) return false;
        const owner = users.find((u) => u.id === uc.userId);
        if (!owner || owner.isActive !== where.user.isActive) return false;
        return true;
      })
      .map((uc) => ({ userId: uc.userId, user: users.find((u) => u.id === uc.userId) }));
  },
};

(prisma as any).user = {
  async findFirst({ where }: any) {
    const roleIn: string[] = where.role.in;
    return (
      users.find(
        (u) =>
          u.id === where.id &&
          u.clinicId === where.clinicId &&
          u.isActive === where.isActive &&
          roleIn.includes(u.role),
      ) ?? null
    );
  },
  async findMany({ where }: any) {
    const roleIn: string[] = where.role.in;
    const notIn: string[] = where.id?.notIn ?? [];
    return users
      .filter((u) => u.clinicId === where.clinicId && u.isActive === where.isActive && roleIn.includes(u.role) && !notIn.includes(u.id))
      .map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName }));
  },
};

// The mapping write-path (upsertExternalCalendarMapping) also touches these models.
type MappingRow = {
  id: string; connectionId: string; organizationId: string; clinicId: string; mappingType: string;
  localId: string; externalId: string; externalLabel: string | null; isActive: boolean; createdAt: Date; updatedAt: Date;
};
let mappings: MappingRow[] = [];
let seq = 0;

(prisma as any).externalCalendarMapping = {
  async findFirst({ where }: any) {
    return (
      mappings.find((m) => {
        if (where.connectionId !== undefined && m.connectionId !== where.connectionId) return false;
        if (where.mappingType !== undefined && m.mappingType !== where.mappingType) return false;
        if (where.localId !== undefined && m.localId !== where.localId) return false;
        return true;
      }) ?? null
    );
  },
  async upsert({ where, create, update }: any) {
    const key = where.connectionId_mappingType_localId;
    const existing = mappings.find(
      (m) => m.connectionId === key.connectionId && m.mappingType === key.mappingType && m.localId === key.localId,
    );
    if (existing) {
      Object.assign(existing, update, { updatedAt: new Date() });
      return existing;
    }
    const row: MappingRow = {
      id: `map-${++seq}`,
      connectionId: create.connectionId,
      organizationId: create.organizationId,
      clinicId: create.clinicId,
      mappingType: create.mappingType,
      localId: create.localId,
      externalId: create.externalId,
      externalLabel: create.externalLabel ?? null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mappings.push(row);
    return row;
  },
};

(prisma as any).auditLog = {
  async create({ data }: any) {
    return data;
  },
};

// ── Import that depends on the mocked prisma above (must come after it) ────

const { findClinicPractitioner, listClinicPractitioners } = await import('../utils/relationGuards.js');
const {
  upsertExternalCalendarMapping,
  ExternalCalendarMappingLocalEntityInvalidError,
} = await import('../services/externalCalendar/externalCalendarMappingService.js');

const REJECTED = [
  ['C', 'user-receptionist', 'receptionist in the same clinic'],
  ['D', 'user-clinic-manager', 'clinic manager in the same clinic'],
  ['E', 'user-billing', 'billing (non-practitioner) user in the same clinic'],
  ['F', 'user-inactive-dentist', 'inactive dentist'],
  ['G', 'user-other-org-dentist', 'dentist in a different clinic, different organization'],
  ['G', 'user-other-clinic-dentist', 'dentist in a different clinic, same organization'],
] as const;

const ACCEPTED = [
  ['A', 'user-branch-dentist', 'branch-scoped UserClinic.role="dentist" eligible dentist'],
  ['B', 'user-legacy-dentist', 'legacy User.clinicId + role="doctor" eligible dentist'],
] as const;

section('findClinicPractitioner — single-user eligibility (mirrors mapping write-path check)');

for (const [letter, userId, label] of ACCEPTED) {
  await test(`${letter}: ${label} is eligible for clinic-A`, async () => {
    const result = await findClinicPractitioner(userId, 'clinic-A');
    assert.ok(result, `expected ${userId} to be eligible`);
    assert.equal(result!.id, userId);
  });
}

for (const [letter, userId, label] of REJECTED) {
  await test(`${letter}: ${label} is NOT eligible for clinic-A`, async () => {
    const result = await findClinicPractitioner(userId, 'clinic-A');
    assert.equal(result, null, `expected ${userId} to be rejected`);
  });
}

section('listClinicPractitioners — dropdown listing matches the same rule');

await test('clinic-A dropdown lists exactly the two eligible dentists, sorted by name', async () => {
  const list = await listClinicPractitioners('clinic-A');
  assert.deepEqual(
    list.map((p) => p.id),
    ['user-branch-dentist', 'user-legacy-dentist'],
  );
});

section('Write-path (upsertExternalCalendarMapping) — the actual blocking-finding regression');

for (const [letter, userId, label] of ACCEPTED) {
  await test(`${letter}: mapping ${label} to a DigiDentiS doctor SUCCEEDS`, async () => {
    const mapping = await upsertExternalCalendarMapping('conn-A', 'clinic-A', 'org-A', {
      mappingType: 'practitioner',
      localId: userId,
      externalId: `ext-${userId}`,
    });
    assert.equal(mapping.localId, userId);
  });
}

for (const [letter, userId, label] of REJECTED) {
  await test(`${letter}: mapping ${label} to a DigiDentiS doctor is REJECTED`, async () => {
    await assert.rejects(
      () =>
        upsertExternalCalendarMapping('conn-A', 'clinic-A', 'org-A', {
          mappingType: 'practitioner',
          localId: userId,
          externalId: `ext-${userId}`,
        }),
      ExternalCalendarMappingLocalEntityInvalidError,
    );
  });
}

section('I: local-options and mapping validation use the same eligibility semantics');

await test('every user accepted by the write path is present in the dropdown listing, and vice versa', async () => {
  const listedIds = new Set((await listClinicPractitioners('clinic-A')).map((p) => p.id));
  for (const [, userId] of ACCEPTED) {
    assert.ok(listedIds.has(userId), `${userId} was accepted by the write path but is missing from the dropdown listing`);
  }
  for (const [, userId] of REJECTED) {
    assert.ok(!listedIds.has(userId), `${userId} was rejected by the write path but appears in the dropdown listing`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
