/**
 * fileType.ts — server/src/services/imaging/imagingUploadValidation.ts ve
 * server/src/utils/fileSignature.ts ile aynı MIME/uzantı/magic-byte setini
 * kasıtlı olarak yansıtır (WebP dahil) — ajan sunucunun kabul etmeyeceği bir
 * dosyayı asla kuyruğa almaz.
 */

export const SAFE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/dicom': '.dcm',
};

export const WATCHED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.dcm', '.dicom'];

function hasMagic(bytes: Buffer, magic: number[]): boolean {
  return magic.every((value, index) => bytes[index] === value);
}

/**
 * Yalnızca sunucunun kabul ettiği 4 tür için magic-byte tespiti. Bilinmeyen
 * her şey null döner — ajan bunu kuyruğa almaz.
 */
export function detectContentType(buffer: Buffer): string | null {
  if (buffer.length >= 132 && buffer.subarray(128, 132).toString('ascii') === 'DICM') {
    return 'application/dicom';
  }
  const bytes = buffer.subarray(0, 16);
  if (hasMagic(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (hasMagic(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function safeExtensionFor(contentType: string): string | null {
  return SAFE_EXTENSION_BY_MIME[contentType] ?? null;
}
