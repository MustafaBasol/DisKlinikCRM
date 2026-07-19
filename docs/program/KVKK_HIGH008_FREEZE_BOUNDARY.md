# KVKK-HIGH-008 Freeze Boundary (companion to KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md)

**Source task:** F0-011-P1
**Baseline commit:** `origin/main` @ `64b9edeb5e1e90f47aa85dfca0822fd8f61cbe26`
**Relationship to the existing document:** This document does **not** replace, restate in full, or loosen `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` (the F0-007 document). It adds one explicit, narrow rule to cover a category that document's §3 (blocked) and §4 (allowed-in-parallel) lists did not contemplate: a *new*, narrow, additive implementation branch (KVKK-HIGH-008) appearing after the freeze was established, that is neither one of the 16 broad/wide categories in §3 nor pure documentation/design/PoC work under §4.

## 1. Why a companion document, not an edit to the existing one

`KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §3 lists 16 *broad or wide* categories of blocked work (schema refactoring, model relocation, middleware restructuring, RLS rollout, wide module extraction, etc.). §4 lists what's allowed in parallel, and it is explicitly documentation/design/PoC/evidence-collection only — "design work being allowed does not authorize implementation." KVKK-HIGH-008, as evidenced in `evidence/F0-011-P1_KVKK_HIGH008_ACTIVE_WORK_BASELINE.md`, is:

- **Not** a broad/wide change — one new table (additive-only), one new service module, three new routes, frontend wiring. It matches none of §3's 16 items.
- **Not** documentation/design/PoC — it is real, working, tested implementation code.

Editing §3 or §4 to fit this branch after the fact would risk being read as *loosening* the freeze to accommodate work already in progress — exactly the failure mode the task brief warns against ("do not loosen the existing freeze boundary," "do not treat 'code exists' as authorization"). Instead, this document names the gap and resolves it narrowly, leaving §3/§4 of the original document untouched.

## 2. Resolution

**A new category is recognized: `ALLOWED_NOW_NARROW_CORRECTIVE_FIX` for code that meets ALL of the following, evaluated per-file:**

1. Purely additive at the schema level (no ALTER/DROP of any existing table, column, index, or constraint).
2. Does not touch any of the 20 rows in `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §2's matrix in a way that changes their *existing* behavior (new, isolated tables/routes are fine; modifying `PatientCommunicationPreference`/`PatientCommunicationConsentEvent`/reconciliation/audit-reporting/retention-job behavior is not).
3. Does not cross a module boundary into another domain's internal services or Prisma models beyond pre-existing, already-used relations.
4. Is independently, transactionally audited (no correction/mutation without an atomic audit-log write).
5. Is tenant-scoped on every query with no exception.
6. Does not match any of §3's 16 blocked categories.

**KVKK-HIGH-008's runtime code (service, route, schema, migration, frontend wiring) meets conditions 1-6**, per the read-only evidence in the companion baseline document. It is therefore classified `ALLOWED_NOW_NARROW_CORRECTIVE_FIX` for continued development, code review, and merge-readiness work — **this explicitly does not mean "allowed to deploy to production."**

**This classification is scoped to this specific branch/PR (#180) as evidenced on 2026-07-19. It is not a standing, general authorization for future branches** — any future branch must be independently evaluated against conditions 1-6 above, and a branch that fails any one of them falls back to the original document's §3/§4 categories (i.e., defaults to blocked unless it is pure documentation/design/PoC).

## 3. What remains blocked regardless of this document

- **Production application of the new migration** (`20260719155318_kvkk_high008_legacy_consent_correction`) — classified `BLOCKED_UNTIL_PR175_PRODUCTION_MIGRATION_VERIFIED` in the file inventory. Rationale: KVKK-HIGH-007's own migration production-application status is unconfirmed (`KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §5 condition 3, still unsatisfied as of this document's baseline). Stacking a second KVKK-consent-adjacent migration into production before the first is independently confirmed compounds `RISK_REGISTER.md` R-046 ("migration deployed without rollback/tenant-impact verification = irreversible risk"). This block lifts when condition 3 is independently satisfied for PR #175 (or an equivalent independent production-migration-history check is performed for this migration specifically).
- **Production deployment / activation of the routes** — same rationale, plus the absence of a feature flag/kill switch (§4 below) means deployment and activation are the same event for this workflow; both are blocked pending explicit human/program acceptance of that design point.
- **Any work matching the original document's §3 16-item list** — entirely unaffected by this document; still blocked pending §5 condition 5 (external KVKK-baseline-stable declaration).
- **Merge to `main`** — not blocked by this document (code-level merge readiness is a program/reviewer decision, see baseline §12), but this document does not itself authorize merge or assign `MERGED`/`TESTS_PASSED` status, consistent with `NORAMEDI_MASTER_TRACKER.md` §2.3's agent-authority limits.

## 4. Additional condition flagged for explicit acceptance: no feature flag

Unlike KVKK-HIGH-007 (which ships behind `COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED`/`_MODE` and a separate legacy-reconciliation flag, both default-disabled), KVKK-HIGH-008 has **no runtime flag at all** — per PR #180's own description, the workflow is "active immediately after deployment" for OWNER/ORG_ADMIN/CLINIC_MANAGER. This is architecturally defensible given the workflow's create-only, transactionally-audited, tenant-scoped, non-consent-granting design (see baseline §8) — but it means there is no kill switch if an unforeseen issue appears post-deployment other than a code rollback/redeploy. **This document does not block on this point, but requires it be an explicit, named decision** (accept the no-flag design, or request a flag be added) before production deployment, rather than an implicit default. This is recorded as an open item in `RISK_REGISTER.md` (see targeted update in this same PR).

## 5. Non-authorization

This document, like the F0-011-P1 baseline it accompanies, records a classification only. It does not itself approve merge, deployment, migration application, or feature activation for KVKK-HIGH-008/PR #180. Those require the external confirmations listed in the baseline document §12/§14.
