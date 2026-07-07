/**
 * heartbeat.ts — periyodik POST /imaging/bridge/heartbeat + 401 sonrası
 * token-dosyası kurtarma denemesi (tek seferlik doğrulama heartbeat'i).
 */
import type { Logger } from './logger.js';
import type { AuthState } from './authState.js';

export interface HeartbeatDeps {
  serverUrl: string;
  agentVersion: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** true: heartbeat başarılı (2xx). false: başarısız (401 dahil). Token asla loglanmaz. */
export async function sendHeartbeat(token: string, deps: HeartbeatDeps): Promise<{ ok: boolean; status?: number }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? 15_000);
  try {
    const response = await fetchImpl(`${deps.serverUrl.replace(/\/$/, '')}/api/public/imaging/bridge/heartbeat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentVersion: deps.agentVersion }),
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timeout);
  }
}

export class HeartbeatLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private recoveryTimer: ReturnType<typeof setInterval> | null = null;
  lastSuccessAt: string | undefined;

  constructor(
    private readonly authState: AuthState,
    private readonly deps: HeartbeatDeps,
    private readonly intervalMs: number,
    private readonly tokenPollIntervalMs: number,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.recoveryTimer = setInterval(() => void this.attemptRecovery(), this.tokenPollIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.timer = null;
    this.recoveryTimer = null;
  }

  private async tick(): Promise<void> {
    if (!this.authState.isValid()) return;
    const result = await sendHeartbeat(this.authState.getToken(), this.deps);
    if (result.ok) {
      this.authState.markValid();
      this.lastSuccessAt = new Date().toISOString();
      this.logger.info('heartbeat.ok', {});
    } else if (result.status === 401) {
      this.authState.markInvalid();
    } else {
      this.logger.warn('heartbeat.failed', { status: result.status ?? null });
    }
  }

  /** Yalnızca auth geçersizken çalışır: token dosyası değiştiyse doğrulama dener. */
  private async attemptRecovery(): Promise<void> {
    if (this.authState.isValid()) return;
    if (!this.authState.reloadIfTokenFileChanged()) return;
    const result = await sendHeartbeat(this.authState.getToken(), this.deps);
    if (result.ok) {
      this.authState.markValid();
    } else {
      this.authState.markInvalid();
    }
  }
}
