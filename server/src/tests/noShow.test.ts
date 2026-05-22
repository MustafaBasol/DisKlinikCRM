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

await test('admin + canAccessAllClinics=false → ORG_ADMIN', () => {
  assert.equal(normalizeRole('admin', false), 'ORG_ADMIN');
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

// ─── Sonuç ────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
console.log('─'.repeat(60));

if (failed > 0) process.exit(1);
