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
import { Readable } from 'stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

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

/** Dosyayı siler; yoksa sessizce döner (idempotent). */
export async function deleteFile(ref: string): Promise<void> {
  if (!path.isAbsolute(ref) && isRemoteStorageEnabled()) {
    await getS3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: ref }));
    return;
  }
  const localPath = resolveLocalPath(ref);
  await fs.promises.unlink(localPath).catch(() => {});
}
