/**
 * reportExportFoundation.test.ts — US-07.3-P1 central report-export foundation.
 *
 * No live database (matches this repo's tsx-script test convention — see
 * reportsRevenueByPeriod.test.ts / reportsClinicScope.test.ts). Combines:
 *   1. Direct unit tests of every pure function in services/reportExport/*
 *      (role check, filter parsing, row limit, formula-injection,
 *      filename sanitization, audit classification/decision).
 *   2. Functional XLSX/PDF generation tests — real ExcelJS/pdfkit buffers are
 *      built and (for XLSX) read back to assert real cell types/values.
 *   3. Source-shape assertions proving the route/registry REUSE the same
 *      production primitives the JSON report route uses (validateAndGetClinicIdScope,
 *      getRevenueByPeriodRows, the same allowedRoles array) rather than
 *      re-implementing or diverging from them — this is how tenant isolation
 *      and filter-consistency are proven without a live database.
 *
 * Koşturma: cd server && npx tsx src/tests/reportExportFoundation.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

import { revenueByPeriodDefinition, getReportDefinition, REPORT_DEFINITIONS } from '../services/reportExport/registry.js';
import { isRoleAllowedForReport } from '../services/reportExport/roleCheck.js';
import { exceedsSyncRowLimit } from '../services/reportExport/rowLimit.js';
import { buildReportExportFilename } from '../services/reportExport/filenameSafety.js';
import { buildReportExportWorkbookBuffer } from '../services/reportExport/xlsxBuilder.js';
import { buildReportExportPdfBuffer } from '../services/reportExport/pdfBuilder.js';
import { shouldAuditReportExport } from '../services/reportExport/auditDecision.js';
import { resolveReportExportAuditScope } from '../services/reportExport/auditScope.js';
import { neutralizeFormulaInjection, isFormulaInjectionCandidate } from '../services/reportExport/formulaSafety.js';
import { dateNumFmtFor, datetimeNumFmtFor } from '../services/reportExport/dateNumberFormat.js';
import { EXPORT_METADATA_STRINGS } from '../services/reportExport/exportStrings.js';
import type { ReportColumnDefinition } from '../services/reportExport/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportsSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'reports.ts'), 'utf8');
const reportExportRouteSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'reportExport.ts'), 'utf8');
const registrySrc = fs.readFileSync(path.join(__dirname, '..', 'services', 'reportExport', 'registry.ts'), 'utf8');
const auditScopeSrc = fs.readFileSync(path.join(__dirname, '..', 'services', 'reportExport', 'auditScope.ts'), 'utf8');
const auditDecisionSrc = fs.readFileSync(path.join(__dirname, '..', 'services', 'reportExport', 'auditDecision.ts'), 'utf8');

// ─── Test harness (matches reportsRevenueByPeriod.test.ts / reportsClinicScope.test.ts) ─

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

// ─── 1. Registry contract ───────────────────────────────────────────────────

section('1. Registry contract — revenue-by-period pilot definition');

await test('the pilot report key is registered and resolvable via the allow-list lookup', () => {
  assert.equal(getReportDefinition('revenue-by-period'), revenueByPeriodDefinition);
});

await test('an unknown report key resolves to undefined (never falls back to a default report)', () => {
  assert.equal(getReportDefinition('patients-detail'), undefined);
  assert.equal(getReportDefinition('__proto__'), undefined);
  assert.equal(getReportDefinition(''), undefined);
});

await test('the registry never registers a patient-detail or PII-heavy report key in this phase', () => {
  const keys = Object.keys(REPORT_DEFINITIONS);
  assert.deepEqual(keys, ['revenue-by-period']);
});

await test('the pilot is classified non-PII (aggregate period/revenue/count rows only)', () => {
  assert.equal(revenueByPeriodDefinition.pii, false);
});

await test('maxSyncRows is a conservative, finite, positive bound', () => {
  assert.ok(revenueByPeriodDefinition.maxSyncRows > 0);
  assert.ok(revenueByPeriodDefinition.maxSyncRows <= 10_000);
});

await test('columns cover date, currency, and number types (the type-handling contract)', () => {
  const types = revenueByPeriodDefinition.columns.map((c) => c.type).sort();
  assert.deepEqual(types, ['currency', 'date', 'number']);
});

await test('every column has a header for all 4 supported locales', () => {
  for (const col of revenueByPeriodDefinition.columns) {
    for (const locale of ['tr', 'en', 'fr', 'de'] as const) {
      assert.equal(typeof col.header[locale], 'string');
      assert.ok(col.header[locale].length > 0, `${col.key}.${locale} must not be empty`);
    }
  }
});

await test('the report title is localized for all 4 supported locales', () => {
  for (const locale of ['tr', 'en', 'fr', 'de'] as const) {
    assert.ok(revenueByPeriodDefinition.title[locale]?.length > 0);
  }
});

// ─── 2. Role authorization — must match the source report exactly ──────────

section('2. Role authorization matches GET /api/reports/revenue exactly');

await test('allowedRoles is IDENTICAL (same array) to the authorize([...]) list on the source JSON route', () => {
  const match = /router\.get\('\/reports\/revenue',\s*authorize\(\[([^\]]+)\]\)/.exec(reportsSrc);
  assert.ok(match, 'source /reports/revenue route with authorize([...]) must be found');
  const sourceRoles = match![1].split(',').map((s) => s.trim().replace(/['"]/g, ''));
  assert.deepEqual([...revenueByPeriodDefinition.allowedRoles].sort(), [...sourceRoles].sort());
});

const OWNER_USER = { role: 'owner', canAccessAllClinics: true };
const BILLING_USER = { role: 'billing', canAccessAllClinics: false };
const DENTIST_USER = { role: 'dentist', canAccessAllClinics: false };
const RECEPTIONIST_USER = { role: 'receptionist', canAccessAllClinics: false };
const LEGACY_ADMIN_ORGWIDE = { role: 'admin', canAccessAllClinics: true }; // canonical -> OWNER
const LEGACY_ADMIN_CLINIC = { role: 'admin', canAccessAllClinics: false }; // canonical -> CLINIC_MANAGER

await test('OWNER can export the pilot report', () => {
  assert.equal(isRoleAllowedForReport(OWNER_USER, revenueByPeriodDefinition.allowedRoles), true);
});

await test('BILLING can export the pilot report', () => {
  assert.equal(isRoleAllowedForReport(BILLING_USER, revenueByPeriodDefinition.allowedRoles), true);
});

await test('a role not in the allow-list (DENTIST) cannot export the pilot report', () => {
  assert.equal(isRoleAllowedForReport(DENTIST_USER, revenueByPeriodDefinition.allowedRoles), false);
});

await test('a role not in the allow-list (RECEPTIONIST) cannot export the pilot report', () => {
  assert.equal(isRoleAllowedForReport(RECEPTIONIST_USER, revenueByPeriodDefinition.allowedRoles), false);
});

await test('legacy "admin" role resolves via the same canonical-role mapping as authorize() (org-wide -> OWNER, allowed)', () => {
  assert.equal(isRoleAllowedForReport(LEGACY_ADMIN_ORGWIDE, revenueByPeriodDefinition.allowedRoles), true);
});

await test('legacy "admin" role resolves via the same canonical-role mapping as authorize() (single-clinic -> CLINIC_MANAGER, allowed)', () => {
  assert.equal(isRoleAllowedForReport(LEGACY_ADMIN_CLINIC, revenueByPeriodDefinition.allowedRoles), true);
});

await test('the export route never grants a superset of the source report\'s roles — no hardcoded broader role list in the route itself', () => {
  assert.equal(/authorize\(/.test(reportExportRouteSrc), false, 'the export route must not define its own static role list');
  assert.match(reportExportRouteSrc, /isRoleAllowedForReport\(user, definition\.allowedRoles\)/);
});

// ─── 3. Filter parsing / consistency with the source report ───────────────

section('3. Filter validation is identical to GET /api/reports/revenue');

await test('missing dateFrom/dateTo is rejected as invalid filters', () => {
  const result = revenueByPeriodDefinition.parseFilters({});
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

await test('an unparseable date string is rejected as invalid filters', () => {
  const result = revenueByPeriodDefinition.parseFilters({ dateFrom: 'not-a-date', dateTo: '2026-01-31' });
  assert.equal(result.ok, false);
});

await test('a valid date range parses successfully with dateTo inclusive of the whole day (23:59:59.999) — same local-time setHours() semantics as reports.ts', () => {
  const result = revenueByPeriodDefinition.parseFilters({ dateFrom: '2026-06-01', dateTo: '2026-06-30' });
  assert.equal(result.ok, true);
  // Mirrors reports.ts's `to.setHours(23, 59, 59, 999)` exactly (local time,
  // not UTC) — asserting local getters here keeps this test timezone-agnostic.
  assert.equal(result.filters!.dateTo.getHours(), 23);
  assert.equal(result.filters!.dateTo.getMinutes(), 59);
});

await test('an invalid groupBy value silently falls back to "month" — same whitelist-with-fallback behavior as the JSON route (not rejected)', () => {
  const result = revenueByPeriodDefinition.parseFilters({ dateFrom: '2026-06-01', dateTo: '2026-06-30', groupBy: 'year' });
  assert.equal(result.ok, true);
  assert.equal(result.filters!.groupBy, 'month');
});

await test('day/week/month groupBy values pass through unchanged', () => {
  for (const gb of ['day', 'week', 'month']) {
    const result = revenueByPeriodDefinition.parseFilters({ dateFrom: '2026-06-01', dateTo: '2026-06-30', groupBy: gb });
    assert.equal(result.filters!.groupBy, gb);
  }
});

await test('practitionerId and paymentMethod are optional and pass through as provided', () => {
  const result = revenueByPeriodDefinition.parseFilters({
    dateFrom: '2026-06-01', dateTo: '2026-06-30', practitionerId: 'doctor-1', paymentMethod: 'cash',
  });
  assert.equal(result.filters!.practitionerId, 'doctor-1');
  assert.equal(result.filters!.paymentMethod, 'cash');
});

await test('filterSummary never includes patient/practitioner NAMES — only ids/enum values/dates (safe for AuditLog + XLSX metadata)', () => {
  const result = revenueByPeriodDefinition.parseFilters({
    dateFrom: '2026-06-01', dateTo: '2026-06-30', practitionerId: 'doctor-1', paymentMethod: 'cash',
  });
  const summary = revenueByPeriodDefinition.filterSummary(result.filters!);
  assert.deepEqual(Object.keys(summary).sort(), ['dateFrom', 'dateTo', 'groupBy', 'paymentMethod', 'practitionerId']);
  // Every individual value must be a single date/enum/id token — never a
  // multi-word (space-containing) string, which is the shape a real person's
  // name would take (e.g. "Ada Yilmaz").
  for (const [key, value] of Object.entries(summary)) {
    assert.equal(value.includes(' '), false, `${key}="${value}" must not contain a space`);
  }
});

await test('the export loader delegates to the SAME shared data loader the JSON route uses (getRevenueByPeriodRows) — never a second copy', () => {
  assert.match(registrySrc, /import\s*\{\s*\n?\s*getRevenueByPeriodRows/);
  assert.match(registrySrc, /from '\.\.\/reports\/revenueByPeriodQuery\.js'/);
  assert.match(reportsSrc, /from '\.\.\/services\/reports\/revenueByPeriodQuery\.js'/);
});

await test('loadRows forwards the bounded `limit` param through to the shared loader (never fetches unbounded rows)', () => {
  const loadRowsStart = registrySrc.indexOf('async loadRows(');
  assert.ok(loadRowsStart >= 0);
  const loadRowsSrc = registrySrc.slice(loadRowsStart, loadRowsStart + 400);
  assert.match(loadRowsSrc, /limit,/);
});

// ─── 4. Tenant isolation / clinic scope reuse ───────────────────────────────

section('4. Tenant isolation reuses the exact same primitive as the source report');

await test('the export route resolves clinic scope via validateAndGetClinicIdScope — the SAME function reports.ts uses (never a re-implementation)', () => {
  assert.match(reportExportRouteSrc, /import \{ validateAndGetClinicIdScope \} from '\.\.\/utils\/clinicScope\.js'/);
  assert.match(reportExportRouteSrc, /validateAndGetClinicIdScope\(user, selectedClinicId, res\)/);
  assert.match(reportsSrc, /validateAndGetClinicIdScope\(req\.user!, selectedClinicId as string \| undefined, res\)/);
});

await test('the export route never trusts req.user.clinicId as an authorization boundary — it only uses the resolved `scope`', () => {
  const scopeCallIdx = reportExportRouteSrc.indexOf('validateAndGetClinicIdScope(');
  const beforeScope = reportExportRouteSrc.slice(0, scopeCallIdx);
  assert.equal(/loadRows\(/.test(beforeScope), false, 'rows must never be loaded before the clinic scope is validated');
});

await test('a denied clinic scope returns before any row loading or file generation happens', () => {
  assert.match(reportExportRouteSrc, /if \(scope === false\) return;/);
});

await test('a denied clinic scope returns before the audit scope is even resolved (no audit generation for a rejected request)', () => {
  const scopeCheckIdx = reportExportRouteSrc.indexOf('if (scope === false) return;');
  const auditScopeIdx = reportExportRouteSrc.indexOf('resolveReportExportAuditScope(');
  assert.ok(scopeCheckIdx >= 0 && auditScopeIdx >= 0);
  assert.ok(scopeCheckIdx < auditScopeIdx, 'the scope-denied early return must precede audit-scope resolution');
});

// ─── 5. Synchronous row limit — enforced without truncation ────────────────

section('5. Synchronous row-limit enforcement (no silent truncation)');

await test('exactly at the limit is allowed', () => {
  assert.equal(exceedsSyncRowLimit(2000, 2000), false);
});

await test('one row over the limit is rejected', () => {
  assert.equal(exceedsSyncRowLimit(2001, 2000), true);
});

await test('the route rejects with ROW_LIMIT_EXCEEDED and returns BEFORE building any file — it never slices `rows` down to maxSyncRows first', () => {
  const limitCheckIdx = reportExportRouteSrc.indexOf('exceedsSyncRowLimit(');
  assert.ok(limitCheckIdx >= 0);
  const branchSrc = reportExportRouteSrc.slice(limitCheckIdx, limitCheckIdx + 400);
  assert.match(branchSrc, /ROW_LIMIT_EXCEEDED/);
  assert.equal(/rows\.slice|rows\.length = /.test(branchSrc), false, 'must reject, never truncate the row array');
});

await test('loadRows is always called with limit = maxSyncRows + 1, so the loader itself never has to load unbounded rows', () => {
  assert.match(reportExportRouteSrc, /limit:\s*definition\.maxSyncRows \+ 1/);
});

// ─── 6. Unsupported report key / format / invalid filters — stable errors ──

section('6. Stable error codes for unsupported report/format/filters');

await test('an unsupported report key yields UNSUPPORTED_REPORT before any auth/filter logic runs', () => {
  assert.match(reportExportRouteSrc, /if \(!definition\) \{[\s\S]{0,200}UNSUPPORTED_REPORT/);
});

await test('an unsupported format yields UNSUPPORTED_FORMAT', () => {
  assert.match(reportExportRouteSrc, /UNSUPPORTED_FORMAT/);
  assert.match(reportExportRouteSrc, /SUPPORTED_EXPORT_FORMATS\.includes/);
});

await test('invalid filters yield INVALID_FILTERS with the parser\'s message, not a generic 500', () => {
  assert.match(reportExportRouteSrc, /INVALID_FILTERS/);
  assert.match(reportExportRouteSrc, /parsed\.error \?\? 'Invalid filters'/);
});

await test('error responses are flat (error + message[+ maxRows]) — never a nested/non-renderable object', () => {
  const jsonCalls = reportExportRouteSrc.match(/res\.status\(\d+\)\.json\(\{[^}]*\}\)/g) || [];
  assert.ok(jsonCalls.length >= 5);
  for (const call of jsonCalls) {
    assert.equal(/\{\s*[a-zA-Z]+:\s*\{/.test(call), false, `error body must be flat: ${call}`);
  }
});

// ─── 7. XLSX generation — cell types, currency/date formats, localized headers ─

section('7. XLSX generation — column type contract');

const FIXTURE_ROWS = [
  { period: '2026-06-01', revenue: 1750.5, count: 3 },
  { period: '2026-07-01', revenue: 400, count: 1 },
];

async function buildFixtureWorkbook(locale: 'tr' | 'en' | 'fr' | 'de' = 'en') {
  const buffer = await buildReportExportWorkbookBuffer({
    locale,
    title: revenueByPeriodDefinition.title[locale],
    columns: revenueByPeriodDefinition.columns,
    rows: FIXTURE_ROWS,
    toColumnValues: revenueByPeriodDefinition.toColumnValues,
    currency: 'TRY',
    generatedAt: new Date('2026-08-03T10:00:00.000Z'),
    clinicDateFormat: 'dd.MM.yyyy',
    filterSummary: { dateFrom: '2026-06-01', dateTo: '2026-07-31', groupBy: 'month' },
    strings: EXPORT_METADATA_STRINGS[locale],
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  return { buffer, sheet: wb.worksheets[0] };
}

function findHeaderRowNumber(sheet: ExcelJS.Worksheet, headerText: string): number {
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (row.values && (row.values as unknown[]).includes(headerText)) return r;
  }
  return -1;
}

await test('currency column cells are real numeric cells, not strings', async () => {
  const { sheet } = await buildFixtureWorkbook('en');
  const headerRow = findHeaderRowNumber(sheet, 'Revenue');
  assert.ok(headerRow > 0);
  const revenueColIdx = revenueByPeriodDefinition.columns.findIndex((c) => c.key === 'revenue') + 1;
  const cell = sheet.getRow(headerRow + 1).getCell(revenueColIdx);
  assert.equal(typeof cell.value, 'number');
  assert.equal(cell.value, 1750.5);
  assert.match(String(cell.numFmt), /TRY/);
});

await test('number column cells are real numeric cells with a plain number format', async () => {
  const { sheet } = await buildFixtureWorkbook('en');
  const headerRow = findHeaderRowNumber(sheet, 'Payment Count');
  const countColIdx = revenueByPeriodDefinition.columns.findIndex((c) => c.key === 'count') + 1;
  const cell = sheet.getRow(headerRow + 1).getCell(countColIdx);
  assert.equal(typeof cell.value, 'number');
  assert.equal(cell.value, 3);
});

await test('date column cells are real Date values, formatted per the clinic date-format preference', async () => {
  const { sheet } = await buildFixtureWorkbook('en');
  const headerRow = findHeaderRowNumber(sheet, 'Period');
  const periodColIdx = revenueByPeriodDefinition.columns.findIndex((c) => c.key === 'period') + 1;
  const cell = sheet.getRow(headerRow + 1).getCell(periodColIdx);
  assert.ok(cell.value instanceof Date, 'date column must hold a real Date value, not a string');
  assert.equal((cell.value as Date).toISOString().slice(0, 10), '2026-06-01');
  assert.equal(cell.numFmt, 'dd.mm.yyyy'); // dd.MM.yyyy clinic preference
});

await test('localized column headers switch correctly across all 4 supported locales', async () => {
  const { sheet: trSheet } = await buildFixtureWorkbook('tr');
  assert.ok(findHeaderRowNumber(trSheet, 'Dönem') > 0);
  assert.ok(findHeaderRowNumber(trSheet, 'Gelir') > 0);

  const { sheet: frSheet } = await buildFixtureWorkbook('fr');
  assert.ok(findHeaderRowNumber(frSheet, 'Période') > 0);

  const { sheet: deSheet } = await buildFixtureWorkbook('de');
  assert.ok(findHeaderRowNumber(deSheet, 'Zeitraum') > 0);
});

await test('the metadata section includes "Generated at" / "Applied filters" (localized) above the data table', async () => {
  const { sheet } = await buildFixtureWorkbook('en');
  const firstColValues: string[] = [];
  for (let r = 1; r <= 4; r++) firstColValues.push(String(sheet.getRow(r).getCell(1).value ?? ''));
  assert.ok(firstColValues.some((v) => v.includes('Generated at')));
  assert.ok(firstColValues.some((v) => v.includes('Applied filters')));
});

section('8. Spreadsheet formula-injection neutralization (generic column-type contract)');

await test('isFormulaInjectionCandidate flags every OWASP-listed trigger character', () => {
  for (const bad of ['=SUM(A1)', '+CMD', '-1+1', '@import']) {
    assert.equal(isFormulaInjectionCandidate(bad), true, bad);
  }
  assert.equal(isFormulaInjectionCandidate('normal text'), false);
});

await test('neutralizeFormulaInjection prefixes a leading apostrophe only for trigger characters', () => {
  assert.equal(neutralizeFormulaInjection('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(neutralizeFormulaInjection('+1-2'), "'+1-2");
  assert.equal(neutralizeFormulaInjection('-100'), "'-100");
  assert.equal(neutralizeFormulaInjection('@user'), "'@user");
  assert.equal(neutralizeFormulaInjection('safe text'), 'safe text');
});

const HOSTILE_TEXT_COLUMNS: ReportColumnDefinition[] = [
  { key: 'label', type: 'text', header: { en: 'Label', tr: 'Etiket', fr: 'Étiquette', de: 'Bezeichnung' } },
  { key: 'amount', type: 'number', header: { en: 'Amount', tr: 'Tutar', fr: 'Montant', de: 'Betrag' } },
];

await test('a hostile TEXT cell beginning with =, +, -, or @ is neutralized in the generated XLSX', async () => {
  const hostileRows = [
    { label: '=cmd|"/c calc"!A1', amount: -5 },
    { label: '+1+1', amount: 10 },
    { label: '-rm -rf /', amount: 0 },
    { label: '@SUM(1,2)', amount: 1 },
  ];
  const buffer = await buildReportExportWorkbookBuffer({
    locale: 'en',
    title: 'Injection test',
    columns: HOSTILE_TEXT_COLUMNS,
    rows: hostileRows,
    toColumnValues: (r: any) => r,
    currency: 'USD',
    generatedAt: new Date('2026-08-03T00:00:00.000Z'),
    clinicDateFormat: 'yyyy-MM-dd',
    filterSummary: {},
    strings: EXPORT_METADATA_STRINGS.en,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const sheet = wb.worksheets[0];
  const headerRow = findHeaderRowNumber(sheet, 'Label');

  for (let i = 0; i < hostileRows.length; i++) {
    const cell = sheet.getRow(headerRow + 1 + i).getCell(1);
    assert.equal(typeof cell.value, 'string');
    assert.equal((cell.value as string)[0], "'", `row ${i} label must be neutralized: ${cell.value}`);
  }
});

await test('a legitimate NEGATIVE NUMBER in a number column is never neutralized/stringified — it stays a real negative number', async () => {
  const buffer = await buildReportExportWorkbookBuffer({
    locale: 'en',
    title: 'Injection test',
    columns: HOSTILE_TEXT_COLUMNS,
    rows: [{ label: 'refund adjustment', amount: -150.25 }],
    toColumnValues: (r: any) => r,
    currency: 'USD',
    generatedAt: new Date('2026-08-03T00:00:00.000Z'),
    clinicDateFormat: 'yyyy-MM-dd',
    filterSummary: {},
    strings: EXPORT_METADATA_STRINGS.en,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const sheet = wb.worksheets[0];
  const headerRow = findHeaderRowNumber(sheet, 'Amount');
  const cell = sheet.getRow(headerRow + 1).getCell(2);
  assert.equal(typeof cell.value, 'number');
  assert.equal(cell.value, -150.25);
});

// ─── 9. Unicode / Turkish characters ────────────────────────────────────────

section('9. Unicode and Turkish characters remain valid through the XLSX round-trip');

await test('Turkish diacritics in a text cell survive byte-for-byte through generation + re-parsing', async () => {
  const turkishText = 'İstanbul Ağız ve Diş Sağlığı Polikliniği — çğıöşü ÇĞİÖŞÜ';
  const buffer = await buildReportExportWorkbookBuffer({
    locale: 'tr',
    title: 'Unicode test',
    columns: HOSTILE_TEXT_COLUMNS,
    rows: [{ label: turkishText, amount: 1 }],
    toColumnValues: (r: any) => r,
    currency: 'TRY',
    generatedAt: new Date('2026-08-03T00:00:00.000Z'),
    clinicDateFormat: 'dd.MM.yyyy',
    filterSummary: {},
    strings: EXPORT_METADATA_STRINGS.tr,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const sheet = wb.worksheets[0];
  const headerRow = findHeaderRowNumber(sheet, 'Etiket');
  const cell = sheet.getRow(headerRow + 1).getCell(1);
  assert.equal(cell.value, turkishText);
});

// ─── 10. PDF generation (deferred-scope decision: implemented, since pdfkit already exists) ─

section('10. PDF generation — valid output, no throw, safe text handling');

await test('buildReportExportPdfBuffer produces a well-formed PDF buffer for the pilot report shape', async () => {
  const buffer = await buildReportExportPdfBuffer({
    locale: 'tr',
    title: revenueByPeriodDefinition.title.tr,
    columns: revenueByPeriodDefinition.columns,
    rows: FIXTURE_ROWS,
    toColumnValues: revenueByPeriodDefinition.toColumnValues,
    currency: 'TRY',
    generatedAt: new Date('2026-08-03T10:00:00.000Z'),
    filterSummary: { dateFrom: '2026-06-01', dateTo: '2026-07-31' },
    strings: EXPORT_METADATA_STRINGS.tr,
  });
  assert.ok(buffer.length > 0);
  assert.equal(buffer.subarray(0, 5).toString('latin1'), '%PDF-');
});

await test('buildReportExportPdfBuffer never throws for an empty row set (renders the "no data" label instead)', async () => {
  const buffer = await buildReportExportPdfBuffer({
    locale: 'en',
    title: 'Empty',
    columns: revenueByPeriodDefinition.columns,
    rows: [],
    toColumnValues: revenueByPeriodDefinition.toColumnValues,
    currency: 'USD',
    generatedAt: new Date('2026-08-03T00:00:00.000Z'),
    filterSummary: {},
    strings: EXPORT_METADATA_STRINGS.en,
  });
  assert.ok(buffer.length > 0);
});

// ─── 11. Filename sanitization ──────────────────────────────────────────────

section('11. Export filename sanitization');

await test('a normal prefix produces a bounded, extension-correct filename', () => {
  const name = buildReportExportFilename('revenue-by-period', new Date('2026-08-03T14:05:00.000Z'), 'xlsx');
  assert.equal(name, 'revenue-by-period-20260803-1405.xlsx');
});

await test('a hostile prefix (path traversal / unicode / spaces) is stripped to a safe ASCII slug', () => {
  const name = buildReportExportFilename('../../etc/passwd; İ ü <script>', new Date('2026-08-03T14:05:00.000Z'), 'pdf');
  assert.equal(/^[a-zA-Z0-9-]+-\d{8}-\d{4}\.pdf$/.test(name), true, name);
  assert.equal(name.includes('..'), false);
  assert.equal(name.includes('/'), false);
  assert.equal(name.includes('<'), false);
});

await test('an empty/fully-stripped prefix falls back to a safe default rather than an empty filename', () => {
  const name = buildReportExportFilename('!!!', new Date('2026-08-03T14:05:00.000Z'), 'xlsx');
  assert.match(name, /^report-\d{8}-\d{4}\.xlsx$/);
});

// ─── 12. Audit classification + decision (PII vs non-PII) ─────────────────

section('12. PII classification drives the AuditLog decision');

await test('the real pilot definition (non-PII) does NOT trigger an audit write', () => {
  assert.equal(shouldAuditReportExport(revenueByPeriodDefinition), false);
});

// Synthetic PII test-only definition — used ONLY here to exercise the
// classification+decision logic; never added to REPORT_DEFINITIONS/registry.ts.
const SYNTHETIC_PII_TEST_DEFINITION = { key: '__test_only_pii_report__', pii: true };

await test('a synthetic PII-classified definition DOES trigger an audit write', () => {
  assert.equal(shouldAuditReportExport(SYNTHETIC_PII_TEST_DEFINITION), true);
});

await test('the synthetic PII test report key is never present in the production registry', () => {
  assert.equal(getReportDefinition(SYNTHETIC_PII_TEST_DEFINITION.key), undefined);
  assert.equal(Object.keys(REPORT_DEFINITIONS).includes(SYNTHETIC_PII_TEST_DEFINITION.key), false);
});

await test('recordReportExportAudit only calls writeAuditLog AFTER the shouldAuditReportExport guard (source-shape)', () => {
  const guardIdx = auditDecisionSrc.indexOf('if (!shouldAuditReportExport(params.definition)) return;');
  const writeIdx = auditDecisionSrc.indexOf('await writeAuditLog(');
  assert.ok(guardIdx >= 0 && writeIdx >= 0 && guardIdx < writeIdx, 'the classification guard must run before any AuditLog write');
});

await test('AuditLog metadata is limited to a safe allow-list (reportKey/format/filters/rowCount/success/scopeType/clinicCount[/clinicIds]) — no row-level/patient fields, and description is always null', () => {
  assert.match(auditDecisionSrc, /description: null,/);
  const metadataStart = auditDecisionSrc.indexOf('metadata: {');
  const metadataEnd = auditDecisionSrc.indexOf('ipAddress:', metadataStart);
  const metadataSrc = auditDecisionSrc.slice(metadataStart, metadataEnd);
  for (const forbidden of ['firstName', 'lastName', 'phone', 'email', 'patient', 'fullName', 'clinicName', 'name:']) {
    assert.equal(metadataSrc.toLowerCase().includes(forbidden.toLowerCase()), false, `metadata must never reference ${forbidden}`);
  }
  for (const required of ['reportKey', 'format', 'filters', 'rowCount', 'success', 'scopeType', 'clinicCount']) {
    assert.match(metadataSrc, new RegExp(required));
  }
});

await test('AuditLog clinicId column is set from the resolved auditScope, never a raw params.clinicId/user.clinicId field', () => {
  assert.match(auditDecisionSrc, /clinicId:\s*params\.auditScope\.clinicId,/);
  assert.equal(/params\.clinicId/.test(auditDecisionSrc), false, 'auditDecision.ts must not reference a raw params.clinicId — only the resolved auditScope');
});

await test('ReportExportAuditParams carries a structured `auditScope`, not a bare clinicId field (source-shape proves the corrected contract)', () => {
  const match = /export interface ReportExportAuditParams \{[\s\S]*?\n\}/.exec(auditDecisionSrc);
  assert.ok(match, 'ReportExportAuditParams interface must be found');
  const interfaceSrc = match![0];
  assert.match(interfaceSrc, /auditScope:\s*ReportExportAuditScope/);
  assert.equal(/\bclinicId\??:\s*string/.test(interfaceSrc), false, 'the params contract must not expose a raw clinicId field');
});

// ─── 12a. Audit clinic-scope resolution (resolveReportExportAuditScope) ────
// Converts the ALREADY-RESOLVED ClinicIdScopeWhere into an audit-safe
// descriptor. Its signature takes only `scope` — no `user` argument — which
// structurally proves it can never fall back to user.clinicId.

section('12a. resolveReportExportAuditScope — resolved scope drives the audit record, never user.clinicId');

await test('the helper signature takes only the resolved scope — no user/default-clinic parameter exists to fall back to', () => {
  assert.match(auditScopeSrc, /export function resolveReportExportAuditScope\(scope: ClinicIdScopeWhere\): ReportExportAuditScope/);
});

await test('an explicitly selected accessible clinic (different from any hypothetical user default clinic) resolves audit clinicId to that selected clinic', () => {
  // Simulates the ClinicIdScopeWhere validateAndGetClinicIdScope would return
  // for ?clinicId=clinic-B when the user's own default/JWT clinic is clinic-A
  // — buildClinicIdScope returns { clinicId: selectedClinicId } regardless of
  // the user's default clinic, so this shape alone is the proof.
  const result = resolveReportExportAuditScope({ clinicId: 'clinic-B' });
  assert.equal(result.clinicId, 'clinic-B');
  assert.equal(result.scopeType, 'single_clinic');
  assert.equal(result.clinicCount, 1);
  assert.equal(result.clinicIds, undefined);
});

await test('a single-clinic default scope (no explicit selection) resolves to that same actual resolved clinic', () => {
  const result = resolveReportExportAuditScope({ clinicId: 'clinic-A' });
  assert.equal(result.clinicId, 'clinic-A');
  assert.equal(result.scopeType, 'single_clinic');
  assert.equal(result.clinicCount, 1);
});

await test('an "all clinics" / multi-clinic scope resolves AuditLog clinicId to null', () => {
  const result = resolveReportExportAuditScope({ clinicId: { in: ['clinic-A', 'clinic-B', 'clinic-C'] } });
  assert.equal(result.clinicId, null);
});

await test('multi-clinic scope metadata carries a safe scope type and the clinic count (and clinic ids — never names)', () => {
  const result = resolveReportExportAuditScope({ clinicId: { in: ['clinic-A', 'clinic-B', 'clinic-C'] } });
  assert.equal(result.scopeType, 'multi_clinic');
  assert.equal(result.clinicCount, 3);
  assert.deepEqual(result.clinicIds, ['clinic-A', 'clinic-B', 'clinic-C']);
});

await test('an empty resolved clinic set (edge case) is treated as multi_clinic with clinicCount 0, never thrown or defaulted to a clinic', () => {
  const result = resolveReportExportAuditScope({ clinicId: { in: [] } });
  assert.equal(result.clinicId, null);
  assert.equal(result.scopeType, 'multi_clinic');
  assert.equal(result.clinicCount, 0);
});

await test('the route computes auditScope from the resolved `scope` variable, not from `user.clinicId`', () => {
  assert.match(reportExportRouteSrc, /resolveReportExportAuditScope\(scope\)/);
});

await test('the synthetic PII test definition\'s audit params would use the corrected auditScope contract (same shape as the real pilot)', () => {
  const scope = resolveReportExportAuditScope({ clinicId: { in: ['clinic-A', 'clinic-B'] } });
  const params = {
    definition: SYNTHETIC_PII_TEST_DEFINITION,
    organizationId: 'org-1',
    auditScope: scope,
    actorUserId: 'user-1',
    actorRole: 'owner',
    format: 'xlsx',
    filterSummary: { dateFrom: '2026-06-01', dateTo: '2026-06-30' },
    rowCount: 5,
    success: true,
  };
  assert.equal(shouldAuditReportExport(params.definition), true);
  assert.equal(params.auditScope.clinicId, null);
  assert.equal(params.auditScope.scopeType, 'multi_clinic');
});

// ─── 13. Existing JSON report endpoint is unchanged ────────────────────────

section('13. GET /api/reports/revenue (JSON) still exists and behaves the same');

await test('the revenue JSON route still exists at the same path with the same authorize(...) role list', () => {
  assert.match(reportsSrc, /router\.get\('\/reports\/revenue',\s*authorize\(/);
});

await test('reports.ts calls the shared loader (not a re-implemented query) — proven again here for the export-foundation suite', () => {
  assert.match(reportsSrc, /getRevenueByPeriodRows\(/);
});

// ─── 14. Date/datetime number-format mapping ───────────────────────────────

section('14. Date-format preference mapping (clinic operating-preferences contract)');

await test('every supported clinic dateFormat preference maps to a valid Excel numFmt', () => {
  assert.equal(dateNumFmtFor('dd.MM.yyyy'), 'dd.mm.yyyy');
  assert.equal(dateNumFmtFor('MM/dd/yyyy'), 'mm/dd/yyyy');
  assert.equal(dateNumFmtFor('dd/MM/yyyy'), 'dd/mm/yyyy');
  assert.equal(dateNumFmtFor('yyyy-MM-dd'), 'yyyy-mm-dd');
});

await test('an unrecognized preference falls back to a safe default rather than throwing', () => {
  assert.equal(dateNumFmtFor(undefined), 'yyyy-mm-dd');
  assert.equal(dateNumFmtFor('garbage'), 'yyyy-mm-dd');
});

await test('datetimeNumFmtFor appends a time component to the date format', () => {
  assert.equal(datetimeNumFmtFor('dd.MM.yyyy'), 'dd.mm.yyyy hh:mm');
});

// ─── Sonuç ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
console.log('─'.repeat(60));

if (failed > 0) process.exit(1);
