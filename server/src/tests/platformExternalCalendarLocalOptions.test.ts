/**
 * platformExternalCalendarLocalOptions.test.ts — real-HTTP regression coverage
 * for GET /api/platform/clinics/:clinicId/external-calendar/local-options
 * (routes/platformExternalCalendar.ts), the endpoint that populates the
 * NoraMedi-side practitioner/service dropdowns on the DigiDentiS mapping
 * screen (F3-DIGIDENTIS-MAP-001).
 *
 * Root cause under test: the original query filtered strictly on
 * `role: 'DENTIST'` against User.role. Per utils/roles.ts's own documented
 * normalization table, dentists can be stored with a legacy lowercase role
 * ('doctor' / 'dentist') and/or have their effective role for a given clinic
 * come from UserClinic.role (branch assignment) rather than their org-wide
 * User.role — exactly the same two conditions routes/whatsapp.ts's
 * getClinicPractitioners() already accounts for. The strict-equality filter
 * silently excluded every such dentist, producing an empty dropdown despite
 * active, eligible dentists existing for the clinic.
 *
 * Harness: no live Postgres in this environment (same documented constraint
 * as externalCalendarWebhookRouteE2E.test.ts) — prisma's model delegates are
 * swapped for small in-memory fakes for the duration of this process, and
 * the router is dynamically imported AFTER that swap so every prisma call it
 * makes hits the fakes. A real express() app mounts the real, unmodified
 * router on `app.listen(0)`, driven with real node:http requests, exactly as
 * production mounts it (server/src/index.ts:199).
 *
 * Run with: npx tsx src/tests/platformExternalCalendarLocalOptions.test.ts
 */

process.env.PLATFORM_BEARER_FALLBACK_ENABLED = 'true';

import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import prisma from '../db.js';
import { generatePlatformToken } from '../middleware/platformAuth.js';

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

type ClinicRow = { id: string; organizationId: string };
type UserRow = { id: string; firstName: string; lastName: string; role: string; clinicId: string; isActive: boolean };
type UserClinicRow = { id: string; userId: string; clinicId: string; role: string; isActive: boolean };
type AppointmentTypeRow = { id: string; clinicId: string; name: string; isActive: boolean };

const clinics = new Map<string, ClinicRow>([
  ['clinic-A', { id: 'clinic-A', organizationId: 'org-A' }], // target clinic under test
  ['clinic-B', { id: 'clinic-B', organizationId: 'org-B' }], // different clinic, different org
  ['clinic-C', { id: 'clinic-C', organizationId: 'org-A' }], // different clinic, SAME org as clinic-A
  ['clinic-D', { id: 'clinic-D', organizationId: 'org-D' }], // exactly one eligible dentist
  ['clinic-E', { id: 'clinic-E', organizationId: 'org-E' }], // zero eligible dentists
]);

const users: UserRow[] = [
  { id: 'user-1', firstName: 'Ada', lastName: 'Yilmaz', role: 'DENTIST', clinicId: 'clinic-A', isActive: true },
  // Legacy lowercase role — this is the exact shape that a strict `role: 'DENTIST'` filter drops.
  { id: 'user-2', firstName: 'Berk', lastName: 'Demir', role: 'doctor', clinicId: 'clinic-A', isActive: true },
  { id: 'user-3', firstName: 'Cem', lastName: 'Kaya', role: 'RECEPTIONIST', clinicId: 'clinic-A', isActive: true },
  { id: 'user-4', firstName: 'Deniz', lastName: 'Aydin', role: 'DENTIST', clinicId: 'clinic-A', isActive: false },
  // Org-wide role is RECEPTIONIST; only eligible via a branch-scoped UserClinic.role of 'dentist' for clinic-A.
  { id: 'user-5', firstName: 'Ela', lastName: 'Sonmez', role: 'RECEPTIONIST', clinicId: 'clinic-X', isActive: true },
  { id: 'user-6', firstName: 'Firat', lastName: 'Demirtas', role: 'DENTIST', clinicId: 'clinic-B', isActive: true },
  { id: 'user-7', firstName: 'Gul', lastName: 'Aksoy', role: 'DENTIST', clinicId: 'clinic-C', isActive: true },
  { id: 'user-8', firstName: 'Hakan', lastName: 'Polat', role: 'DENTIST', clinicId: 'clinic-D', isActive: true },
];

const userClinics: UserClinicRow[] = [
  { id: 'uc-1', userId: 'user-5', clinicId: 'clinic-A', role: 'dentist', isActive: true },
];

const appointmentTypes: AppointmentTypeRow[] = [
  { id: 'svc-1', clinicId: 'clinic-A', name: 'Cleaning', isActive: true },
  { id: 'svc-2', clinicId: 'clinic-A', name: 'Retired Service', isActive: false },
  { id: 'svc-3', clinicId: 'clinic-A', name: 'Whitening', isActive: true },
];

(prisma as any).clinic = {
  async findUnique({ where }: any) {
    return clinics.get(where.id) ?? null;
  },
};

(prisma as any).userClinic = {
  async findMany({ where }: any) {
    const roleIn: string[] = where.role.in;
    return userClinics
      .filter((uc) => uc.clinicId === where.clinicId && uc.isActive === where.isActive && roleIn.includes(uc.role))
      .map((uc) => {
        const user = users.find((u) => u.id === uc.userId);
        if (!user || user.isActive !== where.user.isActive) return null;
        return { userId: uc.userId, user: { id: user.id, firstName: user.firstName, lastName: user.lastName } };
      })
      .filter((row): row is { userId: string; user: { id: string; firstName: string; lastName: string } } => row !== null);
  },
};

(prisma as any).user = {
  async findMany({ where }: any) {
    const roleIn: string[] = where.role.in;
    const notIn: string[] = where.id?.notIn ?? [];
    return users
      .filter((u) => u.clinicId === where.clinicId && u.isActive === where.isActive && roleIn.includes(u.role) && !notIn.includes(u.id))
      .map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName }));
  },
};

(prisma as any).appointmentType = {
  async findMany({ where }: any) {
    return appointmentTypes
      .filter((a) => a.clinicId === where.clinicId && a.isActive === where.isActive)
      .map((a) => ({ id: a.id, name: a.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
};

// ── Import that depends on the mocked prisma above (must come after it) ────

const platformExternalCalendarRoutes = (await import('../routes/platformExternalCalendar.js')).default;

// ── Test app — mounts the REAL router at the REAL production path ─────────

function buildApp() {
  const app = express();
  app.use('/api/platform', platformExternalCalendarRoutes);
  return app;
}

async function withServer(fn: (port: number) => Promise<void>) {
  const app = buildApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP port');
  try {
    await fn(address.port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function getLocalOptions(
  port: number,
  clinicId: string,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'GET',
        path: `/api/platform/clinics/${encodeURIComponent(clinicId)}/external-calendar/local-options`,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({ statusCode: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const adminToken = generatePlatformToken({ id: 'admin-1', email: 'admin@example.com' });
const authHeaders = { authorization: `Bearer ${adminToken}` };

// ── Tests ────────────────────────────────────────────────────────────────

await withServer(async (port) => {
  section('Authorization');

  await test('request without a platform admin token is rejected with 401', async () => {
    const res = await getLocalOptions(port, 'clinic-A');
    assert.equal(res.statusCode, 401);
  });

  await test('request with a valid platform admin token is authorized (200)', async () => {
    const res = await getLocalOptions(port, 'clinic-A', authHeaders);
    assert.equal(res.statusCode, 200);
  });

  section('Clinic-scoped dentist eligibility');

  await test('a clinic with multiple eligible dentists returns all of them, correctly shaped, sorted', async () => {
    const res = await getLocalOptions(port, 'clinic-A', authHeaders);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.practitioners, [
      { id: 'user-1', label: 'Ada Yilmaz' },
      { id: 'user-2', label: 'Berk Demir' },
      { id: 'user-5', label: 'Ela Sonmez' },
    ]);
  });

  await test('a legacy lowercase role ("doctor") is still returned as an eligible dentist', async () => {
    const res = await getLocalOptions(port, 'clinic-A', authHeaders);
    assert.ok(res.body.practitioners.some((p: any) => p.id === 'user-2'), 'user-2 (role="doctor") must be included');
  });

  await test('a branch-scoped UserClinic.role of "dentist" is honored even when the org-wide User.role is not DENTIST', async () => {
    const res = await getLocalOptions(port, 'clinic-A', authHeaders);
    assert.ok(res.body.practitioners.some((p: any) => p.id === 'user-5'), 'user-5 (UserClinic.role="dentist") must be included');
  });

  await test('a non-dentist role (RECEPTIONIST) at this clinic is excluded', async () => {
    const res = await getLocalOptions(port, 'clinic-A', authHeaders);
    assert.ok(!res.body.practitioners.some((p: any) => p.id === 'user-3'), 'user-3 (RECEPTIONIST) must not be included');
  });

  await test('an inactive dentist is excluded', async () => {
    const res = await getLocalOptions(port, 'clinic-A', authHeaders);
    assert.ok(!res.body.practitioners.some((p: any) => p.id === 'user-4'), 'user-4 (isActive=false) must not be included');
  });

  await test('a dentist belonging to a different clinic in a different organization is excluded', async () => {
    const res = await getLocalOptions(port, 'clinic-A', authHeaders);
    assert.ok(!res.body.practitioners.some((p: any) => p.id === 'user-6'), 'user-6 (clinic-B / org-B) must not be included');
  });

  await test('a dentist belonging to a different clinic in the SAME organization is excluded', async () => {
    const res = await getLocalOptions(port, 'clinic-A', authHeaders);
    assert.ok(!res.body.practitioners.some((p: any) => p.id === 'user-7'), 'user-7 (clinic-C, same org-A) must not be included');
  });

  await test('a clinic with exactly one eligible dentist returns exactly that one', async () => {
    const res = await getLocalOptions(port, 'clinic-D', authHeaders);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.practitioners, [{ id: 'user-8', label: 'Hakan Polat' }]);
  });

  await test('a clinic with zero eligible dentists returns 200 with an empty array, not an error', async () => {
    const res = await getLocalOptions(port, 'clinic-E', authHeaders);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.practitioners, []);
  });

  await test('a nonexistent clinic returns 404 — distinguishable from the zero-dentist empty-array case', async () => {
    const res = await getLocalOptions(port, 'clinic-does-not-exist', authHeaders);
    assert.equal(res.statusCode, 404);
  });

  section('Services (unaffected by this fix) and DTO shape');

  await test('services are clinic-scoped, active-only, and correctly shaped', async () => {
    const res = await getLocalOptions(port, 'clinic-A', authHeaders);
    assert.deepEqual(res.body.services, [
      { id: 'svc-1', label: 'Cleaning' },
      { id: 'svc-3', label: 'Whitening' },
    ]);
  });

  await test('practitioner DTO exposes exactly {id, label} — the shape the mapping UI\'s LocalOption expects', async () => {
    const res = await getLocalOptions(port, 'clinic-A', authHeaders);
    for (const p of res.body.practitioners) {
      assert.deepEqual(Object.keys(p).sort(), ['id', 'label']);
    }
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
