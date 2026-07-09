/**
 * dashboard.test.ts — Dashboard Stats Endpoint Birim Testleri
 *
 * Çalıştırma: cd server && npx tsx src/tests/dashboard.test.ts
 *
 * Kapsanan senaryolar:
 *  - buildSafeStats: null/undefined ham veri → her zaman 0 döner
 *  - buildSafeStats: gerçek verilerle doğru hesaplama
 *  - clinicId kapsam doğrulaması (validateAndGetScope benzeri mantık)
 *    - OWNER tüm kliniklere erişebilir
 *    - CLINIC_MANAGER yalnızca atandığı klinikten veri alır
 *    - CLINIC_MANAGER atanmadığı klinik için 403 alır
 *    - DENTIST atandığı klinikten veri alır
 *    - BILLING atandığı klinikten veri alır (mevcut politika)
 *    - clinicId=all güvenli şekilde tüm izinli klinikleri döner
 *    - Geçersiz clinicId (farklı org) → erişim reddedilir, 500 değil
 *    - Hiç klinik ataması olmayan kullanıcı → erişim reddedilir
 *  - clinicIdWhere dönüşümü (toClinicOnlyScope inline):
 *    - tek clinicId → { clinicId: string }
 *    - birden fazla clinicId → { clinicId: { in: string[] } }
 *    - organizationId-only scope → klinik listesi alınır (mock)
 *  - Yanıt şekli tutarlılığı: stats nesnesinde tüm alanlar bulunmalı
 *  - Sıfır veri senaryosu: sayaçlar 0, toplamlar 0, çökmez
 *  - Null appointmentType senaryosu (buildChartData guard): skipped, null-safe
 *  - Null patient senaryosu (DENTIST recentPatients): skipped, null-safe
 */

import assert from 'node:assert/strict';
import { buildSafeStats } from '../routes/dashboard.js';

// ─── Test yardımcısı ──────────────────────────────────────────────────────────

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

// ─── Kullanıcı fabrikası ──────────────────────────────────────────────────────

type MockUser = {
  id: string;
  clinicId: string;
  role: string;
  normalizedRole: string;
  organizationId: string;
  allowedClinicIds: string[];
  canAccessAllClinics: boolean;
};

function makeUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: 'user-1',
    clinicId: 'clinic-A',
    role: 'admin',
    normalizedRole: 'CLINIC_MANAGER',
    organizationId: 'org-1',
    allowedClinicIds: ['clinic-A'],
    canAccessAllClinics: false,
    ...overrides,
  };
}

// ─── Kapsam doğrulama (validateAndGetScope mantığı inline) ────────────────────

let mockClinicFindFirst: (args: { where: { id: string; organizationId: string } }) => { id: string } | null =
  () => null;

async function buildClinicScopeWhere(
  user: MockUser,
  selectedClinicId: string | undefined,
): Promise<
  | { organizationId: string }
  | { organizationId: string; clinicId: string }
  | { organizationId: string; clinicId: { in: string[] } }
  | null
> {
  const orgId = user.organizationId;

  if (!selectedClinicId || selectedClinicId === 'all') {
    if (user.canAccessAllClinics) return { organizationId: orgId };
    if (user.allowedClinicIds.length === 0) return null;
    return { organizationId: orgId, clinicId: { in: user.allowedClinicIds } };
  }

  // Klinik bu organizasyona ait mi? (cross-org koruması)
  const clinic = mockClinicFindFirst({ where: { id: selectedClinicId, organizationId: orgId } });
  if (!clinic) return null;

  // Kullanıcının bu klinige erişimi var mı?
  if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(selectedClinicId)) return null;

  return { organizationId: orgId, clinicId: selectedClinicId };
}

// ─── toClinicOnlyScope (inline) ───────────────────────────────────────────────

let mockClinicFindMany: (args: any) => { id: string }[] = () => [];

async function toClinicOnlyScope(
  scope:
    | { organizationId: string }
    | { organizationId: string; clinicId: string }
    | { organizationId: string; clinicId: { in: string[] } },
): Promise<{ clinicId: string } | { clinicId: { in: string[] } }> {
  if ('clinicId' in scope) {
    return { clinicId: (scope as any).clinicId };
  }
  const clinics = mockClinicFindMany({ where: { organizationId: scope.organizationId } });
  return { clinicId: { in: clinics.map((c) => c.id) } };
}

// ─────────────────────────────────────────────────────────────────────────────
// BÖLÜM 1: buildSafeStats — Null güvenliği ve sıfır varsayılanlar
// ─────────────────────────────────────────────────────────────────────────────

section('buildSafeStats — null/undefined giriş → her zaman 0');

const tests: Promise<void>[] = [];

tests.push(
  test('tamamen boş girdi → tüm alanlar 0', () => {
    const result = buildSafeStats({});
    assert.equal(result.todayAppointments, 0);
    assert.equal(result.weekAppointments, 0);
    assert.equal(result.newPatientsMonth, 0);
    assert.equal(result.noShowsMonth, 0);
    assert.equal(result.pendingTasks, 0);
    assert.equal(result.overdueTasks, 0);
    assert.equal(result.openTreatments, 0);
    assert.equal(result.estimatedValue, 0);
    assert.equal(result.acceptedValue, 0);
    assert.equal(result.monthlyRevenue, 0);
    assert.equal(result.pendingAmount, 0);
    assert.equal(result.overdueAmount, 0);
    assert.equal(result.preparedMessages, 0);
    assert.equal(result.pendingAppointmentRequests, 0);
  }),
);

tests.push(
  test('null sayaçlar → 0', () => {
    const result = buildSafeStats({
      todayAppointments: null,
      weekAppointments: null,
      newPatientsMonth: null,
      noShowsMonth: null,
      pendingTasks: null,
      overdueTasks: null,
      openTreatments: null,
      preparedMessagesWeek: null,
      pendingAppointmentRequests: null,
    });
    assert.equal(result.todayAppointments, 0);
    assert.equal(result.weekAppointments, 0);
    assert.equal(result.newPatientsMonth, 0);
    assert.equal(result.noShowsMonth, 0);
    assert.equal(result.pendingTasks, 0);
    assert.equal(result.overdueTasks, 0);
    assert.equal(result.openTreatments, 0);
    assert.equal(result.preparedMessages, 0);
    assert.equal(result.pendingAppointmentRequests, 0);
  }),
);

tests.push(
  test('null aggregate _sum → 0', () => {
    const result = buildSafeStats({
      treatmentValues: { _sum: { estimatedAmount: null, acceptedAmount: null } },
      monthlyRevenue: { _sum: { amount: null } },
      pendingPayments: { _sum: { amount: null } },
      overdueInstallments: { _sum: { amount: null } },
    });
    assert.equal(result.estimatedValue, 0);
    assert.equal(result.acceptedValue, 0);
    assert.equal(result.monthlyRevenue, 0);
    assert.equal(result.pendingAmount, 0);
    assert.equal(result.overdueAmount, 0);
  }),
);

tests.push(
  test('eksik aggregate nesnesi → 0', () => {
    const result = buildSafeStats({
      treatmentValues: null,
      monthlyRevenue: null,
      pendingPayments: null,
      overdueInstallments: null,
    });
    assert.equal(result.estimatedValue, 0);
    assert.equal(result.acceptedValue, 0);
    assert.equal(result.monthlyRevenue, 0);
    assert.equal(result.pendingAmount, 0);
    assert.equal(result.overdueAmount, 0);
  }),
);

tests.push(
  test('eksik _sum anahtarı → 0', () => {
    const result = buildSafeStats({
      treatmentValues: {},
      monthlyRevenue: {},
      pendingPayments: {},
      overdueInstallments: {},
    });
    assert.equal(result.estimatedValue, 0);
    assert.equal(result.acceptedValue, 0);
    assert.equal(result.monthlyRevenue, 0);
    assert.equal(result.pendingAmount, 0);
    assert.equal(result.overdueAmount, 0);
  }),
);

section('buildSafeStats — gerçek verilerle doğru hesaplama');

tests.push(
  test('gerçek sayaçlarla doğru eşleşme', () => {
    const result = buildSafeStats({
      todayAppointments: 5,
      weekAppointments: 23,
      newPatientsMonth: 12,
      noShowsMonth: 3,
      pendingTasks: 7,
      overdueTasks: 2,
      openTreatments: 15,
      preparedMessagesWeek: 4,
      pendingAppointmentRequests: 6,
    });
    assert.equal(result.todayAppointments, 5);
    assert.equal(result.weekAppointments, 23);
    assert.equal(result.newPatientsMonth, 12);
    assert.equal(result.noShowsMonth, 3);
    assert.equal(result.pendingTasks, 7);
    assert.equal(result.overdueTasks, 2);
    assert.equal(result.openTreatments, 15);
    assert.equal(result.preparedMessages, 4);
    assert.equal(result.pendingAppointmentRequests, 6);
  }),
);

tests.push(
  test('gerçek aggregate toplamlarıyla doğru eşleşme', () => {
    const result = buildSafeStats({
      treatmentValues: { _sum: { estimatedAmount: 5000, acceptedAmount: 3200 } },
      monthlyRevenue: { _sum: { amount: 8500 } },
      pendingPayments: { _sum: { amount: 1200 } },
      overdueInstallments: { _sum: { amount: 450 } },
    });
    assert.equal(result.estimatedValue, 5000);
    assert.equal(result.acceptedValue, 3200);
    assert.equal(result.monthlyRevenue, 8500);
    assert.equal(result.pendingAmount, 1200);
    assert.equal(result.overdueAmount, 450);
  }),
);

tests.push(
  test('overdueAmount, pendingAmount’dan bağımsız hesaplanır (farklı kaynaklar)', () => {
    // Regression: "Gecikmiş Tahsilatlar" kartı artık tüm pending Payment
    // toplamını değil, yalnızca vadesi geçmiş PaymentPlanInstallment
    // toplamını yansıtır — ikisi farklı sayılar olabilir.
    const result = buildSafeStats({
      pendingPayments: { _sum: { amount: 5000 } },
      overdueInstallments: { _sum: { amount: 450 } },
    });
    assert.equal(result.pendingAmount, 5000);
    assert.equal(result.overdueAmount, 450);
    assert.notEqual(result.pendingAmount, result.overdueAmount);
  }),
);

tests.push(
  test('yanıt şekli: tüm beklenen alanlar mevcut', () => {
    const result = buildSafeStats({});
    const expectedKeys = [
      'todayAppointments',
      'weekAppointments',
      'newPatientsMonth',
      'noShowsMonth',
      'pendingTasks',
      'overdueTasks',
      'openTreatments',
      'estimatedValue',
      'acceptedValue',
      'monthlyRevenue',
      'pendingAmount',
      'overdueAmount',
      'preparedMessages',
      'pendingAppointmentRequests',
    ];
    for (const key of expectedKeys) {
      assert.ok(key in result, `Eksik alan: ${key}`);
    }
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// BÖLÜM 2: Kapsam doğrulaması — erişim kontrolü senaryoları
// ─────────────────────────────────────────────────────────────────────────────

section('Kapsam doğrulaması — OWNER tüm kliniklere erişebilir');

tests.push(
  test('OWNER, clinicId=all ile tüm org kapsamını alır', async () => {
    const owner = makeUser({
      role: 'admin',
      normalizedRole: 'OWNER',
      canAccessAllClinics: true,
      allowedClinicIds: ['clinic-A', 'clinic-B'],
    });
    const scope = await buildClinicScopeWhere(owner, 'all');
    assert.deepEqual(scope, { organizationId: 'org-1' });
  }),
);

tests.push(
  test('OWNER, clinicId belirtilmeden tüm org kapsamını alır', async () => {
    const owner = makeUser({
      normalizedRole: 'OWNER',
      canAccessAllClinics: true,
    });
    const scope = await buildClinicScopeWhere(owner, undefined);
    assert.deepEqual(scope, { organizationId: 'org-1' });
  }),
);

tests.push(
  test('OWNER, belirli klinik belirtince o klinik kapsamını alır', async () => {
    mockClinicFindFirst = (args) =>
      args.where.id === 'clinic-A' && args.where.organizationId === 'org-1'
        ? { id: 'clinic-A' }
        : null;
    const owner = makeUser({
      normalizedRole: 'OWNER',
      canAccessAllClinics: true,
    });
    const scope = await buildClinicScopeWhere(owner, 'clinic-A');
    assert.deepEqual(scope, { organizationId: 'org-1', clinicId: 'clinic-A' });
  }),
);

section('Kapsam doğrulaması — CLINIC_MANAGER yalnızca atandığı klinikten veri alır');

tests.push(
  test('CLINIC_MANAGER atandığı klinike erişebilir', async () => {
    mockClinicFindFirst = (args) =>
      args.where.id === 'clinic-A' && args.where.organizationId === 'org-1'
        ? { id: 'clinic-A' }
        : null;
    const manager = makeUser({
      normalizedRole: 'CLINIC_MANAGER',
      canAccessAllClinics: false,
      allowedClinicIds: ['clinic-A'],
    });
    const scope = await buildClinicScopeWhere(manager, 'clinic-A');
    assert.deepEqual(scope, { organizationId: 'org-1', clinicId: 'clinic-A' });
  }),
);

tests.push(
  test('CLINIC_MANAGER atanmadığı klinik için null döner (→ 403)', async () => {
    mockClinicFindFirst = (args) =>
      args.where.id === 'clinic-B' && args.where.organizationId === 'org-1'
        ? { id: 'clinic-B' }
        : null;
    const manager = makeUser({
      normalizedRole: 'CLINIC_MANAGER',
      canAccessAllClinics: false,
      allowedClinicIds: ['clinic-A'], // clinic-B atanmamış
    });
    const scope = await buildClinicScopeWhere(manager, 'clinic-B');
    assert.equal(scope, null, 'Atanmamış klinik → null bekleniyor (403 verilecek)');
  }),
);

tests.push(
  test('CLINIC_MANAGER clinicId=all ile yalnızca atandığı klinikler kapsamını alır', async () => {
    const manager = makeUser({
      normalizedRole: 'CLINIC_MANAGER',
      canAccessAllClinics: false,
      allowedClinicIds: ['clinic-A', 'clinic-C'],
    });
    const scope = await buildClinicScopeWhere(manager, 'all');
    assert.deepEqual(scope, { organizationId: 'org-1', clinicId: { in: ['clinic-A', 'clinic-C'] } });
  }),
);

section('Kapsam doğrulaması — DENTIST atandığı klinikten veri alır');

tests.push(
  test('DENTIST atandığı klinike erişebilir', async () => {
    mockClinicFindFirst = (args) =>
      args.where.id === 'clinic-A' && args.where.organizationId === 'org-1'
        ? { id: 'clinic-A' }
        : null;
    const dentist = makeUser({
      normalizedRole: 'DENTIST',
      role: 'doctor',
      canAccessAllClinics: false,
      allowedClinicIds: ['clinic-A'],
    });
    const scope = await buildClinicScopeWhere(dentist, 'clinic-A');
    assert.deepEqual(scope, { organizationId: 'org-1', clinicId: 'clinic-A' });
  }),
);

tests.push(
  test('DENTIST başka klinike erişemez (→ 403)', async () => {
    mockClinicFindFirst = (args) =>
      args.where.id === 'clinic-B' && args.where.organizationId === 'org-1'
        ? { id: 'clinic-B' }
        : null;
    const dentist = makeUser({
      normalizedRole: 'DENTIST',
      role: 'doctor',
      canAccessAllClinics: false,
      allowedClinicIds: ['clinic-A'],
    });
    const scope = await buildClinicScopeWhere(dentist, 'clinic-B');
    assert.equal(scope, null);
  }),
);

section('Kapsam doğrulaması — BILLING mevcut politikayı izler');

tests.push(
  test('BILLING atandığı klinike erişebilir', async () => {
    mockClinicFindFirst = (args) =>
      args.where.id === 'clinic-A' && args.where.organizationId === 'org-1'
        ? { id: 'clinic-A' }
        : null;
    const billing = makeUser({
      normalizedRole: 'BILLING',
      role: 'billing',
      canAccessAllClinics: false,
      allowedClinicIds: ['clinic-A'],
    });
    const scope = await buildClinicScopeWhere(billing, 'clinic-A');
    assert.deepEqual(scope, { organizationId: 'org-1', clinicId: 'clinic-A' });
  }),
);

tests.push(
  test('BILLING atanmadığı klinikten veri alamaz (→ 403)', async () => {
    mockClinicFindFirst = (args) =>
      args.where.id === 'clinic-B' ? { id: 'clinic-B' } : null;
    const billing = makeUser({
      normalizedRole: 'BILLING',
      role: 'billing',
      canAccessAllClinics: false,
      allowedClinicIds: ['clinic-A'],
    });
    const scope = await buildClinicScopeWhere(billing, 'clinic-B');
    assert.equal(scope, null);
  }),
);

section('Kapsam doğrulaması — Güvenlik senaryoları');

tests.push(
  test('Farklı organizasyona ait geçersiz clinicId → null (→ 403, 500 değil)', async () => {
    // DB'de klinik bulunamıyor (farklı org veya geçersiz ID)
    mockClinicFindFirst = () => null;
    const user = makeUser({
      normalizedRole: 'CLINIC_MANAGER',
      canAccessAllClinics: false,
      allowedClinicIds: ['clinic-A'],
    });
    const scope = await buildClinicScopeWhere(user, 'a64852d9-745b-4e11-9993-3b3486b1e9c2');
    assert.equal(scope, null, 'Geçersiz/yabancı org klinik ID → null (403)');
  }),
);

tests.push(
  test('Hiç klinik ataması olmayan kullanıcı → null (→ 403)', async () => {
    const user = makeUser({
      normalizedRole: 'RECEPTIONIST',
      canAccessAllClinics: false,
      allowedClinicIds: [],
    });
    const scope = await buildClinicScopeWhere(user, undefined);
    assert.equal(scope, null);
  }),
);

tests.push(
  test('Hiç klinik ataması olmayan kullanıcı, all seçince → null', async () => {
    const user = makeUser({
      normalizedRole: 'RECEPTIONIST',
      canAccessAllClinics: false,
      allowedClinicIds: [],
    });
    const scope = await buildClinicScopeWhere(user, 'all');
    assert.equal(scope, null);
  }),
);

tests.push(
  test('Cross-org: başka organizasyona ait klinik → null', async () => {
    // Klinik farklı org'a ait, mockta organizationId eşleşmiyor
    mockClinicFindFirst = (args) =>
      args.where.organizationId === 'org-1' ? null : { id: 'clinic-X' }; // sadece org-2'de mevcut
    const user = makeUser({
      normalizedRole: 'OWNER',
      canAccessAllClinics: true,
      organizationId: 'org-1',
    });
    const scope = await buildClinicScopeWhere(user, 'clinic-X');
    assert.equal(scope, null, 'Farklı org klinik → null bekleniyor');
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// BÖLÜM 3: toClinicOnlyScope — organizationId soyutlaması
// ─────────────────────────────────────────────────────────────────────────────

section('toClinicOnlyScope — clinicId bazlı filtre dönüşümü');

tests.push(
  test('{ organizationId, clinicId: string } → { clinicId: string }', async () => {
    const result = await toClinicOnlyScope({ organizationId: 'org-1', clinicId: 'clinic-A' });
    assert.deepEqual(result, { clinicId: 'clinic-A' });
  }),
);

tests.push(
  test('{ organizationId, clinicId: { in: [...] } } → { clinicId: { in: [...] } }', async () => {
    const result = await toClinicOnlyScope({
      organizationId: 'org-1',
      clinicId: { in: ['clinic-A', 'clinic-B'] },
    });
    assert.deepEqual(result, { clinicId: { in: ['clinic-A', 'clinic-B'] } });
  }),
);

tests.push(
  test('{ organizationId } only → DB\'den tüm klinik ID\'leri alinir', async () => {
    mockClinicFindMany = () => [{ id: 'clinic-A' }, { id: 'clinic-B' }, { id: 'clinic-C' }];
    const result = await toClinicOnlyScope({ organizationId: 'org-1' });
    assert.deepEqual(result, { clinicId: { in: ['clinic-A', 'clinic-B', 'clinic-C'] } });
  }),
);

tests.push(
  test('{ organizationId } → orgda klinik yoksa bos dizi (sorgu 0 sonuc doner)', async () => {
    mockClinicFindMany = () => [];
    const result = await toClinicOnlyScope({ organizationId: 'org-1' });
    assert.deepEqual(result, { clinicId: { in: [] } });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// BÖLÜM 4: Null güvenliği — appointmentType/patient null olduğunda çökmez
// ─────────────────────────────────────────────────────────────────────────────

section('Null güvenliği — appointmentType null senaryosu (buildChartData guard)');

tests.push(
  test('buildChartData typeMap: null appointmentType → satır atlanır, çökmez', () => {
    // buildChartData'nın içindeki forEach mantığının inline kopyası
    const monthAppts: Array<{ appointmentType: { name: string; color: string | null } | null }> = [
      { appointmentType: { name: 'Muayene', color: '#6366f1' } },
      { appointmentType: null }, // data inconsistency — should be skipped
      { appointmentType: { name: 'Dolgu', color: '#f59e0b' } },
      { appointmentType: { name: 'Muayene', color: '#6366f1' } },
    ];

    const typeMap: Record<string, { name: string; color: string; value: number }> = {};

    // Bu, düzeltilmiş dashboard.ts kodunun inline kopyasıdır
    monthAppts.forEach((a) => {
      if (!a.appointmentType) return; // null-safe guard
      const key = a.appointmentType.name;
      if (!typeMap[key]) typeMap[key] = { name: key, color: a.appointmentType.color || '#6366f1', value: 0 };
      typeMap[key].value++;
    });

    assert.equal(typeMap['Muayene'].value, 2);
    assert.equal(typeMap['Dolgu'].value, 1);
    assert.ok(!('null' in typeMap), 'null appointmentType kayıt oluşturmamalı');
  }),
);

section('Null güvenliği — DENTIST recentPatients null patient/appointmentType guard');

tests.push(
  test('recentPatients map: null patient → filtre eder', () => {
    const rawAppts: Array<{
      patient: { id: string; firstName: string; lastName: string } | null;
      appointmentType: { name: string } | null;
      startTime: Date;
    }> = [
      {
        patient: { id: 'p1', firstName: 'Ali', lastName: 'Yılmaz' },
        appointmentType: { name: 'Dolgu' },
        startTime: new Date('2026-05-20'),
      },
      {
        patient: null, // corrupted record — should be skipped
        appointmentType: { name: 'Kanal' },
        startTime: new Date('2026-05-19'),
      },
    ];

    const seen = new Set<string>();
    const recentPatients = rawAppts
      .filter((a) => {
        if (!a.patient) return false; // null-safe guard
        if (seen.has(a.patient.id)) return false;
        seen.add(a.patient.id);
        return true;
      })
      .map((a) => ({
        ...a.patient,
        lastService: a.appointmentType?.name ?? null, // null-safe
        lastVisit: a.startTime,
      }));

    assert.equal(recentPatients.length, 1);
    assert.equal(recentPatients[0].firstName, 'Ali');
    assert.equal(recentPatients[0].lastService, 'Dolgu');
  }),
);

tests.push(
  test('recentPatients map: null appointmentType → lastService null döner, çökmez', () => {
    const rawAppts = [
      {
        patient: { id: 'p1', firstName: 'Fatma', lastName: 'Demir' },
        appointmentType: null, // missing type
        startTime: new Date('2026-05-18'),
      },
    ];

    const seen = new Set<string>();
    const recentPatients = rawAppts
      .filter((a) => {
        if (!a.patient) return false;
        if (seen.has(a.patient.id)) return false;
        seen.add(a.patient.id);
        return true;
      })
      .map((a) => ({
        ...a.patient,
        lastService: (a.appointmentType as any)?.name ?? null,
        lastVisit: a.startTime,
      }));

    assert.equal(recentPatients.length, 1);
    assert.equal(recentPatients[0].lastService, null, 'null appointmentType → lastService null');
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// BÖLÜM 5: Alerts mantığı — null-safe kontrol
// ─────────────────────────────────────────────────────────────────────────────

section('Alerts — null-safe amount kontrolü');

tests.push(
  test('pendingAmount null → alert oluşturulmaz', () => {
    const pendingPayments = { _sum: { amount: null } };
    const pendingAmount = pendingPayments?._sum?.amount ?? 0;
    const alerts: any[] = [];
    if (pendingAmount > 0) {
      alerts.push({ type: 'info', title: 'pendingCollections', value: pendingAmount });
    }
    assert.equal(alerts.length, 0);
  }),
);

tests.push(
  test('pendingAmount 0 → alert oluşturulmaz', () => {
    const pendingPayments = { _sum: { amount: 0 } };
    const pendingAmount = pendingPayments?._sum?.amount ?? 0;
    const alerts: any[] = [];
    if (pendingAmount > 0) {
      alerts.push({ type: 'info', title: 'pendingCollections', value: pendingAmount });
    }
    assert.equal(alerts.length, 0);
  }),
);

tests.push(
  test('pendingAmount > 0 → alert oluşturulur', () => {
    const pendingPayments = { _sum: { amount: 1500 } };
    const pendingAmount = pendingPayments?._sum?.amount ?? 0;
    const alerts: any[] = [];
    if (pendingAmount > 0) {
      alerts.push({ type: 'info', title: 'pendingCollections', value: pendingAmount });
    }
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].value, 1500);
  }),
);

tests.push(
  test('eksik _sum nesnesi → alert oluşturulmaz, çökmez', () => {
    const pendingPayments: { _sum?: { amount?: number | null } | null } = { _sum: undefined };
    const pendingAmount = pendingPayments?._sum?.amount ?? 0;
    const alerts: any[] = [];
    if (pendingAmount > 0) {
      alerts.push({ type: 'info', title: 'pendingCollections', value: pendingAmount });
    }
    assert.equal(alerts.length, 0);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Sonuçlar
// ─────────────────────────────────────────────────────────────────────────────

Promise.all(tests).then(() => {
  console.log('\n──────────────────────────────────────────────────');
  console.log(`Toplam: ${passed + failed} test | Geçen: ${passed} | Başarısız: ${failed}`);

  if (failed === 0) {
    console.log('\nTüm dashboard stats testleri geçti!');
    process.exit(0);
  } else {
    console.error(`\n${failed} test başarısız oldu.`);
    process.exit(1);
  }
});
