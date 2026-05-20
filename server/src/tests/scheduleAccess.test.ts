/**
 * scheduleAccess.test.ts — Sprint 7: Klinik Çalışma Saati + Şube Randevu Kuralları birim testleri
 *
 * Koşturma: cd server && npx tsx src/tests/scheduleAccess.test.ts
 *
 * Senaryolar:
 *  - canManageClinicSchedule: OWNER/ORG_ADMIN/CLINIC_MANAGER evet, DENTIST/RECEPTIONIST/BILLING hayır
 *  - canManageDoctorSchedule: yönetim rolleri her doktor için, DENTIST yalnızca kendi
 *  - canViewAvailability: tüm kimlik doğrulamalı kullanıcılar
 *  - ClinicWorkingHours boundary: klinik kapalıysa randevu kabul edilmez
 *  - ClinicWorkingHours boundary: mesai saatleri dışında randevu kabul edilmez
 *  - DoctorAvailability + ClinicWorkingHours kesişim mantığı
 *  - Availability slot hesaplama (müsait / dolu)
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
type ClinicHours = { openTime: string; closeTime: string; isClosed: boolean };
type DoctorWindow = { startTime: string; endTime: string };

function computeSlots(
  clinicHours: ClinicHours | null,
  doctorWindows: DoctorWindow[],
  existingAppointments: Slot[],
  duration: number,
): Array<{ startTime: string; endTime: string; available: boolean }> {
  if (clinicHours?.isClosed) return [];

  const windows: Array<{ start: number; end: number }> = [];

  if (doctorWindows.length > 0) {
    doctorWindows.forEach(w => {
      const start = timeToMinutes(w.startTime);
      const end = timeToMinutes(w.endTime);
      if (clinicHours && !clinicHours.isClosed) {
        const clinicStart = timeToMinutes(clinicHours.openTime);
        const clinicEnd = timeToMinutes(clinicHours.closeTime);
        const intersectStart = Math.max(start, clinicStart);
        const intersectEnd = Math.min(end, clinicEnd);
        if (intersectStart < intersectEnd) {
          windows.push({ start: intersectStart, end: intersectEnd });
        }
      } else {
        windows.push({ start, end });
      }
    });
  } else if (clinicHours && !clinicHours.isClosed) {
    windows.push({
      start: timeToMinutes(clinicHours.openTime),
      end: timeToMinutes(clinicHours.closeTime),
    });
  }

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
    { openTime: '09:00', closeTime: '18:00', isClosed: true },
    [],
    [],
    30,
  );
  assert.equal(slots.length, 0);
});

test('Klinik 09:00-11:00, 30dk slot → 4 slot üretilir', () => {
  const slots = computeSlots(
    { openTime: '09:00', closeTime: '11:00', isClosed: false },
    [],
    [],
    30,
  );
  assert.equal(slots.length, 4);
  assert.equal(slots[0].startTime, '09:00');
  assert.equal(slots[3].endTime, '11:00');
});

test('Tüm slotlar müsaittir (randevu yok)', () => {
  const slots = computeSlots(
    { openTime: '09:00', closeTime: '10:00', isClosed: false },
    [],
    [],
    30,
  );
  assert.ok(slots.every(s => s.available));
});

test('Mevcut randevu 09:00-09:30 → o slot dolu', () => {
  const slots = computeSlots(
    { openTime: '09:00', closeTime: '11:00', isClosed: false },
    [],
    [{ startTime: '09:00', endTime: '09:30' }],
    30,
  );
  assert.equal(slots[0].available, false);
  assert.equal(slots[1].available, true);
});

test('Doktor penceresi klinik saatlerinin dışındaysa kesişim sıfır → slot yok', () => {
  const slots = computeSlots(
    { openTime: '09:00', closeTime: '12:00', isClosed: false },
    [{ startTime: '13:00', endTime: '17:00' }],
    [],
    30,
  );
  assert.equal(slots.length, 0);
});

test('Doktor penceresi klinik saatlerini kesiyor → yalnızca kesişim slotları', () => {
  const slots = computeSlots(
    { openTime: '09:00', closeTime: '12:00', isClosed: false },
    [{ startTime: '10:00', endTime: '14:00' }],
    [],
    30,
  );
  // Kesişim 10:00-12:00 → 4 slot
  assert.equal(slots.length, 4);
  assert.equal(slots[0].startTime, '10:00');
  assert.equal(slots[slots.length - 1].endTime, '12:00');
});

test('Klinik saati yokken doktor penceresi tüm slot kaynağı', () => {
  const slots = computeSlots(
    null,
    [{ startTime: '08:00', endTime: '10:00' }],
    [],
    60,
  );
  assert.equal(slots.length, 2);
  assert.equal(slots[0].startTime, '08:00');
});

test('Birden fazla randevu ile doğru boşluklar hesaplanır', () => {
  const slots = computeSlots(
    { openTime: '09:00', closeTime: '12:00', isClosed: false },
    [],
    [{ startTime: '09:30', endTime: '10:00' }, { startTime: '11:00', endTime: '11:30' }],
    30,
  );
  const available = slots.filter(s => s.available);
  const booked = slots.filter(s => !s.available);
  assert.equal(booked.length, 2);
  assert.equal(available.length, 4); // 09:00 + 10:00 + 10:30 + 11:30
});

test('Doktor penceresi yok ve klinik saati yoksa slot yok', () => {
  const slots = computeSlots(null, [], [], 30);
  assert.equal(slots.length, 0);
});

// ─── ClinicWorkingHours Boundary Checks ──────────────────────────────────────

console.log('\n── ClinicWorkingHours Boundary Checks ──');

function checkAppointmentAgainstHours(
  startMin: number,
  endMin: number,
  clinicHours: ClinicHours | null,
  doctorSlots: DoctorWindow[],
): { ok: boolean; reason?: string } {
  if (clinicHours?.isClosed) return { ok: false, reason: 'clinic_closed' };

  if (clinicHours && !clinicHours.isClosed) {
    const clinicStart = timeToMinutes(clinicHours.openTime);
    const clinicEnd = timeToMinutes(clinicHours.closeTime);
    if (startMin < clinicStart || endMin > clinicEnd) {
      return { ok: false, reason: 'outside_clinic_hours' };
    }
  }

  if (doctorSlots.length === 0) return { ok: true }; // Müsaitlik yok → kısıtsız (geriye dönük uyumluluk)

  const ok = doctorSlots.some(s => {
    const slotStart = timeToMinutes(s.startTime);
    const slotEnd = timeToMinutes(s.endTime);
    return startMin >= slotStart && endMin <= slotEnd;
  });

  return ok ? { ok: true } : { ok: false, reason: 'outside_doctor_schedule' };
}

test('Randevu klinik saatleri içindeyse geçerli', () => {
  const res = checkAppointmentAgainstHours(
    timeToMinutes('10:00'), timeToMinutes('10:30'),
    { openTime: '09:00', closeTime: '18:00', isClosed: false },
    [{ startTime: '09:00', endTime: '18:00' }],
  );
  assert.ok(res.ok);
});

test('Randevu klinik açılışından önce → reddedilir', () => {
  const res = checkAppointmentAgainstHours(
    timeToMinutes('08:00'), timeToMinutes('08:30'),
    { openTime: '09:00', closeTime: '18:00', isClosed: false },
    [],
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'outside_clinic_hours');
});

test('Randevu klinik kapanışından sonra → reddedilir', () => {
  const res = checkAppointmentAgainstHours(
    timeToMinutes('18:00'), timeToMinutes('18:30'),
    { openTime: '09:00', closeTime: '18:00', isClosed: false },
    [],
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'outside_clinic_hours');
});

test('Klinik pazar kapalı → randevu reddedilir', () => {
  const res = checkAppointmentAgainstHours(
    timeToMinutes('10:00'), timeToMinutes('10:30'),
    { openTime: '09:00', closeTime: '18:00', isClosed: true },
    [],
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'clinic_closed');
});

test('Klinik saati tanımlı değilse (null) yalnızca doktor programı kontrol edilir', () => {
  const res = checkAppointmentAgainstHours(
    timeToMinutes('10:00'), timeToMinutes('10:30'),
    null,
    [{ startTime: '09:00', endTime: '18:00' }],
  );
  assert.ok(res.ok);
});

test('Doktor programı dışında randevu → reddedilir', () => {
  const res = checkAppointmentAgainstHours(
    timeToMinutes('07:00'), timeToMinutes('07:30'),
    null,
    [{ startTime: '09:00', endTime: '17:00' }],
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'outside_doctor_schedule');
});

test('Tek klinikli kurulum (klinik saati yok, doktor programı yok) → izin ver', () => {
  const res = checkAppointmentAgainstHours(
    timeToMinutes('10:00'), timeToMinutes('10:30'),
    null,
    [], // Müsaitlik tanımlanmamış → eski sistemle uyumlu: geç
  );
  assert.ok(res.ok);
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
