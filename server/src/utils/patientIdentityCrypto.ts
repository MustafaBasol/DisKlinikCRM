/**
 * patientIdentityCrypto.ts — DEDICATED key boundary for patient national
 * identity numbers (T.C. Kimlik No) — F3-DATA-MIG-TODAY
 *
 * WHY A DEDICATED KEY, AND NOT THE GENERAL `ENCRYPTION_KEY`
 * --------------------------------------------------------
 * Reuse of the general `ENCRYPTION_KEY` for this data was an explicitly
 * WITHDRAWN program decision. Every current `ENCRYPTION_KEY` consumer protects
 * a ROTATABLE MACHINE SECRET — a WhatsApp API token, a webhook secret, an
 * integration credential. If that key leaks, the operator revokes and reissues
 * the underlying secrets and the exposure ends.
 *
 * A T.C. Kimlik No is the opposite kind of value: immutable, lifelong and
 * government-issued. It cannot be reissued. If the key protecting ~11,500 of
 * them leaks, the harm is permanent and unremediable. That asymmetry — not
 * defence in depth for its own sake — is why this module owns its own key
 * material, its own lifecycle, and its own fail-closed configuration gate.
 *
 * NO LOGGING, EVER
 * ----------------
 * This file must never import a logger and must never call `console.*`. No
 * error message thrown from here may embed the plaintext identity value, the
 * ciphertext, the encryption key or the lookup pepper — not even truncated,
 * not even in a "debug" branch. Errors carry CODES. That rule is enforced by
 * review and by a repo static scan; do not add "temporary" diagnostics.
 *
 * NO DEVELOPMENT FALLBACK, NO "WARN AND CONTINUE"
 * ----------------------------------------------
 * Unlike the weaker production-only boot check in `utils/encryption.ts`, this
 * module FAILS CLOSED ON EVERY CALL, in every environment. There is no
 * development fallback key and no degraded path: if the key material is absent,
 * malformed, or not isolated from the other application secrets, identity
 * writes are IMPOSSIBLE. A misconfigured deploy loses the ability to import
 * identity documents; it never silently writes them under a shared or default
 * key. This mirrors `utils/passwordStepUp.ts` `assertIpHashSecretConfigured()`,
 * the repo's established dedicated-secret pattern.
 *
 * Stored ciphertext format:
 *   `pid:v<generation>:` + hex(iv(12) ‖ authTag(16) ‖ ciphertext)
 *
 * Env vars (see server/.env.example):
 *   PATIENT_IDENTITY_ENCRYPTION_KEY       64 hex chars (32 bytes), generation 1
 *   PATIENT_IDENTITY_ENCRYPTION_KEY_V<N>  optional future generations
 *   PATIENT_IDENTITY_LOOKUP_SECRET        dedicated HMAC pepper, >= 32 chars
 */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

import { MigrationError } from '../services/migration/contracts.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_HEX_LENGTH = 64; // 32 bytes
const IV_BYTES = 12; // 96-bit IV, the GCM-recommended size
const AUTH_TAG_BYTES = 16;
const MIN_LOOKUP_SECRET_LENGTH = 32;

/** Current key generation. New ciphertext is always written at this version. */
export const PATIENT_IDENTITY_CRYPTO_VERSION = 1;

const CIPHERTEXT_PREFIX = 'pid:';

/** Base env var name for generation 1. */
const PRIMARY_KEY_ENV = 'PATIENT_IDENTITY_ENCRYPTION_KEY';
const LOOKUP_SECRET_ENV = 'PATIENT_IDENTITY_LOOKUP_SECRET';

/**
 * Secrets this key material must NEVER equal. Sharing a value with any of these
 * would silently collapse the dedicated key boundary back into the general one
 * — the exact outcome the withdrawn `ENCRYPTION_KEY` reuse proposal produced.
 * Isolation is ENFORCED here, not merely documented in a runbook.
 */
const FOREIGN_SECRET_ENV_NAMES: readonly string[] = [
  'ENCRYPTION_KEY',
  'JWT_SECRET',
  'PLATFORM_JWT_SECRET',
  'CSRF_SECRET',
  'CLINIC_BULK_EXPORT_IP_HASH_SECRET',
];

export interface IdentityCryptoStatus {
  encryptionKeyConfigured: boolean;
  lookupSecretConfigured: boolean;
  keyIsolationOk: boolean;
  ready: boolean;
  cryptoVersion: number;
}

// ---------------------------------------------------------------------------
// Configuration probing (never returns, embeds or logs key material)
// ---------------------------------------------------------------------------

function keyEnvNameFor(version: number): string {
  // Generation 1 lives on the un-suffixed name so the first deploy needs one
  // variable, not two. Later generations are additive: _V2, _V3, ...
  return version === 1 ? PRIMARY_KEY_ENV : `${PRIMARY_KEY_ENV}_V${version}`;
}

function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isWellFormedKeyHex(value: string | undefined): boolean {
  return Boolean(value && value.length === KEY_HEX_LENGTH && /^[0-9a-fA-F]+$/.test(value));
}

function isEncryptionKeyConfigured(): boolean {
  return isWellFormedKeyHex(readEnv(PRIMARY_KEY_ENV));
}

function isLookupSecretConfigured(): boolean {
  const secret = readEnv(LOOKUP_SECRET_ENV);
  return Boolean(secret && secret.length >= MIN_LOOKUP_SECRET_LENGTH);
}

/**
 * Constant-time equality over SHA-256 digests of the two values.
 *
 * Digesting first does two things: it gives both operands a fixed 32-byte
 * length (so `timingSafeEqual` cannot throw on a length mismatch, and the
 * comparison leaks no length information), and it means no raw secret is ever
 * materialized alongside another raw secret for a byte-wise compare.
 */
function secretsAreEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db);
}

/**
 * True when neither the encryption key nor the lookup pepper collides with any
 * other application secret, and the two are not the same value as each other.
 *
 * Encryption key === lookup pepper is its own failure: one compromise would
 * then yield both the ability to decrypt every stored identity AND the ability
 * to compute lookup tokens for an offline dictionary sweep of the whole
 * ~9e8 valid TC space.
 */
function isKeyIsolationOk(): boolean {
  const key = readEnv(PRIMARY_KEY_ENV);
  const lookup = readEnv(LOOKUP_SECRET_ENV);

  for (const foreignName of FOREIGN_SECRET_ENV_NAMES) {
    const foreign = readEnv(foreignName);
    if (!foreign) continue;
    if (key && secretsAreEqual(key, foreign)) return false;
    if (lookup && secretsAreEqual(lookup, foreign)) return false;
  }

  if (key && lookup && secretsAreEqual(key, lookup)) return false;

  return true;
}

/**
 * Configuration snapshot for a Platform Admin readiness panel.
 *
 * NEVER returns key material, a prefix of it, a length, or a digest of it —
 * only booleans and the current crypto version.
 */
export function getPatientIdentityCryptoStatus(): IdentityCryptoStatus {
  const encryptionKeyConfigured = isEncryptionKeyConfigured();
  const lookupSecretConfigured = isLookupSecretConfigured();
  const keyIsolationOk = isKeyIsolationOk();
  return {
    encryptionKeyConfigured,
    lookupSecretConfigured,
    keyIsolationOk,
    ready: encryptionKeyConfigured && lookupSecretConfigured && keyIsolationOk,
    cryptoVersion: PATIENT_IDENTITY_CRYPTO_VERSION,
  };
}

/**
 * FAIL CLOSED, PER CALL. Called at the top of every encrypt / decrypt / hash
 * entry point in this module — not only at process boot — so a misconfigured
 * deploy fails on every attempt rather than only on the first one, and so a
 * mutation of `process.env` after boot cannot open a hole.
 *
 * The thrown `MigrationError` carries a CODE and a structural detail naming the
 * variables involved. It never carries a value.
 */
export function assertPatientIdentityCryptoConfigured(): void {
  const status = getPatientIdentityCryptoStatus();

  if (!status.encryptionKeyConfigured) {
    throw new MigrationError('IDENTITY_CRYPTO_NOT_CONFIGURED', {
      message: 'Patient identity encryption key is missing or malformed',
      detail:
        `${PRIMARY_KEY_ENV} must be a ${KEY_HEX_LENGTH}-character hex string ` +
        '(generate with: openssl rand -hex 32). There is no development ' +
        'fallback key: patient identity values cannot be read or written ' +
        'while it is unset.',
    });
  }

  if (!status.lookupSecretConfigured) {
    throw new MigrationError('IDENTITY_CRYPTO_NOT_CONFIGURED', {
      message: 'Patient identity lookup secret is missing or too weak',
      detail:
        `${LOOKUP_SECRET_ENV} must be a dedicated secret of at least ` +
        `${MIN_LOOKUP_SECRET_LENGTH} characters. Without it no tenant-bound ` +
        'lookup token can be computed, so identity documents cannot be ' +
        'written or matched.',
    });
  }

  if (!status.keyIsolationOk) {
    throw new MigrationError('IDENTITY_CRYPTO_NOT_CONFIGURED', {
      message: 'Patient identity key material is not isolated',
      detail:
        `${PRIMARY_KEY_ENV} and ${LOOKUP_SECRET_ENV} must each be unique ` +
        `values, never reused from ${FOREIGN_SECRET_ENV_NAMES.join(' / ')} ` +
        'and never equal to each other. A T.C. Kimlik No cannot be reissued ' +
        'if the key protecting it leaks, so it does not share a lifecycle ' +
        'with any rotatable machine secret.',
    });
  }
}

// ---------------------------------------------------------------------------
// Key resolution
// ---------------------------------------------------------------------------

function getKeyForVersion(version: number): Buffer {
  if (!Number.isInteger(version) || version < 1) {
    throw new MigrationError('IDENTITY_CRYPTO_NOT_CONFIGURED', {
      message: 'Invalid patient identity crypto version',
      detail: 'cryptoVersion must be a positive integer key generation.',
    });
  }

  const envName = keyEnvNameFor(version);
  const hex = readEnv(envName);
  if (!isWellFormedKeyHex(hex)) {
    throw new MigrationError('IDENTITY_CRYPTO_NOT_CONFIGURED', {
      message: 'Patient identity encryption key generation is not available',
      detail:
        `${envName} must be a ${KEY_HEX_LENGTH}-character hex string for ` +
        `crypto generation ${version}. Retiring a generation before its ` +
        'ciphertext has been re-encrypted makes those rows permanently ' +
        'unreadable.',
    });
  }
  return Buffer.from(hex as string, 'hex');
}

// ---------------------------------------------------------------------------
// Encryption / decryption
// ---------------------------------------------------------------------------

/**
 * Encrypt a normalized identity value under the CURRENT key generation.
 *
 * A fresh random 12-byte IV per call means two encryptions of the same TC
 * produce different ciphertext. That is deliberate: deterministic ciphertext
 * would let anyone with DB read access group patients by identity value
 * without ever decrypting anything. Equality matching is the job of the
 * tenant-bound `lookupHash`, never of the ciphertext.
 */
export function encryptIdentityValue(plaintext: string): {
  valueEncrypted: string;
  cryptoVersion: number;
} {
  assertPatientIdentityCryptoConfigured();

  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new MigrationError('IDENTITY_INVALID', {
      message: 'Refusing to encrypt an empty identity value',
      detail: 'An absent identity is classified ABSENT, never encrypted as an empty string.',
    });
  }

  const version = PATIENT_IDENTITY_CRYPTO_VERSION;
  const key = getKeyForVersion(version);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = Buffer.concat([iv, tag, encrypted]).toString('hex');
  return {
    valueEncrypted: `${CIPHERTEXT_PREFIX}v${version}:${payload}`,
    cryptoVersion: version,
  };
}

/**
 * Decrypt a value produced by `encryptIdentityValue`.
 *
 * The `pid:v<N>:` prefix — not the caller's argument alone — decides which key
 * generation is used, so old-generation ciphertext stays readable during a
 * future rotation without a destructive rewrite. The `cryptoVersion` column
 * value is still required and must agree with the prefix: a disagreement means
 * the row and its version column have drifted apart, which is a data-integrity
 * fault and must not be silently resolved in favour of either side.
 *
 * Throws on a wrong key, a truncated payload or a tampered auth tag. The thrown
 * error never contains the plaintext or the ciphertext.
 */
export function decryptIdentityValue(valueEncrypted: string, cryptoVersion: number): string {
  assertPatientIdentityCryptoConfigured();

  if (typeof valueEncrypted !== 'string' || !valueEncrypted.startsWith(CIPHERTEXT_PREFIX)) {
    throw new MigrationError('IDENTITY_INVALID', {
      message: 'Malformed patient identity ciphertext',
      detail: `Stored value must start with "${CIPHERTEXT_PREFIX}v<version>:".`,
    });
  }

  const secondColon = valueEncrypted.indexOf(':', CIPHERTEXT_PREFIX.length);
  if (secondColon < 0) {
    throw new MigrationError('IDENTITY_INVALID', {
      message: 'Malformed patient identity ciphertext',
      detail: 'Version segment is missing its terminating separator.',
    });
  }

  const versionToken = valueEncrypted.slice(CIPHERTEXT_PREFIX.length, secondColon);
  if (!/^v[0-9]+$/.test(versionToken)) {
    throw new MigrationError('IDENTITY_INVALID', {
      message: 'Malformed patient identity ciphertext',
      detail: 'Version segment must have the form v<positive integer>.',
    });
  }

  const embeddedVersion = Number.parseInt(versionToken.slice(1), 10);
  if (embeddedVersion !== cryptoVersion) {
    throw new MigrationError('IDENTITY_INVALID', {
      message: 'Patient identity crypto version mismatch',
      detail:
        'The ciphertext version prefix and the stored cryptoVersion column ' +
        'disagree. Refusing to guess which generation is authoritative.',
    });
  }

  const payload = valueEncrypted.slice(secondColon + 1);
  if (payload.length < (IV_BYTES + AUTH_TAG_BYTES) * 2 || !/^[0-9a-fA-F]*$/.test(payload)) {
    throw new MigrationError('IDENTITY_INVALID', {
      message: 'Malformed patient identity ciphertext',
      detail: 'Payload is not hex, or is shorter than the IV and auth tag require.',
    });
  }

  const key = getKeyForVersion(embeddedVersion);
  const bytes = Buffer.from(payload, 'hex');
  const iv = bytes.subarray(0, IV_BYTES);
  const tag = bytes.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const data = bytes.subarray(IV_BYTES + AUTH_TAG_BYTES);

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    // The underlying OpenSSL error is deliberately DISCARDED rather than
    // wrapped: it is the one object in this function whose message could
    // acquire caller-supplied bytes. Authentication failed; that is the whole
    // safe fact.
    throw new MigrationError('IDENTITY_INVALID', {
      message: 'Patient identity ciphertext failed authentication',
      detail:
        'AES-256-GCM authentication failed: wrong key generation, wrong key ' +
        'material, or a tampered/truncated stored value.',
    });
  }
}

// ---------------------------------------------------------------------------
// Tenant-bound lookup token
// ---------------------------------------------------------------------------

/**
 * `HMAC-SHA256(PATIENT_IDENTITY_LOOKUP_SECRET, organizationId ':' docType ':' normalizedValue)`
 *
 * TENANT-BOUND BY CONSTRUCTION. Two design facts make this shape mandatory:
 *
 *  1. A global `HMAC(pepper, tc)` with NO tenant input would make this column a
 *     CROSS-TENANT CORRELATOR: anyone with DB read access could join two
 *     unrelated organizations' patients on identity without ever decrypting
 *     anything, and could confirm whether a given person is a patient at a
 *     clinic they have no relationship with. Binding the organizationId into
 *     the message means the same person in two organizations produces two
 *     unrelated tokens.
 *
 *  2. An UNKEYED hash (plain SHA-256 of the TC) would be PLAINTEXT WITH EXTRA
 *     STEPS. The valid T.C. Kimlik No space is ~9x10^8 values — first digit
 *     non-zero, last two digits checksum-derived — which a commodity laptop
 *     enumerates and inverts in well under a second. A keyed HMAC with a
 *     secret that never enters the database is what makes the token
 *     non-invertible for a database-only adversary.
 *
 * An empty `organizationId` is REJECTED, not defaulted. Silently hashing
 * without tenant context is precisely the failure this design exists to
 * prevent, and it would be invisible in the stored data.
 */
export function computeIdentityLookupHash(
  organizationId: string,
  docType: string,
  normalizedValue: string,
): string {
  assertPatientIdentityCryptoConfigured();

  if (typeof organizationId !== 'string' || organizationId.trim().length === 0) {
    throw new MigrationError('IDENTITY_INVALID', {
      message: 'Refusing to compute an identity lookup hash without tenant context',
      detail:
        'organizationId is required: an untenanted lookup token is a ' +
        'cross-tenant correlator, which is the exact failure this design ' +
        'prevents.',
      fieldName: 'organizationId',
    });
  }
  if (typeof docType !== 'string' || docType.trim().length === 0) {
    throw new MigrationError('IDENTITY_INVALID', {
      message: 'Refusing to compute an identity lookup hash without a document type',
      detail:
        'docType is required so a passport number and a T.C. Kimlik No with ' +
        'the same digits cannot collide on one token.',
      fieldName: 'docType',
    });
  }
  if (typeof normalizedValue !== 'string' || normalizedValue.length === 0) {
    throw new MigrationError('IDENTITY_INVALID', {
      message: 'Refusing to compute an identity lookup hash for an empty value',
      detail: 'An absent identity is classified ABSENT, never tokenized.',
    });
  }

  const secret = readEnv(LOOKUP_SECRET_ENV) as string;
  const message = `${organizationId}:${docType}:${normalizedValue}`;
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

/**
 * Display mask: seven asterisks + the LAST 4 digits, always 11 characters wide.
 *
 * WHY LAST-4 AND NOT FIRST-3. In a T.C. Kimlik No, d10 and d11 are derived from
 * the preceding digits by the two checksums. A last-4 mask therefore reveals
 * d8..d11, of which only d8 and d9 are free — the remaining unknowns are d1..d7
 * with d1 != 0, and both checksum equations must hold, leaving roughly 9x10^4
 * candidates. A first-3 mask reveals d1..d3, leaving d4..d9 free (d10, d11
 * still determined), i.e. roughly 10^4 candidates once the revealed prefix is
 * fixed and the checksums applied — a materially smaller search space. Last-4
 * is also the format staff already recognize from bank and telecom statements,
 * so it is both safer and more legible.
 *
 * The mask is computed SERVER-SIDE from the decrypted value. Plaintext is never
 * shipped to a client for the client to mask — a client-side mask is a display
 * convention, not a security control, and the plaintext would be in the
 * response body regardless.
 */
export function maskIdentityValue(plaintext: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    return '*'.repeat(11);
  }
  const tail = plaintext.slice(-4);
  return `${'*'.repeat(Math.max(0, 11 - tail.length))}${tail}`;
}
