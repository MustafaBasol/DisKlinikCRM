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

/**
 * Returns true if ENCRYPTION_KEY is set and valid.
 * Use for startup validation.
 */
export function isEncryptionKeyConfigured(): boolean {
  const hex = process.env.ENCRYPTION_KEY;
  return Boolean(hex && hex.length === KEY_HEX_LENGTH && /^[0-9a-fA-F]+$/.test(hex));
}
