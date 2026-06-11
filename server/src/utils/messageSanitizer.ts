/**
 * messageSanitizer.ts — Shared inbound message text sanitization utilities.
 *
 * Used by all AI-connected inbound channels (Evolution WhatsApp, Meta WhatsApp,
 * Instagram DM) before text reaches any AI layer.
 *
 * NOTE: Rate limiting for multi-instance deployments should use Redis instead of
 * the in-memory store provided by inboundRateLimiter.ts. The in-memory store is
 * safe only for single-process deployments.
 */

/**
 * Sanitize inbound message text before passing to the AI layer.
 *
 * - Trims whitespace.
 * - Caps length to maxLength characters (default 2000).
 * - Safely handles empty or non-string input by returning an empty string.
 *
 * @param text      Raw text from inbound webhook payload.
 * @param maxLength Maximum allowed characters. Defaults to 2000.
 * @returns         Sanitized, trimmed, length-capped string.
 */
export function sanitizeInboundMessageText(
  text: unknown,
  maxLength = 2000,
): string {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  console.info('[message-sanitizer] message truncated', {
    originalLength: trimmed.length,
    maxLength,
  });
  return trimmed.slice(0, maxLength);
}
