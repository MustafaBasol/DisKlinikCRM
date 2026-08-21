/**
 * tenantGuardErrors.ts — F3-2.
 *
 * The guard's refusals are typed, not stringly. Two reasons:
 *
 *   1. Tests assert on `code`, so a reworded message never silently turns a
 *      passing isolation test into a vacuous one.
 *   2. A future rollout needs to map refusals onto HTTP responses and alerts
 *      differently: MISSING_TENANT_CONTEXT is an engineering defect in a call
 *      path, CROSS_TENANT_WRITE_REJECTED is a security event.
 *
 * Every code below means "the operation did NOT happen". There is deliberately
 * no code that means "we let it through but logged something".
 */

export type TenantGuardErrorCode =
  /** A tenant-owned model was touched with no execution context established at all. */
  | 'MISSING_TENANT_CONTEXT'
  /** The Prisma model has no entry in the F3-1 classification registry. */
  | 'UNCLASSIFIED_MODEL'
  /** Model is EXPLICIT_REVIEW_REQUIRED / BLOCKED_PENDING_REVIEW and was reached from tenant execution. */
  | 'OWNERSHIP_UNRESOLVED_MODEL'
  /** Model is SYSTEM_INTERNAL and was reached from tenant execution. */
  | 'SYSTEM_ONLY_MODEL'
  /** A write targeted platform-global data from non-system execution. */
  | 'PLATFORM_GLOBAL_WRITE_FORBIDDEN'
  /** A write tried to set an organizationId/clinicId outside the caller's tenant. */
  | 'CROSS_TENANT_WRITE_REJECTED'
  /** A create omitted a required tenant key and the context could not supply exactly one value. */
  | 'AMBIGUOUS_TENANT_TARGET'
  /** A `connect` / `connectOrCreate` / `set` pointed at a row the caller does not own. */
  | 'CROSS_TENANT_RELATION_REJECTED'
  /** A nested write used a shape the guard cannot prove safe. Fail closed by design. */
  | 'UNSUPPORTED_WRITE_SHAPE'
  /** Raw SQL from tenant execution. The guard cannot parse SQL, so it refuses instead of guessing. */
  | 'RAW_SQL_FORBIDDEN_IN_TENANT_CONTEXT'
  /** PARENT_SCOPED metadata is unusable (missing parent, unresolvable relation, cycle). */
  | 'PARENT_OWNERSHIP_UNPROVABLE'
  /** A Prisma operation the guard has no rule for. New operations must be classified, not defaulted. */
  | 'UNSUPPORTED_OPERATION';

export class TenantGuardError extends Error {
  readonly code: TenantGuardErrorCode;
  readonly model: string | undefined;
  readonly operation: string | undefined;

  constructor(
    code: TenantGuardErrorCode,
    message: string,
    context?: { model?: string; operation?: string },
  ) {
    super(message);
    this.name = 'TenantGuardError';
    this.code = code;
    this.model = context?.model;
    this.operation = context?.operation;
  }
}

export function isTenantGuardError(err: unknown): err is TenantGuardError {
  return err instanceof TenantGuardError;
}
