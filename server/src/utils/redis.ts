/**
 * redis.ts — Opsiyonel paylaşımlı Redis istemcisi (docs/45 Faz 3 #9).
 *
 * REDIS_URL tanımlıysa rate limit sayaçları process-içi Map yerine Redis'te
 * tutulur; birden fazla API replikası aynı limitleri paylaşır. REDIS_URL yoksa
 * null döner ve çağıranlar bellek-içi fallback'lerini kullanır (tek süreçli
 * kurulumda davranış değişmez).
 *
 * enableOfflineQueue=false: Redis düşerse komutlar beklemek yerine hemen hata
 * verir; çağıranlar bellek fallback'ine geçer (fail-open, istekler bloklanmaz).
 */

import { Redis } from 'ioredis';

let client: Redis | null | undefined;
let lastErrorLogAt = 0;

export function getRedis(): Redis | null {
  if (client !== undefined) return client;

  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    client = null;
    return null;
  }

  client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 5_000,
  });
  client.on('error', (err) => {
    // Bağlantı koptuğunda her komut için ayrı ayrı log basma (dakikada bir yeter).
    const now = Date.now();
    if (now - lastErrorLogAt > 60_000) {
      lastErrorLogAt = now;
      console.error('[redis] connection error (in-memory fallback active):', err?.message ?? err);
    }
  });
  console.log('[redis] Shared store enabled via REDIS_URL.');
  return client;
}

/** Graceful shutdown'da çağrılır; bağlantı yoksa sessizce döner. */
export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => {});
    client = undefined;
  }
}
