/**
 * watcher.test.ts — ignore rules (temp/partial/hidden/unsupported files),
 * stability wait, importExisting default (pre-existing files skipped
 * unless explicitly enabled), and watchId-only identification.
 *
 * Run with: tsx tests/watcher.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test, section, summarizeAndExit, makeTmpDir, cleanupTmpDir } from './testHarness.js';
import { isIgnoredPath, WatcherManager } from '../src/watcher.js';
import type { ResolvedWatch } from '../src/config.js';
import { Logger } from '../src/logger.js';
import { WATCHED_EXTENSIONS } from '../src/fileType.js';

function syntheticJpeg(): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
}

function waitFor(predicate: () => boolean, timeoutMs: number, intervalMs = 50): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timed out waiting for condition'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

async function main() {
  section('Ignore rules');

  await test('hidden (dotfile) is ignored', () => {
    assert.equal(isIgnoredPath('C:\\Export\\.hidden.jpg', WATCHED_EXTENSIONS), true);
  });

  for (const ext of ['.tmp', '.part', '.partial', '.crdownload']) {
    await test(`temporary extension ${ext} is ignored`, () => {
      assert.equal(isIgnoredPath(`C:\\Export\\scan${ext}`, WATCHED_EXTENSIONS), true);
    });
  }

  await test('unsupported extension is ignored', () => {
    assert.equal(isIgnoredPath('C:\\Export\\readme.txt', WATCHED_EXTENSIONS), true);
  });

  for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.dcm', '.dicom']) {
    await test(`supported extension ${ext} is not ignored`, () => {
      assert.equal(isIgnoredPath(`C:\\Export\\scan${ext}`, WATCHED_EXTENSIONS), false);
    });
  }

  await test('per-watch pattern override restricts the allowed set', () => {
    assert.equal(isIgnoredPath('C:\\Export\\scan.png', ['.jpg']), true);
    assert.equal(isIgnoredPath('C:\\Export\\scan.jpg', ['.jpg']), false);
  });

  section('importExisting default + stability (integration, real chokidar)');

  await test('pre-existing file is ignored by default (importExisting=false)', async () => {
    const root = makeTmpDir('watcher');
    try {
      const watchDir = path.join(root, 'export');
      fs.mkdirSync(watchDir, { recursive: true });
      const preExisting = path.join(watchDir, 'pre-existing.jpg');
      fs.writeFileSync(preExisting, syntheticJpeg());

      const seen: string[] = [];
      const watch: ResolvedWatch = { watchId: 'w1', path: watchDir, deviceId: 'device-1', extensions: WATCHED_EXTENSIONS };
      const logger = new Logger(path.join(root, 'logs'));
      const manager = new WatcherManager([watch], 200, false, filePath => seen.push(filePath), logger);
      manager.start();
      await new Promise(resolve => setTimeout(resolve, 500));
      manager.stop();

      assert.equal(seen.length, 0, 'pre-existing file must not trigger a stable-file callback');
    } finally {
      cleanupTmpDir(root);
    }
  });

  await test('a newly added stable file triggers the callback exactly once', async () => {
    const root = makeTmpDir('watcher');
    try {
      const watchDir = path.join(root, 'export');
      fs.mkdirSync(watchDir, { recursive: true });

      const seen: string[] = [];
      const watch: ResolvedWatch = { watchId: 'w1', path: watchDir, deviceId: 'device-1', extensions: WATCHED_EXTENSIONS };
      const logger = new Logger(path.join(root, 'logs'));
      const manager = new WatcherManager([watch], 150, false, filePath => seen.push(filePath), logger);
      manager.start();
      await new Promise(resolve => setTimeout(resolve, 200));

      fs.writeFileSync(path.join(watchDir, 'new-scan.jpg'), syntheticJpeg());
      await waitFor(() => seen.length > 0, 5000);
      manager.stop();

      assert.equal(seen.length, 1);
      assert.ok(seen[0]!.endsWith('new-scan.jpg'));
    } finally {
      cleanupTmpDir(root);
    }
  });

  await test('importExisting=true processes files that already existed at startup', async () => {
    const root = makeTmpDir('watcher');
    try {
      const watchDir = path.join(root, 'export');
      fs.mkdirSync(watchDir, { recursive: true });
      fs.writeFileSync(path.join(watchDir, 'already-here.jpg'), syntheticJpeg());

      const seen: string[] = [];
      const watch: ResolvedWatch = { watchId: 'w1', path: watchDir, deviceId: 'device-1', extensions: WATCHED_EXTENSIONS };
      const logger = new Logger(path.join(root, 'logs'));
      const manager = new WatcherManager([watch], 150, true, filePath => seen.push(filePath), logger);
      manager.start();
      await waitFor(() => seen.length > 0, 5000);
      manager.stop();

      assert.equal(seen.length, 1);
    } finally {
      cleanupTmpDir(root);
    }
  });

  section('watchId is the only folder identifier surfaced to callers');

  await test('availability() reports watchId, not the filesystem path', async () => {
    const root = makeTmpDir('watcher');
    try {
      const watchDir = path.join(root, 'export');
      fs.mkdirSync(watchDir, { recursive: true });
      const watch: ResolvedWatch = { watchId: 'my-watch-id', path: watchDir, deviceId: 'device-1', extensions: WATCHED_EXTENSIONS };
      const logger = new Logger(path.join(root, 'logs'));
      const manager = new WatcherManager([watch], 150, false, () => {}, logger);
      manager.start();
      await new Promise(resolve => setTimeout(resolve, 200));
      const availability = manager.availability();
      manager.stop();

      assert.equal(availability.length, 1);
      assert.equal(availability[0]!.watchId, 'my-watch-id');
      assert.equal(availability[0]!.available, true);
      assert.equal(JSON.stringify(availability).includes(watchDir), false, 'raw path must not leak into availability output');
    } finally {
      cleanupTmpDir(root);
    }
  });

  summarizeAndExit();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
