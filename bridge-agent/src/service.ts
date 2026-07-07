/**
 * service.ts — Tüm parçaları birbirine bağlayan süreç girişi: watcher →
 * queue → uploader → heartbeat → status. SIGINT/SIGTERM'de: yeni watcher
 * olayları kabul edilmez, aktif yükleme bitirilir/güvenle bırakılır, kuyruk
 * korunur, watcher'lar kapatılır, timer'lar durur.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type ResolvedConfig } from './config.js';
import { Logger } from './logger.js';
import { BridgeQueue, type QueueMeta } from './queue.js';
import { WatcherManager } from './watcher.js';
import { AuthState } from './authState.js';
import { HeartbeatLoop } from './heartbeat.js';
import { StatusWriter, type AgentStatus } from './status.js';
import { attemptUpload, computeBackoffMs, logUploadOutcome } from './uploader.js';

const DRAIN_POLL_MS = 5_000;

// esbuild bunu derleme zamanında gerçek sürüme çevirir (bkz. scripts/build.mjs);
// import.meta.url cjs çıktısında çalışmadığı için sürüm derleme zamanında gömülür.
declare const __AGENT_VERSION__: string | undefined;

function readAgentVersion(): string {
  if (typeof __AGENT_VERSION__ !== 'undefined') return __AGENT_VERSION__;
  // Derlenmemiş geliştirme çalıştırması (tsx, ESM) — package.json'dan oku.
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return (JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}

export class BridgeService {
  private readonly config: ResolvedConfig;
  private readonly logger: Logger;
  private readonly queue: BridgeQueue;
  private readonly authState: AuthState;
  private readonly watcherManager: WatcherManager;
  private readonly heartbeat: HeartbeatLoop;
  private readonly statusWriter: StatusWriter;
  private readonly agentVersion: string;
  private readonly startedAt = new Date().toISOString();

  private drainTimer: ReturnType<typeof setInterval> | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private draining = false;
  private activeUpload: Promise<void> | null = null;
  private shuttingDown = false;

  constructor(configPath: string) {
    this.config = loadConfig(configPath);
    this.logger = new Logger(this.config.logDir);
    this.queue = new BridgeQueue(this.config.queueDir, this.logger);
    this.authState = new AuthState(this.config.tokenFile, this.logger);
    this.agentVersion = readAgentVersion();
    this.statusWriter = new StatusWriter(this.config.statusDir);

    this.watcherManager = new WatcherManager(
      this.config.watches,
      this.config.stabilityMs,
      this.config.importExisting,
      (sourcePath, watch) => {
        if (this.shuttingDown) return;
        this.queue.enqueue(sourcePath, watch.watchId, watch.deviceId, watch.modality);
      },
      this.logger,
    );

    this.heartbeat = new HeartbeatLoop(
      this.authState,
      { serverUrl: this.config.serverUrl, agentVersion: this.agentVersion },
      this.config.heartbeatIntervalSeconds * 1000,
      this.config.tokenPollIntervalMs,
      this.logger,
    );
  }

  start(): void {
    this.queue.recoverOnStartup();
    this.watcherManager.start();
    this.heartbeat.start();
    this.drainTimer = setInterval(() => void this.drainOnce(), DRAIN_POLL_MS);
    this.statusTimer = setInterval(() => this.writeStatus(), DRAIN_POLL_MS);
    this.writeStatus();
    this.logger.info('service.started', { agentVersion: this.agentVersion });

    process.on('SIGINT', () => void this.shutdown('SIGINT'));
    process.on('SIGTERM', () => void this.shutdown('SIGTERM'));
  }

  private async drainOnce(): Promise<void> {
    if (this.draining || this.shuttingDown) return;
    if (!this.authState.isValid()) return;
    this.draining = true;
    const run = (async () => {
      const items = this.queue.listReadyPending();
      for (const item of items) {
        if (this.shuttingDown || !this.authState.isValid()) break;
        await this.processItem(item.meta);
      }
    })();
    this.activeUpload = run;
    try {
      await run;
    } finally {
      this.draining = false;
      this.activeUpload = null;
      this.writeStatus();
    }
  }

  private async processItem(meta: QueueMeta): Promise<void> {
    this.queue.moveToProcessing(meta.ingestKey);
    const filePath = this.queue.pathFor('processing', meta.ingestKey, meta.safeExtension);
    let fileBuffer: Buffer;
    try {
      fileBuffer = fs.readFileSync(filePath);
    } catch {
      // Dosya processing/'e taşındıktan sonra okunamıyorsa (beklenmedik durum) kalıcı hata say.
      this.queue.fail(meta.ingestKey, { ...meta, lastErrorCategory: 'quarantined_orphan' });
      return;
    }

    const outcome = await attemptUpload(meta, fileBuffer, this.authState.getToken(), {
      serverUrl: this.config.serverUrl,
    });
    logUploadOutcome(this.logger, meta, outcome);

    if (outcome.category === 'success') {
      this.queue.complete(meta.ingestKey);
      return;
    }

    if (outcome.category === 'auth_failure') {
      // Öğe kalıcı hata değil — sistem sorunu; pending'e geri koy, draining tamamen dursun.
      this.queue.retryLater(meta.ingestKey, meta);
      this.authState.markInvalid();
      return;
    }

    if (outcome.category === 'permanent') {
      this.queue.fail(meta.ingestKey, { ...meta, lastErrorCategory: outcome.errorCategory });
      return;
    }

    // retryable (429/5xx/ağ hatası)
    const nextAttemptCount = meta.attemptCount + 1;
    if (nextAttemptCount >= this.config.maxAttempts) {
      this.queue.fail(meta.ingestKey, {
        ...meta,
        attemptCount: nextAttemptCount,
        lastErrorCategory: 'max_attempts_exceeded',
      });
      return;
    }
    const delayMs = computeBackoffMs(nextAttemptCount, {
      baseMs: this.config.backoffBaseMs,
      capMs: this.config.backoffCapMs,
    });
    this.queue.retryLater(meta.ingestKey, {
      ...meta,
      attemptCount: nextAttemptCount,
      nextAttemptAt: new Date(Date.now() + delayMs).toISOString(),
    });
  }

  private writeStatus(): void {
    const counts = this.queue.counts();
    const status: AgentStatus = {
      agentVersion: this.agentVersion,
      startedAt: this.startedAt,
      connectionState: this.authState.isValid() ? 'online' : 'offline',
      authState: this.authState.isValid() ? 'valid' : 'invalid',
      lastHeartbeatAt: this.heartbeat.lastSuccessAt,
      pendingCount: counts.pending,
      failedCount: counts.failed,
      watchedFolders: this.watcherManager.availability().map(w => ({ watchId: w.watchId, available: w.available })),
    };
    this.statusWriter.write(status);
  }

  async shutdown(signal: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.logger.info('service.shutting_down', { signal });

    if (this.drainTimer) clearInterval(this.drainTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.watcherManager.stop();
    this.heartbeat.stop();

    // Aktif yüklemenin bitmesini bekle (kuyruk metadata'sı bozulmasın).
    if (this.activeUpload) {
      await this.activeUpload.catch(() => {});
    }

    this.writeStatus();
    this.logger.info('service.stopped', {});
    this.logger.close();
  }
}
