import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** Sunucunun beklediği format: tam 64 küçük-harf hex sha256 özeti. */
export const INGEST_KEY_PATTERN = /^[a-f0-9]{64}$/;

export function sha256Buffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
