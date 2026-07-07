/**
 * hash.test.ts — sha256 determinism + ingestKey format (64 lowercase hex,
 * exactly matching the server's regex).
 *
 * Run with: tsx tests/hash.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test, section, summarizeAndExit, makeTmpDir, cleanupTmpDir } from './testHarness.js';
import { sha256Buffer, sha256File, INGEST_KEY_PATTERN } from '../src/hash.js';
import { detectContentType, safeExtensionFor } from '../src/fileType.js';

function syntheticJpeg(): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
}
function syntheticPng(): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
}
function syntheticWebp(): Buffer {
  const riff = Buffer.from('RIFF', 'ascii');
  const size = Buffer.alloc(4);
  const webp = Buffer.from('WEBP', 'ascii');
  return Buffer.concat([riff, size, webp, Buffer.alloc(32, 1)]);
}
function syntheticDicomPart10(): Buffer {
  const buf = Buffer.alloc(200, 0);
  buf.write('DICM', 128, 'ascii');
  return buf;
}

async function main() {
  section('sha256 determinism');

  await test('same content produces the same hash', () => {
    const a = sha256Buffer(syntheticJpeg());
    const b = sha256Buffer(syntheticJpeg());
    assert.equal(a, b);
  });

  await test('different content produces different hashes', () => {
    const a = sha256Buffer(syntheticJpeg());
    const b = sha256Buffer(syntheticPng());
    assert.notEqual(a, b);
  });

  await test('ingestKey is exactly 64 lowercase hex characters', () => {
    const key = sha256Buffer(syntheticJpeg());
    assert.equal(key.length, 64);
    assert.match(key, INGEST_KEY_PATTERN);
    assert.equal(key, key.toLowerCase());
  });

  await test('sha256File matches sha256Buffer for the same content', async () => {
    const dir = makeTmpDir('hash');
    try {
      const filePath = path.join(dir, 'sample.jpg');
      const buffer = syntheticJpeg();
      fs.writeFileSync(filePath, buffer);
      const fromFile = await sha256File(filePath);
      assert.equal(fromFile, sha256Buffer(buffer));
    } finally {
      cleanupTmpDir(dir);
    }
  });

  section('MIME / safe-extension detection (matches server imagingUploadValidation.ts)');

  await test('JPEG magic bytes detected', () => {
    assert.equal(detectContentType(syntheticJpeg()), 'image/jpeg');
    assert.equal(safeExtensionFor('image/jpeg'), '.jpg');
  });

  await test('PNG magic bytes detected', () => {
    assert.equal(detectContentType(syntheticPng()), 'image/png');
    assert.equal(safeExtensionFor('image/png'), '.png');
  });

  await test('WebP magic bytes detected (server supports WebP — agent must match)', () => {
    assert.equal(detectContentType(syntheticWebp()), 'image/webp');
    assert.equal(safeExtensionFor('image/webp'), '.webp');
  });

  await test('DICOM Part-10 magic bytes detected', () => {
    assert.equal(detectContentType(syntheticDicomPart10()), 'application/dicom');
    assert.equal(safeExtensionFor('application/dicom'), '.dcm');
  });

  await test('unrecognized content returns null (never queued)', () => {
    assert.equal(detectContentType(Buffer.alloc(64, 0x41)), null);
  });

  summarizeAndExit();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
