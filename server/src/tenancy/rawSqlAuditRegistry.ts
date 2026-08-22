/**
 * rawSqlAuditRegistry.ts — F3-2 raw-SQL tenant audit.
 *
 * THE PROBLEM
 * -----------
 * `prismaTenantGuard.ts` rewrites Prisma's structured query arguments. It
 * cannot do anything with `prisma.$queryRaw\`SELECT ... FROM "Patient"\``: the
 * SQL is opaque to it, and a guard that tried to parse SQL to decide whether a
 * tenant predicate was present would be a guard that is confidently wrong.
 *
 * So raw SQL is the one hole a Prisma-level guard structurally cannot close.
 * F0-009 said the same thing about RLS from the other side: RLS closes raw SQL
 * but not FK-target inserts. Until F3-3's RLS layer exists, the only honest
 * control over raw SQL is a reviewed inventory that CI refuses to let drift.
 *
 * WHAT THIS IS
 * ------------
 * The same shape as F3-1's model registry, applied to raw SQL: an executable,
 * per-file record of every raw-SQL call site in `server/src` (tests excluded),
 * how many there are, and what makes each safe. `tests/rawSqlTenantAudit.test.ts`
 * re-scans the source tree on every CI run and fails if:
 *
 *   - a file contains raw SQL and has no entry here (a NEW unclassified path);
 *   - a listed file's call-site count no longer matches (a path was ADDED to,
 *     or removed from, an already-reviewed file);
 *   - an entry names a file that no longer contains raw SQL (stale).
 *
 * A developer adding raw SQL therefore cannot avoid stating which of the
 * classifications below it is, and why — the build stops until they do.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It changes no runtime behaviour and rewrites no query. It does not make an
 * unsafe statement safe; `UNSAFE_BLOCKER` exists precisely so that "we know and
 * it is not fixed" is representable. There are currently zero of those.
 */

/** How a raw-SQL call site is kept from crossing a tenant boundary. */
export type RawSqlTenantClassification =
  /**
   * The statement's own WHERE carries an explicit organization/clinic predicate
   * derived from the Layer-1 scope helpers (`clinicScopeSql`, a validated
   * `clinicId`, a validated `organizationId`). Tenant safety is a property of
   * the statement text, reviewable by reading it.
   */
  | 'TENANT_SAFE_EXPLICIT_PREDICATE'
  /**
   * The statement touches NO tenant rows: `SELECT 1` liveness probes and
   * `pg_advisory_xact_lock` / `pg_try_advisory_xact_lock` calls, which return a
   * lock, not data. There is no tenant boundary to cross.
   */
  | 'NO_ROW_ACCESS'
  /**
   * Runs only outside tenant execution — a background job, a platform-admin
   * route, a public pre-tenant-resolution endpoint, or migration execution.
   * Under the guard these must run inside `runAsSystem({ reason })`.
   */
  | 'SYSTEM_ONLY'
  /**
   * Tenant-path raw SQL whose predicate is correct today but which must be
   * routed through `runWithAuditedRawSql()` before the guard can be enabled.
   * Rollout work, not a live defect.
   */
  | 'NEEDS_TENANT_CONTEXT_HELPER'
  /** Migration/admin tooling only; never reachable from an application request. */
  | 'MIGRATION_OR_ADMIN_ONLY'
  /** Known-unsafe: reachable from tenant execution without a provable predicate. */
  | 'UNSAFE_BLOCKER';

export interface RawSqlCallSiteGroup {
  readonly classification: RawSqlTenantClassification;
  readonly count: number;
  readonly justification: string;
}

export interface RawSqlAuditEntry {
  /** Repository-relative, forward-slashed path. */
  readonly file: string;
  readonly sites: readonly RawSqlCallSiteGroup[];
}

/**
 * Stable keys for `runWithAuditedRawSql({ registryKey })`. One per file that
 * holds tenant-path raw SQL, so the escape hatch cannot be used for a statement
 * nobody reviewed.
 */
export type RawSqlRegistryKey =
  | 'outbox/outboxDispatcher'
  | 'outbox/outboxRetention'
  | 'routes/imaging'
  | 'routes/inventory'
  | 'routes/reports'
  | 'services/communicationConsentAuditReport'
  | 'services/patientAnonymization'
  | 'services/revenueByPeriodQuery';

export const RAW_SQL_REGISTRY_KEYS: readonly RawSqlRegistryKey[] = Object.freeze([
  'outbox/outboxDispatcher',
  'outbox/outboxRetention',
  'routes/imaging',
  'routes/inventory',
  'routes/reports',
  'services/communicationConsentAuditReport',
  'services/patientAnonymization',
  'services/revenueByPeriodQuery',
] as const);

/**
 * THE REGISTRY. Alphabetical by file, which is also the order the scanner
 * produces, so a reviewer can diff the two side by side.
 */
export const RAW_SQL_AUDIT_REGISTRY: readonly RawSqlAuditEntry[] = Object.freeze([
  {
    file: 'server/src/index.ts',
    sites: [
      {
        classification: 'NO_ROW_ACCESS',
        count: 2,
        justification:
          'Two `SELECT 1` probes: the /health liveness check and the readiness checkDatabase ' +
          'callback. They read no table and therefore cross no tenant boundary. Under the guard ' +
          'they belong in runAsSystem({ reason: "database-health-check" }).',
      },
    ],
  },
  {
    file: 'server/src/outbox/outboxDispatcher.ts',
    sites: [
      {
        classification: 'SYSTEM_ONLY',
        count: 1,
        justification:
          'The F5-2 outbox claim: an `UPDATE "OutboxEvent" ... WHERE id IN (SELECT ... FOR UPDATE ' +
          'SKIP LOCKED LIMIT n) RETURNING ...`. Raw because Prisma has neither SKIP LOCKED nor a ' +
          'LIMIT on updateMany, and both are what make multi-replica claiming safe (F5-1P E16b). ' +
          'It carries NO tenant predicate BY DESIGN — a dispatcher that could see only one ' +
          'organization could not drain the queue — and it is reachable only from ' +
          'outboxDispatcherJob.ts under runAsSystem({ reason: "background-job" }). Tenant context ' +
          'is established per row, from the row\'s own server-written organizationId/clinicId, ' +
          'before any consumer runs. Executed inside runWithAuditedRawSql({ registryKey: ' +
          '"outbox/outboxDispatcher" }).',
      },
    ],
  },
  {
    file: 'server/src/outbox/outboxRetention.ts',
    sites: [
      {
        classification: 'SYSTEM_ONLY',
        count: 2,
        justification:
          'The two F5-2R guarded retention deletes: `DELETE FROM "OutboxEvent" ... NOT EXISTS ' +
          '(ambiguous execution) AND NOT EXISTS (in-flight replay child)` and `DELETE FROM ' +
          '"OutboxConsumerExecution" ... NOT EXISTS (event that can still act)`. Raw because Prisma ' +
          'cannot express a correlated NOT EXISTS: these tables meet on a business idempotencyKey ' +
          'and on a self-referential causationId, neither of which is a declared relation, and ' +
          'evaluating the protection from a loaded JS array instead of in the database is the exact ' +
          'select/delete race these statements exist to close. Both carry NO tenant predicate BY ' +
          'DESIGN — a retention sweep that could see one organization could not clean the table, and ' +
          'an idempotency key is pinned by an event in ANY organization holding it. Reachable only ' +
          'from jobs/dataRetentionCleanupJob.ts under the shared job lock (whose callback runs as ' +
          'system) and from the platform-admin manual-run route; neither is tenant execution. Each ' +
          'returns an affected-row count and no rows, so no payload or business key ever leaves the ' +
          'database. All values, including the candidate id array, are parameterized. Executed ' +
          'inside runWithAuditedRawSql({ registryKey: "outbox/outboxRetention" }).',
      },
    ],
  },
  {
    file: 'server/src/routes/imaging.ts',
    sites: [
      {
        classification: 'TENANT_SAFE_EXPLICIT_PREDICATE',
        count: 2,
        justification:
          'Two `SELECT ... FOR UPDATE` row locks (ImagingDevice, ImagingBridgeAgent) whose WHERE ' +
          'interpolates `clinicFilter`, built in this file from validateAndGetClinicIdScope and ' +
          'collapsing to `1 = 0` when the scope is empty. Raw because Prisma has no FOR UPDATE.',
      },
    ],
  },
  {
    file: 'server/src/routes/imagingBridgePublic.ts',
    sites: [
      {
        classification: 'SYSTEM_ONLY',
        count: 1,
        justification:
          'Pairing-code redemption on an unauthenticated public bridge route. No tenant context ' +
          'exists at this point by construction — the hashed pairing code IS the credential that ' +
          'RESOLVES the tenant, so a tenant predicate would be circular.',
      },
    ],
  },
  {
    file: 'server/src/routes/inventory.ts',
    sites: [
      {
        classification: 'TENANT_SAFE_EXPLICIT_PREDICATE',
        count: 2,
        justification:
          'Two `SELECT id FROM "InventoryItem" WHERE id = $1 AND "clinicId" = $2 FOR UPDATE` row ' +
          'locks. The clinicId is the route-resolved effective clinic, not a client value.',
      },
    ],
  },
  {
    file: 'server/src/routes/operationalMonitoring.ts',
    sites: [
      {
        classification: 'NO_ROW_ACCESS',
        count: 1,
        justification: '`SELECT 1` database-reachability probe. Reads no table.',
      },
    ],
  },
  {
    file: 'server/src/routes/platformAdmin.ts',
    sites: [
      {
        classification: 'NO_ROW_ACCESS',
        count: 4,
        justification:
          'One `SELECT 1` probe plus three `pg_advisory_xact_lock(hashtext(<setting key>))` calls ' +
          'that serialize platform-setting mutations. Advisory locks return a lock, not rows. The ' +
          'surrounding route is platform-admin, i.e. not tenant execution at all.',
      },
    ],
  },
  {
    file: 'server/src/routes/reports.ts',
    sites: [
      {
        classification: 'TENANT_SAFE_EXPLICIT_PREDICATE',
        count: 3,
        justification:
          'Three Appointment aggregations (monthly trend, day-of-week, hour-of-day) whose WHERE ' +
          'begins with `${scopeSql}` from clinicScopeSql(validateAndGetClinicIdScope(...)). Raw ' +
          'because they are DATE_TRUNC/EXTRACT group-bys Prisma groupBy cannot express.',
      },
    ],
  },
  {
    file: 'server/src/services/appointmentRequestSafety.ts',
    sites: [
      {
        classification: 'NO_ROW_ACCESS',
        count: 2,
        justification:
          'Two `pg_advisory_xact_lock(int4, int4)` calls serializing slot booking. No table access.',
      },
    ],
  },
  {
    file: 'server/src/services/communicationConsent/communicationConsentAdmin.ts',
    sites: [
      {
        classification: 'NO_ROW_ACCESS',
        count: 1,
        justification: 'One `pg_advisory_xact_lock(int4, int4)` call. No table access.',
      },
    ],
  },
  {
    file: 'server/src/services/communicationConsent/communicationConsentAuditReport.ts',
    sites: [
      {
        classification: 'TENANT_SAFE_EXPLICIT_PREDICATE',
        count: 3,
        justification:
          'Three OperationalEvent breakdowns, each with `AND "organizationId" = $n` plus an ' +
          'optional `AND "clinicId" = $m`. OperationalEvent is ORGANIZATION_SCOPED_DIRECT in the ' +
          'F3-1 registry, so the organization predicate is the complete tenant predicate. Raw ' +
          'because they group on JSONB metadata expressions.',
      },
    ],
  },
  {
    file: 'server/src/services/migration/executor.ts',
    sites: [
      {
        classification: 'SYSTEM_ONLY',
        count: 1,
        justification:
          'Counts MigrationRowOutcome rows with a non-empty JSONB warnings array for one runId. ' +
          'MigrationRowOutcome is PARENT_SCOPED through MigrationRun and the predicate IS the ' +
          'parent key; execution runs under the clinic-data-migration system context.',
      },
    ],
  },
  {
    file: 'server/src/services/patientEmergencyContactsConcurrency.ts',
    sites: [
      {
        classification: 'NO_ROW_ACCESS',
        count: 2,
        justification:
          'One `pg_advisory_xact_lock` and one `pg_try_advisory_xact_lock` for primary-contact ' +
          'promotion. No table access.',
      },
    ],
  },
  {
    file: 'server/src/services/patientIdentityService.ts',
    sites: [
      {
        classification: 'NO_ROW_ACCESS',
        count: 1,
        justification: 'One `pg_advisory_xact_lock(int4, int4)` call. No table access.',
      },
    ],
  },
  {
    file: 'server/src/services/patientMedicalHistoryConcurrency.ts',
    sites: [
      {
        classification: 'NO_ROW_ACCESS',
        count: 1,
        justification: 'One `pg_advisory_xact_lock(int4, int4)` call. No table access.',
      },
    ],
  },
  {
    file: 'server/src/services/privacy/clinicBulkExportPackage.ts',
    sites: [
      {
        classification: 'NO_ROW_ACCESS',
        count: 1,
        justification: 'One `pg_advisory_xact_lock(int4, int4)` call. No table access.',
      },
    ],
  },
  {
    file: 'server/src/services/privacy/clinicBulkExportPasswordAttempts.ts',
    sites: [
      {
        classification: 'NO_ROW_ACCESS',
        count: 1,
        justification: 'One `pg_advisory_xact_lock(int4, int4)` call. No table access.',
      },
    ],
  },
  {
    file: 'server/src/services/privacy/patientAnonymization.ts',
    sites: [
      {
        classification: 'TENANT_SAFE_EXPLICIT_PREDICATE',
        count: 4,
        justification:
          'Four `UPDATE ... SET "rawPayload" = NULL WHERE "clinicId" = $1 AND "patientId" = $2` ' +
          'statements. Raw only because Prisma updateMany cannot write JSON NULL; each carries the ' +
          'same clinic predicate as the Prisma updateMany immediately above it.',
      },
    ],
  },
  {
    file: 'server/src/services/privacy/patientPrivacyExportPackage.ts',
    sites: [
      {
        classification: 'NO_ROW_ACCESS',
        count: 1,
        justification: 'One `pg_advisory_xact_lock(int4, int4)` call. No table access.',
      },
    ],
  },
  {
    file: 'server/src/services/reports/revenueByPeriodQuery.ts',
    sites: [
      {
        classification: 'TENANT_SAFE_EXPLICIT_PREDICATE',
        count: 1,
        justification:
          'Payment revenue aggregation whose scoped_payments CTE starts with ' +
          '`WHERE ${clinicScopeSql(scope, "p")}`, the same Layer-1 scope helper the route used to ' +
          'authorize the request. Raw because of the DATE_TRUNC bucketing and the LEFT JOIN.',
      },
    ],
  },
  {
    file: 'server/src/services/security/securityIncidentService.ts',
    sites: [
      {
        classification: 'SYSTEM_ONLY',
        count: 1,
        justification:
          'An `UPDATE "SecurityIncident" SET severity = ... WHERE id = ... AND rank < ...` ' +
          'compare-and-set. SecurityIncident is EXPLICIT_REVIEW_REQUIRED and, per the F3-2 ' +
          'decision, is system-context-only; the whole incident lifecycle runs inside ' +
          'runAsSystem({ reason: "security-incident-lifecycle" }).',
      },
      {
        classification: 'NO_ROW_ACCESS',
        count: 1,
        justification:
          'One `pg_advisory_xact_lock(int4, int4)` serializing incident upserts. No table access.',
      },
    ],
  },
]);

/** Total classified call sites, computed — never hand-maintained. */
export function rawSqlAuditTotalCallSites(): number {
  return RAW_SQL_AUDIT_REGISTRY.reduce(
    (total, entry) => total + entry.sites.reduce((n, s) => n + s.count, 0),
    0,
  );
}

/** Call-site counts per classification. */
export function rawSqlAuditCountsByClassification(): Readonly<Record<RawSqlTenantClassification, number>> {
  const counts: Record<RawSqlTenantClassification, number> = {
    TENANT_SAFE_EXPLICIT_PREDICATE: 0,
    NO_ROW_ACCESS: 0,
    SYSTEM_ONLY: 0,
    NEEDS_TENANT_CONTEXT_HELPER: 0,
    MIGRATION_OR_ADMIN_ONLY: 0,
    UNSAFE_BLOCKER: 0,
  };
  for (const entry of RAW_SQL_AUDIT_REGISTRY) {
    for (const site of entry.sites) counts[site.classification] += site.count;
  }
  return counts;
}

/** Entries that record a live tenant-isolation defect. Must stay empty. */
export function rawSqlAuditBlockers(): readonly RawSqlAuditEntry[] {
  return RAW_SQL_AUDIT_REGISTRY.filter((e) =>
    e.sites.some((s) => s.classification === 'UNSAFE_BLOCKER'),
  );
}
