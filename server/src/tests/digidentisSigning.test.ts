/**
 * digidentisSigning.test.ts — DigiDentiS v3.2.0 request signing and webhook
 * signature verification (DigiDentisSigning.ts).
 *
 * See DigiDentisSigning.ts's header comment: the exact v3.2.0 scheme is an
 * assumed placeholder pending real documentation. These tests verify the
 * module's own internal correctness/security properties (deterministic,
 * tamper-evident, constant-time-safe) — not conformance to a real DigiDentiS
 * server, which cannot be verified without the real spec.
 *
 * Run with: npx tsx src/tests/digidentisSigning.test.ts
 */

import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import {
  buildDigiDentisCanonicalString,
  sha256Hex,
  signDigiDentisRequest,
  verifyDigiDentisWebhookSignature,
} from '../services/externalCalendar/digidentis/DigiDentisSigning.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

section('API request signing');

test('signature matches independently-computed HMAC over the canonical string', () => {
  const clientId = 'client-123';
  const clientSecret = 'super-secret';
  const method = 'POST';
  const path = '/clinics/ext-clinic-1/appointments';
  const body = Buffer.from(JSON.stringify({ doctorId: 'doc-1' }));
  const timestamp = 1700000000000;

  const headers = signDigiDentisRequest(clientId, clientSecret, method, path, body, timestamp);

  const expectedCanonical = buildDigiDentisCanonicalString(method, path, String(timestamp), sha256Hex(body));
  const expectedSignature = createHmac('sha256', clientSecret).update(expectedCanonical).digest('hex');

  assert.equal(headers['X-DigiDentiS-Signature'], expectedSignature);
  assert.equal(headers['X-DigiDentiS-Client-Id'], clientId);
  assert.equal(headers['X-DigiDentiS-Timestamp'], String(timestamp));
});

test('signature changes if the body changes (tamper-evident)', () => {
  const a = signDigiDentisRequest('c1', 's1', 'POST', '/x', Buffer.from('{"a":1}'), 1000);
  const b = signDigiDentisRequest('c1', 's1', 'POST', '/x', Buffer.from('{"a":2}'), 1000);
  assert.notEqual(a['X-DigiDentiS-Signature'], b['X-DigiDentiS-Signature']);
});

test('signature changes if the path changes', () => {
  const a = signDigiDentisRequest('c1', 's1', 'GET', '/companies', Buffer.alloc(0), 1000);
  const b = signDigiDentisRequest('c1', 's1', 'GET', '/doctors', Buffer.alloc(0), 1000);
  assert.notEqual(a['X-DigiDentiS-Signature'], b['X-DigiDentiS-Signature']);
});

test('signature changes if the client secret changes', () => {
  const a = signDigiDentisRequest('c1', 'secret-a', 'GET', '/companies', Buffer.alloc(0), 1000);
  const b = signDigiDentisRequest('c1', 'secret-b', 'GET', '/companies', Buffer.alloc(0), 1000);
  assert.notEqual(a['X-DigiDentiS-Signature'], b['X-DigiDentiS-Signature']);
});

section('Webhook signature verification');

test('valid signature verifies successfully', () => {
  const secret = 'webhook-secret';
  const body = Buffer.from(JSON.stringify({ type: 'appointment.created' }));
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  assert.equal(verifyDigiDentisWebhookSignature(body, signature, secret), true);
});

test('tampered body fails verification', () => {
  const secret = 'webhook-secret';
  const original = Buffer.from(JSON.stringify({ type: 'appointment.created' }));
  const signature = `sha256=${createHmac('sha256', secret).update(original).digest('hex')}`;
  const tampered = Buffer.from(JSON.stringify({ type: 'appointment.cancelled' }));
  assert.equal(verifyDigiDentisWebhookSignature(tampered, signature, secret), false);
});

test('wrong secret fails verification', () => {
  const body = Buffer.from('{}');
  const signature = `sha256=${createHmac('sha256', 'right-secret').update(body).digest('hex')}`;
  assert.equal(verifyDigiDentisWebhookSignature(body, signature, 'wrong-secret'), false);
});

test('missing signature header fails verification', () => {
  assert.equal(verifyDigiDentisWebhookSignature(Buffer.from('{}'), undefined, 'secret'), false);
});

test('missing secret fails verification (never treated as "unsigned OK")', () => {
  const body = Buffer.from('{}');
  const signature = `sha256=${createHmac('sha256', 'x').update(body).digest('hex')}`;
  assert.equal(verifyDigiDentisWebhookSignature(body, signature, ''), false);
});

test('malformed signature header (not sha256=<hex>) fails, does not throw', () => {
  assert.equal(verifyDigiDentisWebhookSignature(Buffer.from('{}'), 'not-a-real-signature', 'secret'), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
