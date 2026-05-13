import { authService } from '../services/api';
import { logger } from './logger';

export type SessionManagerOptions = {
  idleTimeoutMinutes?: number;
  refreshBeforeSeconds?: number;
  checkIntervalSeconds?: number;
};

export class SessionManager {
  private lastActiveAt = Date.now();
  private intervalId: number | null = null;
  private options: Required<SessionManagerOptions>;
  private getToken: () => string | null;
  private setToken: (t: string) => void;
  private onLogout: () => void;
  private boundActivityHandler: (ev: Event) => void;
  private stopped = true;

  constructor(
    getToken: () => string | null,
    setToken: (t: string) => void,
    onLogout: () => void,
    options?: SessionManagerOptions,
  ) {
    this.getToken  = getToken;
    this.setToken  = setToken;
    this.onLogout  = onLogout;
    const raw = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_IDLE_TIMEOUT_MINUTES;
    const parsed = Number(raw);
    const idleTimeoutMinutes = Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
    this.options = { idleTimeoutMinutes, refreshBeforeSeconds: 300, checkIntervalSeconds: 60, ...(options || {}) };
    this.boundActivityHandler = (ev: Event) => {
      if (typeof document !== 'undefined' && ev.type === 'visibilitychange' && document.visibilityState === 'hidden') return;
      this.lastActiveAt = Date.now();
    };
  }

  start() {
    if (!this.stopped || typeof window === 'undefined') return;
    this.stopped = false;
    this.lastActiveAt = Date.now();
    const events = ['click','keydown','mousemove','scroll','touchstart','visibilitychange'];
    events.forEach(ev => window.addEventListener(ev, this.boundActivityHandler, { passive: true }));
    this.intervalId = window.setInterval(() => this.tick(), this.options.checkIntervalSeconds * 1000);
    logger.info('SessionManager started', this.options);
  }

  stop() {
    if (this.stopped || typeof window === 'undefined') return;
    this.stopped = true;
    const events = ['click','keydown','mousemove','scroll','touchstart','visibilitychange'];
    events.forEach(ev => window.removeEventListener(ev, this.boundActivityHandler));
    if (this.intervalId != null) { clearInterval(this.intervalId); this.intervalId = null; }
    logger.info('SessionManager stopped');
  }

  private decodeJwtExp(token: string | null): number | null {
    if (!token) return null;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded  = base64 + '='.repeat((4 - base64.length % 4) % 4);
      const payload = JSON.parse(atob(padded));
      return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
    } catch { return null; }
  }

  private async tick() {
    try {
      const now = Date.now();
      if (now - this.lastActiveAt > this.options.idleTimeoutMinutes * 60_000) {
        logger.info('Idle timeout reached. Logging out.');
        this.stop();
        this.onLogout();
        return;
      }
      const token = this.getToken();
      if (!token) return;
      if (typeof document === 'undefined' || document.visibilityState === 'hidden') return;
      if (now - this.lastActiveAt > 5 * 60_000) return;
      const expMs = this.decodeJwtExp(token);
      if (!expMs) return;
      if ((expMs - now) / 1000 <= this.options.refreshBeforeSeconds) {
        try {
          const res: any = await authService.me();
          if (res?.data?.token) { this.setToken(res.data.token); logger.info('Token refreshed'); }
        } catch (e) { logger.error('Token refresh failed', e); }
      }
    } catch (e) { logger.error('SessionManager tick error', e); }
  }
}

export const createSessionManager = (
  getToken: () => string | null,
  setToken: (t: string) => void,
  onLogout: () => void,
  options?: SessionManagerOptions,
) => new SessionManager(getToken, setToken, onLogout, options);
