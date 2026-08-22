-- F3-3 PoC — database roles.
--
-- ISOLATED, DISPOSABLE ENVIRONMENT ONLY. Every object here is created inside a
-- throwaway Docker PostgreSQL that the harness destroys at the end of the run.
-- Nothing in this file is a production migration, and none of it is registered
-- with Prisma Migrate.
--
-- Passwords are supplied by the harness as :'app_password' / :'platform_password'
-- psql variables, generated randomly per run. They are never written to this
-- file, never reused, and never leave the container network.
--
-- THE ROLE SEPARATION IS THE POINT (F0-009 §7.2):
--
--   noramedi_migrator  owns every table and carries BYPASSRLS. It is how the
--                      schema is created and how fixtures are seeded. Nothing
--                      the application does at runtime uses it.
--
--   noramedi_app       the runtime role. NOT an owner of any table and NOT
--                      BYPASSRLS — those two facts together are what make the
--                      denial experiments meaningful. If `app` owned the tables,
--                      `ENABLE ROW LEVEL SECURITY` alone would not apply to it
--                      (see 90_force_rls_ownership_demo.sql), and if it had
--                      BYPASSRLS, no policy would ever be consulted.
--
--   noramedi_platform  the platform-admin / break-glass path. Deliberately NOT
--                      BYPASSRLS: it gets its own explicitly permissive POLICY
--                      on exactly the tables it is meant to reach, so
--                      break-glass access is a reviewable grant rather than an
--                      unconditional override (F0-009 §7.2).

-- The migrator already exists: it is the bootstrap superuser the container was
-- created with, and it owns everything `prisma migrate deploy` created. This
-- statement records the intent explicitly rather than relying on that accident.
ALTER ROLE noramedi_migrator BYPASSRLS;

CREATE ROLE noramedi_app LOGIN PASSWORD :'app_password' NOBYPASSRLS;
CREATE ROLE noramedi_platform LOGIN PASSWORD :'platform_password' NOBYPASSRLS;

GRANT CONNECT ON DATABASE noramedi_poc TO noramedi_app, noramedi_platform;
GRANT USAGE ON SCHEMA public TO noramedi_app, noramedi_platform;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO noramedi_app, noramedi_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
  TO noramedi_app, noramedi_platform;

-- Anything the harness creates later (the ownership demo table) is covered too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO noramedi_app, noramedi_platform;

-- ── Transaction-local tenant context ────────────────────────────────────────
--
-- Read with the `missing_ok = true` third argument so an UNSET variable yields
-- NULL rather than raising. That choice is only safe because of how the
-- policies use it: every predicate compares a column to this value, and
-- `column = NULL` is NULL, which excludes the row. There is deliberately NO
-- `OR current_setting(...) IS NULL` anywhere — that is the exact pattern that
-- turns a missing context into total access.
--
-- STABLE, not IMMUTABLE: the value genuinely changes between transactions, and
-- marking it IMMUTABLE would invite the planner to fold it into a constant.

CREATE OR REPLACE FUNCTION app_current_organization_id() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.organization_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app_current_clinic_ids() RETURNS text[]
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN nullif(current_setting('app.clinic_ids', true), '') IS NULL THEN NULL
    ELSE string_to_array(current_setting('app.clinic_ids', true), ',')
  END
$$;

GRANT EXECUTE ON FUNCTION app_current_organization_id() TO noramedi_app, noramedi_platform;
GRANT EXECUTE ON FUNCTION app_current_clinic_ids() TO noramedi_app, noramedi_platform;
