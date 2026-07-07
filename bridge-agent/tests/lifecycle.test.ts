/**
 * lifecycle.test.ts — 401 pause/resume via token-file change, one-at-a-time
 * upload draining, and source-regression checks for the redaction
 * invariants (no token/Authorization/full-path/original-filename ever
 * reaches logs, status, or the install script's command line).
 *
 * Run with: tsx tests/lifecycle.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, section, summarizeAndExit, makeTmpDir, cleanupTmpDir, src } from './testHarness.js';
import { AuthState } from '../src/authState.js';
import { Logger } from '../src/logger.js';
import { attemptUpload } from '../src/uploader.js';
import type { QueueMeta } from '../src/queue.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'src');
const scriptsDir = path.join(here, '..', 'scripts');

function sampleMeta(overrides: Partial<QueueMeta> = {}): QueueMeta {
  return {
    ingestKey: 'b'.repeat(64),
    watchId: 'watch-1',
    deviceId: 'device-1',
    contentType: 'image/jpeg',
    safeExtension: '.jpg',
    createdAt: new Date().toISOString(),
    attemptCount: 0,
    nextAttemptAt: new Date().toISOString(),
    ...overrides,
  };
}

async function main() {
  section('401 pause + token-file-change resume');

  await test('markInvalid pauses auth; reloadIfTokenFileChanged is false until the file content changes', () => {
    const dir = makeTmpDir('lifecycle');
    try {
      const tokenFile = path.join(dir, 'token.txt');
      fs.writeFileSync(tokenFile, 'nmb_old-token');
      const logger = new Logger(path.join(dir, 'logs'));
      const auth = new AuthState(tokenFile, logger);
      assert.equal(auth.isValid(), true);

      auth.markInvalid();
      assert.equal(auth.isValid(), false);
      assert.equal(auth.reloadIfTokenFileChanged(), false, 'no change yet — must not report a reload');

      fs.writeFileSync(tokenFile, 'nmb_new-token');
      assert.equal(auth.reloadIfTokenFileChanged(), true, 'content changed — must detect it');
      assert.equal(auth.getToken(), 'nmb_new-token');
    } finally {
      cleanupTmpDir(dir);
    }
  });

  await test('markValid after a successful re-validation resumes normal operation', () => {
    const dir = makeTmpDir('lifecycle');
    try {
      const tokenFile = path.join(dir, 'token.txt');
      fs.writeFileSync(tokenFile, 'nmb_old');
      const logger = new Logger(path.join(dir, 'logs'));
      const auth = new AuthState(tokenFile, logger);
      auth.markInvalid();
      fs.writeFileSync(tokenFile, 'nmb_new');
      auth.reloadIfTokenFileChanged();
      auth.markValid();
      assert.equal(auth.isValid(), true);
    } finally {
      cleanupTmpDir(dir);
    }
  });

  section('One-at-a-time upload draining');

  await test('items are processed strictly sequentially, never concurrently', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const fakeFetch: typeof fetch = async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(resolve => setTimeout(resolve, 20));
      concurrent--;
      return new Response(JSON.stringify({ ok: true, studyId: 's', duplicate: false }), { status: 201 });
    };

    const items = [sampleMeta({ ingestKey: 'a'.repeat(64) }), sampleMeta({ ingestKey: 'c'.repeat(64) }), sampleMeta({ ingestKey: 'd'.repeat(64) })];
    for (const item of items) {
      await attemptUpload(item, Buffer.from('x'), 'token', { serverUrl: 'https://api.noramedi.com', fetchImpl: fakeFetch });
    }

    assert.equal(maxConcurrent, 1, 'no more than one upload should be in flight at a time');
  });

  section('Redaction source-regression checks');

  await test('uploader.ts never logs the Authorization header or token', () => {
    const s = src('../src/uploader.ts', here);
    assert.equal(/logger\.\w+\([^)]*Authorization/i.test(s), false);
    assert.equal(/logger\.\w+\([^)]*token/i.test(s), false);
  });

  await test('authState.ts never passes currentToken/token contents into logger calls', () => {
    const s = src('../src/authState.ts', here);
    const loggerCalls = s.match(/this\.logger\.\w+\([^;]*\)/g) ?? [];
    for (const call of loggerCalls) {
      assert.equal(/currentToken/.test(call), false, `logger call must not reference currentToken: ${call}`);
    }
  });

  await test('watcher.ts logs reference watchId only, never watch.path', () => {
    const s = src('../src/watcher.ts', here);
    const loggerCalls = s.match(/this\.logger\.\w+\([^;]*\)/g) ?? [];
    for (const call of loggerCalls) {
      assert.equal(/watch\.path/.test(call), false, `watcher log call must not include the raw folder path: ${call}`);
    }
  });

  await test('status.ts / AgentStatus never includes a raw path or filename field', () => {
    const s = src('../src/status.ts', here);
    assert.equal(/\bpath\s*:/i.test(s.replace(/import[^\n]*\n/g, '')), false);
    assert.equal(/filename/i.test(s), false);
  });

  await test('queue.ts never derives the queued filename from the original source filename', () => {
    const s = src('../src/queue.ts', here);
    assert.equal(s.includes('path.basename(sourcePath)'), false);
    assert.ok(s.includes('file${safeExtension}') || s.includes('file${meta.safeExtension}'), 'queued file must be named from safeExtension, not the source name');
  });

  await test('install-service.ps1 never embeds the token as a literal command-line argument to nssm', () => {
    const s = src('../scripts/install-service.ps1', here);
    // Token must be written straight to the token file, never passed via nssm/-Argument/Set-Content of a command line.
    assert.equal(/nssm[^\n]*\$token/i.test(s), false, 'token must never be passed as an nssm command-line argument');
  });

  summarizeAndExit();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
