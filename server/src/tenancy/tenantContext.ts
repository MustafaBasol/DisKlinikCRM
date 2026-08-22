/**
 * tenantContext.ts — F3-2 tenant execution context.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * NoraMedi's tenant isolation is, today, entirely a property of hand-written
 * `where` clauses (utils/clinicScope.ts, middleware/clinicAccess.ts and ~90
 * route files). That is ADR-002 Layer 1, it is mandatory, and F3-2 does not
 * replace it. But Layer 1 has one structural weakness that no amount of review
 * removes: a query that simply FORGETS the predicate is indistinguishable, at
 * the call site, from a query that does not need one. The failure is silent and
 * its blast radius is another clinic's patient data.
 *
 * Layer 2 needs to know, at the moment a query executes, which tenant the
 * current unit of work belongs to — WITHOUT threading a parameter through every
 * function between an Express handler and Prisma. That is what this module is:
 * an `AsyncLocalStorage`-backed ambient execution context, in the same shape and
 * for the same reason as the already-merged
 * `services/migration/executionContext.ts`.
 *
 * WHAT IT IS NOT
 * --------------
 * Nothing here filters a query. This module carries identity;
 * `prismaTenantGuard.ts` is the thing that enforces. Establishing a context is
 * behaviourally inert on its own — that separation is deliberate, because it
 * lets the request-boundary integration ship and be proven independently of any
 * Prisma-extension rollout, which remains frozen (NORAMEDI_MASTER_TRACKER §8
 * item 4).
 *
 * THE TWO MODES, AND WHY SYSTEM IS NARROW
 * ---------------------------------------
 * `TENANT` — a unit of work that belongs to exactly one organization and a
 * known, finite set of clinics. Derived from server-side authentication state,
 * never from a client-supplied header or body field.
 *
 * `SYSTEM` — a unit of work that legitimately has no single tenant: a cron
 * sweep across all clinics, a webhook envelope persisted before its connection
 * is resolved, a `SELECT 1` health probe. System execution is the single most
 * dangerous concept in this file, because "just run it as system" is how a
 * defence-in-depth layer becomes decorative. Three properties keep it honest:
 *
 *   1. The reason is a value from a CLOSED union (`SystemContextReason`), not a
 *      free-text string and not a boolean. Adding a new kind of system work is a
 *      reviewable diff to this file, not an inline `{ skipTenantCheck: true }`.
 *   2. `runAsSystem` REFUSES to escalate out of an active tenant context unless
 *      the reason appears in `SYSTEM_REASONS_PERMITTED_INSIDE_TENANT_REQUEST` —
 *      a three-entry allowlist. An ordinary request path therefore cannot reach
 *      system privilege by accident, only by editing this file.
 *   3. Every call site is greppable by reason: `runAsSystem({ reason: '...' })`.
 *
 * NESTING RULES
 * -------------
 *   TENANT inside nothing      -> allowed
 *   TENANT inside SYSTEM       -> allowed (a job narrowing to one clinic)
 *   TENANT inside same-org TENANT -> allowed (narrowing the clinic set)
 *   TENANT inside other-org TENANT -> THROWS. Re-entering a different tenant on
 *      the same async chain is never a legitimate shape in this codebase, and
 *      allowing it would make the context worthless as evidence.
 *   SYSTEM inside TENANT       -> only for allowlisted reasons (see above)
 *   SYSTEM inside SYSTEM       -> allowed
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Why a unit of work runs without a single tenant owner. CLOSED SET — every
 * member must correspond to real code in this repository, and adding one is a
 * deliberate review event. Ordered by where it happens.
 */
export type SystemContextReason =
  /** A cron/background job tick, running across all tenants under a JobLock lease. */
  | 'background-job'
  /** Recording a SecuritySignalEvent. Fires from inside tenant requests by design (KVKK-CRIT-003 Rule 2). */
  | 'security-signal-recording'
  /** SecurityIncident/SecurityIncidentActivity lifecycle: create, escalate, acknowledge, resolve. */
  | 'security-incident-lifecycle'
  /** Persisting a raw inbound webhook envelope BEFORE its tenant connection is resolved. */
  | 'inbound-webhook-envelope'
  /** Platform-admin operations that are, by the accepted authorization model, not tenant execution. */
  | 'platform-administration'
  /** `SELECT 1`-class liveness/readiness probes. */
  | 'database-health-check'
  /** Clinic data migration execution (see services/migration/executionContext.ts). */
  | 'clinic-data-migration';

export const SYSTEM_CONTEXT_REASONS: readonly SystemContextReason[] = Object.freeze([
  'background-job',
  'security-signal-recording',
  'security-incident-lifecycle',
  'inbound-webhook-envelope',
  'platform-administration',
  'database-health-check',
  'clinic-data-migration',
] as const);

/**
 * The ONLY reasons that may escalate to system execution while a tenant context
 * is already active on the same async chain.
 *
 * Each one is a case where the work provably originates inside an ordinary
 * authenticated request and provably has no single tenant owner:
 *   - `security-signal-recording` / `security-incident-lifecycle`: a cross-tenant
 *     access denial is detected DURING the denied tenant request; the signal row
 *     is deliberately not owned by the organization that triggered it.
 *   - `database-health-check`: a probe route may sit behind `authenticate`.
 *
 * `inbound-webhook-envelope`, `background-job`, `platform-administration` and
 * `clinic-data-migration` are NOT here: if one of them is ever reached from
 * inside a tenant request, that is a routing defect and should throw.
 */
export const SYSTEM_REASONS_PERMITTED_INSIDE_TENANT_REQUEST: ReadonlySet<SystemContextReason> =
  Object.freeze(
    new Set<SystemContextReason>([
      'security-signal-recording',
      'security-incident-lifecycle',
      'database-health-check',
    ]),
  ) as ReadonlySet<SystemContextReason>;

/**
 * Which clinics the current tenant unit of work may touch.
 *
 * `EXPLICIT` carries a finite, already-authorized list — the guard turns it
 * straight into `clinicId IN (...)`, with no relation traversal and no second
 * source of truth. An EMPTY list is legal and means "no clinic access": it
 * yields a predicate that matches nothing, which is the correct fail-closed
 * reading of `allowedClinicIds = []` (clinicScope.ts Rule 4).
 *
 * `ORGANIZATION_WIDE` is the OWNER/ORG_ADMIN case (`canAccessAllClinics`). The
 * clinic set is not enumerated here because enumerating it costs a query that
 * most requests never need; the guard resolves and memoizes it on first use,
 * through the UNGUARDED client, only when a clinic-only model is actually
 * touched.
 */
export type TenantClinicScope =
  | { readonly kind: 'EXPLICIT'; readonly clinicIds: readonly string[] }
  | { readonly kind: 'ORGANIZATION_WIDE' };

/** Who is acting. Identity only — authorization stays where it already is. */
export interface ExecutionActor {
  readonly kind: 'USER' | 'PLATFORM_ADMIN' | 'SERVICE';
  /** User id / platform-admin id, or null for unattributed system work. */
  readonly id: string | null;
  /** JWT `jti`, when the caller already has one. Never invented here. */
  readonly sessionId?: string;
}

export interface TenantExecutionContext {
  readonly mode: 'TENANT';
  readonly organizationId: string;
  readonly clinicScope: TenantClinicScope;
  readonly actor: ExecutionActor;
  /** Existing request/correlation id when one is already available; never generated here. */
  readonly correlationId?: string;
}

export interface SystemExecutionContext {
  readonly mode: 'SYSTEM';
  readonly reason: SystemContextReason;
  /** Narrowing detail for auditability — e.g. the JobLock name. Never PII. */
  readonly detail?: string;
  readonly actor: ExecutionActor;
  readonly correlationId?: string;
}

export type ExecutionContext = TenantExecutionContext | SystemExecutionContext;

/** Default actor for system work nobody in particular initiated (a cron tick). */
const UNATTRIBUTED_SERVICE_ACTOR: ExecutionActor = Object.freeze({ kind: 'SERVICE', id: null });

/** Error codes this module raises. Kept as a union so tests assert on codes, not message text. */
export type TenantContextErrorCode =
  | 'TENANT_CONTEXT_INVALID'
  | 'TENANT_CONTEXT_CROSS_ORGANIZATION_REENTRY'
  | 'TENANT_CONTEXT_MISSING'
  | 'SYSTEM_CONTEXT_REASON_UNKNOWN'
  | 'SYSTEM_ESCALATION_FORBIDDEN';

export class TenantContextError extends Error {
  readonly code: TenantContextErrorCode;

  constructor(code: TenantContextErrorCode, message: string) {
    super(message);
    this.name = 'TenantContextError';
    this.code = code;
  }
}

const storage = new AsyncLocalStorage<ExecutionContext>();

/**
 * Runs `fn` inside `context` — and, crucially, SUBSCRIBES to whatever `fn`
 * returns while the store is still active.
 *
 * The extra `async` wrapper is not ceremony. A `PrismaPromise` is LAZY: it does
 * nothing until something calls `.then` on it. So
 *
 *     storage.run(ctx, () => prisma.patient.findMany())     // WRONG
 *
 * builds the promise inside the context, returns it, exits the context, and
 * only then does the caller's `await` subscribe — by which point the store is
 * gone and the guard sees no context at all. This was not a hypothetical: the
 * F3-2 benchmark script hit exactly this and died with MISSING_TENANT_CONTEXT
 * on its first guarded query, which is how it was found.
 *
 * `async () => fn()` makes the async function itself await the returned
 * thenable, so the `.then` subscription happens on this async chain, inside the
 * store. `tests/tenantContext.test.ts` pins the behaviour with a lazy thenable
 * that records which store was active when it was subscribed to — a plain
 * eager Promise cannot detect the difference and would let the regression back
 * in unnoticed.
 */
function runInContext<T>(context: ExecutionContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, async () => fn());
}

/** The active context, or undefined outside any established context. */
export function getExecutionContext(): ExecutionContext | undefined {
  return storage.getStore();
}

/** The active TENANT context, or undefined (also undefined under SYSTEM execution). */
export function getTenantContext(): TenantExecutionContext | undefined {
  const ctx = storage.getStore();
  return ctx?.mode === 'TENANT' ? ctx : undefined;
}

/** The active SYSTEM context, or undefined. */
export function getSystemContext(): SystemExecutionContext | undefined {
  const ctx = storage.getStore();
  return ctx?.mode === 'SYSTEM' ? ctx : undefined;
}

export function isSystemContext(): boolean {
  return storage.getStore()?.mode === 'SYSTEM';
}

/**
 * Fail-closed accessor. Use this wherever a tenant identity is REQUIRED; the
 * throw is the point. `getTenantContext()` is for code that legitimately has to
 * behave differently with and without a context.
 */
export function requireTenantContext(): TenantExecutionContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new TenantContextError(
      'TENANT_CONTEXT_MISSING',
      'No execution context is active. Tenant-scoped work must run inside runAsTenant(); ' +
        'legitimate tenant-independent work must declare itself with runAsSystem({ reason }).',
    );
  }
  if (ctx.mode !== 'TENANT') {
    throw new TenantContextError(
      'TENANT_CONTEXT_MISSING',
      `A tenant context is required, but SYSTEM execution is active (reason: ${ctx.reason}). ` +
        'System work must not borrow tenant semantics.',
    );
  }
  return ctx;
}

function assertValidTenantContext(ctx: TenantExecutionContext): void {
  if (typeof ctx.organizationId !== 'string' || ctx.organizationId.length === 0) {
    throw new TenantContextError(
      'TENANT_CONTEXT_INVALID',
      'runAsTenant requires a non-empty organizationId.',
    );
  }
  if (ctx.clinicScope.kind === 'EXPLICIT') {
    for (const id of ctx.clinicScope.clinicIds) {
      if (typeof id !== 'string' || id.length === 0) {
        throw new TenantContextError(
          'TENANT_CONTEXT_INVALID',
          'runAsTenant received an empty clinic id in an EXPLICIT clinic scope. ' +
            'An empty list is allowed (no clinic access); an empty STRING is a defect.',
        );
      }
    }
  }
}

/**
 * Run `fn` as `organizationId`, with the given clinic scope.
 *
 * The context is frozen so that nothing downstream can widen its own privilege
 * by mutating the store it was handed.
 */
export function runAsTenant<T>(
  context: Omit<TenantExecutionContext, 'mode'>,
  fn: () => Promise<T>,
): Promise<T> {
  const full: TenantExecutionContext = Object.freeze({ mode: 'TENANT' as const, ...context });
  assertValidTenantContext(full);

  const current = storage.getStore();
  if (current?.mode === 'TENANT' && current.organizationId !== full.organizationId) {
    throw new TenantContextError(
      'TENANT_CONTEXT_CROSS_ORGANIZATION_REENTRY',
      `Refusing to enter organization ${full.organizationId} while organization ` +
        `${current.organizationId} is already active on this async chain. Nested execution as a ` +
        'different tenant is never a legitimate shape here; if a background operation needs it, ' +
        'run it under runAsSystem() and enter each tenant from there.',
    );
  }

  return runInContext(full, fn);
}

/**
 * Run `fn` as tenant-independent system work.
 *
 * `reason` is the contract. It is validated against the closed union at runtime
 * (not only at compile time) because a JS caller, a JSON-driven job registry or
 * a `as any` cast would otherwise be able to invent one.
 */
export function runAsSystem<T>(
  context: { reason: SystemContextReason; detail?: string; actor?: ExecutionActor; correlationId?: string },
  fn: () => Promise<T>,
): Promise<T> {
  if (!SYSTEM_CONTEXT_REASONS.includes(context.reason)) {
    throw new TenantContextError(
      'SYSTEM_CONTEXT_REASON_UNKNOWN',
      `Unknown system context reason "${String(context.reason)}". Add it to SYSTEM_CONTEXT_REASONS ` +
        'in tenancy/tenantContext.ts — deliberately, and in a reviewable diff.',
    );
  }

  const current = storage.getStore();
  if (current?.mode === 'TENANT' && !SYSTEM_REASONS_PERMITTED_INSIDE_TENANT_REQUEST.has(context.reason)) {
    throw new TenantContextError(
      'SYSTEM_ESCALATION_FORBIDDEN',
      `Refusing to escalate to system execution (reason: ${context.reason}) from inside an active ` +
        `tenant context (organization ${current.organizationId}). Only ` +
        `[${[...SYSTEM_REASONS_PERMITTED_INSIDE_TENANT_REQUEST].join(', ')}] may do so. If this is a ` +
        'legitimate new case, add it to SYSTEM_REASONS_PERMITTED_INSIDE_TENANT_REQUEST and justify it.',
    );
  }

  const full: SystemExecutionContext = Object.freeze({
    mode: 'SYSTEM' as const,
    reason: context.reason,
    detail: context.detail,
    actor: context.actor ?? UNATTRIBUTED_SERVICE_ACTOR,
    correlationId: context.correlationId,
  });

  return runInContext(full, fn);
}

/**
 * A short, non-PII description of the active context, for error messages and
 * audit lines. Never includes actor ids, clinic ids or correlation ids — this
 * string ends up in logs.
 */
export function describeExecutionContext(): string {
  const ctx = storage.getStore();
  if (!ctx) return 'no-context';
  if (ctx.mode === 'SYSTEM') return `system:${ctx.reason}`;
  return `tenant:${ctx.clinicScope.kind === 'EXPLICIT' ? `${ctx.clinicScope.clinicIds.length}-clinic` : 'organization-wide'}`;
}
