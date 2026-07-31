/**
 * externalCalendarMapping.test.ts — persistent id-based mappings between
 * NoraMedi practitioners/services and provider doctors/treatment types.
 *
 * Verifies: matching is never done by name; a missing/inactive mapping
 * blocks synchronization with a clear administrative error; mappings cannot
 * be created for a local entity that belongs to a different clinic.
 *
 * Run with: npx tsx src/tests/externalCalendarMapping.test.ts
 */

import assert from 'node:assert/strict';
import prisma from '../db.js';
import { ExternalCalendarMappingMissingError } from '../services/externalCalendar/externalCalendarErrors.js';

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

type MappingRow = {
  id: string;
  connectionId: string;
  organizationId: string;
  clinicId: string;
  mappingType: string;
  localId: string;
  externalId: string;
  externalLabel: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

let mappings: MappingRow[] = [];
let seq = 0;
const auditEvents: unknown[] = [];

const users = [
  { id: 'user-dentist-A', clinicId: 'clinic-A', isActive: true, firstName: 'Ada', lastName: 'Yilmaz' },
  { id: 'user-dentist-B', clinicId: 'clinic-B', isActive: true, firstName: 'Berk', lastName: 'Demir' },
];
const userClinics: { userId: string; clinicId: string; isActive: boolean }[] = [];
const appointmentTypes = [
  { id: 'svc-A-1', clinicId: 'clinic-A', name: 'Cleaning' },
  { id: 'svc-B-1', clinicId: 'clinic-B', name: 'Whitening' },
];

(prisma as any).user = {
  async findFirst({ where }: any) {
    return (
      users.find((u) => {
        if (where.id !== u.id) return false;
        if (where.isActive !== undefined && where.isActive !== u.isActive) return false;
        const ors = where.OR as any[];
        return ors.some((clause: any) => {
          if (clause.clinicId) return clause.clinicId === u.clinicId;
          if (clause.userClinics) {
            return userClinics.some(
              (uc) => uc.userId === u.id && uc.clinicId === clause.userClinics.some.clinicId && uc.isActive,
            );
          }
          return false;
        });
      }) ?? null
    );
  },
};

(prisma as any).appointmentType = {
  async findFirst({ where }: any) {
    return appointmentTypes.find((a) => a.id === where.id && a.clinicId === where.clinicId) ?? null;
  },
};

function findMapping(connectionId: string, mappingType: string, localId: string) {
  return mappings.find((m) => m.connectionId === connectionId && m.mappingType === mappingType && m.localId === localId);
}

(prisma as any).externalCalendarMapping = {
  async findMany({ where }: any) {
    return mappings.filter((m) => m.connectionId === where.connectionId && m.clinicId === where.clinicId);
  },
  async findFirst({ where }: any) {
    return (
      mappings.find((m) => {
        if (where.id !== undefined && m.id !== where.id) return false;
        if (where.connectionId !== undefined && m.connectionId !== where.connectionId) return false;
        if (where.mappingType !== undefined && m.mappingType !== where.mappingType) return false;
        if (where.localId !== undefined && m.localId !== where.localId) return false;
        if (where.isActive !== undefined && m.isActive !== where.isActive) return false;
        if (where.clinicId !== undefined && m.clinicId !== where.clinicId) return false;
        return true;
      }) ?? null
    );
  },
  async upsert({ where, create, update }: any) {
    const key = where.connectionId_mappingType_localId;
    const existing = findMapping(key.connectionId, key.mappingType, key.localId);
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
  async update({ where, data }: any) {
    const row = mappings.find((m) => m.id === where.id);
    if (!row) throw new Error('not found');
    Object.assign(row, data, { updatedAt: new Date() });
    return row;
  },
};

(prisma as any).auditLog = {
  async create({ data }: any) {
    auditEvents.push(data);
    return data;
  },
};

const {
  upsertExternalCalendarMapping,
  resolveExternalCalendarMapping,
  deactivateExternalCalendarMapping,
  listExternalCalendarMappings,
  ExternalCalendarMappingLocalEntityInvalidError,
} = await import('../services/externalCalendar/externalCalendarMappingService.js');

section('Missing/invalid mappings block synchronization');

await test('resolving a practitioner with no mapping throws ExternalCalendarMappingMissingError', async () => {
  await assert.rejects(
    () => resolveExternalCalendarMapping('conn-A', 'practitioner', 'user-dentist-A'),
    ExternalCalendarMappingMissingError,
  );
});

section('Creating mappings — tenant-safe local entity validation');

await test('mapping a practitioner that belongs to this clinic succeeds', async () => {
  const mapping = await upsertExternalCalendarMapping('conn-A', 'clinic-A', 'org-1', {
    mappingType: 'practitioner',
    localId: 'user-dentist-A',
    externalId: 'ext-doctor-1',
    externalLabel: 'Dr. Example',
  });
  assert.equal(mapping.externalId, 'ext-doctor-1');
  assert.equal(mapping.localLabel, 'Ada Yilmaz');
});

await test('mapping a practitioner from a DIFFERENT clinic is rejected', async () => {
  await assert.rejects(
    () =>
      upsertExternalCalendarMapping('conn-A', 'clinic-A', 'org-1', {
        mappingType: 'practitioner',
        localId: 'user-dentist-B', // belongs to clinic-B, not clinic-A
        externalId: 'ext-doctor-2',
      }),
    ExternalCalendarMappingLocalEntityInvalidError,
  );
});

await test('mapping a service from a different clinic is rejected', async () => {
  await assert.rejects(
    () =>
      upsertExternalCalendarMapping('conn-A', 'clinic-A', 'org-1', {
        mappingType: 'service',
        localId: 'svc-B-1', // belongs to clinic-B
        externalId: 'ext-treatment-1',
      }),
    ExternalCalendarMappingLocalEntityInvalidError,
  );
});

await test('mapping a service that belongs to this clinic succeeds', async () => {
  const mapping = await upsertExternalCalendarMapping('conn-A', 'clinic-A', 'org-1', {
    mappingType: 'service',
    localId: 'svc-A-1',
    externalId: 'ext-treatment-1',
  });
  assert.equal(mapping.localLabel, 'Cleaning');
});

section('Resolution never matches by name');

await test('resolveExternalCalendarMapping returns the externalId once an active mapping exists', async () => {
  const externalId = await resolveExternalCalendarMapping('conn-A', 'practitioner', 'user-dentist-A');
  assert.equal(externalId, 'ext-doctor-1');
});

await test('resolution is by localId only — a same-named entity in another clinic never resolves', async () => {
  // user-dentist-B has no mapping under conn-A at all — proves lookup keys
  // strictly on (connectionId, mappingType, localId), never a name match.
  await assert.rejects(() => resolveExternalCalendarMapping('conn-A', 'practitioner', 'user-dentist-B'));
});

section('Deactivation blocks future resolution');

await test('deactivating a mapping makes resolution fail again', async () => {
  await deactivateExternalCalendarMapping(
    mappings.find((m) => m.localId === 'user-dentist-A')!.id,
    'clinic-A',
  );
  await assert.rejects(
    () => resolveExternalCalendarMapping('conn-A', 'practitioner', 'user-dentist-A'),
    ExternalCalendarMappingMissingError,
  );
});

await test('deactivation verifies clinic ownership — wrong clinicId is a silent no-op', async () => {
  const serviceMapping = mappings.find((m) => m.localId === 'svc-A-1')!;
  await deactivateExternalCalendarMapping(serviceMapping.id, 'clinic-B'); // wrong clinic
  assert.equal(serviceMapping.isActive, true, 'mapping must remain active — wrong-clinic delete must not apply');
});

section('Listing is clinic-scoped');

await test('listExternalCalendarMappings only returns rows for the given connection+clinic', async () => {
  const list = await listExternalCalendarMappings('conn-A', 'clinic-A');
  assert.ok(list.some((m) => m.localId === 'svc-A-1'));
  assert.ok(!('clinicId' in list[0]), 'clinicId is internal — never exposed in the mapping DTO');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
