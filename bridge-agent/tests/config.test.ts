/**
 * config.test.ts — Zod config doğrulaması: HTTPS zorunluluğu, token dosyası
 * ayrımı, importExisting varsayılanı, çoklu watch doğrulaması.
 *
 * Run with: tsx tests/config.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test, section, summarizeAndExit, makeTmpDir, cleanupTmpDir } from './testHarness.js';
import { parseConfig, readToken, tokenFileFingerprint } from '../src/config.js';

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    serverUrl: 'https://api.noramedi.com',
    tokenFile: 'C:\\ProgramData\\NoraMediBridge\\bridge-token.txt',
    queueDir: 'C:\\ProgramData\\NoraMediBridge\\queue',
    logDir: 'C:\\ProgramData\\NoraMediBridge\\logs',
    watches: [{ path: 'C:\\Export', deviceId: 'device-1' }],
    ...overrides,
  };
}

async function main() {
  section('Valid config');

  await test('valid minimal config parses with defaults applied', () => {
    const cfg = parseConfig(baseConfig());
    assert.equal(cfg.importExisting, false);
    assert.equal(cfg.heartbeatIntervalSeconds, 60);
    assert.equal(cfg.stabilityMs, 5000);
    assert.equal(cfg.watches[0]!.deviceId, 'device-1');
    assert.ok(cfg.watches[0]!.watchId.length > 0, 'watchId must be derived when not explicitly set');
  });

  await test('importExisting defaults to false when omitted', () => {
    const cfg = parseConfig(baseConfig());
    assert.equal(cfg.importExisting, false);
  });

  await test('importExisting can be explicitly enabled', () => {
    const cfg = parseConfig(baseConfig({ importExisting: true }));
    assert.equal(cfg.importExisting, true);
  });

  await test('multiple watch folders are all validated and get distinct watchIds', () => {
    const cfg = parseConfig(
      baseConfig({
        watches: [
          { path: 'C:\\Export1', deviceId: 'device-1' },
          { path: 'C:\\Export2', deviceId: 'device-2' },
        ],
      }),
    );
    assert.equal(cfg.watches.length, 2);
    assert.notEqual(cfg.watches[0]!.watchId, cfg.watches[1]!.watchId);
  });

  await test('explicit watch id is honored and duplicates are rejected', () => {
    assert.throws(() =>
      parseConfig(
        baseConfig({
          watches: [
            { id: 'same', path: 'C:\\Export1', deviceId: 'device-1' },
            { id: 'same', path: 'C:\\Export2', deviceId: 'device-2' },
          ],
        }),
      ),
    );
  });

  section('Invalid config');

  await test('empty watches array is rejected', () => {
    assert.throws(() => parseConfig(baseConfig({ watches: [] })));
  });

  await test('missing deviceId on a watch is rejected', () => {
    assert.throws(() => parseConfig(baseConfig({ watches: [{ path: 'C:\\Export' }] })));
  });

  await test('malformed serverUrl is rejected', () => {
    assert.throws(() => parseConfig(baseConfig({ serverUrl: 'not-a-url' })));
  });

  section('Production HTTPS enforcement');

  await test('http:// is rejected for a non-localhost production host', () => {
    assert.throws(() => parseConfig(baseConfig({ serverUrl: 'http://api.noramedi.com' })));
  });

  await test('https:// is accepted for a production host', () => {
    assert.doesNotThrow(() => parseConfig(baseConfig({ serverUrl: 'https://api.noramedi.com' })));
  });

  await test('http://localhost is allowed as an explicit dev escape hatch', () => {
    assert.doesNotThrow(() => parseConfig(baseConfig({ serverUrl: 'http://localhost:4000' })));
  });

  await test('http://127.0.0.1 is allowed as an explicit dev escape hatch', () => {
    assert.doesNotThrow(() => parseConfig(baseConfig({ serverUrl: 'http://127.0.0.1:4000' })));
  });

  section('Token loaded from a separate file, never from config.json');

  await test('config schema has no token/secret field', () => {
    const cfg = parseConfig(baseConfig());
    assert.equal((cfg as unknown as Record<string, unknown>).token, undefined);
    assert.equal((cfg as unknown as Record<string, unknown>).bridgeToken, undefined);
    assert.ok('tokenFile' in cfg, 'only a path to a separate token file is allowed');
  });

  await test('readToken reads and trims the token file contents', () => {
    const dir = makeTmpDir('config');
    try {
      const tokenFile = path.join(dir, 'bridge-token.txt');
      fs.writeFileSync(tokenFile, '  nmb_abc123  \n');
      assert.equal(readToken(tokenFile), 'nmb_abc123');
    } finally {
      cleanupTmpDir(dir);
    }
  });

  await test('readToken throws on an empty token file', () => {
    const dir = makeTmpDir('config');
    try {
      const tokenFile = path.join(dir, 'bridge-token.txt');
      fs.writeFileSync(tokenFile, '   \n');
      assert.throws(() => readToken(tokenFile));
    } finally {
      cleanupTmpDir(dir);
    }
  });

  await test('tokenFileFingerprint changes when the token file content changes', () => {
    const dir = makeTmpDir('config');
    try {
      const tokenFile = path.join(dir, 'bridge-token.txt');
      fs.writeFileSync(tokenFile, 'nmb_old');
      const before = tokenFileFingerprint(tokenFile);
      fs.writeFileSync(tokenFile, 'nmb_new');
      const after = tokenFileFingerprint(tokenFile);
      assert.notEqual(before, after);
    } finally {
      cleanupTmpDir(dir);
    }
  });

  summarizeAndExit();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
