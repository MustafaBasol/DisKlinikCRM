/**
 * queue.ts — Diske kalıcı, dizin-başına-öğe kuyruk.
 *
 * Her öğe queueDir/{pending|processing|failed}/<ingestKey>/ altında
 * {file<safeExt>, meta.json} çiftidir. Yeni bir öğe önce queueDir/
 * kökünde `.staging-<ingestKey>` adlı geçici bir dizine yazılır, ardından
 * TEK bir `fs.renameSync` ile pending/'e taşınır — böylece yarıda kalan bir
 * yazım asla pending/ içinde görünmez, yalnızca temizlenecek bir
 * `.staging-*` artığı olarak kalır.
 *
 * Kaynak dosyaya (izlenen klasördeki orijinal export) hiçbir zaman
 * dokunulmaz — yalnızca okunur/kopyalanır.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sha256Buffer } from './hash.js';
import { detectContentType, safeExtensionFor } from './fileType.js';
import type { Logger } from './logger.js';
import { shortIngestKey } from './logger.js';

export type ErrorCategory =
  | 'bad_request'
  | 'device_not_found'
  | 'file_too_large'
  | 'max_attempts_exceeded'
  | 'quarantined_orphan'
  | 'quarantined_malformed_metadata'
  | 'unsupported_file_type';

export interface QueueMeta {
  ingestKey: string;
  watchId: string;
  deviceId: string;
  modality?: string;
  contentType: string;
  safeExtension: string;
  createdAt: string;
  attemptCount: number;
  nextAttemptAt: string;
  lastErrorCategory?: ErrorCategory;
}

export interface QueueItem {
  meta: QueueMeta;
  filePath: string;
  metaPath: string;
}

const STATES = ['pending', 'processing', 'failed'] as const;
type State = (typeof STATES)[number];

export class BridgeQueue {
  constructor(private readonly queueDir: string, private readonly logger: Logger) {
    for (const state of STATES) {
      fs.mkdirSync(path.join(queueDir, state), { recursive: true });
    }
  }

  private dir(state: State, ingestKey?: string): string {
    return ingestKey ? path.join(this.queueDir, state, ingestKey) : path.join(this.queueDir, state);
  }

  /** processing/'e taşındıktan sonra dosyanın gerçek yolunu yeniden hesaplamak için. */
  pathFor(state: State, ingestKey: string, safeExtension: string): string {
    return path.join(this.dir(state, ingestKey), `file${safeExtension}`);
  }

  private existsInAnyState(ingestKey: string): boolean {
    return STATES.some(state => fs.existsSync(this.dir(state, ingestKey)));
  }

  /**
   * Kararlı bulunan bir kaynak dosyayı kuyruğa alır. Desteklenmeyen içerik
   * (magic-byte tespiti başarısız) ya da zaten kuyrukta olan bir ingestKey
   * için no-op döner (loglanır, hata fırlatılmaz).
   */
  enqueue(sourcePath: string, watchId: string, deviceId: string, modality: string | undefined): QueueItem | null {
    const buffer = fs.readFileSync(sourcePath);
    const contentType = detectContentType(buffer);
    if (!contentType) {
      this.logger.warn('queue.unsupported_file_type', { watchId });
      return null;
    }
    const safeExtension = safeExtensionFor(contentType)!;
    const ingestKey = sha256Buffer(buffer);

    if (this.existsInAnyState(ingestKey)) {
      this.logger.info('queue.duplicate_skip', { watchId, ingestKey: shortIngestKey(ingestKey) });
      return null;
    }

    const meta: QueueMeta = {
      ingestKey,
      watchId,
      deviceId,
      modality,
      contentType,
      safeExtension,
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      nextAttemptAt: new Date().toISOString(),
    };

    const stagingDir = path.join(this.queueDir, `.staging-${ingestKey}`);
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir, { recursive: true });
    const stagedFile = path.join(stagingDir, `file${safeExtension}`);
    fs.writeFileSync(stagedFile, buffer);
    fs.writeFileSync(path.join(stagingDir, 'meta.json'), JSON.stringify(meta, null, 2));

    const pendingDir = this.dir('pending', ingestKey);
    fs.renameSync(stagingDir, pendingDir);

    this.logger.info('queue.enqueued', { watchId, ingestKey: shortIngestKey(ingestKey) });
    return { meta, filePath: path.join(pendingDir, `file${safeExtension}`), metaPath: path.join(pendingDir, 'meta.json') };
  }

  /** FIFO sırasıyla (createdAt) bekleyen ve zamanı gelmiş öğeler. */
  listReadyPending(now = new Date()): QueueItem[] {
    const items = this.listState('pending');
    return items
      .filter(item => new Date(item.meta.nextAttemptAt).getTime() <= now.getTime())
      .sort((a, b) => a.meta.createdAt.localeCompare(b.meta.createdAt));
  }

  listState(state: State): QueueItem[] {
    const dir = this.dir(state);
    if (!fs.existsSync(dir)) return [];
    const items: QueueItem[] = [];
    for (const ingestKey of fs.readdirSync(dir)) {
      const itemDir = path.join(dir, ingestKey);
      const metaPath = path.join(itemDir, 'meta.json');
      if (!fs.existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as QueueMeta;
        const filePath = path.join(itemDir, `file${meta.safeExtension}`);
        if (!fs.existsSync(filePath)) continue;
        items.push({ meta, filePath, metaPath });
      } catch {
        continue;
      }
    }
    return items;
  }

  moveToProcessing(ingestKey: string): void {
    fs.renameSync(this.dir('pending', ingestKey), this.dir('processing', ingestKey));
  }

  /** Başarı: processing/'ten tamamen silinir. */
  complete(ingestKey: string): void {
    fs.rmSync(this.dir('processing', ingestKey), { recursive: true, force: true });
  }

  /** Yeniden denenebilir hata: processing → pending, meta güncellenmiş olarak. */
  retryLater(ingestKey: string, meta: QueueMeta): void {
    const metaPath = path.join(this.dir('processing', ingestKey), 'meta.json');
    this.atomicWriteJson(metaPath, meta);
    fs.renameSync(this.dir('processing', ingestKey), this.dir('pending', ingestKey));
  }

  /** Kalıcı hata: processing → failed, meta güncellenmiş olarak. */
  fail(ingestKey: string, meta: QueueMeta): void {
    const metaPath = path.join(this.dir('processing', ingestKey), 'meta.json');
    this.atomicWriteJson(metaPath, meta);
    fs.renameSync(this.dir('processing', ingestKey), this.dir('failed', ingestKey));
  }

  /** Manuel yeniden deneme: failed → pending, attemptCount sıfırlanmış. */
  requeueFailed(ingestKey: string): QueueItem {
    const failedDir = this.dir('failed', ingestKey);
    const metaPath = path.join(failedDir, 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as QueueMeta;
    meta.attemptCount = 0;
    meta.nextAttemptAt = new Date().toISOString();
    meta.lastErrorCategory = undefined;
    this.atomicWriteJson(metaPath, meta);
    const pendingDir = this.dir('pending', ingestKey);
    fs.renameSync(failedDir, pendingDir);
    return { meta, filePath: path.join(pendingDir, `file${meta.safeExtension}`), metaPath };
  }

  private atomicWriteJson(finalPath: string, data: unknown): void {
    const tmpPath = `${finalPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, finalPath);
  }

  /**
   * Başlangıç kurtarma: her başlatmada çalışır, idempotenttir.
   * - Kök dizindeki `.staging-*` artıkları silinir (kaynak dosya
   *   dokunulmadığı için hiçbir görüntü kaybolmaz).
   * - processing/'te kalan her şey pending/'e geri taşınır (yükleme hiç
   *   onaylanmamıştı).
   * - pending/'teki (taşınanlar dahil) her öğe doğrulanır: dosya eksikse,
   *   meta.json eksik/bozuksa → failed/'e karantina, ASLA sessizce silinmez.
   */
  recoverOnStartup(): void {
    for (const entry of fs.readdirSync(this.queueDir)) {
      if (entry.startsWith('.staging-')) {
        fs.rmSync(path.join(this.queueDir, entry), { recursive: true, force: true });
        this.logger.warn('queue.recovery.staging_cleaned', {});
      }
    }

    for (const ingestKey of this.safeReaddir('processing')) {
      const from = this.dir('processing', ingestKey);
      const to = this.dir('pending', ingestKey);
      if (fs.existsSync(to)) {
        // Aynı ingestKey iki yerde: processing kopyasını at, pending'dekini koru.
        fs.rmSync(from, { recursive: true, force: true });
      } else {
        fs.renameSync(from, to);
      }
      this.logger.warn('queue.recovery.processing_reclaimed', { ingestKey: shortIngestKey(ingestKey) });
    }

    for (const ingestKey of this.safeReaddir('pending')) {
      this.quarantineIfInvalid(ingestKey);
    }
  }

  private quarantineIfInvalid(ingestKey: string): void {
    const itemDir = this.dir('pending', ingestKey);
    const metaPath = path.join(itemDir, 'meta.json');

    let meta: QueueMeta | null = null;
    // metaMissing: meta.json dosyası hiç yok (dosya var ama eşi kayıp).
    // metaMalformed: meta.json var ama JSON parse edilemiyor veya zorunlu alanlar eksik.
    let metaMissing = false;
    let metaMalformed = false;

    if (!fs.existsSync(metaPath)) {
      metaMissing = true;
    } else {
      try {
        const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Partial<QueueMeta>;
        if (!parsed.ingestKey || !parsed.safeExtension || !parsed.contentType) {
          metaMalformed = true;
        } else {
          meta = parsed as QueueMeta;
        }
      } catch {
        metaMalformed = true;
      }
    }

    const fileMissing = !meta || !fs.existsSync(path.join(itemDir, `file${meta.safeExtension}`));

    if (metaMissing || metaMalformed || fileMissing) {
      const category: ErrorCategory = metaMalformed ? 'quarantined_malformed_metadata' : 'quarantined_orphan';
      const failedDir = this.dir('failed', ingestKey);
      fs.mkdirSync(path.dirname(failedDir), { recursive: true });
      fs.renameSync(itemDir, failedDir);

      // Meta okunabiliyorsa mevcut alanları koruyarak günceller; okunamıyorsa/eksikse
      // her zaman geçerli bir placeholder ile ÜZERİNE yazar (bozuk/eksik olan asla
      // olduğu gibi bırakılmaz — görüntü dosyasının kendisi hep korunur).
      const finalMeta: QueueMeta = meta
        ? { ...meta, lastErrorCategory: category }
        : {
            ingestKey,
            watchId: 'unknown',
            deviceId: 'unknown',
            contentType: 'application/octet-stream',
            safeExtension: '.bin',
            createdAt: new Date().toISOString(),
            attemptCount: 0,
            nextAttemptAt: new Date().toISOString(),
            lastErrorCategory: category,
          };
      this.atomicWriteJson(path.join(failedDir, 'meta.json'), finalMeta);
      this.logger.warn('queue.recovery.quarantined', { ingestKey: shortIngestKey(ingestKey), category });
    }
  }

  private safeReaddir(state: State): string[] {
    const dir = this.dir(state);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir);
  }

  counts(): { pending: number; failed: number } {
    return { pending: this.safeReaddir('pending').length, failed: this.safeReaddir('failed').length };
  }
}
