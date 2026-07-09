/**
 * overdueInstallments.test.ts — Regression tests for the shared "overdue
 * payment plan installment" definition (server/src/utils/overdueInstallments.ts).
 *
 * Bug this guards against: the dashboard's "Bekleyen Tahsilatlar" card summed
 * *all* pending Payment rows regardless of due date, so it never actually
 * reflected overdue collections and did not match /payment-plans (which has
 * its own overdue notion: PaymentPlanInstallment.status === 'pending' &&
 * dueDate < now — nothing ever sets status to the literal string 'overdue').
 * This module is now the single definition both the dashboard card
 * (server/src/routes/dashboard.ts) and the frontend (src/pages/PaymentPlans.tsx
 * isOverdue) are built on.
 *
 * Run with: tsx src/tests/overdueInstallments.test.ts
 */

import assert from 'node:assert/strict';
import { overdueInstallmentWhere, isInstallmentOverdue } from '../utils/overdueInstallments.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: unknown) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ─── 1. overdueInstallmentWhere — Prisma where şekli ──────────────────────────

section('1. overdueInstallmentWhere — where filtresi şekli');

test('status her zaman pending — literal "overdue" durumu asla yazılmaz', () => {
  const where = overdueInstallmentWhere({ clinicId: 'clinic-A' });
  assert.equal(where.status, 'pending');
});

test('dueDate < now filtresi uygulanır', () => {
  const now = new Date('2026-07-09T12:00:00Z');
  const where = overdueInstallmentWhere({ clinicId: 'clinic-A' }, now);
  assert.deepEqual(where.dueDate, { lt: now });
});

test('klinik kapsamı nested plan.clinicId altında taşınır (PaymentPlanInstallment kendi clinicId alanına sahip değil)', () => {
  const where = overdueInstallmentWhere({ clinicId: 'clinic-A' });
  assert.deepEqual(where.plan, { clinicId: 'clinic-A' });
});

test('birden fazla klinik kapsamı da plan altına doğru şekilde taşınır', () => {
  const where = overdueInstallmentWhere({ clinicId: { in: ['clinic-A', 'clinic-B'] } });
  assert.deepEqual(where.plan, { clinicId: { in: ['clinic-A', 'clinic-B'] } });
});

// ─── 2. isInstallmentOverdue — frontend (PaymentPlans.tsx) ile aynı tanım ────

section('2. isInstallmentOverdue — PaymentPlans.tsx isOverdue ile aynı mantık');

test('pending + geçmiş vade → overdue', () => {
  const now = new Date('2026-07-09T00:00:00Z');
  assert.equal(isInstallmentOverdue('2026-07-01T00:00:00Z', 'pending', now), true);
});

test('pending + gelecek vade → overdue değil', () => {
  const now = new Date('2026-07-09T00:00:00Z');
  assert.equal(isInstallmentOverdue('2026-08-01T00:00:00Z', 'pending', now), false);
});

test('paid + geçmiş vade → overdue değil (ödenmiş taksit gecikmiş sayılmaz)', () => {
  const now = new Date('2026-07-09T00:00:00Z');
  assert.equal(isInstallmentOverdue('2026-07-01T00:00:00Z', 'paid', now), false);
});

test('literal status="overdue" (hiç yazılmayan değer) — pending olmadığı için false döner', () => {
  const now = new Date('2026-07-09T00:00:00Z');
  assert.equal(isInstallmentOverdue('2026-07-01T00:00:00Z', 'overdue', now), false);
});

// ─── 3. Regression: dashboard toplamı, gecikmiş taksitlerin toplamıyla eşleşir ──

section('3. Regression — kart toplamı yalnızca overdue taksitleri kapsar, tüm pending ödemeleri değil');

test('yalnızca vadesi geçmiş, ödenmemiş taksitler toplama dahil edilir', () => {
  const now = new Date('2026-07-09T00:00:00Z');
  const installments = [
    { amount: 100, dueDate: new Date('2026-07-01'), status: 'pending' }, // overdue
    { amount: 200, dueDate: new Date('2026-08-01'), status: 'pending' }, // not yet due
    { amount: 300, dueDate: new Date('2026-06-01'), status: 'paid' },    // already paid
  ];
  const sum = installments
    .filter((i) => isInstallmentOverdue(i.dueDate, i.status, now))
    .reduce((s, i) => s + i.amount, 0);
  assert.equal(sum, 100, 'only the overdue+unpaid installment should be summed');
});

// ─── Sonuç ────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
console.log('─'.repeat(60));

if (failed > 0) process.exit(1);
