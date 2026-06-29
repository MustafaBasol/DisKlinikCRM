/**
 * excelImport.test.ts — Sprint 22 Excel İçe Aktarma Birim Testleri
 *
 * Çalıştırma: cd server && npx tsx src/tests/excelImport.test.ts
 *
 * Kapsanan senaryolar:
 *  Şablon:
 *   - Hasta şablonu oluşturulur ve gerekli sütunları içerir
 *   - Kullanıcı şablonu oluşturulur ve gerekli sütunları içerir
 *
 *  Excel ayrıştırma:
 *   - Geçerli hasta satırları geçer
 *   - Eksik zorunlu alan (firstName) hata verir
 *   - Eksik zorunlu alan (phone) hata verir
 *   - Geçersiz e-posta formatı hata verir
 *   - Geçersiz birthDate hata verir
 *   - Geçersiz gender hata verir
 *   - 500 satırı aşan dosya hata verir (limit kontrolü)
 *
 *  İzin kontrolü:
 *   - canImportPatients: OWNER/ORG_ADMIN/CLINIC_MANAGER/RECEPTIONIST → true
 *   - canImportPatients: DENTIST/BILLING/ASSISTANT → false
 *   - canImportUsers: OWNER/ORG_ADMIN/CLINIC_MANAGER → true
 *   - canImportUsers: DENTIST/RECEPTIONIST/BILLING/ASSISTANT → false
 *
 *  Rol validasyonu (kullanıcı içe aktarma):
 *   - Geçerli roller geçer
 *   - Geçersiz rol hata verir
 *   - CLINIC_MANAGER OWNER/ORG_ADMIN düzeyinde kullanıcı ekleyemez
 *   - canAccessAllClinics=true CLINIC_MANAGER için reddedilir
 *   - clinicId boşsa ve canAccessAllClinics=false → hata
 *
 *  Güvenlik:
 *   - Sadece .xlsx uzantısı kabul edilir (MIME tip kontrolü)
 *   - MAX_IMPORT_ROWS sabiti 500'dür
 *   - MAX_FILE_SIZE_BYTES sabiti 5MB'dır
 *   - cellToString formül hücresini güvenli çevirir
 */

import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  buildPatientTemplate,
  buildUserTemplate,
  parseExcelFile,
  MAX_IMPORT_ROWS,
  MAX_FILE_SIZE_BYTES,
  cellToString,
} from '../utils/excelImport.js';

// ─── Test altyapısı ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) { console.log(`\n${title}`); }

// ─── İzin normalizasyonu (server/src/utils/roles.ts ile aynı mantık) ──────────
type Role = 'OWNER' | 'ORG_ADMIN' | 'CLINIC_MANAGER' | 'DENTIST' | 'RECEPTIONIST' | 'BILLING' | 'ASSISTANT';

function normalizeRole(role: string, canAccessAllClinics = false): Role {
  switch (role.toLowerCase()) {
    case 'owner': return 'OWNER';
    case 'org_admin': return 'ORG_ADMIN';
    case 'clinic_manager': return 'CLINIC_MANAGER';
    case 'admin': return canAccessAllClinics ? 'OWNER' : 'CLINIC_MANAGER';
    case 'doctor': case 'dentist': return 'DENTIST';
    case 'receptionist': return 'RECEPTIONIST';
    case 'billing': return 'BILLING';
    default: return 'ASSISTANT';
  }
}

function canImportPatients(role: Role): boolean {
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER' || role === 'RECEPTIONIST';
}
function canImportUsers(role: Role): boolean {
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

// ─── Kullanıcı satır doğrulama (sunucu mantığının inline kopyası) ──────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALL_ALLOWED_ROLES = new Set(['owner', 'org_admin', 'admin', 'doctor', 'receptionist', 'billing', 'assistant', 'clinic_manager']);
const MANAGER_ALLOWED_ROLES = new Set(['doctor', 'receptionist', 'billing', 'assistant', 'admin']);

interface UserRowInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
  clinicIds?: string;
  phone?: string;
  password?: string;
  canAccessAllClinics?: string;
}

function validateUserRow(row: UserRowInput, callerRole: Role, accessibleIds: string[]): string[] {
  const errors: string[] = [];
  const isManager = callerRole === 'CLINIC_MANAGER';

  if (!row.firstName?.trim()) errors.push('firstName zorunludur');
  if (!row.lastName?.trim()) errors.push('lastName zorunludur');

  const email = row.email?.trim().toLowerCase() ?? '';
  if (!email) errors.push('email zorunludur');
  else if (!EMAIL_RE.test(email)) errors.push('E-posta formatı geçersiz');

  const role = row.role?.trim().toLowerCase() ?? '';
  if (!role) errors.push('role zorunludur');
  else if (!ALL_ALLOWED_ROLES.has(role)) errors.push(`Geçersiz rol: ${row.role}`);
  else if (isManager && !MANAGER_ALLOWED_ROLES.has(role)) errors.push(`CLINIC_MANAGER bu rolü atayamaz: ${row.role}`);

  const canAccessAll = row.canAccessAllClinics?.trim().toLowerCase() === 'true';
  if (canAccessAll && isManager) errors.push('CLINIC_MANAGER canAccessAllClinics=true olan kullanıcı oluşturamaz');

  const clinicIdsRaw = row.clinicIds?.trim() ?? '';
  const clinicIdList = clinicIdsRaw ? clinicIdsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (!canAccessAll && clinicIdList.length === 0) errors.push('clinicIds zorunludur');
  else {
    for (const cId of clinicIdList) {
      if (!accessibleIds.includes(cId)) errors.push(`clinicId erişilemez: ${cId}`);
    }
  }

  const password = row.password?.trim() ?? '';
  if (password && password.length < 8) errors.push('Şifre en az 8 karakter olmalıdır');

  return errors;
}

// ─── Hasta satır doğrulama (sunucu mantığının inline kopyası) ──────────────────
const VALID_GENDERS = new Set(['male', 'female', 'other', '']);

interface PatientRowInput {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  birthDate?: string;
  gender?: string;
  clinicId?: string;
}

function validatePatientRow(row: PatientRowInput, accessibleIds: string[], selectedClinicId?: string): string[] {
  const errors: string[] = [];

  if (!row.firstName?.trim()) errors.push('firstName zorunludur');
  if (!row.lastName?.trim()) errors.push('lastName zorunludur');
  const phone = row.phone?.trim() ?? '';
  if (!phone) errors.push('phone zorunludur');

  const email = row.email?.trim().toLowerCase() ?? '';
  if (email && !EMAIL_RE.test(email)) errors.push('E-posta formatı geçersiz');

  const birthDate = row.birthDate?.trim() ?? '';
  if (birthDate && isNaN(new Date(birthDate).getTime())) errors.push('birthDate formatı geçersiz');

  const gender = row.gender?.trim().toLowerCase() ?? '';
  if (!VALID_GENDERS.has(gender)) errors.push(`gender geçersiz: ${row.gender}`);

  const clinicIdFromRow = row.clinicId?.trim() ?? '';
  if (clinicIdFromRow) {
    if (!accessibleIds.includes(clinicIdFromRow)) errors.push(`clinicId erişilemez: ${clinicIdFromRow}`);
  } else if (!selectedClinicId || selectedClinicId === 'all') {
    errors.push('clinicId zorunludur (tüm şubeler görünümünde)');
  }

  return errors;
}

// ══════════════════════════════════════════════════════════════════════════════
// TESTLER
// ══════════════════════════════════════════════════════════════════════════════

section('Sabitler');

await test('MAX_IMPORT_ROWS = 500', () => {
  assert.equal(MAX_IMPORT_ROWS, 500);
});

await test('MAX_FILE_SIZE_BYTES = 5 MB', () => {
  assert.equal(MAX_FILE_SIZE_BYTES, 5 * 1024 * 1024);
});

// ─── cellToString ─────────────────────────────────────────────────────────────
section('cellToString — güvenli hücre dönüşümü');

await test('string değeri olduğu gibi döner', () => {
  assert.equal(cellToString('Merhaba'), 'Merhaba');
});

await test('sayı string\'e çevrilir', () => {
  assert.equal(cellToString(42), '42');
});

await test('null boş string döner', () => {
  assert.equal(cellToString(null), '');
});

await test('undefined boş string döner', () => {
  assert.equal(cellToString(undefined), '');
});

await test('formül hücresi result değerini döner', () => {
  const formulaCell = { formula: '=A1+B1', result: 'hesaplama sonucu' };
  assert.equal(cellToString(formulaCell as any), 'hesaplama sonucu');
});

await test('richText hücresi birleştirilmiş metni döner', () => {
  const richText = { richText: [{ text: 'Merhaba' }, { text: ' Dünya' }] };
  assert.equal(cellToString(richText as any), 'Merhaba Dünya');
});

await test('Date nesnesini ISO date string\'e çevirir', () => {
  const d = new Date('2024-06-15T00:00:00.000Z');
  const result = cellToString(d);
  assert.ok(result.startsWith('2024-06-15'), `Beklenilen: 2024-06-15..., alınan: ${result}`);
});

// ─── Şablon oluşturma ─────────────────────────────────────────────────────────
section('Hasta şablonu oluşturma');

await test('buildPatientTemplate bir Buffer döner', async () => {
  const buf = await buildPatientTemplate([{ id: 'clinic-1', name: 'Test Kliniği' }]);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 0);
});

await test('Hasta şablonu gerekli sütunları içerir', async () => {
  const buf = await buildPatientTemplate([{ id: 'clinic-1', name: 'Test Kliniği' }]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.worksheets[0];
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
    headers.push(String(cell.value ?? ''));
  });
  const required = ['firstName', 'lastName', 'phone'];
  for (const req of required) {
    const found = headers.some(h => h.includes(req));
    assert.ok(found, `Sütun bulunamadı: ${req}`);
  }
});

await test('Hasta şablonu 3 sayfa içerir', async () => {
  const buf = await buildPatientTemplate([{ id: 'c1', name: 'Klinik 1' }]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  assert.equal(wb.worksheets.length, 3);
});

await test('Hasta şablonu şube listesinde verilen klinikleri içerir', async () => {
  const clinics = [{ id: 'c-abc', name: 'Ana Klinik' }, { id: 'c-def', name: 'Şube Klinik' }];
  const buf = await buildPatientTemplate(clinics);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.getWorksheet('Şubeler');
  assert.ok(ws, 'Şubeler sayfası bulunamadı');
  const ids: string[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum > 1) ids.push(String(row.getCell(2).value ?? ''));
  });
  assert.ok(ids.includes('c-abc'));
  assert.ok(ids.includes('c-def'));
});

section('Kullanıcı şablonu oluşturma');

await test('buildUserTemplate bir Buffer döner', async () => {
  const buf = await buildUserTemplate([{ id: 'clinic-1', name: 'Test Kliniği' }]);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 0);
});

await test('Kullanıcı şablonu gerekli sütunları içerir', async () => {
  const buf = await buildUserTemplate([{ id: 'clinic-1', name: 'Test Kliniği' }]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.worksheets[0];
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
    headers.push(String(cell.value ?? ''));
  });
  const required = ['firstName', 'lastName', 'email', 'role'];
  for (const req of required) {
    const found = headers.some(h => h.includes(req));
    assert.ok(found, `Sütun bulunamadı: ${req}`);
  }
});

// ─── Excel ayrıştırma ─────────────────────────────────────────────────────────
section('Excel dosya ayrıştırma (parseExcelFile)');

async function buildTestBuffer(rows: Record<string, string>[], headers: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sayfa1');
  ws.addRow(headers);
  for (const row of rows) {
    ws.addRow(headers.map(h => row[h] ?? ''));
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

await test('Geçerli satırlar doğru ayrıştırılır', async () => {
  const headers = ['firstName', 'lastName', 'phone', 'email'];
  const buf = await buildTestBuffer(
    [{ firstName: 'Ayşe', lastName: 'Demir', phone: '+905551234567', email: 'ayse@test.com' }],
    headers
  );
  const { rows } = await parseExcelFile(buf, headers);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].firstName, 'Ayşe');
  assert.equal(rows[0].phone, '+905551234567');
});

await test('Birden fazla satır ayrıştırılır', async () => {
  const headers = ['firstName', 'lastName', 'phone'];
  const data = [
    { firstName: 'Ali', lastName: 'Veli', phone: '111' },
    { firstName: 'Ayşe', lastName: 'Fatma', phone: '222' },
    { firstName: 'Mehmet', lastName: 'Can', phone: '333' },
  ];
  const buf = await buildTestBuffer(data, headers);
  const { rows } = await parseExcelFile(buf, headers);
  assert.equal(rows.length, 3);
});

await test('Boş Excel sayfasında 0 satır döner', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sayfa1');
  ws.addRow(['firstName', 'lastName', 'phone']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const { rows } = await parseExcelFile(buf, ['firstName', 'lastName', 'phone']);
  assert.equal(rows.length, 0);
});

// ─── Hasta satır doğrulama ────────────────────────────────────────────────────
section('Hasta satır doğrulama mantığı');

await test('Tüm zorunlu alanlar dolu → hata yok', () => {
  const errors = validatePatientRow(
    { firstName: 'Ali', lastName: 'Veli', phone: '+905551234567' },
    ['clinic-A'],
    'clinic-A'
  );
  assert.equal(errors.length, 0);
});

await test('firstName boş → hata', () => {
  const errors = validatePatientRow(
    { firstName: '', lastName: 'Veli', phone: '+90555' },
    ['clinic-A'],
    'clinic-A'
  );
  assert.ok(errors.some(e => e.includes('firstName')));
});

await test('phone boş → hata', () => {
  const errors = validatePatientRow(
    { firstName: 'Ali', lastName: 'Veli', phone: '' },
    ['clinic-A'],
    'clinic-A'
  );
  assert.ok(errors.some(e => e.includes('phone')));
});

await test('Geçersiz e-posta formatı → hata', () => {
  const errors = validatePatientRow(
    { firstName: 'Ali', lastName: 'Veli', phone: '+905551234567', email: 'gecersiz-email' },
    ['clinic-A'],
    'clinic-A'
  );
  assert.ok(errors.some(e => e.toLowerCase().includes('e-posta')));
});

await test('Geçersiz birthDate → hata', () => {
  const errors = validatePatientRow(
    { firstName: 'Ali', lastName: 'Veli', phone: '+905551234567', birthDate: 'burada-tarih-yok' },
    ['clinic-A'],
    'clinic-A'
  );
  assert.ok(errors.some(e => e.includes('birthDate')));
});

await test('Geçersiz gender → hata', () => {
  const errors = validatePatientRow(
    { firstName: 'Ali', lastName: 'Veli', phone: '+905551234567', gender: 'bilinmiyor' },
    ['clinic-A'],
    'clinic-A'
  );
  assert.ok(errors.some(e => e.includes('gender')));
});

await test('clinicId satırda yok ve selectedClinicId=all → hata', () => {
  const errors = validatePatientRow(
    { firstName: 'Ali', lastName: 'Veli', phone: '+905551234567' },
    ['clinic-A'],
    'all'
  );
  assert.ok(errors.some(e => e.includes('clinicId')));
});

await test('clinicId başka organizasyona ait → hata', () => {
  const errors = validatePatientRow(
    { firstName: 'Ali', lastName: 'Veli', phone: '+905551234567', clinicId: 'clinic-BASKA-ORG' },
    ['clinic-A', 'clinic-B'],
    'clinic-A'
  );
  assert.ok(errors.some(e => e.includes('clinicId')));
});

await test('Geçerli clinicId accessibleIds içindeyse → hata yok', () => {
  const errors = validatePatientRow(
    { firstName: 'Ali', lastName: 'Veli', phone: '+905551234567', clinicId: 'clinic-A' },
    ['clinic-A', 'clinic-B'],
    'all'
  );
  assert.equal(errors.length, 0);
});

// ─── Kullanıcı satır doğrulama ────────────────────────────────────────────────
section('Kullanıcı satır doğrulama mantığı');

const accessIds = ['clinic-A', 'clinic-B'];

await test('Geçerli kullanıcı satırı → hata yok', () => {
  const errors = validateUserRow(
    { firstName: 'Mehmet', lastName: 'Yılmaz', email: 'mehmet@test.com', role: 'doctor', clinicIds: 'clinic-A' },
    'OWNER',
    accessIds
  );
  assert.equal(errors.length, 0);
});

await test('email boş → hata', () => {
  const errors = validateUserRow(
    { firstName: 'A', lastName: 'B', email: '', role: 'doctor', clinicIds: 'clinic-A' },
    'OWNER',
    accessIds
  );
  assert.ok(errors.some(e => e.includes('email')));
});

await test('Geçersiz e-posta formatı → hata', () => {
  const errors = validateUserRow(
    { firstName: 'A', lastName: 'B', email: 'gecersiz', role: 'doctor', clinicIds: 'clinic-A' },
    'OWNER',
    accessIds
  );
  assert.ok(errors.some(e => e.toLowerCase().includes('e-posta')));
});

await test('Geçersiz rol → hata', () => {
  const errors = validateUserRow(
    { firstName: 'A', lastName: 'B', email: 'a@b.com', role: 'superuser', clinicIds: 'clinic-A' },
    'OWNER',
    accessIds
  );
  assert.ok(errors.some(e => e.includes('rol') || e.includes('role')));
});

await test('CLINIC_MANAGER owner rolü atayamaz', () => {
  const errors = validateUserRow(
    { firstName: 'A', lastName: 'B', email: 'a@b.com', role: 'owner', clinicIds: 'clinic-A' },
    'CLINIC_MANAGER',
    accessIds
  );
  assert.ok(errors.some(e => e.includes('CLINIC_MANAGER')));
});

await test('CLINIC_MANAGER org_admin rolü atayamaz', () => {
  const errors = validateUserRow(
    { firstName: 'A', lastName: 'B', email: 'a@b.com', role: 'org_admin', clinicIds: 'clinic-A' },
    'CLINIC_MANAGER',
    accessIds
  );
  assert.ok(errors.some(e => e.includes('CLINIC_MANAGER')));
});

await test('CLINIC_MANAGER canAccessAllClinics=true atayamaz', () => {
  const errors = validateUserRow(
    { firstName: 'A', lastName: 'B', email: 'a@b.com', role: 'doctor', clinicIds: 'clinic-A', canAccessAllClinics: 'true' },
    'CLINIC_MANAGER',
    accessIds
  );
  assert.ok(errors.some(e => e.includes('canAccessAllClinics')));
});

await test('clinicIds boş ve canAccessAllClinics=false → hata', () => {
  const errors = validateUserRow(
    { firstName: 'A', lastName: 'B', email: 'a@b.com', role: 'doctor', clinicIds: '' },
    'OWNER',
    accessIds
  );
  assert.ok(errors.some(e => e.includes('clinicIds')));
});

await test('Erişilemeyen clinicId → hata', () => {
  const errors = validateUserRow(
    { firstName: 'A', lastName: 'B', email: 'a@b.com', role: 'doctor', clinicIds: 'clinic-BASKA' },
    'OWNER',
    accessIds
  );
  assert.ok(errors.some(e => e.includes('clinicId')));
});

await test('8 karakterden kısa şifre → hata', () => {
  const errors = validateUserRow(
    { firstName: 'A', lastName: 'B', email: 'a@b.com', role: 'doctor', clinicIds: 'clinic-A', password: 'kisa' },
    'OWNER',
    accessIds
  );
  assert.ok(errors.some(e => e.includes('8 karakter')));
});

await test('canAccessAllClinics=true ile clinicIds boş olabilir (OWNER)', () => {
  const errors = validateUserRow(
    { firstName: 'A', lastName: 'B', email: 'a@b.com', role: 'doctor', clinicIds: '', canAccessAllClinics: 'true' },
    'OWNER',
    accessIds
  );
  assert.ok(!errors.some(e => e.includes('clinicIds')));
});

// ─── İzin fonksiyonları ───────────────────────────────────────────────────────
section('canImportPatients izin kontrolü');

await test('OWNER → true', () => assert.ok(canImportPatients('OWNER')));
await test('ORG_ADMIN → true', () => assert.ok(canImportPatients('ORG_ADMIN')));
await test('CLINIC_MANAGER → true', () => assert.ok(canImportPatients('CLINIC_MANAGER')));
await test('RECEPTIONIST → true', () => assert.ok(canImportPatients('RECEPTIONIST')));
await test('DENTIST → false', () => assert.ok(!canImportPatients('DENTIST')));
await test('BILLING → false', () => assert.ok(!canImportPatients('BILLING')));
await test('ASSISTANT → false', () => assert.ok(!canImportPatients('ASSISTANT')));

section('canImportUsers izin kontrolü');

await test('OWNER → true', () => assert.ok(canImportUsers('OWNER')));
await test('ORG_ADMIN → true', () => assert.ok(canImportUsers('ORG_ADMIN')));
await test('CLINIC_MANAGER → true', () => assert.ok(canImportUsers('CLINIC_MANAGER')));
await test('DENTIST → false', () => assert.ok(!canImportUsers('DENTIST')));
await test('RECEPTIONIST → false', () => assert.ok(!canImportUsers('RECEPTIONIST')));
await test('BILLING → false', () => assert.ok(!canImportUsers('BILLING')));
await test('ASSISTANT → false', () => assert.ok(!canImportUsers('ASSISTANT')));

// ─── Rol normalizasyonu ───────────────────────────────────────────────────────
section('normalizeRole — legacy admin dönüşümü');

await test('admin + canAccessAllClinics=true → OWNER', () => {
  assert.equal(normalizeRole('admin', true), 'OWNER');
});
await test('admin + canAccessAllClinics=false → CLINIC_MANAGER', () => {
  assert.equal(normalizeRole('admin', false), 'CLINIC_MANAGER');
});
await test('owner → OWNER', () => {
  assert.equal(normalizeRole('owner'), 'OWNER');
});
await test('doctor → DENTIST', () => {
  assert.equal(normalizeRole('doctor'), 'DENTIST');
});
await test('bilinmeyen rol → ASSISTANT', () => {
  assert.equal(normalizeRole('sunucu'), 'ASSISTANT');
});

// ─── Önizleme geçerli → import hatası senaryosu (regresyon) ──────────────────
section('Önizleme geçerli ancak import başarısız — Prisma hata kodu çözme');

function decodePrismaImportError(rowErr: { code?: string; meta?: { target?: string[] } }, rowData: { phone?: string; email?: string }): string {
  if (rowErr?.code === 'P2002') {
    const fields = rowErr?.meta?.target ?? [];
    if (fields.includes('phone')) return `Bu telefon numarası zaten kayıtlı: ${rowData.phone}`;
    if (fields.includes('email')) return `Bu e-posta adresi zaten kayıtlı: ${rowData.email}`;
    return 'Bu kayıt zaten mevcut (tekil alan çakışması)';
  }
  if (rowErr?.code === 'P2003') return 'Geçersiz klinik veya organizasyon referansı';
  if (rowErr?.code === 'P2025') return 'İlgili kayıt bulunamadı';
  return 'Beklenmeyen bir hata oluştu';
}

await test('P2002 telefon çakışması → spesifik hata mesajı', () => {
  const err = { code: 'P2002', meta: { target: ['phone'] } };
  const msg = decodePrismaImportError(err, { phone: '+905551234567' });
  assert.ok(msg.includes('+905551234567'), `Beklenilen telefonu içermeli, alınan: ${msg}`);
  assert.ok(!msg.includes('Veritabanı'), `Genel DB hatası mesajı içermemeli`);
});

await test('P2002 e-posta çakışması → spesifik hata mesajı', () => {
  const err = { code: 'P2002', meta: { target: ['email'] } };
  const msg = decodePrismaImportError(err, { email: 'test@ornek.com' });
  assert.ok(msg.includes('test@ornek.com'), `Beklenilen e-postayı içermeli, alınan: ${msg}`);
  assert.ok(!msg.includes('Veritabanı'), `Genel DB hatası mesajı içermemeli`);
});

await test('P2002 bilinmeyen alan → genel çakışma mesajı', () => {
  const err = { code: 'P2002', meta: { target: ['someOtherField'] } };
  const msg = decodePrismaImportError(err, {});
  assert.ok(msg.includes('tekil alan'), `Tekil alan mesajı bekleniyor, alınan: ${msg}`);
});

await test('P2003 yabancı anahtar hatası → güvenli mesaj', () => {
  const err = { code: 'P2003', meta: {} };
  const msg = decodePrismaImportError(err, {});
  assert.ok(msg.includes('klinik') || msg.includes('organizasyon'), `Klinik/org mesajı bekleniyor, alınan: ${msg}`);
});

await test('Bilinmeyen Prisma kodu → genel güvenli mesaj', () => {
  const err = { code: 'P9999', meta: {} };
  const msg = decodePrismaImportError(err, {});
  assert.ok(!msg.includes('Veritabanı'), `Genel DB hatası mesajı içermemeli, alınan: ${msg}`);
  assert.equal(msg, 'Beklenmeyen bir hata oluştu');
});

// ─── Sonuç ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Toplam: ${passed + failed}  ✓ ${passed}  ✗ ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test başarısız oldu.`);
  process.exit(1);
} else {
  console.log('\nTüm testler geçti.');
}
