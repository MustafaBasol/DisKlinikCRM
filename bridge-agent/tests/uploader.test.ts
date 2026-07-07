/**
 * uploader.test.ts — response classification, backoff curve (injected fake
 * clock/jitter asserting the documented ~24h/15-min-cap window), multipart
 * request shape (generated filename, no studyDate, no original filename),
 * duplicate:true treated as success, 401 handling.
 *
 * Run with: tsx tests/uploader.test.ts
 */
import assert from 'node:assert/strict';
import { test, section, summarizeAndExit } from './testHarness.js';
import {
  classifyStatus,
  permanentErrorCategory,
  computeBackoffMs,
  cumulativeBackoffMs,
  attemptUpload,
} from '../src/uploader.js';
import type { QueueMeta } from '../src/queue.js';

function sampleMeta(overrides: Partial<QueueMeta> = {}): QueueMeta {
  return {
    ingestKey: 'a'.repeat(64),
    watchId: 'watch-1',
    deviceId: 'device-1',
    modality: 'IO',
    contentType: 'image/jpeg',
    safeExtension: '.jpg',
    createdAt: new Date().toISOString(),
    attemptCount: 0,
    nextAttemptAt: new Date().toISOString(),
    ...overrides,
  };
}

async function main() {
  section('Response classification');

  await test('201 and 200 classify as success', () => {
    assert.equal(classifyStatus(201), 'success');
    assert.equal(classifyStatus(200), 'success');
  });

  await test('401 classifies as auth_failure', () => {
    assert.equal(classifyStatus(401), 'auth_failure');
  });

  await test('400/404/413 classify as permanent', () => {
    assert.equal(classifyStatus(400), 'permanent');
    assert.equal(classifyStatus(404), 'permanent');
    assert.equal(classifyStatus(413), 'permanent');
  });

  await test('429 and 5xx classify as retryable', () => {
    assert.equal(classifyStatus(429), 'retryable');
    assert.equal(classifyStatus(500), 'retryable');
    assert.equal(classifyStatus(503), 'retryable');
  });

  await test('permanentErrorCategory maps status to a safe technical category', () => {
    assert.equal(permanentErrorCategory(400), 'bad_request');
    assert.equal(permanentErrorCategory(404), 'device_not_found');
    assert.equal(permanentErrorCategory(413), 'file_too_large');
  });

  section('Backoff curve (deterministic: jitter fixed at 0)');

  const opts = { baseMs: 60_000, capMs: 900_000, jitterFn: () => 0 };

  await test('backoff doubles from the base until it reaches the cap', () => {
    assert.equal(computeBackoffMs(0, opts), 60_000);
    assert.equal(computeBackoffMs(1, opts), 120_000);
    assert.equal(computeBackoffMs(2, opts), 240_000);
    assert.equal(computeBackoffMs(3, opts), 480_000);
  });

  await test('backoff is capped at 15 minutes and never exceeds it', () => {
    assert.equal(computeBackoffMs(4, opts), 900_000);
    assert.equal(computeBackoffMs(10, opts), 900_000);
    assert.equal(computeBackoffMs(50, opts), 900_000);
  });

  await test('jitter adds up to 10% on top of the raw delay', () => {
    const delay = computeBackoffMs(0, { ...opts, jitterFn: () => 0.1 });
    assert.equal(delay, 66_000);
  });

  await test('cumulative retry time across the default maxAttempts is approximately 24 hours', () => {
    const maxAttempts = 100;
    const totalMs = cumulativeBackoffMs(maxAttempts, opts);
    const hours = totalMs / (1000 * 60 * 60);
    assert.ok(hours >= 20 && hours <= 28, `expected ~24h of cumulative retrying, got ${hours.toFixed(1)}h`);
  });

  section('Multipart request shape');

  await test('upload uses the generated <ingestKey><safeExtension> filename, never an original filename', async () => {
    let capturedFilename: string | null = null;
    const fakeFetch: typeof fetch = async (_url, init) => {
      const form = init!.body as FormData;
      const file = form.get('file') as File;
      capturedFilename = file.name;
      return new Response(JSON.stringify({ ok: true, studyId: 'study-1', duplicate: false }), { status: 201 });
    };
    const meta = sampleMeta();
    await attemptUpload(meta, Buffer.from('fake-jpeg-bytes'), 'nmb_test-token', {
      serverUrl: 'https://api.noramedi.com',
      fetchImpl: fakeFetch,
    });
    assert.equal(capturedFilename, `${meta.ingestKey}${meta.safeExtension}`);
  });

  await test('studyDate is never included in the multipart body', async () => {
    let hadStudyDate = false;
    const fakeFetch: typeof fetch = async (_url, init) => {
      const form = init!.body as FormData;
      hadStudyDate = form.has('studyDate');
      return new Response(JSON.stringify({ ok: true, studyId: 's', duplicate: false }), { status: 201 });
    };
    await attemptUpload(sampleMeta(), Buffer.from('x'), 'token', {
      serverUrl: 'https://api.noramedi.com',
      fetchImpl: fakeFetch,
    });
    assert.equal(hadStudyDate, false);
  });

  await test('ingestKey and deviceId are sent as form fields', async () => {
    let fields: Record<string, string> = {};
    const fakeFetch: typeof fetch = async (_url, init) => {
      const form = init!.body as FormData;
      fields.ingestKey = form.get('ingestKey') as string;
      fields.deviceId = form.get('deviceId') as string;
      return new Response(JSON.stringify({ ok: true, studyId: 's', duplicate: false }), { status: 201 });
    };
    const meta = sampleMeta();
    await attemptUpload(meta, Buffer.from('x'), 'token', {
      serverUrl: 'https://api.noramedi.com',
      fetchImpl: fakeFetch,
    });
    assert.equal(fields.ingestKey, meta.ingestKey);
    assert.equal(fields.deviceId, meta.deviceId);
  });

  await test('Authorization header carries the Bearer token', async () => {
    let authHeader: string | null = null;
    const fakeFetch: typeof fetch = async (_url, init) => {
      authHeader = (init!.headers as Record<string, string>).Authorization ?? null;
      return new Response(JSON.stringify({ ok: true, studyId: 's', duplicate: false }), { status: 201 });
    };
    await attemptUpload(sampleMeta(), Buffer.from('x'), 'nmb_secret-token', {
      serverUrl: 'https://api.noramedi.com',
      fetchImpl: fakeFetch,
    });
    assert.equal(authHeader, 'Bearer nmb_secret-token');
  });

  section('Outcome handling');

  await test('duplicate:true is treated as success (not an error)', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ ok: true, studyId: 'existing-study', duplicate: true }), { status: 200 });
    const outcome = await attemptUpload(sampleMeta(), Buffer.from('x'), 'token', {
      serverUrl: 'https://api.noramedi.com',
      fetchImpl: fakeFetch,
    });
    assert.equal(outcome.category, 'success');
    assert.equal(outcome.duplicate, true);
    assert.equal(outcome.studyId, 'existing-study');
  });

  await test('a network/timeout error is classified as retryable, not permanent', async () => {
    const fakeFetch: typeof fetch = async () => {
      throw new Error('network unreachable');
    };
    const outcome = await attemptUpload(sampleMeta(), Buffer.from('x'), 'token', {
      serverUrl: 'https://api.noramedi.com',
      fetchImpl: fakeFetch,
    });
    assert.equal(outcome.category, 'retryable');
    assert.equal(outcome.networkError, true);
  });

  await test('a 401 response is classified as auth_failure', async () => {
    const fakeFetch: typeof fetch = async () => new Response('{}', { status: 401 });
    const outcome = await attemptUpload(sampleMeta(), Buffer.from('x'), 'token', {
      serverUrl: 'https://api.noramedi.com',
      fetchImpl: fakeFetch,
    });
    assert.equal(outcome.category, 'auth_failure');
  });

  await test('a 404 response is classified as permanent with device_not_found', async () => {
    const fakeFetch: typeof fetch = async () => new Response('{}', { status: 404 });
    const outcome = await attemptUpload(sampleMeta(), Buffer.from('x'), 'token', {
      serverUrl: 'https://api.noramedi.com',
      fetchImpl: fakeFetch,
    });
    assert.equal(outcome.category, 'permanent');
    assert.equal(outcome.errorCategory, 'device_not_found');
  });

  summarizeAndExit();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
