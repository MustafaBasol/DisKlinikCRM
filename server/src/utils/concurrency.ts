/**
 * concurrency.ts — Sınırlı eşzamanlılıkla toplu işleme (docs/45 Faz 3 #10).
 *
 * Reminder job gibi "N öğe üzerinde sıralı döngü" yapan işler klinik sayısı
 * arttıkça doğrusal uzar. mapWithConcurrency aynı anda en fazla `limit` öğe
 * işler: öğeler arası paralellik kazanılır ama tek öğenin kendi içindeki
 * sıralılık (ör. bir kliniğin WhatsApp gönderimleri) korunur.
 *
 * fn'in hatası yutulmaz — çağıran öğe başına kendi try/catch'ini kurmalıdır
 * (reminder job zaten klinik başına yakalıyor).
 */

export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const effectiveLimit = Math.max(1, Math.min(limit, items.length));

  let nextIndex = 0;
  const workers = Array.from({ length: effectiveLimit }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      await fn(items[index]);
    }
  });

  await Promise.all(workers);
}
