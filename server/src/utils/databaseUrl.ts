/**
 * databaseUrl.ts — production fail-hard DATABASE_URL validation.
 *
 * Prior to this, db.ts passed `process.env.DATABASE_URL!` (a compile-time-only
 * non-null assertion) straight into the Prisma pg adapter. If DATABASE_URL is
 * actually unset at runtime, `connectionString` becomes `undefined`, and
 * node-postgres does NOT fail — it silently falls back to libpq-style PG*
 * environment variables (PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD) or,
 * absent those, driver defaults (localhost, current OS user, no password).
 * That is exactly the "critical production config silently degrades instead
 * of failing closed" pattern F3 targets: a missing DATABASE_URL could connect
 * production to an unintended local/default Postgres instance instead of
 * refusing to start.
 *
 * Scoped to production only, mirroring the existing ENCRYPTION_KEY check in
 * index.ts. This module's own `db.ts` caller runs eagerly at import time —
 * many test files (server:test:non-disposable, "zero external infra" per
 * ci-layers.yml) import db.ts only transitively (via a route/service) and
 * never issue a real query, so DATABASE_URL is legitimately unset for them.
 * An unconditional throw here would crash import for all of them, not just
 * ones that actually need a live connection — confirmed by running the
 * non-disposable suite against an unconditional version of this check.
 * Outside production this therefore returns the value verbatim (including
 * `undefined`), identical to the prior `!`-asserted behavior: a test that
 * never queries the DB still never notices, and one that does still fails
 * exactly as before, at the same lazy-connection point it always did.
 */
export function getRequiredDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.DATABASE_URL?.trim();
  if (value) return value;

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'DATABASE_URL is not set. The Prisma pg adapter silently falls back to ' +
        'PG*-style environment variables (or driver defaults) when connectionString ' +
        'is undefined, which can connect to an unintended Postgres instance instead ' +
        'of failing loudly. Set DATABASE_URL=postgresql://... and restart.',
    );
  }

  return env.DATABASE_URL as string;
}
