/**
 * jobLock.ts — Cron job'lar için paylaşımlı lease kilidi (docs/45 Faz 3 #9-10).
 *
 * Süreç-içi overlap bayrakları tek süreçte yeterlidir ama API + ayrı worker
 * ya da birden fazla replika çalıştığında her süreç kendi cron'unu kurar ve
 * aynı job aynı anda iki kez koşar (mükerrer hasta mesajı riski). Bu kilit
 * JobLock tablosu üzerinden atomiktir:
 *
 *  - Kilit, lease süresi (ttlMs) dolana kadar sahibindedir; job normal
 *    bittiğinde hemen bırakılır.
 *  - Süreç çökerse lease kendiliğinden dolar, sonraki tick'te başka süreç alır.
 *  - ttlMs, job'un beklenen en uzun koşu süresinden rahatça büyük seçilmelidir;
 *    aksi halde uzun bir koşu sürerken lease dolar ve ikinci süreç başlayabilir.
 *
 * Redis varsa SET NX PX ile de kurulabilirdi; DB tabanlı lease ek altyapı
 * gerektirmediği ve tüm replikalar zaten aynı Postgres'i paylaştığı için
 * varsayılan olarak bu kullanılır.
 */

import { hostname } from 'os';
import { randomUUID } from 'crypto';
import prisma from '../db.js';
import { safeErrorFields } from './safeError.js';

// Süreç kimliği: kilidin kim tarafından tutulduğu loglarda görünsün ve
// release yalnızca kendi kilidimizi bıraksın diye.
const LOCK_OWNER = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

/**
 * Kilidi tek başına almayı dener (fn çalıştırmadan). withJobLock'un iç
 * adımı ile aynı SQL'i paylaşır — F1-003-B2: manuel retention rotası, audit
 * "started" satırını yazmadan ÖNCE kilidi almak için bunu doğrudan
 * kullanır (bkz. platformAdmin.ts). Kilit alınamazsa fn hiç çağrılmadığı
 * için release de gerekmez; çağıran taraf `false` durumunda kilit tutmuyor
 * demektir ve releaseJobLock çağırmamalıdır.
 */
export async function acquireJobLock(name: string, ttlMs: number): Promise<boolean> {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + ttlMs);

  // Var olan ama süresi dolmuş kilidi atomik olarak devral.
  const claimed = await prisma.jobLock.updateMany({
    where: { name, lockedUntil: { lt: now } },
    data: { lockedUntil, lockedBy: LOCK_OWNER },
  });
  if (claimed.count > 0) return true;

  // Satır hiç yoksa oluşturmayı dene; iki süreç yarışırsa biri P2002 alır.
  try {
    await prisma.jobLock.create({ data: { name, lockedUntil, lockedBy: LOCK_OWNER } });
    return true;
  } catch {
    return false; // Kilit başka bir süreçte (ya da yarışı kaybettik).
  }
}

/**
 * acquireJobLock() ile alınmış bir kilidi bırakır. Yalnızca kendi kilidimizi
 * bırak: lease dolup başka süreç devraldıysa onun kilidini sıfırlamayalım.
 * Çağıran taraf, kilidi gerçekten aldıysa (acquireJobLock true döndüyse)
 * her koşulda (başarı/hata/exception) bunu çağırmaktan sorumludur.
 *
 * F1-003-B2-R1: bu çağrı asla reddedilmez (throw etmez) — DB'ye ulaşılamazsa
 * bile çağıranın kendi hata/response akışını bozmaması gerekir; zaten
 * tamamlanmış bir cleanup'ın sonucu (örn. 200/summary) hiçbir zaman "release
 * başarısız oldu" diye bir hataya dönüştürülmemeli. Bunun bedeli: release
 * gerçekten başarısız olursa kilit kendi TTL'i dolana kadar (varsayılan 2
 * saat) tutulu kalır — bu, "asla reddetme" garantisiyle bilinçli bir
 * ödünleşim, sessizce yutulmaz: aşağıdaki log satırı operatörün bunu
 * production log'larında görebilmesini sağlar (önceden hiç loglanmıyordu).
 */
export async function releaseJobLock(name: string): Promise<void> {
  await prisma.jobLock
    .updateMany({
      where: { name, lockedBy: LOCK_OWNER },
      data: { lockedUntil: new Date() },
    })
    .catch((error: unknown) => {
      console.error(`[job-lock] Failed to release lock '${name}' (will remain held until its TTL expires):`, safeErrorFields(error));
    });
}

/**
 * fn'i paylaşımlı kilit altında çalıştırır. Kilit alınamazsa (başka replika
 * koşuyordur) false döner ve fn hiç çağrılmaz. fn'in hatası çağırana fırlar;
 * kilit her durumda bırakılır.
 */
export async function withJobLock(
  name: string,
  ttlMs: number,
  fn: () => Promise<void>,
): Promise<boolean> {
  let acquired = false;
  try {
    acquired = await acquireJobLock(name, ttlMs);
  } catch (error) {
    // DB'ye ulaşılamıyorsa job'u koşturmayı deneme — bir sonraki tick dener.
    console.error(`[job-lock] Failed to acquire lock '${name}':`, safeErrorFields(error));
    return false;
  }
  if (!acquired) {
    console.warn(`[job-lock] '${name}' is held by another process, skipping this tick.`);
    return false;
  }

  try {
    await fn();
  } finally {
    await releaseJobLock(name);
  }
  return true;
}
