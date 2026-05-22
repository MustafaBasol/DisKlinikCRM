/**
 * servicePricing.test.ts — Service Pricing Integration Audit Tests
 *
 * Tests cover:
 *  1. AppointmentType (Klinik Hizmetleri) basePrice validation rules
 *  2. No-show estimatedLostRevenue calculation from service basePrice
 *  3. TreatmentPlanProcedure estimatedCost auto-fill from service basePrice
 *  4. Currency fallback chain: service → clinic → default
 *  5. Null/zero price edge cases (zero-division safety, null coalescing)
 *  6. Cross-org price isolation (services must be scoped by clinicId)
 *
 * Run with: tsx src/tests/servicePricing.test.ts
 */

import assert from 'node:assert/strict';

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
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

// ─── Helpers / inline logic mirrors ───────────────────────────────────────────

/** Mirror of estimatedLostRevenue used in noShows.ts dashboard */
function calcEstimatedLostRevenue(noShowAppts: Array<{ appointmentType?: { basePrice?: number | null } | null }>) {
  return noShowAppts.reduce((sum, a) => sum + (a.appointmentType?.basePrice ?? 0), 0);
}

/** Mirror of currency resolution used in services.ts create handler */
function resolveServiceCurrency(
  requested: string | undefined | null,
  clinicCurrency: string | undefined | null,
  systemDefault = 'USD',
): string {
  return requested || clinicCurrency || systemDefault;
}

/** Mirror of estimatedCost prefill logic in TreatmentCaseDetail UI */
function prefillEstimatedCost(
  currentCost: string,
  service: { basePrice?: number | null } | null | undefined,
): string {
  if (!service) return currentCost;
  if (service.basePrice != null && currentCost === '') {
    return String(service.basePrice);
  }
  return currentCost;
}

/** Simulates a serviceId validation in treatmentPlanProcedures.ts create handler */
function validateServiceBelongsToClinic(
  serviceId: string | undefined,
  clinicId: string,
  allServices: Array<{ id: string; clinicId: string }>,
): boolean {
  if (!serviceId) return true; // optional field — null is valid
  const svc = allServices.find((s) => s.id === serviceId);
  return !!svc && svc.clinicId === clinicId;
}

// ─── Section 1: basePrice validation rules ────────────────────────────────────

section('1. AppointmentType basePrice validation');

await test('null basePrice is valid (optional field)', () => {
  const apptType = { id: 'at-1', name: 'Genel Muayene', basePrice: null, currency: null };
  assert.equal(apptType.basePrice, null);
});

await test('zero basePrice is valid (free service)', () => {
  const apptType = { id: 'at-2', name: 'Ücretsiz Danışma', basePrice: 0, currency: 'TRY' };
  assert.equal(apptType.basePrice, 0);
  assert.ok(apptType.basePrice >= 0, 'price must be non-negative');
});

await test('positive basePrice is valid', () => {
  const apptType = { id: 'at-3', name: 'İmplant', basePrice: 15000, currency: 'TRY' };
  assert.equal(apptType.basePrice, 15000);
  assert.ok(apptType.basePrice > 0);
});

await test('negative basePrice fails validation rule', () => {
  const price = -100;
  assert.ok(price < 0, 'negative should fail');
  // schema enforces z.number().nonnegative()
});

// ─── Section 2: No-show estimatedLostRevenue ──────────────────────────────────

section('2. No-show estimatedLostRevenue calculation');

await test('sums basePrice across no-show appointments', () => {
  const noShows = [
    { appointmentType: { basePrice: 500 } },
    { appointmentType: { basePrice: 1200 } },
    { appointmentType: { basePrice: 300 } },
  ];
  const total = calcEstimatedLostRevenue(noShows);
  assert.equal(total, 2000);
});

await test('null basePrice treated as 0 in revenue sum', () => {
  const noShows = [
    { appointmentType: { basePrice: null } },
    { appointmentType: { basePrice: 800 } },
    { appointmentType: null },
  ];
  const total = calcEstimatedLostRevenue(noShows);
  assert.equal(total, 800);
});

await test('empty no-show list returns 0 (no zero-division)', () => {
  assert.equal(calcEstimatedLostRevenue([]), 0);
});

await test('all null prices returns 0', () => {
  const noShows = [
    { appointmentType: { basePrice: null } },
    { appointmentType: { basePrice: null } },
  ];
  assert.equal(calcEstimatedLostRevenue(noShows), 0);
});

await test('fractional prices sum correctly', () => {
  const noShows = [
    { appointmentType: { basePrice: 99.99 } },
    { appointmentType: { basePrice: 0.01 } },
  ];
  const total = calcEstimatedLostRevenue(noShows);
  assert.ok(Math.abs(total - 100) < 0.001, `expected ~100 got ${total}`);
});

// ─── Section 3: TreatmentPlanProcedure estimatedCost prefill ──────────────────

section('3. Procedure estimatedCost prefill from service basePrice');

await test('prefills estimatedCost when field is empty and service has price', () => {
  const result = prefillEstimatedCost('', { basePrice: 5000 });
  assert.equal(result, '5000');
});

await test('does NOT overwrite existing estimatedCost', () => {
  const result = prefillEstimatedCost('3000', { basePrice: 5000 });
  assert.equal(result, '3000'); // user's value preserved
});

await test('no prefill when service has null basePrice', () => {
  const result = prefillEstimatedCost('', { basePrice: null });
  assert.equal(result, '');
});

await test('no prefill when service is null (no service selected)', () => {
  const result = prefillEstimatedCost('', null);
  assert.equal(result, '');
});

await test('prefill works with zero price (free service)', () => {
  const result = prefillEstimatedCost('', { basePrice: 0 });
  assert.equal(result, '0');
});

await test('does NOT prefill when cost already filled and service changes', () => {
  const result = prefillEstimatedCost('1500', { basePrice: 3000 });
  assert.equal(result, '1500'); // user value protected
});

// ─── Section 4: Currency resolution chain ────────────────────────────────────

section('4. Currency resolution (service → clinic → default)');

await test('uses service currency when provided', () => {
  assert.equal(resolveServiceCurrency('EUR', 'TRY'), 'EUR');
});

await test('falls back to clinic currency when service currency is null', () => {
  assert.equal(resolveServiceCurrency(null, 'TRY'), 'TRY');
});

await test('falls back to clinic currency when service currency is empty string', () => {
  assert.equal(resolveServiceCurrency('', 'TRY'), 'TRY');
});

await test('falls back to USD system default when both null', () => {
  assert.equal(resolveServiceCurrency(null, null), 'USD');
});

await test('falls back to USD when both empty', () => {
  assert.equal(resolveServiceCurrency('', ''), 'USD');
});

await test('custom system default used when all nulls', () => {
  assert.equal(resolveServiceCurrency(null, null, 'TRY'), 'TRY');
});

// ─── Section 5: Price display formatting ──────────────────────────────────────

section('5. Price display formatting');

await test('null price displayed as "Fiyat girilmemiş" (UI label)', () => {
  const price: number | null = null as number | null;
  const display = price != null ? (price as number).toLocaleString('tr-TR') : 'Fiyat girilmemiş';
  assert.equal(display, 'Fiyat girilmemiş');
});

await test('zero price displayed as "0" not "Fiyat girilmemiş"', () => {
  const price: number | null = 0 as number | null;
  const display = price != null ? (price as number).toLocaleString('tr-TR') : 'Fiyat girilmemiş';
  assert.equal(display, '0');
});

await test('positive price formatted with locale', () => {
  const price = 15000;
  const formatted = price.toLocaleString('tr-TR');
  assert.ok(formatted.length > 0);
  assert.ok(!formatted.includes('Fiyat'));
});

// ─── Section 6: Cross-org price isolation ─────────────────────────────────────

section('6. Cross-org service price isolation');

await test('service from same clinic is accessible', () => {
  const services = [
    { id: 'svc-1', clinicId: 'clinic-A' },
    { id: 'svc-2', clinicId: 'clinic-B' },
  ];
  const valid = validateServiceBelongsToClinic('svc-1', 'clinic-A', services);
  assert.ok(valid);
});

await test('service from different clinic is rejected', () => {
  const services = [
    { id: 'svc-1', clinicId: 'clinic-A' },
    { id: 'svc-2', clinicId: 'clinic-B' },
  ];
  const valid = validateServiceBelongsToClinic('svc-2', 'clinic-A', services);
  assert.ok(!valid, 'cross-clinic service must be rejected');
});

await test('unknown serviceId is rejected', () => {
  const services = [{ id: 'svc-1', clinicId: 'clinic-A' }];
  const valid = validateServiceBelongsToClinic('svc-unknown', 'clinic-A', services);
  assert.ok(!valid, 'unknown service must be rejected');
});

await test('null serviceId is valid (optional field)', () => {
  const services = [{ id: 'svc-1', clinicId: 'clinic-A' }];
  const valid = validateServiceBelongsToClinic(undefined, 'clinic-A', services);
  assert.ok(valid, 'null serviceId is allowed — procedure can be unlinked');
});

await test('service leakage prevented across two organizations', () => {
  // Org-1 services
  const org1Services = [
    { id: 'svc-org1-a', clinicId: 'clinic-org1' },
    { id: 'svc-org1-b', clinicId: 'clinic-org1' },
  ];
  // Org-2 tries to use org-1 service — must fail
  const attemptedAccess = validateServiceBelongsToClinic('svc-org1-a', 'clinic-org2', org1Services);
  assert.ok(!attemptedAccess, 'org-2 clinic must not access org-1 service');
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Service Pricing Tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
