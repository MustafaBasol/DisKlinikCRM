/**
 * overdueReceivables.test.ts — regression tests for the shared overdue-installment
 * rule and total-overdue-receivables computation.
 *
 * Production fixture: Burak Çelik has a ₺4,500 installment with
 * status='overdue', dueDate='2026-06-29', paymentId=null; Can Aksoy has a
 * ₺1,500 standalone pending payment. Expected: total overdue ₺6,000, overdue
 * installment amount ₺4,500, overdue installment count 1.
 *
 * Run with: tsx src/tests/overdueReceivables.test.ts
 */

import assert from 'node:assert/strict';
import { overdueInstallmentWhere, isInstallmentOverdue } from '../utils/overdueInstallments.js';
import { overdueReceivablesAmount } from '../utils/overdueReceivables.js';

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

// ─── Fake Prisma harness ──────────────────────────────────────────────────────

interface FakeInstallment {
  amount: number;
  dueDate: Date;
  status: string;
  clinicId: string;
  paymentId?: string | null;
}

interface FakePayment {
  amount: number;
  paymentStatus: string;
  clinicId: string;
  installment?: null | { id: string };
}

function matchesInstallmentWhere(inst: FakeInstallment, where: any): boolean {
  if (!where.status.in.includes(inst.status)) return false;
  if (!(inst.dueDate < where.dueDate.lt)) return false;
  if ((inst.paymentId ?? null) !== null) return false;
  const clinicIds: string[] = where.plan.clinicId.in;
  if (!clinicIds.includes(inst.clinicId)) return false;
  return true;
}

function makeFakePrisma(installments: FakeInstallment[], payments: FakePayment[]) {
  return {
    paymentPlanInstallment: {
      aggregate: async ({ where }: any) => {
        const matched = installments.filter(i => matchesInstallmentWhere(i, where));
        const sum = matched.reduce((s, i) => s + i.amount, 0);
        return { _sum: { amount: matched.length ? sum : null } };
      },
      count: async ({ where }: any) => installments.filter(i => matchesInstallmentWhere(i, where)).length,
    },
    payment: {
      aggregate: async ({ where }: any) => {
        const clinicIds: string[] = where.clinicId.in;
        const matched = payments.filter(
          p =>
            clinicIds.includes(p.clinicId) &&
            p.paymentStatus === where.paymentStatus &&
            (p.installment ?? null) === null,
        );
        const sum = matched.reduce((s, p) => s + p.amount, 0);
        return { _sum: { amount: matched.length ? sum : null } };
      },
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const tests: Promise<void>[] = [];

section('1. overdueInstallmentWhere / isInstallmentOverdue — shared rule shape');

tests.push(
  test('overdueInstallmentWhere matches both pending and legacy overdue statuses', () => {
    const where = overdueInstallmentWhere(new Date('2026-07-09'));
    assert.deepEqual(where.status.in, ['pending', 'overdue']);
    assert.equal(where.paymentId, null);
  }),
);

tests.push(
  test('isInstallmentOverdue: legacy status=overdue, past due, no paymentId → true', () => {
    assert.equal(
      isInstallmentOverdue('overdue', new Date('2026-06-29'), new Date('2026-07-09'), null),
      true,
    );
  }),
);

tests.push(
  test('isInstallmentOverdue: status=pending, past due, no paymentId → true', () => {
    assert.equal(
      isInstallmentOverdue('pending', new Date('2026-06-15'), new Date('2026-07-09'), null),
      true,
    );
  }),
);

tests.push(
  test('isInstallmentOverdue: paid (paymentId present) → false regardless of status/date', () => {
    assert.equal(
      isInstallmentOverdue('overdue', new Date('2026-06-01'), new Date('2026-07-09'), 'payment-1'),
      false,
    );
  }),
);

tests.push(
  test('isInstallmentOverdue: future due date → false', () => {
    assert.equal(
      isInstallmentOverdue('pending', new Date('2026-12-01'), new Date('2026-07-09'), null),
      false,
    );
  }),
);

tests.push(
  test('isInstallmentOverdue: paid status → false even if past due', () => {
    assert.equal(
      isInstallmentOverdue('paid', new Date('2026-06-01'), new Date('2026-07-09'), null),
      false,
    );
  }),
);

section('2. overdueReceivablesAmount — installment-only');

tests.push(
  test('sums only pending/overdue installments past due, excludes paid/future', async () => {
    const now = new Date('2026-07-09');
    const prisma = makeFakePrisma(
      [
        { amount: 4500, dueDate: new Date('2026-06-29'), status: 'overdue', clinicId: 'clinic-A', paymentId: null },
        { amount: 500, dueDate: new Date('2026-06-01'), status: 'paid', clinicId: 'clinic-A', paymentId: 'p-1' },
        { amount: 900, dueDate: new Date('2026-12-01'), status: 'pending', clinicId: 'clinic-A', paymentId: null },
      ],
      [],
    );
    const result = await overdueReceivablesAmount(prisma as any, ['clinic-A'], now);
    assert.equal(result.installmentAmount, 4500);
    assert.equal(result.installmentCount, 1);
    assert.equal(result.paymentAmount, 0);
    assert.equal(result.total, 4500);
  }),
);

section('3. overdueReceivablesAmount — standalone payment-only');

tests.push(
  test('sums standalone pending payments not linked to an installment', async () => {
    const now = new Date('2026-07-09');
    const prisma = makeFakePrisma([], [{ amount: 1500, paymentStatus: 'pending', clinicId: 'clinic-A', installment: null }]);
    const result = await overdueReceivablesAmount(prisma as any, ['clinic-A'], now);
    assert.equal(result.installmentAmount, 0);
    assert.equal(result.paymentAmount, 1500);
    assert.equal(result.total, 1500);
  }),
);

section('4. overdueReceivablesAmount — combined, no double-counting');

tests.push(
  test('installment-linked payment (installment != null) is excluded from the standalone sum', async () => {
    const now = new Date('2026-07-09');
    const prisma = makeFakePrisma(
      [],
      [
        { amount: 1500, paymentStatus: 'pending', clinicId: 'clinic-A', installment: null },
        { amount: 4500, paymentStatus: 'paid', clinicId: 'clinic-A', installment: { id: 'inst-1' } },
      ],
    );
    const result = await overdueReceivablesAmount(prisma as any, ['clinic-A'], now);
    assert.equal(result.paymentAmount, 1500, 'paid, installment-linked payment must not be counted');
    assert.equal(result.total, 1500);
  }),
);

section('5. Production fixture — Burak Çelik (₺4,500) + Can Aksoy (₺1,500) = ₺6,000');

tests.push(
  test('legacy status=overdue installment + standalone pending payment combine correctly', async () => {
    const now = new Date('2026-07-09');
    const prisma = makeFakePrisma(
      [{ amount: 4500, dueDate: new Date('2026-06-29'), status: 'overdue', clinicId: 'clinic-A', paymentId: null }],
      [{ amount: 1500, paymentStatus: 'pending', clinicId: 'clinic-A', installment: null }],
    );
    const result = await overdueReceivablesAmount(prisma as any, ['clinic-A'], now);
    assert.equal(result.installmentAmount, 4500, 'Gecikmiş Taksit tutarı 4.500 olmalı');
    assert.equal(result.installmentCount, 1, 'Gecikmiş Taksit adedi 1 olmalı');
    assert.equal(result.paymentAmount, 1500);
    assert.equal(result.total, 6000, 'Gecikmiş Tutar toplamı 6.000 olmalı');
    assert.equal(result.installmentAmount + result.paymentAmount, result.total);
  }),
);

// ─── Summary ──────────────────────────────────────────────────────────────────

Promise.all(tests).then(() => {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
