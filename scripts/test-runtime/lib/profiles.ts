/** Runtime profile validation and argument construction. */

export const RUNTIME_PROFILES = ['postgres', 'postgres-compat', 'storage', 'verify-parallel', 'cleanup-stale'] as const;
export type RuntimeProfile = (typeof RUNTIME_PROFILES)[number];

/**
 * F1-003-P3-R1: which package script each single-invocation, PostgreSQL-only
 * profile runs. `postgres-compat` is additive — it provisions a disposable
 * PostgreSQL exactly like `postgres` (same guard/migration/cleanup/pinning
 * path in orchestrator.ts), but executes `server:test:legacy-db-required`
 * instead of `server:test:disposable-db`. This closes the full-suite
 * compatibility gap: the 23 scripts legacy `server:test` silently chains
 * that are PostgreSQL-required (MinIO-free) but were not members of any
 * disposable-runtime-safe aggregate before this task — see
 * docs/program/evidence/F1-003-P1_test_execution_contract.json (all 23 have
 * postgresRequired:true, minioRequired:false). Legacy `server:test` itself
 * is not read, invoked, or modified by this mapping.
 */
export function resolvePostgresOnlyTestScript(profile: 'postgres' | 'postgres-compat'): string {
  return profile === 'postgres-compat' ? 'server:test:legacy-db-required' : 'server:test:disposable-db';
}

export function isValidProfile(value: string): value is RuntimeProfile {
  return (RUNTIME_PROFILES as readonly string[]).includes(value);
}

export class InvalidProfileError extends Error {
  constructor(value: string) {
    super(`Unknown runtime profile "${value}" — expected one of: ${RUNTIME_PROFILES.join(', ')}`);
    this.name = 'InvalidProfileError';
  }
}

export function assertValidProfile(value: string | undefined): RuntimeProfile {
  if (!value || !isValidProfile(value)) {
    throw new InvalidProfileError(value ?? '(none)');
  }
  return value;
}

export const INJECTABLE_FAILURE_MODES = ['test', 'migration', 'readiness', 'cleanup', 'parent-generate'] as const;
export type InjectableFailureMode = (typeof INJECTABLE_FAILURE_MODES)[number];

export function isValidInjectFailureMode(value: string): value is InjectableFailureMode {
  return (INJECTABLE_FAILURE_MODES as readonly string[]).includes(value);
}
