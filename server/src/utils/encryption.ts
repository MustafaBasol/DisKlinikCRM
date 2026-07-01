/**
 * encryption.ts — AES-256-GCM symmetric encryption for secrets at rest
 *
 * Used to encrypt WhatsApp API keys and access tokens before persisting to DB.
 * Decryption happens only inside provider implementations — never in responses.
 *
 * Required env var:
 *   ENCRYPTION_KEY=<64 hex chars, 32 bytes>
 *   Generate with: openssl rand -hex 32
 *
 * Encoded format (all hex): iv(24) + authTag(32) + ciphertext
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_HEX_LENGTH = 64; // 32 bytes

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== KEY_HEX_LENGTH) {
    throw new Error(
      `ENCRYPTION_KEY env var must be a ${KEY_HEX_LENGTH}-char hex string. ` +
        'Generate one with: openssl rand -hex 32',
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a plaintext string.
 * Returns a hex-encoded string: iv(24) + authTag(32) + ciphertext
 */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + tag.toString('hex') + encrypted.toString('hex');
}

/**
 * Decrypt an AES-256-GCM ciphertext produced by encryptSecret().
 * Throws if the ciphertext is malformed or the key is wrong.
 */
export function decryptSecret(ciphertext: string): string {
  const key = getKey();
  const iv = Buffer.from(ciphertext.slice(0, 24), 'hex');
  const tag = Buffer.from(ciphertext.slice(24, 56), 'hex');
  const data = Buffer.from(ciphertext.slice(56), 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final('utf8');
}

const ENCRYPTED_JSON_KEY = '__encrypted';
const TAGGED_SECRET_PREFIX = 'enc:v1:';

/**
 * Encrypt a secret string with a version prefix, for columns that may still
 * hold legacy plaintext values (e.g. webhook secrets).
 */
export function encryptSecretTagged(plaintext: string): string {
  return TAGGED_SECRET_PREFIX + encryptSecret(plaintext);
}

/**
 * Decrypt a value produced by encryptSecretTagged(). Legacy plaintext values
 * (no prefix) are returned as-is so existing rows keep working until re-saved.
 */
export function decryptSecretTagged(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith(TAGGED_SECRET_PREFIX)) return value;
  return decryptSecret(value.slice(TAGGED_SECRET_PREFIX.length));
}

/**
 * Encrypt a JSON object for storage in a Prisma Json column.
 * Stored shape: { "__encrypted": "<hex ciphertext>" }
 */
export function encryptJson(value: Record<string, unknown>): Record<string, string> {
  return { [ENCRYPTED_JSON_KEY]: encryptSecret(JSON.stringify(value)) };
}

/**
 * Decrypt a Json column value produced by encryptJson().
 * Legacy plaintext objects (no __encrypted marker) are returned as-is so
 * existing rows keep working until re-saved.
 */
export function decryptJson(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const ciphertext = record[ENCRYPTED_JSON_KEY];
  if (typeof ciphertext !== 'string') return record;
  return JSON.parse(decryptSecret(ciphertext)) as Record<string, unknown>;
}

/**
 * Returns true if ENCRYPTION_KEY is set and valid.
 * Use for startup validation.
 */
export function isEncryptionKeyConfigured(): boolean {
  const hex = process.env.ENCRYPTION_KEY;
  return Boolean(hex && hex.length === KEY_HEX_LENGTH && /^[0-9a-fA-F]+$/.test(hex));
}
