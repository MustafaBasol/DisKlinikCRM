/**
 * fileSignature.ts — Yüklenen dosyaların magic-byte imza doğrulaması.
 *
 * attachments.ts ve labOrders.ts'teki kopya yardımcıların ortaklaştırılmış
 * hali; dosya artık diske yazılmadan bellekteki buffer üzerinde doğrulanır
 * (S3 depolama desteği için — bkz. services/fileStorage.ts).
 */

import path from 'path';

function hasMagic(bytes: Buffer, magic: number[]) {
  return magic.every((value, index) => bytes[index] === value);
}

export function detectMimeFromBuffer(buffer: Buffer): string | null {
  // DICOM Part-10: 128 baytlık preamble + offset 128'de 'DICM' işareti.
  // Bilinçli olarak yalnızca Part-10 kabul edilir; preamble'sız (raw) DICOM
  // ve derin DICOM ayrıştırma gelecek fazların işidir (görüntüleme köprüsü).
  if (buffer.length >= 132 && buffer.subarray(128, 132).toString('ascii') === 'DICM') {
    return 'application/dicom';
  }
  const bytes = buffer.subarray(0, 16);
  if (hasMagic(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (hasMagic(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (hasMagic(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'application/msword';
  if (hasMagic(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return null;
}

/**
 * Uzantı, beyan edilen MIME ve dosya içeriği (magic bytes) üçlüsünün tutarlı
 * olduğunu doğrular. allowedExtensionsByMime, route'un kabul ettiği türlerin
 * MIME → uzantı listesi eşlemesidir.
 */
export function isAllowedFileSignature(
  buffer: Buffer,
  declaredMime: string,
  originalName: string,
  allowedExtensionsByMime: Record<string, string[]>,
): boolean {
  const ext = path.extname(originalName).toLowerCase();
  const allowedExts = allowedExtensionsByMime[declaredMime] ?? [];
  if (!allowedExts.includes(ext)) return false;
  return detectMimeFromBuffer(buffer) === declaredMime;
}
