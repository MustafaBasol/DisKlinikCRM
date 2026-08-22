/**
 * auditedRawSql.ts — F3-2.
 *
 * A Prisma client extension can intercept `$queryRaw`/`$executeRaw`, but it
 * cannot READ the SQL and decide whether the tenant predicate is present.
 * Parsing SQL to prove a `WHERE` clause is safe is exactly the kind of clever
 * check that is wrong once and then wrong forever, so the guard does not try:
 * from tenant execution, raw SQL is refused.
 *
 * That refusal needs a deliberate escape, because NoraMedi has raw-SQL paths
 * that ARE tenant-safe today and are raw for good reasons (`FOR UPDATE` row
 * locks, `pg_advisory_xact_lock`, period-bucketed revenue aggregation). This
 * module is that escape, and its whole value is that it is impossible to use
 * accidentally:
 *
 *   - it takes a `justification` describing HOW the tenant predicate is
 *     enforced at that call site;
 *   - it takes the `registryKey` of the statement's entry in
 *     `rawSqlAuditRegistry.ts`, so an audited path cannot exist without a
 *     reviewed, CI-enforced registry row;
 *   - it is greppable: one symbol, one import, listed in the architecture
 *     guardrail's domain map.
 *
 * It grants NOTHING except permission to run raw SQL. It does not widen a
 * tenant context, does not confer system execution, and does not suppress any
 * other guard rule.
 *
 * STATUS: the API and its enforcement are complete and tested, but the existing
 * raw-SQL call sites are NOT yet routed through it — see the F3-2 evidence
 * document, §"Raw SQL". Wrapping the call sites is rollout work (frozen:
 * NORAMEDI_MASTER_TRACKER §8 item 4); the CI-enforced registry in
 * `rawSqlAuditRegistry.ts` is what stops NEW raw-SQL paths appearing
 * unclassified in the meantime.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { RawSqlRegistryKey } from './rawSqlAuditRegistry.js';

export interface AuditedRawSqlScope {
  readonly registryKey: RawSqlRegistryKey;
  readonly justification: string;
}

const storage = new AsyncLocalStorage<AuditedRawSqlScope>();

/**
 * Run `fn` with permission to execute raw SQL through the guarded client.
 *
 * The scope is intentionally as narrow as the call: it ends when `fn` settles,
 * and it does not propagate to work merely started inside `fn` and awaited
 * elsewhere.
 */
export function runWithAuditedRawSql<T>(scope: AuditedRawSqlScope, fn: () => Promise<T>): Promise<T> {
  if (!scope.justification || scope.justification.trim().length === 0) {
    throw new Error(
      'runWithAuditedRawSql requires a justification describing how the tenant predicate is ' +
        'enforced in this statement. An unjustified escape hatch is not an escape hatch, it is a hole.',
    );
  }
  return storage.run(Object.freeze({ ...scope }), fn);
}

/** The active audited-raw-SQL scope, or undefined. Read by the guard only. */
export function getAuditedRawSqlScope(): AuditedRawSqlScope | undefined {
  return storage.getStore();
}
