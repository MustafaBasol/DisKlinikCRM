/**
 * filePreview.ts — shared whitelist for inline (in-browser) attachment preview.
 *
 * Only these mime types are safe to serve with `Content-Disposition: inline`
 * (rendered directly by the browser). Everything else must stay `attachment`
 * to avoid the browser trying to execute/interpret unknown content.
 */
export const INLINE_PREVIEWABLE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
]);

export function isInlinePreviewable(mimeType: string): boolean {
  return INLINE_PREVIEWABLE_MIME_TYPES.has(mimeType);
}
