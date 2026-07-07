/**
 * queue.test.ts — atomic directory-rename queue writes, local dedupe,
 * startup recovery (staging cleanup, processing reclaim, orphaned
 * file/metadata quarantine, malformed metadata quarantine — nothing
 * silently deleted), source file left untouched, generated filename
 * (never the original patient-derived name).
 *
 * Run with: tsx tests/queue.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test, section, summarizeAndExit, makeTmpDir, cleanupTmpDir } from './testHarness.js';
import { BridgeQueue } from '../src/queue.js';
import { Logger } from '../src/logger.js';
import { sha256Buffer } from '../src/hash.js';

function syntheticJpeg(): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
}

function makeQueue(root: string) {
  const logger = new Logger(path.join(root, 'logs'));
  const queue = new BridgeQueue(path.join(root, 'queue'), logger);
  return { queue, logger };
}

async function main() {
  section('Enqueue + atomic staging');

  await test('enqueue copies the source file, never touching/renaming the original', () => {
    const root = makeTmpDir('queue');
    try {
      const { queue } = makeQueue(root);
      const sourceDir = path.join(root, 'export');
      fs.mkdirSync(sourceDir, { recursive: true });
      const sourcePath = path.join(sourceDir, 'PatientName_Smith_Xray.jpg');
      const buffer = syntheticJpeg();
      fs.writeFileSync(sourcePath, buffer);

      const item = queue.enqueue(sourcePath, 'watch-1', 'device-1', 'IO');
      assert.ok(item, 'expected item to be queued');
      assert.ok(fs.existsSync(sourcePath), 'source file must remain untouched');
      assert.deepEqual(fs.readFileSync(sourcePath), buffer, 'source file content must be unchanged');
    } finally {
      cleanupTmpDir(root);
    }
  });

  await test('queued filename is <ingestKey><safeExtension>, never the original filename', () => {
    const root = makeTmpDir('queue');
    try {
      const { queue } = makeQueue(root);
      const sourceDir = path.join(root, 'export');
      fs.mkdirSync(sourceDir, { recursive: true });
      const sourcePath = path.join(sourceDir, 'PatientName_Smith_Xray.jpg');
      const buffer = syntheticJpeg();
      fs.writeFileSync(sourcePath, buffer);

      const item = queue.enqueue(sourcePath, 'watch-1', 'device-1', 'IO')!;
      const expectedIngestKey = sha256Buffer(buffer);
      assert.equal(item.meta.ingestKey, expectedIngestKey);
      assert.equal(path.basename(item.filePath), `file${item.meta.safeExtension}`);
      assert.ok(!item.filePath.includes('PatientName'), 'original filename must never appear in the queued path');
    } finally {
      cleanupTmpDir(root);
    }
  });

  await test('no staging directory remains after a successful enqueue', () => {
    const root = makeTmpDir('queue');
    try {
      const { queue } = makeQueue(root);
      const sourcePath = path.join(root, 'sample.jpg');
      fs.writeFileSync(sourcePath, syntheticJpeg());
      queue.enqueue(sourcePath, 'watch-1', 'device-1', undefined);
      const queueRoot = path.join(root, 'queue');
      const leftovers = fs.readdirSync(queueRoot).filter(e => e.startsWith('.staging-'));
      assert.equal(leftovers.length, 0);
    } finally {
      cleanupTmpDir(root);
    }
  });

  await test('unsupported file content is not queued', () => {
    const root = makeTmpDir('queue');
    try {
      const { queue } = makeQueue(root);
      const sourcePath = path.join(root, 'notes.txt');
      fs.writeFileSync(sourcePath, 'plain text, not an image');
      const item = queue.enqueue(sourcePath, 'watch-1', 'device-1', undefined);
      assert.equal(item, null);
    } finally {
      cleanupTmpDir(root);
    }
  });

  section('Local dedupe');

  await test('re-enqueueing identical content is skipped locally (no duplicate pending item)', () => {
    const root = makeTmpDir('queue');
    try {
      const { queue } = makeQueue(root);
      const sourcePath = path.join(root, 'sample.jpg');
      fs.writeFileSync(sourcePath, syntheticJpeg());
      const first = queue.enqueue(sourcePath, 'watch-1', 'device-1', undefined);
      const second = queue.enqueue(sourcePath, 'watch-1', 'device-1', undefined);
      assert.ok(first);
      assert.equal(second, null);
      assert.equal(queue.listState('pending').length, 1);
    } finally {
      cleanupTmpDir(root);
    }
  });

  section('State transitions');

  await test('moveToProcessing then complete removes the item entirely', () => {
    const root = makeTmpDir('queue');
    try {
      const { queue } = makeQueue(root);
      const sourcePath = path.join(root, 'sample.jpg');
      fs.writeFileSync(sourcePath, syntheticJpeg());
      const item = queue.enqueue(sourcePath, 'watch-1', 'device-1', undefined)!;
      queue.moveToProcessing(item.meta.ingestKey);
      assert.equal(queue.listState('pending').length, 0);
      queue.complete(item.meta.ingestKey);
      assert.equal(queue.listState('failed').length, 0);
      assert.equal(fs.existsSync(path.join(root, 'queue', 'processing', item.meta.ingestKey)), false);
    } finally {
      cleanupTmpDir(root);
    }
  });

  await test('fail() moves an item from processing to failed with an error category', () => {
    const root = makeTmpDir('queue');
    try {
      const { queue } = makeQueue(root);
      const sourcePath = path.join(root, 'sample.jpg');
      fs.writeFileSync(sourcePath, syntheticJpeg());
      const item = queue.enqueue(sourcePath, 'watch-1', 'device-1', undefined)!;
      queue.moveToProcessing(item.meta.ingestKey);
      queue.fail(item.meta.ingestKey, { ...item.meta, lastErrorCategory: 'bad_request' });
      const failedItems = queue.listState('failed');
      assert.equal(failedItems.length, 1);
      assert.equal(failedItems[0]!.meta.lastErrorCategory, 'bad_request');
    } finally {
      cleanupTmpDir(root);
    }
  });

  await test('requeueFailed resets attemptCount and moves back to pending', () => {
    const root = makeTmpDir('queue');
    try {
      const { queue } = makeQueue(root);
      const sourcePath = path.join(root, 'sample.jpg');
      fs.writeFileSync(sourcePath, syntheticJpeg());
      const item = queue.enqueue(sourcePath, 'watch-1', 'device-1', undefined)!;
      queue.moveToProcessing(item.meta.ingestKey);
      queue.fail(item.meta.ingestKey, { ...item.meta, attemptCount: 5, lastErrorCategory: 'max_attempts_exceeded' });
      const requeued = queue.requeueFailed(item.meta.ingestKey);
      assert.equal(requeued.meta.attemptCount, 0);
      assert.equal(queue.listState('pending').length, 1);
      assert.equal(queue.listState('failed').length, 0);
    } finally {
      cleanupTmpDir(root);
    }
  });

  section('Startup recovery');

  await test('leftover .staging-* directory is cleaned up on recovery', () => {
    const root = makeTmpDir('queue');
    try {
      const queueDir = path.join(root, 'queue');
      fs.mkdirSync(path.join(queueDir, 'pending'), { recursive: true });
      fs.mkdirSync(path.join(queueDir, 'processing'), { recursive: true });
      fs.mkdirSync(path.join(queueDir, 'failed'), { recursive: true });
      fs.mkdirSync(path.join(queueDir, '.staging-deadbeef'), { recursive: true });
      fs.writeFileSync(path.join(queueDir, '.staging-deadbeef', 'file.jpg'), 'partial');

      const logger = new Logger(path.join(root, 'logs'));
      const queue = new BridgeQueue(queueDir, logger);
      queue.recoverOnStartup();

      assert.equal(fs.existsSync(path.join(queueDir, '.staging-deadbeef')), false);
    } finally {
      cleanupTmpDir(root);
    }
  });

  await test('items left in processing/ after an unclean shutdown are reclaimed into pending/', () => {
    const root = makeTmpDir('queue');
    try {
      const { queue } = makeQueue(root);
      const sourcePath = path.join(root, 'sample.jpg');
      fs.writeFileSync(sourcePath, syntheticJpeg());
      const item = queue.enqueue(sourcePath, 'watch-1', 'device-1', undefined)!;
      queue.moveToProcessing(item.meta.ingestKey);

      queue.recoverOnStartup();

      assert.equal(queue.listState('processing').length, 0);
      assert.equal(queue.listState('pending').length, 1);
    } finally {
      cleanupTmpDir(root);
    }
  });

  await test('orphaned file without metadata is quarantined to failed/, not deleted', () => {
    const root = makeTmpDir('queue');
    try {
      const queueDir = path.join(root, 'queue');
      const itemDir = path.join(queueDir, 'pending', 'orphan123');
      fs.mkdirSync(itemDir, { recursive: true });
      fs.writeFileSync(path.join(itemDir, 'file.jpg'), syntheticJpeg());
      // meta.json bilerek yazılmadı

      const logger = new Logger(path.join(root, 'logs'));
      const queue = new BridgeQueue(queueDir, logger);
      queue.recoverOnStartup();

      assert.equal(fs.existsSync(path.join(queueDir, 'pending', 'orphan123')), false);
      const failedDir = path.join(queueDir, 'failed', 'orphan123');
      assert.ok(fs.existsSync(failedDir), 'orphaned item must be quarantined, not deleted');
      assert.ok(fs.existsSync(path.join(failedDir, 'file.jpg')), 'the image itself must be preserved');
    } finally {
      cleanupTmpDir(root);
    }
  });

  await test('orphaned metadata without a file is quarantined to failed/', () => {
    const root = makeTmpDir('queue');
    try {
      const queueDir = path.join(root, 'queue');
      const itemDir = path.join(queueDir, 'pending', 'orphan456');
      fs.mkdirSync(itemDir, { recursive: true });
      fs.writeFileSync(
        path.join(itemDir, 'meta.json'),
        JSON.stringify({
          ingestKey: 'orphan456',
          watchId: 'w',
          deviceId: 'd',
          contentType: 'image/jpeg',
          safeExtension: '.jpg',
          createdAt: new Date().toISOString(),
          attemptCount: 0,
          nextAttemptAt: new Date().toISOString(),
        }),
      );
      // file.jpg bilerek yazılmadı

      const logger = new Logger(path.join(root, 'logs'));
      const queue = new BridgeQueue(queueDir, logger);
      queue.recoverOnStartup();

      assert.equal(fs.existsSync(path.join(queueDir, 'pending', 'orphan456')), false);
      assert.ok(fs.existsSync(path.join(queueDir, 'failed', 'orphan456')));
    } finally {
      cleanupTmpDir(root);
    }
  });

  await test('malformed metadata JSON is quarantined to failed/ with a technical error category', () => {
    const root = makeTmpDir('queue');
    try {
      const queueDir = path.join(root, 'queue');
      const itemDir = path.join(queueDir, 'pending', 'malformed789');
      fs.mkdirSync(itemDir, { recursive: true });
      fs.writeFileSync(path.join(itemDir, 'file.jpg'), syntheticJpeg());
      fs.writeFileSync(path.join(itemDir, 'meta.json'), '{ not valid json');

      const logger = new Logger(path.join(root, 'logs'));
      const queue = new BridgeQueue(queueDir, logger);
      queue.recoverOnStartup();

      const failedDir = path.join(queueDir, 'failed', 'malformed789');
      assert.ok(fs.existsSync(failedDir));
      const meta = JSON.parse(fs.readFileSync(path.join(failedDir, 'meta.json'), 'utf8'));
      assert.equal(meta.lastErrorCategory, 'quarantined_malformed_metadata');
    } finally {
      cleanupTmpDir(root);
    }
  });

  await test('recovery is idempotent across repeated runs', () => {
    const root = makeTmpDir('queue');
    try {
      const { queue } = makeQueue(root);
      const sourcePath = path.join(root, 'sample.jpg');
      fs.writeFileSync(sourcePath, syntheticJpeg());
      queue.enqueue(sourcePath, 'watch-1', 'device-1', undefined);
      queue.recoverOnStartup();
      queue.recoverOnStartup();
      assert.equal(queue.listState('pending').length, 1);
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
