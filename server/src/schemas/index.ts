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
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  dateOfBirth: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
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

export const patientSchema = patientBaseSchema.refine(data => data.email || data.phone, {
  message: 'Either email or phone must be provided',
  path: ['email'],
});

export const patientUpdateSchema = patientBaseSchema.partial().refine(data => {
  if ('email' in data || 'phone' in data) {
    return Boolean(data.email || data.phone);
  }
  return true;
}, {
  message: 'Either email or phone must be provided',
  path: ['email'],
});

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
  patientId: z.string().uuid('Invalid patient ID'),
  practitionerId: z.string().uuid('Invalid practitioner ID'),
  appointmentTypeId: z.string().uuid('Invalid appointment type ID'),
  startTime: dateTimeSchema,
  endTime: dateTimeSchema,
  status: appointmentStatusEnum.default('scheduled'),
  notes: z.string().optional().nullable(),
  treatmentCaseId: z.string().uuid().optional().nullable(),
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

export const taskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional().nullable(),
  patientId: z.string().uuid().optional().nullable(),
  appointmentId: z.string().uuid().optional().nullable(),
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
  treatmentCaseId: z.string().uuid().optional().nullable(),
  amount: z.number().positive('Amount must be positive'),
  currency: z.enum(validCurrencies).optional(),
  paymentMethod: z.enum(['cash', 'card', 'bank_transfer', 'cheque', 'other']),
  paymentStatus: z.enum(['pending', 'partial', 'paid', 'refunded', 'cancelled']).default('paid'),
  paidAt: z.string().optional().nullable().transform(val => val ? new Date(val) : new Date()),
  notes: z.string().optional().nullable(),
});

// --- Message Template ---

export const messageTemplateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  channel: z.enum(['sms', 'whatsapp', 'email']),
  subject: z.string().optional().nullable(),
  body: z.string().min(1, 'Body is required'),
  language: z.enum(['en', 'fr', 'tr']),
  isActive: z.boolean().default(true),
});

export const prepareMessageSchema = z.object({
  templateId: z.string().uuid('Invalid template ID').optional().nullable(),
  patientId: z.string().uuid('Invalid patient ID'),
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
