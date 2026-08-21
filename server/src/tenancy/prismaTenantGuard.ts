/**
 * prismaTenantGuard.ts — F3-2 Layer 2 enforcement.
 *
 * WHAT THIS IS
 * ------------
 * A Prisma client extension that, for every operation on every model, consults
 * the F3-1 classification registry (`utils/tenantModelClassification.ts`) and
 * the ambient execution context (`tenancy/tenantContext.ts`), then either
 * rewrites the query to be tenant-constrained or refuses it.
 *
 * It is ADR-002 Layer 2. It is ADDITIVE: `utils/clinicScope.ts` and
 * `middleware/clinicAccess.ts` remain the mandatory Layer 1, and nothing here
 * lets a route stop building its own `where`. The guard's job is to make the
 * FORGOTTEN predicate loud instead of silent.
 *
 * IT IS NOT INSTALLED ON THE APPLICATION CLIENT. `server/src/db.ts` is
 * untouched by F3-2 and still exports a plain `PrismaClient`. Installing this
 * extension on the shared client is "Prisma tenant extension rollout", frozen
 * under NORAMEDI_MASTER_TRACKER §8 item 4, and is F5 work gated on the KVKK
 * baseline declaration. What ships here is the mechanism plus the proof that it
 * behaves correctly, so that the rollout decision is made against evidence.
 *
 * WHY AN EXTENSION AND NOT MIDDLEWARE
 * -----------------------------------
 * `prisma.$use()` was removed; this repository is on Prisma 7.9.1, where client
 * extensions (`$extends` with a `query` component) are the supported and only
 * interception point. `query.$allOperations` at the top level receives BOTH
 * model operations (with `model` set) and the four raw operations (with `model`
 * undefined), which is what lets one hook cover the raw-SQL refusal too.
 *
 * THE SIX POLICIES
 * ----------------
 * Derived mechanically from the registry's `guardMode`, never from a guess:
 *
 *   AUTO_FILTER_DUAL_KEY         organizationId AND clinicId constrained; writes must agree with both
 *   AUTO_FILTER_ORGANIZATION_ID  organizationId constrained (or `id`, for Organization itself)
 *   AUTO_FILTER_CLINIC_ID        clinicId constrained against the context's clinic set
 *   PARENT_OWNERSHIP_VALIDATION  constrained through the single declared owning relation
 *   NO_TENANT_FILTER             reads pass; WRITES require system execution
 *   SYSTEM_CONTEXT_ONLY          any operation requires system execution
 *   BLOCKED_PENDING_REVIEW       any operation requires system execution (the 5 unresolved models)
 *
 * and two rules that are not modes at all:
 *
 *   unknown model                always refused, in every context
 *   no execution context         tenant-owned models refused (a missing context is a defect,
 *                                not permission)
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 *   - It does not filter relations reached through `include`/`select` from an
 *     already-constrained root. Those rows are reachable only through foreign
 *     keys from a row the caller owns, so they are transitively bounded by FK
 *     integrity — but "transitively" is weaker than "unconditionally", and
 *     making it unconditional is exactly what F3-3's RLS layer is for.
 *   - It does not parse SQL. Raw statements from tenant execution are refused.
 *   - It does not widen anything. There is no code path in this file that turns
 *     an unconstrained query into an allowed one.
 */

import { Prisma } from '@prisma/client';
import {
  requireTenantClassification,
  type TenantModelEntry,
} from '../utils/tenantModelClassification.js';
import {
  getExecutionContext,
  type TenantExecutionContext,
} from './tenantContext.js';
import { getAuditedRawSqlScope } from './auditedRawSql.js';
import { TenantGuardError } from './tenantGuardErrors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Operation taxonomy. Every Prisma model operation is named here exactly once;
// `assertOperationClassified` proves that against the live client at startup so
// a Prisma upgrade that adds an operation fails loudly instead of defaulting.
// ─────────────────────────────────────────────────────────────────────────────

/** Operations whose only tenant surface is `args.where`. */
const READ_OPERATIONS: ReadonlySet<string> = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

/** Writes that carry a `where` and no `data`. */
const WHERE_ONLY_WRITES: ReadonlySet<string> = new Set(['delete', 'deleteMany']);

/** Writes that carry both a `where` and a `data`. */
const WHERE_AND_DATA_WRITES: ReadonlySet<string> = new Set([
  'update',
  'updateMany',
  'updateManyAndReturn',
]);

/** Writes that carry only `data`. */
const CREATE_WRITES: ReadonlySet<string> = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
]);

const RAW_OPERATIONS: ReadonlySet<string> = new Set([
  '$queryRaw',
  '$queryRawUnsafe',
  '$executeRaw',
  '$executeRawUnsafe',
]);

export const GUARDED_MODEL_OPERATIONS: readonly string[] = Object.freeze([
  ...READ_OPERATIONS,
  ...WHERE_ONLY_WRITES,
  ...WHERE_AND_DATA_WRITES,
  ...CREATE_WRITES,
  'upsert',
]);

/** Nested-write keys the guard knows how to prove safe. Anything else fails closed. */
const KNOWN_NESTED_KEYS: ReadonlySet<string> = new Set([
  'create',
  'createMany',
  'connect',
  'connectOrCreate',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'disconnect',
  'set',
]);

/** Guard against a pathological or cyclic PARENT_SCOPED chain. */
const MAX_OWNERSHIP_DEPTH = 8;

// ─────────────────────────────────────────────────────────────────────────────
// The data port. Everything the guard needs from the database or the schema,
// behind four functions — so the whole enforcement core is unit-testable with
// no PostgreSQL, and the DB-backed suite tests the real implementation.
//
// EVERY implementation of this port MUST run against the UNGUARDED client.
// Resolving a caller's own clinic set through the guard would be circular.
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantGuardPort {
  /** Clinic ids belonging to an organization. Used only for ORGANIZATION_WIDE contexts. */
  listOrganizationClinicIds(organizationId: string): Promise<readonly string[]>;
  /**
   * `findUnique` on `model` with the caller's own unique `where`, selecting only
   * `fields`. Returns null when no row matches. The where is passed through
   * UNMODIFIED so it stays a valid Prisma unique input (including compound
   * keys); ownership is then decided in JavaScript, not by trusting a filter
   * shape to be honoured.
   */
  selectByUnique(
    model: string,
    uniqueWhere: Record<string, unknown>,
    fields: readonly string[],
  ): Promise<Record<string, unknown> | null>;
  /** Target model of a relation field, or undefined when `field` is not a relation on `model`. */
  relationTarget(model: string, field: string): string | undefined;
  /** True when `model` declares a field (scalar or relation) with this name. */
  hasField(model: string, field: string): boolean;
}

type PrismaLikeClient = Record<string, any>;

/**
 * Builds the port from an UNGUARDED Prisma client plus the runtime DMMF.
 *
 * Prisma 7's client-side DMMF is trimmed to `{ name, kind, type, relationName }`
 * per field — enough to map a relation field to its target model, which is all
 * the guard asks of it. To-one vs to-many is decided from the runtime shape of
 * the payload instead of from schema metadata, so nothing here depends on
 * fields Prisma no longer ships.
 */
export function createPrismaTenantGuardPort(baseClient: PrismaLikeClient): TenantGuardPort {
  const relationsByModel = new Map<string, Map<string, string>>();
  const fieldsByModel = new Map<string, Set<string>>();

  for (const model of Prisma.dmmf.datamodel.models) {
    const relations = new Map<string, string>();
    const fields = new Set<string>();
    for (const field of model.fields) {
      fields.add(field.name);
      if (field.kind === 'object') relations.set(field.name, field.type);
    }
    relationsByModel.set(model.name, relations);
    fieldsByModel.set(model.name, fields);
  }

  const delegateFor = (model: string): any => {
    const property = model.charAt(0).toLowerCase() + model.slice(1);
    const delegate = baseClient[property];
    if (!delegate || typeof delegate.findUnique !== 'function') {
      throw new TenantGuardError(
        'PARENT_OWNERSHIP_UNPROVABLE',
        `No Prisma delegate for model "${model}"; ownership cannot be verified.`,
        { model },
      );
    }
    return delegate;
  };

  return {
    async listOrganizationClinicIds(organizationId) {
      const rows = await delegateFor('Clinic').findMany({
        where: { organizationId },
        select: { id: true },
      });
      return rows.map((row: { id: string }) => row.id);
    },
    async selectByUnique(model, uniqueWhere, fields) {
      const select: Record<string, boolean> = {};
      for (const field of fields) select[field] = true;
      return delegateFor(model).findUnique({ where: uniqueWhere, select });
    },
    relationTarget(model, field) {
      return relationsByModel.get(model)?.get(field);
    },
    hasField(model, field) {
      return fieldsByModel.get(model)?.has(field) === true;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Clinic-set resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Memoized per context OBJECT (not per organization) so that a long-lived
 * process cannot serve one request a clinic set another request populated. The
 * context is frozen and request-scoped, so the WeakMap entry dies with it.
 */
const organizationClinicIdCache = new WeakMap<TenantExecutionContext, Promise<readonly string[]>>();

async function resolveContextClinicIds(
  ctx: TenantExecutionContext,
  port: TenantGuardPort,
): Promise<readonly string[]> {
  if (ctx.clinicScope.kind === 'EXPLICIT') return ctx.clinicScope.clinicIds;
  const cached = organizationClinicIdCache.get(ctx);
  if (cached) return cached;
  const pending = port.listOrganizationClinicIds(ctx.organizationId);
  organizationClinicIdCache.set(ctx, pending);
  return pending;
}

// ─────────────────────────────────────────────────────────────────────────────
// Predicate construction
// ─────────────────────────────────────────────────────────────────────────────

function classify(model: string): TenantModelEntry {
  try {
    return requireTenantClassification(model);
  } catch (err) {
    throw new TenantGuardError(
      'UNCLASSIFIED_MODEL',
      err instanceof Error ? err.message : `Prisma model "${model}" has no tenant classification.`,
      { model },
    );
  }
}

/**
 * `AND`-merges a predicate into an existing `where`, PRESERVING the original
 * top-level keys.
 *
 * The spread is load-bearing, not stylistic: `findUnique`/`update`/`delete`
 * require at least one unique constraint at the TOP level of `where`. Replacing
 * the where with `{ AND: [original, predicate] }` would bury the unique key one
 * level down and Prisma would reject the call.
 */
export function mergeWhere(
  existing: Record<string, unknown> | undefined,
  predicate: Record<string, unknown>,
): Record<string, unknown> {
  if (existing === undefined || existing === null) return { ...predicate };
  const priorAnd = existing.AND === undefined ? [] : Array.isArray(existing.AND) ? existing.AND : [existing.AND];
  return { ...existing, AND: [...priorAnd, predicate] };
}

/** The read/filter predicate for a tenant-owned model under a tenant context. */
async function buildTenantPredicate(
  model: string,
  ctx: TenantExecutionContext,
  port: TenantGuardPort,
  depth = 0,
): Promise<Record<string, unknown>> {
  if (depth > MAX_OWNERSHIP_DEPTH) {
    throw new TenantGuardError(
      'PARENT_OWNERSHIP_UNPROVABLE',
      `Ownership chain for "${model}" exceeded ${MAX_OWNERSHIP_DEPTH} hops; refusing rather than ` +
        'walking an unbounded relation graph.',
      { model },
    );
  }

  const entry = classify(model);

  switch (entry.guardMode) {
    case 'AUTO_FILTER_DUAL_KEY': {
      if (!entry.organizationIdField || !entry.clinicIdField) {
        throw new TenantGuardError(
          'PARENT_OWNERSHIP_UNPROVABLE',
          `Registry declares AUTO_FILTER_DUAL_KEY for "${model}" without both ownership fields.`,
          { model },
        );
      }
      return {
        [entry.organizationIdField]: ctx.organizationId,
        [entry.clinicIdField]: { in: [...(await resolveContextClinicIds(ctx, port))] },
      };
    }
    case 'AUTO_FILTER_ORGANIZATION_ID': {
      // `Organization` itself is the one model whose organization identity IS
      // its primary key; the registry records that with a null field name.
      const field = entry.organizationIdField ?? 'id';
      return { [field]: ctx.organizationId };
    }
    case 'AUTO_FILTER_CLINIC_ID': {
      if (!entry.clinicIdField) {
        throw new TenantGuardError(
          'PARENT_OWNERSHIP_UNPROVABLE',
          `Registry declares AUTO_FILTER_CLINIC_ID for "${model}" without a clinic field.`,
          { model },
        );
      }
      return { [entry.clinicIdField]: { in: [...(await resolveContextClinicIds(ctx, port))] } };
    }
    case 'PARENT_OWNERSHIP_VALIDATION': {
      if (!entry.parent) {
        throw new TenantGuardError(
          'PARENT_OWNERSHIP_UNPROVABLE',
          `Registry declares PARENT_OWNERSHIP_VALIDATION for "${model}" without a parent path.`,
          { model },
        );
      }
      return {
        [entry.parent.relationField]: await buildTenantPredicate(
          entry.parent.model,
          ctx,
          port,
          depth + 1,
        ),
      };
    }
    default:
      throw new TenantGuardError(
        'PARENT_OWNERSHIP_UNPROVABLE',
        `buildTenantPredicate called for "${model}" with guard mode ${entry.guardMode}.`,
        { model },
      );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Access policy — the single place that answers "may this happen at all?"
// ─────────────────────────────────────────────────────────────────────────────

type AccessDecision =
  | { kind: 'PASS_THROUGH' }
  | { kind: 'CONSTRAIN'; ctx: TenantExecutionContext };

function decideAccess(model: string, operation: string, isWrite: boolean): AccessDecision {
  const entry = classify(model);
  const ctx = getExecutionContext();

  // System execution is the declared exception. It is deliberately total: a job
  // that sweeps every clinic cannot be expressed with a tenant predicate, and a
  // half-constrained sweep is worse than an explicit, greppable exemption.
  if (ctx?.mode === 'SYSTEM') return { kind: 'PASS_THROUGH' };

  switch (entry.guardMode) {
    case 'SYSTEM_CONTEXT_ONLY':
      throw new TenantGuardError(
        'SYSTEM_ONLY_MODEL',
        `"${model}" is SYSTEM_INTERNAL (${entry.classification}); ${operation} requires ` +
          'runAsSystem({ reason }). Tenant execution must not reach operational/system tables.',
        { model, operation },
      );
    case 'BLOCKED_PENDING_REVIEW':
      throw new TenantGuardError(
        'OWNERSHIP_UNRESOLVED_MODEL',
        `"${model}" is EXPLICIT_REVIEW_REQUIRED: its tenant ownership is undecided (F3-1), so no ` +
          `tenant predicate is known to be correct. ${operation} must run under ` +
          'runAsSystem({ reason }) — see the F3-2 decision for the five review-required models.',
        { model, operation },
      );
    case 'NO_TENANT_FILTER':
      if (isWrite) {
        throw new TenantGuardError(
          'PLATFORM_GLOBAL_WRITE_FORBIDDEN',
          `"${model}" is PLATFORM_GLOBAL; ${operation} would mutate platform-wide data from ` +
            'tenant execution. Platform data is written under runAsSystem({ reason }).',
          { model, operation },
        );
      }
      // Reading platform-global data is what "platform-global" means, and it is
      // allowed even with no context at all (catalogues, plans, seeds).
      return { kind: 'PASS_THROUGH' };
    default:
      break;
  }

  if (!ctx) {
    throw new TenantGuardError(
      'MISSING_TENANT_CONTEXT',
      `${operation} on tenant-owned model "${model}" ran with no execution context. A missing ` +
        'context is a defect in the call path, never permission: wrap the request in ' +
        'runAsTenant(...) or declare tenant-independent work with runAsSystem({ reason }).',
      { model, operation },
    );
  }

  return { kind: 'CONSTRAIN', ctx };
}

// ─────────────────────────────────────────────────────────────────────────────
// Write payload enforcement
// ─────────────────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * Reads the effective scalar a write is trying to set. Prisma accepts both the
 * bare value and `{ set: value }`; anything else (`{ increment }`, a nested
 * object) is not a shape the guard can prove, so it says so.
 */
function readScalarWrite(
  raw: unknown,
  model: string,
  field: string,
): { present: false } | { present: true; value: unknown } {
  if (raw === undefined) return { present: false };
  if (isPlainObject(raw)) {
    const keys = Object.keys(raw);
    if (keys.length === 1 && keys[0] === 'set') return { present: true, value: raw.set };
    throw new TenantGuardError(
      'UNSUPPORTED_WRITE_SHAPE',
      `Write to ownership field "${model}.${field}" uses an operator the guard cannot evaluate ` +
        `(${keys.join(', ')}). Ownership fields accept only a literal or { set: literal }.`,
      { model },
    );
  }
  return { present: true, value: raw };
}

/**
 * Reads the id an ownership relation is being connected to.
 *
 * The ONLY shape accepted is `{ connect: { id } }`. Everything else — creating
 * a clinic inline from a patient write, `connectOrCreate`, `disconnect` — is
 * refused rather than interpreted, because an ownership relation is not a place
 * to be clever: the whole tenant boundary of the row being written hangs on
 * this single value.
 */
function readOwnershipConnectId(model: string, relationField: string, payload: unknown): string {
  const reject = (detail: string): never => {
    throw new TenantGuardError(
      'UNSUPPORTED_WRITE_SHAPE',
      `Ownership relation "${model}.${relationField}" ${detail}. Only { connect: { id } } is ` +
        'accepted — it decides which tenant the row belongs to.',
      { model },
    );
  };
  if (!isPlainObject(payload)) return reject('is not an object');
  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== 'connect') return reject(`uses ${keys.join(', ') || '(nothing)'}`);
  const connect = payload.connect;
  if (!isPlainObject(connect) || typeof connect.id !== 'string') return reject('connects by something other than a string id');
  return connect.id;
}

/** `clinicId` -> `clinic`, `organizationId` -> `organization`, verified against the schema. */
function relationFieldForScalar(
  model: string,
  scalarField: string,
  expectedTarget: string,
  port: TenantGuardPort,
): string | undefined {
  if (!scalarField.endsWith('Id')) return undefined;
  const candidate = scalarField.slice(0, -2);
  return port.relationTarget(model, candidate) === expectedTarget ? candidate : undefined;
}

interface WriteGuardContext {
  readonly ctx: TenantExecutionContext;
  readonly port: TenantGuardPort;
  /** Lazily resolved and memoized: an organization-scoped write must not pay a clinic lookup. */
  readonly clinicIds: () => Promise<readonly string[]>;
}

/**
 * Proves that the row a unique `where` points at belongs to the caller.
 *
 * Deliberately does NOT rely on Prisma honouring extra filters inside a nested
 * unique input: it fetches the row's own ownership columns with the caller's
 * unmodified `where` and compares them here. A null row is treated exactly like
 * a foreign row — "not yours" and "not there" are the same answer to give.
 */
async function assertUniqueTargetOwned(
  model: string,
  uniqueWhere: Record<string, unknown>,
  guard: WriteGuardContext,
  depth = 0,
): Promise<void> {
  if (depth > MAX_OWNERSHIP_DEPTH) {
    throw new TenantGuardError(
      'PARENT_OWNERSHIP_UNPROVABLE',
      `Ownership chain for "${model}" exceeded ${MAX_OWNERSHIP_DEPTH} hops.`,
      { model },
    );
  }

  const entry = classify(model);
  const reject = (): never => {
    throw new TenantGuardError(
      'CROSS_TENANT_RELATION_REJECTED',
      `Refusing to link "${model}": the target row is not owned by organization ` +
        `${guard.ctx.organizationId} (or does not exist).`,
      { model },
    );
  };

  switch (entry.guardMode) {
    case 'NO_TENANT_FILTER':
      // Linking to platform-global data (a Plan, a MedicalCondition) is normal.
      return;
    case 'SYSTEM_CONTEXT_ONLY':
      throw new TenantGuardError(
        'SYSTEM_ONLY_MODEL',
        `Refusing to link "${model}" from tenant execution: it is SYSTEM_INTERNAL.`,
        { model },
      );
    case 'BLOCKED_PENDING_REVIEW':
      throw new TenantGuardError(
        'OWNERSHIP_UNRESOLVED_MODEL',
        `Refusing to link "${model}" from tenant execution: its ownership is unresolved (F3-1).`,
        { model },
      );
    case 'AUTO_FILTER_DUAL_KEY': {
      const fields = [entry.organizationIdField!, entry.clinicIdField!];
      const row = await guard.port.selectByUnique(model, uniqueWhere, fields);
      if (!row) return reject();
      if (row[entry.organizationIdField!] !== guard.ctx.organizationId) return reject();
      if (!(await guard.clinicIds()).includes(row[entry.clinicIdField!] as string)) return reject();
      return;
    }
    case 'AUTO_FILTER_ORGANIZATION_ID': {
      const field = entry.organizationIdField ?? 'id';
      const row = await guard.port.selectByUnique(model, uniqueWhere, [field]);
      if (!row) return reject();
      if (row[field] !== guard.ctx.organizationId) return reject();
      return;
    }
    case 'AUTO_FILTER_CLINIC_ID': {
      const field = entry.clinicIdField!;
      const row = await guard.port.selectByUnique(model, uniqueWhere, [field]);
      if (!row) return reject();
      if (!(await guard.clinicIds()).includes(row[field] as string)) return reject();
      return;
    }
    case 'PARENT_OWNERSHIP_VALIDATION': {
      const parent = entry.parent;
      if (!parent) {
        throw new TenantGuardError(
          'PARENT_OWNERSHIP_UNPROVABLE',
          `"${model}" is PARENT_SCOPED with no parent path in the registry.`,
          { model },
        );
      }
      if (!guard.port.hasField(parent.model, 'id')) {
        throw new TenantGuardError(
          'PARENT_OWNERSHIP_UNPROVABLE',
          `Parent model "${parent.model}" has no \`id\` field to resolve ownership through.`,
          { model },
        );
      }
      const row = await guard.port.selectByUnique(model, uniqueWhere, [parent.foreignKeyField]);
      if (!row) return reject();
      const parentId = row[parent.foreignKeyField];
      if (typeof parentId !== 'string') return reject();
      return assertUniqueTargetOwned(parent.model, { id: parentId }, guard, depth + 1);
    }
    default:
      throw new TenantGuardError(
        'PARENT_OWNERSHIP_UNPROVABLE',
        `Cannot prove ownership of "${model}" (guard mode ${entry.guardMode}).`,
        { model },
      );
  }
}

/**
 * Validates — and for creates, fills in — the ownership fields of one write
 * payload, then recurses into nested relation payloads.
 *
 * Returns a NEW object; the caller's args are never mutated, because Prisma
 * reuses argument objects across retries and a mutated arg is a debugging
 * nightmare that shows up months later as "sometimes the clinicId is wrong".
 */
async function guardWritePayload(
  model: string,
  payload: unknown,
  kind: 'CREATE' | 'UPDATE',
  guard: WriteGuardContext,
  depth = 0,
): Promise<unknown> {
  if (Array.isArray(payload)) {
    const out = [];
    for (const item of payload) out.push(await guardWritePayload(model, item, kind, guard, depth));
    return out;
  }
  if (!isPlainObject(payload)) return payload;
  if (depth > MAX_OWNERSHIP_DEPTH) {
    throw new TenantGuardError(
      'UNSUPPORTED_WRITE_SHAPE',
      `Nested write on "${model}" exceeded ${MAX_OWNERSHIP_DEPTH} levels; refusing.`,
      { model },
    );
  }

  const entry = classify(model);

  switch (entry.guardMode) {
    case 'NO_TENANT_FILTER':
      throw new TenantGuardError(
        'PLATFORM_GLOBAL_WRITE_FORBIDDEN',
        `Refusing to write platform-global model "${model}" from tenant execution.`,
        { model },
      );
    case 'SYSTEM_CONTEXT_ONLY':
      throw new TenantGuardError('SYSTEM_ONLY_MODEL', `Refusing to write SYSTEM_INTERNAL model "${model}" from tenant execution.`, { model });
    case 'BLOCKED_PENDING_REVIEW':
      throw new TenantGuardError('OWNERSHIP_UNRESOLVED_MODEL', `Refusing to write "${model}" from tenant execution: ownership unresolved (F3-1).`, { model });
    default:
      break;
  }

  const result: Record<string, unknown> = { ...payload };

  /**
   * Relation fields that back an OWNERSHIP column (`clinic` for `clinicId`,
   * `organization` for `organizationId`) and have therefore already been
   * checked against the caller's tenant, more strictly than the generic
   * nested-relation walk would. Recorded so that walk does not re-check them
   * with the weaker rule and, worse, read as the authoritative check.
   */
  const ownershipRelationFields = new Set<string>();

  // Which ownership columns this model's guard mode is actually responsible
  // for. Derived from `guardMode`, NOT from "does the column exist" — the two
  // differ, and the difference matters. `AuditLog` carries a NULLABLE clinicId
  // while being classified organization-scoped: injecting a clinic id into an
  // organization-level audit row on create would be wrong, but ACCEPTING a
  // clinic id belonging to another tenant would be worse, so it is validated
  // when supplied and never invented.
  const injectOrganization =
    entry.guardMode === 'AUTO_FILTER_DUAL_KEY' || entry.guardMode === 'AUTO_FILTER_ORGANIZATION_ID';
  const injectClinic =
    entry.guardMode === 'AUTO_FILTER_DUAL_KEY' || entry.guardMode === 'AUTO_FILTER_CLINIC_ID';

  /**
   * Prisma inputs are either "checked" (relation fields, no foreign-key
   * scalars) or "unchecked" (FK scalars, no relation fields) — a payload may
   * not mix the two, and one that does is rejected outright.
   *
   * So the guard must fill in a missing ownership field in the SAME style the
   * caller used. Injecting `organizationId` into a payload that wrote
   * `clinic: { connect: … }` produces a `PrismaClientValidationError` and turns
   * a legitimate write into a hard failure — which is exactly what the
   * database-backed test caught before this branch existed.
   */
  const organizationRelationField = entry.organizationIdField
    ? relationFieldForScalar(model, entry.organizationIdField, 'Organization', guard.port)
    : undefined;
  const clinicRelationField = entry.clinicIdField
    ? relationFieldForScalar(model, entry.clinicIdField, 'Clinic', guard.port)
    : undefined;
  const callerUsedRelationForm =
    (organizationRelationField !== undefined && result[organizationRelationField] !== undefined) ||
    (clinicRelationField !== undefined && result[clinicRelationField] !== undefined);

  // ── organization ownership ────────────────────────────────────────────────
  if (entry.organizationIdField) {
    const field = entry.organizationIdField;
    const written = readScalarWrite(result[field], model, field);
    if (written.present) {
      const isExplicitNull = written.value === null && entry.organizationIdNullable;
      if (!isExplicitNull && written.value !== guard.ctx.organizationId) {
        throw new TenantGuardError(
          'CROSS_TENANT_WRITE_REJECTED',
          `Refusing ${kind === 'CREATE' ? 'create' : 'update'} on "${model}": it sets ` +
            `${field} to a value outside organization ${guard.ctx.organizationId}.`,
          { model },
        );
      }
    } else {
      const relationField = organizationRelationField;
      const relationPayload = relationField ? result[relationField] : undefined;
      if (relationPayload !== undefined) {
        ownershipRelationFields.add(relationField!);
        const connectedId = readOwnershipConnectId(model, relationField!, relationPayload);
        if (connectedId !== guard.ctx.organizationId) {
          throw new TenantGuardError(
            'CROSS_TENANT_WRITE_REJECTED',
            `Refusing ${kind === 'CREATE' ? 'create' : 'update'} on "${model}": it connects ` +
              `${relationField} to an organization outside ${guard.ctx.organizationId}.`,
            { model },
          );
        }
      } else if (kind === 'CREATE' && injectOrganization) {
        if (callerUsedRelationForm && relationField) {
          result[relationField] = { connect: { id: guard.ctx.organizationId } };
        } else {
          result[field] = guard.ctx.organizationId;
        }
      }
    }
  } else if (entry.classification === 'ORGANIZATION_SCOPED_DIRECT') {
    // The tenant root itself (`Organization`): identity is the primary key.
    if (kind === 'CREATE') {
      throw new TenantGuardError(
        'CROSS_TENANT_WRITE_REJECTED',
        `Refusing to create "${model}" from tenant execution: a new tenant root belongs to no ` +
          'existing tenant by definition, so provisioning it is a platform operation.',
        { model },
      );
    }
    const written = readScalarWrite(result.id, model, 'id');
    if (written.present && written.value !== guard.ctx.organizationId) {
      throw new TenantGuardError(
        'CROSS_TENANT_WRITE_REJECTED',
        `Refusing update on "${model}": it rewrites the tenant root identity.`,
        { model },
      );
    }
  }

  // ── clinic ownership ──────────────────────────────────────────────────────
  if (entry.clinicIdField) {
    const field = entry.clinicIdField;
    const written = readScalarWrite(result[field], model, field);
    if (written.present) {
      const isExplicitNull = written.value === null && entry.clinicIdNullable;
      if (!isExplicitNull && (typeof written.value !== 'string' || !(await guard.clinicIds()).includes(written.value))) {
        throw new TenantGuardError(
          'CROSS_TENANT_WRITE_REJECTED',
          `Refusing ${kind === 'CREATE' ? 'create' : 'update'} on "${model}": ${field} is not one ` +
            'of the clinics this execution context may write to. (This is also the check that ' +
            "stops organization A's id being paired with organization B's clinic.)",
          { model },
        );
      }
    } else {
      const relationField = clinicRelationField;
      const relationPayload = relationField ? result[relationField] : undefined;
      if (relationPayload !== undefined) {
        // THE RELATION FORM OF THE SAME WRITE. `{ clinic: { connect: { id } } }`
        // sets clinicId just as surely as `{ clinicId }` does, and it must face
        // the same check. Leaving it to the generic nested-relation walk below
        // is NOT good enough: `Clinic` is organization-scoped, so that walk
        // would only prove the target clinic belongs to the caller's
        // ORGANIZATION — letting a clinic-1-restricted context create a row in
        // sibling clinic 2. Found by re-reading this file, not by a failing
        // test, which is why there is now a test for it in both suites.
        ownershipRelationFields.add(relationField!);
        const connectedId = readOwnershipConnectId(model, relationField!, relationPayload);
        if (!(await guard.clinicIds()).includes(connectedId)) {
          throw new TenantGuardError(
            'CROSS_TENANT_WRITE_REJECTED',
            `Refusing ${kind === 'CREATE' ? 'create' : 'update'} on "${model}": it connects ` +
              `${relationField} to a clinic this execution context may not write to.`,
            { model },
          );
        }
      } else if (kind === 'CREATE' && injectClinic) {
        const writableClinicIds = await guard.clinicIds();
        if (writableClinicIds.length !== 1) {
          throw new TenantGuardError(
            'AMBIGUOUS_TENANT_TARGET',
            `Refusing create on "${model}": no ${field} was supplied and the execution context ` +
              `covers ${writableClinicIds.length} clinics, so the guard cannot choose one. Pass an ` +
              'explicit clinic id — guessing here is how rows land in the wrong branch.',
            { model },
          );
        }
        if (callerUsedRelationForm && relationField) {
          result[relationField] = { connect: { id: writableClinicIds[0] } };
        } else {
          result[field] = writableClinicIds[0];
        }
      }
    }
  }

  // ── parent ownership (PARENT_SCOPED) ──────────────────────────────────────
  if (entry.guardMode === 'PARENT_OWNERSHIP_VALIDATION' && entry.parent) {
    const { foreignKeyField, model: parentModel, relationField } = entry.parent;
    const written = readScalarWrite(result[foreignKeyField], model, foreignKeyField);
    if (written.present) {
      if (typeof written.value !== 'string') {
        throw new TenantGuardError(
          'PARENT_OWNERSHIP_UNPROVABLE',
          `"${model}.${foreignKeyField}" must be a string id to prove parent ownership.`,
          { model },
        );
      }
      await assertUniqueTargetOwned(parentModel, { id: written.value }, guard, depth + 1);
    } else if (kind === 'CREATE' && result[relationField] === undefined) {
      throw new TenantGuardError(
        'PARENT_OWNERSHIP_UNPROVABLE',
        `Refusing create on PARENT_SCOPED model "${model}": neither ${foreignKeyField} nor ` +
          `${relationField} was supplied, so there is no owner to validate against.`,
        { model },
      );
    }
  }

  // ── nested relation payloads ──────────────────────────────────────────────
  for (const [key, value] of Object.entries(payload)) {
    if (ownershipRelationFields.has(key)) continue;
    const target = guard.port.relationTarget(model, key);
    if (!target) continue;
    result[key] = await guardNestedRelation(model, key, target, value, guard, depth + 1);
  }

  return result;
}

/**
 * Enforces one nested relation payload (`{ create }`, `{ connect }`, …).
 *
 * The default branch is a refusal. That is the whole design: Prisma's nested
 * write grammar is large and grows, and a guard that silently ignores a key it
 * does not recognise is a guard that a future Prisma release quietly disables.
 */
async function guardNestedRelation(
  parentModel: string,
  relationField: string,
  targetModel: string,
  value: unknown,
  guard: WriteGuardContext,
  depth: number,
): Promise<unknown> {
  if (!isPlainObject(value)) {
    // `relation: null` / a scalar is not a nested write instruction.
    return value;
  }

  const targetEntry = classify(targetModel);
  const out: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value)) {
    if (!KNOWN_NESTED_KEYS.has(key)) {
      throw new TenantGuardError(
        'UNSUPPORTED_WRITE_SHAPE',
        `Nested write "${parentModel}.${relationField}.${key}" is a shape this guard has no rule ` +
          'for, so it refuses rather than passing it through unchecked. Add an explicit rule in ' +
          'prismaTenantGuard.ts if this shape is legitimate.',
        { model: parentModel },
      );
    }

    // Linking to platform-global data is fine; writing it from tenant execution is not.
    if (targetEntry.guardMode === 'NO_TENANT_FILTER') {
      if (key === 'connect' || key === 'disconnect' || key === 'set') {
        out[key] = nested;
        continue;
      }
      throw new TenantGuardError(
        'PLATFORM_GLOBAL_WRITE_FORBIDDEN',
        `Nested "${key}" on platform-global model "${targetModel}" from tenant execution.`,
        { model: targetModel },
      );
    }

    switch (key) {
      case 'create':
        out[key] = await guardWritePayload(targetModel, nested, 'CREATE', guard, depth);
        break;
      case 'createMany': {
        if (!isPlainObject(nested)) {
          throw new TenantGuardError('UNSUPPORTED_WRITE_SHAPE', `Nested createMany on "${targetModel}" is not an object.`, { model: targetModel });
        }
        out[key] = { ...nested, data: await guardWritePayload(targetModel, nested.data, 'CREATE', guard, depth) };
        break;
      }
      case 'connect':
      case 'disconnect':
      case 'set':
      case 'delete': {
        // `delete: true` / `disconnect: true` on a to-one relation is reached
        // only through a row the top-level where already constrained, so the
        // ownership question was answered one level up.
        if (nested === true) {
          out[key] = nested;
          break;
        }
        const targets = Array.isArray(nested) ? nested : [nested];
        for (const target of targets) {
          if (!isPlainObject(target)) {
            throw new TenantGuardError('UNSUPPORTED_WRITE_SHAPE', `Nested "${key}" on "${targetModel}" must be an object or array of objects.`, { model: targetModel });
          }
          await assertUniqueTargetOwned(targetModel, target, guard, depth);
        }
        out[key] = nested;
        break;
      }
      case 'connectOrCreate': {
        const entries = Array.isArray(nested) ? nested : [nested];
        const guarded = [];
        for (const item of entries) {
          if (!isPlainObject(item) || !isPlainObject(item.where)) {
            throw new TenantGuardError('UNSUPPORTED_WRITE_SHAPE', `Nested connectOrCreate on "${targetModel}" must carry a where.`, { model: targetModel });
          }
          // The `where` may match a row in ANOTHER tenant; if it does, Prisma
          // would connect it. Proving ownership before the call is what stops
          // that — and a miss is indistinguishable from "create it", which is
          // exactly the branch the guarded `create` below covers.
          const existing = await resolveConnectOrCreateOwnership(targetModel, item.where, guard, depth);
          if (existing === 'FOREIGN') {
            throw new TenantGuardError(
              'CROSS_TENANT_RELATION_REJECTED',
              `Refusing connectOrCreate on "${targetModel}": the where matches a row owned by ` +
                'another tenant.',
              { model: targetModel },
            );
          }
          guarded.push({ ...item, create: await guardWritePayload(targetModel, item.create, 'CREATE', guard, depth) });
        }
        out[key] = Array.isArray(nested) ? guarded : guarded[0];
        break;
      }
      case 'update':
      case 'updateMany':
      case 'upsert': {
        const entries = Array.isArray(nested) ? nested : [nested];
        const guarded = [];
        for (const item of entries) {
          if (!isPlainObject(item)) {
            throw new TenantGuardError('UNSUPPORTED_WRITE_SHAPE', `Nested "${key}" on "${targetModel}" must be an object.`, { model: targetModel });
          }
          guarded.push(await guardNestedUpdateLike(key, targetModel, item, guard, depth));
        }
        out[key] = Array.isArray(nested) ? guarded : guarded[0];
        break;
      }
      case 'deleteMany': {
        const entries = Array.isArray(nested) ? nested : [nested];
        const predicate = await buildTenantPredicate(targetModel, guard.ctx, guard.port);
        const guarded = entries.map((item) => mergeWhere(isPlainObject(item) ? item : undefined, predicate));
        out[key] = Array.isArray(nested) ? guarded : guarded[0];
        break;
      }
      default:
        throw new TenantGuardError('UNSUPPORTED_WRITE_SHAPE', `Unhandled nested key "${key}".`, { model: targetModel });
    }
  }

  return out;
}

/** `FOREIGN` when the where matches a row belonging to someone else. */
async function resolveConnectOrCreateOwnership(
  model: string,
  where: Record<string, unknown>,
  guard: WriteGuardContext,
  depth: number,
): Promise<'OWNED_OR_ABSENT' | 'FOREIGN'> {
  try {
    await assertUniqueTargetOwned(model, where, guard, depth);
    return 'OWNED_OR_ABSENT';
  } catch (err) {
    if (err instanceof TenantGuardError && err.code === 'CROSS_TENANT_RELATION_REJECTED') {
      // `assertUniqueTargetOwned` cannot distinguish "foreign" from "absent",
      // and for connectOrCreate that distinction matters: absent is the create
      // branch. Re-fetch with no ownership columns to tell them apart.
      const probe = await guard.port.selectByUnique(model, where, ['id']);
      return probe === null ? 'OWNED_OR_ABSENT' : 'FOREIGN';
    }
    throw err;
  }
}

async function guardNestedUpdateLike(
  key: 'update' | 'updateMany' | 'upsert',
  targetModel: string,
  item: Record<string, unknown>,
  guard: WriteGuardContext,
  depth: number,
): Promise<Record<string, unknown>> {
  const predicate = await buildTenantPredicate(targetModel, guard.ctx, guard.port);

  if (key === 'upsert') {
    return {
      ...item,
      ...(isPlainObject(item.where) ? { where: mergeWhere(item.where, predicate) } : {}),
      create: await guardWritePayload(targetModel, item.create, 'CREATE', guard, depth),
      update: await guardWritePayload(targetModel, item.update, 'UPDATE', guard, depth),
    };
  }

  if (key === 'updateMany') {
    return {
      ...item,
      where: mergeWhere(isPlainObject(item.where) ? item.where : undefined, predicate),
      data: await guardWritePayload(targetModel, item.data, 'UPDATE', guard, depth),
    };
  }

  // `update`: to-many form is `{ where, data }`; to-one form is either
  // `{ data }` or the bare field object.
  if ('data' in item) {
    return {
      ...item,
      ...(isPlainObject(item.where) ? { where: mergeWhere(item.where, predicate) } : {}),
      data: await guardWritePayload(targetModel, item.data, 'UPDATE', guard, depth),
    };
  }
  return (await guardWritePayload(targetModel, item, 'UPDATE', guard, depth)) as Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// The enforcement core. Pure with respect to Prisma: it takes args, returns
// args (or throws), and is what the unit suite drives directly.
// ─────────────────────────────────────────────────────────────────────────────

export interface GuardOperationInput {
  /** Undefined for the four raw operations. */
  readonly model: string | undefined;
  readonly operation: string;
  readonly args: unknown;
  readonly port: TenantGuardPort;
}

export async function guardOperationArgs(input: GuardOperationInput): Promise<unknown> {
  const { model, operation, args, port } = input;

  // ── raw SQL ───────────────────────────────────────────────────────────────
  if (model === undefined) {
    if (!RAW_OPERATIONS.has(operation)) {
      throw new TenantGuardError(
        'UNSUPPORTED_OPERATION',
        `Client-level operation "${operation}" has no guard rule. New operations must be ` +
          'classified in prismaTenantGuard.ts, not defaulted to allowed.',
        { operation },
      );
    }
    const ctx = getExecutionContext();
    if (ctx?.mode === 'SYSTEM') return args;
    if (getAuditedRawSqlScope()) return args;
    throw new TenantGuardError(
      'RAW_SQL_FORBIDDEN_IN_TENANT_CONTEXT',
      `${operation} is refused outside system execution. The guard cannot read SQL, so it cannot ` +
        'prove a tenant predicate is present. Run it under runAsSystem({ reason }) if it is ' +
        'tenant-independent, or inside runWithAuditedRawSql({ registryKey, justification }) after ' +
        'recording it in tenancy/rawSqlAuditRegistry.ts.',
      { operation },
    );
  }

  const isCreate = CREATE_WRITES.has(operation);
  const isWhereOnlyWrite = WHERE_ONLY_WRITES.has(operation);
  const isWhereAndDataWrite = WHERE_AND_DATA_WRITES.has(operation);
  const isUpsert = operation === 'upsert';
  const isRead = READ_OPERATIONS.has(operation);

  if (!isCreate && !isWhereOnlyWrite && !isWhereAndDataWrite && !isUpsert && !isRead) {
    throw new TenantGuardError(
      'UNSUPPORTED_OPERATION',
      `Prisma operation "${operation}" on "${model}" has no guard rule. A newly-added operation ` +
        'must be classified in prismaTenantGuard.ts, not silently allowed.',
      { model, operation },
    );
  }

  const decision = decideAccess(model, operation, !isRead);
  if (decision.kind === 'PASS_THROUGH') return args;

  const { ctx } = decision;
  const guard: WriteGuardContext = {
    ctx,
    port,
    clinicIds: () => resolveContextClinicIds(ctx, port),
  };
  const predicate = await buildTenantPredicate(model, ctx, port);
  const source = isPlainObject(args) ? args : {};

  if (isRead || isWhereOnlyWrite) {
    return { ...source, where: mergeWhere(source.where as Record<string, unknown> | undefined, predicate) };
  }

  if (isCreate) {
    return { ...source, data: await guardWritePayload(model, source.data, 'CREATE', guard) };
  }

  if (isWhereAndDataWrite) {
    return {
      ...source,
      where: mergeWhere(source.where as Record<string, unknown> | undefined, predicate),
      data: await guardWritePayload(model, source.data, 'UPDATE', guard),
    };
  }

  // upsert
  return {
    ...source,
    where: mergeWhere(source.where as Record<string, unknown> | undefined, predicate),
    create: await guardWritePayload(model, source.create, 'CREATE', guard),
    update: await guardWritePayload(model, source.update, 'UPDATE', guard),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The extension itself
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the tenant-guard client extension.
 *
 * NOT applied anywhere in the running application — see this file's header.
 * Callers construct a guarded client explicitly:
 *
 *   const guarded = createTenantGuardedClient(prisma);
 */
export function createTenantGuardExtension(port: TenantGuardPort) {
  return Prisma.defineExtension({
    name: 'noramedi-tenant-guard',
    query: {
      $allOperations: async ({ model, operation, args, query }: {
        model?: string;
        operation: string;
        args: unknown;
        query: (args: unknown) => Promise<unknown>;
      }) => {
        const guarded = await guardOperationArgs({ model, operation, args, port });
        return query(guarded);
      },
    },
  });
}

/**
 * Wraps an unguarded client. The port is built from the SAME client, on purpose:
 * ownership lookups must not re-enter the guard.
 */
export function createTenantGuardedClient<T extends PrismaLikeClient>(baseClient: T) {
  const port = createPrismaTenantGuardPort(baseClient);
  return (baseClient as any).$extends(createTenantGuardExtension(port));
}

/**
 * Startup-time proof that the operation taxonomy above still covers everything
 * the generated client can do. A Prisma upgrade that introduces an operation
 * should break a test, not widen the guard's default.
 */
export function unclassifiedModelOperations(operations: readonly string[]): readonly string[] {
  const known = new Set(GUARDED_MODEL_OPERATIONS);
  return operations.filter((op) => !known.has(op));
}
