/**
 * migrationColumnPreview.test.ts — F3-DATA-MIG-TODAY-001-UI-002, extended for
 * F3-DATA-MIG-TODAY-001-UI-006-R6.
 *
 * Verification suite for columnPreview.ts — the sanitized, server-masked
 * sample-value preview that makes the mapping screen human-verifiable
 * (source column -> sample values -> NoraMedi target) without ever shipping
 * a raw PII/PHI value to the browser.
 *
 * Standalone tsx script, node:assert/strict — same harness shape as
 * migrationMapping.test.ts / migrationParser.test.ts. Run with:
 *   tsx src/tests/migrationColumnPreview.test.ts
 */

import assert from 'node:assert/strict';

import type { CanonicalCell, CanonicalHeader, CanonicalRow, MappingState } from '../services/migration/contracts.js';
import {
  buildColumnPreviews,
  classifyColumnSensitivity,
  type ColumnPreviewSample,
} from '../services/migration/mapping/columnPreview.js';
import { FIRST_CUSTOMER_MATRIX } from '../services/migration/mapping/firstCustomerMatrix.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err?.stack ?? err?.message ?? err}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

function makeCell(text: string): CanonicalCell {
  return text === '' ? { type: 'empty', text: '' } : { type: 'string', text };
}

function makeHeader(original: string, index: number, headerWasBlank = false): CanonicalHeader {
  return { original, normalized: original.trim().toUpperCase(), index, headerWasBlank };
}

function makeRow(rowNumber: number, values: string[]): CanonicalRow {
  return { rowNumber, cells: values.map(makeCell) };
}

/** Just the masked values, in order — for tests that don't care about row numbers. */
function values(samples: ColumnPreviewSample[]): string[] {
  return samples.map((s) => s.value);
}

/** One column, N sample rows (1-based, in order), no destination proposed and a small max length. */
function previewForSingleColumn(
  header: string,
  rowValues: string[],
  destType?: any,
  maxLength = 10,
  mappingState?: MappingState,
) {
  const headers = [makeHeader(header, 0)];
  const rows = rowValues.map((v, i) => makeRow(i + 1, [v]));
  const destByIndex = new Map<number, any>([[0, destType]]);
  const maxLenByIndex = new Map<number, number>([[0, maxLength]]);
  const stateByIndex = new Map<number, MappingState | undefined>([[0, mappingState]]);
  return buildColumnPreviews(headers, rows, destByIndex, maxLenByIndex, stateByIndex)[0]!;
}

// ══════════════════════════════════════════════════════════════════════════
// A. classifyColumnSensitivity
// ══════════════════════════════════════════════════════════════════════════

section('A. classifyColumnSensitivity');

await test('destination type "identity" classifies tckn regardless of header text', () => {
  assert.equal(classifyColumnSensitivity('WHATEVER', 'identity', 5), 'tckn');
});

await test('destination type "phone" classifies phone regardless of header text', () => {
  assert.equal(classifyColumnSensitivity('WHATEVER', 'phone', 5), 'phone');
});

await test('destination type "email" classifies email regardless of header text', () => {
  assert.equal(classifyColumnSensitivity('WHATEVER', 'email', 5), 'email');
});

await test('TCNO / TCKN / T.C. Kimlik No header text classifies tckn with no destination proposed', () => {
  assert.equal(classifyColumnSensitivity('TCNO', undefined, 5), 'tckn');
  assert.equal(classifyColumnSensitivity('TCKN', undefined, 5), 'tckn');
  assert.equal(classifyColumnSensitivity('T.C. Kimlik No', undefined, 5), 'tckn');
});

await test('secondary phone headers with NO destination (e.g. EVTELEFONU, ISTELEFONU) still classify phone', () => {
  // These are BLOCKED_NO_DESTINATION in the first-customer matrix (Patient has
  // only one phone field) but remain patient contact data and must stay masked.
  assert.equal(classifyColumnSensitivity('EVTELEFONU', undefined, 5), 'phone');
  assert.equal(classifyColumnSensitivity('ISTELEFONU', undefined, 5), 'phone');
  assert.equal(classifyColumnSensitivity('CEP_TELEFONU', undefined, 5), 'phone');
});

await test('email-shaped header text classifies email', () => {
  assert.equal(classifyColumnSensitivity('EMAIL', undefined, 5), 'email');
  assert.equal(classifyColumnSensitivity('EPOSTA', undefined, 5), 'email');
});

await test('address-shaped header text classifies address', () => {
  assert.equal(classifyColumnSensitivity('ADRESI', undefined, 5), 'address');
  assert.equal(classifyColumnSensitivity('MAHALLE', undefined, 5), 'address');
});

await test('known clinical free-text headers (ONEMLINOT, KONTROLNOTU) classify freetext', () => {
  assert.equal(classifyColumnSensitivity('ONEMLINOT', undefined, 5), 'freetext');
  assert.equal(classifyColumnSensitivity('KONTROLNOTU', undefined, 5), 'freetext');
});

await test('an unrecognized header with long values is classified freetext by shape, not name', () => {
  assert.equal(classifyColumnSensitivity('XYZ_UNKNOWN_FIELD', undefined, 200), 'freetext');
});

await test('an unrecognized header with short values is classified low-risk', () => {
  assert.equal(classifyColumnSensitivity('HASTA_ID', undefined, 6), 'low');
  assert.equal(classifyColumnSensitivity('DOSYANO', undefined, 5), 'low');
  assert.equal(classifyColumnSensitivity('AD', undefined, 10), 'low');
});

// ══════════════════════════════════════════════════════════════════════════
// B. buildColumnPreviews — masking output
// ══════════════════════════════════════════════════════════════════════════

section('B. buildColumnPreviews — masking output');

await test('TCKN sample is masked to 7 asterisks + last 4 digits, raw value never appears', () => {
  const preview = previewForSingleColumn('TCNO', ['12345678901'], undefined, 11);
  assert.deepEqual(values(preview.samples), ['*******8901']);
  assert.ok(!values(preview.samples).some((s) => s.includes('1234567890')), 'no sample may contain the raw digit run');
});

await test('phone sample is masked to asterisks + last 4 digits, raw value never appears', () => {
  const preview = previewForSingleColumn('CEP_TELEFONU', ['5551234567'], undefined, 10);
  assert.deepEqual(values(preview.samples), ['******4567']);
  assert.ok(!values(preview.samples).some((s) => s.includes('555123')), 'no sample may contain the raw local prefix');
});

await test('email sample keeps only the first local-part character and the domain', () => {
  const preview = previewForSingleColumn('EMAIL', ['mustafa@example.com'], undefined, 20);
  assert.deepEqual(values(preview.samples), ['m***@example.com']);
});

await test('a value with no "@" under an email-classified column is treated as opaque sensitive text, never shown raw', () => {
  const preview = previewForSingleColumn('EMAIL', ['not-an-email'], undefined, 20);
  assert.equal(preview.samples[0]!.value, '[Hassas içerik — önizleme gizlendi]');
});

await test('free-text sample is fully hidden behind a fixed literal, never partially shown', () => {
  const preview = previewForSingleColumn(
    'ONEMLINOT',
    ['Hastanın alerjik reaksiyon geçmişi mevcut, penisilin grubu ilaçlardan kaçınılmalı.'],
    undefined,
    90,
  );
  assert.deepEqual(values(preview.samples), ['[Hassas içerik — önizleme gizlendi]']);
});

await test('address sample is fully hidden behind a fixed literal', () => {
  const preview = previewForSingleColumn('ADRESI', ['Bağdat Caddesi No:12 Daire:4'], undefined, 30);
  assert.deepEqual(values(preview.samples), ['[Adres içeriği — önizleme gizlendi]']);
});

await test('low-risk sample (e.g. chart number, first name) is shown as-is, trimmed', () => {
  const preview = previewForSingleColumn('DOSYANO', [' 4821 ', 'Ahmet'], undefined, 10);
  assert.deepEqual(values(preview.samples), ['4821', 'Ahmet']);
});

await test('a long low-risk value is truncated with an ellipsis rather than shown in full', () => {
  // 70 chars: long enough to exceed the 60-char low-risk cap, but under the
  // 80-char free-text SHAPE hint, so the column still classifies "low", not
  // "freetext" — isolating the truncation behaviour from the shape heuristic.
  const longValue = 'x'.repeat(70);
  const preview = previewForSingleColumn('HASTA_ID', [longValue], undefined, 70);
  assert.equal(classifyColumnSensitivity('HASTA_ID', undefined, 70), 'low');
  assert.ok(preview.samples[0]!.value.length <= 61, 'must be capped, not the full 70 chars');
  assert.ok(preview.samples[0]!.value.endsWith('…'));
});

await test('a column whose values typically run long (profile maxLength > 80) is treated as free text even under a low-risk header name', () => {
  const preview = previewForSingleColumn('HASTA_ID', ['x'.repeat(120)], undefined, 120);
  assert.equal(preview.samples[0]!.value, '[Hassas içerik — önizleme gizlendi]');
});

await test('blank cells are skipped entirely — never returned as a "boş" sample (F3-DATA-MIG-TODAY-001-UI-006-R6)', () => {
  const preview = previewForSingleColumn('DOSYANO', ['', '4821', ''], undefined, 5);
  assert.deepEqual(values(preview.samples), ['4821']);
  assert.equal(preview.samples[0]!.rowNumber, 2, 'the sample must carry the row number it actually came from');
});

await test('at most 3 samples are returned even when more data rows exist', () => {
  const preview = previewForSingleColumn('HASTA_ID', ['1', '2', '3', '4', '5'], undefined, 1);
  assert.equal(preview.samples.length, 3);
  assert.deepEqual(values(preview.samples), ['1', '2', '3']);
});

await test('each sample is paired with the 1-based row number it actually came from', () => {
  const preview = previewForSingleColumn('HASTA_ID', ['1', '2', '3'], undefined, 1);
  assert.deepEqual(preview.samples.map((s) => s.rowNumber), [1, 2, 3]);
});

await test('samples are indexed to the column, not shifted by an unrelated column', () => {
  const headers = [makeHeader('AD', 0), makeHeader('TCNO', 1)];
  const rows = [makeRow(1, ['Ahmet', '12345678901'])];
  const destByIndex = new Map<number, any>();
  const maxLenByIndex = new Map<number, number>([[0, 5], [1, 11]]);
  const previews = buildColumnPreviews(headers, rows, destByIndex, maxLenByIndex);
  assert.deepEqual(values(previews[0]!.samples), ['Ahmet']);
  assert.deepEqual(values(previews[1]!.samples), ['*******8901']);
});

// ══════════════════════════════════════════════════════════════════════════
// C. No cross-run / cross-tenant state
// ══════════════════════════════════════════════════════════════════════════

section('C. No cross-run / cross-tenant leakage');

await test('two independent calls with different data never mix samples — buildColumnPreviews holds no internal state', () => {
  const first = previewForSingleColumn('AD', ['TenantA-Ahmet'], undefined, 20);
  const second = previewForSingleColumn('AD', ['TenantB-Elif'], undefined, 20);
  assert.deepEqual(values(first.samples), ['TenantA-Ahmet']);
  assert.deepEqual(values(second.samples), ['TenantB-Elif']);
  assert.ok(!values(second.samples).some((s) => s.includes('TenantA')), 'a later call must not see an earlier call\'s data');
});

// ══════════════════════════════════════════════════════════════════════════
// D. Fail-closed masking for LEGAL_BLOCKED mappings (F3-DATA-MIG-TODAY-001-UI-002-R2)
// ══════════════════════════════════════════════════════════════════════════
//
// KANGURUBU (blood group) is BLOCKED_LEGAL_DECISION in firstCustomerMatrix.ts
// because blood group is KVKK Art. 6 special-category health data — but it
// has no destination and no header keyword the classifier recognizes, and
// its values ("A Rh+") are short. Before this fix, that combination fell
// through every heuristic to 'low' and was returned RAW. mappingState must
// be checked first and override every other signal.

section('D. Fail-closed masking for LEGAL_BLOCKED mappings');

const LEGAL_BLOCKED_ENTRIES = FIRST_CUSTOMER_MATRIX.filter(
  (e) => e.disposition === 'BLOCKED_LEGAL_DECISION',
);

await test('firstCustomerMatrix.ts actually contains BLOCKED_LEGAL_DECISION entries (sanity check the test below is not vacuous)', () => {
  assert.ok(LEGAL_BLOCKED_ENTRIES.length > 0, 'expected at least one BLOCKED_LEGAL_DECISION entry to exist');
  assert.ok(
    LEGAL_BLOCKED_ENTRIES.some((e) => e.sourceField === 'KANGURUBU'),
    'KANGURUBU must be one of the legal-blocked entries this suite is guarding',
  );
});

await test('KANGURUBU (blood group) with a real-shaped sample "A Rh+" is fully hidden, never returned raw', () => {
  const entry = LEGAL_BLOCKED_ENTRIES.find((e) => e.sourceField === 'KANGURUBU')!;
  const preview = previewForSingleColumn('KANGURUBU', ['A Rh+'], undefined, 5, entry.mappingState);
  assert.equal(preview.samples[0]!.value, '[KVKK Madde 6 — hukuki gerekçeyle gizlendi]');
  assert.ok(!values(preview.samples).some((s) => s.includes('A Rh+')), 'raw blood-group value must never appear');
});

await test('every BLOCKED_LEGAL_DECISION field in firstCustomerMatrix.ts is fully hidden, never returned raw', () => {
  for (const entry of LEGAL_BLOCKED_ENTRIES) {
    const rawValue = `RAW-${entry.sourceField}-VALUE`;
    const preview = previewForSingleColumn(entry.sourceField, [rawValue], undefined, 5, entry.mappingState);
    assert.equal(
      preview.samples[0]!.value,
      '[KVKK Madde 6 — hukuki gerekçeyle gizlendi]',
      `${entry.sourceField} must render the fixed legal-hold literal`,
    );
    assert.ok(
      !values(preview.samples).some((s) => s.includes(rawValue)),
      `${entry.sourceField} must never leak its raw value into a preview`,
    );
  }
});

await test('contract: mappingState LEGAL_BLOCKED forces hidden classification regardless of header text, destination type, or value length', () => {
  // Every one of these would normally classify as 'low' (short value,
  // unrecognized header, no destination) or even resolve a destination type
  // — mappingState must win over all of them.
  assert.equal(classifyColumnSensitivity('KANGURUBU', undefined, 5, 'LEGAL_BLOCKED'), 'legalBlocked');
  assert.equal(classifyColumnSensitivity('COMPLETELY_UNRECOGNIZED_HEADER', undefined, 3, 'LEGAL_BLOCKED'), 'legalBlocked');
  assert.equal(classifyColumnSensitivity('AD', 'identity', 5, 'LEGAL_BLOCKED'), 'legalBlocked');
  assert.equal(classifyColumnSensitivity('HASTA_ID', undefined, 500, 'LEGAL_BLOCKED'), 'legalBlocked');
  // Sanity: without LEGAL_BLOCKED, the same short/unrecognized header is 'low' —
  // proving the override above is actually doing something, not a no-op.
  assert.equal(classifyColumnSensitivity('KANGURUBU', undefined, 5, undefined), 'low');
});

await test('mappingState LEGAL_BLOCKED on one column does not affect an unrelated column in the same workbook', () => {
  const headers = [makeHeader('KANGURUBU', 0), makeHeader('AD', 1)];
  const rows = [makeRow(1, ['A Rh+', 'Ahmet'])];
  const destByIndex = new Map<number, any>();
  const maxLenByIndex = new Map<number, number>([[0, 5], [1, 5]]);
  const stateByIndex = new Map<number, MappingState | undefined>([[0, 'LEGAL_BLOCKED'], [1, 'AUTO_CONFIDENT']]);
  const previews = buildColumnPreviews(headers, rows, destByIndex, maxLenByIndex, stateByIndex);
  assert.equal(previews[0]!.samples[0]!.value, '[KVKK Madde 6 — hukuki gerekçeyle gizlendi]');
  assert.deepEqual(values(previews[1]!.samples), ['Ahmet']);
});

// ══════════════════════════════════════════════════════════════════════════
// E. Meaningful (non-empty) preview — F3-DATA-MIG-TODAY-001-UI-006-R6
// ══════════════════════════════════════════════════════════════════════════
//
// Production shape that motivated this suite: a headerless column with
// fill ≈ 0%, distinct = 1, one real value somewhere among thousands of empty
// rows. Before R6, buildColumnPreviews took the first N PHYSICAL rows, so a
// sparse column like this showed nothing but "boş" — the operator could not
// see the one value that existed, and therefore could not decide whether to
// map, ignore, or block the column. R6 requires the first N MEANINGFUL
// (non-empty) values, wherever they occur, each paired with its row number.

section('E. Meaningful (non-empty) preview (R6)');

await test('a column whose only real value sits far past the old fixed preview window is still surfaced', () => {
  // 20 empty rows, then one real value at row 21 — well past the old
  // MAX_SAMPLES_PER_COLUMN=3 physical-row window.
  const rowValues = [...Array(20).fill(''), 'A821'];
  const preview = previewForSingleColumn('DOSYANO', rowValues, undefined, 10);
  assert.equal(preview.samples.length, 1);
  assert.equal(preview.samples[0]!.value, 'A821');
  assert.equal(preview.samples[0]!.rowNumber, 21);
});

await test('a headerless column reproducing the exact production shape (14,889 empty + 1 meaningful, late) surfaces the real value', () => {
  // Mirrors the real first-customer defect: fill ≈ 0%, distinct = 1, the one
  // meaningful value appears after 14,888 empty rows.
  const totalRows = 14_889;
  const meaningfulRowNumber = 14_889;
  const rowValues = Array.from({ length: totalRows }, (_, i) =>
    i === meaningfulRowNumber - 1 ? 'SERBEST METİN DEĞERİ' : '',
  );
  const preview = previewForSingleColumn('COLUMN_7', rowValues, undefined, 30);
  assert.equal(preview.samples.length, 1, 'the one real value must be found, not silently dropped');
  assert.equal(preview.samples[0]!.rowNumber, meaningfulRowNumber);
  // Header "COLUMN_7" contains no sensitive keyword and the value is short, so
  // this classifies 'low' and is shown as-is — the point of this test is
  // FINDING the value, not masking (masking is covered by section D above).
  assert.equal(preview.samples[0]!.value, 'SERBEST METİN DEĞERİ');
});

await test('a column with zero non-empty cells returns an empty samples array, not a placeholder', () => {
  const preview = previewForSingleColumn('DOSYANO', ['', '', ''], undefined, 5);
  assert.deepEqual(preview.samples, []);
});

await test('samples remain in row order even when the meaningful values are scattered', () => {
  const rowValues = ['', 'first', '', '', 'second', '', 'third', ''];
  const preview = previewForSingleColumn('DOSYANO', rowValues, undefined, 10);
  assert.deepEqual(values(preview.samples), ['first', 'second', 'third']);
  assert.deepEqual(preview.samples.map((s) => s.rowNumber), [2, 5, 7]);
});

// ══════════════════════════════════════════════════════════════════════════
// F. CRITICAL REGRESSION: headerless + sparse data must stay MANUAL_REQUIRED
//    (R5 invariant) while ALSO surfacing its real value in the preview (R6)
// ══════════════════════════════════════════════════════════════════════════

section('F. Headerless + sparse-data regression (R5 state invariant x R6 preview)');

await test('headerWasBlank + filledCount > 0 stays MANUAL_REQUIRED-eligible AND its real value is previewable — not auto-ignored, not auto-mapped', () => {
  // This test exercises the PREVIEW half of the invariant directly (the
  // MANUAL_REQUIRED / EMPTY_SOURCE_COLUMN state decision itself is owned by
  // mappingEngine.ts's suggestMappings and is covered end-to-end in
  // migrationParser.test.ts's "F3-DATA-MIG-TODAY-001-UI-005-R5" cases and by
  // the analyze-lifecycle fixture in migrationAnalyzeLifecycleDb.test.ts).
  const header = makeHeader('COLUMN_3', 3, /* headerWasBlank */ true);
  const rowValues = [...Array(14_888).fill(''), 'tek gerçek değer'];
  const rows = rowValues.map((v, i) => makeRow(i + 1, ['', '', '', v]));
  const destByIndex = new Map<number, any>();
  const maxLenByIndex = new Map<number, number>([[3, 20]]);
  const previews = buildColumnPreviews([header], rows, destByIndex, maxLenByIndex);
  assert.equal(previews[0]!.samples.length, 1, 'the one meaningful value in a headerless-but-not-empty column must surface');
  assert.equal(previews[0]!.samples[0]!.value, 'tek gerçek değer');
  assert.equal(previews[0]!.samples[0]!.rowNumber, 14_889);
});

// ─────────────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(50));
console.log(`Toplam: ${passed + failed}  ✓ ${passed}  ✗ ${failed}`);
if (failed > 0) {
  console.log(`\n${failed} test başarısız oldu.`);
  process.exit(1);
} else {
  console.log('\nTüm testler geçti.');
}
