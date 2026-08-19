/**
 * migrationColumnPreview.test.ts — F3-DATA-MIG-TODAY-001-UI-002
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

import type { CanonicalCell, CanonicalHeader, CanonicalRow } from '../services/migration/contracts.js';
import {
  buildColumnPreviews,
  classifyColumnSensitivity,
} from '../services/migration/mapping/columnPreview.js';

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

function makeHeader(original: string, index: number): CanonicalHeader {
  return { original, normalized: original.trim().toUpperCase(), index };
}

function makeRow(rowNumber: number, values: string[]): CanonicalRow {
  return { rowNumber, cells: values.map(makeCell) };
}

/** One column, N sample rows, no destination proposed and a small max length. */
function previewForSingleColumn(header: string, values: string[], destType?: any, maxLength = 10) {
  const headers = [makeHeader(header, 0)];
  const rows = values.map((v, i) => makeRow(i + 1, [v]));
  const destByIndex = new Map<number, any>([[0, destType]]);
  const maxLenByIndex = new Map<number, number>([[0, maxLength]]);
  return buildColumnPreviews(headers, rows, destByIndex, maxLenByIndex)[0]!;
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
  assert.deepEqual(preview.samples, ['*******8901']);
  assert.ok(!preview.samples.some((s) => s.includes('1234567890')), 'no sample may contain the raw digit run');
});

await test('phone sample is masked to asterisks + last 4 digits, raw value never appears', () => {
  const preview = previewForSingleColumn('CEP_TELEFONU', ['5551234567'], undefined, 10);
  assert.deepEqual(preview.samples, ['******4567']);
  assert.ok(!preview.samples.some((s) => s.includes('555123')), 'no sample may contain the raw local prefix');
});

await test('email sample keeps only the first local-part character and the domain', () => {
  const preview = previewForSingleColumn('EMAIL', ['mustafa@example.com'], undefined, 20);
  assert.deepEqual(preview.samples, ['m***@example.com']);
});

await test('a value with no "@" under an email-classified column is treated as opaque sensitive text, never shown raw', () => {
  const preview = previewForSingleColumn('EMAIL', ['not-an-email'], undefined, 20);
  assert.equal(preview.samples[0], '[Hassas içerik — önizleme gizlendi]');
});

await test('free-text sample is fully hidden behind a fixed literal, never partially shown', () => {
  const preview = previewForSingleColumn(
    'ONEMLINOT',
    ['Hastanın alerjik reaksiyon geçmişi mevcut, penisilin grubu ilaçlardan kaçınılmalı.'],
    undefined,
    90,
  );
  assert.deepEqual(preview.samples, ['[Hassas içerik — önizleme gizlendi]']);
});

await test('address sample is fully hidden behind a fixed literal', () => {
  const preview = previewForSingleColumn('ADRESI', ['Bağdat Caddesi No:12 Daire:4'], undefined, 30);
  assert.deepEqual(preview.samples, ['[Adres içeriği — önizleme gizlendi]']);
});

await test('low-risk sample (e.g. chart number, first name) is shown as-is, trimmed', () => {
  const preview = previewForSingleColumn('DOSYANO', [' 4821 ', 'Ahmet'], undefined, 10);
  assert.deepEqual(preview.samples, ['4821', 'Ahmet']);
});

await test('a long low-risk value is truncated with an ellipsis rather than shown in full', () => {
  // 70 chars: long enough to exceed the 60-char low-risk cap, but under the
  // 80-char free-text SHAPE hint, so the column still classifies "low", not
  // "freetext" — isolating the truncation behaviour from the shape heuristic.
  const longValue = 'x'.repeat(70);
  const preview = previewForSingleColumn('HASTA_ID', [longValue], undefined, 70);
  assert.equal(classifyColumnSensitivity('HASTA_ID', undefined, 70), 'low');
  assert.ok(preview.samples[0]!.length <= 61, 'must be capped, not the full 70 chars');
  assert.ok(preview.samples[0]!.endsWith('…'));
});

await test('a column whose values typically run long (profile maxLength > 80) is treated as free text even under a low-risk header name', () => {
  const preview = previewForSingleColumn('HASTA_ID', ['x'.repeat(120)], undefined, 120);
  assert.equal(preview.samples[0], '[Hassas içerik — önizleme gizlendi]');
});

await test('blank cells render as the literal "boş", not an empty string', () => {
  const preview = previewForSingleColumn('DOSYANO', ['', '4821', ''], undefined, 5);
  assert.deepEqual(preview.samples, ['boş', '4821', 'boş']);
});

await test('at most 3 samples are returned even when more data rows exist', () => {
  const preview = previewForSingleColumn('HASTA_ID', ['1', '2', '3', '4', '5'], undefined, 1);
  assert.equal(preview.samples.length, 3);
  assert.deepEqual(preview.samples, ['1', '2', '3']);
});

await test('samples are indexed to the column, not shifted by an unrelated column', () => {
  const headers = [makeHeader('AD', 0), makeHeader('TCNO', 1)];
  const rows = [makeRow(1, ['Ahmet', '12345678901'])];
  const destByIndex = new Map<number, any>();
  const maxLenByIndex = new Map<number, number>([[0, 5], [1, 11]]);
  const previews = buildColumnPreviews(headers, rows, destByIndex, maxLenByIndex);
  assert.deepEqual(previews[0]!.samples, ['Ahmet']);
  assert.deepEqual(previews[1]!.samples, ['*******8901']);
});

// ══════════════════════════════════════════════════════════════════════════
// C. No cross-run / cross-tenant state
// ══════════════════════════════════════════════════════════════════════════

section('C. No cross-run / cross-tenant leakage');

await test('two independent calls with different data never mix samples — buildColumnPreviews holds no internal state', () => {
  const first = previewForSingleColumn('AD', ['TenantA-Ahmet'], undefined, 20);
  const second = previewForSingleColumn('AD', ['TenantB-Elif'], undefined, 20);
  assert.deepEqual(first.samples, ['TenantA-Ahmet']);
  assert.deepEqual(second.samples, ['TenantB-Elif']);
  assert.ok(!second.samples.some((s) => s.includes('TenantA')), 'a later call must not see an earlier call\'s data');
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
