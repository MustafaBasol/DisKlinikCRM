/**
 * patientSharedPhone.test.ts — Shared phone/email patient scenarios
 *
 * Koşturma: cd server && npx tsx src/tests/patientSharedPhone.test.ts
 *
 * Senaryolar:
 *  - Aynı telefon numarasıyla birden fazla hasta oluşturulabilir (aile/vasi senaryosu)
 *  - Aynı e-posta adresiyle birden fazla hasta oluşturulabilir
 *  - E-posta olmadan hasta oluşturulabilir
 *  - check-phone-duplicate uyarı döner, kaydetmeyi engellemez
 *  - WhatsApp: tek eşleşmede otomatik bağlantı, birden fazla eşleşmede null döner
 *  - WhatsApp: birden fazla hasta aynı telefonu paylaşıyorsa yanlış hastaya atanmaz
 *  - Klinik kapsamı (tenant isolation) korunur
 */

import assert from 'node:assert/strict';

// ─── Yardımcı tipler ─────────────────────────────────────────────────────────

type Patient = {
  id: string;
  clinicId: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  deletedAt: Date | null;
};

// ─── Sahte veritabanı ────────────────────────────────────────────────────────

let patientStore: Patient[] = [];
let idCounter = 1;

function resetStore() {
  patientStore = [];
  idCounter = 1;
}

function createPatient(data: Omit<Patient, 'id' | 'deletedAt'>): Patient {
  const patient: Patient = { ...data, id: `p-${idCounter++}`, deletedAt: null };
  patientStore.push(patient);
  return patient;
}

// ─── Telefon normalleştirme (üretim mantığının basit kopyası) ─────────────────

function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

function getPhoneVariants(digits: string): string[] {
  const vs = new Set<string>();
  if (!digits) return [];
  vs.add(digits);
  if (digits.startsWith('90') && digits.length === 12) {
    vs.add(digits.slice(2));
    vs.add(`0${digits.slice(2)}`);
  } else if (digits.startsWith('0') && digits.length === 11) {
    vs.add(digits.slice(1));
    vs.add(`90${digits.slice(1)}`);
  } else if (digits.length === 10) {
    vs.add(`0${digits}`);
    vs.add(`90${digits}`);
  }
  return [...vs];
}

function phonesMatch(a: string | null, b: string): boolean {
  if (!a) return false;
  const digitsA = normalizePhoneDigits(a);
  const digitsB = normalizePhoneDigits(b);
  const variantsA = getPhoneVariants(digitsA);
  const variantsB = getPhoneVariants(digitsB);
  return variantsA.some(v => variantsB.includes(v));
}

// ─── Sahte findPatientsByPhone ────────────────────────────────────────────────

function findPatientsByPhone(clinicId: string, phone: string): Patient[] {
  const exact = patientStore.filter(p => p.clinicId === clinicId && p.phone === phone && !p.deletedAt);
  if (exact.length > 0) return exact;
  return patientStore.filter(p => p.clinicId === clinicId && !p.deletedAt && phonesMatch(p.phone, phone));
}

/** Returns single patient if exactly 1 match, null if 0 or multiple. */
function findExistingPatientByPhone(clinicId: string, phone: string): Patient | null {
  const matches = findPatientsByPhone(clinicId, phone);
  return matches.length === 1 ? matches[0] : null;
}

// ─── Sahte checkPhoneDuplicate ────────────────────────────────────────────────

function checkPhoneDuplicate(clinicId: string, phone: string, excludePatientId?: string): Patient[] {
  return patientStore.filter(
    p => p.clinicId === clinicId && p.phone === phone && !p.deletedAt && p.id !== excludePatientId,
  );
}

// ─── Hasta seçimi simülasyonu ─────────────────────────────────────────────────

type PendingPatientOption = { id: string; firstName: string; lastName: string };

function simulatePatientSelection(
  pendingOptions: PendingPatientOption[],
  input: string,
): PendingPatientOption | null {
  const numeric = /^\s*(\d+)\s*$/.exec(input);
  if (numeric) {
    const idx = parseInt(numeric[1], 10);
    if (idx >= 1 && idx <= pendingOptions.length) return pendingOptions[idx - 1];
    return null;
  }
  const q = input.trim().toLocaleLowerCase('tr-TR');
  return (
    pendingOptions.find(p => {
      const full = `${p.firstName} ${p.lastName}`.toLocaleLowerCase('tr-TR');
      return full.includes(q) || q.includes(p.firstName.toLocaleLowerCase('tr-TR'));
    }) ?? null
  );
}

function resolvePatientFromState(
  matchingPatients: Patient[],
  storedCustomerName: string | null,
): Patient | null {
  if (matchingPatients.length === 1) return matchingPatients[0];
  if (matchingPatients.length > 1 && storedCustomerName) {
    const stored = storedCustomerName.toLocaleLowerCase('tr-TR').trim();
    return matchingPatients.find(p => `${p.firstName} ${p.lastName}`.toLocaleLowerCase('tr-TR') === stored) ?? null;
  }
  return null;
}

// ─── Testler ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ── Hasta oluşturma ───────────────────────────────────────────────────────────

console.log('\n=== Hasta Oluşturma ===');

test('Aynı telefon numarasıyla birden fazla hasta oluşturulabilir', () => {
  resetStore();
  const phone = '+90 532 111 11 11';
  const p1 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Mehmet', lastName: 'Yılmaz', phone, email: null });
  const p2 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Zeynep', lastName: 'Yılmaz', phone, email: null });
  assert.ok(p1.id !== p2.id, 'İki hastanın ID\'si farklı olmalı');
  assert.equal(patientStore.length, 2);
  const matches = findPatientsByPhone('clinic-1', phone);
  assert.equal(matches.length, 2, 'Aynı telefon için iki hasta bulunmalı');
});

test('Aynı e-posta adresiyle birden fazla hasta oluşturulabilir', () => {
  resetStore();
  const email = 'aile@example.com';
  const p1 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Anne', lastName: 'Demir', phone: null, email });
  const p2 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Çocuk', lastName: 'Demir', phone: null, email });
  assert.ok(p1.id !== p2.id);
  assert.equal(patientStore.length, 2);
});

test('E-posta olmadan hasta oluşturulabilir', () => {
  resetStore();
  const p = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Ali', lastName: 'Veli', phone: '05321111111', email: null });
  assert.equal(p.email, null);
  assert.ok(p.id);
});

test('Telefon olmadan hasta oluşturulabilir', () => {
  resetStore();
  const p = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Ali', lastName: 'Veli', phone: null, email: 'ali@example.com' });
  assert.equal(p.phone, null);
  assert.ok(p.id);
});

// ── Çoğaltma uyarısı ─────────────────────────────────────────────────────────

console.log('\n=== Çoğaltma Uyarısı (Non-blocking) ===');

test('check-phone-duplicate: yeni hasta için eşleşen varsa uyarı döner', () => {
  resetStore();
  const phone = '05321234567';
  createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Mevcut', lastName: 'Hasta', phone, email: null });
  const duplicates = checkPhoneDuplicate('clinic-1', phone);
  assert.equal(duplicates.length, 1, 'Bir çoğaltma bulunmalı');
  assert.equal(duplicates[0].firstName, 'Mevcut');
});

test('check-phone-duplicate: düzenleme sırasında kendi kaydı hariç tutulur', () => {
  resetStore();
  const phone = '05321234567';
  const p = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Mevcut', lastName: 'Hasta', phone, email: null });
  const duplicates = checkPhoneDuplicate('clinic-1', phone, p.id);
  assert.equal(duplicates.length, 0, 'Kendi kaydı hariç tutulunca çoğaltma olmamalı');
});

test('check-phone-duplicate: eşleşme yoksa boş dizi döner', () => {
  resetStore();
  const duplicates = checkPhoneDuplicate('clinic-1', '05329999999');
  assert.equal(duplicates.length, 0);
});

test('check-phone-duplicate: kaydetmeyi engellemiyor (sadece uyarı)', () => {
  resetStore();
  const phone = '05321234567';
  createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Birinci', lastName: 'Hasta', phone, email: null });
  // Çoğaltma uyarısına rağmen ikinci hasta oluşturulabilir
  const duplicates = checkPhoneDuplicate('clinic-1', phone);
  assert.equal(duplicates.length, 1, 'Uyarı var');
  const second = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'İkinci', lastName: 'Hasta', phone, email: null });
  assert.ok(second.id, 'İkinci hasta başarıyla oluşturuldu');
  assert.equal(patientStore.length, 2);
});

// ── WhatsApp eşleştirme ───────────────────────────────────────────────────────

console.log('\n=== WhatsApp Hasta Eşleştirme ===');

test('WhatsApp: tek eşleşmede otomatik bağlantı kurulur', () => {
  resetStore();
  const phone = '05321234567';
  const p = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Tek', lastName: 'Hasta', phone, email: null });
  const result = findExistingPatientByPhone('clinic-1', phone);
  assert.ok(result, 'Hasta bulunmalı');
  assert.equal(result!.id, p.id);
});

test('WhatsApp: birden fazla hasta aynı telefonu paylaşıyorsa null döner (yanlış atama yapılmaz)', () => {
  resetStore();
  const phone = '05321234567';
  createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Mehmet', lastName: 'Yılmaz', phone, email: null });
  createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Zeynep', lastName: 'Yılmaz', phone, email: null });
  const result = findExistingPatientByPhone('clinic-1', phone);
  assert.equal(result, null, 'Belirsiz durumda null dönmeli, yanlış hastaya atama yapılmamalı');
});

test('WhatsApp: eşleşme olmadığında null döner', () => {
  resetStore();
  const result = findExistingPatientByPhone('clinic-1', '05329999999');
  assert.equal(result, null);
});

test('WhatsApp: normalize edilmiş telefon varyantları eşleşir (tek hasta)', () => {
  resetStore();
  const p = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Ali', lastName: 'Veli', phone: '905321234567', email: null });
  // Meta'dan gelen format: +90 ile
  const result = findExistingPatientByPhone('clinic-1', '05321234567');
  assert.ok(result, 'Normalleştirilmiş formatta eşleşmeli');
  assert.equal(result!.id, p.id);
});

// ── Klinik kapsamı (tenant isolation) ────────────────────────────────────────

console.log('\n=== Klinik Kapsamı (Tenant Isolation) ===');

test('Aynı telefon numarasıyla farklı kliniklerde ayrı hastalar bulunur', () => {
  resetStore();
  const phone = '05321234567';
  createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Hasta A', lastName: 'Klinik1', phone, email: null });
  createPatient({ clinicId: 'clinic-2', organizationId: 'org-1', firstName: 'Hasta B', lastName: 'Klinik2', phone, email: null });
  const resultC1 = findExistingPatientByPhone('clinic-1', phone);
  const resultC2 = findExistingPatientByPhone('clinic-2', phone);
  assert.ok(resultC1, 'Klinik-1 için tek hasta bulunmalı');
  assert.ok(resultC2, 'Klinik-2 için tek hasta bulunmalı');
  assert.notEqual(resultC1!.id, resultC2!.id, 'Farklı hastalara işaret etmeli');
});

test('check-phone-duplicate klinik kapsamını korur', () => {
  resetStore();
  const phone = '05321234567';
  createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Hasta', lastName: 'Klinik1', phone, email: null });
  // Klinik-2'de arama yapıldığında klinik-1 hastası görünmemeli
  const duplicates = checkPhoneDuplicate('clinic-2', phone);
  assert.equal(duplicates.length, 0, 'Farklı klinikteki hasta çoğaltma sayılmamalı');
});

test('WhatsApp: başka klinikteki paylaşımlı telefon eşleştirmeyi etkilemez', () => {
  resetStore();
  const phone = '05321234567';
  // Klinik-1\'de iki hasta (belirsiz)
  createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'P1', lastName: 'C1', phone, email: null });
  createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'P2', lastName: 'C1', phone, email: null });
  // Klinik-2\'de tek hasta (net eşleşme)
  createPatient({ clinicId: 'clinic-2', organizationId: 'org-1', firstName: 'P3', lastName: 'C2', phone, email: null });
  assert.equal(findExistingPatientByPhone('clinic-1', phone), null, 'Klinik-1 belirsiz — null dönmeli');
  assert.ok(findExistingPatientByPhone('clinic-2', phone), 'Klinik-2 net eşleşme — hasta dönmeli');
});

// ── Hasta seçim akışı ────────────────────────────────────────────────────────

console.log('\n=== Hasta Seçim Akışı (Paylaşımlı Telefon) ===');

test('Paylaşımlı telefonda numerik seçim ile hasta seçilir', () => {
  resetStore();
  const phone = '05321234567';
  const p1 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Mehmet', lastName: 'Yılmaz', phone, email: null });
  const p2 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Zeynep', lastName: 'Yılmaz', phone, email: null });
  const options: PendingPatientOption[] = [
    { id: p1.id, firstName: p1.firstName, lastName: p1.lastName },
    { id: p2.id, firstName: p2.firstName, lastName: p2.lastName },
  ];
  const selected = simulatePatientSelection(options, '1');
  assert.ok(selected, 'Seçim yapılmalı');
  assert.equal(selected!.id, p1.id, '1 ile Mehmet seçilmeli');
});

test('Paylaşımlı telefonda ikinci hastayı numerik seçimle seçer', () => {
  resetStore();
  const phone = '05321234567';
  const p1 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Mehmet', lastName: 'Yılmaz', phone, email: null });
  const p2 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Zeynep', lastName: 'Yılmaz', phone, email: null });
  const options: PendingPatientOption[] = [
    { id: p1.id, firstName: p1.firstName, lastName: p1.lastName },
    { id: p2.id, firstName: p2.firstName, lastName: p2.lastName },
  ];
  const selected = simulatePatientSelection(options, '2');
  assert.ok(selected);
  assert.equal(selected!.id, p2.id, '2 ile Zeynep seçilmeli');
});

test('Geçersiz numara seçiminde null döner', () => {
  resetStore();
  const phone = '05321234567';
  const p1 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Mehmet', lastName: 'Yılmaz', phone, email: null });
  const options: PendingPatientOption[] = [{ id: p1.id, firstName: p1.firstName, lastName: p1.lastName }];
  assert.equal(simulatePatientSelection(options, '5'), null, 'Aralık dışı numara null döndürmeli');
  assert.equal(simulatePatientSelection(options, '0'), null, 'Sıfır null döndürmeli');
});

test('İsim ile hasta seçimi çalışır', () => {
  resetStore();
  const phone = '05321234567';
  const p1 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Mehmet', lastName: 'Yılmaz', phone, email: null });
  const p2 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Zeynep', lastName: 'Yılmaz', phone, email: null });
  const options: PendingPatientOption[] = [
    { id: p1.id, firstName: p1.firstName, lastName: p1.lastName },
    { id: p2.id, firstName: p2.firstName, lastName: p2.lastName },
  ];
  const selected = simulatePatientSelection(options, 'Zeynep');
  assert.ok(selected);
  assert.equal(selected!.id, p2.id, 'Zeynep ismiyle doğru hasta seçilmeli');
});

test('Seçim sonrası customerName ile hasta doğru çözümlenir', () => {
  resetStore();
  const phone = '05321234567';
  const p1 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Mehmet', lastName: 'Yılmaz', phone, email: null });
  createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Zeynep', lastName: 'Yılmaz', phone, email: null });
  const matchingPatients = findPatientsByPhone('clinic-1', phone);
  // Kullanıcı "Mehmet Yılmaz" seçti, customerName buna set edildi
  const resolved = resolvePatientFromState(matchingPatients, 'Mehmet Yılmaz');
  assert.ok(resolved, 'Hasta çözümlenmeli');
  assert.equal(resolved!.id, p1.id, 'Doğru hasta döndürülmeli');
});

test('Sonraki mesajda customerName ile hasta yeniden çözümlenir (clearBookingState sonrası)', () => {
  resetStore();
  const phone = '05321234567';
  const p1 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Mehmet', lastName: 'Yılmaz', phone, email: null });
  createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Zeynep', lastName: 'Yılmaz', phone, email: null });
  const matching = findPatientsByPhone('clinic-1', phone);
  // Booking state temizlendi ama customerName 'Mehmet Yılmaz' olarak kaldı
  const resolved = resolvePatientFromState(matching, 'Mehmet Yılmaz');
  assert.equal(resolved?.id, p1.id, 'Booking state temizlense bile customerName yeterli');
});

test('Paylaşımlı telefonla ensureWhatsAppContactPatient isim eşleşmesinde doğru hasta döner', () => {
  resetStore();
  const phone = '05321234567';
  const p1 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Mehmet', lastName: 'Yılmaz', phone, email: null });
  createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Zeynep', lastName: 'Yılmaz', phone, email: null });
  const allMatches = findPatientsByPhone('clinic-1', phone);
  assert.equal(allMatches.length, 2, 'İki hasta bulunmalı');
  // Simulate ensureWhatsAppContactPatient name-match logic
  const providedFirstName = 'Mehmet'.toLocaleLowerCase('tr-TR');
  const providedLastName = 'Yılmaz'.toLocaleLowerCase('tr-TR');
  const nameMatch = allMatches.find(
    p => p.firstName.toLocaleLowerCase('tr-TR') === providedFirstName && p.lastName.toLocaleLowerCase('tr-TR') === providedLastName,
  );
  assert.ok(nameMatch, 'İsim eşleşmesi bulunmalı');
  assert.equal(nameMatch!.id, p1.id, 'Mehmet Yılmaz doğru seçilmeli');
});

test('Klinik izolasyonu: farklı klinikteki paylaşımlı telefon seçim listesine dahil edilmez', () => {
  resetStore();
  const phone = '05321234567';
  createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'C1Hasta1', lastName: 'X', phone, email: null });
  createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'C1Hasta2', lastName: 'X', phone, email: null });
  createPatient({ clinicId: 'clinic-2', organizationId: 'org-1', firstName: 'C2Hasta', lastName: 'X', phone, email: null });
  const c1Options = findPatientsByPhone('clinic-1', phone).map(p => ({ id: p.id, firstName: p.firstName, lastName: p.lastName }));
  assert.equal(c1Options.length, 2, 'Klinik-1 seçim listesi 2 hasta içermeli');
  assert.ok(!c1Options.some(p => p.firstName === 'C2Hasta'), 'Klinik-2 hastası klinik-1 listesinde olmamalı');
});

// ── Üretim şekilli telefon format eşleştirmesi ────────────────────────────────

console.log('\n=== Üretim Şekilli Telefon Formatı (findPatientsByPhone) ===');

test('Biçimli saklanan telefon (+90 532 111 11 11) gelen WA numarasıyla (905321111111) eşleşir', () => {
  resetStore();
  // Stored in DB with formatting (common for UI-entered phones)
  const p1 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Ahmet', lastName: 'Demir', phone: '+90 532 111 11 11', email: null });
  const p2 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Ayşe', lastName: 'Demir', phone: '+90 532 111 11 11', email: null });
  // WhatsApp sender arrives as digit-only (production format from Meta/Evolution)
  const matches = findPatientsByPhone('clinic-1', '905321111111');
  assert.equal(matches.length, 2, 'İki paylaşımlı hasta biçimsiz numara ile de bulunmalı');
  const ids = matches.map(p => p.id);
  assert.ok(ids.includes(p1.id), 'Ahmet Demir eşleşmeli');
  assert.ok(ids.includes(p2.id), 'Ayşe Demir eşleşmeli');
});

test('findExistingPatientByPhone: biçimli saklanan tek hasta dijital formatla bulunur', () => {
  resetStore();
  const p = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Tek', lastName: 'Hasta', phone: '+90 532 111 11 11', email: null });
  const result = findExistingPatientByPhone('clinic-1', '905321111111');
  assert.ok(result, 'Biçimli saklanan tek hasta bulunmalı');
  assert.equal(result!.id, p.id);
});

test('05 formatlı saklanan telefon 90 ile gelen numara ile eşleşir', () => {
  resetStore();
  const p1 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'A', lastName: 'B', phone: '05321111111', email: null });
  const p2 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'C', lastName: 'D', phone: '05321111111', email: null });
  const matches = findPatientsByPhone('clinic-1', '905321111111');
  assert.equal(matches.length, 2, '05 formatında saklanan iki paylaşımlı hasta 90 ile gelen sayıda eşleşmeli');
  assert.ok(matches.some(p => p.id === p1.id));
  assert.ok(matches.some(p => p.id === p2.id));
});

// ── Onay adımı paylaşımlı telefon koruyucusu ─────────────────────────────────

console.log('\n=== Onay Adımı Paylaşımlı Telefon Koruyucusu ===');

// Mirrors the confirmation guard logic in whatsapp.ts and metaWhatsAppAiProcessor.ts
function simulateConfirmationGuard(
  matchingPatients: Patient[],
  selectedPatientId: string | null,
  customerName: string | null,
): { branch: 'proceed_selected_patient' | 'proceed_name_match' | 'ask_selection'; patientId?: string } {
  if (matchingPatients.length <= 1) {
    const single = matchingPatients[0] ?? null;
    return { branch: 'proceed_selected_patient', patientId: single?.id };
  }
  const confirmedId = selectedPatientId ?? null;
  const idValid = !!confirmedId && matchingPatients.some(p => p.id === confirmedId);
  if (idValid) {
    return { branch: 'proceed_selected_patient', patientId: confirmedId };
  }
  const storedName = customerName?.toLocaleLowerCase('tr-TR').trim() ?? '';
  const nameMatch = storedName
    ? matchingPatients.find(p =>
        `${p.firstName} ${p.lastName}`.toLocaleLowerCase('tr-TR') === storedName)
    : null;
  if (nameMatch) {
    return { branch: 'proceed_name_match', patientId: nameMatch.id };
  }
  return { branch: 'ask_selection' };
}

test('Onay adımı: selectedPatientId yok, isim eşleşmesi yok → hasta seçimi istenir', () => {
  resetStore();
  const phone = '05321111111';
  createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Mehmet', lastName: 'Yılmaz', phone, email: null });
  createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Zeynep', lastName: 'Yılmaz', phone, email: null });
  const matching = findPatientsByPhone('clinic-1', phone);
  // No selectedPatientId, no customerName → guard must ask for selection
  const result = simulateConfirmationGuard(matching, null, null);
  assert.equal(result.branch, 'ask_selection', 'Belirlenemeyen durumda hasta seçimi istenmeli (randevu oluşturulmamalı)');
  assert.equal(result.patientId, undefined);
});

test('Onay adımı: selectedPatientId yok ama customerName tek hastayı tanımlar → isim eşleşmesiyle devam edilir', () => {
  resetStore();
  const phone = '05321111111';
  const p1 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Mehmet', lastName: 'Yılmaz', phone, email: null });
  createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Zeynep', lastName: 'Yılmaz', phone, email: null });
  const matching = findPatientsByPhone('clinic-1', phone);
  // selectedPatientId missing (stale pre-hotfix state) but customerName is unambiguous
  const result = simulateConfirmationGuard(matching, null, 'Mehmet Yılmaz');
  assert.equal(result.branch, 'proceed_name_match', 'Açık isim eşleşmesinde devam edilmeli');
  assert.equal(result.patientId, p1.id, 'Doğru hasta seçilmeli');
});

test('Onay adımı: geçerli selectedPatientId → doğrudan devam edilir', () => {
  resetStore();
  const phone = '05321111111';
  const p1 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Mehmet', lastName: 'Yılmaz', phone, email: null });
  createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Zeynep', lastName: 'Yılmaz', phone, email: null });
  const matching = findPatientsByPhone('clinic-1', phone);
  // selectedPatientId from prior explicit patient selection step
  const result = simulateConfirmationGuard(matching, p1.id, null);
  assert.equal(result.branch, 'proceed_selected_patient', 'selectedPatientId ile doğrudan devam edilmeli');
  assert.equal(result.patientId, p1.id, 'Seçilen hasta ID\'si kullanılmalı');
});

test('Onay adımı: selectedPatientId var ama farklı kliniğin hastasına ait → geçersiz, seçim istenir', () => {
  resetStore();
  const phone = '05321111111';
  createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Mehmet', lastName: 'Yılmaz', phone, email: null });
  createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Zeynep', lastName: 'Yılmaz', phone, email: null });
  const otherClinicPatient = createPatient({ clinicId: 'clinic-2', organizationId: 'org-1', firstName: 'Ali', lastName: 'Kaya', phone, email: null });
  const matching = findPatientsByPhone('clinic-1', phone);
  // selectedPatientId belongs to clinic-2's patient — not in matching list
  const result = simulateConfirmationGuard(matching, otherClinicPatient.id, null);
  assert.equal(result.branch, 'ask_selection', 'Yanlış kliniğin ID\'si geçersiz sayılmalı, seçim istenmeli');
});

test('Onay adımı: tek hasta eşleşmesinde koruyucu devreye girmez', () => {
  resetStore();
  const phone = '05321111111';
  const p1 = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Tek', lastName: 'Hasta', phone, email: null });
  const matching = findPatientsByPhone('clinic-1', phone);
  assert.equal(matching.length, 1, 'Tek eşleşme olmalı');
  const result = simulateConfirmationGuard(matching, null, null);
  assert.equal(result.branch, 'proceed_selected_patient', 'Tek hastada koruyucu devreye girmemeli');
  assert.equal(result.patientId, p1.id);
});

// ── E-posta boş string normalleştirmesi ──────────────────────────────────────

console.log('\n=== E-posta Boş String Normalleştirmesi ===');

// Simulates the schema preprocess: z.preprocess(v => v === '' ? null : v, z.string().email()...)
function preprocessEmail(value: unknown): unknown {
  return value === '' ? null : value;
}

test('Boş e-posta string "" null\'a dönüştürülür (validasyon hatası vermez)', () => {
  assert.equal(preprocessEmail(''), null, '"" null olmalı');
});

test('Geçerli e-posta değişmeden geçer', () => {
  assert.equal(preprocessEmail('test@example.com'), 'test@example.com');
});

test('null e-posta değişmeden geçer', () => {
  assert.equal(preprocessEmail(null), null);
});

test('undefined e-posta değişmeden geçer', () => {
  assert.equal(preprocessEmail(undefined), undefined);
});

test('E-postasız hasta oluşturulabilir (null e-posta kabul edilir)', () => {
  resetStore();
  const p = createPatient({ clinicId: 'clinic-1', organizationId: 'org-1', firstName: 'Ali', lastName: 'Veli', phone: '05321111111', email: null });
  assert.equal(p.email, null, 'null e-posta kabul edilmeli');
  assert.ok(p.id, 'Hasta oluşturulmalı');
});

// ─── Sonuç ───────────────────────────────────────────────────────────────────

console.log(`\nSonuç: ${passed} geçti, ${failed} başarısız\n`);
if (failed > 0) process.exit(1);
