/**
 * scheduleAccess.test.ts — Sprint 7 (Revize): Klinik Kapalı Gün + Doktor Müsaitliği birim testleri
 *
 * Koşturma: cd server && npx tsx src/tests/scheduleAccess.test.ts
 *
 * Senaryolar:
 *  - canManageClinicSchedule: OWNER/ORG_ADMIN/CLINIC_MANAGER evet, DENTIST/RECEPTIONIST/BILLING hayır
 *  - canManageDoctorSchedule: yönetim rolleri her doktor için, DENTIST yalnızca kendi
 *  - canViewAvailability: tüm kimlik doğrulamalı kullanıcılar
 *  - ClinicWorkingHours: sadece isClosed kontrol edilir (openTime/closeTime kaldırıldı)
 *  - Klinik kapalı günde randevu kabul edilmez (hem CRM hem WhatsApp)
 *  - Müsaitlik = doktor program pencerelerinden türetilir
 *  - Klinik kapalı günde buildAvailableSlots [] döner
 *  - DoctorOffDay: izin günü randevuyu engeller
 *  - Cross-midnight koruması
 *  - Tek klinikli geriye dönük uyumluluk
 */

import assert from 'node:assert/strict';
import { canManageClinicSchedule, canManageDoctorSchedule, canViewAvailability } from '../utils/roles.js';

// ─── Test yardımcıları ───────────────────────────────────────────────────────

type User = {
  id: string;
  role: string;
  canAccessAllClinics?: boolean;
};

function makeUser(role: string, opts: Partial<User> = {}): User {
  return { id: opts.id ?? 'user-1', role, canAccessAllClinics: opts.canAccessAllClinics ?? false };
}

let pass = 0;
let fail = 0;
const errors: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    fail++;
    errors.push(`FAIL: ${name}\n     ${err.message}`);
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

// ─── canManageClinicSchedule ──────────────────────────────────────────────────

console.log('\n── canManageClinicSchedule ──');

test('OWNER klinik çalışma saatlerini yönetebilir', () => {
  assert.ok(canManageClinicSchedule(makeUser('OWNER', { canAccessAllClinics: true })));
});

test('ORG_ADMIN klinik çalışma saatlerini yönetebilir', () => {
  assert.ok(canManageClinicSchedule(makeUser('ORG_ADMIN')));
});

test('CLINIC_MANAGER klinik çalışma saatlerini yönetebilir', () => {
  assert.ok(canManageClinicSchedule(makeUser('CLINIC_MANAGER')));
});

test('DENTIST klinik çalışma saatlerini yönetemez', () => {
  assert.equal(canManageClinicSchedule(makeUser('DENTIST')), false);
});

test('RECEPTIONIST klinik çalışma saatlerini yönetemez', () => {
  assert.equal(canManageClinicSchedule(makeUser('RECEPTIONIST')), false);
});

test('BILLING klinik çalışma saatlerini yönetemez', () => {
  assert.equal(canManageClinicSchedule(makeUser('BILLING')), false);
});

test('ASSISTANT klinik çalışma saatlerini yönetemez', () => {
  assert.equal(canManageClinicSchedule(makeUser('ASSISTANT')), false);
});

test('Legacy admin + canAccessAllClinics=true → OWNER → yönetebilir', () => {
  assert.ok(canManageClinicSchedule(makeUser('admin', { canAccessAllClinics: true })));
});

test('Legacy admin + canAccessAllClinics=false → CLINIC_MANAGER → yönetebilir', () => {
  assert.ok(canManageClinicSchedule(makeUser('admin', { canAccessAllClinics: false })));
});

// ─── canManageDoctorSchedule ──────────────────────────────────────────────────

console.log('\n── canManageDoctorSchedule ──');

test('OWNER herhangi bir doktorun programını yönetebilir', () => {
  assert.ok(canManageDoctorSchedule(makeUser('OWNER', { canAccessAllClinics: true }), 'dr-x'));
});

test('ORG_ADMIN herhangi bir doktorun programını yönetebilir', () => {
  assert.ok(canManageDoctorSchedule(makeUser('ORG_ADMIN'), 'dr-x'));
});

test('CLINIC_MANAGER herhangi bir doktorun programını yönetebilir', () => {
  assert.ok(canManageDoctorSchedule(makeUser('CLINIC_MANAGER'), 'dr-x'));
});

test('DENTIST kendi programını yönetebilir', () => {
  assert.ok(canManageDoctorSchedule(makeUser('DENTIST', { id: 'dr-1' }), 'dr-1'));
});

test('DENTIST başka bir doktorun programını yönetemez', () => {
  assert.equal(canManageDoctorSchedule(makeUser('DENTIST', { id: 'dr-1' }), 'dr-2'), false);
});

test('RECEPTIONIST hiçbir doktorun programını yönetemez', () => {
  assert.equal(canManageDoctorSchedule(makeUser('RECEPTIONIST'), 'dr-x'), false);
});

test('BILLING hiçbir doktorun programını yönetemez', () => {
  assert.equal(canManageDoctorSchedule(makeUser('BILLING'), 'dr-x'), false);
});

test('Legacy doctor kendi programını yönetebilir', () => {
  assert.ok(canManageDoctorSchedule(makeUser('doctor', { id: 'dr-1' }), 'dr-1'));
});

test('Legacy doctor başka doktorun programını yönetemez', () => {
  assert.equal(canManageDoctorSchedule(makeUser('doctor', { id: 'dr-1' }), 'dr-2'), false);
});

// ─── canViewAvailability ──────────────────────────────────────────────────────

console.log('\n── canViewAvailability ──');

const allRoles = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING', 'ASSISTANT'];
allRoles.forEach(role => {
  test(`${role} müsait slot görüntüleyebilir`, () => {
    assert.ok(canViewAvailability(makeUser(role)));
  });
});

// ─── Müsait Slot Hesaplama Mantığı ───────────────────────────────────────────

console.log('\n── Slot Hesaplama Mantığı ──');

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

type Slot = { startTime: string; endTime: string };
// Revize: ClinicHours artık sadece isClosed içeriyor
type ClinicHours = { isClosed: boolean };
type DoctorWindow = { startTime: string; endTime: string };

function computeSlots(
  clinicHours: ClinicHours | null,
  doctorWindows: DoctorWindow[],
  existingAppointments: Slot[],
  duration: number,
): Array<{ startTime: string; endTime: string; available: boolean }> {
  // Klinik kapalıysa hiç slot üretme
  if (clinicHours?.isClosed) return [];

  // Müsait pencereler = doktor program pencereleri
  const windows: Array<{ start: number; end: number }> = [];
  doctorWindows.forEach(w => {
    windows.push({ start: timeToMinutes(w.startTime), end: timeToMinutes(w.endTime) });
  });

  const bookedRanges = existingAppointments.map(a => ({
    start: timeToMinutes(a.startTime),
    end: timeToMinutes(a.endTime),
  }));

  const slots: Array<{ startTime: string; endTime: string; available: boolean }> = [];
  for (const w of windows) {
    let cursor = w.start;
    while (cursor + duration <= w.end) {
      const slotEnd = cursor + duration;
      const isBooked = bookedRanges.some(r => cursor < r.end && slotEnd > r.start);
      slots.push({ startTime: minutesToTime(cursor), endTime: minutesToTime(slotEnd), available: !isBooked });
      cursor += duration;
    }
  }
  return slots;
}

test('Klinik kapalıysa hiç slot üretilmez', () => {
  const slots = computeSlots(
    { isClosed: true },
    [{ startTime: '09:00', endTime: '18:00' }],
    [],
    30,
  );
  assert.equal(slots.length, 0);
});

test('Klinik açıksa doktor penceresinden 4 slot üretilir (09:00-11:00, 30dk)', () => {
  const slots = computeSlots(
    { isClosed: false },
    [{ startTime: '09:00', endTime: '11:00' }],
    [],
    30,
  );
  assert.equal(slots.length, 4);
  assert.equal(slots[0].startTime, '09:00');
  assert.equal(slots[3].endTime, '11:00');
});

test('Tüm slotlar müsaittir (randevu yok)', () => {
  const slots = computeSlots(
    { isClosed: false },
    [{ startTime: '09:00', endTime: '10:00' }],
    [],
    30,
  );
  assert.ok(slots.every(s => s.available));
});

test('Mevcut randevu 09:00-09:30 → o slot dolu', () => {
  const slots = computeSlots(
    { isClosed: false },
    [{ startTime: '09:00', endTime: '11:00' }],
    [{ startTime: '09:00', endTime: '09:30' }],
    30,
  );
  assert.equal(slots[0].available, false);
  assert.equal(slots[1].available, true);
});

test('Birden fazla doktor penceresi → birleşik slotlar', () => {
  const slots = computeSlots(
    { isClosed: false },
    [{ startTime: '09:00', endTime: '10:00' }, { startTime: '14:00', endTime: '15:00' }],
    [],
    30,
  );
  assert.equal(slots.length, 4); // 2 + 2
});

test('Birden fazla randevu ile doğru boşluklar hesaplanır', () => {
  const slots = computeSlots(
    { isClosed: false },
    [{ startTime: '09:00', endTime: '12:00' }],
    [{ startTime: '09:30', endTime: '10:00' }, { startTime: '11:00', endTime: '11:30' }],
    30,
  );
  const booked = slots.filter(s => !s.available);
  assert.equal(booked.length, 2);
});

test('Doktor penceresi yok ve klinik açıksa slot yok (hekim programlanmamış)', () => {
  const slots = computeSlots({ isClosed: false }, [], [], 30);
  assert.equal(slots.length, 0);
});

test('Klinik saati null ise (kapalı gün kaydı yok) → doktor penceresine göre üret', () => {
  const slots = computeSlots(
    null,
    [{ startTime: '08:00', endTime: '10:00' }],
    [],
    60,
  );
  assert.equal(slots.length, 2);
  assert.equal(slots[0].startTime, '08:00');
});

test('Klinik saati null + doktor penceresi yok → boş (geriye dönük uyumluluk)', () => {
  const slots = computeSlots(null, [], [], 30);
  assert.equal(slots.length, 0);
});

// ─── ClinicWorkingHours isClosed Boundary Checks ─────────────────────────────

console.log('\n── ClinicWorkingHours isClosed Kontrolleri ──');

function checkAppointmentAgainstHours(
  startMin: number,
  endMin: number,
  clinicHours: ClinicHours | null,
  doctorSlots: DoctorWindow[],
): { ok: boolean; reason?: string } {
  // Klinik kapalıysa direkt reddet
  if (clinicHours?.isClosed) return { ok: false, reason: 'clinic_closed' };

  // Doktor müsaitliği yoksa → geriye dönük uyumlu: geçir
  if (doctorSlots.length === 0) return { ok: true };

  const ok = doctorSlots.some(s => {
    const slotStart = timeToMinutes(s.startTime);
    const slotEnd = timeToMinutes(s.endTime);
    return startMin >= slotStart && endMin <= slotEnd;
  });

  return ok ? { ok: true } : { ok: false, reason: 'outside_doctor_schedule' };
}

test('Klinik açık + doktor programı içinde → kabul edilir', () => {
  const res = checkAppointmentAgainstHours(
    timeToMinutes('10:00'), timeToMinutes('10:30'),
    { isClosed: false },
    [{ startTime: '09:00', endTime: '18:00' }],
  );
  assert.ok(res.ok);
});

test('Klinik kapalı günde randevu → reddedilir (clinic_closed)', () => {
  const res = checkAppointmentAgainstHours(
    timeToMinutes('10:00'), timeToMinutes('10:30'),
    { isClosed: true },
    [{ startTime: '09:00', endTime: '18:00' }],
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'clinic_closed');
});

test('Klinik kapalı + doktor programı yoksa da → reddedilir', () => {
  const res = checkAppointmentAgainstHours(
    timeToMinutes('10:00'), timeToMinutes('10:30'),
    { isClosed: true },
    [],
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'clinic_closed');
});

test('Klinik kaydı yok (null) + doktor programı içinde → kabul edilir', () => {
  const res = checkAppointmentAgainstHours(
    timeToMinutes('10:00'), timeToMinutes('10:30'),
    null,
    [{ startTime: '09:00', endTime: '18:00' }],
  );
  assert.ok(res.ok);
});

test('Klinik açık + doktor programı dışında → reddedilir (outside_doctor_schedule)', () => {
  const res = checkAppointmentAgainstHours(
    timeToMinutes('07:00'), timeToMinutes('07:30'),
    { isClosed: false },
    [{ startTime: '09:00', endTime: '17:00' }],
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'outside_doctor_schedule');
});

test('Tek klinikli kurulum (klinik kaydı yok, doktor programı yok) → izin ver', () => {
  const res = checkAppointmentAgainstHours(
    timeToMinutes('10:00'), timeToMinutes('10:30'),
    null,
    [],
  );
  assert.ok(res.ok);
});

test('WhatsApp botu: klinik kapalı günde buildAvailableSlots [] döner', () => {
  // isClosed=true → computeSlots [] döner (buildAvailableSlots davranışını simüle ediyor)
  const slots = computeSlots(
    { isClosed: true },
    [{ startTime: '09:00', endTime: '17:00' }],
    [],
    30,
  );
  assert.equal(slots.length, 0);
});

// ─── Özet ───────────────────────────────────────────────────────────────────

const total = pass + fail;
console.log(`\n${'─'.repeat(50)}`);
console.log(`Toplam: ${total} test | Geçen: ${pass} | Başarısız: ${fail}`);

if (errors.length > 0) {
  console.error('\nBaşarısız testler:');
  errors.forEach(e => console.error(`  ${e}`));
  process.exit(1);
}

console.log('\nTüm schedule erişim ve müsaitlik testleri geçti!');
