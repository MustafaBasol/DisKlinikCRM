/**
 * config.ts — bridge-agent yapılandırma şeması ve yükleyicisi.
 *
 * Token BİLEREK bu dosyanın şemasında YOK: `tokenFile` yalnızca ayrı bir
 * dosyanın yolunu tutar, düz metin token asla config.json içine yazılmaz
 * (bkz. server tarafındaki aynı ilke — token hiçbir listede/logda görünmez).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { WATCHED_EXTENSIONS } from './fileType.js';

const watchSchema = z.object({
  id: z.string().min(1).optional(),
  path: z.string().min(1),
  deviceId: z.string().min(1),
  modality: z.string().min(1).optional(),
  patterns: z.array(z.string().min(1)).optional(),
});

export const configSchema = z
  .object({
    serverUrl: z.string().url(),
    tokenFile: z.string().min(1),
    queueDir: z.string().min(1),
    logDir: z.string().min(1),
    statusDir: z.string().min(1).optional(),
    heartbeatIntervalSeconds: z.number().int().positive().default(60),
    stabilityMs: z.number().int().nonnegative().default(5000),
    importExisting: z.boolean().default(false),
    maxAttempts: z.number().int().positive().default(100),
    backoffBaseMs: z.number().int().positive().default(60_000),
    backoffCapMs: z.number().int().positive().default(900_000),
    tokenPollIntervalMs: z.number().int().positive().default(15_000),
    watches: z.array(watchSchema).min(1),
  })
  .superRefine((cfg, ctx) => {
    let url: URL;
    try {
      url = new URL(cfg.serverUrl);
    } catch {
      ctx.addIssue({ code: 'custom', path: ['serverUrl'], message: 'invalid URL' });
      return;
    }
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !isLocalhost) {
      ctx.addIssue({
        code: 'custom',
        path: ['serverUrl'],
        message: 'serverUrl must use https:// in production; http:// is only allowed for localhost/127.0.0.1 development',
      });
    }
  });

export type RawConfig = z.infer<typeof configSchema>;

export interface ResolvedWatch {
  watchId: string;
  path: string;
  deviceId: string;
  modality?: string;
  extensions: string[];
}

export interface ResolvedConfig extends Omit<RawConfig, 'watches'> {
  statusDir: string;
  watches: ResolvedWatch[];
}

/** watchId verilmediyse deviceId+index'ten deterministik, kısa bir kimlik türetilir. */
function deriveWatchId(deviceId: string, index: number): string {
  return crypto.createHash('sha256').update(`${deviceId}:${index}`).digest('hex').slice(0, 12);
}

export function parseConfig(raw: unknown): ResolvedConfig {
  const parsed = configSchema.parse(raw);
  const statusDir = parsed.statusDir ?? path.join(path.dirname(parsed.queueDir), 'status');
  const watches: ResolvedWatch[] = parsed.watches.map((w, index) => ({
    watchId: w.id ?? deriveWatchId(w.deviceId, index),
    path: w.path,
    deviceId: w.deviceId,
    modality: w.modality,
    extensions: (w.patterns && w.patterns.length > 0 ? w.patterns : WATCHED_EXTENSIONS).map(ext =>
      ext.toLowerCase(),
    ),
  }));
  const seen = new Set<string>();
  for (const w of watches) {
    if (seen.has(w.watchId)) {
      throw new Error(`Duplicate watchId "${w.watchId}" — assign explicit unique "id" fields in config.watches`);
    }
    seen.add(w.watchId);
  }
  return { ...parsed, statusDir, watches };
}

export function loadConfig(configPath: string): ResolvedConfig {
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return parseConfig(raw);
}

/** Token ayrı dosyadan okunur; boşluk/satır sonu kırpılır. Yoksa açık hata verir. */
export function readToken(tokenFile: string): string {
  const raw = fs.readFileSync(tokenFile, 'utf8').trim();
  if (!raw) {
    throw new Error(`Token file "${tokenFile}" is empty`);
  }
  return raw;
}

export function tokenFileFingerprint(tokenFile: string): string | null {
  try {
    const raw = fs.readFileSync(tokenFile, 'utf8');
    return crypto.createHash('sha256').update(raw).digest('hex');
  } catch {
    return null;
  }
}
