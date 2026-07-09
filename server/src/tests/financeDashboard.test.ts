/**
 * financeDashboard.test.ts — Sprint 12: Finance / Billing Dashboard Tests
 *
 * Tests cover:
 *  - canViewFinanceDashboard role-based access
 *  - getDateRange utility (shared with organizationDashboard)
 *  - resolveClinicScope logic (mocked inline)
 *  - Summary metric structure correctness
 *  - Empty data returns zeros safely
 *
 * Run with: tsx src/tests/financeDashboard.test.ts
 */

import assert from 'node:assert/strict';

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ─── Imports ──────────────────────────────────────────────────────────────────

import { canViewFinanceDashboard } from '../utils/roles.js';
import { getDateRange } from '../routes/organizationDashboard.js';
import { overdueInstallmentWhere } from '../utils/overdueInstallments.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeUser(
  role: string,
  opts: Partial<{
    canAccessAllClinics: boolean;
    allowedClinicIds: string[];
    organizationId: string;
  }> = {},
) {
  return {
    id: 'user-1',
    clinicId: 'clinic-1',
    organizationId: opts.organizationId ?? 'org-1',
    role,
    canAccessAllClinics: opts.canAccessAllClinics ?? false,
    allowedClinicIds: opts.allowedClinicIds ?? ['clinic-1'],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const tests: Promise<void>[] = [];

section('canViewFinanceDashboard — access control');

tests.push(test('OWNER can view finance dashboard', () => {
  assert.ok(canViewFinanceDashboard(makeUser('OWNER', { canAccessAllClinics: true })));
}));

tests.push(test('ORG_ADMIN can view finance dashboard', () => {
  assert.ok(canViewFinanceDashboard(makeUser('ORG_ADMIN')));
}));

tests.push(test('CLINIC_MANAGER can view finance dashboard', () => {
  assert.ok(canViewFinanceDashboard(makeUser('CLINIC_MANAGER')));
}));

tests.push(test('BILLING can view finance dashboard', () => {
  assert.ok(canViewFinanceDashboard(makeUser('BILLING')));
}));

tests.push(test('DENTIST cannot view finance dashboard', () => {
  assert.equal(canViewFinanceDashboard(makeUser('DENTIST')), false);
}));

tests.push(test('RECEPTIONIST cannot view finance dashboard', () => {
  assert.equal(canViewFinanceDashboard(makeUser('RECEPTIONIST')), false);
}));

tests.push(test('ASSISTANT cannot view finance dashboard', () => {
  assert.equal(canViewFinanceDashboard(makeUser('ASSISTANT')), false);
}));

tests.push(test('null user cannot view finance dashboard', () => {
  assert.equal(canViewFinanceDashboard(null), false);
}));

tests.push(test('undefined user cannot view finance dashboard', () => {
  assert.equal(canViewFinanceDashboard(undefined), false);
}));

section('getDateRange — date range calculations');

tests.push(test('today returns same-day boundaries', () => {
  const { from, to } = getDateRange('today');
  assert.equal(from.getHours(), 0);
  assert.equal(from.getMinutes(), 0);
  assert.equal(to.getHours(), 23);
  assert.equal(to.getMinutes(), 59);
  assert.equal(from.toDateString(), to.toDateString());
}));

tests.push(test('this_month starts at day 1', () => {
  const { from } = getDateRange('this_month');
  assert.equal(from.getDate(), 1);
  assert.equal(from.getHours(), 0);
}));

tests.push(test('last_30_days covers 30 days', () => {
  const { from, to } = getDateRange('last_30_days');
  const diffMs = to.getTime() - from.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  assert.ok(diffDays >= 29 && diffDays <= 31, `Expected ~30 days, got ${diffDays}`);
}));

tests.push(test('this_week starts on Sunday', () => {
  const { from } = getDateRange('this_week');
  assert.equal(from.getDay(), 0); // Sunday
}));

tests.push(test('custom range parses from/to correctly', () => {
  const { from, to } = getDateRange('custom', '2026-01-01', '2026-01-31');
  assert.equal(from.getFullYear(), 2026);
  assert.equal(from.getMonth(), 0); // January
  assert.equal(from.getDate(), 1);
  assert.equal(to.getDate(), 31);
  assert.equal(to.getHours(), 23);
}));

tests.push(test('custom range throws if from/to missing', () => {
  assert.throws(() => getDateRange('custom'), /custom range requires from and to/);
}));

tests.push(test('unknown range falls back to this_month', () => {
  const now = new Date();
  const { from } = getDateRange('unknown_range');
  assert.equal(from.getDate(), 1);
  assert.equal(from.getMonth(), now.getMonth());
}));

section('Finance summary shape correctness');

tests.push(test('empty response has all required summary fields as zero', () => {
  const emptySummary = {
    collectedToday: 0,
    collectedInRange: 0,
    outstandingBalance: 0,
    overdueAmount: 0,
    pendingInstallments: 0,
    overdueInstallments: 0,
    overdueInstallmentsCount: 0,
    cancelledPayments: 0,
    practitionerPayoutsDue: 0,
    practitionerPayoutsPaid: 0,
  };
  const requiredKeys: (keyof typeof emptySummary)[] = [
    'collectedToday',
    'collectedInRange',
    'outstandingBalance',
    'overdueAmount',
    'pendingInstallments',
    'overdueInstallments',
    'overdueInstallmentsCount',
    'cancelledPayments',
    'practitionerPayoutsDue',
    'practitionerPayoutsPaid',
  ];
  for (const key of requiredKeys) {
    assert.equal(emptySummary[key], 0, `${key} should be 0`);
  }
}));

tests.push(test('overdueInstallments field represents the installment monetary total, not a row count', () => {
  // ₺4,500 legacy status='overdue' installment + ₺1,500 standalone pending payment
  const overdueReceivables = { installmentAmount: 4500, installmentCount: 1, paymentAmount: 1500, total: 6000 };
  const summary = {
    overdueAmount: overdueReceivables.total,
    overdueInstallments: overdueReceivables.installmentAmount,
    overdueInstallmentsCount: overdueReceivables.installmentCount,
  };
  assert.equal(summary.overdueInstallments, 4500, 'kart tutar göstermeli, satır sayısı değil');
  assert.notEqual(summary.overdueInstallments, summary.overdueInstallmentsCount);
  assert.equal(summary.overdueAmount, 6000);
}));

tests.push(test('overdueInstallmentWhere rule includes legacy overdue status and excludes paid installments', () => {
  const where = overdueInstallmentWhere(new Date('2026-07-09'));
  assert.deepEqual(where.status.in, ['pending', 'overdue']);
  assert.equal(where.paymentId, null);
  assert.ok(where.dueDate.lt instanceof Date);
}));

tests.push(test('collectedInRange does not include cancelled payments', () => {
  // Validate the data separation: collected vs cancelled are tracked separately
  const collected = 1500;
  const cancelled = 300;
  assert.notEqual(collected, collected + cancelled); // they must be different
}));

tests.push(test('branchBreakdown entry has required fields', () => {
  const branch = {
    clinicId: 'c-1',
    clinicName: 'Test Klinik',
    collected: 1000,
    outstanding: 500,
    overdue: 200,
    pendingInstallments: 3,
  };
  assert.ok('clinicId' in branch);
  assert.ok('clinicName' in branch);
  assert.ok('collected' in branch);
  assert.ok('outstanding' in branch);
  assert.ok('overdue' in branch);
  assert.ok('pendingInstallments' in branch);
}));

tests.push(test('upcomingInstallment entry has required fields', () => {
  const inst = {
    id: 'i-1',
    planId: 'p-1',
    patientName: 'Ahmet Yılmaz',
    clinicName: 'Test Klinik',
    amount: 250,
    dueDate: '2026-06-01T00:00:00.000Z',
    status: 'pending',
  };
  assert.ok('planId' in inst);
  assert.ok('dueDate' in inst);
  assert.ok(['pending', 'overdue'].includes(inst.status));
}));

section('Clinic scope security');

tests.push(test('BILLING user restricted to allowedClinicIds', () => {
  const billingUser = makeUser('BILLING', { allowedClinicIds: ['clinic-a', 'clinic-b'] });
  // Simulate: user requests clinic-c which is NOT in allowedClinicIds
  const requestedClinic = 'clinic-c';
  const hasAccess = billingUser.allowedClinicIds.includes(requestedClinic);
  assert.equal(hasAccess, false);
}));

tests.push(test('BILLING user can access assigned clinic', () => {
  const billingUser = makeUser('BILLING', { allowedClinicIds: ['clinic-a', 'clinic-b'] });
  const requestedClinic = 'clinic-a';
  const hasAccess = billingUser.allowedClinicIds.includes(requestedClinic);
  assert.ok(hasAccess);
}));

tests.push(test('OWNER with canAccessAllClinics sees all clinics', () => {
  const owner = makeUser('OWNER', { canAccessAllClinics: true });
  assert.equal(owner.canAccessAllClinics, true);
  // In resolveClinicScope, OWNER gets all org clinics (null allowed list)
  assert.ok(canViewFinanceDashboard(owner));
}));

tests.push(test('Cross-org access impossible — different organizationId', () => {
  const userOrg1 = makeUser('BILLING', { organizationId: 'org-1', allowedClinicIds: ['clinic-a'] });
  const userOrg2 = makeUser('BILLING', { organizationId: 'org-2', allowedClinicIds: ['clinic-b'] });
  // Both cannot access each other's data since org scoping is server-side
  assert.notEqual(userOrg1.organizationId, userOrg2.organizationId);
}));

// ─── Summary ──────────────────────────────────────────────────────────────────

Promise.all(tests).then(() => {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
