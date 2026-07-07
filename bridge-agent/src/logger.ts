/**
 * logger.ts — JSON-lines log dosyası, gün başına döner (basit boyut/tarih
 * tabanlı kapasite, ek kütüphane gerekmez).
 *
 * KRİTİK: Bu dosyaya asla token, Authorization header değeri, izlenen
 * klasörün gerçek dosya sistemi yolu veya kaynak dosyanın orijinal adı
 * geçirilmemelidir. Çağıranlar yalnızca `watchId` ve `ingestKey`'in ilk 12
 * hex karakterini referans alır — bkz. docs/48 "Loglama" bölümü ve
 * tests/lifecycle.test.ts'teki kaynak-regresyon testleri.
 */
import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: string | number | boolean | null | undefined;
}

export class Logger {
  private readonly logDir: string;
  private currentDate = '';
  private stream: fs.WriteStream | null = null;

  constructor(logDir: string) {
    this.logDir = logDir;
    fs.mkdirSync(logDir, { recursive: true });
  }

  private ensureStream(): fs.WriteStream {
    const today = new Date().toISOString().slice(0, 10);
    if (!this.stream || this.currentDate !== today) {
      this.stream?.end();
      this.currentDate = today;
      this.stream = fs.createWriteStream(path.join(this.logDir, `bridge-agent-${today}.jsonl`), {
        flags: 'a',
      });
      // Testlerde/geçici dizin silindiğinde tetiklenebilecek gecikmeli async
      // yazma hatalarının süreci düşürmesini engeller — loglama asla kritik değildir.
      this.stream.on('error', () => {});
    }
    return this.stream;
  }

  private write(level: LogLevel, event: string, fields: LogFields = {}): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
    try {
      this.ensureStream().write(line + '\n');
    } catch {
      // Loglama hatası servisi asla düşürmemeli.
    }
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  info(event: string, fields?: LogFields): void {
    this.write('info', event, fields);
  }

  warn(event: string, fields?: LogFields): void {
    this.write('warn', event, fields);
  }

  error(event: string, fields?: LogFields): void {
    this.write('error', event, fields);
  }

  close(): void {
    this.stream?.end();
    this.stream = null;
  }
}

/** ingestKey'in yalnızca ilk 12 hex karakteri loglanır — tam değer bile PII değildir ama gereksiz uzunluk taşınmaz. */
export function shortIngestKey(ingestKey: string): string {
  return ingestKey.slice(0, 12);
}
