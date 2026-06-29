/**
 * paymentValidation.test.ts — POST/PUT /api/payments doğrulama davranışı
 *
 * Koşturma: cd server && npx tsx src/tests/paymentValidation.test.ts
 *
 * Bağlam: PaymentForm'da sadece hasta seçilip diğer alanlar boş/geçersiz
 * bırakıldığında (örn. amount=0) backend 400 dönüyordu, ama hata gövdesi
 * `validation.error.format()` ile derin iç içe bir nesne olarak geliyordu.
 * Frontend bu nesneyi doğrudan JSX'te render etmeye çalışınca React #31
 * hatasıyla çöküyordu ("Objects are not valid as a React child").
 *
 * Fix: route handler artık `{ error, issues: [{ path, message }] }` şeklinde
 * düz/okunabilir bir gövde döndürüyor (server/src/routes/payments.ts).
 * Bu test, paymentSchema doğrulama kurallarını ve route'un issue-mapping
 * mantığını (aynı dönüşüm burada simüle edilir) doğrular.
 */

import assert from 'node:assert/strict';
import { paymentSchema } from '../schemas/index.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err?.message ?? err}`);
    failed++;
  }
}

// server/src/routes/payments.ts ile aynı dönüşüm — issues her zaman düz string olmalı
function mapIssuesToSafeShape(issues: { path: PropertyKey[]; message: string }[]) {
  return issues.map(i => ({ path: i.path.join('.'), message: i.message }));
}

const validPatientId = '11111111-1111-4111-8111-111111111111';
const validTreatmentCaseId = '22222222-2222-4222-8222-222222222222';

console.log('\n=== paymentSchema: gerekli alanlar ===');

test('patientId zorunlu — eksikse reddedilir', () => {
  const result = paymentSchema.safeParse({
    amount: 100,
    paymentMethod: 'cash',
  });
  assert.equal(result.success, false);
});

test('amount=0 reddedilir (positive() kuralı)', () => {
  const result = paymentSchema.safeParse({
    patientId: validPatientId,
    amount: 0,
    paymentMethod: 'cash',
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const safeIssues = mapIssuesToSafeShape(result.error.issues);
    assert.ok(safeIssues.some(i => i.path === 'amount'), 'amount alanı için issue olmalı');
    assert.ok(typeof safeIssues[0].message === 'string', 'issue.message string olmalı');
  }
});

test('amount negatif reddedilir', () => {
  const result = paymentSchema.safeParse({
    patientId: validPatientId,
    amount: -50,
    paymentMethod: 'cash',
  });
  assert.equal(result.success, false);
});

test('paymentMethod eksikse reddedilir', () => {
  const result = paymentSchema.safeParse({
    patientId: validPatientId,
    amount: 100,
  });
  assert.equal(result.success, false);
});

test('treatmentCaseId opsiyoneldir — boşken kabul edilir', () => {
  const result = paymentSchema.safeParse({
    patientId: validPatientId,
    amount: 100,
    paymentMethod: 'cash',
  });
  assert.equal(result.success, true);
});

test('treatmentCaseId boş string ("") null olarak normalize edilir ve kabul edilir', () => {
  const result = paymentSchema.safeParse({
    patientId: validPatientId,
    treatmentCaseId: '',
    amount: 100,
    paymentMethod: 'cash',
  });
  assert.equal(result.success, true, 'Boş string treatmentCaseId kabul edilmeli (null\'a normalize edilir)');
  if (result.success) {
    assert.equal(result.data.treatmentCaseId, null, 'Boş string null\'a dönüştürülmeli');
  }
});

test('treatmentCaseId verilirse geçerli bir UUID olmalı', () => {
  const result = paymentSchema.safeParse({
    patientId: validPatientId,
    treatmentCaseId: 'not-a-uuid',
    amount: 100,
    paymentMethod: 'cash',
  });
  assert.equal(result.success, false);
});

test('geçerli ve eksiksiz veri kabul edilir (paymentStatus/paidAt varsayılanlarla)', () => {
  const result = paymentSchema.safeParse({
    patientId: validPatientId,
    treatmentCaseId: validTreatmentCaseId,
    amount: 250.5,
    paymentMethod: 'card',
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.paymentStatus, 'paid');
    assert.ok(result.data.paidAt instanceof Date);
  }
});

console.log('\n=== Hata gövdesi şekli: route artık düz/okunabilir issues döndürür ===');

test('issues dizisi her zaman string path + string message içerir (nested object değil)', () => {
  const result = paymentSchema.safeParse({
    amount: 0,
    paymentMethod: 'invalid-method',
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const safeIssues = mapIssuesToSafeShape(result.error.issues);
    for (const issue of safeIssues) {
      assert.equal(typeof issue.path, 'string', 'path her zaman düz string olmalı (örn. "amount")');
      assert.equal(typeof issue.message, 'string', 'message her zaman düz string olmalı, asla nesne değil');
    }
    // Eski davranış (validation.error.format()) iç içe nesne döndürürdü — bu artık asla olmamalı.
    assert.ok(!safeIssues.some(i => typeof (i as any).message === 'object'));
  }
});

console.log(`\nSonuç: ${passed} geçti, ${failed} başarısız\n`);
if (failed > 0) process.exit(1);
