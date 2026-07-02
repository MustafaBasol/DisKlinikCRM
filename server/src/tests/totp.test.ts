/**
 * totp.test.ts — RFC 6238 TOTP unit tests
 *
 * Run: cd server && npx tsx src/tests/totp.test.ts
 *
 * RFC 6238 Appendix B test vektörleri (SHA-1, secret ASCII "12345678901234567890").
 * RFC 8 haneli kod verir; bizim kod 6 haneli = aynı değerin mod 10^6'sı,
 * yani son 6 hanesi.
 */

import assert from 'node:assert/strict';
import {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  generateTotp,
  verifyTotp,
  buildOtpAuthUri,
} from '../utils/totp.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function section(title: string) { console.log(`\n${title}`); }

// RFC test secret: ASCII "12345678901234567890"
const RFC_SECRET_B32 = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

section('base32 encode/decode');

test('round-trips arbitrary bytes', () => {
  const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 42]);
  assert.deepEqual(base32Decode(base32Encode(buf)), buf);
});

test('RFC secret encodes to expected base32', () => {
  assert.equal(RFC_SECRET_B32, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
});

test('decode tolerates lowercase, spaces and padding', () => {
  assert.deepEqual(
    base32Decode('gezd gnbv GY3TQOJQGEZDGNBVGY3TQOJQ=='),
    Buffer.from('12345678901234567890', 'ascii'),
  );
});

test('decode rejects invalid characters', () => {
  assert.throws(() => base32Decode('ABC1DEF')); // '1' base32'de yok
});

section('RFC 6238 Appendix B vectors (SHA-1, 6 digit = son 6 hane)');

// (unix seconds, 8 haneli RFC kodu)
const vectors: Array<[number, string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
];

for (const [seconds, rfc8] of vectors) {
  test(`T=${seconds} → ${rfc8.slice(-6)}`, () => {
    assert.equal(generateTotp(RFC_SECRET_B32, seconds * 1000), rfc8.slice(-6));
  });
}

section('verifyTotp');

test('accepts current-step code', () => {
  const now = 1234567890 * 1000;
  assert.ok(verifyTotp(RFC_SECRET_B32, generateTotp(RFC_SECRET_B32, now), 1, now));
});

test('accepts previous-step code within window (clock drift)', () => {
  const now = 1234567890 * 1000;
  const prev = generateTotp(RFC_SECRET_B32, now - 30_000);
  assert.ok(verifyTotp(RFC_SECRET_B32, prev, 1, now));
});

test('rejects code two steps old (outside window=1)', () => {
  const now = 1234567890 * 1000;
  const stale = generateTotp(RFC_SECRET_B32, now - 90_000);
  assert.ok(!verifyTotp(RFC_SECRET_B32, stale, 1, now));
});

test('rejects wrong code', () => {
  assert.ok(!verifyTotp(RFC_SECRET_B32, '000000', 1, 1234567890 * 1000));
});

test('rejects malformed codes (letters, wrong length, empty)', () => {
  const now = 1234567890 * 1000;
  assert.ok(!verifyTotp(RFC_SECRET_B32, 'abcdef', 1, now));
  assert.ok(!verifyTotp(RFC_SECRET_B32, '12345', 1, now));
  assert.ok(!verifyTotp(RFC_SECRET_B32, '', 1, now));
});

test('accepts code with internal whitespace ("123 456" formatı)', () => {
  const now = 1234567890 * 1000;
  const code = generateTotp(RFC_SECRET_B32, now);
  assert.ok(verifyTotp(RFC_SECRET_B32, `${code.slice(0, 3)} ${code.slice(3)}`, 1, now));
});

test('rejects invalid base32 secret gracefully (no throw)', () => {
  assert.ok(!verifyTotp('not!valid!base32!', '123456', 1, Date.now()));
});

section('generateTotpSecret / buildOtpAuthUri');

test('generates 32-char base32 secret (160 bit)', () => {
  const secret = generateTotpSecret();
  assert.equal(secret.length, 32);
  assert.match(secret, /^[A-Z2-7]+$/);
});

test('secrets are unique across calls', () => {
  assert.notEqual(generateTotpSecret(), generateTotpSecret());
});

test('otpauth URI contains secret, issuer and encoded label', () => {
  const uri = buildOtpAuthUri('ABCDEF234567', 'admin@test.com', 'NoraMedi Platform');
  assert.ok(uri.startsWith('otpauth://totp/NoraMedi%20Platform%3Aadmin%40test.com?'));
  assert.ok(uri.includes('secret=ABCDEF234567'));
  assert.ok(uri.includes('issuer=NoraMedi+Platform'));
  assert.ok(uri.includes('digits=6'));
  assert.ok(uri.includes('period=30'));
});

console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
