/**
 * counterStore.ts — Rate limit sayaçları için paylaşımlı store soyutlaması
 * (docs/45 Faz 3 #9).
 *
 * REDIS_URL tanımlıysa sabit-pencere sayaçları Redis'te (INCR + PEXPIRE) tutulur
 * ve tüm replikalar aynı limitleri görür. Redis yoksa ya da bir komut hata
 * verirse süreç-içi Map fallback'i devreye girer (degraded ama fail-open:
 * limitler tek sürece iner, istekler asla Redis yüzünden bloklanmaz).
 */

import { getRedis } from './redis.js';

export interface CounterStore {
  /** Penceredeki sayacı 1 artırır ve yeni değeri döner (pencere ilk artışta başlar). */
  increment(key: string, windowMs: number): Promise<number>;
  /** Penceredeki mevcut sayacı döner (yoksa 0). */
  get(key: string, windowMs: number): Promise<number>;
  /** Sayacı siler (ör. başarılı login sonrası). */
  reset(key: string): Promise<void>;
  /** Test yardımcıları için: bellek store'unu boşaltır (Redis'te no-op). */
  clear(): void;
}

function createMemoryCounterStore(): CounterStore {
  const buckets = new Map<string, { count: number; windowStart: number }>();

  // Tek seferlik key'ler (IP, e-posta) süresiz birikmesin (docs/45 orta-8 ile
  // aynı gerekçe): dakikada bir süresi dolanlar süpürülür. windowMs pencere
  // başına değişebildiği için en büyük makul pencere (24 saat) baz alınır.
  const SWEEP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.windowStart > SWEEP_MAX_AGE_MS) buckets.delete(key);
    }
  }, 60_000).unref();

  return {
    async increment(key, windowMs) {
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket || now - bucket.windowStart > windowMs) {
        buckets.set(key, { count: 1, windowStart: now });
        return 1;
      }
      bucket.count += 1;
      return bucket.count;
    },
    async get(key, windowMs) {
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket || now - bucket.windowStart > windowMs) return 0;
      return bucket.count;
    },
    async reset(key) {
      buckets.delete(key);
    },
    clear() {
      buckets.clear();
    },
  };
}

/**
 * namespace, Redis key önekidir (`rl:{namespace}:{key}`) — replikalar arasında
 * aynı limiter'ın aynı sayaçları görmesi için sabit ve benzersiz olmalıdır.
 */
export function createCounterStore(namespace: string): CounterStore {
  const memory = createMemoryCounterStore();

  return {
    async increment(key, windowMs) {
      const redis = getRedis();
      if (!redis) return memory.increment(key, windowMs);
      try {
        const redisKey = `rl:${namespace}:${key}`;
        const count = await redis.incr(redisKey);
        if (count === 1) await redis.pexpire(redisKey, windowMs);
        return count;
      } catch {
        return memory.increment(key, windowMs);
      }
    },
    async get(key, windowMs) {
      const redis = getRedis();
      if (!redis) return memory.get(key, windowMs);
      try {
        const value = await redis.get(`rl:${namespace}:${key}`);
        return value ? parseInt(value, 10) || 0 : 0;
      } catch {
        return memory.get(key, windowMs);
      }
    },
    async reset(key) {
      const redis = getRedis();
      await memory.reset(key);
      if (redis) {
        await redis.del(`rl:${namespace}:${key}`).catch(() => {});
      }
    },
    clear() {
      memory.clear();
    },
  };
}
