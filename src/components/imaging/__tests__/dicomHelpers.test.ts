/**
 * dicomHelpers.test.ts — Tests for the DICOM viewer's pure helpers and the
 * secure-loading contract of DicomViewer.tsx / imagingService.
 *
 * Run with: tsx src/components/imaging/__tests__/dicomHelpers.test.ts
 * No external test framework — uses node:assert/strict, mirroring the style
 * of server/src/tests/filePreview.test.ts. Component-level rendering isn't
 * covered here (no DOM/canvas test harness in this repo); these are pure
 * logic + source-based regression checks instead.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  classifyDicomSupport,
  isDicomImage,
  isSupportedTransferSyntax,
  mapSafeDicomMetadata,
  mapViewerError,
  type DicomDataSetLike,
} from '../dicomHelpers';

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

function mockDataSet(values: Record<string, number | string>): DicomDataSetLike {
  return {
    uint16: (tag: string) => (typeof values[tag] === 'number' ? (values[tag] as number) : undefined),
    intString: (tag: string) => (typeof values[tag] === 'number' ? (values[tag] as number) : undefined),
    string: (tag: string) => (typeof values[tag] === 'string' ? (values[tag] as string) : undefined),
  };
}

async function main() {
  // ── isDicomImage() ────────────────────────────────────────────────────────
  section('isDicomImage()');

  await test('classifies application/dicom as DICOM', () => {
    assert.equal(isDicomImage('application/dicom'), true);
  });

  await test('classifies standard web image/pdf mime types as non-DICOM', () => {
    assert.equal(isDicomImage('image/png'), false);
    assert.equal(isDicomImage('image/jpeg'), false);
    assert.equal(isDicomImage('image/webp'), false);
    assert.equal(isDicomImage('application/pdf'), false);
  });

  await test('classification is based on mimeType, not filename/extension', () => {
    // isDicomImage's signature only accepts a mimeType — there is no
    // filename parameter to fall back on, so a .dcm-named PNG cannot
    // accidentally be classified as DICOM.
    assert.equal(isDicomImage('image/png'), false);
    assert.equal(isDicomImage(undefined), false);
    assert.equal(isDicomImage(null), false);
  });

  // ── classifyDicomSupport() ────────────────────────────────────────────────
  section('classifyDicomSupport()');

  await test('absent NumberOfFrames is single-frame', () => {
    assert.equal(classifyDicomSupport(mockDataSet({})), 'single-frame');
  });

  await test('NumberOfFrames = 1 is single-frame', () => {
    assert.equal(classifyDicomSupport(mockDataSet({ x00280008: 1 })), 'single-frame');
  });

  await test('NumberOfFrames > 1 is multi-frame (unsupported)', () => {
    assert.equal(classifyDicomSupport(mockDataSet({ x00280008: 12 })), 'multi-frame');
  });

  // ── isSupportedTransferSyntax() ───────────────────────────────────────────
  section('isSupportedTransferSyntax()');

  await test('recognizes common uncompressed and baseline-JPEG transfer syntaxes', () => {
    assert.equal(isSupportedTransferSyntax('1.2.840.10008.1.2'), true);
    assert.equal(isSupportedTransferSyntax('1.2.840.10008.1.2.1'), true);
    assert.equal(isSupportedTransferSyntax('1.2.840.10008.1.2.4.50'), true);
  });

  await test('rejects an unrecognized/unsupported transfer syntax UID', () => {
    assert.equal(isSupportedTransferSyntax('1.2.840.10008.1.2.4.100'), false);
    assert.equal(isSupportedTransferSyntax('9.9.9.9'), false);
  });

  // ── mapSafeDicomMetadata() ────────────────────────────────────────────────
  section('mapSafeDicomMetadata()');

  await test('extracts only the documented safe technical tags', () => {
    const dataSet = mockDataSet({
      x00280010: 512, // rows
      x00280011: 512, // columns
      x00280100: 16, // bits allocated
      x00280101: 12, // bits stored
      x00280004: 'MONOCHROME2',
      x00280008: 1,
      x00020010: '1.2.840.10008.1.2.1',
    });
    const meta = mapSafeDicomMetadata(dataSet);
    assert.deepEqual(Object.keys(meta).sort(), [
      'bitsAllocated',
      'bitsStored',
      'columns',
      'numberOfFrames',
      'photometricInterpretation',
      'rows',
      'transferSyntaxSupported',
      'transferSyntaxUid',
    ].sort());
    assert.equal(meta.rows, 512);
    assert.equal(meta.columns, 512);
    assert.equal(meta.transferSyntaxSupported, true);
  });

  await test('never reads patient identity, accession, institution, or operator tags', () => {
    // PatientName (0010,0010), PatientID (0010,0020), AccessionNumber (0008,0050)
    const dataSet = mockDataSet({
      x00100010: 'DOE^JOHN',
      x00100020: 'MRN123',
      x00080050: 'ACC001',
      x00280008: 1,
    });
    const meta = mapSafeDicomMetadata(dataSet);
    const serialized = JSON.stringify(meta);
    assert.ok(!serialized.includes('DOE'), 'safe metadata must not leak PatientName');
    assert.ok(!serialized.includes('MRN123'), 'safe metadata must not leak PatientID');
    assert.ok(!serialized.includes('ACC001'), 'safe metadata must not leak AccessionNumber');
  });

  // ── mapViewerError() ──────────────────────────────────────────────────────
  section('mapViewerError()');

  await test('maps HTTP 401/403 to "unauthorized"', () => {
    assert.equal(mapViewerError({ response: { status: 401 } }), 'unauthorized');
    assert.equal(mapViewerError({ response: { status: 403 } }), 'unauthorized');
  });

  await test('maps HTTP 404 to "not-found"', () => {
    assert.equal(mapViewerError({ response: { status: 404 } }), 'not-found');
  });

  await test('maps network errors to "network"', () => {
    assert.equal(mapViewerError({ code: 'ERR_NETWORK', message: 'Network Error' }), 'network');
  });

  await test('never returns or embeds the raw error message/stack', () => {
    const raw = new Error('Sensitive stack trace with /var/data/patient123.dcm path');
    const kind = mapViewerError(raw);
    // A generic Error (no HTTP status, not a recognized network error) must
    // map to the documented 'failed' fallback — not silently pass through.
    assert.equal(kind, 'failed');
    // The return value is always one of a fixed enum, never the message itself.
    assert.ok(!String(kind).includes('Sensitive'));
    assert.ok(!String(kind).includes('/var/data'));
  });

  // ── Secure-loading contract (source-based checks) ─────────────────────────
  section('Secure DICOM loading contract');

  const apiSrc = src('../../../services/api.ts');

  await test('imagingService.loadDicomBlob fetches via the authenticated api client (cookies), not a public URL', () => {
    const match = apiSrc.match(/loadDicomBlob:[\s\S]*?\},/);
    assert.ok(match, 'loadDicomBlob not found in api.ts');
    const fnSrc = match![0];
    assert.ok(fnSrc.includes('api.get('), 'must use the shared authenticated axios client');
    assert.ok(fnSrc.includes("responseType: 'blob'"), 'must fetch as a blob, not stream to an <img>/<a> src directly');
    assert.ok(!/[?&]token=/.test(fnSrc), 'must never place an auth token in the query string');
  });

  const viewerSrc = src('../DicomViewer.tsx');

  await test('DicomViewer never constructs a public storage URL or filesystem path', () => {
    assert.ok(!viewerSrc.includes('filePath'), 'must not reference the raw storage path field');
    assert.ok(!/\/uploads\//.test(viewerSrc), 'must not hardcode a public uploads URL');
    assert.ok(!/[?&]token=/.test(viewerSrc), 'must never place a token in a URL');
  });

  await test('DicomViewer cleans up cornerstone + fileManager resources on unmount/retry', () => {
    assert.ok(viewerSrc.includes('cleanupCornerstone'), 'must define a cleanup routine');
    assert.ok(viewerSrc.includes('fileManager.remove'), 'must release the wadouri fileManager entry');
    assert.ok(viewerSrc.includes('imageCache.removeImageLoadObject'), 'must release the cornerstone image cache entry');
    assert.ok(viewerSrc.includes('cornerstone.disable'), 'must disable the cornerstone element');
    assert.ok(/return\s*\(\s*\)\s*=>\s*\{[\s\S]*cleanupCornerstone/.test(viewerSrc), 'cleanup must run in a useEffect teardown');
  });

  await test('DicomViewer guards against stale async results after unmount/image switch', () => {
    assert.ok(viewerSrc.includes('requestIdRef'), 'must track a request id to ignore superseded loads');
    assert.ok(/requestIdRef\.current\s*!==\s*myRequestId/.test(viewerSrc), 'must bail out when a newer request has started');
  });

  await test('DicomViewer is an accessible modal (role=dialog, aria-modal, focus trap/restore, Escape)', () => {
    assert.ok(viewerSrc.includes('role="dialog"'));
    assert.ok(viewerSrc.includes('aria-modal="true"'));
    assert.ok(viewerSrc.includes('aria-labelledby'));
    assert.ok(viewerSrc.includes("event.key === 'Escape'"));
    assert.ok(viewerSrc.includes('previouslyFocusedRef'), 'must restore focus to the previously focused element on close');
  });

  await test('multi-frame DICOM is explicitly reported as unsupported, never silently shown as single-frame', () => {
    assert.ok(/classifyDicomSupport\(dataSet\)\s*===\s*'multi-frame'/.test(viewerSrc));
    assert.ok(viewerSrc.includes("setState('multi-frame-unsupported')"));
  });

  // ── Standard image preview regression (unchanged) ─────────────────────────
  section('Standard image preview unaffected');

  const patientImagingSrc = src('../PatientImagingTab.tsx');
  const imagingQueueSrc = src('../../../pages/ImagingQueue.tsx');

  await test('PatientImagingTab still renders FilePreviewModal for non-DICOM images', () => {
    assert.ok(patientImagingSrc.includes('!isDicomImage(previewImage.image.mimeType)'));
    assert.ok(patientImagingSrc.includes('<FilePreviewModal'));
  });

  await test('ImagingQueue still renders FilePreviewModal for non-DICOM images', () => {
    assert.ok(imagingQueueSrc.includes('!isDicomImage(previewImage.image.mimeType)'));
    assert.ok(imagingQueueSrc.includes('<FilePreviewModal'));
  });

  await test('both call sites route DICOM images to DicomViewer instead', () => {
    assert.ok(patientImagingSrc.includes('<DicomViewer'));
    assert.ok(imagingQueueSrc.includes('<DicomViewer'));
  });

  // ── Image-switch remount regression ───────────────────────────────────────
  section('DicomViewer image-switch remount');

  const imageSpecificKeyPattern = /<DicomViewer\s+key=\{`\$\{previewImage\.study\.id\}:\$\{previewImage\.image\.id\}`\}/;

  await test('PatientImagingTab keys DicomViewer by study+image id so switching remounts it', () => {
    assert.ok(
      imageSpecificKeyPattern.test(patientImagingSrc),
      'DicomViewer must have a key combining study.id and image.id to force a remount on image switch',
    );
  });

  await test('ImagingQueue keys DicomViewer by study+image id so switching remounts it', () => {
    assert.ok(
      imageSpecificKeyPattern.test(imagingQueueSrc),
      'DicomViewer must have a key combining study.id and image.id to force a remount on image switch',
    );
  });

  // ── Test-suite integrity ────────────────────────────────────────────────────
  section('Test-suite integrity');

  await test('this test file contains no boolean-or-true assertion bypass', () => {
    // Built from parts so this check doesn't itself contain the banned
    // literal (which would make the assertion match its own source).
    const bypassPattern = ['|', '|', ' true'].join('');
    const selfSrc = src('./dicomHelpers.test.ts');
    assert.ok(!selfSrc.includes(bypassPattern), 'assertions must not be neutralized with an always-true fallback');
  });

  // ── Result ────────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
