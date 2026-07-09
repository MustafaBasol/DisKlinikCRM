/**
 * overdueReceivables.test.ts — Regression tests for the unified "overdue
 * receivables" definition (server/src/utils/overdueReceivables.ts), which
 * combines overdue payment-plan installments with standalone (non-installment)
 * pending payments.
 *
 * Bug this guards against: the dashboard's "Gecikmiş Tahsilatlar" card only
 * summed overdue PaymentPlanInstallment rows, so a clinic with overdue
 * standalone (non-installment) Payment records showed a card total lower than
 * the Finance Dashboard's real outstanding/overdue picture, and linked to a
 * destination page (Payment Plans) that couldn't show those payments at all.
 *
 * Run with: tsx src/tests/overdueReceivables.test.ts
 */

import assert from 'node:assert/strict';
import { overdueReceivablesAmount, overduePaymentWhere } from '../utils/overdueReceivables.js';
import { overdueInstallmentWhere, isInstallmentOverdue } from '../utils/overdueInstallments.js';

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
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

const tests: Promise<void>[] = [];

// ─── Fake prisma client: in-memory aggregate over fixed installment/payment lists ──

type FakeInstallment = { amount: number; dueDate: Date; status: string; clinicId: string };
type FakePayment = { amount: number; paymentStatus: string; clinicId: string; installment: null | { id: string } };

function makeFakePrisma(installments: FakeInstallment[], payments: FakePayment[]) {
  return {
    paymentPlanInstallment: {
      aggregate: async ({ where }: { where: any }) => {
        const now: Date = where.dueDate.lt;
        const clinicId = where.plan.clinicId;
        const matches = installments.filter(
          (i) => i.status === where.status && i.dueDate < now && matchesClinic(i.clinicId, clinicId),
        );
        return { _sum: { amount: matches.length ? matches.reduce((s, i) => s + i.amount, 0) : null } };
      },
    },
    payment: {
      aggregate: async ({ where }: { where: any }) => {
        const matches = payments.filter(
          (p) => p.paymentStatus === where.paymentStatus && p.installment === where.installment && matchesClinic(p.clinicId, where.clinicId),
        );
        return { _sum: { amount: matches.length ? matches.reduce((s, p) => s + p.amount, 0) : null } };
      },
    },
  };
}

function matchesClinic(rowClinicId: string, whereClinicId: any): boolean {
  if (typeof whereClinicId === 'string') return rowClinicId === whereClinicId;
  if (whereClinicId && Array.isArray(whereClinicId.in)) return whereClinicId.in.includes(rowClinicId);
  return false;
}

// ─── 1. Overdue non-installment receivable only ──────────────────────────────

section('1. Yalnızca taksitsiz gecikmiş ödeme');

tests.push(
  test('yalnızca pending Payment varsa toplam yalnızca paymentAmount içerir', async () => {
    const prisma = makeFakePrisma(
      [],
      [{ amount: 500, paymentStatus: 'pending', clinicId: 'clinic-A', installment: null }],
    );
    const result = await overdueReceivablesAmount(prisma as any, { clinicId: 'clinic-A' }, new Date('2026-07-09'));
    assert.equal(result.installmentAmount, 0);
    assert.equal(result.paymentAmount, 500);
    assert.equal(result.total, 500);
  }),
);

// ─── 2. Overdue installment only ──────────────────────────────────────────────

section('2. Yalnızca gecikmiş taksit');

tests.push(
  test('yalnızca vadesi geçmiş pending taksit varsa toplam yalnızca installmentAmount içerir', async () => {
    const prisma = makeFakePrisma(
      [{ amount: 300, dueDate: new Date('2026-07-01'), status: 'pending', clinicId: 'clinic-A' }],
      [],
    );
    const result = await overdueReceivablesAmount(prisma as any, { clinicId: 'clinic-A' }, new Date('2026-07-09'));
    assert.equal(result.installmentAmount, 300);
    assert.equal(result.paymentAmount, 0);
    assert.equal(result.total, 300);
  }),
);

// ─── 3. Both together — no double counting ────────────────────────────────────

section('3. İkisi birlikte — çifte sayım yok');

tests.push(
  test('gecikmiş taksit + taksitsiz gecikmiş ödeme toplamı ayrı ayrı toplanır', async () => {
    const prisma = makeFakePrisma(
      [{ amount: 300, dueDate: new Date('2026-07-01'), status: 'pending', clinicId: 'clinic-A' }],
      [{ amount: 500, paymentStatus: 'pending', clinicId: 'clinic-A', installment: null }],
    );
    const result = await overdueReceivablesAmount(prisma as any, { clinicId: 'clinic-A' }, new Date('2026-07-09'));
    assert.equal(result.installmentAmount, 300);
    assert.equal(result.paymentAmount, 500);
    assert.equal(result.total, 800, 'toplam iki kaynağın basit toplamı olmalı, çakışma olmamalı');
  }),
);

tests.push(
  test('overduePaymentWhere yalnızca installment=null taksitsiz ödemeleri hedefler (yapısal ayrıklık)', () => {
    const where = overduePaymentWhere({ clinicId: 'clinic-A' });
    assert.equal(where.paymentStatus, 'pending');
    assert.equal(where.installment, null, 'taksite bağlı ödemeler asla bu filtreye dahil olmaz');
  }),
);

tests.push(
  test('overdueInstallmentWhere ayrı bir modeli (plan.clinicId altında) hedefler', () => {
    const where = overdueInstallmentWhere({ clinicId: 'clinic-A' });
    assert.deepEqual(where.plan, { clinicId: 'clinic-A' });
    assert.ok(!('installment' in where), 'installment where Payment modeline özgüdür, PaymentPlanInstallment where içinde olmamalı');
  }),
);

// ─── 4. Paid / future items excluded ──────────────────────────────────────────

section('4. Ödenmiş / vadesi henüz gelmemiş kalemler hariç tutulur');

tests.push(
  test('paid Payment toplamına dahil edilmez', async () => {
    const prisma = makeFakePrisma(
      [],
      [{ amount: 500, paymentStatus: 'paid', clinicId: 'clinic-A', installment: null }],
    );
    const result = await overdueReceivablesAmount(prisma as any, { clinicId: 'clinic-A' }, new Date('2026-07-09'));
    assert.equal(result.paymentAmount, 0);
    assert.equal(result.total, 0);
  }),
);

tests.push(
  test('vadesi gelecekte olan pending taksit toplamına dahil edilmez', async () => {
    const prisma = makeFakePrisma(
      [{ amount: 300, dueDate: new Date('2026-08-01'), status: 'pending', clinicId: 'clinic-A' }],
      [],
    );
    const result = await overdueReceivablesAmount(prisma as any, { clinicId: 'clinic-A' }, new Date('2026-07-09'));
    assert.equal(result.installmentAmount, 0);
    assert.equal(result.total, 0);
  }),
);

tests.push(
  test('paid taksit (vadesi geçmiş olsa bile) toplamına dahil edilmez', () => {
    assert.equal(isInstallmentOverdue('2026-06-01', 'paid', new Date('2026-07-09')), false);
  }),
);

// ─── 5. Dashboard total equals destination total ──────────────────────────────

section('5. Regression — dashboard kart toplamı, hedef sayfa toplamıyla birebir eşleşir');

tests.push(
  test('dashboard.ts (aggregate bazlı) ve PaymentPlans.tsx (liste filtre+reduce bazlı) aynı toplamı üretir', async () => {
    const now = new Date('2026-07-09T00:00:00Z');
    const clinicId = 'clinic-A';

    // "Dashboard" tarafı: overdueReceivablesAmount aggregate sonucu.
    const prisma = makeFakePrisma(
      [
        { amount: 100, dueDate: new Date('2026-07-01'), status: 'pending', clinicId }, // overdue
        { amount: 200, dueDate: new Date('2026-08-01'), status: 'pending', clinicId }, // future — excluded
        { amount: 300, dueDate: new Date('2026-06-01'), status: 'paid', clinicId },    // paid — excluded
      ],
      [
        { amount: 500, paymentStatus: 'pending', clinicId, installment: null }, // overdue (no due date concept)
        { amount: 999, paymentStatus: 'paid', clinicId, installment: null },    // paid — excluded
      ],
    );
    const dashboardTotal = (await overdueReceivablesAmount(prisma as any, { clinicId }, now)).total;

    // "Hedef sayfa" tarafı: PaymentPlans.tsx'in yaptığı gibi listeleri
    // filtreleyip elle topluyoruz (isInstallmentOverdue ile aynı mantık +
    // taksitsiz pending ödemelerin doğrudan toplamı).
    const installments = [
      { amount: 100, dueDate: '2026-07-01', status: 'pending' },
      { amount: 200, dueDate: '2026-08-01', status: 'pending' },
      { amount: 300, dueDate: '2026-06-01', status: 'paid' },
    ];
    const standalonePayments = [
      { amount: 500, paymentStatus: 'pending' },
      { amount: 999, paymentStatus: 'paid' },
    ];
    const pageInstallmentTotal = installments
      .filter((i) => isInstallmentOverdue(i.dueDate, i.status, now))
      .reduce((s, i) => s + i.amount, 0);
    const pagePaymentTotal = standalonePayments
      .filter((p) => p.paymentStatus === 'pending')
      .reduce((s, p) => s + p.amount, 0);
    const pageTotal = pageInstallmentTotal + pagePaymentTotal;

    assert.equal(dashboardTotal, 600);
    assert.equal(pageTotal, 600);
    assert.equal(dashboardTotal, pageTotal, 'dashboard kartı ve hedef sayfa toplamı birebir eşleşmeli');
  }),
);

// ─── Sonuç ────────────────────────────────────────────────────────────────────

Promise.all(tests).then(() => {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
  console.log('─'.repeat(60));

  if (failed > 0) process.exit(1);
});
