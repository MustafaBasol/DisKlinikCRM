/**
 * noShow.test.ts — Sprint 18: No-show Tracking & Patient Recovery Unit Tests
 *
 * Tests cover:
 *  - canViewNoShowDashboard — rol bazlı erişim
 *  - canManageNoShows — rol bazlı yetki
 *  - canSendNoShowRecoveryMessage — rol bazlı yetki
 *  - canCreateNoShowFollowUpTask — rol bazlı yetki
 *  - No-show marking rules: cancelled/completed koruma, idempotence
 *  - Recovery status transitions: unresolved → contacted → recovered
 *  - Dashboard metrics: noShowRate, recoveryRate sıfır bölme koruması
 *  - estimatedLostRevenue: basePrice yoksa 0 döner
 *  - byClinic: yalnızca erişilebilir klinikler dahil edilir
 *  - Cross-org isolation: farklı org kliniği → erişim yok
 *  - CLINIC_MANAGER / RECEPTIONIST yalnızca atandığı klinikleri görür
 *  - DENTIST yalnızca kendi randevularını işaretleyebilir
 *  - BILLING no-show panosuna erişemez
 *
 * Run with: tsx src/tests/noShow.test.ts
 */

import assert from 'node:assert/strict';

import {
  canViewNoShowDashboard,
  canManageNoShows,
  canSendNoShowRecoveryMessage,
  canCreateNoShowFollowUpTask,
  normalizeRole,
} from '../utils/roles.js';

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

// ─── Fixtures ─────────────────────────────────────────────────────────────────

type UserLike = { role: string; canAccessAllClinics?: boolean; allowedClinicIds?: string[]; id?: string; organizationId?: string };

function makeUser(role: string, opts: Partial<UserLike> = {}): UserLike {
  return {
    role,
    canAccessAllClinics: false,
    allowedClinicIds: ['clinic-A'],
    id: 'user-1',
    organizationId: 'org-1',
    ...opts,
  };
}

// ─── 1. canViewNoShowDashboard ─────────────────────────────────────────────────

section('1. canViewNoShowDashboard — rol bazlı erişim');

await test('OWNER erişebilir', () => {
  assert.equal(canViewNoShowDashboard(makeUser('owner', { canAccessAllClinics: true })), true);
});

await test('ORG_ADMIN erişebilir', () => {
  assert.equal(canViewNoShowDashboard(makeUser('org_admin')), true);
});

await test('CLINIC_MANAGER erişebilir', () => {
  assert.equal(canViewNoShowDashboard(makeUser('clinic_manager')), true);
});

await test('RECEPTIONIST erişebilir', () => {
  assert.equal(canViewNoShowDashboard(makeUser('receptionist')), true);
});

await test('DENTIST erişebilir (salt okunur)', () => {
  assert.equal(canViewNoShowDashboard(makeUser('dentist')), true);
});

await test('BILLING erişemez', () => {
  assert.equal(canViewNoShowDashboard(makeUser('billing')), false);
});

await test('ASSISTANT erişemez', () => {
  assert.equal(canViewNoShowDashboard(makeUser('assistant')), false);
});

await test('null kullanıcı erişemez', () => {
  assert.equal(canViewNoShowDashboard(null), false);
});

await test('undefined kullanıcı erişemez', () => {
  assert.equal(canViewNoShowDashboard(undefined), false);
});

// ─── 2. canManageNoShows ───────────────────────────────────────────────────────

section('2. canManageNoShows — no-show işaretleme yetkisi');

await test('OWNER no-show işaretleyebilir', () => {
  assert.equal(canManageNoShows(makeUser('owner', { canAccessAllClinics: true })), true);
});

await test('ORG_ADMIN no-show işaretleyebilir', () => {
  assert.equal(canManageNoShows(makeUser('org_admin')), true);
});

await test('CLINIC_MANAGER no-show işaretleyebilir', () => {
  assert.equal(canManageNoShows(makeUser('clinic_manager')), true);
});

await test('RECEPTIONIST no-show işaretleyebilir', () => {
  assert.equal(canManageNoShows(makeUser('receptionist')), true);
});

await test('DENTIST kendi randevusunu no-show işaretleyebilir', () => {
  assert.equal(canManageNoShows(makeUser('dentist')), true);
});

await test('BILLING no-show işaretleyemez', () => {
  assert.equal(canManageNoShows(makeUser('billing')), false);
});

await test('ASSISTANT no-show işaretleyemez', () => {
  assert.equal(canManageNoShows(makeUser('assistant')), false);
});

// ─── 3. canSendNoShowRecoveryMessage ──────────────────────────────────────────

section('3. canSendNoShowRecoveryMessage — WhatsApp recovery mesajı gönderme');

await test('OWNER mesaj gönderebilir', () => {
  assert.equal(canSendNoShowRecoveryMessage(makeUser('owner', { canAccessAllClinics: true })), true);
});

await test('ORG_ADMIN mesaj gönderebilir', () => {
  assert.equal(canSendNoShowRecoveryMessage(makeUser('org_admin')), true);
});

await test('CLINIC_MANAGER mesaj gönderebilir', () => {
  assert.equal(canSendNoShowRecoveryMessage(makeUser('clinic_manager')), true);
});

await test('RECEPTIONIST mesaj gönderebilir', () => {
  assert.equal(canSendNoShowRecoveryMessage(makeUser('receptionist')), true);
});

await test('DENTIST mesaj gönderemez', () => {
  assert.equal(canSendNoShowRecoveryMessage(makeUser('dentist')), false);
});

await test('BILLING mesaj gönderemez', () => {
  assert.equal(canSendNoShowRecoveryMessage(makeUser('billing')), false);
});

await test('ASSISTANT mesaj gönderemez', () => {
  assert.equal(canSendNoShowRecoveryMessage(makeUser('assistant')), false);
});

// ─── 4. canCreateNoShowFollowUpTask ───────────────────────────────────────────

section('4. canCreateNoShowFollowUpTask — takip görevi oluşturma');

await test('OWNER görev oluşturabilir', () => {
  assert.equal(canCreateNoShowFollowUpTask(makeUser('owner', { canAccessAllClinics: true })), true);
});

await test('RECEPTIONIST görev oluşturabilir', () => {
  assert.equal(canCreateNoShowFollowUpTask(makeUser('receptionist')), true);
});

await test('DENTIST görev oluşturabilir', () => {
  assert.equal(canCreateNoShowFollowUpTask(makeUser('dentist')), true);
});

await test('BILLING görev oluşturamaz', () => {
  assert.equal(canCreateNoShowFollowUpTask(makeUser('billing')), false);
});

await test('ASSISTANT görev oluşturamaz', () => {
  assert.equal(canCreateNoShowFollowUpTask(makeUser('assistant')), false);
});

// ─── 5. No-show işaretleme kuralları (pure logic) ────────────────────────────

section('5. No-show işaretleme kuralları');

function canMarkNoShow(status: string): { allowed: boolean; reason?: string } {
  if (status === 'cancelled') return { allowed: false, reason: 'Cannot mark a cancelled appointment as no-show' };
  if (status === 'completed') return { allowed: false, reason: 'Cannot mark a completed appointment as no-show' };
  if (status === 'no_show') return { allowed: true, reason: 'idempotent' };
  return { allowed: true };
}

await test('scheduled randevu no-show yapılabilir', () => {
  const result = canMarkNoShow('scheduled');
  assert.equal(result.allowed, true);
});

await test('confirmed randevu no-show yapılabilir', () => {
  const result = canMarkNoShow('confirmed');
  assert.equal(result.allowed, true);
});

await test('cancelled randevu no-show yapılamaz', () => {
  const result = canMarkNoShow('cancelled');
  assert.equal(result.allowed, false);
  assert.ok(result.reason!.includes('cancelled'));
});

await test('completed randevu no-show yapılamaz', () => {
  const result = canMarkNoShow('completed');
  assert.equal(result.allowed, false);
  assert.ok(result.reason!.includes('completed'));
});

await test('zaten no_show olan randevu — idempotent sonuç', () => {
  const result = canMarkNoShow('no_show');
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'idempotent');
});

// ─── 6. Recovery status geçişleri ─────────────────────────────────────────────

section('6. Recovery status geçişleri');

const VALID_RECOVERY_STATUSES = ['unresolved', 'contacted', 'recovered'] as const;

function validateRecoveryStatus(status: string): boolean {
  return (VALID_RECOVERY_STATUSES as readonly string[]).includes(status);
}

function applyRecoveryStatus(
  appointment: { status: string; recoveryStatus?: string },
  newStatus: string,
  userId: string
): { success: boolean; error?: string; updatedFields?: Record<string, unknown> } {
  if (appointment.status !== 'no_show') {
    return { success: false, error: 'Recovery status can only be set for no-show appointments' };
  }
  if (!validateRecoveryStatus(newStatus)) {
    return { success: false, error: `Invalid recovery status: ${newStatus}` };
  }

  const fields: Record<string, unknown> = { recoveryStatus: newStatus };
  if (newStatus === 'recovered') {
    fields.recoveredAt = new Date();
    fields.recoveredById = userId;
  }
  return { success: true, updatedFields: fields };
}

await test('no_show randevu recovery durumu güncellenebilir', () => {
  const result = applyRecoveryStatus({ status: 'no_show' }, 'contacted', 'user-1');
  assert.equal(result.success, true);
});

await test('no_show olmayan randevuda recovery durumu güncellenemez', () => {
  const result = applyRecoveryStatus({ status: 'scheduled' }, 'contacted', 'user-1');
  assert.equal(result.success, false);
  assert.ok(result.error!.includes('no-show'));
});

await test('geçersiz recovery status 400 üretir', () => {
  const result = applyRecoveryStatus({ status: 'no_show' }, 'invalid_status', 'user-1');
  assert.equal(result.success, false);
  assert.ok(result.error!.includes('Invalid'));
});

await test('recovered status — recoveredAt ve recoveredById atanır', () => {
  const result = applyRecoveryStatus({ status: 'no_show' }, 'recovered', 'user-99');
  assert.equal(result.success, true);
  assert.ok(result.updatedFields!.recoveredAt instanceof Date);
  assert.equal(result.updatedFields!.recoveredById, 'user-99');
});

await test('unresolved geçerli recovery status', () => {
  assert.equal(validateRecoveryStatus('unresolved'), true);
});

await test('contacted geçerli recovery status', () => {
  assert.equal(validateRecoveryStatus('contacted'), true);
});

await test('recovered geçerli recovery status', () => {
  assert.equal(validateRecoveryStatus('recovered'), true);
});

await test('boş string geçersiz recovery status', () => {
  assert.equal(validateRecoveryStatus(''), false);
});

// ─── 7. Dashboard metrics — sıfır bölme koruması ─────────────────────────────

section('7. Dashboard metrics — sıfır bölme koruması');

function calcNoShowRate(noShowCount: number, totalAppointments: number): number {
  if (totalAppointments === 0) return 0;
  return Math.round((noShowCount / totalAppointments) * 100 * 10) / 10;
}

function calcRecoveryRate(recoveredCount: number, noShowCount: number): number {
  if (noShowCount === 0) return 0;
  return Math.round((recoveredCount / noShowCount) * 100 * 10) / 10;
}

function calcEstimatedRevenue(appointments: { basePrice?: number | null }[]): number {
  return appointments.reduce((sum, a) => sum + (a.basePrice ?? 0), 0);
}

await test('noShowRate: 0 randevu → 0 (sıfır bölme yok)', () => {
  assert.equal(calcNoShowRate(0, 0), 0);
});

await test('noShowRate: 5 no-show / 20 randevu → 25.0', () => {
  assert.equal(calcNoShowRate(5, 20), 25);
});

await test('noShowRate: 3 no-show / 7 randevu → 42.9', () => {
  assert.equal(calcNoShowRate(3, 7), 42.9);
});

await test('recoveryRate: 0 no-show → 0 (sıfır bölme yok)', () => {
  assert.equal(calcRecoveryRate(0, 0), 0);
});

await test('recoveryRate: 2 recovered / 5 no-show → 40.0', () => {
  assert.equal(calcRecoveryRate(2, 5), 40);
});

await test('estimatedLostRevenue: basePrice yoksa 0 kullanılır', () => {
  const appointments = [
    { basePrice: 150 },
    { basePrice: null },
    { basePrice: undefined },
    { basePrice: 200 },
  ];
  assert.equal(calcEstimatedRevenue(appointments), 350);
});

await test('estimatedLostRevenue: boş liste → 0', () => {
  assert.equal(calcEstimatedRevenue([]), 0);
});

await test('estimatedLostRevenue: tüm fiyatlar 0 → 0', () => {
  const appointments = [{ basePrice: 0 }, { basePrice: 0 }];
  assert.equal(calcEstimatedRevenue(appointments), 0);
});

// ─── 8. Klinik erişim kapsamı (pure logic) ───────────────────────────────────

section('8. Klinik erişim kapsamı');

function resolveClinicFilter(
  user: UserLike,
  requestedClinicId: string | undefined,
  allAccessibleIds: string[]
): string[] | null {
  if (allAccessibleIds.length === 0) return null;
  if (requestedClinicId && requestedClinicId !== 'all') {
    if (!allAccessibleIds.includes(requestedClinicId)) return null; // 403
    return [requestedClinicId];
  }
  return allAccessibleIds;
}

await test('OWNER tüm klinikleri görebilir', () => {
  const user = makeUser('owner', { canAccessAllClinics: true });
  const result = resolveClinicFilter(user, 'all', ['clinic-A', 'clinic-B', 'clinic-C']);
  assert.deepEqual(result, ['clinic-A', 'clinic-B', 'clinic-C']);
});

await test('CLINIC_MANAGER yalnızca atandığı klinikleri görür', () => {
  const user = makeUser('clinic_manager', { allowedClinicIds: ['clinic-A'] });
  const result = resolveClinicFilter(user, 'all', ['clinic-A']);
  assert.deepEqual(result, ['clinic-A']);
});

await test('CLINIC_MANAGER başka kliniğe erişemez — null döner', () => {
  const user = makeUser('clinic_manager', { allowedClinicIds: ['clinic-A'] });
  const result = resolveClinicFilter(user, 'clinic-B', ['clinic-A']);
  assert.equal(result, null);
});

await test('cross-org: erişilebilir id listesi boş → null döner', () => {
  const user = makeUser('receptionist', { allowedClinicIds: [] });
  const result = resolveClinicFilter(user, undefined, []);
  assert.equal(result, null);
});

await test('belirli clinicId atandığı listede ise döner', () => {
  const user = makeUser('receptionist', { allowedClinicIds: ['clinic-A'] });
  const result = resolveClinicFilter(user, 'clinic-A', ['clinic-A']);
  assert.deepEqual(result, ['clinic-A']);
});

// ─── 9. normalizeRole doğruluğu ───────────────────────────────────────────────

section('9. normalizeRole doğruluğu');

await test('admin + canAccessAllClinics=true → OWNER', () => {
  assert.equal(normalizeRole('admin', true), 'OWNER');
});

await test('admin + canAccessAllClinics=false → CLINIC_MANAGER', () => {
  assert.equal(normalizeRole('admin', false), 'CLINIC_MANAGER');
});

await test('dentist → DENTIST', () => {
  assert.equal(normalizeRole('dentist', false), 'DENTIST');
});

await test('doctor → DENTIST (legacy alias)', () => {
  assert.equal(normalizeRole('doctor', false), 'DENTIST');
});

await test('receptionist → RECEPTIONIST', () => {
  assert.equal(normalizeRole('receptionist', false), 'RECEPTIONIST');
});

await test('billing → BILLING', () => {
  assert.equal(normalizeRole('billing', false), 'BILLING');
});

await test('bilinmeyen rol → ASSISTANT (en kısıtlayıcı)', () => {
  assert.equal(normalizeRole('unknown_role', false), 'ASSISTANT');
});

// ─── 10. WhatsApp recovery mesajı gönderme — klinik bağlantısı kontrolü ──────

section('10. WhatsApp recovery mesajı — klinik bağlantısı kontrolü');

type ClinicConnection = { id: string; status: string; clinicId: string } | null;

function resolveClinicWhatsAppConnection(
  appointment: { clinicId: string },
  connections: ClinicConnection[]
): { connection: ClinicConnection; error?: string } {
  const conn = connections.find(c => c !== null && c.clinicId === appointment.clinicId && c.status === 'active') ?? null;
  if (!conn) {
    return { connection: null, error: 'No active WhatsApp connection found for this clinic' };
  }
  return { connection: conn };
}

await test('klinik için aktif bağlantı varsa çözümlenir', () => {
  const result = resolveClinicWhatsAppConnection(
    { clinicId: 'clinic-A' },
    [{ id: 'conn-1', status: 'active', clinicId: 'clinic-A' }]
  );
  assert.ok(result.connection);
  assert.equal(result.error, undefined);
});

await test('klinik için bağlantı yoksa hata döner', () => {
  const result = resolveClinicWhatsAppConnection(
    { clinicId: 'clinic-B' },
    [{ id: 'conn-1', status: 'active', clinicId: 'clinic-A' }]
  );
  assert.equal(result.connection, null);
  assert.ok(result.error!.includes('No active WhatsApp connection'));
});

await test('bağlantı inactive durumda — hata döner', () => {
  const result = resolveClinicWhatsAppConnection(
    { clinicId: 'clinic-A' },
    [{ id: 'conn-1', status: 'inactive', clinicId: 'clinic-A' }]
  );
  assert.equal(result.connection, null);
  assert.ok(result.error!.includes('No active WhatsApp connection'));
});

await test('bağlantı listesi boş — hata döner', () => {
  const result = resolveClinicWhatsAppConnection({ clinicId: 'clinic-A' }, []);
  assert.equal(result.connection, null);
  assert.ok(result.error);
});

// ─── 11. Recovery mesajı — telefon numarası kontrolü ─────────────────────────

section('11. Recovery mesajı — hasta telefon numarası kontrolü');

function resolvePatientPhone(patient: { phone?: string | null }): { phone: string | null; error?: string } {
  if (!patient.phone || patient.phone.trim() === '') {
    return { phone: null, error: 'Patient has no phone number on file' };
  }
  return { phone: patient.phone.trim() };
}

await test('telefon numarası varsa döner', () => {
  const result = resolvePatientPhone({ phone: '+905551234567' });
  assert.equal(result.phone, '+905551234567');
});

await test('telefon numarası boşsa hata döner', () => {
  const result = resolvePatientPhone({ phone: '' });
  assert.equal(result.phone, null);
  assert.ok(result.error);
});

await test('telefon numarası null ise hata döner', () => {
  const result = resolvePatientPhone({ phone: null });
  assert.equal(result.phone, null);
  assert.ok(result.error);
});

await test('boşluklu telefon trim edilir', () => {
  const result = resolvePatientPhone({ phone: '  +905551234567  ' });
  assert.equal(result.phone, '+905551234567');
});

// ─── 12. Görev oluşturma — başlık ve vade tarihi ─────────────────────────────

section('12. Görev oluşturma — başlık ve vade tarihi');

function buildFollowUpTaskTitle(patientFirstName: string, patientLastName: string): string {
  return `No-show follow-up: ${patientFirstName} ${patientLastName}`;
}

function buildFollowUpDueDate(offset: 'today' | 'tomorrow' = 'tomorrow'): Date {
  const d = new Date();
  if (offset === 'tomorrow') d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

await test('görev başlığı doğru formatta oluşturulur', () => {
  const title = buildFollowUpTaskTitle('Ayşe', 'Yılmaz');
  assert.equal(title, 'No-show follow-up: Ayşe Yılmaz');
});

await test('vade tarihi today — bugün 09:00', () => {
  const d = buildFollowUpDueDate('today');
  const now = new Date();
  assert.equal(d.getDate(), now.getDate());
  assert.equal(d.getHours(), 9);
});

await test('vade tarihi tomorrow — yarın 09:00', () => {
  const d = buildFollowUpDueDate('tomorrow');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  assert.equal(d.getDate(), tomorrow.getDate());
  assert.equal(d.getHours(), 9);
});

// ─── 13. Tarih aralığı filtresi ───────────────────────────────────────────────

section('13. Tarih aralığı filtresi');

function buildDateFilter(range?: string, from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
  const now = new Date();

  if (range === 'today') {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    return { gte: start, lte: end };
  }
  if (range === 'this_week') {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    return { gte: start };
  }
  if (range === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { gte: start };
  }
  if (range === 'last_30_days') {
    const start = new Date(now);
    start.setDate(now.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    return { gte: start };
  }
  if (range === 'custom' && from) {
    const filter: { gte?: Date; lte?: Date } = { gte: new Date(from) };
    if (to) filter.lte = new Date(to);
    return filter;
  }
  return undefined;
}

await test("range='today' — gte ve lte aynı gün", () => {
  const filter = buildDateFilter('today');
  assert.ok(filter?.gte);
  assert.ok(filter?.lte);
  assert.equal(filter!.gte!.getDate(), filter!.lte!.getDate());
});

await test("range='last_30_days' — gte 30 gün önce", () => {
  const filter = buildDateFilter('last_30_days');
  assert.ok(filter?.gte);
  const diffDays = Math.round((Date.now() - filter!.gte!.getTime()) / (1000 * 60 * 60 * 24));
  assert.ok(diffDays >= 29 && diffDays <= 31, `Expected ~30 days, got ${diffDays}`);
});

await test("range=undefined — undefined döner", () => {
  const filter = buildDateFilter(undefined);
  assert.equal(filter, undefined);
});

await test("range='custom' with from and to — doğru filter oluşur", () => {
  const filter = buildDateFilter('custom', '2026-01-01', '2026-01-31');
  assert.ok(filter?.gte instanceof Date);
  assert.ok(filter?.lte instanceof Date);
  assert.equal(filter!.gte!.getFullYear(), 2026);
});

await test("range='custom' without from — undefined döner", () => {
  const filter = buildDateFilter('custom', undefined, '2026-01-31');
  assert.equal(filter, undefined);
});

// ─── 14. Dashboard recentNoShows — practitionerId ve appointmentTypeId ────────

section('14. Dashboard recentNoShows — practitionerId ve appointmentTypeId alanları');

// Simulate the recentNoShows mapper used in noShows.ts
function mapRecentNoShow(a: {
  id: string;
  patientId: string;
  patient: { firstName: string; lastName: string };
  clinicId: string;
  clinic: { name: string };
  practitionerId: string | null;
  practitioner: { firstName: string; lastName: string };
  appointmentTypeId: string | null;
  appointmentType?: { name: string; basePrice?: number; currency?: string } | null;
  startTime: Date;
  recoveryStatus?: string;
  sentMessages: { createdAt: Date }[];
}) {
  return {
    appointmentId: a.id,
    patientId: a.patientId,
    patientName: `${a.patient.firstName} ${a.patient.lastName}`,
    clinicId: a.clinicId,
    clinicName: a.clinic.name,
    practitionerId: a.practitionerId ?? null,
    doctorName: `${a.practitioner.firstName} ${a.practitioner.lastName}`,
    appointmentTypeId: a.appointmentTypeId ?? null,
    date: a.startTime.toISOString().split('T')[0],
    time: a.startTime.toISOString().split('T')[1]?.substring(0, 5),
    serviceName: a.appointmentType?.name ?? null,
    estimatedValue: a.appointmentType?.basePrice ?? 0,
    currency: a.appointmentType?.currency ?? null,
    recoveryStatus: a.recoveryStatus ?? 'unresolved',
    lastContactAt: a.sentMessages[0]?.createdAt ?? null,
  };
}

const baseAppointment = {
  id: 'appt-1',
  patientId: 'pat-1',
  patient: { firstName: 'Ayşe', lastName: 'Yılmaz' },
  clinicId: 'clinic-A',
  clinic: { name: 'Merkez Klinik' },
  practitionerId: 'doctor-99',
  practitioner: { firstName: 'Dr.', lastName: 'Kaya' },
  appointmentTypeId: 'type-5',
  appointmentType: { name: 'Kanal Tedavisi', basePrice: 500, currency: 'TRY' },
  startTime: new Date('2026-05-22T10:00:00Z'),
  recoveryStatus: 'unresolved',
  sentMessages: [],
};

await test('recentNoShows item — practitionerId alanı mevcut', () => {
  const item = mapRecentNoShow(baseAppointment);
  assert.equal(item.practitionerId, 'doctor-99');
});

await test('recentNoShows item — appointmentTypeId alanı mevcut', () => {
  const item = mapRecentNoShow(baseAppointment);
  assert.equal(item.appointmentTypeId, 'type-5');
});

await test('recentNoShows item — practitionerId null ise null döner', () => {
  const item = mapRecentNoShow({ ...baseAppointment, practitionerId: null });
  assert.equal(item.practitionerId, null);
});

await test('recentNoShows item — appointmentTypeId null ise null döner', () => {
  const item = mapRecentNoShow({ ...baseAppointment, appointmentTypeId: null, appointmentType: null });
  assert.equal(item.appointmentTypeId, null);
});

await test('recentNoShows item — doctorName her zaman string', () => {
  const item = mapRecentNoShow(baseAppointment);
  assert.equal(typeof item.doctorName, 'string');
  assert.ok(item.doctorName.length > 0);
});

await test('recentNoShows item — appointmentType yoksa estimatedValue 0', () => {
  const item = mapRecentNoShow({ ...baseAppointment, appointmentTypeId: null, appointmentType: null });
  assert.equal(item.estimatedValue, 0);
});

// ─── 15. Reschedule URL — practitionerId ve appointmentTypeId dahil edilir ────

section('15. Reschedule URL oluşturma');

function buildRescheduleUrl(row: {
  patientId: string;
  clinicId: string;
  appointmentId: string;
  practitionerId?: string | null;
  appointmentTypeId?: string | null;
}): string | null {
  if (!row.patientId || !row.clinicId) return null;
  const params = new URLSearchParams({
    source: 'no_show',
    patientId: row.patientId,
    clinicId: row.clinicId,
    previousAppointmentId: row.appointmentId,
  });
  if (row.practitionerId) params.set('doctorId', row.practitionerId);
  if (row.appointmentTypeId) params.set('appointmentTypeId', row.appointmentTypeId);
  return `/appointments?${params.toString()}`;
}

await test('practitionerId mevcut — doctorId URL\'de yer alır', () => {
  const url = buildRescheduleUrl({
    patientId: 'pat-1', clinicId: 'clinic-A', appointmentId: 'appt-1',
    practitionerId: 'doctor-99', appointmentTypeId: 'type-5',
  });
  assert.ok(url!.includes('doctorId=doctor-99'), `URL: ${url}`);
});

await test('appointmentTypeId mevcut — appointmentTypeId URL\'de yer alır', () => {
  const url = buildRescheduleUrl({
    patientId: 'pat-1', clinicId: 'clinic-A', appointmentId: 'appt-1',
    practitionerId: 'doctor-99', appointmentTypeId: 'type-5',
  });
  assert.ok(url!.includes('appointmentTypeId=type-5'), `URL: ${url}`);
});

await test('practitionerId null — doctorId URL\'de yer almaz', () => {
  const url = buildRescheduleUrl({
    patientId: 'pat-1', clinicId: 'clinic-A', appointmentId: 'appt-1',
    practitionerId: null,
  });
  assert.ok(!url!.includes('doctorId'), `URL should not have doctorId: ${url}`);
});

await test('appointmentTypeId null — appointmentTypeId URL\'de yer almaz', () => {
  const url = buildRescheduleUrl({
    patientId: 'pat-1', clinicId: 'clinic-A', appointmentId: 'appt-1',
    appointmentTypeId: null,
  });
  assert.ok(!url!.includes('appointmentTypeId'), `URL should not have appointmentTypeId: ${url}`);
});

await test('patientId yoksa null döner', () => {
  const url = buildRescheduleUrl({
    patientId: '', clinicId: 'clinic-A', appointmentId: 'appt-1',
  });
  assert.equal(url, null);
});

await test('clinicId yoksa null döner', () => {
  const url = buildRescheduleUrl({
    patientId: 'pat-1', clinicId: '', appointmentId: 'appt-1',
  });
  assert.equal(url, null);
});

await test('source=no_show her zaman URL\'de yer alır', () => {
  const url = buildRescheduleUrl({
    patientId: 'pat-1', clinicId: 'clinic-A', appointmentId: 'appt-1',
  });
  assert.ok(url!.includes('source=no_show'), `URL: ${url}`);
});

await test('previousAppointmentId her zaman URL\'de yer alır', () => {
  const url = buildRescheduleUrl({
    patientId: 'pat-1', clinicId: 'clinic-A', appointmentId: 'appt-99',
  });
  assert.ok(url!.includes('previousAppointmentId=appt-99'), `URL: ${url}`);
});

// ─── 16. Doctor prefill doğrulama (safe ignore) ───────────────────────────────

section('16. Doctor prefill doğrulama — geçersiz doctorId güvenle yok sayılır');

function validateDoctorPrefill(
  prefillPractitionerId: string | undefined,
  loadedDoctors: { id: string; firstName: string; lastName: string }[]
): { practitionerId: string; valid: boolean } {
  if (!prefillPractitionerId) return { practitionerId: '', valid: true };
  const found = loadedDoctors.some(d => d.id === prefillPractitionerId);
  if (!found) return { practitionerId: '', valid: false }; // silently clear
  return { practitionerId: prefillPractitionerId, valid: true };
}

const doctors = [
  { id: 'doctor-1', firstName: 'Dr.', lastName: 'Kaya' },
  { id: 'doctor-2', firstName: 'Dr.', lastName: 'Demir' },
];

await test('geçerli doctorId — preselected', () => {
  const result = validateDoctorPrefill('doctor-1', doctors);
  assert.equal(result.practitionerId, 'doctor-1');
  assert.equal(result.valid, true);
});

await test('geçersiz doctorId — temizlenir (valid=false)', () => {
  const result = validateDoctorPrefill('unknown-doctor', doctors);
  assert.equal(result.practitionerId, '');
  assert.equal(result.valid, false);
});

await test('doctorId undefined — empty string döner', () => {
  const result = validateDoctorPrefill(undefined, doctors);
  assert.equal(result.practitionerId, '');
  assert.equal(result.valid, true);
});

await test('boş doktor listesi — doctorId temizlenir', () => {
  const result = validateDoctorPrefill('doctor-1', []);
  assert.equal(result.practitionerId, '');
  assert.equal(result.valid, false);
});

// ─── 17. No-show recovery WhatsApp — Meta template selection logic ────────────

section('17. No-show recovery WhatsApp — template selection & variable mapping');

// Pure-logic helpers that mirror the Prisma WHERE clause used in sendNoShowRecoveryWhatsApp
type TemplateRecord = {
  id: string;
  clinicId: string;
  channel: string;
  purpose: string;
  isActive: boolean;
  metaTemplateStatus: string | null;
  metaTemplateName: string | null;
  createdAt: Date;
};

function selectNoShowRecoveryTemplate(
  clinicId: string,
  templates: TemplateRecord[],
): TemplateRecord | null {
  const candidates = templates.filter(
    (t) =>
      t.clinicId === clinicId &&
      t.channel === 'whatsapp' &&
      t.purpose === 'no_show_recovery' &&
      t.isActive === true,
  );
  // Deterministic: first by createdAt ASC
  candidates.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return candidates[0] ?? null;
}

function isApprovedForSend(template: TemplateRecord | null): boolean {
  return (
    template !== null &&
    template.metaTemplateStatus === 'approved' &&
    Boolean(template.metaTemplateName)
  );
}

const baseTemplate = (overrides: Partial<TemplateRecord> = {}): TemplateRecord => ({
  id: 'tpl-1',
  clinicId: 'clinic-A',
  channel: 'whatsapp',
  purpose: 'no_show_recovery',
  isActive: true,
  metaTemplateStatus: 'approved',
  metaTemplateName: 'gelmeyen_hasta_takibi',
  createdAt: new Date('2026-01-01T10:00:00Z'),
  ...overrides,
});

await test('selects active no_show_recovery whatsapp template for correct clinic', () => {
  const tpl = selectNoShowRecoveryTemplate('clinic-A', [baseTemplate()]);
  assert.ok(tpl !== null);
  assert.equal(tpl!.id, 'tpl-1');
});

await test('does not select template from different clinic', () => {
  const tpl = selectNoShowRecoveryTemplate('clinic-B', [baseTemplate()]);
  assert.equal(tpl, null);
});

await test('does not select inactive template', () => {
  const tpl = selectNoShowRecoveryTemplate('clinic-A', [baseTemplate({ isActive: false })]);
  assert.equal(tpl, null);
});

await test('does not select template with wrong purpose (appointment_reminder)', () => {
  const tpl = selectNoShowRecoveryTemplate('clinic-A', [
    baseTemplate({ purpose: 'appointment_reminder' }),
  ]);
  assert.equal(tpl, null);
});

await test('does not select template with wrong purpose (general_message)', () => {
  const tpl = selectNoShowRecoveryTemplate('clinic-A', [
    baseTemplate({ purpose: 'general_message' }),
  ]);
  assert.equal(tpl, null);
});

await test('does not select template with wrong channel (sms)', () => {
  const tpl = selectNoShowRecoveryTemplate('clinic-A', [
    baseTemplate({ channel: 'sms' }),
  ]);
  assert.equal(tpl, null);
});

await test('multiple active templates — selects first by createdAt ASC (deterministic)', () => {
  const older = baseTemplate({ id: 'tpl-older', createdAt: new Date('2026-01-01T08:00:00Z') });
  const newer = baseTemplate({ id: 'tpl-newer', createdAt: new Date('2026-01-01T12:00:00Z') });
  const tpl = selectNoShowRecoveryTemplate('clinic-A', [newer, older]);
  assert.equal(tpl!.id, 'tpl-older', 'should pick the oldest (createdAt ASC)');
});

await test('approved template with metaTemplateName → isApprovedForSend = true', () => {
  assert.equal(isApprovedForSend(baseTemplate()), true);
});

await test('submitted (not approved) template → isApprovedForSend = false', () => {
  assert.equal(isApprovedForSend(baseTemplate({ metaTemplateStatus: 'submitted' })), false);
});

await test('null template → isApprovedForSend = false', () => {
  assert.equal(isApprovedForSend(null), false);
});

await test('approved but no metaTemplateName → isApprovedForSend = false', () => {
  assert.equal(isApprovedForSend(baseTemplate({ metaTemplateName: null })), false);
});

// Variable mapping for no-show recovery
function buildNoShowVariables(opts: {
  patientFirstName: string;
  patientLastName: string;
  clinicName: string;
  appointmentDate: string;
  appointmentTime: string;
  practitionerFirstName?: string;
  practitionerLastName?: string;
  serviceName?: string;
}): Record<string, string> {
  const vars: Record<string, string> = {
    patient_name: `${opts.patientFirstName} ${opts.patientLastName}`,
    clinic_name: opts.clinicName,
    appointment_date: opts.appointmentDate,
    appointment_time: opts.appointmentTime,
  };
  if (opts.practitionerFirstName && opts.practitionerLastName) {
    vars.practitioner_name = `${opts.practitionerFirstName} ${opts.practitionerLastName}`.trim();
  }
  if (opts.serviceName) {
    vars.service_name = opts.serviceName;
  }
  return vars;
}

await test('buildNoShowVariables — all fields present', () => {
  const vars = buildNoShowVariables({
    patientFirstName: 'Ayşe', patientLastName: 'Yılmaz',
    clinicName: 'Merkez Diş', appointmentDate: '14 Haz', appointmentTime: '10:00',
    practitionerFirstName: 'Dr.', practitionerLastName: 'Kaya',
    serviceName: 'Kanal Tedavisi',
  });
  assert.equal(vars.patient_name, 'Ayşe Yılmaz');
  assert.equal(vars.clinic_name, 'Merkez Diş');
  assert.equal(vars.appointment_date, '14 Haz');
  assert.equal(vars.appointment_time, '10:00');
  assert.equal(vars.practitioner_name, 'Dr. Kaya');
  assert.equal(vars.service_name, 'Kanal Tedavisi');
});

await test('buildNoShowVariables — practitioner absent → no practitioner_name key', () => {
  const vars = buildNoShowVariables({
    patientFirstName: 'Ayşe', patientLastName: 'Yılmaz',
    clinicName: 'Merkez Diş', appointmentDate: '14 Haz', appointmentTime: '10:00',
  });
  assert.ok(!('practitioner_name' in vars), 'practitioner_name should not be included');
});

await test('buildNoShowVariables — service absent → no service_name key', () => {
  const vars = buildNoShowVariables({
    patientFirstName: 'Ayşe', patientLastName: 'Yılmaz',
    clinicName: 'Merkez Diş', appointmentDate: '14 Haz', appointmentTime: '10:00',
  });
  assert.ok(!('service_name' in vars), 'service_name should not be included');
});

await test('buildNoShowVariables — does not include sensitive fields (insurance, balance, notes)', () => {
  const vars = buildNoShowVariables({
    patientFirstName: 'Ayşe', patientLastName: 'Yılmaz',
    clinicName: 'Merkez Diş', appointmentDate: '14 Haz', appointmentTime: '10:00',
  });
  const sensitiveKeys = ['insurance', 'balance', 'remaining_balance', 'notes', 'internal_notes', 'medical'];
  for (const key of sensitiveKeys) {
    assert.ok(!(key in vars), `vars must not include sensitive field: ${key}`);
  }
});

// ─── Sonuç ────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
console.log('─'.repeat(60));

if (failed > 0) process.exit(1);
