/**
 * textEncoding.test.ts — packaged .ps1 UTF-8 BOM regression test.
 * scripts/textEncoding.mjs is plain JS consumed by scripts/package.mjs
 * (not part of the tsc/tsx source graph), so it is loaded via a dynamic
 * import with a URL argument — tsc does not try to resolve type
 * declarations for a non-literal import() specifier.
 *
 * Run with: tsx tests/textEncoding.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, section, summarizeAndExit } from './testHarness.js';

const textEncodingUrl = new URL('../scripts/textEncoding.mjs', import.meta.url);
const scriptsDirPath = fileURLToPath(new URL('../scripts/', import.meta.url));

interface TextEncodingModule {
  hasUtf8Bom(buffer: Buffer): boolean;
  ensureUtf8Bom(buffer: Buffer): Buffer;
}

const UTF8_BOM_BYTES = [0xef, 0xbb, 0xbf];

async function main() {
  const mod = (await import(textEncodingUrl.href)) as unknown as TextEncodingModule;

  section('ensureUtf8Bom');

  await test('prepends the UTF-8 BOM (EF BB BF) to a buffer that lacks one', () => {
    const input = Buffer.from('#Requires -RunAsAdministrator\r\n', 'utf8');
    const result = mod.ensureUtf8Bom(input);
    assert.deepEqual([...result.subarray(0, 3)], UTF8_BOM_BYTES);
    assert.equal(result.subarray(3).toString('utf8'), input.toString('utf8'));
  });

  await test('does not double an existing BOM', () => {
    const input = Buffer.concat([Buffer.from(UTF8_BOM_BYTES), Buffer.from('#Requires', 'utf8')]);
    const result = mod.ensureUtf8Bom(input);
    assert.equal(result.length, input.length);
    assert.equal(result.toString('utf8'), input.toString('utf8'));
  });

  await test('preserves non-ASCII content (em-dash) unmodified', () => {
    const input = Buffer.from('Windows service installer — NoraMedi', 'utf8');
    const result = mod.ensureUtf8Bom(input);
    assert.equal(result.subarray(3).toString('utf8'), input.toString('utf8'));
  });

  section('hasUtf8Bom');

  await test('detects a present BOM', () => {
    assert.equal(mod.hasUtf8Bom(Buffer.from([0xef, 0xbb, 0xbf, 0x41])), true);
  });

  await test('detects a missing BOM', () => {
    assert.equal(mod.hasUtf8Bom(Buffer.from('#Requires', 'utf8')), false);
  });

  section('every packaged *.ps1 source file gains a UTF-8 BOM when processed');

  await test('applying ensureUtf8Bom to each scripts/*.ps1 file yields BOM-prefixed bytes EF BB BF', () => {
    const files = fs.readdirSync(scriptsDirPath).filter(f => f.endsWith('.ps1'));
    assert.ok(files.length > 0, 'expected at least one .ps1 script to exist');
    for (const file of files) {
      const raw = fs.readFileSync(path.join(scriptsDirPath, file));
      const withBom = mod.ensureUtf8Bom(raw);
      assert.deepEqual(
        [...withBom.subarray(0, 3)],
        UTF8_BOM_BYTES,
        `${file} did not get a UTF-8 BOM applied`,
      );
    }
  });

  summarizeAndExit();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
