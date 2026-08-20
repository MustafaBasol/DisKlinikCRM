/**
 * fileStorage.ts — Hasta/lab dosyaları için depolama soyutlaması
 * (docs/45 Faz 3 #11).
 *
 * Varsayılan: yerel disk (uploads/ altında, klinik bazında izole) — tek
 * sunuculu kurulumda davranış değişmez. S3_BUCKET tanımlanırsa dosyalar
 * S3-uyumlu depoya (AWS S3, MinIO, Cloudflare R2...) yazılır; birden fazla
 * API replikası aynı dosyaları görür ve disk dolması riski kalkar.
 *
 * Ortam değişkenleri (S3 modu):
 *   S3_BUCKET            — zorunlu; tanımlıysa S3 modu açılır
 *   S3_REGION            — varsayılan "auto" (MinIO/R2 için yeterli)
 *   S3_ENDPOINT          — AWS dışı S3-uyumlu servisler için
 *   S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY — verilmezse SDK'nın varsayılan
 *                          kimlik zinciri (IAM rolü vb.) kullanılır
 *   S3_FORCE_PATH_STYLE  — "true" → path-style URL (MinIO için gerekli)
 *
 * Referans (DB'deki filePath kolonu) iki biçimde olabilir:
 *   - Mutlak yol  → eski kayıtlar; her zaman yerel diskten okunur/silinir.
 *   - "clinicId/dosya" anahtarı → yeni kayıtlar; S3 modunda S3'ten, değilse
 *     uploads/ altından okunur. Böylece S3'e geçiş eski dosyaları bozmaz.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import prisma from '../db.js';
import { safeErrorFields } from '../utils/safeError.js';
import {
  isImagingRemoteStorageEnabled,
  putImagingObject,
  getImagingObjectStream,
  imagingObjectExists,
  deleteImagingObject,
  resolveImagingStoragePlacement,
} from './imagingRemoteStorage.js';
import type { ImagingStoragePlacement } from './imagingRemoteStorage.js';

// Re-exported so that modules OUTSIDE the imaging domain — routes/imaging.ts,
// fileBackupService.ts — can interpret a persisted ImagingImage.storageBackend
// value without importing the VPS2 provider module directly. Their accepted
// dependency is on this storage-abstraction contract; imagingRemoteStorage.ts
// is provider internals and stays reachable only from here and from the
// imaging domain itself. This is a re-export, not a second implementation:
// resolveImagingStoragePlacement remains the single authoritative interpreter.
export { resolveImagingStoragePlacement };
export type { ImagingStoragePlacement };

const BASE_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

export function isRemoteStorageEnabled(): boolean {
  return Boolean(process.env.S3_BUCKET?.trim());
}

let s3Client: S3Client | null = null;

function getS3(): S3Client {
  if (s3Client) return s3Client;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  s3Client = new S3Client({
    region: process.env.S3_REGION?.trim() || 'auto',
    ...(process.env.S3_ENDPOINT?.trim() ? { endpoint: process.env.S3_ENDPOINT.trim() } : {}),
    ...(process.env.S3_FORCE_PATH_STYLE === 'true' ? { forcePathStyle: true } : {}),
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  });
  return s3Client;
}

function bucket(): string {
  return process.env.S3_BUCKET!.trim();
}

// ── Authoritative storage-key contract (F4-1A) ───────────────────────────────

/**
 * F4-1A key-contract reconciliation.
 *
 * Before F4-1A there were two independent key builders here plus two more in
 * fileBackupDestination.ts / fileBackupService.ts, each deciding its own
 * literal shape inline. `buildObjectStorageKey` is now the single place where
 * the shape of a *primary runtime object key* is decided; `buildStorageKey`
 * and `buildExportStorageKey` are kept as the class-specific façades their
 * existing callers (and the static call-site regression tests) rely on, and
 * both delegate here.
 *
 * F4-1A2 (caller migration) completed the second half of that reconciliation:
 * routes/labOrders.ts and services/imaging/imagingIngestCore.ts used to borrow
 * `buildStorageKey` — the PATIENT-ATTACHMENT façade — for a lab attachment and
 * an imaging image respectively, so two of the three content classes were
 * mislabelled at the call site even though the emitted bytes were right. Both
 * now call `buildObjectStorageKey` with their own `kind`. `buildStorageKey`
 * remains, narrowed to the one class it actually names (patient attachments,
 * routes/attachments.ts), and `buildExportStorageKey` is unchanged. No key
 * shape moved: all three content kinds share one template by design, which
 * `storageKeyContract.test.ts` §8 proves by exact string equality.
 *
 * The key SHAPES are deliberately unchanged — this is a contract/validation
 * change, not a key migration (storage-key migration is frozen: see
 * docs/program/KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md §3 item 8). Every
 * previously-written DB `filePath`/`storageKey` value stays byte-identical and
 * keeps resolving through the same code path, because nothing in the codebase
 * ever *reconstructs* a key — reads always pass the persisted column value.
 *
 * Backup destination keys (`file-backups/<domain>/<clinicId>/<id>.bin`) and
 * backup run manifests (`file-backups/manifests/<runId>.json`) are NOT part of
 * this contract. They are operational backup artifacts owned by
 * fileBackupDestination.ts / fileBackupService.ts, derived from an already-
 * persisted source record rather than from request input, and they stay
 * separate on purpose.
 */
export type StorageObjectSpec =
  /** Patient attachment, lab-order attachment and imaging image binaries all
   *  share one key namespace: `<clinicId>/<opaqueId><ext>`. */
  | { kind: 'patient-attachment' | 'lab-attachment' | 'imaging-image'; clinicId: string; originalName: string }
  /** KVKK patient export and clinic bulk export archives: `exports/<clinicId>/<exportId>.zip`. */
  | { kind: 'export-archive'; clinicId: string; exportId: string };

/** A single key path segment may never be empty, carry a separator, traverse. */
function assertSafeKeySegment(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid storage key segment: ${label} must be a non-empty string`);
  }
  if (/[\\/]/.test(value)) {
    throw new Error(`Invalid storage key segment: ${label} must not contain a path separator`);
  }
  if (CONTROL_CHAR.test(value)) {
    throw new Error(`Invalid storage key segment: ${label} must not contain control characters`);
  }
  if (value === '.' || value === '..' || value.includes('..')) {
    throw new Error(`Invalid storage key segment: ${label} must not contain path traversal`);
  }
  if (WINDOWS_DRIVE_PREFIX.test(value)) {
    throw new Error(`Invalid storage key segment: ${label} must not be a drive-qualified path`);
  }
  return value;
}

/**
 * Extension is the ONLY fragment of a key influenced by client input, so it is
 * taken from the (already signature-validated) originalName and then hard
 * constrained to a short alphanumeric suffix. Anything else — including the
 * bare "." that path.extname() returns for a name like "report." — is dropped
 * rather than embedded in a key.
 */
function normalizeKeyExtension(originalName: string): string {
  const ext = path.extname(typeof originalName === 'string' ? originalName : '').toLowerCase();
  return /^\.[a-z0-9]{1,12}$/.test(ext) ? ext : '';
}

/**
 * The authoritative builder for primary runtime object keys. Validates every
 * server-derived segment, then re-checks its own output against
 * isSafeStorageKey() so no caller can ever persist a key that the KVKK-era
 * lookup gate (fileExists/statFile) would later refuse to resolve.
 */
export function buildObjectStorageKey(spec: StorageObjectSpec): string {
  const clinicId = assertSafeKeySegment(spec.clinicId, 'clinicId');
  let key: string;
  switch (spec.kind) {
    case 'patient-attachment':
    case 'lab-attachment':
    case 'imaging-image':
      key = `${clinicId}/${Date.now()}-${Math.random().toString(36).slice(2)}${normalizeKeyExtension(spec.originalName)}`;
      break;
    case 'export-archive':
      key = `exports/${clinicId}/${assertSafeKeySegment(spec.exportId, 'exportId')}.zip`;
      break;
    default: {
      const exhaustive: never = spec;
      throw new Error(`Unsupported storage object kind: ${JSON.stringify(exhaustive)}`);
    }
  }
  if (!isSafeStorageKey(key)) {
    // Unreachable given the segment validation above; kept as a fail-closed
    // post-condition so a future edit to the templates cannot silently emit a
    // key that escapes the upload root via resolveLocalPath().
    throw new Error('Refusing to emit an unsafe storage key');
  }
  return key;
}

/**
 * Yeni dosya için depolama anahtarı üretir: `clinicId/timestamp-rand.ext`.
 * clinicId ve üretilen ad sunucu kaynaklı olduğundan path traversal riski yok;
 * uzantı yine de dosya adından değil, doğrulanmış originalName'den alınır.
 *
 * The PATIENT-ATTACHMENT façade (routes/attachments.ts). Since F4-1A2 the lab
 * and imaging callers no longer borrow this name — they declare their own
 * `kind` — so this is once again a single-class façade. Delegates to
 * buildObjectStorageKey; see the contract note above. Throws if clinicId is
 * empty or carries a separator/traversal: previously such a value produced a
 * key like "/1699999999-abc.pdf", which resolveLocalPath() would have honoured
 * as an ABSOLUTE path and written outside the upload root.
 */
export function buildStorageKey(clinicId: string, originalName: string): string {
  return buildObjectStorageKey({ kind: 'patient-attachment', clinicId, originalName });
}

/** Depolama anahtarından dosya adını (DB'deki fileName kolonu) döner. */
export function fileNameFromKey(key: string): string {
  return path.posix.basename(key);
}

function resolveLocalPath(ref: string): string {
  return path.isAbsolute(ref) ? ref : path.join(BASE_UPLOAD_DIR, ref);
}

/** Doğrulanmış içeriği verilen anahtarla kaydeder. Hata fırlatırsa çağıran 500 döner. */
export async function saveFile(key: string, body: Buffer, contentType: string): Promise<void> {
  if (isRemoteStorageEnabled()) {
    await getS3().send(new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
    return;
  }
  const localPath = resolveLocalPath(key);
  await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
  await fs.promises.writeFile(localPath, body);
}

/**
 * Dosyayı okunabilir stream olarak açar; dosya yoksa null döner.
 * Mutlak yollu (eski) kayıtlar her zaman yerel diskten okunur.
 */
export async function openFileStream(ref: string): Promise<Readable | null> {
  if (!path.isAbsolute(ref) && isRemoteStorageEnabled()) {
    try {
      const result = await getS3().send(new GetObjectCommand({ Bucket: bucket(), Key: ref }));
      return (result.Body as Readable) ?? null;
    } catch (error: any) {
      if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  }
  const localPath = resolveLocalPath(ref);
  if (!fs.existsSync(localPath)) return null;
  return fs.createReadStream(localPath);
}

// Matches a Windows drive prefix ("C:\...", "C:/...", or the drive-relative
// "C:relative-file" form) regardless of host OS.
const WINDOWS_DRIVE_PREFIX = /^[A-Za-z]:/;
// Matches a UNC/backslash-or-slash-doubled prefix ("\\server\share",
// "//server/share") regardless of host OS.
const UNC_PREFIX = /^[\\/]{2}/;
// NUL byte or any other C0 control character — never valid in a storage key.
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR = /[\x00-\x1f]/;

/**
 * Yeni (KVKK yaşam döngüsü, docs/compliance/53) kod yolları için güvenlik
 * kapısı: mutlak yol veya ".." içeren anahtarları reddeder. Eski mutlak-yol
 * fallback'ı (resolveLocalPath) yalnızca legacy kayıtlar içindir — bu kapı
 * yeni özelliklerin o fallback'i asla kullanmamasını garanti eder.
 *
 * Node's own `path.isAbsolute(ref)` is platform-dependent: on Linux it does
 * not recognize a Windows absolute path like "C:\Windows\System32" as
 * absolute, so a check built only on the host implementation lets attacker
 * paths through on Linux production servers (found via PR #160 follow-up:
 * npm run test:kvkk-lifecycle failing on Linux). This function instead uses
 * explicit, host-independent checks so behavior is identical on every OS the
 * server might run on.
 */
export function isSafeStorageKey(ref: string): boolean {
  if (!ref || typeof ref !== 'string') return false;
  if (CONTROL_CHAR.test(ref)) return false;
  if (path.posix.isAbsolute(ref)) return false;
  if (path.win32.isAbsolute(ref)) return false;
  if (UNC_PREFIX.test(ref)) return false;
  if (WINDOWS_DRIVE_PREFIX.test(ref)) return false;
  const normalized = ref.split(/[\\/]/).filter(Boolean);
  if (normalized.some((segment) => segment === '..' || segment === '.')) return false;
  if (ref.includes('..')) return false;
  return true;
}

/**
 * Dosyanın var olup olmadığını, içeriğini açmadan kontrol eder (HEAD/stat).
 * Yalnızca yeni ("clinicId/..." veya "exports/clinicId/...") anahtarlarla
 * çalışır — mutlak yol kabul etmez (bkz. isSafeStorageKey).
 */
export async function fileExists(ref: string): Promise<boolean> {
  if (!isSafeStorageKey(ref)) return false;
  if (isRemoteStorageEnabled()) {
    try {
      await getS3().send(new HeadObjectCommand({ Bucket: bucket(), Key: ref }));
      return true;
    } catch (error: any) {
      if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) return false;
      throw error;
    }
  }
  const localPath = resolveLocalPath(ref);
  return fs.existsSync(localPath);
}

/**
 * Dosyanın boyutu gibi metadata'sını, içeriğini açmadan döner; dosya yoksa
 * null döner. Yalnızca yeni ("clinicId/..." veya "exports/clinicId/...")
 * anahtarlarla çalışır — mutlak yol kabul etmez.
 */
export async function statFile(ref: string): Promise<{ size: number } | null> {
  if (!isSafeStorageKey(ref)) return null;
  if (isRemoteStorageEnabled()) {
    try {
      const result = await getS3().send(new HeadObjectCommand({ Bucket: bucket(), Key: ref }));
      return { size: Number(result.ContentLength ?? 0) };
    } catch (error: any) {
      if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  }
  const localPath = resolveLocalPath(ref);
  try {
    const stat = await fs.promises.stat(localPath);
    return { size: stat.size };
  } catch {
    return null;
  }
}

/**
 * Yeni bir dışa aktarım (export) paketi için depolama anahtarı üretir:
 * `exports/clinicId/uuid.zip`. clinicId sunucu tarafında doğrulanmış oturum
 * bilgisinden, uuid ise crypto.randomUUID()'den gelir — hiçbir kullanıcı
 * girdisi yol segmentine karışmaz, bu yüzden path traversal yapısal olarak
 * imkansızdır.
 */
export function buildExportStorageKey(clinicId: string, exportId: string): string {
  return buildObjectStorageKey({ kind: 'export-archive', clinicId, exportId });
}

// ── Private export temp directory (KVKK-HIGH-004 crash-safety remediation) ─

/**
 * A dedicated OS-temp subdirectory for bulk-export ZIP staging, SEPARATE
 * from the shared, world-writable-by-convention `os.tmpdir()` root — a
 * complete, unencrypted clinic/patient ZIP must never sit directly under a
 * shared temp root where any other local process/user could plausibly list
 * or read it before the export's own DB-based cleanup discovers it. Path is
 * fully server-derived (os.tmpdir() + a fixed literal subdirectory name) —
 * no client input ever reaches it.
 */
const EXPORT_TEMP_DIR = path.join(os.tmpdir(), 'diskliniks-export-tmp');

export function getExportTempDir(): string {
  return EXPORT_TEMP_DIR;
}

const EXPORT_TEMP_DIR_MODE = 0o700;

/**
 * Stable, internal-only error for a private-temp-directory fail-closed
 * verification failure (final review round, P0). Never carries the raw
 * filesystem path or the underlying OS error in its message — callers/logs
 * must key off `code` (`'TEMP_STORAGE_UNSAFE'`) only, never free text, so a
 * log line can never leak a local path. Thrown instead of silently
 * proceeding: no ZIP may ever be created, no storageKey ever persisted, and
 * no upload ever attempted against an unverified temp directory.
 */
export class ExportTempStorageUnsafeError extends Error {
  readonly code = 'TEMP_STORAGE_UNSAFE';
  constructor() {
    super('Export temp storage failed fail-closed verification.');
    this.name = 'ExportTempStorageUnsafeError';
  }
}

/**
 * Rejects anything that is not itself a real, safely-owned directory —
 * called both on a pre-existing path (BEFORE it is ever chmod'd — chmod
 * follows a symlink to its target on POSIX, so a symlink must be rejected
 * here rather than "corrected") and again on the final state after
 * mkdir/chmod, so the function never returns having merely assumed success.
 */
function assertSafeExportTempDirStat(stat: fs.Stats): void {
  if (stat.isSymbolicLink()) {
    console.error('[fileStorage] TEMP_STORAGE_UNSAFE (symlink)');
    throw new ExportTempStorageUnsafeError();
  }
  if (!stat.isDirectory()) {
    console.error('[fileStorage] TEMP_STORAGE_UNSAFE (not-a-directory)');
    throw new ExportTempStorageUnsafeError();
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    console.error('[fileStorage] TEMP_STORAGE_UNSAFE (unsafe-ownership)');
    throw new ExportTempStorageUnsafeError();
  }
}

/**
 * Creates (idempotently) the private export temp directory with mode 0700
 * and verifies it server-side, fail-closed, both before and after
 * mkdir/chmod (final review round, P0). The fixed path itself
 * (`EXPORT_TEMP_DIR`) is built entirely from server-controlled segments
 * (`os.tmpdir()` + a literal subdirectory name) — no client input ever
 * reaches it.
 *
 * Verification uses `lstat`, never `stat`, so a symlink at this fixed path
 * is inspected as itself, not silently followed to whatever it points at —
 * a symlink, any non-directory object, or (on POSIX, where
 * `process.getuid()` exists) a directory owned by a different user is
 * rejected outright rather than "fixed" by chmod'ing through it. An
 * existing, safe (real-directory, correctly-owned) path has its mode
 * re-asserted via an UNCAUGHT `chmod` — a `chmod` failure must fail this
 * call closed, never be swallowed. After mkdir/chmod, the path is `lstat`'d
 * again and re-verified (POSIX-only mode assertion; Windows synthesizes
 * mode bits from the read-only attribute only, so mode is not literally
 * meaningful there, though the symlink/non-directory/ownership checks still
 * apply on every OS).
 *
 * On any failure this throws `ExportTempStorageUnsafeError` — callers
 * (`generateClinicBulkExport`) must let this propagate to their ordinary
 * failure path (no ZIP created, no storageKey persisted, no upload
 * attempted), and log only the stable `TEMP_STORAGE_UNSAFE` code.
 *
 * `chmodForTest` is a test-only override for the chmod call, never passed
 * by any production call site (mirrors `uploadForTest`/`deleteForTest`
 * elsewhere in this feature) — it exists so a unit test can deterministically
 * force a chmod failure and prove this fails closed, without needing root or
 * a second OS user to construct a real permission-denied chmod.
 */
export async function ensureExportTempDir(
  chmodForTest?: (targetPath: string, mode: number) => Promise<void>,
): Promise<string> {
  const chmod = chmodForTest ?? ((targetPath: string, mode: number) => fs.promises.chmod(targetPath, mode));
  const dirPath = EXPORT_TEMP_DIR;

  let existingStat: fs.Stats | null;
  try {
    existingStat = await fs.promises.lstat(dirPath);
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.error('[fileStorage] TEMP_STORAGE_UNSAFE (lstat failed)', safeErrorFields(err));
      throw new ExportTempStorageUnsafeError();
    }
    existingStat = null;
  }

  if (!existingStat) {
    await fs.promises.mkdir(dirPath, { recursive: true, mode: EXPORT_TEMP_DIR_MODE });
  } else {
    // Reject a symlink/non-directory/unsafe-owner target BEFORE ever
    // chmod'ing it — chmod(2) follows a symlink to its target on POSIX, so
    // "correcting" a symlink's mode would silently chmod whatever it points
    // at instead of rejecting the unsafe path outright.
    assertSafeExportTempDirStat(existingStat);
    // Never swallowed: a chmod failure must fail this call closed, not
    // silently proceed with whatever mode the directory already had.
    try {
      await chmod(dirPath, EXPORT_TEMP_DIR_MODE);
    } catch (err) {
      console.error('[fileStorage] TEMP_STORAGE_UNSAFE (chmod failed)', safeErrorFields(err));
      throw new ExportTempStorageUnsafeError();
    }
  }

  const finalStat = await fs.promises.lstat(dirPath);
  assertSafeExportTempDirStat(finalStat);
  if (process.platform !== 'win32' && (finalStat.mode & 0o777) !== EXPORT_TEMP_DIR_MODE) {
    console.error('[fileStorage] TEMP_STORAGE_UNSAFE (final mode mismatch)');
    throw new ExportTempStorageUnsafeError();
  }

  return dirPath;
}

/**
 * Recognized filename pattern for a bulk-export temp ZIP:
 * `export-<jobId>-<16 hex random>.zip`. Used both to BUILD the path (see
 * buildExportTempFilePath) and to recognize which files under
 * getExportTempDir() a stale-temp sweep may ever consider deleting — a
 * sweep must never touch an unrelated file that happens to land in the same
 * OS temp directory.
 */
const EXPORT_TEMP_FILE_PATTERN = /^export-([0-9a-f-]{36})-[0-9a-f]{16}\.zip$/;

export function parseExportTempFileName(fileName: string): { jobId: string } | null {
  const match = EXPORT_TEMP_FILE_PATTERN.exec(fileName);
  return match ? { jobId: match[1]! } : null;
}

/**
 * Builds a fresh, unique temp-ZIP path for one export job inside the private
 * temp directory — deterministic safe prefix (`export-`) + the job id +
 * random suffix, so a stale-temp sweep can recognize and attribute the file
 * without any DB lookup by path alone, while the random suffix still
 * guarantees `wx` (exclusive-create) never collides even for retried jobs
 * reusing the same id is not possible (job ids are unique), or concurrent
 * writers in the pathological case of two processes racing the same job id.
 */
export function buildExportTempFilePath(jobId: string): string {
  const random = crypto.randomBytes(8).toString('hex');
  return path.join(EXPORT_TEMP_DIR, `export-${jobId}-${random}.zip`);
}

/**
 * Streams a file already on local disk (e.g. a temp file built by
 * archiver) into final storage without ever buffering it fully in process
 * memory. Local mode: rename/copy on the same filesystem. S3 mode: multipart
 * streaming upload via @aws-sdk/lib-storage's Upload class (body is a
 * read stream, never a single in-memory Buffer).
 *
 * Used by patientPrivacyExportPackage.ts so large ZIP export packages are
 * never fully materialized as a Buffer/Buffer[] in process memory.
 *
 * Temp-file contract (PR #160 review — P0 fix): this function ALWAYS
 * consumes/removes `tempFilePath` before returning or throwing, in every
 * mode — callers must never rely on their own cleanup of this path. Without
 * this, a sensitive patient ZIP could be left under the OS temp directory
 * indefinitely (the cleanup job/TTL logic only knows about the *storage*
 * key, never about this local scratch file).
 *
 * Partial-artifact contract (local mode, second review round): this
 * function NEVER stream-copies directly into the final storage path. A
 * cross-device (EXDEV) copy always lands in a unique `.partial-<uuid>`
 * sibling first; only a same-directory (same-filesystem) rename promotes it
 * to the final path, which is atomic — there is no window where a reader of
 * `key` can observe a truncated file. If the copy into the partial path
 * fails partway through, the partial file is removed in `finally` and the
 * final path is never touched, so no orphaned/truncated artifact is left
 * behind with no DB storageKey reference and no TTL cleanup path.
 */
export async function saveFileFromPath(key: string, tempFilePath: string, contentType: string): Promise<void> {
  if (isRemoteStorageEnabled()) {
    try {
      const body = fs.createReadStream(tempFilePath);
      const upload = new Upload({
        client: getS3(),
        params: { Bucket: bucket(), Key: key, Body: body, ContentType: contentType },
        // Explicit (matches the library default): abort and clean up any
        // already-uploaded parts of a multipart upload on failure, rather
        // than leaving orphaned parts billed/stored in the bucket.
        leavePartsOnError: false,
      });
      await upload.done();
    } finally {
      // Runs on both success and failure — the temp file must never survive
      // this call either way.
      await fs.promises.unlink(tempFilePath).catch(() => {});
    }
    return;
  }
  const localPath = resolveLocalPath(key);
  await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
  const partialPath = `${localPath}.partial-${crypto.randomUUID()}`;
  try {
    try {
      // Fast path: same-filesystem rename (no copy) into the partial path —
      // tempFilePath no longer exists at its old path once this succeeds.
      // The rename preserves tempFilePath's own mode (0600 for callers using
      // buildExportTempFilePath), but the explicit chmod below re-asserts it
      // regardless of the source file's origin.
      await fs.promises.rename(tempFilePath, partialPath);
    } catch {
      // Cross-device (EXDEV) or other rename failure — fall back to a
      // streamed copy into the partial path (never the final path), still
      // without loading the whole file into memory. pipeline() propagates
      // errors from either side and destroys both streams on failure. The
      // destination stream is opened with an explicit 0600 mode: unlike the
      // rename fast path above, createWriteStream() would otherwise create
      // this file with the process's default (umask-derived) mode, which is
      // typically far more permissive than the sensitive export contents
      // warrant.
      await pipeline(fs.createReadStream(tempFilePath), fs.createWriteStream(partialPath, { mode: 0o600, flags: 'wx' }));
      await fs.promises.unlink(tempFilePath).catch(() => {});
    }
    // Belt-and-suspenders: re-assert 0600 on the partial file right before
    // promoting it, regardless of which path above produced it.
    await fs.promises.chmod(partialPath, 0o600).catch(() => {});
    // Promote the fully-written partial file to its final name. Same
    // directory => same filesystem => atomic rename; readers of `key` never
    // observe a partially-written file. Rename preserves the partial file's
    // mode, so the final artifact is 0600 too without a further chmod.
    await fs.promises.rename(partialPath, localPath);
  } finally {
    // Belt-and-suspenders cleanup: whichever of tempFilePath/partialPath is
    // still present after success or failure is removed here. On the
    // success path both have already been consumed by the renames above, so
    // these are no-ops (unlink of a missing path is swallowed).
    await fs.promises.unlink(tempFilePath).catch(() => {});
    await fs.promises.unlink(partialPath).catch(() => {});
  }
}

/**
 * Dosyayı siler; yoksa sessizce döner (idempotent).
 *
 * F4-3 correction: the local branch previously swallowed EVERY unlink error,
 * not just "the file is already gone". A real failure — EPERM/EACCES on a
 * locked or wrongly-owned file, EBUSY, EROFS, an I/O error — was therefore
 * indistinguishable from a successful deletion, so every caller (including the
 * KVKK erasure paths) reported the bytes as removed when they were still on
 * disk. Only ENOENT is idempotent-by-definition; anything else is now raised so
 * the caller can retain recoverable evidence instead of claiming a success it
 * cannot back up. Remote mode already behaved this way — DeleteObjectCommand's
 * rejection has always propagated — so this only aligns the two modes.
 *
 * Existing callers are unaffected in the success case, and every one of them
 * either already wraps this in `.catch(...)` or (privacy/clinicBulkExportPackage,
 * services/storageObjectDeletion) treats a raised error as "verify, then retain
 * and retry" — which is the behaviour this change makes reachable locally.
 */
export async function deleteFile(ref: string): Promise<void> {
  if (!path.isAbsolute(ref) && isRemoteStorageEnabled()) {
    await getS3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: ref }));
    return;
  }
  const localPath = resolveLocalPath(ref);
  try {
    await fs.promises.unlink(localPath);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return;
    throw err;
  }
}

/**
 * Recognized filename pattern for a `saveFileFromPath` local-mode partial
 * artifact: `<jobId>.zip.partial-<uuid>`, where `<jobId>` is the archive
 * row's own id (a `crypto.randomUUID()` value — see `reserveClinicBulkExport`)
 * and the trailing uuid is the random partial-file suffix `saveFileFromPath`
 * generates. Capturing `jobId` here (final review round, P1) is what lets
 * the sweep below look up the corresponding `ClinicBulkExportArchive` row
 * before ever deleting a candidate, instead of relying on file age alone —
 * a slow cross-device copy can legitimately still be writing this file well
 * past the age threshold.
 */
const EXPORT_PARTIAL_FILE_PATTERN = /^([0-9a-f-]{36})\.zip\.partial-[0-9a-f-]{36}$/i;

function parseExportPartialFileName(fileName: string): { jobId: string } | null {
  const match = EXPORT_PARTIAL_FILE_PATTERN.exec(fileName);
  return match ? { jobId: match[1]! } : null;
}

type ClinicBulkExportArchiveLookup = { clinicId: string; status: string; leaseExpiresAt: Date | null } | null;

/**
 * Sweeps `uploads/exports/<clinicId>/*.partial-*` for orphaned partial
 * artifacts (KVKK-HIGH-004 crash-safety remediation): saveFileFromPath's
 * local-mode promotion is a rename immediately after the partial file is
 * fully written, so a `.partial-*` file surviving past `maxAgeMs` is
 * *usually* the result of a crash between creating it and promoting it —
 * but a legitimately slow cross-device (`EXDEV`) copy can also still be
 * mid-write past that same age threshold, so age alone is never sufficient
 * (final review round, P1). Before deleting a recognized candidate, this
 * derives its clinic id (the containing directory) and job id (the
 * filename — see `parseExportPartialFileName`) and confirms the
 * corresponding `ClinicBulkExportArchive` row is not still actively
 * `generating` with an unexpired lease; a DB lookup failure is treated as
 * "cannot confirm inactive" and fails closed (skips deletion this run,
 * never deletes on an unconfirmed guess), exactly like the sibling
 * `sweepStaleClinicBulkExportTempFiles` (`clinicBulkExportPackage.ts`) does
 * for in-progress temp ZIPs. Local-storage-only: in S3 mode there is no
 * local partial state to sweep (a killed process leaves an incomplete
 * multipart upload in the bucket instead — see
 * docs/compliance/54-kvkk-secure-clinic-bulk-export.md for the required
 * AbortIncompleteMultipartUpload bucket lifecycle rule, which a hard process
 * kill cannot execute client-side). Never touches a file that isn't inside
 * `exports/` or doesn't match the recognized `<jobId>.zip.partial-<uuid>`
 * naming pattern. The returned count only ever reflects files actually
 * removed from disk — a candidate whose `unlink` itself fails is logged
 * (a stable code, never the raw path/exception) and NOT counted as deleted.
 *
 * `findArchiveForTest` is a test-only override for the archive-row lookup,
 * never passed by any production call site (mirrors `uploadForTest`/
 * `deleteForTest` elsewhere in this feature) — it exists so a unit test can
 * exercise the DB-gated protect/allow/fail-closed contract deterministically
 * without a live database.
 */
export async function cleanupStaleLocalExportPartialFiles(
  maxAgeMs: number,
  now: Date = new Date(),
  findArchiveForTest?: (jobId: string) => Promise<ClinicBulkExportArchiveLookup>,
): Promise<number> {
  if (isRemoteStorageEnabled()) return 0;
  const findArchive =
    findArchiveForTest ??
    ((jobId: string) =>
      prisma.clinicBulkExportArchive.findUnique({
        where: { id: jobId },
        select: { clinicId: true, status: true, leaseExpiresAt: true },
      }));
  const exportsRoot = path.join(BASE_UPLOAD_DIR, 'exports');
  let clinicDirs: string[];
  try {
    clinicDirs = await fs.promises.readdir(exportsRoot);
  } catch {
    return 0;
  }
  let deleted = 0;
  for (const clinicDir of clinicDirs) {
    const fullDir = path.join(exportsRoot, clinicDir);
    let entries: string[];
    try {
      entries = await fs.promises.readdir(fullDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const parsed = parseExportPartialFileName(entry);
      if (!parsed) continue; // never touch a file this sweep doesn't recognize as its own naming pattern
      const filePath = path.join(fullDir, entry);
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(filePath);
      } catch {
        continue; // vanished between readdir and stat — nothing to do
      }
      if (!stat.isFile()) continue;
      if (now.getTime() - stat.mtimeMs < maxAgeMs) continue;

      try {
        const row = await findArchive(parsed.jobId);
        if (row && row.clinicId !== clinicDir) {
          // The filename's job id resolves to a DIFFERENT clinic than the
          // directory it was found in — never plausible for a real
          // saveFileFromPath-produced file. Treat as unconfirmed, skip.
          console.error('[fileStorage] stale-partial sweep: clinicId/jobId mismatch, skipping this run');
          continue;
        }
        const activelyGenerating =
          row?.status === 'generating' && row.leaseExpiresAt !== null && row.leaseExpiresAt.getTime() > now.getTime();
        if (activelyGenerating) continue; // never delete a live in-progress (e.g. slow cross-device) copy
      } catch (err) {
        console.error('[fileStorage] stale-partial sweep: DB lookup failed, skipping file this run', safeErrorFields(err));
        continue; // fail closed — never delete without a confirmed-inactive DB row
      }

      try {
        await fs.promises.unlink(filePath);
        deleted++; // only counted once the unlink itself has actually succeeded
      } catch (err) {
        console.error('[fileStorage] stale-partial sweep: unlink failed', safeErrorFields(err));
      }
    }
  }
  return deleted;
}

// ── F4-IMAGING-001: imaging-only VPS2 storage routing (additive) ───────────
//
// Every function below is a thin routing wrapper around the module-level
// primitives above (unchanged) plus imagingRemoteStorage.ts's VPS2 client.
// None of the functions above this section were modified to add this.
//
// Default (IMAGING_STORAGE_BACKEND unset): isImagingRemoteStorageEnabled()
// is false, so every wrapper below degrades to calling the exact existing
// function (saveFile/openFileStream/fileExists/deleteFile) with no branch
// taken — current production behavior for imaging is unchanged until an
// operator explicitly sets IMAGING_STORAGE_BACKEND=vps2.
//
// Only 'imaging-image' kind objects route through these; patient
// attachments, lab attachments and export archives keep calling
// saveFile/openFileStream/fileExists/deleteFile directly, exactly as before
// (see routes/attachments.ts, routes/labOrders.ts, patientPrivacyExportPackage.ts).

/**
 * F4-IMAGING-001-R6 (architecture review, PR #464) — FAIL-CLOSED ERROR FOR AN
 * EXPLICITLY-VPS2 OBJECT WHOSE REFERENCE CANNOT BE AN OBJECT-STORAGE KEY.
 *
 * A row that records `storageBackend = 'vps2'` asserts a historical fact:
 * those bytes were written to the VPS2 object store, with `filePath` used
 * verbatim as the object key. A `filePath` that `isSafeStorageKey()` rejects
 * (an absolute path, a UNC/drive-prefixed path, a traversal segment, a
 * control character) can never have been such a key — `saveImagingFile()`
 * only ever receives a `buildObjectStorageKey()` result — so the row is
 * internally inconsistent and this process cannot tell where the bytes are.
 *
 * Before this error existed, that combination fell through to the legacy
 * branch on the read and exists paths while `deleteImagingFile()` still
 * routed to VPS2, so one and the same object could answer "legacy" to a read,
 * "legacy" to an existence probe, and "VPS2" to a delete. For regulated
 * imaging data that is worse than an outage. The read hands back whatever
 * unrelated bytes happen to sit at that local path as if they were the VPS2
 * object. The exists probe answers from legacy too — a definitive `false`
 * out of `fileExists()`'s own key gate, i.e. a legacy-derived "confirmed
 * gone" about a row that says the bytes are on VPS2, which is exactly what
 * makes the orphan sweep stamp `storageVerifiedMissingAt` on a healthy row.
 * All three paths now refuse instead — read, exists and delete cannot
 * disagree, because none of them proceeds.
 *
 * Sanitized by construction, exactly like `ExportTempStorageUnsafeError`
 * above: the message is a fixed literal and callers/logs key off `code`
 * (`'IMAGING_PLACEMENT_REF_MISMATCH'`) — never the ref, never a bucket,
 * endpoint, region, credential or any patient-identifying value.
 * `safeErrorFields()` surfaces exactly that code, which is what the backup
 * sweep persists as the row's `failed` entry.
 */
export class ImagingPlacementRefMismatchError extends Error {
  readonly code = 'IMAGING_PLACEMENT_REF_MISMATCH' as const;
  constructor() {
    super('Imaging object placement and storage reference are inconsistent.');
    this.name = 'ImagingPlacementRefMismatchError';
  }
}

/**
 * Gate for every explicitly-`'vps2'` path (read / exists / delete). Throws
 * `ImagingPlacementRefMismatchError` rather than degrading to legacy or
 * sending an unusable key to the object store.
 *
 * Deliberately NOT applied to `'legacy'` placement, nor to the omitted-
 * placement compatibility seam: legacy storage is exactly where pre-key-era
 * ABSOLUTE `filePath` values legitimately live, and refusing them would break
 * every pre-R6 row (`resolveImagingStoragePlacement(NULL) === 'legacy'`).
 * The gate exists only where an absolute path is impossible by construction.
 */
function assertVps2PlacementRefUsable(ref: string): void {
  if (isSafeStorageKey(ref)) return;
  // No ref in the log line — the code is the whole signal (see safeError.ts).
  console.error('[fileStorage] IMAGING_PLACEMENT_REF_MISMATCH (vps2 placement with a non-object-storage reference)');
  throw new ImagingPlacementRefMismatchError();
}

/**
 * Write path. When VPS2 mode is active, writes go ONLY to VPS2 — never
 * silently mirrored or falling back to local/legacy S3 on failure (an
 * activated operator expects a deterministic write target; a silent
 * fallback would create untracked split-brain object placement).
 * A write failure propagates unchanged, exactly like every existing
 * saveFile() caller already handles (see imagingIngestCore.ts's outer catch).
 *
 * F4-IMAGING-001-R6: RETURNS THE BACKEND THAT ACTUALLY ACCEPTED THE BYTES,
 * so the caller can persist it on the row instead of re-deriving it from the
 * global flag afterwards. Re-deriving would be wrong for two reasons: the
 * flag can be changed between the write and the DB insert, and a re-read
 * would only ever restate configuration, never what actually happened. The
 * value returned here is produced on the same branch that performed the
 * write, so `write to VPS2 + DB says legacy` and `write to legacy + DB says
 * VPS2` are both structurally impossible. Because there is no fallback on
 * this path, a returned value always means "this backend accepted the
 * bytes"; a failed write throws and returns nothing at all.
 *
 * The arity is deliberately unchanged (3) — see imagingRemoteStorage.test.ts
 * section 9, which pins these wrappers' shapes.
 */
export async function saveImagingFile(key: string, body: Buffer, contentType: string): Promise<ImagingStoragePlacement> {
  if (isImagingRemoteStorageEnabled()) {
    await putImagingObject(key, body, contentType);
    return 'vps2';
  }
  await saveFile(key, body, contentType);
  return 'legacy';
}

/**
 * Delete path for the imaging ingest rollback compensation (see
 * imagingIngestCore.ts). Not a general-purpose imaging delete (no such route
 * exists today — see routes/imaging.ts, which has archive/unarchive but no
 * delete).
 *
 * F4-IMAGING-001-R6: `placement` is the authoritative backend to delete from.
 * The compensation caller passes the exact value `saveImagingFile()` returned
 * for the paired write, so the delete cannot target a different backend than
 * the write did even if `IMAGING_STORAGE_BACKEND` changed in between —
 * previously this re-read the global flag, which could have stranded the
 * just-written object on the other backend as an untracked orphan.
 *
 * Omitting `placement` keeps the pre-R6, flag-driven behavior for callers
 * with genuinely no per-object placement information. There are none in
 * production code; see imagingStoragePlacementCallSites.test.ts.
 *
 * ARCHITECTURE REVIEW (PR #464): an EXPLICIT `'vps2'` placement whose `key`
 * cannot be an object-storage key fails closed here too — see
 * `assertVps2PlacementRefUsable`. Without it, read/exists refusing while
 * delete still issued a VPS2 DeleteObject would be the same read/exists/delete
 * disagreement in mirror image. Today's only caller (the ingest rollback
 * compensation) always passes a `buildObjectStorageKey()` result, so the gate
 * is unreachable from production and changes no live behavior; it exists so
 * the three paths cannot drift apart. The omitted-placement seam is
 * deliberately NOT gated — it keeps its exact pre-R6 shape.
 */
export async function deleteImagingFile(key: string, placement?: ImagingStoragePlacement): Promise<void> {
  const backend = placement ?? (isImagingRemoteStorageEnabled() ? 'vps2' : 'legacy');
  if (backend === 'vps2') {
    if (placement === 'vps2') assertVps2PlacementRefUsable(key);
    await deleteImagingObject(key);
    return;
  }
  await deleteFile(key);
}

/**
 * Read path. F4-IMAGING-001-R6: THE BACKEND IS CHOSEN FROM THE OBJECT'S OWN
 * RECORDED PLACEMENT, NOT FROM `IMAGING_STORAGE_BACKEND`.
 *
 * `placement` is the authoritative value from `ImagingImage.storageBackend`,
 * already interpreted by `resolveImagingStoragePlacement()` (which maps a
 * pre-R6 NULL to `'legacy'`). Callers must pass it; every production caller
 * does.
 *
 *   - `'vps2'` — read VPS2, and ONLY VPS2. A confirmed-absent response (404 /
 *     NoSuchKey) resolves `null`, i.e. "this object is genuinely gone",
 *     because R6 neither mirrors nor moves bytes: an object recorded as VPS2
 *     has no legitimate legacy twin, so falling back to whatever happens to
 *     sit at the same key on local disk would serve unverified bytes and hide
 *     real data loss behind a success. A VPS2 lookup that THROWS
 *     (network/auth/TLS/outage — "can't tell" rather than "confirmed not
 *     here") propagates unchanged, so an outage surfaces as a failure rather
 *     than as a 404 or as silently-substituted legacy content.
 *   - `'legacy'` — read legacy, and ONLY legacy, EVEN IF the global write
 *     backend is currently `vps2`. A flag flip changes where the next object
 *     is written; it can never move an object that was already written.
 *
 * Because the branch is driven by the row rather than the environment, the
 * physical source of a given object is stable across restart, across a flag
 * flip, and across a configuration rollback — which is the whole point of R6
 * and what R5 Finding B could not provide.
 *
 * OMITTING `placement` retains the exact pre-R6 flag-driven behavior
 * (VPS2-first with a confirmed-404 legacy fallback) for callers that have no
 * per-object placement information at all. There are none in production code;
 * imagingStoragePlacementCallSites.test.ts asserts that structurally. It is
 * kept so that this module-level primitive stays usable and byte-compatible
 * for the storage-level tests that exercise it without a database row.
 *
 * `isSafeStorageKey(ref)` still gates the remote path, but ARCHITECTURE
 * REVIEW (PR #464) changed WHAT FAILING THAT GATE MEANS under an EXPLICIT
 * `'vps2'` placement. It used to fall through to `openFileStream(ref)`, i.e.
 * an object the database explicitly records as VPS2-resident was silently
 * served from legacy storage — while `deleteImagingFile(ref, 'vps2')` still
 * routed the delete to VPS2. Read said legacy, exists said legacy, delete said
 * VPS2, for one and the same object: precisely the disagreement R6 exists to
 * make impossible, and a path that can serve unverified local bytes for
 * regulated imaging data. Explicit `'vps2'` + an unusable ref now throws
 * `ImagingPlacementRefMismatchError` and never touches `openFileStream` /
 * `fileExists` / any legacy fallback.
 *
 * The gate still applies ONLY to explicit `'vps2'`. Under `'legacy'` — which
 * is what `resolveImagingStoragePlacement(NULL)` returns for every pre-R6 row
 * — a pre-key-era ABSOLUTE `filePath` is a perfectly valid local-disk object
 * and is read exactly as it always was. The omitted-placement compatibility
 * seam above is likewise unchanged.
 */
export async function openImagingFileStream(ref: string, placement?: ImagingStoragePlacement): Promise<Readable | null> {
  if (placement === undefined) {
    if (isImagingRemoteStorageEnabled() && isSafeStorageKey(ref)) {
      const remote = await getImagingObjectStream(ref);
      if (remote) return remote;
      return openFileStream(ref);
    }
    return openFileStream(ref);
  }
  if (placement === 'vps2') {
    assertVps2PlacementRefUsable(ref);
    return getImagingObjectStream(ref);
  }
  return openFileStream(ref);
}

/**
 * Same placement-authoritative contract as openImagingFileStream, for
 * existence checks: a `'vps2'` object is checked against VPS2 only (a
 * confirmed 404 is a real `false`, a provider error propagates), a `'legacy'`
 * object against legacy only. Omitting `placement` retains the pre-R6
 * flag-driven probe — see openImagingFileStream.
 *
 * ARCHITECTURE REVIEW (PR #464): an EXPLICIT `'vps2'` placement whose `ref`
 * cannot be an object-storage key throws `ImagingPlacementRefMismatchError`
 * instead of probing legacy. Any legacy-derived answer is one this process is
 * not entitled to give for a VPS2-placed row — including the `false` that
 * `fileExists()`'s key gate used to return here, which the orphan-inspection
 * sweep reads as "confirmed missing" and acts on by stamping
 * `storageVerifiedMissingAt`. `checkImageStorageExists` converts the throw to
 * its own sanitized `ImagingStorageUnavailableError`, which propagates out of
 * `inspectOrphans()` (it does not catch per row). The row is therefore never
 * classified `dbRowPhysicalMissing`, so `markConfirmedMissing()` is never
 * handed it and `storageVerifiedMissingAt` is never stamped — a failed
 * inspection instead of a false "confirmed missing", which is the fail-closed
 * outcome.
 */
export async function imagingFileExists(ref: string, placement?: ImagingStoragePlacement): Promise<boolean> {
  if (placement === undefined) {
    if (isImagingRemoteStorageEnabled() && isSafeStorageKey(ref)) {
      if (await imagingObjectExists(ref)) return true;
      return fileExists(ref);
    }
    return fileExists(ref);
  }
  if (placement === 'vps2') {
    assertVps2PlacementRefUsable(ref);
    return imagingObjectExists(ref);
  }
  return fileExists(ref);
}
