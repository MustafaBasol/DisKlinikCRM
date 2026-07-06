/**
 * filePreview.test.ts — Tests for in-app file preview (patient + lab order attachments).
 *
 * Covers:
 *  1. isInlinePreviewable() whitelist (pure logic)
 *  2. Patient attachment preview route: inline disposition, 415 for unsupported types,
 *     clinic isolation identical to the download route
 *  3. Patient attachment download route: attachment disposition unchanged
 *  4. Lab order attachment preview route: inline disposition, 415 for unsupported types,
 *     clinic isolation identical to the download route
 *  5. Lab order attachment download route: attachment disposition unchanged
 *
 * Run with: tsx src/tests/filePreview.test.ts
 * No external test framework — uses node:assert/strict. Source-based regression
 * checks (mirrors the style of labOrders.test.ts) since these routes require a
 * live DB + storage to exercise end-to-end.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isInlinePreviewable, INLINE_PREVIEWABLE_MIME_TYPES } from '../utils/filePreview.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

function src(relPath: string) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

async function main() {
  // ── isInlinePreviewable() ────────────────────────────────────────────────
  section('isInlinePreviewable()');

  await test('accepts the documented safe inline types', () => {
    assert.equal(isInlinePreviewable('image/png'), true);
    assert.equal(isInlinePreviewable('image/jpeg'), true);
    assert.equal(isInlinePreviewable('image/webp'), true);
    assert.equal(isInlinePreviewable('application/pdf'), true);
  });

  await test('rejects types that are uploadable but not inline-previewable', () => {
    assert.equal(isInlinePreviewable('image/gif'), false);
    assert.equal(isInlinePreviewable('application/msword'), false);
    assert.equal(isInlinePreviewable('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), false);
  });

  await test('rejects arbitrary/unknown mime types', () => {
    assert.equal(isInlinePreviewable('text/html'), false);
    assert.equal(isInlinePreviewable('application/octet-stream'), false);
    assert.equal(isInlinePreviewable(''), false);
  });

  await test('whitelist has exactly the 4 documented types (no accidental additions)', () => {
    assert.deepEqual(
      [...INLINE_PREVIEWABLE_MIME_TYPES].sort(),
      ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].sort(),
    );
  });

  // ── Patient attachment routes ─────────────────────────────────────────────
  section('Patient attachment preview/download routes');

  const attachmentsSrc = src('../routes/attachments.ts');

  await test('attachments.ts imports isInlinePreviewable from the shared util', () => {
    assert.ok(attachmentsSrc.includes("import { isInlinePreviewable } from '../utils/filePreview.js';"));
  });

  await test('GET .../attachments/:id/preview exists, checks isInlinePreviewable, and sets inline disposition', () => {
    const match = attachmentsSrc.match(/router\.get\(\s*'\/patients\/:patientId\/attachments\/:id\/preview'[\s\S]*?\n\);/);
    assert.ok(match, 'preview route not found');
    const routeSrc = match![0];
    assert.ok(routeSrc.includes('isInlinePreviewable(attachment.mimeType)'), 'preview route must gate on isInlinePreviewable');
    assert.ok(routeSrc.includes('res.status(415)'), 'unsupported preview type must return a controlled error (415)');
    assert.ok(/Content-Disposition',\s*`inline;/.test(routeSrc), 'preview route must set inline Content-Disposition');
    assert.ok(routeSrc.includes('attachment.mimeType'), 'preview route must echo the stored mimeType as Content-Type');
  });

  await test('preview route scopes the attachment lookup by id + patientId + clinicId (same as download)', () => {
    const match = attachmentsSrc.match(/router\.get\(\s*'\/patients\/:patientId\/attachments\/:id\/preview'[\s\S]*?\n\);/);
    const routeSrc = match![0];
    assert.ok(/findFirst\(\{\s*where:\s*\{\s*id,\s*patientId,\s*clinicId\s*\}/.test(routeSrc), 'preview must not skip clinic scoping');
  });

  await test('GET .../attachments/:id/download still sets attachment disposition (unchanged)', () => {
    const match = attachmentsSrc.match(/router\.get\(\s*'\/patients\/:patientId\/attachments\/:id\/download'[\s\S]*?\n\);/);
    assert.ok(match, 'download route not found');
    assert.ok(/Content-Disposition',\s*`attachment;/.test(match![0]), 'download route must keep attachment Content-Disposition');
  });

  // ── Lab order attachment routes ───────────────────────────────────────────
  section('Lab order attachment preview/download routes');

  const labOrdersSrc = src('../routes/labOrders.ts');

  await test('labOrders.ts imports isInlinePreviewable from the shared util', () => {
    assert.ok(labOrdersSrc.includes("import { isInlinePreviewable } from '../utils/filePreview.js';"));
  });

  await test("GET .../lab-orders/:id/attachments/:attId/preview exists, checks isInlinePreviewable, and sets inline disposition", () => {
    const match = labOrdersSrc.match(/router\.get\('\/lab-orders\/:id\/attachments\/:attId\/preview'[\s\S]*?\n\}\);/);
    assert.ok(match, 'lab order preview route not found');
    const routeSrc = match![0];
    assert.ok(routeSrc.includes('isInlinePreviewable(attachment.mimeType)'), 'preview route must gate on isInlinePreviewable');
    assert.ok(routeSrc.includes('res.status(415)'), 'unsupported preview type must return a controlled error (415)');
    assert.ok(/Content-Disposition',\s*`inline;/.test(routeSrc), 'preview route must set inline Content-Disposition');
  });

  await test('lab order preview route uses the same clinic-scoped order + attachment lookup as download', () => {
    const match = labOrdersSrc.match(/router\.get\('\/lab-orders\/:id\/attachments\/:attId\/preview'[\s\S]*?\n\}\);/);
    const routeSrc = match![0];
    assert.ok(routeSrc.includes('getAccessibleClinicIds(req.user!)'), 'preview must resolve accessible clinics, not trust req.user.clinicId directly');
    assert.ok(routeSrc.includes('clinicId: order.clinicId'), 'attachment lookup must be scoped to the order clinic');
  });

  await test('GET .../lab-orders/:id/attachments/:attId/download still sets attachment disposition (unchanged)', () => {
    const match = labOrdersSrc.match(/router\.get\('\/lab-orders\/:id\/attachments\/:attId\/download'[\s\S]*?\n\}\);/);
    assert.ok(match, 'lab order download route not found');
    assert.ok(/Content-Disposition',\s*`attachment;/.test(match![0]), 'download route must keep attachment Content-Disposition');
  });

  // ── Result ────────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
