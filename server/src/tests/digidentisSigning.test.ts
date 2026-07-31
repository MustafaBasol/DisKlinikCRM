/**
 * digidentisSigning.test.ts — DigiDentiS Takvim API v3.2.0 per-request HMAC
 * authentication and webhook signature verification (DigiDentisSigning.ts).
 *
 * Includes fixture tests transcribed verbatim from the real vendor
 * documentation (`docs/vendor/digidentis/DigiDentiS_Takvim_API_Documentation_v3.2.html`,
 * §4 "Signature Calculation" and §11.4 "Signature Verification") — these
 * are NOT placeholder/self-consistency checks, they assert against the
 * vendor's own worked examples.
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

section('Vendor doc §4 — worked signing example (verbatim fixture)');

const VENDOR_EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const VENDOR_EXAMPLE_TIMESTAMP = '1736694000';
const VENDOR_EXAMPLE_NONCE = '550e8400-e29b-41d4-a716-446655440000';
const VENDOR_EXAMPLE_SIGNING_STRING =
  '1736694000.550e8400-e29b-41d4-a716-446655440000.GET.companies.e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

test('SHA256("") matches the vendor doc\'s documented empty-body hash', () => {
  assert.equal(sha256Hex(''), VENDOR_EMPTY_BODY_SHA256);
  assert.equal(sha256Hex(Buffer.alloc(0)), VENDOR_EMPTY_BODY_SHA256);
});

test('buildDigiDentisSigningString reproduces the vendor doc\'s exact worked example', () => {
  const signingString = buildDigiDentisSigningString(
    VENDOR_EXAMPLE_TIMESTAMP,
    VENDOR_EXAMPLE_NONCE,
    'GET',
    'companies',
    VENDOR_EMPTY_BODY_SHA256,
  );
  assert.equal(signingString, VENDOR_EXAMPLE_SIGNING_STRING);
});

test('signing string is dot-separated in timestamp.nonce.method.path.bodyHash order — never newline-joined', () => {
  const signingString = buildDigiDentisSigningString('1000', 'n1', 'get', 'x', 'hash');
  assert.equal(signingString, '1000.n1.GET.x.hash');
  assert.equal(signingString.includes('\n'), false);
});

test('signDigiDentisRequest end-to-end reproduces the vendor doc\'s worked example signature', () => {
  const clientSecret = 'doc-example-secret';
  const headers = signDigiDentisRequest(
    'client-id-irrelevant-to-signature',
    clientSecret,
    'GET',
    'companies',
    Buffer.alloc(0),
    Number(VENDOR_EXAMPLE_TIMESTAMP),
    VENDOR_EXAMPLE_NONCE,
  );
  const expectedSignature = createHmac('sha256', clientSecret).update(VENDOR_EXAMPLE_SIGNING_STRING).digest('hex');
  assert.equal(headers['X-Signature'], expectedSignature);
  assert.equal(headers['X-Timestamp'], VENDOR_EXAMPLE_TIMESTAMP);
  assert.equal(headers['X-Nonce'], VENDOR_EXAMPLE_NONCE);
});

section('Timestamp — seconds, not milliseconds (vendor doc §3: "Unix timestamp in seconds")');

test('the default timestamp is generated in seconds, matching current wall-clock time', () => {
  const before = Math.floor(Date.now() / 1000);
  const headers = signDigiDentisRequest('c1', 's1', 'GET', 'companies', Buffer.alloc(0));
  const after = Math.floor(Date.now() / 1000);
  const generated = Number(headers['X-Timestamp']);
  // A millisecond value would be ~1000x larger than `before`/`after` and fail this range check.
  assert.ok(generated >= before && generated <= after, `expected a seconds-scale timestamp between ${before} and ${after}, got ${generated}`);
});

section('API request signing — headers');

test('signs with the exact documented header names', () => {
  const headers = signDigiDentisRequest('client-123', 'super-secret', 'GET', 'companies', Buffer.alloc(0), 1000, 'nonce-1');
  assert.deepEqual(Object.keys(headers).sort(), ['X-Client-ID', 'X-Nonce', 'X-Signature', 'X-Timestamp'].sort());
  assert.equal(headers['X-Client-ID'], 'client-123');
  assert.equal(headers['X-Timestamp'], '1000');
  assert.equal(headers['X-Nonce'], 'nonce-1');
});

test('no Authorization/Bearer header is produced — HMAC signing IS the auth, there is no token endpoint', () => {
  const headers = signDigiDentisRequest('client-123', 'secret', 'GET', 'companies', Buffer.alloc(0), 1000, 'nonce-1');
  assert.equal((headers as any).Authorization, undefined);
});

test('a fresh nonce is generated per call when none is supplied', () => {
  const a = signDigiDentisRequest('c1', 's1', 'GET', 'companies', Buffer.alloc(0), 1000);
  const b = signDigiDentisRequest('c1', 's1', 'GET', 'companies', Buffer.alloc(0), 1000);
  assert.notEqual(a['X-Nonce'], b['X-Nonce']);
});

test('generateDigiDentisNonce returns 32 hex chars (16 random bytes) — matches the vendor\'s own PHP reference (bin2hex(random_bytes(16)))', () => {
  const nonce = generateDigiDentisNonce();
  assert.match(nonce, /^[0-9a-f]{32}$/);
});

section('API request signing — signature correctness');

test('signature matches independently-computed HMAC over the signing string', () => {
  const clientId = 'client-123';
  const clientSecret = 'super-secret';
  const method = 'POST';
  const path = 'appointments';
  const body = Buffer.from(JSON.stringify({ doctor_id: 'doc-1' }));
  const timestamp = 1700000000;
  const nonce = 'fixed-nonce';

  const headers = signDigiDentisRequest(clientId, clientSecret, method, path, body, timestamp, nonce);

  const expectedSigningString = buildDigiDentisSigningString(String(timestamp), nonce, method, path, sha256Hex(body));
  const expectedSignature = createHmac('sha256', clientSecret).update(expectedSigningString).digest('hex');

  assert.equal(headers['X-Signature'], expectedSignature);
});

test('signature changes if the body changes (tamper-evident)', () => {
  const a = signDigiDentisRequest('c1', 's1', 'POST', 'x', Buffer.from('{"a":1}'), 1000, 'n1');
  const b = signDigiDentisRequest('c1', 's1', 'POST', 'x', Buffer.from('{"a":2}'), 1000, 'n1');
  assert.notEqual(a['X-Signature'], b['X-Signature']);
});

test('signature changes if the path changes', () => {
  const a = signDigiDentisRequest('c1', 's1', 'GET', 'companies', Buffer.alloc(0), 1000, 'n1');
  const b = signDigiDentisRequest('c1', 's1', 'GET', 'doctors', Buffer.alloc(0), 1000, 'n1');
  assert.notEqual(a['X-Signature'], b['X-Signature']);
});

test('signature changes if the timestamp changes', () => {
  const a = signDigiDentisRequest('c1', 's1', 'GET', 'companies', Buffer.alloc(0), 1000, 'n1');
  const b = signDigiDentisRequest('c1', 's1', 'GET', 'companies', Buffer.alloc(0), 2000, 'n1');
  assert.notEqual(a['X-Signature'], b['X-Signature']);
});

test('signature changes if the nonce changes (replay resistance)', () => {
  const a = signDigiDentisRequest('c1', 's1', 'GET', 'companies', Buffer.alloc(0), 1000, 'n1');
  const b = signDigiDentisRequest('c1', 's1', 'GET', 'companies', Buffer.alloc(0), 1000, 'n2');
  assert.notEqual(a['X-Signature'], b['X-Signature']);
});

test('signature changes if the client secret changes', () => {
  const a = signDigiDentisRequest('c1', 'secret-a', 'GET', 'companies', Buffer.alloc(0), 1000, 'n1');
  const b = signDigiDentisRequest('c1', 'secret-b', 'GET', 'companies', Buffer.alloc(0), 1000, 'n1');
  assert.notEqual(a['X-Signature'], b['X-Signature']);
});

test('a query string must never affect the signature (vendor doc §4: "no query string")', () => {
  // The caller is responsible for passing a query-string-free path; this
  // test documents/locks in that signing 'companies' and signing
  // 'companies?page=2' are — and must remain — different inputs, i.e. the
  // signing function does not itself strip query strings, so callers
  // (DigiDentisApiClient.ts) must never pass one in.
  const withoutQuery = signDigiDentisRequest('c1', 's1', 'GET', 'companies', Buffer.alloc(0), 1000, 'n1');
  const withQuery = signDigiDentisRequest('c1', 's1', 'GET', 'companies?page=2', Buffer.alloc(0), 1000, 'n1');
  assert.notEqual(withoutQuery['X-Signature'], withQuery['X-Signature']);
});

section('Webhook signature verification — sha256=<hex> format (vendor doc §11.4)');

test('valid signature (with the required sha256= prefix) verifies successfully', () => {
  const secret = 'webhook-secret';
  const body = Buffer.from(JSON.stringify({ event: 'appointment.created' }));
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  assert.equal(verifyDigiDentisWebhookSignature(body, signature, secret), true);
});

test('a bare hex digest WITHOUT the sha256= prefix is rejected', () => {
  const secret = 'webhook-secret';
  const body = Buffer.from(JSON.stringify({ event: 'appointment.created' }));
  const bareHex = createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyDigiDentisWebhookSignature(body, bareHex, secret), false);
});

test('the Node.js reference example from vendor doc §11.4 verifies against our implementation', () => {
  // Transcribed from the vendor doc's own Node.js example:
  //   const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const secret = 'shared-webhook-secret';
  const rawBody = Buffer.from(JSON.stringify({ event: 'appointment.cancelled', data: { id: 'apt_1' } }));
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  assert.equal(verifyDigiDentisWebhookSignature(rawBody, expected, secret), true);
});

test('tampered body fails verification', () => {
  const secret = 'webhook-secret';
  const original = Buffer.from(JSON.stringify({ event: 'appointment.created' }));
  const signature = `sha256=${createHmac('sha256', secret).update(original).digest('hex')}`;
  const tampered = Buffer.from(JSON.stringify({ event: 'appointment.cancelled' }));
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

test('surrounding whitespace on the header is tolerated (defensive trim only, no case-folding)', () => {
  const secret = 'webhook-secret';
  const body = Buffer.from('{"a":1}');
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  assert.equal(verifyDigiDentisWebhookSignature(body, `  ${signature}  `, secret), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
