/**
 * digidentisSigning.test.ts — DigiDentiS v3.2.0 per-request HMAC
 * authentication and webhook signature verification (DigiDentisSigning.ts).
 *
 * See DigiDentisSigning.ts's header comment: the header names
 * (X-Client-ID/X-Timestamp/X-Nonce/X-Signature, X-Webhook-Signature) and the
 * HMAC-SHA256 algorithm are per this task's explicit specification. The
 * byte-for-byte signing-string layout is an assumed placeholder pending real
 * v3.2.0 documentation, so these tests verify the module's own internal
 * correctness/security properties (deterministic, tamper-evident,
 * constant-time-safe) rather than conformance to a real DigiDentiS server.
 *
 * Run with: npx tsx src/tests/digidentisSigning.test.ts
 */

import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import {
  buildDigiDentisSigningString,
  generateDigiDentisNonce,
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

section('API request signing — headers');

test('signs with the exact documented header names', () => {
  const headers = signDigiDentisRequest('client-123', 'super-secret', 'GET', '/companies', Buffer.alloc(0), 1000, 'nonce-1');
  assert.deepEqual(Object.keys(headers).sort(), ['X-Client-ID', 'X-Nonce', 'X-Signature', 'X-Timestamp'].sort());
  assert.equal(headers['X-Client-ID'], 'client-123');
  assert.equal(headers['X-Timestamp'], '1000');
  assert.equal(headers['X-Nonce'], 'nonce-1');
});

test('no Authorization/Bearer header is produced — HMAC signing IS the auth', () => {
  const headers = signDigiDentisRequest('client-123', 'secret', 'GET', '/companies', Buffer.alloc(0), 1000, 'nonce-1');
  assert.equal((headers as any).Authorization, undefined);
});

test('a fresh nonce is generated per call when none is supplied', () => {
  const a = signDigiDentisRequest('c1', 's1', 'GET', '/companies', Buffer.alloc(0), 1000);
  const b = signDigiDentisRequest('c1', 's1', 'GET', '/companies', Buffer.alloc(0), 1000);
  assert.notEqual(a['X-Nonce'], b['X-Nonce']);
});

test('generateDigiDentisNonce returns 32 hex chars (16 random bytes)', () => {
  const nonce = generateDigiDentisNonce();
  assert.match(nonce, /^[0-9a-f]{32}$/);
});

section('API request signing — signature correctness');

test('signature matches independently-computed HMAC over the signing string', () => {
  const clientId = 'client-123';
  const clientSecret = 'super-secret';
  const method = 'POST';
  const path = '/clinics/ext-clinic-1/appointments';
  const body = Buffer.from(JSON.stringify({ doctorId: 'doc-1' }));
  const timestamp = 1700000000000;
  const nonce = 'fixed-nonce';

  const headers = signDigiDentisRequest(clientId, clientSecret, method, path, body, timestamp, nonce);

  const expectedSigningString = buildDigiDentisSigningString(method, path, String(timestamp), nonce, sha256Hex(body));
  const expectedSignature = createHmac('sha256', clientSecret).update(expectedSigningString).digest('hex');

  assert.equal(headers['X-Signature'], expectedSignature);
});

test('signature changes if the body changes (tamper-evident)', () => {
  const a = signDigiDentisRequest('c1', 's1', 'POST', '/x', Buffer.from('{"a":1}'), 1000, 'n1');
  const b = signDigiDentisRequest('c1', 's1', 'POST', '/x', Buffer.from('{"a":2}'), 1000, 'n1');
  assert.notEqual(a['X-Signature'], b['X-Signature']);
});

test('signature changes if the path changes', () => {
  const a = signDigiDentisRequest('c1', 's1', 'GET', '/companies', Buffer.alloc(0), 1000, 'n1');
  const b = signDigiDentisRequest('c1', 's1', 'GET', '/doctors', Buffer.alloc(0), 1000, 'n1');
  assert.notEqual(a['X-Signature'], b['X-Signature']);
});

test('signature changes if the timestamp changes', () => {
  const a = signDigiDentisRequest('c1', 's1', 'GET', '/companies', Buffer.alloc(0), 1000, 'n1');
  const b = signDigiDentisRequest('c1', 's1', 'GET', '/companies', Buffer.alloc(0), 2000, 'n1');
  assert.notEqual(a['X-Signature'], b['X-Signature']);
});

test('signature changes if the nonce changes (replay resistance)', () => {
  const a = signDigiDentisRequest('c1', 's1', 'GET', '/companies', Buffer.alloc(0), 1000, 'n1');
  const b = signDigiDentisRequest('c1', 's1', 'GET', '/companies', Buffer.alloc(0), 1000, 'n2');
  assert.notEqual(a['X-Signature'], b['X-Signature']);
});

test('signature changes if the client secret changes', () => {
  const a = signDigiDentisRequest('c1', 'secret-a', 'GET', '/companies', Buffer.alloc(0), 1000, 'n1');
  const b = signDigiDentisRequest('c1', 'secret-b', 'GET', '/companies', Buffer.alloc(0), 1000, 'n1');
  assert.notEqual(a['X-Signature'], b['X-Signature']);
});

section('Webhook signature verification');

test('valid signature verifies successfully', () => {
  const secret = 'webhook-secret';
  const body = Buffer.from(JSON.stringify({ type: 'appointment.created' }));
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyDigiDentisWebhookSignature(body, signature, secret), true);
});

test('tampered body fails verification', () => {
  const secret = 'webhook-secret';
  const original = Buffer.from(JSON.stringify({ type: 'appointment.created' }));
  const signature = createHmac('sha256', secret).update(original).digest('hex');
  const tampered = Buffer.from(JSON.stringify({ type: 'appointment.cancelled' }));
  assert.equal(verifyDigiDentisWebhookSignature(tampered, signature, secret), false);
});

test('wrong secret fails verification', () => {
  const body = Buffer.from('{}');
  const signature = createHmac('sha256', 'right-secret').update(body).digest('hex');
  assert.equal(verifyDigiDentisWebhookSignature(body, signature, 'wrong-secret'), false);
});

test('missing signature header fails verification', () => {
  assert.equal(verifyDigiDentisWebhookSignature(Buffer.from('{}'), undefined, 'secret'), false);
});

test('missing secret fails verification (never treated as "unsigned OK")', () => {
  const body = Buffer.from('{}');
  const signature = createHmac('sha256', 'x').update(body).digest('hex');
  assert.equal(verifyDigiDentisWebhookSignature(body, signature, ''), false);
});

test('malformed signature header (not a hex digest) fails, does not throw', () => {
  assert.equal(verifyDigiDentisWebhookSignature(Buffer.from('{}'), 'not-a-real-signature', 'secret'), false);
});

test('signature comparison is case-insensitive on hex casing', () => {
  const secret = 'webhook-secret';
  const body = Buffer.from('{"a":1}');
  const signature = createHmac('sha256', secret).update(body).digest('hex').toUpperCase();
  assert.equal(verifyDigiDentisWebhookSignature(body, signature, secret), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
