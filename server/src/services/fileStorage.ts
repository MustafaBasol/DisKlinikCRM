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

/**
 * Yeni dosya için depolama anahtarı üretir: `clinicId/timestamp-rand.ext`.
 * clinicId ve üretilen ad sunucu kaynaklı olduğundan path traversal riski yok;
 * uzantı yine de dosya adından değil, doğrulanmış originalName'den alınır.
 */
export function buildStorageKey(clinicId: string, originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  return `${clinicId}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
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
  return `exports/${clinicId}/${exportId}.zip`;
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
      await fs.promises.rename(tempFilePath, partialPath);
    } catch {
      // Cross-device (EXDEV) or other rename failure — fall back to a
      // streamed copy into the partial path (never the final path), still
      // without loading the whole file into memory. pipeline() propagates
      // errors from either side and destroys both streams on failure.
      await pipeline(fs.createReadStream(tempFilePath), fs.createWriteStream(partialPath));
      await fs.promises.unlink(tempFilePath).catch(() => {});
    }
    // Promote the fully-written partial file to its final name. Same
    // directory => same filesystem => atomic rename; readers of `key` never
    // observe a partially-written file.
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

/** Dosyayı siler; yoksa sessizce döner (idempotent). */
export async function deleteFile(ref: string): Promise<void> {
  if (!path.isAbsolute(ref) && isRemoteStorageEnabled()) {
    await getS3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: ref }));
    return;
  }
  const localPath = resolveLocalPath(ref);
  await fs.promises.unlink(localPath).catch(() => {});
}
