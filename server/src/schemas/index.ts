import { z } from 'zod';
import { timeToMinutes } from '../utils/helpers.js';

export const validCurrencies = ['USD', 'EUR', 'TRY', 'GBP', 'CAD', 'CHF'] as const;
export const insuranceTypes = ['sgk', 'tss', 'oss', 'private', 'corporate', 'other'] as const;
export const insuranceStatuses = [
  'draft',
  'pending_documents',
  'submitted',
  'waiting_response',
  'approved',
  'partially_approved',
  'rejected',
  'cancelled',
] as const;

export const optionalUuid = z.preprocess(
  value => value === '' ? null : value,
  z.string().uuid().optional().nullable(),
);

// --- Patient ---

const patientBaseSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.preprocess(value => value === '' ? null : value, z.string().email().optional().nullable()),
  phone: z.string().optional().nullable(),
  dateOfBirth: z.string().optional().nullable().refine(val => !val || new Date(val) <= new Date(), { message: 'Date of birth cannot be in the future' }).transform(val => val ? new Date(val) : null),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  patientStatus: z.enum(['new', 'active', 'inactive', 'archived']).default('new'),
  source: z.enum(['google', 'referral', 'social_media', 'instagram', 'website', 'phone', 'walk_in', 'doctolib', 'other']).optional().nullable(),
  notes: z.string().optional().nullable(),
  communicationConsent: z.boolean().default(false),
  marketingConsent: z.boolean().default(false),
});

export const patientSchema = patientBaseSchema;

export const patientUpdateSchema = patientBaseSchema.partial();

// --- Appointment Type / Service ---

export const appointmentTypeSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  durationMinutes: z.number().int().positive('Duration must be a positive integer'),
  color: z.string().regex(/^#[0-9A-F]{6}$/i, 'Color must be a valid hex code').optional().nullable(),
  isActive: z.boolean().default(true),
  category: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  basePrice: z.number().nonnegative('Price must be non-negative').optional().nullable(),
  currency: z.enum(validCurrencies).optional().nullable(),
  isService: z.boolean().default(true),
});

const nullableTrimmedString = (max: number) => z.preprocess(
  value => value === '' ? null : value,
  z.string().trim().max(max).optional().nullable(),
);

const optionalNonNegativeNumber = z.preprocess(
  value => value === '' ? null : value,
  z.coerce.number().nonnegative().optional().nullable(),
);

const optionalPositiveInt = z.preprocess(
  value => value === '' ? null : value,
  z.coerce.number().int().positive().optional().nullable(),
);

export const materialRecipeSchema = z.object({
  inventoryItemId: z.string().uuid('Invalid inventory item ID'),
  quantity: z.coerce.number().positive('Quantity must be positive'),
  unit: nullableTrimmedString(50),
  deductionTiming: z.enum(['ON_TREATMENT_COMPLETED']).default('ON_TREATMENT_COMPLETED'),
  isOptional: z.boolean().default(false),
  note: nullableTrimmedString(500),
});

export const treatmentPackageItemSchema = z.object({
  serviceId: z.string().uuid('Invalid service ID'),
  quantity: z.coerce.number().int().positive().max(100).default(1),
  sortOrder: z.coerce.number().int().min(0).default(0),
  overridePrice: optionalNonNegativeNumber,
  overrideDurationMin: optionalPositiveInt,
});

export const treatmentPackageSchema = z.object({
  clinicId: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: nullableTrimmedString(1000),
  category: nullableTrimmedString(80),
  color: z.string().regex(/^#[0-9A-F]{6}$/i, 'Color must be a valid hex code').optional().nullable(),
  durationMinutes: optionalPositiveInt,
  price: optionalNonNegativeNumber,
  currency: z.enum(validCurrencies).optional().nullable(),
  pricingMode: z.enum(['PACKAGE_PRICE', 'SERVICE_SUM']).default('PACKAGE_PRICE'),
  isActive: z.boolean().default(true),
  items: z.array(treatmentPackageItemSchema).min(1, 'At least one service is required').max(100),
  materials: z.array(materialRecipeSchema).max(100).default([]),
});

export const treatmentPackageUpdateSchema = treatmentPackageSchema.partial().extend({
  items: z.array(treatmentPackageItemSchema).min(1, 'At least one service is required').max(100).optional(),
  materials: z.array(materialRecipeSchema).max(100).optional(),
});

// --- User ---

const userBaseSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Valid email is required'),
  phone: z.string().optional().nullable(),
  role: z.enum(['admin', 'doctor', 'receptionist', 'billing']),
  isActive: z.boolean().default(true),
});

export const userCreateSchema = userBaseSchema.extend({
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const userUpdateSchema = userBaseSchema.partial().extend({
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
});

// --- Doctor Availability ---

const timeStringSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must use HH:mm format');

export const availabilitySlotSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: timeStringSchema,
  endTime: timeStringSchema,
  isActive: z.boolean().default(true),
}).refine(data => timeToMinutes(data.endTime) > timeToMinutes(data.startTime), {
  message: 'End time must be after start time',
  path: ['endTime'],
});

export const availabilityBatchSchema = z.object({
  slots: z.array(availabilitySlotSchema).max(28),
});

// --- Doctor Off Day ---

export const doctorOffDaySchema = z.object({
  practitionerId: z.string().uuid('Invalid practitioner ID'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  reason: z.string().max(255).optional().nullable(),
});

// --- Appointment ---

const dateTimeSchema = z.string().min(1, 'Date/time is required').transform((value, ctx) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid date/time',
    });
    return z.NEVER;
  }

  return date;
});

const appointmentStatusEnum = z.enum([
  'scheduled',
  'confirmed',
  'completed',
  'cancelled',
  'rescheduled',
  'no_show',
]);

const appointmentBaseSchema = z.object({
  patientId: z.string().min(1, 'Invalid patient ID'),
  practitionerId: z.string().min(1, 'Invalid practitioner ID'),
  appointmentTypeId: z.string().min(1, 'Invalid appointment type ID'),
  startTime: dateTimeSchema,
  endTime: dateTimeSchema,
  status: appointmentStatusEnum.default('scheduled'),
  notes: z.string().optional().nullable(),
  treatmentCaseId: z.string().min(1).optional().nullable(),
});

export const appointmentSchema = appointmentBaseSchema.refine(data => data.endTime > data.startTime, {
  message: 'End time must be after start time',
  path: ['endTime'],
});

export const appointmentUpdateSchema = appointmentBaseSchema.partial().refine(data => {
  if (data.startTime && data.endTime) return data.endTime > data.startTime;
  return true;
}, {
  message: 'End time must be after start time',
  path: ['endTime'],
});

// --- Task ---

const normalizeEmptyUuid = (val: unknown) => (!val || val === '' ? null : val);

export const taskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional().nullable(),
  patientId: z.preprocess(normalizeEmptyUuid, z.string().uuid().optional().nullable()),
  appointmentId: z.preprocess(normalizeEmptyUuid, z.string().uuid().optional().nullable()),
  assignedToId: z.string().uuid('Invalid assignee ID'),
  dueDate: z.string().transform(val => new Date(val)),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  status: z.enum(['open', 'in_progress', 'completed', 'cancelled']).default('open'),
});

// --- Treatment Case ---

export const treatmentCaseSchema = z.object({
  patientId: z.string().uuid('Invalid patient ID'),
  practitionerId: optionalUuid,
  appointmentTypeId: optionalUuid,
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional().nullable(),
  stage: z.enum([
    'new',
    'consultation_scheduled',
    'consultation_done',
    'quote_sent',
    'waiting_patient_decision',
    'accepted',
    'in_progress',
    'completed',
    'lost',
  ]).default('new'),
  estimatedAmount: z.number().nonnegative().optional().nullable(),
  acceptedAmount: z.number().nonnegative().optional().nullable(),
  currency: z.enum(validCurrencies).optional(),
  expectedStartDate: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
  lostReason: z.string().optional().nullable(),
});

// --- Insurance Provision ---

const insuranceProvisionBaseSchema = z.object({
  patientId: z.string().uuid('Invalid patient ID'),
  treatmentCaseId: optionalUuid,
  insuranceProviderName: z.string().min(1, 'Insurance provider is required'),
  insuranceType: z.enum(insuranceTypes),
  policyNumber: z.string().optional().nullable(),
  provisionNumber: z.string().optional().nullable(),
  status: z.enum(insuranceStatuses).default('draft'),
  requestedAmount: z.number().nonnegative('Requested amount must be non-negative'),
  approvedAmount: z.number().nonnegative('Approved amount must be non-negative').optional().nullable(),
  patientResponsibilityAmount: z.number().nonnegative('Patient responsibility amount must be non-negative').optional().nullable(),
  currency: z.enum(validCurrencies).optional(),
  submittedAt: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
  respondedAt: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
  rejectionReason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  assignedToId: optionalUuid,
});

export const insuranceProvisionSchema = insuranceProvisionBaseSchema.refine(
  data => data.status !== 'rejected' || Boolean(data.rejectionReason?.trim()),
  { message: 'Rejection reason is required when status is rejected', path: ['rejectionReason'] },
);

export const insuranceProvisionUpdateSchema = insuranceProvisionBaseSchema.partial().refine(
  data => data.status !== 'rejected' || Boolean(data.rejectionReason?.trim()),
  { message: 'Rejection reason is required when status is rejected', path: ['rejectionReason'] },
);

export const insuranceStatusSchema = z.object({
  status: z.enum(insuranceStatuses),
  rejectionReason: z.string().optional().nullable(),
  approvedAmount: z.number().nonnegative().optional().nullable(),
  patientResponsibilityAmount: z.number().nonnegative().optional().nullable(),
  provisionNumber: z.string().optional().nullable(),
  respondedAt: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
  notes: z.string().optional().nullable(),
}).refine(
  data => data.status !== 'rejected' || Boolean(data.rejectionReason?.trim()),
  { message: 'Rejection reason is required when status is rejected', path: ['rejectionReason'] },
);

// --- Payment ---

export const paymentSchema = z.object({
  patientId: z.string().uuid('Invalid patient ID'),
  treatmentCaseId: z.preprocess(normalizeEmptyUuid, z.string().uuid().optional().nullable()),
  amount: z.number().positive('Amount must be positive'),
  currency: z.enum(validCurrencies).optional(),
  paymentMethod: z.enum(['cash', 'card', 'bank_transfer', 'cheque', 'other']),
  paymentStatus: z.enum(['pending', 'partial', 'paid', 'refunded', 'cancelled']).default('paid'),
  paidAt: z.string().optional().nullable().transform(val => val ? new Date(val) : new Date()),
  notes: z.string().optional().nullable(),
});

// --- Message Template ---

export const MESSAGE_TEMPLATE_PURPOSES = [
  'appointment_reminder',
  'payment_reminder',
  'appointment_confirmation',
  'appointment_cancellation',
  'appointment_reschedule',
  'no_show_recovery',
  'post_treatment_followup',
  'marketing',
  'general_message',
] as const;

export type MessageTemplatePurpose = typeof MESSAGE_TEMPLATE_PURPOSES[number];

export const messageTemplateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  channel: z.enum(['sms', 'whatsapp', 'email']),
  subject: z.string().optional().nullable(),
  body: z.string().min(1, 'Body is required'),
  language: z.enum(['en', 'fr', 'tr', 'de']),
  isActive: z.boolean().default(true),
  purpose: z.enum(MESSAGE_TEMPLATE_PURPOSES).default('general_message'),
});

// --- SMS Add-on Module ---

export const SMS_SEND_PURPOSES = [
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancellation',
  'appointment_reschedule',
  'no_show_recovery',
  'post_treatment_followup',
  'manual_message',
  'payment_reminder',
  'marketing',
] as const;

/// Platform admin upsert of a platform-level SMS provider (per region).
/// credentials: omitted or empty = keep the stored encrypted value; an object
/// with keys = replace the stored encrypted value entirely.
export const platformSmsProviderSchema = z.object({
  region: z.enum(['tr', 'eu']),
  providerCode: z.string().min(1).max(50).regex(/^[a-z0-9_]+$/, 'providerCode must be a lowercase slug'),
  displayName: z.string().min(1).max(100),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  senderName: z.string().max(20).optional().nullable(),
  credentials: z.record(z.string(), z.unknown()).optional().nullable(),
});

/// Platform admin "preview routing" tool: given a sample phone number, show
/// which region/provider a real send would resolve to (no send, no secrets).
export const smsRoutingPreviewSchema = z.object({
  phone: z.string().min(1, 'Phone number is required'),
});

export const smsSendSchema = z.object({
  patientId: z.string().min(1, 'Patient ID is required'),
  clinicId: z.string().min(1).optional().nullable(),
  appointmentId: z.string().min(1).optional().nullable(),
  templateId: z.string().min(1).optional().nullable(),
  purpose: z.enum(SMS_SEND_PURPOSES).default('manual_message'),
  body: z.string().max(1000).optional().nullable(),
}).refine(data => Boolean(data.body?.trim()) || Boolean(data.templateId), {
  message: 'Either body or templateId is required',
  path: ['body'],
});

export const prepareMessageSchema = z.object({
  templateId: z.string().uuid('Invalid template ID').optional().nullable(),
  patientId: z.string().uuid('Invalid patient ID'),
  clinicId: z.string().uuid('Invalid clinic ID').optional().nullable(),
  appointmentId: z.string().uuid().optional().nullable(),
  treatmentCaseId: z.string().uuid().optional().nullable(),
  paymentId: z.string().uuid().optional().nullable(),
  channelOverride: z.enum(['sms', 'whatsapp', 'email']).optional().nullable(),
  customSubject: z.string().optional().nullable(),
  customBody: z.string().optional().nullable(),
});

// --- Appointment Request ---

export const appointmentRequestStatusSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'closed']),
  notes: z.string().optional().nullable(),
  rejectionReason: z.string().optional().nullable(),
}).refine(
  data => data.status !== 'rejected' || Boolean(data.rejectionReason?.trim()),
  { message: 'Rejection reason is required when status is rejected', path: ['rejectionReason'] },
);

export const appointmentRequestConvertSchema = z.object({
  patientId: optionalUuid,
  appointmentTypeId: z.string().uuid('Invalid appointment type ID').optional(),
  practitionerId: z.string().uuid('Invalid practitioner ID').optional(),
  startTime: z.string().optional().transform(val => val ? new Date(val) : undefined),
  endTime: z.string().optional().transform(val => val ? new Date(val) : undefined),
  notes: z.string().optional().nullable(),
}).refine(data => {
  if (data.startTime && data.endTime) return data.endTime > data.startTime;
  return true;
}, {
  message: 'End time must be after start time',
  path: ['endTime'],
});

export const appointmentRequestUpdateSchema = z.object({
  appointmentTypeId: z.string().uuid('Invalid appointment type ID').nullable().optional(),
  practitionerId: z.string().uuid('Invalid practitioner ID').nullable().optional(),
  preferredStartTime: z.string().nullable().optional(),
  preferredEndTime: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

// --- Practitioner Compensation Rule ---

export const compensationTypeEnum = z.enum(['fixed', 'percentage', 'fixed_plus_percentage', 'per_service']);
export const calculationBaseEnum = z.enum(['billed', 'collected']);

export const practitionerCompensationRuleSchema = z.object({
  practitionerId: z.string().uuid('Invalid practitioner ID'),
  compensationType: compensationTypeEnum.default('percentage'),
  fixedMonthlyAmount: z.number().nonnegative().optional().nullable(),
  defaultPercentage: z.number().min(0).max(100).optional().nullable(),
  calculationBase: calculationBaseEnum.default('collected'),
  startDate: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
  endDate: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
  isActive: z.boolean().default(true),
});

// --- Service Compensation Rule ---

export const serviceCompensationRuleSchema = z.object({
  practitionerId: z.string().uuid('Invalid practitioner ID'),
  serviceId: z.string().uuid('Invalid service ID'),
  percentage: z.number().min(0).max(100).optional().nullable(),
  fixedAmount: z.number().nonnegative().optional().nullable(),
  isActive: z.boolean().default(true),
});

// --- Practitioner Earning adjustment ---

export const earningAdjustSchema = z.object({
  adminAdjustmentAmount: z.number().nonnegative('Adjustment amount must be non-negative'),
  adminAdjustmentReason: z.string().min(1, 'Reason is required for adjustment'),
});

// --- Practitioner Payout ---

export const practitionerPayoutSchema = z.object({
  practitionerId: z.string().uuid('Invalid practitioner ID'),
  amount: z.number().positive('Amount must be positive'),
  paymentDate: z.string().transform(val => new Date(val)),
  periodMonth: z.number().int().min(1).max(12),
  periodYear: z.number().int().min(2020).max(2100),
  method: z.enum(['cash', 'bank_transfer', 'card', 'other']).default('bank_transfer'),
  note: z.string().optional().nullable(),
  earningIds: z.array(z.string().uuid()).optional().default([]),
});

// --- Dental Laboratory Tracking ---

export const LAB_WORK_ORDER_STATUSES = [
  'pending',
  'impression_taken',
  'sent_to_lab',
  'in_progress',
  'received_from_lab',
  'fitting_or_trial',
  'revision_requested',
  'completed',
  'cancelled',
] as const;

export const LAB_WORK_TYPES = [
  'crown',
  'bridge',
  'denture_full',
  'denture_partial',
  'implant_prosthetic',
  'night_guard',
  'aligner',
  'retainer',
  'repair',
  'temp_prosthetic',
  'other',
] as const;

export const laboratorySchema = z.object({
  name: z.string().min(1, 'Laboratory name is required'),
  contactPerson: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.preprocess(value => value === '' ? null : value, z.string().email().optional().nullable()),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
});

export const laboratoryUpdateSchema = laboratorySchema.partial();

export const labWorkOrderSchema = z.object({
  patientId: z.string().uuid('Invalid patient ID'),
  laboratoryId: z.string().uuid('Invalid laboratory ID'),
  treatmentCaseId: optionalUuid,
  practitionerId: optionalUuid,
  workType: z.enum(LAB_WORK_TYPES),
  toothFdi: z.string().optional().nullable(),
  shade: z.string().optional().nullable(),
  material: z.string().optional().nullable(),
  notesForLab: z.string().optional().nullable(),
  notesInternal: z.string().optional().nullable(),
  expectedReturnDate: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
  labCost: z.number().nonnegative('Lab cost must be non-negative').optional().nullable(),
  currency: z.enum(validCurrencies).optional().nullable(),
});

// patientId is immutable after creation — never accept it on the generic update payload.
export const labWorkOrderUpdateSchema = labWorkOrderSchema.omit({ patientId: true }).partial();

export const labWorkOrderStatusUpdateSchema = z.object({
  status: z.enum(LAB_WORK_ORDER_STATUSES),
  note: z.string().optional().nullable(),
  // Set when a transition (e.g. a remake loop-back into sent_to_lab) needs a new target date.
  newExpectedReturnDate: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
  cancelReason: z.string().optional().nullable(),
});

// --- Imaging / Device Integration Foundation (Phase 1) ---

// DICOM'dan esinlenen modality kodları (IO: intraoral sensör, PX: panoramik,
// CT: CBCT, CEPH: sefalometrik, IO_CAMERA: ağız içi kamera, SCANNER: tarayıcı).
export const IMAGING_MODALITIES = [
  'IO',
  'PX',
  'CT',
  'CEPH',
  'IO_CAMERA',
  'SCANNER',
  'OTHER',
] as const;

export const IMAGING_REQUEST_STATUSES = [
  'requested',
  'scheduled',
  'received',
  'cancelled',
  'failed',
] as const;

export const IMAGING_REQUEST_PRIORITIES = ['routine', 'urgent'] as const;

export const IMAGING_DEVICE_CONNECTION_TYPES = ['manual', 'bridge', 'dicomweb'] as const;

// İlişki ID'leri UUID'ye zorlanmaz (demo/prod'da UUID olmayan ID'ler var —
// bkz. appointmentBaseSchema); varlık ve klinik aidiyeti relationGuards ile
// route katmanında doğrulanır.
const optionalId = z.preprocess(
  value => (value === '' || value === null ? undefined : value),
  z.string().min(1).optional(),
);

export const imagingDeviceSchema = z.object({
  name: z.string().min(1, 'Device name is required').max(200),
  modality: z.enum(IMAGING_MODALITIES),
  manufacturer: z.string().max(200).optional().nullable(),
  modelName: z.string().max(200).optional().nullable(),
  // Phase 1 yalnızca manuel yüklemeyi destekler; bridge/dicomweb kayıtları
  // ileride köprü/PACS entegrasyonu geldiğinde kullanılacak.
  connectionType: z.enum(IMAGING_DEVICE_CONNECTION_TYPES).default('manual'),
  isActive: z.boolean().default(true),
  notes: z.string().max(2000).optional().nullable(),
  clinicId: optionalId,
});

export const imagingDeviceUpdateSchema = imagingDeviceSchema.omit({ clinicId: true }).partial();

export const imagingRequestSchema = z.object({
  patientId: z.string().min(1, 'Patient is required'),
  appointmentId: optionalId,
  treatmentCaseId: optionalId,
  requestedModality: z.enum(IMAGING_MODALITIES),
  requestedDeviceId: optionalId,
  priority: z.enum(IMAGING_REQUEST_PRIORITIES).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  clinicId: optionalId,
});

// patientId is immutable after creation — link corrections go through the
// study link/unlink endpoints, not the request.
export const imagingRequestUpdateSchema = z.object({
  appointmentId: optionalId,
  treatmentCaseId: optionalId,
  requestedModality: z.enum(IMAGING_MODALITIES).optional(),
  requestedDeviceId: optionalId,
  status: z.enum(IMAGING_REQUEST_STATUSES).optional(),
  priority: z.enum(IMAGING_REQUEST_PRIORITIES).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export const imagingStudyUploadSchema = z.object({
  patientId: optionalId,
  appointmentId: optionalId,
  treatmentCaseId: optionalId,
  deviceId: optionalId,
  imagingRequestId: optionalId,
  modality: z.enum(IMAGING_MODALITIES),
  description: z.string().max(2000).optional().nullable(),
  studyDate: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
  clinicId: optionalId,
});

export const imagingStudyLinkSchema = z.object({
  patientId: z.string().min(1, 'Patient is required'),
  appointmentId: optionalId,
  treatmentCaseId: optionalId,
});

// Köprü (bridge) ajanı kaydı — token istemciden gelmez, sunucu üretir.
export const imagingBridgeSchema = z.object({
  name: z.string().min(1, 'Bridge name is required').max(200),
  clinicId: optionalId,
});

// Public heartbeat gövdesi — bilinçli olarak minimal: cihaz/istemci teşhis
// alanları kabul edilir, PHI/PII veya serbest metin alanı kabul edilmez.
export const imagingBridgeHeartbeatSchema = z.object({
  agentVersion: z.string().max(100).optional(),
  osVersion: z.string().max(200).optional(),
  architecture: z.string().max(50).optional(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
  pendingCount: z.number().int().min(0).max(1_000_000).optional(),
  failedCount: z.number().int().min(0).max(1_000_000).optional(),
  lastSuccessfulUploadAt: z.string().optional().nullable(),
  lastErrorCategory: z.string().max(100).optional().nullable(),
});

// Eşleştirme (pairing) oturumu oluşturma — Ayarlar > Görüntüleme > Cihaz Bağla.
export const imagingBridgePairingCreateSchema = z.object({
  bridgeName: z.string().min(1, 'Bridge name is required').max(200),
  deviceIds: z.array(z.string().min(1)).min(1, 'At least one device is required').max(50),
  clinicId: optionalId,
});

// Public eşleştirme kodu çözümleme (Windows Manager uygulaması). Serbest metin
// veya PHI/PII alanı YOK — yalnızca istemci/işletim sistemi teşhis bilgisi.
export const imagingBridgePublicPairSchema = z.object({
  code: z.string().min(1).max(32),
  installationId: z.string().min(1).max(200),
  machineIdHash: z.string().max(200).optional().nullable(),
  computerDisplayName: z.string().max(200).optional().nullable(),
  agentVersion: z.string().min(1).max(100),
  osVersion: z.string().max(200).optional().nullable(),
  architecture: z.string().max(50).optional().nullable(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
});

// Köprü (bridge) çalışma yükleme gövdesi — bilinçli olarak minimal: hasta
// adı/telefonu/serbest metin YOK. ingestKey sunucuda yeniden hesaplanan
// sha256 ile karşılaştırılır (routes/imagingBridgePublic.ts); burada yalnızca
// biçim (tam 64 küçük harf hex) doğrulanır.
export const imagingBridgeStudyUploadSchema = z.object({
  ingestKey: z.string().regex(/^[a-f0-9]{64}$/, 'ingestKey must be a 64-character lowercase hex sha256 digest'),
  deviceId: optionalId,
  modality: z.enum(IMAGING_MODALITIES).optional(),
  studyDate: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
  imagingRequestId: optionalId,
});
