/**
 * dbVerificationHarness.ts — shared, narrow test helper for the KVKK-HIGH-006
 * disposable-Postgres DB-backed verification suite (see
 * docs/program/evidence/KVKK-HIGH-006-DISPOSABLE_POSTGRES_VERIFICATION.md).
 *
 * Unlike the rest of this repo's KVKK-HIGH-006 test files (which mirror route
 * logic against in-memory fixtures because no live database was reachable —
 * see kvkkHigh006Batch2ClinicScope.test.ts, planLimitsTargetClinicFix.test.ts),
 * every file that imports this harness runs against a REAL disposable
 * PostgreSQL instance via the real `prisma` client (server/src/db.ts) and
 * invokes the REAL Express route handlers/middleware extracted from each
 * router's internal stack — the same convention already used by
 * communicationPreferencesRoute.test.ts. No mocking of clinicScope/planLimits
 * logic; only external provider calls (WhatsApp/SMS) may go unconfigured so
 * they short-circuit before any real network call.
 *
 * Requires DATABASE_URL to point at a disposable Postgres before import,
 * since server/src/db.ts opens a live pg pool at import time.
 *
 * Run each file with: npx tsx src/tests/dbVerification/<file>.test.ts
 */

import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import prisma from '../../db.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { normalizeRole } from '../../utils/roles.js';

// ─── Minimal pass/fail test runner (same shape as the rest of the suite) ───

export function createSuite(title: string) {
  let passed = 0;
  let failed = 0;

  function section(name: string) {
    console.log(`\n${title} — ${name}`);
  }

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err: unknown) {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      failed++;
    }
  }

  function summary(): boolean {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`${title}: ${passed} passed, ${failed} failed`);
    return failed === 0;
  }

  return { section, test, summary, counts: () => ({ passed, failed }) };
}

// ─── Route handler / middleware chain extraction (extends the pattern from
// communicationPreferencesRoute.test.ts to also thread `authorize()`) ───

type RouterLike = { stack: Array<any> };
type Handler = (req: AuthRequest, res: Response, next: () => void) => void | Promise<void>;

function findLayer(router: RouterLike, method: string, path: string) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods?.[method]) {
      return layer.route.stack as Array<{ handle: Handler }>;
    }
  }
  throw new Error(`No route handler found for ${method.toUpperCase()} ${path}`);
}

/** Full middleware chain for a route (authorize + plan-limit middleware + handler), in registration order. */
export function getFullChain(router: RouterLike, method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string): Handler[] {
  return findLayer(router, method, path).map((s) => s.handle);
}

/** Just the terminal handler, skipping authorize()/other middleware — for unit-testing handler logic directly. */
export function getHandlerOnly(router: RouterLike, method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string): Handler {
  const stack = findLayer(router, method, path);
  return stack[stack.length - 1].handle;
}

/** Runs a middleware chain to completion or until a middleware responds without calling next(). */
export async function runChain(chain: Handler[], req: AuthRequest, res: MockResponse): Promise<void> {
  for (const fn of chain) {
    let calledNext = false;
    await fn(req, res as unknown as Response, () => {
      calledNext = true;
    });
    if (!calledNext) return;
  }
}

// ─── Mock Express Response ───

export type MockResponse = Response & { statusCode: number; body: any };

export function mockResponse(): MockResponse {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

// ─── AuthRequest builder ───

export type UserOverrides = Partial<NonNullable<AuthRequest['user']>> & { role?: string };

export function authRequest(
  overrides: UserOverrides,
  opts: { params?: Record<string, string>; query?: Record<string, any>; body?: any } = {},
): AuthRequest {
  const role = overrides.role ?? 'OWNER';
  const canAccessAllClinics = overrides.canAccessAllClinics ?? false;
  return {
    params: opts.params ?? {},
    query: opts.query ?? {},
    body: opts.body ?? {},
    headers: {},
    ip: '127.0.0.1',
    method: 'GET',
    route: { path: '' },
    baseUrl: '',
    path: '/test',
    user: {
      id: randomUUID(),
      clinicId: '',
      role,
      normalizedRole: normalizeRole(role, canAccessAllClinics),
      organizationId: '',
      allowedClinicIds: [],
      canAccessAllClinics,
      ...overrides,
    },
  } as unknown as AuthRequest;
}

// ─── Fixture builders ───
// Two organizations, three clinics minimum (default / authorized sibling /
// unauthorized-or-cross-org), per the task's fixture-design requirement.

export type ClinicFixtureSet = {
  orgId: string;
  orgSlug: string;
  otherOrgId: string;
  otherOrgSlug: string;
  defaultClinicId: string; // requester's own/default clinic
  siblingClinicId: string; // authorized sibling clinic, same org
  unauthorizedClinicId: string; // same org, NOT assigned to the multi-clinic user
  crossOrgClinicId: string; // different organization entirely
};

const createdOrgIds = new Set<string>();

export async function createClinicFixtureSet(labelPrefix: string): Promise<ClinicFixtureSet> {
  const suffix = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({
    data: { name: `${labelPrefix} Org ${suffix}`, slug: `${labelPrefix}-org-${suffix}`.toLowerCase() },
  });
  const otherOrg = await prisma.organization.create({
    data: { name: `${labelPrefix} Other Org ${suffix}`, slug: `${labelPrefix}-org2-${suffix}`.toLowerCase() },
  });

  const [defaultClinic, siblingClinic, unauthorizedClinic, crossOrgClinic] = await Promise.all([
    prisma.clinic.create({ data: { name: 'Default Clinic', slug: `${labelPrefix}-default-${suffix}`.toLowerCase(), organizationId: org.id } }),
    prisma.clinic.create({ data: { name: 'Sibling Clinic', slug: `${labelPrefix}-sibling-${suffix}`.toLowerCase(), organizationId: org.id } }),
    prisma.clinic.create({ data: { name: 'Unauthorized Clinic', slug: `${labelPrefix}-unauth-${suffix}`.toLowerCase(), organizationId: org.id } }),
    prisma.clinic.create({ data: { name: 'Cross-Org Clinic', slug: `${labelPrefix}-crossorg-${suffix}`.toLowerCase(), organizationId: otherOrg.id } }),
  ]);

  createdOrgIds.add(org.id);
  createdOrgIds.add(otherOrg.id);

  return {
    orgId: org.id,
    orgSlug: org.slug,
    otherOrgId: otherOrg.id,
    otherOrgSlug: otherOrg.slug,
    defaultClinicId: defaultClinic.id,
    siblingClinicId: siblingClinic.id,
    unauthorizedClinicId: unauthorizedClinic.id,
    crossOrgClinicId: crossOrgClinic.id,
  };
}

export async function createStaffUser(params: {
  organizationId: string;
  clinicId: string;
  role: string; // canonical or legacy role string stored on User.role
  canAccessAllClinics?: boolean;
  allowedClinicIds?: string[]; // clinics to attach via UserClinic (isActive)
}): Promise<{ id: string; clinicId: string; organizationId: string; allowedClinicIds: string[]; canAccessAllClinics: boolean; role: string }> {
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      clinicId: params.clinicId,
      organizationId: params.organizationId,
      firstName: 'Test',
      lastName: 'Staff',
      email: `test-staff-${suffix}@example.invalid`,
      role: params.role,
      passwordHash: 'x',
      canAccessAllClinics: params.canAccessAllClinics ?? false,
      isActive: true,
    },
  });

  const allowedClinicIds = params.allowedClinicIds ?? [params.clinicId];
  if (!params.canAccessAllClinics) {
    await prisma.userClinic.createMany({
      data: allowedClinicIds.map((clinicId) => ({ userId: user.id, clinicId, role: params.role, isActive: true })),
    });
  }

  return {
    id: user.id,
    clinicId: params.clinicId,
    organizationId: params.organizationId,
    allowedClinicIds: params.canAccessAllClinics ? [] : allowedClinicIds,
    canAccessAllClinics: params.canAccessAllClinics ?? false,
    role: params.role,
  };
}

export async function createTestPatient(params: { organizationId: string; clinicId: string; firstName?: string; lastName?: string }) {
  const suffix = randomUUID().slice(0, 8);
  return prisma.patient.create({
    data: {
      organizationId: params.organizationId,
      clinicId: params.clinicId,
      firstName: params.firstName ?? 'Synthetic',
      lastName: params.lastName ?? `Patient-${suffix}`,
      phone: `+9055500${suffix.slice(0, 5)}`,
    },
  });
}

/** Deterministic teardown — deletes every row created under fixture org ids, in FK-safe order. */
export async function cleanupAllFixtures(): Promise<void> {
  const orgIds = Array.from(createdOrgIds);
  if (orgIds.length === 0) return;

  const clinics = await prisma.clinic.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } });
  const clinicIds = clinics.map((c) => c.id);

  await prisma.activityLog.deleteMany({ where: { clinicId: { in: clinicIds } } });
  // AppointmentRequest before Appointment: AppointmentRequest.convertedAppointmentId
  // references Appointment.id.
  await prisma.appointmentRequest.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.appointment.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.sentMessage.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.messageTemplate.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.postTreatmentMessageQueue.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.postTreatmentMessageTemplate.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.paymentPlanInstallment.deleteMany({ where: { plan: { clinicId: { in: clinicIds } } } });
  await prisma.payment.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.paymentPlan.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.insuranceProvision.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.inventoryTransaction.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.inventoryItem.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.appointmentTypeMaterial.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.appointmentType.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.userClinic.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.patientClinic.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.doctorAvailability.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.doctorOffDay.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.patient.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.clinic.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });

  createdOrgIds.clear();
}

export { prisma };
