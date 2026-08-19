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
} from './imagingRemoteStorage.js';

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
 * Write path. When VPS2 mode is active, writes go ONLY to VPS2 — never
 * silently mirrored or falling back to local/legacy S3 on failure (an
 * activated operator expects a deterministic write target; a silent
 * fallback would create untracked split-brain object placement, since no
 * DB column records which backend holds a given key). A write failure
 * propagates unchanged, exactly like every existing saveFile() caller
 * already handles (see imagingIngestCore.ts's outer catch).
 */
export async function saveImagingFile(key: string, body: Buffer, contentType: string): Promise<void> {
  if (isImagingRemoteStorageEnabled()) {
    await putImagingObject(key, body, contentType);
    return;
  }
  await saveFile(key, body, contentType);
}

/**
 * Delete path for the imaging ingest rollback compensation (see
 * imagingIngestCore.ts) — targets whichever backend the paired
 * saveImagingFile() call just wrote to, using the same active-backend
 * check, never a lookup. Not a general-purpose imaging delete (no such
 * route exists today — see routes/imaging.ts, which has archive/unarchive
 * but no delete).
 */
export async function deleteImagingFile(key: string): Promise<void> {
  if (isImagingRemoteStorageEnabled()) {
    await deleteImagingObject(key);
    return;
  }
  await deleteFile(key);
}

/**
 * Read path. `new object -> VPS2; legacy object -> VPS2 lookup, then
 * controlled legacy fallback if necessary` (F4-IMAGING-001 storage
 * contract): a CONFIRMED-absent VPS2 lookup (getImagingObjectStream
 * resolves null on 404/NoSuchKey) falls back to the existing
 * openFileStream() — the only scenario in which this reads from
 * local/legacy S3 while VPS2 mode is active, and it is exactly the
 * "object was written before VPS2 was ever activated" case. A VPS2
 * lookup that instead THROWS (network/auth/other failure — "can't tell"
 * rather than "confirmed not here") is never treated as a fallback
 * trigger: it propagates, so a VPS2 outage surfaces as a failed
 * request rather than silently substituting unrelated legacy content or
 * masking the outage as a 404.
 */
export async function openImagingFileStream(ref: string): Promise<Readable | null> {
  if (isImagingRemoteStorageEnabled() && isSafeStorageKey(ref)) {
    const remote = await getImagingObjectStream(ref);
    if (remote) return remote;
    return openFileStream(ref);
  }
  return openFileStream(ref);
}

/** Same VPS2-first/legacy-fallback/unavailable-propagates contract as openImagingFileStream, for existence checks. */
export async function imagingFileExists(ref: string): Promise<boolean> {
  if (isImagingRemoteStorageEnabled() && isSafeStorageKey(ref)) {
    if (await imagingObjectExists(ref)) return true;
    return fileExists(ref);
  }
  return fileExists(ref);
}
