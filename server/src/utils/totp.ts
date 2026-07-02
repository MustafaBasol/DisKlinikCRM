/**
 * totp.ts — RFC 6238 TOTP (RFC 4226 HOTP tabanlı), harici bağımlılıksız.
 *
 * Google Authenticator / Authy / 1Password uyumlu varsayılanlar:
 * SHA-1, 6 hane, 30 saniyelik adım. Doğrulamada ±1 adım tolerans
 * (saat kayması) ve timing-safe karşılaştırma kullanılır.
 */

import crypto from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 160-bit rastgele secret üretir (base32). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secret: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      (hmac[offset + 1] << 16) |
      (hmac[offset + 2] << 8) |
      hmac[offset + 3]) %
    10 ** DIGITS;
  return String(code).padStart(DIGITS, '0');
}

/** Test edilebilirlik için `now` (ms) enjekte edilebilir. */
export function generateTotp(secretBase32: string, now: number = Date.now()): string {
  return hotp(base32Decode(secretBase32), Math.floor(now / 1000 / STEP_SECONDS));
}

/**
 * Kodu geçerli adım ve ±window komşu adımlara karşı doğrular.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  window = 1,
  now: number = Date.now(),
): boolean {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  let secret: Buffer;
  try {
    secret = base32Decode(secretBase32);
  } catch {
    return false;
  }
  const counter = Math.floor(now / 1000 / STEP_SECONDS);
  let valid = false;
  for (let offset = -window; offset <= window; offset++) {
    const expected = hotp(secret, counter + offset);
    // Her adayı karşılaştır (erken çıkma yok) — timing sızıntısını önler
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))) {
      valid = true;
    }
  }
  return valid;
}

/** Authenticator uygulamalarının okuduğu otpauth:// URI'si. */
export function buildOtpAuthUri(secretBase32: string, accountName: string, issuer = 'NoraMedi Platform'): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
