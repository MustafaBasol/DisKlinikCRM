/**
 * watcher.ts — chokidar tabanlı çoklu klasör izleyici.
 *
 * - `importExisting=false` (varsayılan): başlangıçta zaten var olan
 *   dosyalar yok sayılır (`ignoreInitial`).
 * - Kararlılık: chokidar'ın `awaitWriteFinish` seçeneği, dosya tamamen
 *   yazılana kadar `add` olayını geciktirir — elle polling gerekmez.
 * - İzin verilmeyen/geçici dosyalar (nokta ile başlayan, .tmp/.part/
 *   .partial/.crdownload, ya da izin verilen uzantı listesi dışı) `ignored`
 *   fonksiyonunda elenir.
 * - Klasör geçici olarak yoksa: periyodik olarak varlığı kontrol edilir,
 *   bulununca chokidar başlatılır; chokidar 'error' verirse kapatılıp aynı
 *   döngüye geri dönülür — bir klasördeki sorun diğerlerini etkilemez.
 * - Kaynak dosyaya asla yazılmaz/yeniden adlandırılmaz/silinmez.
 */
import fs from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { ResolvedWatch } from './config.js';
import type { Logger } from './logger.js';

const TEMP_SUFFIXES = ['.tmp', '.part', '.partial', '.crdownload'];
const AVAILABILITY_POLL_MS = 30_000;

/**
 * chokidar bu fonksiyonu hem dosyalar hem de gezilecek dizinler (izlenen
 * kök klasör dahil) için çağırır. Dizinler/uzantısız yollar için `true`
 * dönmek chokidar'ın o dizinin içine hiç inmemesine yol açar — bu yüzden
 * uzantı yokken ASLA yok saymayız, yalnızca gerçek dosya uzantısı
 * eşleşmediğinde eleriz.
 */
export function isIgnoredPath(filePath: string, allowedExtensions: string[]): boolean {
  const base = path.basename(filePath);
  if (base.startsWith('.')) return true;
  const ext = path.extname(base).toLowerCase();
  if (!ext) return false;
  if (TEMP_SUFFIXES.includes(ext)) return true;
  return !allowedExtensions.includes(ext);
}

export type StableFileHandler = (sourcePath: string, watch: ResolvedWatch) => void;

class SingleFolderWatcher {
  private fsWatcher: FSWatcher | null = null;
  private availabilityTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  available = false;
  readonly watchId: string;

  constructor(
    private readonly watch: ResolvedWatch,
    private readonly stabilityMs: number,
    private readonly onStableFile: StableFileHandler,
    private readonly logger: Logger,
    private readonly importExisting: boolean,
  ) {
    this.watchId = watch.watchId;
  }

  start(): void {
    this.tryStart();
  }

  private tryStart(): void {
    if (this.stopped) return;
    if (!fs.existsSync(this.watch.path)) {
      this.available = false;
      this.scheduleAvailabilityCheck();
      return;
    }
    this.available = true;
    this.fsWatcher = chokidar.watch(this.watch.path, {
      ignoreInitial: !this.importExisting,
      ignored: (filePath: string) => isIgnoredPath(filePath, this.watch.extensions),
      awaitWriteFinish: { stabilityThreshold: this.stabilityMs, pollInterval: 200 },
      depth: 0,
      // Ağ paylaşımları (UNC) ve bazı Windows dosya sistemlerinde native
      // olaylar güvenilir tetiklenmeyebilir — polling varsayılan olarak
      // açık, klinik PC'lerinde ek bir bağımlılık/sürücü gerektirmez.
      usePolling: true,
      interval: 300,
    });

    this.fsWatcher.on('add', filePath => {
      this.logger.info('watcher.file_stable', { watchId: this.watch.watchId });
      this.onStableFile(filePath, this.watch);
    });

    this.fsWatcher.on('error', () => {
      this.logger.warn('watcher.error', { watchId: this.watch.watchId });
      this.restart();
    });

    this.fsWatcher.on('unlinkDir', dir => {
      if (path.resolve(dir) === path.resolve(this.watch.path)) {
        this.logger.warn('watcher.folder_removed', { watchId: this.watch.watchId });
        this.restart();
      }
    });
  }

  private restart(): void {
    this.available = false;
    this.fsWatcher?.close().catch(() => {});
    this.fsWatcher = null;
    this.scheduleAvailabilityCheck();
  }

  private scheduleAvailabilityCheck(): void {
    if (this.availabilityTimer) return;
    this.availabilityTimer = setInterval(() => {
      if (this.stopped) return;
      if (fs.existsSync(this.watch.path)) {
        clearInterval(this.availabilityTimer!);
        this.availabilityTimer = null;
        this.logger.info('watcher.folder_recovered', { watchId: this.watch.watchId });
        this.tryStart();
      }
    }, AVAILABILITY_POLL_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.availabilityTimer) clearInterval(this.availabilityTimer);
    this.fsWatcher?.close().catch(() => {});
  }
}

export class WatcherManager {
  private readonly folders: SingleFolderWatcher[] = [];

  constructor(
    watches: ResolvedWatch[],
    stabilityMs: number,
    importExisting: boolean,
    onStableFile: StableFileHandler,
    logger: Logger,
  ) {
    for (const watch of watches) {
      this.folders.push(new SingleFolderWatcher(watch, stabilityMs, onStableFile, logger, importExisting));
    }
  }

  start(): void {
    for (const folder of this.folders) folder.start();
  }

  stop(): void {
    for (const folder of this.folders) folder.stop();
  }

  availability(): { watchId: string; available: boolean }[] {
    return this.folders.map(f => ({ watchId: f.watchId, available: f.available }));
  }
}
