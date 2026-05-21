/**
 * organizationDashboard.test.ts — Sprint 9: Org Dashboard birim testleri
 *
 * Koşturma: cd server && npx tsx src/tests/organizationDashboard.test.ts
 *
 * Senaryolar:
 *  - getDateRange: tüm range türleri doğru hesaplanıyor
 *  - noShowRate: sıfır randevuda güvenli bölme
 *  - Insight seçim mantığı: en yüksek/en düşük şubeyi doğru buluyor
 *  - Özet toplam hesabı: çok şubeli senaryo
 *  - Boş organizasyon: sıfır döndürür
 *  - Erişim kontrolü: canAccessOrganizationDashboard
 */

import assert from 'node:assert/strict';
import { getDateRange } from '../routes/organizationDashboard.js';
import { canAccessOrganizationDashboard } from '../utils/roles.js';

// ── Test yardımcısı ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err?.message ?? err}`);
    failed++;
  }
}

// ── getDateRange Testleri ────────────────────────────────────────────────────

console.log('\n── getDateRange ──');

test('today: from gece yarısı, to gün sonu', () => {
  const r = getDateRange('today');
  assert.equal(r.from.getHours(), 0);
  assert.equal(r.from.getMinutes(), 0);
  assert.equal(r.to.getHours(), 23);
  assert.equal(r.to.getMinutes(), 59);
  assert.equal(r.to.getSeconds(), 59);
});

test('this_week: from bu haftanın başı', () => {
  const r = getDateRange('this_week');
  assert.ok(r.from <= new Date());
  assert.equal(r.from.getDay(), 0); // pazar = 0 (JS default)
  assert.equal(r.from.getHours(), 0);
});

test('last_30_days: from 29 gün önce', () => {
  const r = getDateRange('last_30_days');
  const diffMs = Date.now() - r.from.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  assert.ok(diffDays >= 29 && diffDays <= 30);
});

test('this_month: from ayın 1i, saat 00:00:00', () => {
  const r = getDateRange('this_month');
  const now = new Date();
  assert.equal(r.from.getFullYear(), now.getFullYear());
  assert.equal(r.from.getMonth(), now.getMonth());
  assert.equal(r.from.getDate(), 1);
  assert.equal(r.from.getHours(), 0);
});

test('custom: from ve to parametreleri doğru parse edilir', () => {
  const r = getDateRange('custom', '2026-01-01', '2026-01-31');
  assert.equal(r.from.toISOString().slice(0, 10), '2026-01-01');
  assert.equal(r.to.toISOString().slice(0, 10), '2026-01-31');
  assert.equal(r.to.getHours(), 23);
  assert.equal(r.to.getSeconds(), 59);
});

test('custom: from veya to yoksa hata fırlatır', () => {
  assert.throws(() => getDateRange('custom'), /custom range requires/);
  assert.throws(() => getDateRange('custom', '2026-01-01', ''), /custom range requires/);
});

test('from <= to garantisi sağlanır (today)', () => {
  const r = getDateRange('today');
  assert.ok(r.from <= r.to);
});

test('from <= to garantisi sağlanır (this_month)', () => {
  const r = getDateRange('this_month');
  assert.ok(r.from <= r.to);
});

test('bilinmeyen range → this_month gibi davranır', () => {
  const r = getDateRange('unknown_range');
  const now = new Date();
  assert.equal(r.from.getMonth(), now.getMonth());
  assert.equal(r.from.getDate(), 1);
});

// ── noShowRate Hesabı ────────────────────────────────────────────────────────

console.log('\n── noShowRate Hesabı ──');

function calcNoShowRate(noShowCount: number, totalAppointments: number): number {
  return totalAppointments > 0
    ? Math.round((noShowCount / totalAppointments) * 1000) / 1000
    : 0;
}

test('Sıfır randevuda noShowRate sıfırdır (sıfıra bölme yok)', () => {
  assert.equal(calcNoShowRate(0, 0), 0);
});

test('7 no-show / 100 randevu → 0.07', () => {
  assert.equal(calcNoShowRate(7, 100), 0.07);
});

test('0 no-show → 0', () => {
  assert.equal(calcNoShowRate(0, 50), 0);
});

test('Tüm randevular no-show → 1.0', () => {
  assert.equal(calcNoShowRate(10, 10), 1.0);
});

test('Kesirli oran 3 ondalık basamağa yuvarlanır', () => {
  // 1/3 ≈ 0.333
  assert.equal(calcNoShowRate(1, 3), 0.333);
});

// ── Insight Seçim Mantığı ────────────────────────────────────────────────────

console.log('\n── Insight Seçim Mantığı ──');

interface MockClinic {
  clinicId: string;
  clinicName: string;
  revenue: number;
  appointments: number;
  noShowRate: number;
  newPatients: number;
  outstandingBalance: number;
}

function selectInsights(metrics: MockClinic[]) {
  if (metrics.length === 0) return null;
  const topRevenue    = metrics.reduce((b, c) => c.revenue > b.revenue ? c : b, metrics[0]);
  const lowestRevenue = metrics.reduce((b, c) => c.revenue < b.revenue ? c : b, metrics[0]);
  const topAppts      = metrics.reduce((b, c) => c.appointments > b.appointments ? c : b, metrics[0]);
  const topNoShow     = metrics.reduce((b, c) => c.noShowRate > b.noShowRate ? c : b, metrics[0]);
  const topNewPts     = metrics.reduce((b, c) => c.newPatients > b.newPatients ? c : b, metrics[0]);
  const topOut        = metrics.reduce((b, c) => c.outstandingBalance > b.outstandingBalance ? c : b, metrics[0]);
  return { topRevenue, lowestRevenue, topAppts, topNoShow, topNewPts, topOut };
}

const mockClinics: MockClinic[] = [
  { clinicId: 'c1', clinicName: 'Annecy', revenue: 9800, appointments: 105, noShowRate: 0.057, newPatients: 14, outstandingBalance: 2200 },
  { clinicId: 'c2', clinicName: 'Lyon',   revenue: 12400, appointments: 140, noShowRate: 0.03,  newPatients: 8,  outstandingBalance: 5100 },
  { clinicId: 'c3', clinicName: 'Paris',  revenue: 6200,  appointments: 88,  noShowRate: 0.11,  newPatients: 20, outstandingBalance: 1800 },
];

test('topRevenueClinic: en yüksek gelirli şube doğru seçilir', () => {
  const ins = selectInsights(mockClinics)!;
  assert.equal(ins.topRevenue.clinicId, 'c2');
});

test('lowestRevenueClinic: en düşük gelirli şube doğru seçilir', () => {
  const ins = selectInsights(mockClinics)!;
  assert.equal(ins.lowestRevenue.clinicId, 'c3');
});

test('highestAppointmentClinic: en çok randevusu olan şube', () => {
  const ins = selectInsights(mockClinics)!;
  assert.equal(ins.topAppts.clinicId, 'c2');
});

test('highestNoShowClinic: en yüksek no-show oranı', () => {
  const ins = selectInsights(mockClinics)!;
  assert.equal(ins.topNoShow.clinicId, 'c3');
});

test('topNewPatientClinic: en çok yeni hasta', () => {
  const ins = selectInsights(mockClinics)!;
  assert.equal(ins.topNewPts.clinicId, 'c3');
});

test('highestOutstandingBalanceClinic: en yüksek bekleyen bakiye', () => {
  const ins = selectInsights(mockClinics)!;
  assert.equal(ins.topOut.clinicId, 'c2');
});

test('Tek şubeli organizasyon → hem topRevenue hem lowestRevenue aynı şube', () => {
  const single = [mockClinics[0]];
  const ins = selectInsights(single)!;
  assert.equal(ins.topRevenue.clinicId, ins.lowestRevenue.clinicId);
});

test('Boş metrik listesi → null döner', () => {
  assert.equal(selectInsights([]), null);
});

// ── Özet Toplam Hesabı ───────────────────────────────────────────────────────

console.log('\n── Özet Toplam Hesabı ──');

function buildSummary(metrics: MockClinic[]) {
  return {
    totalClinics: metrics.length,
    totalAppointments: metrics.reduce((s, c) => s + c.appointments, 0),
    monthlyRevenue: metrics.reduce((s, c) => s + c.revenue, 0),
    outstandingBalance: metrics.reduce((s, c) => s + c.outstandingBalance, 0),
    newPatients: metrics.reduce((s, c) => s + c.newPatients, 0),
    averageNoShowRate: metrics.length > 0
      ? Math.round((metrics.reduce((s, c) => s + c.noShowRate, 0) / metrics.length) * 1000) / 1000
      : 0,
  };
}

test('3 şube özet: totalClinics = 3', () => {
  const s = buildSummary(mockClinics);
  assert.equal(s.totalClinics, 3);
});

test('3 şube özet: toplam randevu doğru hesaplanır', () => {
  const s = buildSummary(mockClinics);
  assert.equal(s.totalAppointments, 105 + 140 + 88);
});

test('3 şube özet: toplam gelir doğru hesaplanır', () => {
  const s = buildSummary(mockClinics);
  assert.equal(s.monthlyRevenue, 9800 + 12400 + 6200);
});

test('Ortalama no-show 3 ondalık hassasiyetle', () => {
  const s = buildSummary(mockClinics);
  const expected = Math.round(((0.057 + 0.03 + 0.11) / 3) * 1000) / 1000;
  assert.equal(s.averageNoShowRate, expected);
});

test('Boş organizasyon → sıfır değerler', () => {
  const s = buildSummary([]);
  assert.equal(s.totalClinics, 0);
  assert.equal(s.totalAppointments, 0);
  assert.equal(s.monthlyRevenue, 0);
  assert.equal(s.averageNoShowRate, 0);
});

// ── Erişim Kontrolü ──────────────────────────────────────────────────────────

console.log('\n── Erişim Kontrolü ──');

type Role = string;

function makeUser(role: Role, canAccessAllClinics = false) {
  return { role, canAccessAllClinics, allowedClinicIds: [] as string[], organizationId: 'org-1' };
}

test('OWNER → canAccessOrganizationDashboard = true', () => {
  assert.ok(canAccessOrganizationDashboard(makeUser('OWNER', true)));
});

test('ORG_ADMIN → canAccessOrganizationDashboard = true', () => {
  assert.ok(canAccessOrganizationDashboard(makeUser('ORG_ADMIN', true)));
});

test('Legacy admin + canAccessAllClinics=true → true (OWNER\'a normalize)', () => {
  assert.ok(canAccessOrganizationDashboard(makeUser('admin', true)));
});

test('Legacy admin + canAccessAllClinics=false → false (CLINIC_MANAGER\'a normalize)', () => {
  assert.equal(canAccessOrganizationDashboard(makeUser('admin', false)), false);
});

test('DENTIST → canAccessOrganizationDashboard = false', () => {
  assert.equal(canAccessOrganizationDashboard(makeUser('DENTIST')), false);
});

test('RECEPTIONIST → canAccessOrganizationDashboard = false', () => {
  assert.equal(canAccessOrganizationDashboard(makeUser('RECEPTIONIST')), false);
});

test('BILLING → canAccessOrganizationDashboard = false', () => {
  assert.equal(canAccessOrganizationDashboard(makeUser('BILLING')), false);
});

test('CLINIC_MANAGER → canAccessOrganizationDashboard = false', () => {
  assert.equal(canAccessOrganizationDashboard(makeUser('CLINIC_MANAGER')), false);
});

// ── Özet ─────────────────────────────────────────────────────────────────────

console.log(`\nToplam: ${passed + failed} test | Geçen: ${passed} | Başarısız: ${failed}`);

if (failed > 0) {
  console.error('\nBazı testler başarısız oldu!');
  process.exit(1);
} else {
  console.log('Tüm organizasyon dashboard testleri geçti!');
}
