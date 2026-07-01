/**
 * appointmentUpdateValidation.test.ts — POST/PUT /api/appointments doğrulama davranışı
 *
 * Koşturma: cd server && npx tsx src/tests/appointmentUpdateValidation.test.ts
 *
 * Bağlam: Randevu düzenleme sırasında backend 400 dönüyordu, ama hata gövdesi
 * `validation.error.format()` ile derin iç içe bir nesne olarak geliyordu
 * ({ error: { _errors: [], practitionerId: { _errors: [...] } } }). Frontend
 * (AppointmentForm.tsx) bu nesneyi doğrudan `error` state'ine yazıp JSX'te
 * render edince React #31 hatasıyla çöküyordu ("Objects are not valid as a
 * React child").
 *
 * Fix: appointments.ts route handler'ları (POST ve PUT) artık
 * `{ error: 'Validation failed', issues: [{ path, message }] }` şeklinde
 * düz/okunabilir bir gövde döndürüyor — payments.ts'deki mevcut desenle aynı.
 * Bu test appointmentSchema/appointmentUpdateSchema kurallarını ve route'un
 * issue-mapping mantığını (aynı dönüşüm burada simüle edilir) doğrular.
 *
 * İkinci fix: patientId/practitionerId/appointmentTypeId/treatmentCaseId
 * alanları `z.string().uuid()` gerektiriyordu, ama prod/demo verisinde bu
 * ID'ler `demo_patient_...`, `demo_svc_...` gibi UUID olmayan string'ler.
 * Bu, gerçek kayıtları düzenlerken 400 ile çöküyordu. Şema artık sadece
 * boş olmayan string istiyor (`z.string().min(1)`); var olma/klinik-scope
 * kontrolü zaten route handler'da relationGuards (findPatientInClinic vb.)
 * ile ayrıca yapılıyor.
 */

import assert from 'node:assert/strict';
import { appointmentSchema, appointmentUpdateSchema } from '../schemas/index.js';

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

// server/src/routes/appointments.ts ile aynı dönüşüm — issues her zaman düz string olmalı
function mapIssuesToSafeShape(issues: { path: PropertyKey[]; message: string }[]) {
  return issues.map(i => ({ path: i.path.join('.'), message: i.message }));
}

const validId = '11111111-1111-4111-8111-111111111111';
const validId2 = '22222222-2222-4222-8222-222222222222';
const validId3 = '33333333-3333-4333-8333-333333333333';

console.log('\n=== appointmentSchema (create): gerekli alanlar ===');

test('practitionerId boş string ise reddedilir', () => {
  const result = appointmentSchema.safeParse({
    patientId: validId,
    practitionerId: '',
    appointmentTypeId: validId2,
    startTime: '2026-08-01T09:00:00.000Z',
    endTime: '2026-08-01T09:30:00.000Z',
  });
  assert.equal(result.success, false);
});

test('UUID olmayan ama boş olmayan demo ID\'ler kabul edilir (varlık kontrolü route\'da yapılır)', () => {
  const result = appointmentSchema.safeParse({
    patientId: 'demo_patient_noramedi_ahmet_sahin',
    practitionerId: '0ff12df5-bced-4074-9719-7ba39f60e075',
    appointmentTypeId: 'demo_svc_noramedi_test_oral_surgery',
    startTime: '2026-08-01T09:00:00.000Z',
    endTime: '2026-08-01T09:30:00.000Z',
  });
  assert.equal(result.success, true);
});

test('endTime startTime\'dan önce ise reddedilir', () => {
  const result = appointmentSchema.safeParse({
    patientId: validId,
    practitionerId: validId2,
    appointmentTypeId: validId3,
    startTime: '2026-08-01T09:30:00.000Z',
    endTime: '2026-08-01T09:00:00.000Z',
  });
  assert.equal(result.success, false);
});

test('geçerli veri kabul edilir', () => {
  const result = appointmentSchema.safeParse({
    patientId: validId,
    practitionerId: validId2,
    appointmentTypeId: validId3,
    startTime: '2026-08-01T09:00:00.000Z',
    endTime: '2026-08-01T09:30:00.000Z',
  });
  assert.equal(result.success, true);
});

console.log('\n=== appointmentUpdateSchema (edit): partial alanlar ===');

test('sadece notes gönderilse kabul edilir (partial)', () => {
  const result = appointmentUpdateSchema.safeParse({ notes: 'Hasta notu güncellendi' });
  assert.equal(result.success, true);
});

test('practitionerId gönderilirse boş olmamalı', () => {
  const result = appointmentUpdateSchema.safeParse({ practitionerId: '' });
  assert.equal(result.success, false);
});

test('practitionerId UUID olmayan demo ID olarak gönderilirse kabul edilir', () => {
  const result = appointmentUpdateSchema.safeParse({ practitionerId: 'demo_dentist_noramedi_01' });
  assert.equal(result.success, true);
});

test('patientId/appointmentTypeId demo ID + treatmentCaseId null olan gerçek PUT payload kabul edilir', () => {
  const result = appointmentUpdateSchema.safeParse({
    patientId: 'demo_patient_noramedi_ahmet_sahin',
    practitionerId: '0ff12df5-bced-4074-9719-7ba39f60e075',
    appointmentTypeId: 'demo_svc_noramedi_test_oral_surgery',
    startTime: '2026-07-04T10:00:00.000Z',
    endTime: '2026-07-04T10:45:00.000Z',
    notes: '[DEMO:NORAMEDI_TEST:APPOINTMENTS] Cerrahi değerlendirme randevusu.',
    treatmentCaseId: null,
  });
  assert.equal(result.success, true);
});

test('startTime verilip endTime verilmezse zaman sırası kontrolü atlanır (kabul edilir)', () => {
  const result = appointmentUpdateSchema.safeParse({ startTime: '2026-08-01T09:00:00.000Z' });
  assert.equal(result.success, true);
});

test('hem startTime hem endTime verilirse sıra kontrol edilir', () => {
  const result = appointmentUpdateSchema.safeParse({
    startTime: '2026-08-01T09:30:00.000Z',
    endTime: '2026-08-01T09:00:00.000Z',
  });
  assert.equal(result.success, false);
});

console.log('\n=== Hata gövdesi şekli: route artık düz/okunabilir issues döndürür ===');

test('issues dizisi her zaman string path + string message içerir (nested object değil)', () => {
  const result = appointmentUpdateSchema.safeParse({
    practitionerId: '',
    appointmentTypeId: '',
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const safeIssues = mapIssuesToSafeShape(result.error.issues);
    assert.ok(safeIssues.length > 0);
    for (const issue of safeIssues) {
      assert.equal(typeof issue.path, 'string', 'path her zaman düz string olmalı (örn. "practitionerId")');
      assert.equal(typeof issue.message, 'string', 'message her zaman düz string olmalı, asla nesne değil');
    }
    // Eski davranış (validation.error.format()) iç içe nesne döndürürdü — bu artık asla olmamalı.
    assert.ok(!safeIssues.some(i => typeof (i as any).message === 'object'));
  }
});

console.log(`\nSonuç: ${passed} geçti, ${failed} başarısız\n`);
if (failed > 0) process.exit(1);
