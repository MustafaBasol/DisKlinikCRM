/**
 * Pure, DOM/library-free helpers for the DICOM viewer. Kept separate from
 * DicomViewer.tsx so they can be unit tested without loading cornerstone.
 */

export const DICOM_MIME_TYPE = 'application/dicom';

export function isDicomImage(mimeType: string | null | undefined): boolean {
  return mimeType === DICOM_MIME_TYPE;
}

/** Minimal shape of a dicom-parser DataSet — avoids depending on its types here. */
export interface DicomDataSetLike {
  uint16(tag: string): number | undefined;
  intString(tag: string): number | undefined;
  string(tag: string): string | undefined;
}

// Transfer syntaxes cornerstone-wado-image-loader (4.13.x, no-web-worker bundle)
// can decode. Anything outside this list is reported as unsupported up front
// instead of attempting a decode that is known to fail.
export const SUPPORTED_TRANSFER_SYNTAXES: ReadonlySet<string> = new Set([
  '1.2.840.10008.1.2', // Implicit VR Little Endian
  '1.2.840.10008.1.2.1', // Explicit VR Little Endian
  '1.2.840.10008.1.2.1.99', // Deflated Explicit VR Little Endian
  '1.2.840.10008.1.2.2', // Explicit VR Big Endian
  '1.2.840.10008.1.2.5', // RLE Lossless
  '1.2.840.10008.1.2.4.50', // JPEG Baseline (Process 1)
  '1.2.840.10008.1.2.4.51', // JPEG Extended (Process 2 & 4)
  '1.2.840.10008.1.2.4.57', // JPEG Lossless, Non-Hierarchical
  '1.2.840.10008.1.2.4.70', // JPEG Lossless, Non-Hierarchical, First-Order Prediction
  '1.2.840.10008.1.2.4.80', // JPEG-LS Lossless
  '1.2.840.10008.1.2.4.81', // JPEG-LS Near-Lossless
  '1.2.840.10008.1.2.4.90', // JPEG 2000 Lossless Only
  '1.2.840.10008.1.2.4.91', // JPEG 2000
]);

export function isSupportedTransferSyntax(transferSyntaxUid: string | null | undefined): boolean {
  if (!transferSyntaxUid) return true; // unknown/absent — let the decoder attempt it
  return SUPPORTED_TRANSFER_SYNTAXES.has(transferSyntaxUid.trim());
}

export type FrameSupport = 'single-frame' | 'multi-frame';

/** NumberOfFrames (0028,0008) — absent or 1 means single-frame. */
export function classifyDicomSupport(dataSet: DicomDataSetLike): FrameSupport {
  const raw = dataSet.intString('x00280008');
  return raw && raw > 1 ? 'multi-frame' : 'single-frame';
}

export interface SafeDicomMetadata {
  rows?: number;
  columns?: number;
  bitsAllocated?: number;
  bitsStored?: number;
  photometricInterpretation?: string;
  numberOfFrames: number;
  transferSyntaxUid?: string;
  transferSyntaxSupported: boolean;
}

/**
 * Extracts only safe, non-identifying technical tags. Deliberately never
 * touches patient/identity tags (0010,xxxx), accession number, referring
 * physician, institution, operator, or free-text comment fields.
 */
export function mapSafeDicomMetadata(dataSet: DicomDataSetLike): SafeDicomMetadata {
  const numberOfFrames = dataSet.intString('x00280008') ?? 1;
  const transferSyntaxUid = dataSet.string('x00020010');
  return {
    rows: dataSet.uint16('x00280010'),
    columns: dataSet.uint16('x00280011'),
    bitsAllocated: dataSet.uint16('x00280100'),
    bitsStored: dataSet.uint16('x00280101'),
    photometricInterpretation: dataSet.string('x00280004'),
    numberOfFrames,
    transferSyntaxUid,
    transferSyntaxSupported: isSupportedTransferSyntax(transferSyntaxUid),
  };
}

export type ViewerErrorKind =
  | 'unauthorized'
  | 'not-found'
  | 'unsupported'
  | 'multi-frame-unsupported'
  | 'network'
  | 'failed';

/**
 * Maps any thrown value to a safe, enum-like error kind. Never returns or
 * logs the raw error message/stack — callers look up a localized string
 * for the returned kind.
 */
export function mapViewerError(error: unknown): ViewerErrorKind {
  const status = extractHttpStatus(error);
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not-found';
  if (isNetworkError(error)) return 'network';
  return 'failed';
}

function extractHttpStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { status?: unknown } }).response;
    if (response && typeof response.status === 'number') return response.status;
  }
  return undefined;
}

function isNetworkError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (code === 'ECONNABORTED' || code === 'ERR_NETWORK') return true;
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && /network/i.test(message)) return true;
  }
  return false;
}
