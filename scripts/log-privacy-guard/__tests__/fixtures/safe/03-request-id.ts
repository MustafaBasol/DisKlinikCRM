// Fixture: opaque correlation id logged as metadata.
// Expected: zero findings.
export function safeLogsRequestId(requestId: string) {
  console.error('[route] handler failed', { requestId });
}
