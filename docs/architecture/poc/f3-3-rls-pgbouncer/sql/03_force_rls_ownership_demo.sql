-- F3-3 PoC — proving the difference between ENABLE and FORCE, rather than
-- asserting it from the documentation.
--
-- ISOLATED, DISPOSABLE ENVIRONMENT ONLY.
--
-- THE QUESTION
-- ------------
-- `ALTER TABLE x ENABLE ROW LEVEL SECURITY` does not apply to the table's
-- OWNER. That is well documented, and it is also the single easiest way for an
-- RLS rollout to be quietly worthless: if the runtime role ever ends up owning
-- a table — an `ALTER TABLE ... OWNER TO`, a restore performed as the wrong
-- role, a table created by the application instead of the migrator — every
-- policy on it stops applying to exactly the connection it was written for, and
-- nothing errors.
--
-- On the four real tables in 02_policies.sql the owner is `noramedi_migrator`
-- and the runtime role is `noramedi_app`, so the distinction is invisible
-- there. This table exists to make it visible: it is owned by `noramedi_app`
-- itself, carries a policy that should hide every row, and is switched from
-- ENABLE to FORCE mid-experiment.
--
-- Expected, and asserted by the harness:
--   ENABLE only  -> the owner sees ALL rows. The policy is not consulted.
--   + FORCE      -> the owner sees only what the policy allows (here: none).

CREATE TABLE poc_force_demo (
  id   text PRIMARY KEY,
  note text NOT NULL
);

ALTER TABLE poc_force_demo OWNER TO noramedi_app;

INSERT INTO poc_force_demo (id, note) VALUES
  ('demo-1', 'owner-visible-under-enable-only'),
  ('demo-2', 'owner-visible-under-enable-only');

-- A policy that can never match: it is here to be BYPASSED first and then
-- ENFORCED, so the two readings differ by the FORCE flag alone.
ALTER TABLE poc_force_demo ENABLE ROW LEVEL SECURITY;

CREATE POLICY poc_force_demo_deny_all ON poc_force_demo
  FOR ALL TO noramedi_app
  USING (false)
  WITH CHECK (false);
