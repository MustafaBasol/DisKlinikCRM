/**
 * bridgeTokens.ts — Görüntüleme köprü (bridge) ajanı token üretimi/özeti.
 *
 * Düz metin token yalnızca kayıt yanıtında BİR KEZ gösterilir; veritabanında
 * ve loglarda yalnızca sha256 hex özeti (tokenHash) bulunur. Aynı kural
 * passwordResetToken / e-posta doğrulama token'larıyla tutarlıdır.
 */

import crypto from 'crypto';

// "nmb_" öneki (NoraMedi Bridge) token'ı loglarda/secret taramalarında
// tanınabilir kılar; entropi 32 bayttır.
const TOKEN_PREFIX = 'nmb_';

export function hashBridgeToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

export function generateBridgeToken(): { token: string; tokenHash: string } {
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('hex');
  return { token, tokenHash: hashBridgeToken(token) };
}
