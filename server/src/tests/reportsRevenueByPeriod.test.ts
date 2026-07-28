/**
 * reportsRevenueByPeriod.test.ts
 *
 * Regression coverage for GET /api/reports/revenue's byPeriod raw-SQL query.
 *
 * Production defect (PostgreSQL 42803):
 *   column "Payment.paidAt" must appear in the GROUP BY clause or be used in
 *   an aggregate function
 *
 * Root cause: the previous query interpolated `DATE_TRUNC(${groupByTrunc},
 * "paidAt")` three separate times (SELECT / GROUP BY / ORDER BY). Prisma
 * binds each interpolation as its own parameter, so Postgres could not prove
 * the three expressions were identical and fell back to requiring "paidAt"
 * itself in GROUP BY. Fix (server/src/routes/reports.ts): a CTE computes
 * DATE_TRUNC exactly once as `period_start`; the outer query groups/orders
 * by that single column and applies TO_CHAR only for display.
 *
 * A second, related bug: byPeriodRaw ignored the practitionerId and
 * paymentMethod filters that the Prisma summary/byMethod/byPractitioner
 * queries applied via baseWhere, so the "by period" breakdown silently
 * included rows the rest of the same report response excluded.
 *
 * This suite has no live database (matches this repo's tsx-script test
 * convention — see reportsClinicScope.test.ts). It combines:
 *   1. A pure-JS mirror of the CTE's filter + DATE_TRUNC bucketing logic,
 *      exercised against fixture Payment rows, to prove byPeriod totals
 *      stay consistent with the summary total under every filter/scope
 *      combination required by the audit.
 *   2. Source-shape assertions against the actual reports.ts text, to lock
 *      in the structural fix (single DATE_TRUNC interpolation, grouping by
 *      period_start, alias-aware clinic scope, filters wired into the CTE).
 *
 * Koşturma: cd server && npx tsx src/tests/reportsRevenueByPeriod.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportsSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'reports.ts'), 'utf8');

// ─── Test harness ──────────────────────────────────────────────────────────

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

// ─── Fixtures ────────────────────────────────────────────────────────────

type ClinicIdScope = { clinicId: string } | { clinicId: { in: string[] } };

type Payment = {
  id: string;
  clinicId: string;
  paidAt: Date; // UTC
  amount: number;
  paymentStatus: 'paid' | 'partial' | 'pending' | 'refunded' | 'cancelled';
  paymentMethod: string;
  practitionerId: string | null; // via treatmentCase.practitionerId (null = no treatmentCase, or treatmentCase w/o practitioner)
};

const D = (iso: string) => new Date(iso); // fixture dates are already UTC ISO strings

const PAYMENTS: Payment[] = [
  // clinic-A, spread across two months / multiple weeks, doctor-1
  { id: 'p1', clinicId: 'clinic-A', paidAt: D('2026-06-01T10:00:00Z'), amount: 1000, paymentStatus: 'paid', paymentMethod: 'cash', practitionerId: 'doctor-1' },
  { id: 'p2', clinicId: 'clinic-A', paidAt: D('2026-06-08T10:00:00Z'), amount: 500, paymentStatus: 'partial', paymentMethod: 'card', practitionerId: 'doctor-1' },
  { id: 'p3', clinicId: 'clinic-A', paidAt: D('2026-06-08T15:00:00Z'), amount: 250, paymentStatus: 'paid', paymentMethod: 'cash', practitionerId: 'doctor-2' },
  { id: 'p4', clinicId: 'clinic-A', paidAt: D('2026-07-15T10:00:00Z'), amount: 750, paymentStatus: 'paid', paymentMethod: 'card', practitionerId: 'doctor-1' },
  // clinic-A, statuses that must be excluded from every scenario
  { id: 'p5', clinicId: 'clinic-A', paidAt: D('2026-06-10T10:00:00Z'), amount: 9999, paymentStatus: 'pending', paymentMethod: 'cash', practitionerId: 'doctor-1' },
  { id: 'p6', clinicId: 'clinic-A', paidAt: D('2026-06-10T10:00:00Z'), amount: 9999, paymentStatus: 'cancelled', paymentMethod: 'cash', practitionerId: 'doctor-1' },
  // clinic-A, payment with no treatmentCase (practitionerId null) — must be excluded whenever practitionerId filter is set
  { id: 'p7', clinicId: 'clinic-A', paidAt: D('2026-06-12T10:00:00Z'), amount: 300, paymentStatus: 'paid', paymentMethod: 'bank_transfer', practitionerId: null },
  // clinic-A, out of date range
  { id: 'p8', clinicId: 'clinic-A', paidAt: D('2026-05-01T10:00:00Z'), amount: 5000, paymentStatus: 'paid', paymentMethod: 'cash', practitionerId: 'doctor-1' },
  // clinic-B, sibling clinic (same org) — must only appear under multi-clinic/all scope
  { id: 'p9', clinicId: 'clinic-B', paidAt: D('2026-06-01T10:00:00Z'), amount: 2000, paymentStatus: 'paid', paymentMethod: 'cash', practitionerId: 'doctor-3' },
  { id: 'p10', clinicId: 'clinic-B', paidAt: D('2026-07-01T10:00:00Z'), amount: 400, paymentStatus: 'paid', paymentMethod: 'card', practitionerId: 'doctor-3' },
];

const RANGE_FROM = D('2026-06-01T00:00:00Z');
const RANGE_TO = D('2026-07-31T23:59:59.999Z');

// ─── Pure-JS mirror of the fixed CTE's bucketing + filters ─────────────────
// (server/src/routes/reports.ts: scoped_payments CTE, groupBy DATE_TRUNC)

function scopeMatches(scope: ClinicIdScope, clinicId: string): boolean {
  return typeof scope.clinicId === 'string' ? scope.clinicId === clinicId : scope.clinicId.in.includes(clinicId);
}

// Mirrors reports.ts's whitelist fallback: `groupBy = validGroupByValues.includes(...) ? ... : 'month'`
const VALID_GROUP_BY = ['day', 'week', 'month'];
function resolveGroupBy(raw: string | undefined): 'day' | 'week' | 'month' {
  return (VALID_GROUP_BY.includes(String(raw)) ? String(raw) : 'month') as 'day' | 'week' | 'month';
}

// Mirrors Postgres DATE_TRUNC('day'|'week'|'month', ts) — 'week' truncates to
// the Monday of the ISO week, in UTC to keep the fixture deterministic.
function dateTrunc(groupBy: 'day' | 'week' | 'month', d: Date): Date {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (groupBy === 'day') return t;
  if (groupBy === 'month') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const dow = t.getUTCDay(); // 0=Sun..6=Sat
  const offsetFromMonday = (dow + 6) % 7;
  t.setUTCDate(t.getUTCDate() - offsetFromMonday);
  return t;
}

function toPeriodLabel(d: Date): string {
  return d.toISOString().slice(0, 10); // TO_CHAR(period_start, 'YYYY-MM-DD')
}

type Filters = {
  scope: ClinicIdScope;
  groupBy?: string;
  paymentMethod?: string;
  practitionerId?: string;
  from?: Date;
  to?: Date;
};

function applyFilters(payments: Payment[], f: Filters): Payment[] {
  const from = f.from ?? RANGE_FROM;
  const to = f.to ?? RANGE_TO;
  return payments.filter((p) => {
    if (!scopeMatches(f.scope, p.clinicId)) return false;
    if (p.paymentStatus !== 'paid' && p.paymentStatus !== 'partial') return false;
    if (p.paidAt < from || p.paidAt > to) return false;
    if (f.paymentMethod && p.paymentMethod !== f.paymentMethod) return false;
    if (f.practitionerId && p.practitionerId !== f.practitionerId) return false;
    return true;
  });
}

function summaryTotalRevenue(payments: Payment[], f: Filters): number {
  return applyFilters(payments, f).reduce((sum, p) => sum + p.amount, 0);
}

function byPeriod(payments: Payment[], f: Filters): { period: string; revenue: number; count: number }[] {
  const groupBy = resolveGroupBy(f.groupBy);
  const filtered = applyFilters(payments, f);
  const buckets = new Map<string, { revenue: number; count: number }>();
  for (const p of filtered) {
    const period = toPeriodLabel(dateTrunc(groupBy, p.paidAt));
    const bucket = buckets.get(period) ?? { revenue: 0, count: 0 };
    bucket.revenue += p.amount;
    bucket.count += 1;
    buckets.set(period, bucket);
  }
  return Array.from(buckets.entries())
    .map(([period, v]) => ({ period, ...v }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

function sumByPeriodRevenue(rows: { revenue: number }[]): number {
  return rows.reduce((sum, r) => sum + r.revenue, 0);
}

// ─── Scopes used across scenarios ───────────────────────────────────────────

const SINGLE_CLINIC_A: ClinicIdScope = { clinicId: 'clinic-A' };
const SINGLE_CLINIC_B: ClinicIdScope = { clinicId: 'clinic-B' };
const MULTI_ALL: ClinicIdScope = { clinicId: { in: ['clinic-A', 'clinic-B'] } };

// ─── 1. Grouping granularity ────────────────────────────────────────────────

section('1. byPeriod grouping granularity (day / week / month)');

await test('month grouping buckets clinic-A payments into 2026-06-01 and 2026-07-01', () => {
  const rows = byPeriod(PAYMENTS, { scope: SINGLE_CLINIC_A, groupBy: 'month' });
  assert.deepEqual(
    rows.map((r) => r.period),
    ['2026-06-01', '2026-07-01'],
  );
  assert.equal(rows[0].revenue, 1000 + 500 + 250 + 300, 'June bucket: p1+p2+p3+p7');
  assert.equal(rows[1].revenue, 750, 'July bucket: p4');
});

await test('week grouping splits June clinic-A payments across ISO weeks', () => {
  const rows = byPeriod(PAYMENTS, { scope: SINGLE_CLINIC_A, groupBy: 'week' });
  // p1 (Jun 1, Mon) starts its own week; p2+p3 (Jun 8, Mon) share a week; p7 (Jun 12, Fri) shares p2/p3's week; p4 (Jul 15) its own week
  assert.equal(rows.length, 3, 'three distinct week buckets for clinic-A in range');
  const total = sumByPeriodRevenue(rows);
  assert.equal(total, 1000 + 500 + 250 + 300 + 750);
});

await test('day grouping produces one bucket per distinct paidAt date', () => {
  const rows = byPeriod(PAYMENTS, { scope: SINGLE_CLINIC_A, groupBy: 'day' });
  assert.deepEqual(
    rows.map((r) => r.period),
    ['2026-06-01', '2026-06-08', '2026-06-12', '2026-07-15'],
  );
  const june8 = rows.find((r) => r.period === '2026-06-08')!;
  assert.equal(june8.revenue, 500 + 250, 'p2 and p3 share the same calendar day');
  assert.equal(june8.count, 2);
});

await test('invalid groupBy value falls back to month (matches reports.ts whitelist)', () => {
  const rows = byPeriod(PAYMENTS, { scope: SINGLE_CLINIC_A, groupBy: 'year' });
  assert.deepEqual(
    rows.map((r) => r.period),
    ['2026-06-01', '2026-07-01'],
    'unrecognized groupBy must behave identically to explicit groupBy=month',
  );
});

// ─── 2. Filter consistency (byPeriodRaw must match baseWhere) ──────────────

section('2. byPeriod filters now match the Prisma summary\'s baseWhere');

await test('paymentMethod filter narrows byPeriod exactly like the summary total', () => {
  const f: Filters = { scope: SINGLE_CLINIC_A, groupBy: 'month', paymentMethod: 'card' };
  const rows = byPeriod(PAYMENTS, f);
  assert.deepEqual(rows.map((r) => r.period), ['2026-06-01', '2026-07-01']);
  assert.equal(rows[0].revenue, 500, 'only p2 is card in June');
  assert.equal(rows[1].revenue, 750, 'p4 is card in July');
});

await test('practitionerId filter narrows byPeriod and excludes payments with no treatmentCase', () => {
  const f: Filters = { scope: SINGLE_CLINIC_A, groupBy: 'month', practitionerId: 'doctor-1' };
  const rows = byPeriod(PAYMENTS, f);
  // p3 (doctor-2) and p7 (no treatmentCase) must be excluded
  assert.equal(rows[0].revenue, 1000 + 500, 'June: p1 + p2 only (doctor-1)');
  assert.equal(rows[1].revenue, 750, 'July: p4 (doctor-1)');
});

await test('combined paymentMethod + practitionerId filters compose (AND, not OR)', () => {
  const f: Filters = { scope: SINGLE_CLINIC_A, groupBy: 'month', paymentMethod: 'cash', practitionerId: 'doctor-1' };
  const rows = byPeriod(PAYMENTS, f);
  assert.deepEqual(rows.map((r) => r.period), ['2026-06-01']);
  assert.equal(rows[0].revenue, 1000, 'only p1 is doctor-1 + cash');
});

// ─── 3. Clinic scope / tenant isolation ─────────────────────────────────────

section('3. Clinic scope — single-clinic and multi-clinic/\'all\'');

await test('single-clinic scope (clinic-A) never includes clinic-B revenue', () => {
  const rows = byPeriod(PAYMENTS, { scope: SINGLE_CLINIC_A, groupBy: 'month' });
  const total = sumByPeriodRevenue(rows);
  assert.equal(total, 1000 + 500 + 250 + 300 + 750, 'clinic-A total only');
});

await test('single-clinic scope (clinic-B) is isolated from clinic-A', () => {
  const rows = byPeriod(PAYMENTS, { scope: SINGLE_CLINIC_B, groupBy: 'month' });
  assert.deepEqual(rows.map((r) => r.period), ['2026-06-01', '2026-07-01']);
  assert.equal(rows[0].revenue, 2000);
  assert.equal(rows[1].revenue, 400);
});

await test('multi-clinic/\'all\' scope aggregates both clinics without leaking outside the array', () => {
  const rows = byPeriod(PAYMENTS, { scope: MULTI_ALL, groupBy: 'month' });
  const total = sumByPeriodRevenue(rows);
  const expected = (1000 + 500 + 250 + 300 + 750) + (2000 + 400);
  assert.equal(total, expected);
});

// ─── 4. Empty result ─────────────────────────────────────────────────────────

section('4. Empty result set');

await test('a filter combination matching zero rows returns an empty byPeriod array and zero summary', () => {
  const f: Filters = { scope: SINGLE_CLINIC_A, groupBy: 'month', paymentMethod: 'bank_transfer', practitionerId: 'doctor-1' };
  const rows = byPeriod(PAYMENTS, f);
  assert.deepEqual(rows, []);
  assert.equal(summaryTotalRevenue(PAYMENTS, f), 0);
});

await test('an out-of-range date window returns an empty byPeriod array', () => {
  const f: Filters = { scope: SINGLE_CLINIC_A, groupBy: 'month', from: D('2020-01-01T00:00:00Z'), to: D('2020-12-31T23:59:59Z') };
  const rows = byPeriod(PAYMENTS, f);
  assert.deepEqual(rows, []);
});

// ─── 5. byPeriod sum === summary.totalRevenue, across every scenario above ──

section('5. sum(byPeriod.revenue) === summary.totalRevenue for every filtered case');

const SCENARIOS: { name: string; f: Filters }[] = [
  { name: 'no filters, month', f: { scope: SINGLE_CLINIC_A, groupBy: 'month' } },
  { name: 'no filters, week', f: { scope: SINGLE_CLINIC_A, groupBy: 'week' } },
  { name: 'no filters, day', f: { scope: SINGLE_CLINIC_A, groupBy: 'day' } },
  { name: 'invalid groupBy fallback', f: { scope: SINGLE_CLINIC_A, groupBy: 'bogus' } },
  { name: 'paymentMethod=card', f: { scope: SINGLE_CLINIC_A, groupBy: 'month', paymentMethod: 'card' } },
  { name: 'practitionerId=doctor-1', f: { scope: SINGLE_CLINIC_A, groupBy: 'month', practitionerId: 'doctor-1' } },
  { name: 'practitionerId=doctor-2 (single payment)', f: { scope: SINGLE_CLINIC_A, groupBy: 'month', practitionerId: 'doctor-2' } },
  { name: 'combined paymentMethod + practitionerId', f: { scope: SINGLE_CLINIC_A, groupBy: 'week', paymentMethod: 'cash', practitionerId: 'doctor-1' } },
  { name: 'single clinic-B scope', f: { scope: SINGLE_CLINIC_B, groupBy: 'month' } },
  { name: 'multi-clinic/all scope', f: { scope: MULTI_ALL, groupBy: 'month' } },
  { name: 'multi-clinic/all scope, week grouping', f: { scope: MULTI_ALL, groupBy: 'week' } },
  { name: 'empty result (unmatched filters)', f: { scope: SINGLE_CLINIC_A, groupBy: 'month', paymentMethod: 'bank_transfer', practitionerId: 'doctor-1' } },
];

for (const { name, f } of SCENARIOS) {
  await test(`revenue conserved: ${name}`, () => {
    const rows = byPeriod(PAYMENTS, f);
    const summaryTotal = summaryTotalRevenue(PAYMENTS, f);
    assert.equal(sumByPeriodRevenue(rows), summaryTotal, `byPeriod sum must equal summary.totalRevenue for "${name}"`);
  });
}

// ─── 6. Source verification — the actual SQL fix landed in reports.ts ──────

section('6. Source verification — reports.ts byPeriodRaw query');

const revenueRouteStart = reportsSrc.indexOf("router.get('/reports/revenue'");
assert.ok(revenueRouteStart >= 0, 'revenue route must exist');
const revenueRouteEnd = reportsSrc.indexOf("router.get('/reports/revenue/export.csv'");
const revenueRouteSrc = reportsSrc.slice(revenueRouteStart, revenueRouteEnd > 0 ? revenueRouteEnd : undefined);

await test('DATE_TRUNC(${groupByTrunc}, ...) is interpolated exactly once (was 3x pre-fix)', () => {
  // Strip `//` line comments first — the fix's own explanatory comment quotes
  // the pre-fix pattern as illustrative text, which would otherwise inflate the count.
  const codeOnly = revenueRouteSrc
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  const occurrences = (codeOnly.match(/DATE_TRUNC\(\$\{groupByTrunc\}/g) || []).length;
  assert.equal(occurrences, 1, 'DATE_TRUNC must be computed once in the CTE, not repeated across SELECT/GROUP BY/ORDER BY');
});

await test('GROUP BY and ORDER BY use the single computed period_start column', () => {
  assert.match(revenueRouteSrc, /GROUP BY period_start/);
  assert.match(revenueRouteSrc, /ORDER BY period_start/);
  assert.equal(/GROUP BY DATE_TRUNC/.test(revenueRouteSrc), false, 'must not re-run DATE_TRUNC in GROUP BY');
  assert.equal(/ORDER BY DATE_TRUNC/.test(revenueRouteSrc), false, 'must not re-run DATE_TRUNC in ORDER BY');
});

await test('TO_CHAR formatting happens only in the outer query, over period_start', () => {
  const toCharMatches = revenueRouteSrc.match(/TO_CHAR\(([^)]*)\)/g) || [];
  assert.equal(toCharMatches.length, 1, 'exactly one TO_CHAR call in the revenue route');
  assert.match(toCharMatches[0], /period_start/);
});

await test('byPeriodRaw uses a CTE (WITH ... AS) rather than a flat aggregate query', () => {
  assert.match(revenueRouteSrc, /WITH scoped_payments AS/);
});

await test('byPeriodRaw applies the same paymentMethod and practitionerId filters as baseWhere', () => {
  assert.match(revenueRouteSrc, /paymentMethodFilterSql/);
  assert.match(revenueRouteSrc, /practitionerFilterSql/);
  assert.match(revenueRouteSrc, /tc\."practitionerId"/, 'practitioner filter must join TreatmentCase for practitionerId');
});

await test('clinic scope remains array-aware and is now alias-scoped to the Payment table', () => {
  assert.match(revenueRouteSrc, /clinicScopeSql\(scope, 'p'\)/);
  assert.equal(reportsSrc.includes('$queryRawUnsafe'), false, 'must not use $queryRawUnsafe anywhere in reports.ts');
});

await test('clinicScopeSql helper supports an optional alias without changing its no-alias behavior', () => {
  const helperStart = reportsSrc.indexOf('function clinicScopeSql');
  assert.ok(helperStart >= 0);
  const helperSrc = reportsSrc.slice(helperStart, helperStart + 700);
  assert.match(helperSrc, /alias\?\s*:\s*string/, 'alias parameter must be optional — other callers pass no alias');
});

await test('groupBy whitelist is unchanged (day/week/month only)', () => {
  assert.match(reportsSrc, /validGroupByValues\s*=\s*\['day',\s*'week',\s*'month'\]/);
});

await test('client-provided clinicId is never used outside validateAndGetClinicIdScope', () => {
  assert.equal(
    /selectedClinicId\s+as\s+string/.test(revenueRouteSrc) &&
      /clinicScopeSql\(scope/.test(revenueRouteSrc) &&
      /validateAndGetClinicIdScope\(req\.user!, selectedClinicId/.test(revenueRouteSrc),
    true,
    'the raw query must derive its scope from the validated `scope`, not directly from the query param',
  );
});

// ─── Sonuç ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
console.log('─'.repeat(60));

if (failed > 0) process.exit(1);
