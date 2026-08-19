/**
 * patientIdentityService.ts — F3-DATA-MIG-TODAY-001-UI-001-R1
 *
 * The ONE place that knows how to validate, lock, duplicate-check, encrypt
 * and persist a clinic-facing T.C. Kimlik No against PatientIdentityDocument.
 * Both the nested sub-resource route (routes/patientIdentity.ts) and the
 * patient-create route (routes/patients.ts, when a TCKN is supplied at
 * creation time) call THIS module rather than touching
 * encryptIdentityValue/computeIdentityLookupHash/validateTckn directly, so
 * the validation -> lookup -> crypto -> persistence pipeline exists in
 * exactly one place.
 *
 * Reuses, never re-implements:
 *   - shape/checksum validation: services/migration/identity/tckn.ts
 *   - encryption, tenant-bound lookup hash, display mask:
 *     utils/patientIdentityCrypto.ts
 *
 * NO LOGGING OF THE RAW VALUE, EVER. Every function here that can fail
 * throws a PatientIdentityError carrying a CODE only — never the submitted
 * value, never a prefix or length-derived hint of it beyond what
 * validateTckn's failureReason already safely exposes (see tckn.ts's own
 * "NO LOGGING, EVER" contract).
 *
 * DUPLICATE ENFORCEMENT (F3-DATA-MIG-TODAY-001-UI-001-R1 architecture
 * decision — application layer only, no schema change):
 *   PatientIdentityDocument deliberately carries NO database-level unique
 *   constraint on (organizationId, docType, lookupHash) — see the model's
 *   doc comment in prisma/schema.prisma: legacy migration data can contain
 *   genuine duplicates that must import as soft warnings, never as a hard
 *   rejection. The UI-driven write path in this file enforces "same TCKN,
 *   different patient, same org -> reject" purely at the application layer,
 *   inside the SAME transaction as the write, serialized by a
 *   per-(organization, docType, lookupHash) PostgreSQL advisory transaction
 *   lock — the same pg_advisory_xact_lock primitive already established by
 *   services/patientMedicalHistoryConcurrency.ts and
 *   services/patientEmergencyContactsConcurrency.ts for this exact class of
 *   read-then-write race, just re-keyed to this domain. This closes the
 *   concurrent-duplicate-assignment race for two UI writers; it does NOT and
 *   cannot retroactively deduplicate legacy migration-imported rows, which
 *   remain intentionally unconstrained.
 */

import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { validateTckn, type TcknFailureReason } from './migration/identity/tckn.js';
import {
  computeIdentityLookupHash,
  encryptIdentityValue,
  decryptIdentityValue,
  maskIdentityValue,
} from '../utils/patientIdentityCrypto.js';

/** Backend string contract — see PatientIdentityDocument.docType in prisma/schema.prisma. */
export const PATIENT_IDENTITY_DOC_TYPE = 'TCKN';

/**
 * Roles permitted to write a patient's TCKN AND to read its masked metadata.
 * Deliberately identical for read and write: only staff who manage patient
 * identity documents at all should see even the masked present/absent state.
 * DENTIST (clinical, not identity-management) and BILLING (financial-only
 * patient access — see patients.ts's restricted BILLING select) are excluded
 * from both, per the F3-DATA-MIG-TODAY-001-UI-001-R1 authorization contract.
 */
export const PATIENT_IDENTITY_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST'];

export type PatientIdentityErrorCode = 'IDENTITY_TCKN_INVALID' | 'IDENTITY_ALREADY_ASSIGNED';

/**
 * The only error type this module throws. `reason` (when present) is always
 * one of TcknFailureReason's fixed CODES — never a value, never a length, per
 * tckn.ts's own "NO LOGGING, EVER" contract.
 */
export class PatientIdentityError extends Error {
  readonly code: PatientIdentityErrorCode;
  readonly httpStatus: number;
  readonly reason?: TcknFailureReason;

  constructor(code: PatientIdentityErrorCode, options: { httpStatus: number; reason?: TcknFailureReason }) {
    super(code);
    this.name = 'PatientIdentityError';
    this.code = code;
    this.httpStatus = options.httpStatus;
    this.reason = options.reason;
  }
}

/** Safe, PII-free, user-facing message for each error code. Never echoes the submitted value. */
export function safeIdentityErrorMessage(code: PatientIdentityErrorCode): string {
  switch (code) {
    case 'IDENTITY_TCKN_INVALID':
      return 'The provided T.C. Kimlik No is not valid.';
    case 'IDENTITY_ALREADY_ASSIGNED':
      return 'This identity number is already assigned to another patient.';
    default:
      return 'The identity request could not be completed.';
  }
}

export interface MaskedIdentity {
  present: boolean;
  type: typeof PATIENT_IDENTITY_DOC_TYPE;
  maskedValue: string | null;
}

type IdentityReadClient = Pick<PrismaClient, 'patientIdentityDocument'> | Prisma.TransactionClient;
type IdentityWriteClient = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Per-(organization, docType, lookupHash) advisory lock — closes the
// concurrent-duplicate-assignment race for UI writers. Domain-separated from
// every other advisory lock in this codebase by its own string prefix, even
// though all advisory locks share PostgreSQL's single global (int4, int4)
// key space (see patientMedicalHistoryConcurrency.ts for the same pattern).
// ---------------------------------------------------------------------------

function computeIdentityAssignmentLockKey(organizationId: string, docType: string, lookupHash: string): [number, number] {
  const hash = createHash('sha256')
    .update(`patient-identity-assignment:${organizationId}:${docType}:${lookupHash}`, 'utf8')
    .digest();
  return [hash.readInt32BE(0), hash.readInt32BE(4)];
}

async function acquireIdentityAssignmentLock(
  tx: IdentityWriteClient,
  organizationId: string,
  docType: string,
  lookupHash: string,
): Promise<void> {
  const [key1, key2] = computeIdentityAssignmentLockKey(organizationId, docType, lookupHash);
  // pg_advisory_xact_lock(int4,int4): explicit casts required — Prisma binds
  // JS numbers as int8 by default, but PostgreSQL has no (bigint,bigint) overload.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key1}::int4, ${key2}::int4)`;
}

// ---------------------------------------------------------------------------
// Write path
// ---------------------------------------------------------------------------

/**
 * Validate, lock, duplicate-check, encrypt and upsert a patient's TCKN — the
 * ONLY entry point either write caller (routes/patientIdentity.ts PUT,
 * routes/patients.ts POST-with-identity) should use.
 *
 * MUST be called with a transaction client that is still open when this
 * resolves — every step (lock, duplicate check, upsert) happens inside the
 * caller's transaction, so a caller-side rollback (e.g. the surrounding
 * Patient.create failing) undoes the identity write with it.
 *
 * Throws PatientIdentityError('IDENTITY_TCKN_INVALID') for a malformed value
 * (shape/checksum) and PatientIdentityError('IDENTITY_ALREADY_ASSIGNED') when
 * the same normalized value is already assigned to a DIFFERENT patient in the
 * same organization. Never leaks which patient.
 */
export async function writeIdentityInTx(
  tx: IdentityWriteClient,
  params: { patientId: string; clinicId: string; organizationId: string; rawValue: string },
): Promise<{ maskedValue: string; created: boolean }> {
  const { normalized, valid, failureReason } = validateTckn(params.rawValue);
  if (!valid) {
    throw new PatientIdentityError('IDENTITY_TCKN_INVALID', { httpStatus: 400, reason: failureReason });
  }

  const lookupHash = computeIdentityLookupHash(params.organizationId, PATIENT_IDENTITY_DOC_TYPE, normalized);

  await acquireIdentityAssignmentLock(tx, params.organizationId, PATIENT_IDENTITY_DOC_TYPE, lookupHash);

  const conflict = await tx.patientIdentityDocument.findFirst({
    where: {
      organizationId: params.organizationId,
      docType: PATIENT_IDENTITY_DOC_TYPE,
      lookupHash,
      patientId: { not: params.patientId },
    },
    select: { id: true },
  });
  if (conflict) {
    throw new PatientIdentityError('IDENTITY_ALREADY_ASSIGNED', { httpStatus: 409 });
  }

  const existing = await tx.patientIdentityDocument.findUnique({
    where: { patientId_docType: { patientId: params.patientId, docType: PATIENT_IDENTITY_DOC_TYPE } },
    select: { id: true },
  });

  const { valueEncrypted, cryptoVersion } = encryptIdentityValue(normalized);

  await tx.patientIdentityDocument.upsert({
    where: { patientId_docType: { patientId: params.patientId, docType: PATIENT_IDENTITY_DOC_TYPE } },
    create: {
      patientId: params.patientId,
      clinicId: params.clinicId,
      organizationId: params.organizationId,
      docType: PATIENT_IDENTITY_DOC_TYPE,
      valueEncrypted,
      lookupHash,
      cryptoVersion,
      isVerified: true,
    },
    update: {
      clinicId: params.clinicId,
      organizationId: params.organizationId,
      valueEncrypted,
      lookupHash,
      cryptoVersion,
      isVerified: true,
    },
  });

  // Masked directly from the just-validated plaintext — no need to re-read
  // and decrypt what this same call just encrypted.
  return { maskedValue: maskIdentityValue(normalized), created: !existing };
}

// ---------------------------------------------------------------------------
// Read path
// ---------------------------------------------------------------------------

/**
 * Masked identity metadata only — present/absent, type, last-4-digits mask.
 * NEVER returns the ciphertext, the lookup hash, the crypto version, or the
 * plaintext. This is the ONLY shape a normal patient-management client may
 * ever receive for a patient's identity document (the separate, already-
 * existing KVKK export/decryption flow is out of scope for this function).
 */
export async function getMaskedIdentityForPatient(client: IdentityReadClient, patientId: string): Promise<MaskedIdentity> {
  const row = await client.patientIdentityDocument.findUnique({
    where: { patientId_docType: { patientId, docType: PATIENT_IDENTITY_DOC_TYPE } },
    select: { valueEncrypted: true, cryptoVersion: true },
  });

  if (!row) {
    return { present: false, type: PATIENT_IDENTITY_DOC_TYPE, maskedValue: null };
  }

  const plaintext = decryptIdentityValue(row.valueEncrypted, row.cryptoVersion);
  return { present: true, type: PATIENT_IDENTITY_DOC_TYPE, maskedValue: maskIdentityValue(plaintext) };
}
