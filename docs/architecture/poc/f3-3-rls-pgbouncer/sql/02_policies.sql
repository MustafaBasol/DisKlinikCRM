-- F3-3 PoC — FORCE ROW LEVEL SECURITY and tenant policies on four REAL tables.
--
-- ISOLATED, DISPOSABLE ENVIRONMENT ONLY. Not a Prisma migration, not registered
-- with Prisma Migrate, never applied to any shared or production database.
--
-- WHY THESE FOUR TABLES
-- ---------------------
-- One per tenant-ownership shape in the F3-1 registry, so that every policy
-- FAMILY in F0-009 §7.4 gets exercised without touching all 114 models:
--
--   "Clinic"                  ORGANIZATION_SCOPED_DIRECT   organization column only
--   "Patient"                 CLINIC_SCOPED_DIRECT         dual key (org + clinic)
--   "PaymentPlan"             CLINIC_SCOPED_DIRECT         clinicId only, no org column
--   "PaymentPlanInstallment"  PARENT_SCOPED                no tenant column at all
--
-- Deliberately NOT selected: any of the five `EXPLICIT_REVIEW_REQUIRED` models.
-- Their tenant columns are nullable by design, so writing a policy for them
-- would be inventing the ownership decision this programme has not made.
--
-- BOTH `ENABLE` AND `FORCE`
-- -------------------------
-- `ENABLE` makes policies apply to ordinary roles. It does NOT apply to the
-- table's OWNER. Here the owner is `noramedi_migrator` and the runtime role is
-- `noramedi_app`, so `ENABLE` alone would already constrain the application —
-- but that safety is an accident of who happens to own the table, and a future
-- `ALTER TABLE ... OWNER TO` would silently remove it. `FORCE` removes the
-- dependence on ownership entirely. The mechanic is proved directly in
-- 90_force_rls_ownership_demo.sql rather than asserted here.
--
-- TWO POLICIES PER TABLE, ROLE-SCOPED
-- -----------------------------------
-- PostgreSQL ORs permissive policies together, so a second unconditional policy
-- would be a hole if it applied to everyone. Each policy names its role: the
-- tenant policy is `TO noramedi_app`, the break-glass policy is
-- `TO noramedi_platform`. A role with no policy on a FORCE'd table sees nothing.
--
-- `WITH CHECK` mirrors `USING` everywhere, because a policy with only `USING`
-- constrains what you can SEE and not what you can WRITE — an INSERT of another
-- tenant's row would succeed and simply become invisible afterwards.

-- ── Clinic — organization-scoped ────────────────────────────────────────────
ALTER TABLE "Clinic" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Clinic" FORCE ROW LEVEL SECURITY;

CREATE POLICY clinic_tenant_isolation ON "Clinic"
  FOR ALL TO noramedi_app
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

CREATE POLICY clinic_platform_support ON "Clinic"
  FOR ALL TO noramedi_platform USING (true) WITH CHECK (true);

-- ── Patient — dual key ──────────────────────────────────────────────────────
-- Both columns are checked. Checking only `clinicId` would be sufficient in
-- practice (clinicId -> Clinic.organizationId is FK-enforced and NOT NULL), but
-- the dual predicate is what makes an organization-A / clinic-B pairing
-- impossible at the DATABASE layer rather than only in application code.
ALTER TABLE "Patient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Patient" FORCE ROW LEVEL SECURITY;

CREATE POLICY patient_tenant_isolation ON "Patient"
  FOR ALL TO noramedi_app
  USING (
    "organizationId" = app_current_organization_id()
    AND "clinicId" = ANY (app_current_clinic_ids())
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND "clinicId" = ANY (app_current_clinic_ids())
  );

CREATE POLICY patient_platform_support ON "Patient"
  FOR ALL TO noramedi_platform USING (true) WITH CHECK (true);

-- ── PaymentPlan — clinicId only ─────────────────────────────────────────────
-- 51 of the 114 models have this shape. No organization column exists, so the
-- policy cannot reference one; organization identity is reachable only through
-- `clinicId -> Clinic.organizationId`, and the clinic-id list already comes
-- from a set the application authorized.
ALTER TABLE "PaymentPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentPlan" FORCE ROW LEVEL SECURITY;

CREATE POLICY payment_plan_tenant_isolation ON "PaymentPlan"
  FOR ALL TO noramedi_app
  USING ("clinicId" = ANY (app_current_clinic_ids()))
  WITH CHECK ("clinicId" = ANY (app_current_clinic_ids()));

CREATE POLICY payment_plan_platform_support ON "PaymentPlan"
  FOR ALL TO noramedi_platform USING (true) WITH CHECK (true);

-- ── PaymentPlanInstallment — parent-scoped ──────────────────────────────────
-- No tenant column exists, so the predicate has to reach the parent. Note that
-- the subquery reads "PaymentPlan", which is ITSELF under RLS — the parent's
-- own policy applies inside this EXISTS, which means the child is protected
-- twice over and cannot become visible through a parent the caller could not
-- read. That is a property worth stating, because the naive reading is that a
-- subquery would bypass it.
ALTER TABLE "PaymentPlanInstallment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentPlanInstallment" FORCE ROW LEVEL SECURITY;

CREATE POLICY installment_tenant_isolation ON "PaymentPlanInstallment"
  FOR ALL TO noramedi_app
  USING (
    EXISTS (
      SELECT 1 FROM "PaymentPlan" p
      WHERE p.id = "PaymentPlanInstallment"."planId"
        AND p."clinicId" = ANY (app_current_clinic_ids())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "PaymentPlan" p
      WHERE p.id = "PaymentPlanInstallment"."planId"
        AND p."clinicId" = ANY (app_current_clinic_ids())
    )
  );

CREATE POLICY installment_platform_support ON "PaymentPlanInstallment"
  FOR ALL TO noramedi_platform USING (true) WITH CHECK (true);
