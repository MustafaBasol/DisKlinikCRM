/**
 * tenantModelClassification.ts — F3-1 canonical tenant model classification.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Tenant isolation in NoraMedi is enforced today entirely in application code
 * (utils/clinicScope.ts, middleware/clinicAccess.ts, per-route `where`
 * clauses). Nothing in the repository knows, as data, which Prisma models are
 * tenant-owned and how. That means a new model can be added, shipped, and
 * queried without anyone ever deciding whether it needs a tenant predicate —
 * the failure is silent, and its blast radius is cross-clinic or
 * cross-organization data exposure.
 *
 * This module is the single executable answer to "who owns this table". It is
 * pure, frozen, dependency-free data plus lookups over that data:
 *   - no Prisma import, no database access, no I/O, no schema parsing;
 *   - nothing here runs on a request path, so production runtime cost is zero.
 *
 * It is the input contract that F3-2 (TenantContext + Prisma/data-access
 * guard) and F3-3 (PostgreSQL FORCE RLS PoC) consume. NEITHER OF THOSE IS
 * IMPLEMENTED HERE: this file decides nothing at runtime, injects no query
 * predicate, and opens no transaction. It only records, per model, what a
 * guard would eventually have to do.
 *
 * THE CONTRACT
 * ------------
 * Every `model` block in server/prisma/schema.prisma must have exactly one
 * entry below, and every entry must name a model that still exists.
 * tests/tenantModelClassification.test.ts enforces both directions against the
 * real schema file and fails CI on drift, so adding a Prisma model without
 * classifying it — or deleting one without removing its entry — breaks the
 * build rather than quietly widening the tenant surface.
 *
 * FAIL CLOSED. A model whose ownership cannot be established from the schema
 * is classified `EXPLICIT_REVIEW_REQUIRED`, not "global". Absence of a
 * `clinicId` column is never, on its own, evidence that data is
 * platform-global; `PLATFORM_GLOBAL` and `SYSTEM_INTERNAL` are positive
 * assertions that carry a recorded rationale.
 *
 * MAINTAINING IT
 * --------------
 * Add the entry in the same order the model appears in schema.prisma. Fill in
 * `rationale` whenever the classification is anything other than a mechanical
 * read of the model's own tenant columns (i.e. always for PLATFORM_GLOBAL,
 * SYSTEM_INTERNAL, PARENT_SCOPED and EXPLICIT_REVIEW_REQUIRED). Never resolve
 * a failing test by moving a model into PLATFORM_GLOBAL to make it quiet.
 *
 * Related: docs/architecture/tenant-rls-pgbouncer-poc-design.md (F0-009
 * design input), docs/program/evidence/F3-1_TENANT_MODEL_CLASSIFICATION_FOUNDATION.md.
 */

/** How a model's tenant identity is established. */
export type TenantClassification =
  /** Belongs to an Organization directly, via a NOT NULL `organizationId` (or, for Organization itself, via its own id). */
  | 'ORGANIZATION_SCOPED_DIRECT'
  /** Belongs to a Clinic directly, via a NOT NULL `clinicId`. May additionally carry `organizationId`. */
  | 'CLINIC_SCOPED_DIRECT'
  /** Carries no tenant column; tenant identity is inherited through exactly one owning parent row. */
  | 'PARENT_SCOPED'
  /** Global platform data, intentionally not tenant-owned. A positive assertion, never a default. */
  | 'PLATFORM_GLOBAL'
  /** Operational/system data whose access semantics are not those of tenant application data. */
  | 'SYSTEM_INTERNAL'
  /** Ownership cannot be established safely. Must never be treated as tenant-safe by guard code. */
  | 'EXPLICIT_REVIEW_REQUIRED';

/**
 * What a future F3-2 runtime guard would have to do for this model. Recorded
 * as intent only — this module performs none of it.
 */
export type TenantGuardMode =
  /** Constrain `organizationId` AND `clinicId`, and validate on write that the two agree. */
  | 'AUTO_FILTER_DUAL_KEY'
  /** Constrain `organizationId`. */
  | 'AUTO_FILTER_ORGANIZATION_ID'
  /** Constrain `clinicId` (organization reachable through `organizationDerivedVia`). */
  | 'AUTO_FILTER_CLINIC_ID'
  /** No column to filter on: validate that the owning parent row belongs to the caller's tenant. */
  | 'PARENT_OWNERSHIP_VALIDATION'
  /** Tenant-independent by design; a tenant predicate would be wrong. */
  | 'NO_TENANT_FILTER'
  /** Reachable only from a platform/system context, never from a tenant request. */
  | 'SYSTEM_CONTEXT_ONLY'
  /** Fail closed: no guard mode may be assumed until the ownership question is answered. */
  | 'BLOCKED_PENDING_REVIEW';

/** Whether a PostgreSQL row-level-security policy is a candidate for this model (F3-3 input). */
export type RlsCandidacy = 'CANDIDATE' | 'NOT_APPLICABLE' | 'REQUIRES_DESIGN_REVIEW';

/**
 * Schema work this model is expected to need LATER. F3-1 deliberately makes no
 * schema or migration change; these are recorded requirements, not pending edits.
 */
export type FutureSchemaWork =
  | 'NONE'
  /** An `organizationId` column exists but is still nullable; needs backfill + NOT NULL. */
  | 'ORGANIZATION_ID_NOT_NULL'
  /** Ownership itself is undecided; the answer may or may not be a schema change. */
  | 'TENANT_OWNERSHIP_DECISION_REQUIRED';

/** The single owning relation a PARENT_SCOPED model inherits tenant identity through. */
export interface TenantParentPath {
  /** Prisma relation field on THIS model. */
  readonly relationField: string;
  /** Model that relation points at. */
  readonly model: string;
  /** Scalar foreign key backing `relationField`. */
  readonly foreignKeyField: string;
}

export interface TenantModelEntry {
  /** Prisma model name, exactly as declared in schema.prisma. */
  readonly model: string;
  readonly classification: TenantClassification;
  /** Name of the direct organization column, or null when the model has none. */
  readonly organizationIdField: string | null;
  /** True when that column exists but is nullable — i.e. not trustworthy as a sole predicate. */
  readonly organizationIdNullable: boolean;
  /** Name of the direct clinic column, or null when the model has none. */
  readonly clinicIdField: string | null;
  readonly clinicIdNullable: boolean;
  /**
   * How organization identity is reached when the model has no trustworthy
   * `organizationId` of its own (e.g. 'clinicId -> Clinic.organizationId').
   * Null when the model carries organization identity directly, or has none.
   */
  readonly organizationDerivedVia: string | null;
  /** Set only for PARENT_SCOPED (and for review-blocked models that would inherit through a parent). */
  readonly parent: TenantParentPath | null;
  readonly guardMode: TenantGuardMode;
  readonly rls: RlsCandidacy;
  readonly futureSchemaWork: FutureSchemaWork;
  /** Required wherever the classification is not a mechanical read of the model's own tenant columns. */
  readonly rationale?: string;
}

/**
 * THE REGISTRY. Ordered exactly as the models appear in schema.prisma so a
 * reviewer can diff the two side by side.
 */
export const TENANT_MODEL_CLASSIFICATION: readonly TenantModelEntry[] = Object.freeze([
  {
    model: 'Clinic',
    classification: 'ORGANIZATION_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_ORGANIZATION_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
    rationale:
      'The clinic identity row. Carries a NOT NULL organizationId, and its own `id` is what ' +
      'every CLINIC_SCOPED_DIRECT model points at - a guard must constrain both (organizationId ' +
      '= ctx AND id IN ctx.allowedClinicIds).',
  },
  {
    model: 'User',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'DoctorAvailability',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'DoctorOffDay',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'Patient',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'PatientEmergencyContact',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'PatientContactPoint',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'PatientMedicalHistory',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'MedicalCondition',
    classification: 'PLATFORM_GLOBAL',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'NO_TENANT_FILTER',
    rls: 'NOT_APPLICABLE',
    futureSchemaWork: 'NONE',
    rationale:
      'ICD-10 reference catalog shared by every tenant. No tenant column by design; extended ' +
      'only by adding rows (see medicalConditionCatalogIntegrity.test.ts).',
  },
  {
    model: 'PatientCondition',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'AppointmentType',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'Appointment',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'AppointmentRequest',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'ContactRequest',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'WhatsAppConversationState',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'WhatsAppConversationMessage',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'TreatmentCase',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'TreatmentPackage',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'TreatmentPackageItem',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'AppointmentTypeMaterial',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'TreatmentPackageMaterial',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'TreatmentPackageApplication',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'InsuranceProvision',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'Task',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'Payment',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'MessageTemplate',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'SentMessage',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: true,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'ORGANIZATION_ID_NOT_NULL',
    rationale:
      'clinicId is NOT NULL, but the organizationId column exists and is still NULLABLE - a ' +
      'legacy backfill gap. Until it is backfilled and tightened, only the clinic predicate is ' +
      'trustworthy.',
  },
  {
    model: 'ActivityLog',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'Setting',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'ClinicRecallSetting',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'RecallCandidate',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'RecallAction',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'PatientAttachment',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'ToothRecord',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'PaymentPlan',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'PaymentPlanInstallment',
    classification: 'PARENT_SCOPED',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: { relationField: 'plan', model: 'PaymentPlan', foreignKeyField: 'planId' },
    guardMode: 'PARENT_OWNERSHIP_VALIDATION',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
    rationale:
      'Tenant identity is inherited through plan -> PaymentPlan. Denormalizing ' +
      'clinicId/organizationId here would add a second, drift-prone source of truth for the ' +
      'same fact.',
  },
  {
    model: 'PractitionerCompensationRule',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'ServiceCompensationRule',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'PractitionerEarning',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'PractitionerPayout',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'InventoryItem',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'InventoryUnit',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'InventoryTransaction',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'TreatmentPlanProcedure',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'Notification',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'Plan',
    classification: 'PLATFORM_GLOBAL',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'NO_TENANT_FILTER',
    rls: 'NOT_APPLICABLE',
    futureSchemaWork: 'NONE',
    rationale:
      'Subscription plan catalog owned by the platform; referenced by Organization/Clinic, ' +
      'never owned by one.',
  },
  {
    model: 'PlatformAdmin',
    classification: 'PLATFORM_GLOBAL',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'NO_TENANT_FILTER',
    rls: 'NOT_APPLICABLE',
    futureSchemaWork: 'NONE',
    rationale:
      'Platform staff identity. Deliberately outside the Organization/Clinic tree - a tenant ' +
      'must never read or write it.',
  },
  {
    model: 'ClinicInvitation',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: true,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'ORGANIZATION_ID_NOT_NULL',
    rationale:
      'clinicId is NOT NULL, but the organizationId column exists and is still NULLABLE - a ' +
      'legacy backfill gap. Until it is backfilled and tightened, only the clinic predicate is ' +
      'trustworthy.',
  },
  {
    model: 'Organization',
    classification: 'ORGANIZATION_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_ORGANIZATION_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
    rationale:
      'The tenant root itself. Its own `id` IS the organization identity; it has no ' +
      'organizationId column and must never be given one.',
  },
  {
    model: 'UserClinic',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'PatientClinic',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'ClinicWorkingHours',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'WhatsAppConnection',
    classification: 'ORGANIZATION_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_ORGANIZATION_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'ClinicWhatsAppConnection',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'WhatsAppInboxEntry',
    classification: 'ORGANIZATION_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: true,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_ORGANIZATION_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
    rationale:
      'organizationId is NOT NULL; clinicId is nullable by design (rows may exist before a ' +
      'clinic is resolved), so the clinic predicate is additive, never the primary tenant key.',
  },
  {
    model: 'AuditLog',
    classification: 'ORGANIZATION_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: true,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_ORGANIZATION_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
    rationale:
      'organizationId is NOT NULL; clinicId is nullable by design (rows may exist before a ' +
      'clinic is resolved), so the clinic predicate is additive, never the primary tenant key.',
  },
  {
    model: 'OperationalEvent',
    classification: 'ORGANIZATION_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: true,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_ORGANIZATION_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
    rationale:
      'organizationId is NOT NULL; clinicId is nullable by design (rows may exist before a ' +
      'clinic is resolved), so the clinic predicate is additive, never the primary tenant key.',
  },
  {
    model: 'MessagingInboundEvent',
    classification: 'EXPLICIT_REVIEW_REQUIRED',
    organizationIdField: 'organizationId',
    organizationIdNullable: true,
    clinicIdField: 'clinicId',
    clinicIdNullable: true,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'BLOCKED_PENDING_REVIEW',
    rls: 'REQUIRES_DESIGN_REVIEW',
    futureSchemaWork: 'TENANT_OWNERSHIP_DECISION_REQUIRED',
    rationale:
      'Raw inbound webhook envelope persisted BEFORE the connection is resolved, so ' +
      'organizationId and clinicId are both nullable and are frequently null on arrival. Tenant ' +
      'identity is assigned later by the processor; the pre-resolution window has no correct ' +
      'tenant predicate.',
  },
  {
    model: 'JobLock',
    classification: 'SYSTEM_INTERNAL',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'SYSTEM_CONTEXT_ONLY',
    rls: 'NOT_APPLICABLE',
    futureSchemaWork: 'NONE',
    rationale:
      'Advisory scheduler lock (utils/jobLock.ts). Operational infrastructure, not tenant ' +
      'application data.',
  },
  {
    model: 'InstagramConnection',
    classification: 'ORGANIZATION_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_ORGANIZATION_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'ClinicInstagramConnection',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'InstagramInboxEntry',
    classification: 'ORGANIZATION_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: true,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_ORGANIZATION_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
    rationale:
      'organizationId is NOT NULL; clinicId is nullable by design (rows may exist before a ' +
      'clinic is resolved), so the clinic predicate is additive, never the primary tenant key.',
  },
  {
    model: 'InstagramConversationMessage',
    classification: 'ORGANIZATION_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: true,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_ORGANIZATION_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
    rationale:
      'organizationId is NOT NULL; clinicId is nullable by design (rows may exist before a ' +
      'clinic is resolved), so the clinic predicate is additive, never the primary tenant key.',
  },
  {
    model: 'PostTreatmentMessageTemplate',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'PostTreatmentMessageQueue',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'PlatformSetting',
    classification: 'PLATFORM_GLOBAL',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'NO_TENANT_FILTER',
    rls: 'NOT_APPLICABLE',
    futureSchemaWork: 'NONE',
    rationale:
      'Platform-wide key/value configuration mutated only through the platform-admin surface.',
  },
  {
    model: 'PlatformAdminAuditEvent',
    classification: 'PLATFORM_GLOBAL',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'NO_TENANT_FILTER',
    rls: 'NOT_APPLICABLE',
    futureSchemaWork: 'NONE',
    rationale:
      'Audit trail of platform-admin actions. Its only actor FK is PlatformAdmin; it must stay ' +
      'readable by the platform audit surface alone, never by a tenant.',
  },
  {
    model: 'PatientPrivacyRequest',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'PasswordResetToken',
    classification: 'PARENT_SCOPED',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: { relationField: 'user', model: 'User', foreignKeyField: 'userId' },
    guardMode: 'PARENT_OWNERSHIP_VALIDATION',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
    rationale:
      'Tenant identity is inherited through user -> User. Denormalizing clinicId/organizationId ' +
      'here would add a second, drift-prone source of truth for the same fact.',
  },
  {
    model: 'EmailVerificationToken',
    classification: 'PARENT_SCOPED',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: { relationField: 'user', model: 'User', foreignKeyField: 'userId' },
    guardMode: 'PARENT_OWNERSHIP_VALIDATION',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
    rationale:
      'Tenant identity is inherited through user -> User. Denormalizing clinicId/organizationId ' +
      'here would add a second, drift-prone source of truth for the same fact.',
  },
  {
    model: 'ClinicLegalProfile',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'PublicBookingNoticeEvidence',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'ChannelConsentLog',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'PatientCommunicationPreference',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'PatientCommunicationConsentEvent',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'CommunicationConsentConflictBucket',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'PatientLegacyConsentCorrection',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'ClinicSmsSettings',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'SmsMessage',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'SmsUsageCounter',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'PlatformSmsProvider',
    classification: 'PLATFORM_GLOBAL',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'NO_TENANT_FILTER',
    rls: 'NOT_APPLICABLE',
    futureSchemaWork: 'NONE',
    rationale:
      'Platform-level SMS provider registry keyed by region; clinics select from it via ' +
      'ClinicSmsSettings but never own a row.',
  },
  {
    model: 'Laboratory',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'LabWorkOrder',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'LabWorkOrderStatusHistory',
    classification: 'PARENT_SCOPED',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: { relationField: 'labWorkOrder', model: 'LabWorkOrder', foreignKeyField: 'labWorkOrderId' },
    guardMode: 'PARENT_OWNERSHIP_VALIDATION',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
    rationale:
      'Tenant identity is inherited through labWorkOrder -> LabWorkOrder. Denormalizing ' +
      'clinicId/organizationId here would add a second, drift-prone source of truth for the ' +
      'same fact.',
  },
  {
    model: 'LabOrderAttachment',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'ImagingDevice',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'ImagingRequest',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'ImagingStudy',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'ImagingBridgeAgent',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'ImagingBridgePairing',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'ImagingBridgePairingDevice',
    classification: 'PARENT_SCOPED',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: { relationField: 'pairing', model: 'ImagingBridgePairing', foreignKeyField: 'pairingId' },
    guardMode: 'PARENT_OWNERSHIP_VALIDATION',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
    rationale:
      'Tenant identity is inherited through pairing -> ImagingBridgePairing. Denormalizing ' +
      'clinicId/organizationId here would add a second, drift-prone source of truth for the ' +
      'same fact.',
  },
  {
    model: 'ImagingBridgeBinding',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'ImagingImage',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'PatientPrivacyExportArchive',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'ClinicBulkExportArchive',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'ClinicBulkExportPasswordAttempt',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: 'clinicId -> Clinic.organizationId',
    parent: null,
    guardMode: 'AUTO_FILTER_CLINIC_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'SecuritySignalEvent',
    classification: 'EXPLICIT_REVIEW_REQUIRED',
    organizationIdField: 'organizationId',
    organizationIdNullable: true,
    clinicIdField: 'clinicId',
    clinicIdNullable: true,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'BLOCKED_PENDING_REVIEW',
    rls: 'REQUIRES_DESIGN_REVIEW',
    futureSchemaWork: 'TENANT_OWNERSHIP_DECISION_REQUIRED',
    rationale:
      'organizationId AND clinicId are both nullable BY DESIGN: signals raised before ' +
      'authentication (failed login, unauthenticated probe) legitimately have no tenant. A ' +
      'naive tenant predicate would either hide those rows from the platform security surface ' +
      'or leak them to a tenant. Fail closed until F3-2/F3-3 decide the policy.',
  },
  {
    model: 'SecurityIncident',
    classification: 'EXPLICIT_REVIEW_REQUIRED',
    organizationIdField: 'organizationId',
    organizationIdNullable: true,
    clinicIdField: 'clinicId',
    clinicIdNullable: true,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'BLOCKED_PENDING_REVIEW',
    rls: 'REQUIRES_DESIGN_REVIEW',
    futureSchemaWork: 'TENANT_OWNERSHIP_DECISION_REQUIRED',
    rationale:
      'Same nullable-by-design tenant pair as SecuritySignalEvent, plus a platform-admin-only ' +
      'lifecycle (assign/acknowledge/contain/resolve/close). A cross-tenant incident is a real ' +
      'state, so no single-tenant predicate is correct yet.',
  },
  {
    model: 'SecurityIncidentActivity',
    classification: 'EXPLICIT_REVIEW_REQUIRED',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: { relationField: 'incident', model: 'SecurityIncident', foreignKeyField: 'incidentId' },
    guardMode: 'BLOCKED_PENDING_REVIEW',
    rls: 'REQUIRES_DESIGN_REVIEW',
    futureSchemaWork: 'TENANT_OWNERSHIP_DECISION_REQUIRED',
    rationale:
      'No tenant column of its own; tenant identity would have to be derived from ' +
      'SecurityIncident, which is itself EXPLICIT_REVIEW_REQUIRED. The ambiguity is inherited, ' +
      'not resolved - it must not be treated as parent-safe.',
  },
  {
    model: 'FileBackupRun',
    classification: 'SYSTEM_INTERNAL',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'SYSTEM_CONTEXT_ONLY',
    rls: 'NOT_APPLICABLE',
    futureSchemaWork: 'NONE',
    rationale:
      'Off-host file-backup run ledger. Spans every clinic by construction; a tenant-scoped ' +
      'read of it is meaningless.',
  },
  {
    model: 'FileBackupEntry',
    classification: 'SYSTEM_INTERNAL',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'SYSTEM_CONTEXT_ONLY',
    rls: 'REQUIRES_DESIGN_REVIEW',
    futureSchemaWork: 'NONE',
    rationale:
      'Per-file row of a platform-wide backup run. It DOES carry a denormalized `clinicId`, but ' +
      'with no FK to Clinic and no tenant-facing read path - it is operational evidence, not ' +
      'tenant data. Left SYSTEM_INTERNAL deliberately: reclassifying it clinic-scoped would ' +
      'imply a tenant-visible read surface that does not exist.',
  },
  {
    model: 'RecoveryDrillRun',
    classification: 'SYSTEM_INTERNAL',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'SYSTEM_CONTEXT_ONLY',
    rls: 'NOT_APPLICABLE',
    futureSchemaWork: 'NONE',
    rationale:
      'Restore/recovery drill evidence ledger. Platform operations only; deliberately carries ' +
      'no tenant identifier.',
  },
  {
    model: 'ExternalCalendarIntegration',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'ExternalCalendarMapping',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'ExternalCalendarInboundEvent',
    classification: 'EXPLICIT_REVIEW_REQUIRED',
    organizationIdField: 'organizationId',
    organizationIdNullable: true,
    clinicIdField: 'clinicId',
    clinicIdNullable: true,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'BLOCKED_PENDING_REVIEW',
    rls: 'REQUIRES_DESIGN_REVIEW',
    futureSchemaWork: 'TENANT_OWNERSHIP_DECISION_REQUIRED',
    rationale:
      'Same pre-resolution shape as MessagingInboundEvent: provider webhook rows land with ' +
      'connectionId/clinicId/organizationId all nullable and are only bound to a tenant once ' +
      'the connection is matched.',
  },
  {
    model: 'ExternalCalendarAppointmentLink',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'MigrationRun',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'MigrationRunBatch',
    classification: 'PARENT_SCOPED',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: { relationField: 'run', model: 'MigrationRun', foreignKeyField: 'runId' },
    guardMode: 'PARENT_OWNERSHIP_VALIDATION',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
    rationale:
      'Tenant identity is inherited through run -> MigrationRun. Denormalizing ' +
      'clinicId/organizationId here would add a second, drift-prone source of truth for the ' +
      'same fact.',
  },
  {
    model: 'MigrationFieldMapping',
    classification: 'PARENT_SCOPED',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: { relationField: 'run', model: 'MigrationRun', foreignKeyField: 'runId' },
    guardMode: 'PARENT_OWNERSHIP_VALIDATION',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
    rationale:
      'Tenant identity is inherited through run -> MigrationRun. Denormalizing ' +
      'clinicId/organizationId here would add a second, drift-prone source of truth for the ' +
      'same fact.',
  },
  {
    model: 'MigrationReferenceMap',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'MigrationRecord',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'MigrationRowOutcome',
    classification: 'PARENT_SCOPED',
    organizationIdField: null,
    organizationIdNullable: false,
    clinicIdField: null,
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: { relationField: 'run', model: 'MigrationRun', foreignKeyField: 'runId' },
    guardMode: 'PARENT_OWNERSHIP_VALIDATION',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
    rationale:
      'Tenant identity is inherited through run -> MigrationRun. Denormalizing ' +
      'clinicId/organizationId here would add a second, drift-prone source of truth for the ' +
      'same fact.',
  },
  {
    model: 'MigrationPreservedSourceValue',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'PatientIdentityDocument',
    classification: 'CLINIC_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: false,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_DUAL_KEY',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
  },
  {
    model: 'OutboxEvent',
    classification: 'ORGANIZATION_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: true,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_ORGANIZATION_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
    rationale:
      'F5-2 transactional outbox. TENANT-OWNED, not SYSTEM_INTERNAL — and that is a decision, not ' +
      'a default. It would have been easier to call an infrastructure table system-internal, but ' +
      'every event registered today asserts a fact about ONE organization, its payload references ' +
      'that tenant\'s records, and an operator inspecting a dead-letter backlog must be answering ' +
      '"whose event is this". Classifying it SYSTEM_INTERNAL would make tenant data reachable ' +
      'through a table nobody filters, which is exactly the failure this registry exists to stop. ' +
      'Same shape as AuditLog and OperationalEvent: organizationId NOT NULL is the complete tenant ' +
      'predicate; clinicId is nullable because an ORGANIZATION_OWNED contract legitimately has no ' +
      'single clinic (see outbox/outboxEventRegistry.ts, OutboxEventTenancy), so filtering on it ' +
      'as a second required key would hide organization-level events from their own owner. The ' +
      'DISPATCHER reads across every organization and therefore runs under runAsSystem({ reason: ' +
      '"background-job" }); it narrows to runAsTenant per row before any consumer sees it.',
  },
  {
    model: 'OutboxConsumerExecution',
    classification: 'ORGANIZATION_SCOPED_DIRECT',
    organizationIdField: 'organizationId',
    organizationIdNullable: false,
    clinicIdField: 'clinicId',
    clinicIdNullable: true,
    organizationDerivedVia: null,
    parent: null,
    guardMode: 'AUTO_FILTER_ORGANIZATION_ID',
    rls: 'CANDIDATE',
    futureSchemaWork: 'NONE',
    rationale:
      'F5-2 consumer-side business idempotency ledger. Ownership is copied from the OutboxEvent ' +
      'that produced it and is therefore identical: organizationId NOT NULL, clinicId nullable. ' +
      'It carries no message content — only a consumer key, a business idempotency key, a status ' +
      'and a stable outcome code — but it is still tenant-owned, because "was this obligation ' +
      'already applied for this tenant" is a tenant question and the answer must not be readable ' +
      'across organizations.',
  },
]);

/** Model name -> entry. Built once at module load; no per-call allocation. */
export const TENANT_MODEL_CLASSIFICATION_BY_MODEL: Readonly<Record<string, TenantModelEntry>> =
  Object.freeze(
    Object.fromEntries(TENANT_MODEL_CLASSIFICATION.map((entry) => [entry.model, entry])),
  );

/** Classifications a future guard may treat as having a resolvable tenant owner. */
const TENANT_OWNED_CLASSIFICATIONS: ReadonlySet<TenantClassification> = new Set<TenantClassification>([
  'ORGANIZATION_SCOPED_DIRECT',
  'CLINIC_SCOPED_DIRECT',
  'PARENT_SCOPED',
]);

/** Lookup that tolerates an unknown model. Prefer `requireTenantClassification` in enforcement paths. */
export function getTenantClassification(model: string): TenantModelEntry | undefined {
  return TENANT_MODEL_CLASSIFICATION_BY_MODEL[model];
}

/**
 * Fail-closed lookup. An unclassified model is a defect, not a global table —
 * throwing here is what stops a future guard from silently letting an unknown
 * model through unfiltered.
 */
export function requireTenantClassification(model: string): TenantModelEntry {
  const entry = TENANT_MODEL_CLASSIFICATION_BY_MODEL[model];
  if (!entry) {
    throw new Error(
      `Prisma model "${model}" has no tenant classification. Add it to ` +
        'TENANT_MODEL_CLASSIFICATION (utils/tenantModelClassification.ts) before using it ' +
        'in a tenant-scoped path. An unclassified model is never assumed to be global.',
    );
  }
  return entry;
}

/**
 * True when the model has a resolvable tenant owner, i.e. a future F3-2 guard
 * is expected to apply a tenant constraint to it. False for PLATFORM_GLOBAL and
 * SYSTEM_INTERNAL (deliberately unscoped) and for EXPLICIT_REVIEW_REQUIRED
 * (undecided — fail closed, never guard-by-guess).
 */
export function isTenantGuardApplicable(model: string): boolean {
  return TENANT_OWNED_CLASSIFICATIONS.has(requireTenantClassification(model).classification);
}

/**
 * Guard-side gate for F3-2. Throws for a model whose ownership is still
 * unresolved so that an ambiguous table can never be handled as tenant-safe by
 * accident. Callers that legitimately need such a model must reach it through
 * an explicit system/platform context, not through tenant-scoped access.
 */
export function assertTenantOwnershipResolved(model: string): TenantModelEntry {
  const entry = requireTenantClassification(model);
  if (entry.classification === 'EXPLICIT_REVIEW_REQUIRED') {
    throw new Error(
      `Prisma model "${model}" is classified EXPLICIT_REVIEW_REQUIRED: its tenant ownership is ` +
        'undecided and it must not be treated as tenant-safe. Resolve the classification ' +
        '(utils/tenantModelClassification.ts) before adding tenant-scoped access.',
    );
  }
  return entry;
}

/** Every model whose ownership is still an open question. Reported loudly by the F3-1 test suite. */
export function modelsRequiringExplicitReview(): readonly TenantModelEntry[] {
  return TENANT_MODEL_CLASSIFICATION.filter((e) => e.classification === 'EXPLICIT_REVIEW_REQUIRED');
}

/**
 * Models that are expected to need schema work in a LATER task. F3-1 changes
 * no schema and creates no migration; this is the recorded backlog.
 */
export function modelsRequiringFutureSchemaWork(): readonly TenantModelEntry[] {
  return TENANT_MODEL_CLASSIFICATION.filter((e) => e.futureSchemaWork !== 'NONE');
}

/** Count of models per classification. Computed, never hand-maintained. */
export function tenantClassificationCounts(): Readonly<Record<TenantClassification, number>> {
  const counts: Record<TenantClassification, number> = {
    ORGANIZATION_SCOPED_DIRECT: 0,
    CLINIC_SCOPED_DIRECT: 0,
    PARENT_SCOPED: 0,
    PLATFORM_GLOBAL: 0,
    SYSTEM_INTERNAL: 0,
    EXPLICIT_REVIEW_REQUIRED: 0,
  };
  for (const entry of TENANT_MODEL_CLASSIFICATION) counts[entry.classification] += 1;
  return counts;
}
