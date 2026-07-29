/**
 * Collision-resistant naming for disposable-runtime resources (F1-003-P2).
 *
 * Naming algorithm per docs/program/evidence/F1-003-P2A_DISPOSABLE_RUNTIME_PROVISIONING_DESIGN.md
 * §K.2: runKey derived from a UTC timestamp + cryptographically random suffix +
 * process ID; nmtest_<scopeTag>_<runKey> for databases, nmtest-<scopeTag>-<runKey>
 * for buckets, nmtest-pg-<scopeTag>-<runKey> / nmtest-minio-<scopeTag>-<runKey> for
 * containers. All names are sanitized per target system's own character/length rules.
 */
import { randomBytes } from 'node:crypto';

export interface RunIdentity {
  runId: string;
  createdAt: string; // ISO 8601 UTC
}

const DOCKER_NAME_MAX = 63;
const PG_IDENT_MAX = 63;
const BUCKET_MAX = 63;
const BUCKET_MIN = 3;

export function generateRunId(now: Date = new Date(), pid: number = process.pid): RunIdentity {
  const compactTs = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const rand = randomBytes(4).toString('hex');
  const runId = `${compactTs}-${rand}-${pid}`;
  return { runId, createdAt: now.toISOString() };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function truncateEnd(input: string, max: number, trimChar: RegExp): string {
  if (input.length <= max) return input;
  return input.slice(0, max).replace(trimChar, '');
}

export function containerName(kind: 'pg' | 'minio', scopeTag: string, runId: string): string {
  const name = truncateEnd(slugify(`nmtest-${kind}-${scopeTag}-${runId}`), DOCKER_NAME_MAX, /-+$/);
  return name.length > 0 ? name : `nmtest-${kind}-fallback`;
}

export function networkName(scopeTag: string, runId: string): string {
  const name = truncateEnd(slugify(`nmtest-net-${scopeTag}-${runId}`), DOCKER_NAME_MAX, /-+$/);
  return name.length > 0 ? name : 'nmtest-net-fallback';
}

export function databaseName(scopeTag: string, runId: string): string {
  let raw = `nmtest_${scopeTag}_${runId}`
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  raw = truncateEnd(raw, PG_IDENT_MAX, /_+$/);
  if (/^[0-9]/.test(raw)) raw = `n${raw}`.slice(0, PG_IDENT_MAX);
  return raw.length > 0 ? raw : 'nmtest_fallback';
}

export function dbUsername(scopeTag: string, runId: string): string {
  let raw = `nmt_${scopeTag}_${runId}`
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  raw = truncateEnd(raw, 63, /_+$/);
  if (/^[0-9]/.test(raw)) raw = `u${raw}`.slice(0, 63);
  return raw.length > 0 ? raw : 'nmt_fallback';
}

export function bucketName(scopeTag: string, runId: string): string {
  let s = slugify(`nmtest-${scopeTag}-${runId}`);
  s = truncateEnd(s, BUCKET_MAX, /-+$/);
  s = s.replace(/^-+/, '').replace(/-+$/, '');
  if (s.length < BUCKET_MIN) s = s.padEnd(BUCKET_MIN, '0');
  return s;
}

/** Cryptographically random per-run secret (never logged/committed). */
export function generateSecret(byteLength = 24): string {
  return randomBytes(byteLength).toString('base64url');
}

/** Cryptographically random per-run access-key-id (hex — safe charset for every target system). */
export function generateAccessKeyId(): string {
  return `nmtest${randomBytes(8).toString('hex')}`;
}
