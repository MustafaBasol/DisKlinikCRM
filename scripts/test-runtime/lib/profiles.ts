/** Runtime profile validation and argument construction. */

export const RUNTIME_PROFILES = ['postgres', 'storage', 'verify-parallel', 'cleanup-stale'] as const;
export type RuntimeProfile = (typeof RUNTIME_PROFILES)[number];

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
