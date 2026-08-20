/**
 * clinicBulkExportFieldAllowlists.ts — KVKK-HIGH-004 explicit, versioned
 * export data contract.
 *
 * Every entity exported by clinicBulkExportPackage.ts uses an explicit
 * Prisma `select` from this module — never a bare `findMany` that would
 * serialize every column a model happens to have. This is what guarantees
 * secret/credential fields (passwordHash, session/reset/verification
 * tokens, encrypted provider credentials, API keys, OAuth tokens, webhook
 * secrets, provider credentials, platform-admin secrets, storage
 * credentials) can never appear in an export, and is directly assertable in
 * tests (construct a row with every field populated, run it through the
 * select, assert the denylisted keys are absent from the result).
 */

import type { Prisma } from '@prisma/client';

export const CLINIC_SELECT = {
  id: true,
  name: true,
  legalName: true,
  address: true,
  phone: true,
  email: true,
  website: true,
  timezone: true,
  currency: true,
  defaultLanguage: true,
  slug: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ClinicSelect;

/** Deliberately excludes passwordHash, passwordChangedAt, and every session-related field. */
export const USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export const PATIENT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  dateOfBirth: true,
  address: true,
  city: true,
  // F3-DATA-MIG-TODAY-001-R10. District (ilçe) — the other half of the
  // address the clinic already sees and edits in the patient UI, alongside
  // `city` (province/il) above. Omitting it would hand the clinic back an
  // address that silently lost a line.
  district: true,
  postalCode: true,
  country: true,
  patientStatus: true,
  source: true,
  notes: true,
  // F3-DATA-MIG-TODAY-001 (G-E5/G-E6). Clinic-owned patient data the exporting
  // clinic already sees in the UI; a bulk export that silently dropped them
  // would be an incomplete data contract.
  gender: true,
  chartNumber: true,
  // F3-DATA-MIG-TODAY-001-R8. Clinic-owned clinical data the exporting clinic
  // already sees on the patient record; omitting it would hand back an
  // incomplete copy of the clinic's own chart.
  bloodGroup: true,
  // primaryPractitionerId (G-E3) is deliberately NOT exported: it is a STAFF
  // foreign key, not patient data, and no consumer of this export package
  // reads it today. Add it only alongside a consumer that needs it.
  communicationConsent: true,
  marketingConsent: true,
  smsOptOut: true,
  smsOptOutAt: true,
  primaryClinicId: true,
  isAnonymized: true,
  anonymizedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PatientSelect;

/**
 * F3-DATA-MIG-TODAY-001-R10 — PatientContactPoint (secondary patient phone
 * numbers: home/work/other).
 *
 * Clinic-owned patient contact data the exporting clinic already sees on the
 * patient record, so it belongs in the clinic's own copy exactly as
 * `Patient.phone` does. `patientId` IS exported (unlike on PATIENT_SELECT,
 * where the tenant keys are the constant-per-row ones) because it is the join
 * key that makes patient-contact-points.ndjson usable at all.
 *
 * `clinicId`/`organizationId` are deliberately absent: the export is already
 * per-clinic, so both would be a constant in every row — the same reasoning
 * recorded in BULK_EXPORT_EXEMPT for Patient.
 */
export const PATIENT_CONTACT_POINT_SELECT = {
  id: true,
  patientId: true,
  contactType: true,
  value: true,
  normalizedValue: true,
  label: true,
  source: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PatientContactPointSelect;

/**
 * F3-DATA-MIG-TODAY-001-R10 — MigrationPreservedSourceValue (legacy source
 * values preserved verbatim with provenance during a migration).
 *
 * Exported because it is the clinic's OWN historical record, carried over
 * from the system it migrated off; a bulk export that dropped it would hand
 * back a copy missing everything the previous vendor held. The provenance
 * columns (sourceSystem/sourceColumn/sourceRowNumber/importedAt) travel with
 * the value on purpose — a preserved value without its provenance is an
 * unattributed string, which is exactly what this model exists to avoid.
 *
 * `migrationRunId` is deliberately NOT exported: it is an internal
 * platform-side run identifier with no meaning outside this deployment, and
 * no consumer of the export package resolves it.
 *
 * `sensitivity` is exported, but note it is ALSO a filter: the export stream
 * in clinicBulkExportPackage.ts selects rows with sensitivity 'NORMAL' only.
 * RESTRICTED rows never enter this file. The column is carried so a consumer
 * can see the classification of what it did receive, not so it can do the
 * filtering itself.
 */
export const MIGRATION_PRESERVED_SOURCE_VALUE_SELECT = {
  id: true,
  patientId: true,
  sourceSystem: true,
  sourceColumn: true,
  sourceRowNumber: true,
  value: true,
  valueType: true,
  semanticClass: true,
  sensitivity: true,
  importedAt: true,
} satisfies Prisma.MigrationPreservedSourceValueSelect;

export const APPOINTMENT_SELECT = {
  id: true,
  patientId: true,
  practitionerId: true,
  appointmentTypeId: true,
  title: true,
  startTime: true,
  endTime: true,
  status: true,
  notes: true,
  cancellationReason: true,
  noShowReason: true,
  treatmentCaseId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AppointmentSelect;

export const TREATMENT_CASE_SELECT = {
  id: true,
  patientId: true,
  practitionerId: true,
  appointmentTypeId: true,
  title: true,
  description: true,
  stage: true,
  estimatedAmount: true,
  acceptedAmount: true,
  currency: true,
  expectedStartDate: true,
  closedAt: true,
  lostReason: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TreatmentCaseSelect;

export const PAYMENT_SELECT = {
  id: true,
  patientId: true,
  treatmentCaseId: true,
  amount: true,
  currency: true,
  paymentMethod: true,
  paymentStatus: true,
  paidAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PaymentSelect;

export const TASK_SELECT = {
  id: true,
  patientId: true,
  treatmentCaseId: true,
  appointmentId: true,
  assignedToId: true,
  title: true,
  description: true,
  dueDate: true,
  status: true,
  priority: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TaskSelect;

export const SENT_MESSAGE_SELECT = {
  id: true,
  patientId: true,
  appointmentId: true,
  treatmentCaseId: true,
  paymentId: true,
  channel: true,
  recipient: true,
  subject: true,
  body: true,
  status: true,
  sentAt: true,
  provider: true,
  direction: true,
  createdAt: true,
} satisfies Prisma.SentMessageSelect;

export const ACTIVITY_LOG_SELECT = {
  id: true,
  userId: true,
  entityType: true,
  entityId: true,
  patientId: true,
  appointmentId: true,
  treatmentCaseId: true,
  insuranceProvisionId: true,
  action: true,
  description: true,
  createdAt: true,
} satisfies Prisma.ActivityLogSelect;

export const INSURANCE_PROVISION_SELECT = {
  id: true,
  patientId: true,
  treatmentCaseId: true,
  insuranceProviderName: true,
  insuranceType: true,
  policyNumber: true,
  provisionNumber: true,
  status: true,
  requestedAmount: true,
  approvedAmount: true,
  patientResponsibilityAmount: true,
  currency: true,
  submittedAt: true,
  respondedAt: true,
  rejectionReason: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.InsuranceProvisionSelect;

export const INVENTORY_ITEM_SELECT = {
  id: true,
  name: true,
  category: true,
  unit: true,
  currentStock: true,
  minimumStock: true,
  unitCost: true,
  supplier: true,
  barcode: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.InventoryItemSelect;

/** Fields that must never appear in any exported entity, checked directly in tests. */
export const DENYLISTED_FIELD_NAMES = [
  'passwordHash',
  'passwordChangedAt',
  'sessionId',
  'jti',
  'token',
  'tokenHash',
  'accessToken',
  'refreshToken',
  'apiKey',
  'apiSecret',
  'webhookSecret',
  'encryptedCredentials',
  'clientSecret',
  // F3-DATA-MIG-003 / G-E4 — PatientIdentityDocument columns. The clinic bulk
  // export deliberately carries NO identity-document stream today; adding one
  // is a separate, larger change to the export package (it needs its own
  // decryption, its own consent/scope review and its own manifest entry).
  // These three entries make it structurally impossible for a future edit to
  // bolt an identity stream onto an existing select and leak the AES-GCM
  // ciphertext ('valueEncrypted'), the tenant-bound HMAC correlation token
  // ('lookupHash') or its key generation ('cryptoVersion') — the existing
  // "every entity SELECT excludes every denylisted field name" test fails the
  // moment such a select appears.
  'valueEncrypted',
  'lookupHash',
  'cryptoVersion',
] as const;
