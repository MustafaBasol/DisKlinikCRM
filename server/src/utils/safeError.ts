/**
 * safeError.ts — structured, non-leaking error fields for log lines.
 *
 * Raw exception objects (and even `.message`) can carry local absolute paths,
 * S3 endpoints/keys, or other environment details (e.g. Node's ENOENT
 * messages embed the file path). Routes/services that touch storage or
 * exports must log via this helper instead of the raw error, so operational
 * logs never leak a temp path, storage key, or endpoint.
 */
export function safeErrorFields(err: unknown): { errorName: string; errorCode: string } {
  const e = err as { name?: unknown; code?: unknown } | null | undefined;
  const errorName = typeof e?.name === 'string' && e.name ? e.name : 'Error';
  const errorCode = typeof e?.code === 'string' && e.code ? e.code : 'UNKNOWN';
  return { errorName, errorCode };
}

/**
 * boundedErrorType — for values that get durably persisted (e.g.
 * PlatformAdminAuditEvent.safeMetadata), even `err.name` is unsafe: it is
 * mutable, arbitrary text that a thrower can set to anything, including PII
 * or secrets. Collapse to a fixed two-value label instead of passing it
 * through.
 */
export function boundedErrorType(err: unknown): 'Error' | 'UnknownError' {
  return err instanceof Error ? 'Error' : 'UnknownError';
}
