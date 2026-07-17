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
  postalCode: true,
  country: true,
  patientStatus: true,
  source: true,
  notes: true,
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
] as const;
