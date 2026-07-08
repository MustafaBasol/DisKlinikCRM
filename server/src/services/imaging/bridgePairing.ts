/**
 * bridgePairing.ts — Görüntüleme köprüsü eşleştirme (pairing) kod üretimi/özeti.
 *
 * Düz metin eşleştirme kodu yalnızca oluşturma yanıtında BİR KEZ gösterilir;
 * veritabanında ve loglarda yalnızca HMAC-SHA256 özeti (codeHash) bulunur.
 * Pepper (IMAGING_BRIDGE_PAIRING_PEPPER) olmadan hash tahmin edilemez — yalnızca
 * sha256(code) kullanılsaydı brute-force ile 8 haneli alan (10^8) makul sürede
 * denenebilirdi; pepper bunu sunucu tarafı bir sır ile bağlar.
 */

import crypto from 'crypto';
import { getSecret } from '../../utils/secrets.js';

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
export const PAIRING_MAX_ATTEMPTS = 5;

const DEV_PEPPER_FALLBACK = 'dev-only-imaging-bridge-pairing-pepper-do-not-use-in-prod';

function getPairingPepper(): string {
  return getSecret('IMAGING_BRIDGE_PAIRING_PEPPER', DEV_PEPPER_FALLBACK);
}

/** 8 haneli, kriptografik olarak rastgele eşleştirme kodu üretir (örn. "12345678"). */
export function generatePairingCode(): string {
  // crypto.randomInt üst sınırı hariç tutar — [0, 1e8) aralığından tekdüze seçim.
  const value = crypto.randomInt(0, 100_000_000);
  return String(value).padStart(8, '0');
}

/** Kullanıcıya gösterim biçimi: "1234 5678". */
export function formatPairingCodeForDisplay(code: string): string {
  return `${code.slice(0, 4)} ${code.slice(4, 8)}`;
}

/** HMAC-SHA256(code, pepper) — sunucu tarafı pepper olmadan tahmin edilemez. */
export function hashPairingCode(code: string): string {
  return crypto.createHmac('sha256', getPairingPepper()).update(code.trim()).digest('hex');
}

/** Kullanıcı girişini normalize eder: boşluk/tire kaldırılır, yalnızca rakam kabul edilir. */
export function normalizePairingCodeInput(rawInput: string): string | null {
  const digitsOnly = rawInput.replace(/[\s-]/g, '');
  if (!/^\d{8}$/.test(digitsOnly)) return null;
  return digitsOnly;
}
