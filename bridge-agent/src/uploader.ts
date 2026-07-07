/**
 * uploader.ts — Yükleme durum makinesi: pending → uploading → {done |
 * pending (backoff ile) | failed}. Backoff hesaplama ve HTTP yanıt
 * sınıflandırması saf fonksiyonlar olarak dışa açılır (deterministik test
 * için — bkz. tests/uploader.test.ts).
 */
import type { QueueMeta } from './queue.js';
import type { Logger } from './logger.js';
import { shortIngestKey } from './logger.js';

export type ResponseCategory = 'success' | 'retryable' | 'permanent' | 'auth_failure';

/**
 * 201/200 → success (duplicate:true dahil, sunucu tarafı dedupe zaten
 * "başarı" sayılır). 400/404/413 → kalıcı (yeniden denenmez). 401 → auth
 * hatası (draining tamamen durur). 429/5xx/ağ hatası → yeniden denenebilir.
 */
export function classifyStatus(status: number): ResponseCategory {
  if (status === 200 || status === 201) return 'success';
  if (status === 401) return 'auth_failure';
  if (status === 400 || status === 404 || status === 413) return 'permanent';
  return 'retryable';
}

export function permanentErrorCategory(status: number): QueueMeta['lastErrorCategory'] {
  if (status === 400) return 'bad_request';
  if (status === 404) return 'device_not_found';
  if (status === 413) return 'file_too_large';
  return 'bad_request';
}

export interface BackoffOptions {
  baseMs: number;
  capMs: number;
  /** Test'lerde deterministik olması için enjekte edilir; prod'da Math.random tabanlı varsayılan kullanılır. */
  jitterFn?: () => number;
}

/** delay = min(cap, base * 2^attemptCount) * (1 + jitter), jitter in [0, 0.1). */
export function computeBackoffMs(attemptCount: number, opts: BackoffOptions): number {
  const jitter = (opts.jitterFn ?? (() => Math.random() * 0.1))();
  const raw = Math.min(opts.capMs, opts.baseMs * 2 ** attemptCount);
  return Math.round(raw * (1 + jitter));
}

/** attemptCount=0'dan maxAttempts'e kadar (jitter=0 varsayımıyla) toplam bekleme süresi. */
export function cumulativeBackoffMs(maxAttempts: number, opts: BackoffOptions): number {
  let total = 0;
  for (let i = 0; i < maxAttempts; i++) {
    total += computeBackoffMs(i, { ...opts, jitterFn: () => 0 });
  }
  return total;
}

export interface UploadOutcome {
  category: ResponseCategory;
  studyId?: string;
  duplicate?: boolean;
  errorCategory?: QueueMeta['lastErrorCategory'];
  networkError?: boolean;
}

export interface UploadDeps {
  serverUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Tek bir multipart yükleme denemesi. Dosya adı DAİMA
 * `<ingestKey><safeExtension>` — orijinal dosya adı hiçbir zaman okunmaz/
 * gönderilmez. `studyDate` bilerek gönderilmez (bkz. plan düzeltme #2).
 */
export async function attemptUpload(
  meta: QueueMeta,
  fileBuffer: Buffer,
  token: string,
  deps: UploadDeps,
): Promise<UploadOutcome> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? 30_000);

  try {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: meta.contentType });
    form.append('file', blob, `${meta.ingestKey}${meta.safeExtension}`);
    form.append('ingestKey', meta.ingestKey);
    form.append('deviceId', meta.deviceId);
    if (meta.modality) form.append('modality', meta.modality);
    // studyDate bilerek eklenmiyor — sunucu kendi zaman damgasını atar.

    const response = await fetchImpl(`${deps.serverUrl.replace(/\/$/, '')}/api/public/imaging/bridge/studies`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: controller.signal,
    });

    const category = classifyStatus(response.status);
    if (category === 'success') {
      const body = (await response.json().catch(() => ({}))) as { studyId?: string; duplicate?: boolean };
      return { category, studyId: body.studyId, duplicate: body.duplicate };
    }
    if (category === 'permanent') {
      return { category, errorCategory: permanentErrorCategory(response.status) };
    }
    return { category };
  } catch {
    return { category: 'retryable', networkError: true };
  } finally {
    clearTimeout(timeout);
  }
}

export function logUploadOutcome(logger: Logger, meta: QueueMeta, outcome: UploadOutcome): void {
  logger.info('upload.outcome', {
    watchId: meta.watchId,
    ingestKey: shortIngestKey(meta.ingestKey),
    category: outcome.category,
    duplicate: outcome.duplicate ?? null,
    errorCategory: outcome.errorCategory ?? null,
    networkError: outcome.networkError ?? null,
  });
}
