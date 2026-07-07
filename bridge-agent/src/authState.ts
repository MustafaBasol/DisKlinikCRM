/**
 * authState.ts — 401 sonrası duraklama + token dosyası değişikliği ile
 * kurtarma. Ne eski ne yeni token değeri buradan asla loglanmaz — yalnızca
 * sha256 parmak izi karşılaştırılır (bkz. config.ts:tokenFileFingerprint).
 */
import { readToken, tokenFileFingerprint } from './config.js';
import type { Logger } from './logger.js';

export class AuthState {
  private valid = true;
  private currentToken: string;
  private invalidSinceFingerprint: string | null = null;

  constructor(private readonly tokenFile: string, private readonly logger: Logger) {
    this.currentToken = readToken(tokenFile);
  }

  getToken(): string {
    return this.currentToken;
  }

  isValid(): boolean {
    return this.valid;
  }

  /** 401 alındığında çağrılır: draining/heartbeat durur, token dosyası izlenmeye başlar. */
  markInvalid(): void {
    if (this.valid) {
      this.logger.warn('auth.invalidated', {});
    }
    this.valid = false;
    this.invalidSinceFingerprint = tokenFileFingerprint(this.tokenFile);
  }

  markValid(): void {
    if (!this.valid) {
      this.logger.info('auth.recovered', {});
    }
    this.valid = true;
    this.invalidSinceFingerprint = null;
  }

  /**
   * Token dosyasının içeriği değiştiyse yeni değeri belleğe yükler ve true
   * döner (çağıran bunu bir heartbeat ile doğrulamalı). Değişmediyse false.
   */
  reloadIfTokenFileChanged(): boolean {
    const fingerprint = tokenFileFingerprint(this.tokenFile);
    if (fingerprint === null || fingerprint === this.invalidSinceFingerprint) {
      return false;
    }
    try {
      this.currentToken = readToken(this.tokenFile);
    } catch {
      return false;
    }
    return true;
  }
}
