-- F3-3 PoC — rollback.
--
-- ISOLATED, DISPOSABLE ENVIRONMENT ONLY.
--
-- The PoC's environment is a throwaway container, so its real rollback is
-- `docker rm -f`. This file exists for a different reason: it is the rehearsal
-- of the rollback a FUTURE production rollout would need, and the harness runs
-- it and then re-asserts that the previously-denied cross-tenant read succeeds
-- again — so "reversible" is demonstrated rather than claimed.
--
-- ORDER MATTERS. Policies are dropped before RLS is turned off; doing it the
-- other way round leaves orphaned policies attached to the table that spring
-- back to life the moment anyone re-enables RLS.
--
-- WHAT IT DELIBERATELY DOES NOT DO:
--   - It drops no column. Tenant columns are the data, not the mechanism.
--   - It drops no table and no row.
--   - It does not drop `noramedi_app` / `noramedi_platform`, because in a real
--     rollout those roles keep running the application; only the enforcement is
--     withdrawn.
--
-- A production rollout would apply this table by table, verifying between
-- steps, never as one transaction across every table at once.

DROP POLICY IF EXISTS clinic_tenant_isolation ON "Clinic";
DROP POLICY IF EXISTS clinic_platform_support ON "Clinic";
ALTER TABLE "Clinic" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "Clinic" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_tenant_isolation ON "Patient";
DROP POLICY IF EXISTS patient_platform_support ON "Patient";
ALTER TABLE "Patient" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "Patient" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_plan_tenant_isolation ON "PaymentPlan";
DROP POLICY IF EXISTS payment_plan_platform_support ON "PaymentPlan";
ALTER TABLE "PaymentPlan" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "PaymentPlan" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS installment_tenant_isolation ON "PaymentPlanInstallment";
DROP POLICY IF EXISTS installment_platform_support ON "PaymentPlanInstallment";
ALTER TABLE "PaymentPlanInstallment" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "PaymentPlanInstallment" DISABLE ROW LEVEL SECURITY;
