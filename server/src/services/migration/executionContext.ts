/**
 * executionContext.ts — F3-DATA-MIG-TODAY-001
 *
 * HISTORICAL SIDE-EFFECT SUPPRESSION.
 *
 * The problem, stated concretely. NoraMedi schedules post-treatment messages
 * relative to `Date.now()`, not to the clinical record's own date
 * (services/postTreatmentMessaging.ts). A cron then sends them for real. So a
 * historical import that ran through an ordinary application creation path
 * would schedule live WhatsApp messages to thousands of patients about
 * treatments finished years ago. That is the single sharpest hazard in this
 * whole programme, and it is not hypothetical — the scheduling line is in
 * production today.
 *
 * Today's in-scope migration writes PATIENT MASTER DATA only, and patient
 * creation currently has exactly one side effect (an activity log). So the
 * suppression below is not load-bearing for today's dataset. It is built now
 * anyway, for two reasons:
 *
 *   1. The migration engine is explicitly designed to be extended to
 *      appointment/treatment/procedure datasets once the vendor exports arrive,
 *      and those paths DO fire outbound messaging. A suppression mechanism
 *      retrofitted after the first historical clinical import is a suppression
 *      mechanism added after the incident.
 *   2. It makes the guarantee testable NOW: a regression test can prove that
 *      migration execution suppresses outbound sends and that ordinary,
 *      non-migration workflows are completely unaffected.
 *
 * DESIGN CONSTRAINTS this satisfies:
 *   - Suppression is SCOPED to migration execution. Production messaging is
 *     never globally disabled. Outside `runWithMigrationSuppression`, every
 *     guard is a no-op and behaviour is byte-identical to before this file
 *     existed.
 *   - It is ambient (AsyncLocalStorage), not a parameter threaded through
 *     twenty call sites. Threading a flag would mean editing every function
 *     between the executor and the sender, inside a frozen-boundary codebase,
 *     and would silently fail wherever someone forgot to pass it.
 *   - It survives `await`. AsyncLocalStorage propagates across the async
 *     boundaries a batch executor is made of; a module-level boolean would not,
 *     and would leak across concurrently-executing runs.
 *   - Suppressions are COUNTED, not swallowed. A suppressed send increments a
 *     counter that lands in the run's reconciliation, so "we suppressed 0
 *     messages" is an observation rather than an assumption.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** The outbound effects a migration must never trigger. */
export type SuppressibleEffect =
  | 'whatsapp_send'
  | 'meta_whatsapp_send'
  | 'instagram_send'
  | 'sms_send'
  | 'email_send'
  | 'post_treatment_enqueue'
  | 'notification_create'
  | 'workflow_trigger';

export const SUPPRESSIBLE_EFFECTS: readonly SuppressibleEffect[] = [
  'whatsapp_send',
  'meta_whatsapp_send',
  'instagram_send',
  'sms_send',
  'email_send',
  'post_treatment_enqueue',
  'notification_create',
  'workflow_trigger',
];

export interface MigrationExecutionContext {
  migrationRunId: string;
  organizationId: string;
  clinicId: string;
  /** effect -> how many times it was suppressed during this run. */
  suppressed: Map<SuppressibleEffect, number>;
}

const storage = new AsyncLocalStorage<MigrationExecutionContext>();

/**
 * Run `fn` inside a migration execution context. Every suppression guard
 * anywhere in the call tree — including across `await` — will see it.
 */
export function runWithMigrationSuppression<T>(
  ctx: Omit<MigrationExecutionContext, 'suppressed'>,
  fn: () => Promise<T>,
): Promise<T> {
  const full: MigrationExecutionContext = { ...ctx, suppressed: new Map() };
  return storage.run(full, fn);
}

/** The active context, or undefined outside migration execution. */
export function getMigrationExecutionContext(): MigrationExecutionContext | undefined {
  return storage.getStore();
}

/**
 * True only while migration execution is running on this async call chain.
 *
 * OUTSIDE a migration this is `false` and every guard falls through, so
 * ordinary clinic workflows are untouched. That property is what the
 * regression tests assert.
 */
export function isMigrationExecutionActive(): boolean {
  return storage.getStore() !== undefined;
}

/**
 * THE GUARD. Call this at an outbound-effect entry point:
 *
 *   if (shouldSuppressDuringMigration('whatsapp_send')) return;
 *
 * Returns true (and counts the suppression) only during migration execution.
 * It deliberately takes no patient argument — a guard that needed patient
 * context would tempt callers to log it.
 */
export function shouldSuppressDuringMigration(effect: SuppressibleEffect): boolean {
  const ctx = storage.getStore();
  if (!ctx) return false;
  ctx.suppressed.set(effect, (ctx.suppressed.get(effect) ?? 0) + 1);
  return true;
}

/** Snapshot of the suppression counters, for the run's reconciliation. */
export function getSuppressionCounts(): Record<string, number> {
  const ctx = storage.getStore();
  if (!ctx) return {};
  return Object.fromEntries(ctx.suppressed);
}

/**
 * Escape hatch for the migration's OWN bookkeeping.
 *
 * The executor still needs to write its audit rows and its activity log while
 * inside the suppression context. Those are records of what the migration did,
 * not outbound effects on patients, so they run through here — explicitly and
 * visibly — rather than by making the guard cleverer about what counts as a
 * side effect.
 */
export function runOutsideMigrationSuppression<T>(fn: () => Promise<T>): Promise<T> {
  return storage.exit(fn);
}
