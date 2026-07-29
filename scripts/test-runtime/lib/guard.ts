/**
 * Production-like endpoint guard. Fails closed, before any provisioning/
 * migration/test-import step runs. Verifies generated runtime identity
 * (loopback host + run-id-bearing database name), not merely a hostname
 * blacklist.
 */

export class ProductionEndpointGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionEndpointGuardError';
  }
}

// Known production hostname patterns for this program (NoraMedi).
const PRODUCTION_HOST_PATTERNS: RegExp[] = [/(^|\.)noramedi\.com$/i, /(^|\.)app\.noramedi\.com$/i];

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

export function matchesProductionHostPattern(host: string): boolean {
  return PRODUCTION_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

export interface GuardContext {
  runId: string;
}

/**
 * Database/bucket names are sanitized (lowercased, non-alphanumeric chars
 * collapsed) from the raw runId before use — so the identity check here must
 * normalize both sides the same way rather than substring-matching the raw
 * runId verbatim against a sanitized name.
 */
function normalizeForIdentityCheck(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Validates a constructed/candidate DATABASE_URL before any migration or test import. */
export function assertSafeDatabaseUrl(databaseUrl: string, ctx: GuardContext): void {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new ProductionEndpointGuardError('DATABASE_URL is not a syntactically valid URL — refusing (fail closed)');
  }
  if (matchesProductionHostPattern(parsed.hostname)) {
    throw new ProductionEndpointGuardError(
      `DATABASE_URL host "${parsed.hostname}" matches a known production hostname pattern — refusing`,
    );
  }
  if (!isLoopbackHost(parsed.hostname)) {
    throw new ProductionEndpointGuardError(
      `DATABASE_URL host "${parsed.hostname}" is not loopback — the local Docker profile only ever provisions a loopback-bound endpoint`,
    );
  }
  const dbName = parsed.pathname.replace(/^\//, '');
  if (!dbName || !normalizeForIdentityCheck(dbName).includes(normalizeForIdentityCheck(ctx.runId))) {
    throw new ProductionEndpointGuardError(
      `DATABASE_URL database name "${dbName}" does not contain this run's identity ("${ctx.runId}") — refusing`,
    );
  }
}

/** Validates a constructed/candidate MinIO endpoint before any test import. */
export function assertSafeMinioEndpoint(endpoint: string): void {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new ProductionEndpointGuardError('MINIO_ENDPOINT is not a syntactically valid URL — refusing (fail closed)');
  }
  if (parsed.protocol === 'https:') {
    throw new ProductionEndpointGuardError(
      'MINIO_ENDPOINT is HTTPS — not authorized for the local Docker profile (reserved for a future, separately-authorized CI container-network mode)',
    );
  }
  if (matchesProductionHostPattern(parsed.hostname)) {
    throw new ProductionEndpointGuardError(
      `MINIO_ENDPOINT host "${parsed.hostname}" matches a known production hostname pattern — refusing`,
    );
  }
  if (!isLoopbackHost(parsed.hostname)) {
    throw new ProductionEndpointGuardError(`MINIO_ENDPOINT host "${parsed.hostname}" is not loopback — refusing`);
  }
}

/**
 * Rejects any externally-supplied DATABASE_URL/MINIO_ENDPOINT present in the
 * *invoking* environment before this run generates its own. An operator or a
 * parent shell setting these ahead of time is exactly the "conflicts with
 * generated values" case the contract requires failing closed on — this run
 * never merges with, silently prefers, or falls back to an inherited value.
 */
export function assertNoInheritedOverride(env: NodeJS.ProcessEnv): void {
  if (env.DATABASE_URL) {
    throw new ProductionEndpointGuardError(
      'DATABASE_URL is already set in the invoking environment — the disposable-runtime orchestrator refuses to run with an externally-supplied DATABASE_URL (it always constructs and owns its own)',
    );
  }
  if (env.MINIO_ENDPOINT || env.MINIO_ACCESS_KEY || env.MINIO_SECRET_KEY) {
    throw new ProductionEndpointGuardError(
      'MINIO_ENDPOINT/MINIO_ACCESS_KEY/MINIO_SECRET_KEY are already set in the invoking environment — the disposable-runtime orchestrator refuses to run with externally-supplied MinIO configuration',
    );
  }
}
