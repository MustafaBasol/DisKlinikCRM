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

/**
 * True for an IPv4 address inside RFC 1918 private space — the only ranges a
 * Docker user-defined bridge network hands out. Deliberately narrow: this is
 * a shape check layered UNDER the identity check below, never a substitute
 * for it.
 */
export function isPrivateIpv4Address(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host.trim());
  if (!match) return false;
  const octets = match.slice(1).map((o) => Number.parseInt(o, 10));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false;
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export interface MinioEndpointGuardOptions {
  /**
   * F4-CI-L4-STORAGE-GATE-001 (Lane C): the container addresses Docker itself
   * reported for THIS run's own MinIO container on THIS run's own network.
   * A non-loopback endpoint is accepted only when its host is an exact member
   * of this list AND is RFC 1918 private space — i.e. the orchestrator is
   * allowed to address a container it just created and can name, and nothing
   * else. This is the same identity-check shape `assertSafeDatabaseUrl`
   * already uses for the run-id-bearing database name; it is NOT a general
   * relaxation of "must be loopback".
   */
  allowedContainerAddresses?: readonly string[];
}

/** Validates a constructed/candidate MinIO endpoint before any test import. */
export function assertSafeMinioEndpoint(endpoint: string, opts: MinioEndpointGuardOptions = {}): void {
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
  if (isLoopbackHost(parsed.hostname)) return;

  const allowed = opts.allowedContainerAddresses ?? [];
  if (allowed.includes(parsed.hostname) && isPrivateIpv4Address(parsed.hostname)) return;

  throw new ProductionEndpointGuardError(
    `MINIO_ENDPOINT host "${parsed.hostname}" is neither loopback nor an RFC1918 address Docker reported for this run's own MinIO container — refusing`,
  );
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
