/**
 * imagingUploadValidation.ts — Görüntüleme dosya yükleme doğrulama sabitleri.
 *
 * routes/imaging.ts (manuel yükleme) ve routes/imagingBridgePublic.ts (köprü
 * yükleme) aynı MIME/uzantı/boyut kurallarını paylaşır — tek kaynak burada.
 */

import path from 'path';

export const IMAGING_ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp',
  'application/dicom',
]);

export const IMAGING_EXTENSIONS_BY_MIME: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'application/dicom': ['.dcm', '.dicom'],
};

export const DICOM_EXTENSIONS = ['.dcm', '.dicom'];

export const MAX_FILE_MB = Math.max(1, Number(process.env.IMAGING_MAX_FILE_MB) || 50);

/**
 * Tarayıcılar .dcm dosyalarını çoğunlukla application/octet-stream olarak
 * beyan eder; uzantı DICOM ise beyan edilen tipi application/dicom'a
 * normalize ederiz. İçerik yine de magic-byte (DICM @128) ile doğrulanır.
 */
export function normalizeDeclaredMime(mimetype: string, originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  if (DICOM_EXTENSIONS.includes(ext) && (mimetype === 'application/dicom' || mimetype === 'application/octet-stream')) {
    return 'application/dicom';
  }
  return mimetype;
}
