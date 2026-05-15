import express, { Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { authenticate, authorize, generateToken, AuthRequest } from './middleware/auth.js';
import { sendTextMessage } from './services/evolutionApi.js';
import { extractAssistantInputWithGoogleAi } from './services/googleAiStudio.js';
import { logActivity } from './utils/activity.js';
import { formatTurkishDateLong, normalizeDateFromTurkishInput, WHATSAPP_ASSISTANT_TIME_ZONE } from './utils/whatsappDate.js';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const port = process.env.PORT || 5000;

const getParam = (req: AuthRequest, key: string): string => {
  const value = req.params[key];
  return Array.isArray(value) ? value[0] : value;
};

const timeToMinutes = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

const getZonedDateParts = (date: Date, timeZone: string) => {
  const weekdayLabel = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  const timeParts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(timeParts.find(part => part.type === 'hour')?.value ?? '0');
  const minute = Number(timeParts.find(part => part.type === 'minute')?.value ?? '0');
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    weekday: weekdayMap[weekdayLabel],
    minutes: hour * 60 + minute,
  };
};

// --- Security Utilities ---
const validatePassword = (password: string): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  if (password.length > 128) {
    errors.push('Password must be less than 128 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character (!@#$%^&* etc)');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
};

const loginAttempts = new Map<string, { count: number; timestamp: number }>();

const checkLoginAttempt = (email: string): boolean => {
  const now = Date.now();
  const attempt = loginAttempts.get(email);
  
  if (!attempt) {
    return true;
  }
  
  // Reset after 15 minutes
  if (now - attempt.timestamp > 15 * 60 * 1000) {
    loginAttempts.delete(email);
    return true;
  }
  
  // Allow 5 attempts per 15 minutes
  return attempt.count < 5;
};

const recordLoginAttempt = (email: string): void => {
  const now = Date.now();
  const attempt = loginAttempts.get(email);
  
  if (!attempt) {
    loginAttempts.set(email, { count: 1, timestamp: now });
  } else if (now - attempt.timestamp > 15 * 60 * 1000) {
    loginAttempts.set(email, { count: 1, timestamp: now });
  } else {
    attempt.count++;
  }
};

const resetLoginAttempts = (email: string): void => {
  loginAttempts.delete(email);
};

app.use(cors());
app.use(express.json());

// --- Validation Schemas ---

const validCurrencies = ['USD', 'EUR', 'TRY', 'GBP', 'CHF'] as const;
const insuranceTypes = ['sgk', 'tss', 'oss', 'private', 'corporate', 'other'] as const;
const insuranceStatuses = [
  'draft',
  'pending_documents',
  'submitted',
  'waiting_response',
  'approved',
  'partially_approved',
  'rejected',
  'cancelled',
] as const;
const optionalUuid = z.preprocess(
  value => value === '' ? null : value,
  z.string().uuid().optional().nullable()
);

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

const patientSchema = patientBaseSchema.refine(data => data.email || data.phone, {
  message: "Either email or phone must be provided",
  path: ["email"]
});

const patientUpdateSchema = patientBaseSchema.partial().refine(data => {
  if ('email' in data || 'phone' in data) {
    return Boolean(data.email || data.phone);
  }
  return true;
}, {
  message: "Either email or phone must be provided",
  path: ["email"]
});

const appointmentTypeSchema = z.object({
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

  const userBaseSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Valid email is required'),
  phone: z.string().optional().nullable(),
  role: z.enum(['admin', 'doctor', 'receptionist', 'billing']),
  isActive: z.boolean().default(true),
  });

  const userCreateSchema = userBaseSchema.extend({
    password: z.string().min(8, 'Password must be at least 8 characters'),
  }).refine(data => {
  const validation = validatePassword(data.password);
  return validation.valid;
}, {
  message: 'Password does not meet security requirements',
  path: ['password'],
});

  const userUpdateSchema = userBaseSchema.partial().extend({
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
}).refine(data => {
  if (data.password) {
    const validation = validatePassword(data.password);
    return validation.valid;
  }
  return true;
}, {
  message: 'Password does not meet security requirements',
  path: ['password'],
});

const timeStringSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must use HH:mm format');

const availabilitySlotSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: timeStringSchema,
  endTime: timeStringSchema,
  isActive: z.boolean().default(true),
}).refine(data => timeToMinutes(data.endTime) > timeToMinutes(data.startTime), {
  message: 'End time must be after start time',
  path: ['endTime'],
});

const availabilityBatchSchema = z.object({
  slots: z.array(availabilitySlotSchema).max(28),
});

const appointmentStatusEnum = z.enum([
  'scheduled',
  'confirmed',
  'completed',
  'cancelled',
  'rescheduled',
  'no_show'
]);

const appointmentBaseSchema = z.object({
  patientId: z.string().uuid('Invalid patient ID'),
  practitionerId: z.string().uuid('Invalid practitioner ID'),
  appointmentTypeId: z.string().uuid('Invalid appointment type ID'),
  startTime: z.string().transform(val => new Date(val)),
  endTime: z.string().transform(val => new Date(val)),
  status: appointmentStatusEnum.default('scheduled'),
  notes: z.string().optional().nullable(),
});

const appointmentSchema = appointmentBaseSchema.refine(data => data.endTime > data.startTime, {
  message: "End time must be after start time",
  path: ["endTime"]
});

const appointmentUpdateSchema = appointmentBaseSchema.partial().refine(data => {
  if (data.startTime && data.endTime) {
    return data.endTime > data.startTime;
  }
  return true;
}, {
  message: "End time must be after start time",
  path: ["endTime"]
});

const taskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional().nullable(),
  patientId: z.string().uuid().optional().nullable(),
  appointmentId: z.string().uuid().optional().nullable(),
  assignedToId: z.string().uuid('Invalid assignee ID'),
  dueDate: z.string().transform(val => new Date(val)),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  status: z.enum(['open', 'in_progress', 'completed', 'cancelled']).default('open'),
});

const treatmentCaseSchema = z.object({
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
    'lost'
  ]).default('new'),
  estimatedAmount: z.number().nonnegative().optional().nullable(),
  acceptedAmount: z.number().nonnegative().optional().nullable(),
  currency: z.enum(validCurrencies).default('USD'),
  expectedStartDate: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
  lostReason: z.string().optional().nullable(),
});

const paymentSchema = z.object({
  patientId: z.string().uuid('Invalid patient ID'),
  treatmentCaseId: z.string().uuid().optional().nullable(),
  amount: z.number().positive('Amount must be positive'),
  currency: z.string().min(1, 'Currency is required').default('USD'),
  paymentMethod: z.enum(['cash', 'card', 'bank_transfer', 'cheque', 'other']),
  paymentStatus: z.enum(['pending', 'partial', 'paid', 'refunded', 'cancelled']).default('paid'),
  paidAt: z.string().optional().nullable().transform(val => val ? new Date(val) : new Date()),
  notes: z.string().optional().nullable(),
});

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
  currency: z.enum(validCurrencies).default('TRY'),
  submittedAt: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
  respondedAt: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
  rejectionReason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  assignedToId: optionalUuid,
});

const insuranceProvisionSchema = insuranceProvisionBaseSchema.refine(data => data.status !== 'rejected' || Boolean(data.rejectionReason?.trim()), {
  message: 'Rejection reason is required when status is rejected',
  path: ['rejectionReason'],
});

const insuranceProvisionUpdateSchema = insuranceProvisionBaseSchema.partial().refine(data => data.status !== 'rejected' || Boolean(data.rejectionReason?.trim()), {
  message: 'Rejection reason is required when status is rejected',
  path: ['rejectionReason'],
});

const insuranceStatusSchema = z.object({
  status: z.enum(insuranceStatuses),
  rejectionReason: z.string().optional().nullable(),
  approvedAmount: z.number().nonnegative().optional().nullable(),
  patientResponsibilityAmount: z.number().nonnegative().optional().nullable(),
  provisionNumber: z.string().optional().nullable(),
  respondedAt: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
  notes: z.string().optional().nullable(),
}).refine(data => data.status !== 'rejected' || Boolean(data.rejectionReason?.trim()), {
  message: 'Rejection reason is required when status is rejected',
  path: ['rejectionReason'],
});

const messageTemplateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  channel: z.enum(['sms', 'whatsapp', 'email']),
  subject: z.string().optional().nullable(),
  body: z.string().min(1, 'Body is required'),
  language: z.enum(['en', 'fr', 'tr']),
  isActive: z.boolean().default(true),
});

const prepareMessageSchema = z.object({
  templateId: z.string().uuid('Invalid template ID').optional().nullable(),
  patientId: z.string().uuid('Invalid patient ID'),
  appointmentId: z.string().uuid().optional().nullable(),
  treatmentCaseId: z.string().uuid().optional().nullable(),
  paymentId: z.string().uuid().optional().nullable(),
  channelOverride: z.enum(['sms', 'whatsapp', 'email']).optional().nullable(),
  customSubject: z.string().optional().nullable(),
  customBody: z.string().optional().nullable(),
});

const whatsappAppointmentRequestSchema = z.object({
  patientName: z.string().min(2, 'Patient name is required'),
  phone: z.string().min(6, 'Phone is required'),
  email: z.string().email().optional().nullable(),
  appointmentTypeId: optionalUuid,
  practitionerId: optionalUuid,
  preferredStartTime: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
  preferredEndTime: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
  requestType: z.enum(['appointment', 'reschedule', 'cancel', 'info']).default('appointment'),
  rawMessage: z.string().max(2000).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
}).refine(data => {
  if (data.preferredStartTime && data.preferredEndTime) {
    return data.preferredEndTime > data.preferredStartTime;
  }
  return true;
}, {
  message: 'Preferred end time must be after preferred start time',
  path: ['preferredEndTime'],
});

const whatsappAvailabilityQuerySchema = z.object({
  appointmentTypeId: z.string().uuid('Invalid appointment type ID'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format'),
  practitionerId: z.string().uuid().optional(),
});

const whatsappAppointmentLookupQuerySchema = z.object({
  phone: z.string().trim().min(6, 'Phone is required'),
});

const appointmentRequestStatusSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'closed']),
  notes: z.string().optional().nullable(),
  rejectionReason: z.string().optional().nullable(),
}).refine(data => data.status !== 'rejected' || Boolean(data.rejectionReason?.trim()), {
  message: 'Rejection reason is required when status is rejected',
  path: ['rejectionReason'],
});

const appointmentRequestConvertSchema = z.object({
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

// --- Auth Routes ---

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Email validation
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check login attempts
    if (!checkLoginAttempt(email)) {
      return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { clinic: true },
    });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      recordLoginAttempt(email);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.isActive) {
      recordLoginAttempt(email);
      return res.status(403).json({ error: 'User account is inactive' });
    }

    // Reset login attempts on successful login
    resetLoginAttempts(email);

    const token = generateToken({
      id: user.id,
      clinicId: user.clinicId,
      role: user.role,
    });

    await logActivity({
      clinicId: user.clinicId,
      userId: user.id,
      entityType: 'user',
      entityId: user.id,
      action: 'login',
      description: `User ${user.email} logged in`,
    });

    res.json({
      token,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        clinic: {
          id: user.clinic.id,
          name: user.clinic.name,
          currency: user.clinic.currency,
        }
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', authenticate as express.RequestHandler, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { clinic: true },
    });
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    res.json({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      clinic: { id: user.clinic.id, name: user.clinic.name, currency: user.clinic.currency },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

const checkPractitionerAvailability = async (clinicId: string, practitionerId: string, startTime: Date, endTime: Date) => {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { timezone: true },
  });
  const timeZone = clinic?.timezone || 'Europe/Istanbul';
  const start = getZonedDateParts(startTime, timeZone);
  const end = getZonedDateParts(endTime, timeZone);

  if (start.weekday !== end.weekday) {
    return { ok: false, slots: [], timeZone };
  }

  const slots = await prisma.doctorAvailability.findMany({
    where: {
      clinicId,
      practitionerId,
      weekday: start.weekday,
      isActive: true,
    },
    orderBy: { startTime: 'asc' },
  });

  const ok = slots.some(slot => {
    const slotStart = timeToMinutes(slot.startTime);
    const slotEnd = timeToMinutes(slot.endTime);
    return start.minutes >= slotStart && end.minutes <= slotEnd;
  });

  return { ok, slots, timeZone };
};

const authorizeWhatsappApi: express.RequestHandler = (req, res, next) => {
  const configuredSecret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!configuredSecret) {
    return res.status(503).json({ error: 'WhatsApp API secret is not configured' });
  }

  const bearerToken = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined;
  const providedSecret = req.headers['x-whatsapp-secret'] || bearerToken;

  if (providedSecret !== configuredSecret) {
    return res.status(401).json({ error: 'Invalid WhatsApp API secret' });
  }

  next();
};

const getDefaultClinic = async () => {
  return prisma.clinic.findFirst({
    orderBy: { createdAt: 'asc' },
  });
};

const localDateTimeToClinicDate = (date: string, time: string) => {
  return new Date(`${date}T${time}:00+03:00`);
};

const buildAvailableSlots = async (clinicId: string, appointmentTypeId: string, date: string, practitionerId?: string) => {
  const [clinic, service, practitioners] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: clinicId } }),
    prisma.appointmentType.findFirst({ where: { id: appointmentTypeId, clinicId, isActive: true } }),
    prisma.user.findMany({
      where: {
        clinicId,
        role: 'doctor',
        isActive: true,
        ...(practitionerId ? { id: practitionerId } : {}),
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    }),
  ]);

  if (!service) {
    return null;
  }

  const timeZone = clinic?.timezone || 'Europe/Istanbul';
  const weekday = getZonedDateParts(localDateTimeToClinicDate(date, '12:00'), timeZone).weekday;
  const durationMinutes = service.durationMinutes;
  const results: any[] = [];

  for (const practitioner of practitioners) {
    const availabilities = await prisma.doctorAvailability.findMany({
      where: { clinicId, practitionerId: practitioner.id, weekday, isActive: true },
      orderBy: { startTime: 'asc' },
    });

    for (const availability of availabilities) {
      let cursor = timeToMinutes(availability.startTime);
      const end = timeToMinutes(availability.endTime);

      while (cursor + durationMinutes <= end) {
        const slotStart = minutesToTime(cursor);
        const slotEnd = minutesToTime(cursor + durationMinutes);
        const startTime = localDateTimeToClinicDate(date, slotStart);
        const endTime = localDateTimeToClinicDate(date, slotEnd);

        const overlap = await prisma.appointment.findFirst({
          where: {
            clinicId,
            practitionerId: practitioner.id,
            deletedAt: null,
            status: { notIn: ['cancelled'] },
            OR: [{ startTime: { lt: endTime }, endTime: { gt: startTime } }],
          },
          select: { id: true },
        });

        if (!overlap) {
          results.push({
            practitioner,
            startTime,
            endTime,
            localStartTime: slotStart,
            localEndTime: slotEnd,
          });
        }

        cursor += 30;
      }
    }
  }

  return results
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    .slice(0, 30);
};

const minutesToTime = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

const formatClinicDateTime = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(date);

  const year = parts.find(part => part.type === 'year')?.value ?? '0000';
  const month = parts.find(part => part.type === 'month')?.value ?? '00';
  const day = parts.find(part => part.type === 'day')?.value ?? '00';
  const hour = parts.find(part => part.type === 'hour')?.value ?? '00';
  const minute = parts.find(part => part.type === 'minute')?.value ?? '00';

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
  };
};

type AssistantIntent = 'book_appointment' | 'check_appointment' | 'cancel_appointment' | 'service_info' | 'unknown';
type AssistantStep =
  | 'main_menu'
  | 'awaiting_name'
  | 'awaiting_service'
  | 'awaiting_date'
  | 'awaiting_time'
  | 'awaiting_cancel_selection';

type NormalizedWhatsAppMessage = {
  phone: string;
  name?: string;
  text: string;
  rawPayload: Record<string, unknown>;
};

type NormalizedEvolutionWebhookPayload = {
  event?: string;
  instance?: string;
  fromMe: boolean;
  message: NormalizedWhatsAppMessage | null;
};

type AssistantExtraction = {
  intent: AssistantIntent;
  name: string | null;
  phone: string | null;
  appointmentTypeName: string | null;
  appointmentTypeId: string | null;
  dateText: string | null;
  time: string | null;
};

type AssistantStateRecord = {
  currentIntent?: string | null;
  step?: string | null;
  customerName?: string | null;
  selectedAppointmentTypeId?: string | null;
  selectedAppointmentTypeName?: string | null;
  selectedDate?: string | null;
};

type WhatsAppContactPatient = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
};

type AssistantService = {
  id: string;
  name: string;
  durationMinutes: number;
};

type SavedAvailableSlot = {
  practitionerId: string;
  practitionerName: string;
  startTime: string;
  endTime: string;
  localStartTime: string;
  localEndTime: string;
};

type SavedAppointmentSummary = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  serviceName: string | null;
  practitionerName: string | null;
  status: string;
};

type ConversationStateJson = {
  availableSlots?: SavedAvailableSlot[];
  cancellableAppointments?: SavedAppointmentSummary[];
};

const WHATSAPP_MAIN_MENU = [
  'Merhaba, kliniğimize hoş geldiniz. Size memnuniyetle yardımcı olayım.',
  '1. Randevu almak',
  '2. Randevumu sorgulamak',
  '3. Randevumu iptal etmek',
  '4. Hizmetler hakkında bilgi almak',
].join('\n');

const getPatientFullName = (patient: Pick<WhatsAppContactPatient, 'firstName' | 'lastName'>) => {
  const firstName = patient.firstName.trim();
  const lastName = hasValidLastName(patient.lastName) ? patient.lastName!.trim() : '';
  return `${firstName}${lastName ? ` ${lastName}` : ''}`.trim();
};

const hasValidLastName = (lastName?: string | null) => {
  const normalized = (lastName ?? '').trim().toLocaleLowerCase('tr-TR');
  return Boolean(normalized) && !['-', 'unknown', 'bilinmiyor'].includes(normalized);
};

const getFirstNameFromCustomerName = (customerName?: string | null) => {
  if (!customerName?.trim()) {
    return null;
  }

  return titleCaseName(customerName).split(/\s+/)[0] ?? null;
};

const formatMainMenu = (customerName?: string | null, isReturningCustomer = false) => {
  const firstName = getFirstNameFromCustomerName(customerName);
  if (firstName && isReturningCustomer) {
    return [`Merhaba ${firstName}, yeniden hoş geldiniz. Size nasıl yardımcı olabilirim?`, '1. Randevu almak', '2. Randevumu sorgulamak', '3. Randevumu iptal etmek', '4. Hizmetler hakkında bilgi almak'].join('\n');
  }

  if (firstName) {
    return [`Teşekkür ederim ${firstName}. Size nasıl yardımcı olabilirim?`, '1. Randevu almak', '2. Randevumu sorgulamak', '3. Randevumu iptal etmek', '4. Hizmetler hakkında bilgi almak'].join('\n');
  }

  return 'Merhaba, kliniğimize hoş geldiniz. Size yardımcı olabilmem için adınızı ve soyadınızı paylaşır mısınız?';
};

const WHATSAPP_FALLBACK_SERVICES: AssistantService[] = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Ağız, Diş ve Çene Cerrahisi', durationMinutes: 30 },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Diş Beyazlatma Bleaching', durationMinutes: 30 },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Endodonti (Kanal Tedavisi)', durationMinutes: 60 },
  { id: '44444444-4444-4444-8444-444444444444', name: 'Estetik Diş Hekimliği', durationMinutes: 45 },
  { id: 'd4e8a00f-b601-4b8d-a21b-f3a13899f336', name: 'Gülüş Tasarımı', durationMinutes: 60 },
];

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toPrismaStateJson = (value: ConversationStateJson | null | undefined) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return Prisma.DbNull;
  }

  return value;
};

const readString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
};

const normalizePhone = (value: string) => value.replace(/@.+$/, '').replace(/\D/g, '');

const normalizeIntentText = (value: string) => value.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');

const isGreetingMessage = (text: string) => /^(merhaba|selam|iyi günler|günaydın|gunaydin|iyi akşamlar|iyi aksamlar|hey)\b/i.test(text.trim());

const optionalWhatsappWebhookSecret: express.RequestHandler = (req, res, next) => {
  const configuredSecret = process.env.WHATSAPP_WEBHOOK_SECRET?.trim();
  if (!configuredSecret) {
    return next();
  }

  const providedSecret = readString(req.headers['x-whatsapp-secret'], req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined);

  if (providedSecret !== configuredSecret) {
    return res.status(401).json({ error: 'Invalid WhatsApp webhook secret' });
  }

  next();
};

const normalizeEvolutionWebhookPayload = (payload: unknown): NormalizedEvolutionWebhookPayload => {
  const payloadRecord = isRecord(payload) ? payload : undefined;
  const envelope = payloadRecord && isRecord(payloadRecord.body) ? payloadRecord.body : payloadRecord;
  if (!isRecord(envelope)) {
    return { fromMe: false, message: null };
  }

  const data = isRecord(envelope.data) ? envelope.data : undefined;
  const key = data && isRecord(data.key) ? data.key : undefined;
  const message = data && isRecord(data.message) ? data.message : undefined;
  const extendedText = message && isRecord(message.extendedTextMessage) ? message.extendedTextMessage : undefined;
  const remoteJid = readString(key?.remoteJid, envelope.sender, data?.sender);
  const phone = remoteJid ? normalizePhone(remoteJid) : undefined;
  const text = readString(message?.conversation, extendedText?.text, envelope.message, envelope.text);
  const name = readString(data?.pushName, envelope.pushName);

  return {
    event: readString(envelope.event),
    instance: readString(envelope.instance),
    fromMe: key?.fromMe === true || envelope.fromMe === true,
    message: phone && text
      ? {
          phone,
          name,
          text,
          rawPayload: envelope,
        }
      : null,
  };
};

const readConversationStateJson = (value: unknown): ConversationStateJson => {
  if (!isRecord(value)) {
    return {};
  }

  return {
    availableSlots: Array.isArray(value.availableSlots) ? value.availableSlots as SavedAvailableSlot[] : undefined,
    cancellableAppointments: Array.isArray(value.cancellableAppointments)
      ? value.cancellableAppointments as SavedAppointmentSummary[]
      : undefined,
  };
};

const resetWhatsAppConversationState = async (clinicId: string, phone: string, customerName?: string | null) => {
  return prisma.whatsAppConversationState.upsert({
    where: { clinicId_phone: { clinicId, phone } },
    update: {
      customerName: customerName ?? null,
      currentIntent: null,
      step: null,
      selectedAppointmentTypeId: null,
      selectedAppointmentTypeName: null,
      selectedPractitionerId: null,
      selectedDate: null,
      selectedTime: null,
      lastMessage: null,
      stateJson: Prisma.DbNull,
    },
    create: {
      clinicId,
      phone,
      customerName: customerName ?? null,
      stateJson: Prisma.DbNull,
    },
  });
};

const upsertWhatsAppConversationState = async (
  clinicId: string,
  phone: string,
  data: {
    customerName?: string | null;
    currentIntent?: string | null;
    step?: string | null;
    selectedAppointmentTypeId?: string | null;
    selectedAppointmentTypeName?: string | null;
    selectedPractitionerId?: string | null;
    selectedDate?: string | null;
    selectedTime?: string | null;
    lastMessage?: string | null;
    stateJson?: ConversationStateJson | null;
  }
) => {
  const { stateJson: rawStateJson, ...rest } = data;
  const stateJson = toPrismaStateJson(rawStateJson);

  return prisma.whatsAppConversationState.upsert({
    where: { clinicId_phone: { clinicId, phone } },
    update: {
      ...rest,
      ...(stateJson !== undefined ? { stateJson } : {}),
    },
    create: {
      clinicId,
      phone,
      ...rest,
      ...(stateJson !== undefined ? { stateJson } : {}),
    },
  });
};

const getAssistantServices = async (clinicId: string): Promise<AssistantService[]> => {
  const services = await prisma.appointmentType.findMany({
    where: { clinicId, isActive: true, isService: true },
    select: { id: true, name: true, durationMinutes: true },
    orderBy: { name: 'asc' },
  });

  if (services.length > 0) {
    return services;
  }

  return WHATSAPP_FALLBACK_SERVICES;
};

const formatServiceList = (services: AssistantService[]) => [
  'Elbette, hangi hizmet için randevu planlamak istersiniz?',
  ...services.map((service, index) => `${index + 1}. ${service.name}`),
].join('\n');

const formatAppointmentLookupForMessage = (appointments: SavedAppointmentSummary[]) => {
  if (appointments.length === 0) {
    return 'Telefon numaranızla eşleşen aktif bir randevu göremedim. İsterseniz birlikte yeni bir randevu planlayabiliriz.';
  }

  return [
    'Sistemde görebildiğim randevularınız şunlar:',
    ...appointments.map((appointment, index) => `${index + 1}. ${appointment.date} ${appointment.startTime} - ${appointment.serviceName ?? 'Hizmet bilgisi yok'}${appointment.practitionerName ? ` / ${appointment.practitionerName}` : ''} / ${appointment.status}`),
  ].join('\n');
};

const formatAvailabilityMessage = (date: string, slots: SavedAvailableSlot[]) => {
  const formattedDate = formatTurkishDateLong(date, WHATSAPP_ASSISTANT_TIME_ZONE);
  return [
    `${formattedDate} için takvimi kontrol ettim. Size sunabileceğim uygun saatler şunlar:`,
    ...slots.map((slot, index) => `${index + 1}. ${slot.localStartTime}${slot.practitionerName ? ` (${slot.practitionerName})` : ''}`),
    '',
    'Size uygun olan saati paylaşabilirsiniz.',
  ].join('\n');
};

const formatWarmPrompt = (message: string, customerName?: string | null) => {
  const firstName = getFirstNameFromCustomerName(customerName);
  if (!firstName) {
    return message;
  }

  return `${firstName}, ${message.charAt(0).toLocaleLowerCase('tr-TR')}${message.slice(1)}`;
};

const titleCaseName = (value: string) => value
  .trim()
  .split(/\s+/)
  .map(part => part.charAt(0).toLocaleUpperCase('tr-TR') + part.slice(1).toLocaleLowerCase('tr-TR'))
  .join(' ');

const splitNameForPatient = (value: string) => {
  const normalized = titleCaseName(value);
  const [firstName, ...lastNameParts] = normalized.split(/\s+/);

  return {
    firstName: firstName || '',
    lastName: lastNameParts.join(' '),
  };
};

const isPlaceholderPatientName = (patient: Pick<WhatsAppContactPatient, 'firstName' | 'lastName'>) => {
  return !patient.firstName.trim() || !hasValidLastName(patient.lastName);
};

const findServiceSelection = (text: string, services: AssistantService[]) => {
  const normalized = normalizeIntentText(text);
  if (/^\d+$/.test(normalized)) {
    const selected = services[Number(normalized) - 1];
    return selected ?? null;
  }

  return services.find(service => normalizeIntentText(service.name) === normalized || normalizeIntentText(service.name).includes(normalized)) ?? null;
};

const extractAssistantInputRuleBased = (text: string, services: AssistantService[]): AssistantExtraction => {
  const normalized = normalizeIntentText(text);
  const matchedService = findServiceSelection(text, services);
  const timeMatch = normalized.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);

  let intent: AssistantIntent = 'unknown';

  if (normalized === '1' || /(randevu al|randevu almak|randevu oluştur|randevu olustur|randevu istiyorum)/.test(normalized)) {
    intent = 'book_appointment';
  } else if (normalized === '2' || /(randevumu sorgu|randevu sorgu|randevum ne zaman|randevu durum|randevum var mı|randevum var mi)/.test(normalized)) {
    intent = 'check_appointment';
  } else if (normalized === '3' || /(iptal|randevumu iptal|randevu iptal)/.test(normalized)) {
    intent = 'cancel_appointment';
  } else if (normalized === '4' || /(hizmet|tedavi|bilgi almak|fiyat|servis)/.test(normalized)) {
    intent = 'service_info';
  }

  return {
    intent,
    name: /^[\p{L} .'-]{2,}$/u.test(text.trim()) ? titleCaseName(text) : null,
    phone: /^\+?\d{6,}$/.test(text.trim()) ? normalizePhone(text.trim()) : null,
    appointmentTypeName: matchedService?.name ?? null,
    appointmentTypeId: matchedService?.id ?? null,
    dateText: normalizeDateFromTurkishInput(text, new Date(), WHATSAPP_ASSISTANT_TIME_ZONE) ? text : null,
    time: timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : null,
  };
};

const mergeAssistantExtractions = (ruleBased: AssistantExtraction, aiBased: AssistantExtraction | null, services: AssistantService[]): AssistantExtraction => {
  const aiService = aiBased?.appointmentTypeId
    ? services.find(service => service.id === aiBased.appointmentTypeId) ?? null
    : aiBased?.appointmentTypeName
      ? findServiceSelection(aiBased.appointmentTypeName, services)
      : null;

  return {
    intent: ruleBased.intent !== 'unknown' ? ruleBased.intent : (aiBased?.intent ?? 'unknown'),
    name: ruleBased.name ?? aiBased?.name ?? null,
    phone: ruleBased.phone ?? aiBased?.phone ?? null,
    appointmentTypeName: ruleBased.appointmentTypeName ?? aiService?.name ?? aiBased?.appointmentTypeName ?? null,
    appointmentTypeId: ruleBased.appointmentTypeId ?? aiService?.id ?? aiBased?.appointmentTypeId ?? null,
    dateText: ruleBased.dateText ?? aiBased?.dateText ?? null,
    time: ruleBased.time ?? aiBased?.time ?? null,
  };
};

const resolveAssistantExtraction = async (
  text: string,
  services: AssistantService[],
  state: AssistantStateRecord
): Promise<AssistantExtraction> => {
  const ruleBased = extractAssistantInputRuleBased(text, services);

  try {
    const aiBased = await extractAssistantInputWithGoogleAi({
      text,
      services: services.map(service => ({ id: service.id, name: service.name })),
      currentIntent: state.currentIntent,
      currentStep: state.step,
      customerName: state.customerName,
      selectedAppointmentTypeName: state.selectedAppointmentTypeName,
      selectedDate: state.selectedDate,
    });

    const merged = mergeAssistantExtractions(ruleBased, aiBased, services);
    console.info('[whatsapp-assistant] extraction-source', { usedAi: Boolean(aiBased), intent: merged.intent });
    return merged;
  } catch (error) {
    console.error('[whatsapp-assistant] ai-extraction-error', error);
    return ruleBased;
  }
};

const findExistingPatientByPhone = async (clinicId: string, phone: string) => {
  return prisma.patient.findFirst({
    where: { clinicId, phone, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
};

const getClinicSystemUserId = async (clinicId: string) => {
  const user = await prisma.user.findFirst({
    where: { clinicId, isActive: true },
    select: { id: true },
    orderBy: [
      { role: 'asc' },
      { createdAt: 'asc' },
    ],
  });

  return user?.id ?? null;
};

const createPatientFromWhatsAppName = async (clinicId: string, phone: string, fullName: string) => {
  const parsedName = splitNameForPatient(fullName);
  const patient = await prisma.patient.create({
    data: {
      clinicId,
      firstName: parsedName.firstName,
      lastName: parsedName.lastName,
      phone,
      source: 'whatsapp',
      patientStatus: 'new',
      communicationConsent: false,
      notes: 'WhatsApp üzerinden ilk temas sonrası oluşturuldu.',
    },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });

  const systemUserId = await getClinicSystemUserId(clinicId);
  if (systemUserId) {
    await logActivity({
      clinicId,
      userId: systemUserId,
      entityType: 'patient',
      entityId: patient.id,
      action: 'created',
      description: `Patient automatically created from first WhatsApp contact (${phone})`,
      patientId: patient.id,
      metadata: {
        systemGenerated: true,
        source: 'whatsapp',
        phone,
      },
    });
  }

  return patient;
};

const ensureWhatsAppContactPatient = async (clinicId: string, phone: string, providedName?: string | null) => {
  const existingPatient = await findExistingPatientByPhone(clinicId, phone);
  if (existingPatient) {
    if (providedName && (!existingPatient.firstName.trim() || isPlaceholderPatientName(existingPatient))) {
      const parsedName = splitNameForPatient(providedName);
      return prisma.patient.update({
        where: { id: existingPatient.id },
        data: parsedName,
        select: { id: true, firstName: true, lastName: true, phone: true },
      });
    }

    return existingPatient;
  }

  if (!providedName?.trim()) {
    return null;
  }

  return createPatientFromWhatsAppName(clinicId, phone, providedName);
};

const saveWhatsAppConversationMessage = async (args: {
  clinicId: string;
  patientId: string;
  phone: string;
  direction: 'incoming' | 'outgoing';
  text: string;
  rawPayload?: Record<string, unknown> | null;
}) => {
  return prisma.whatsAppConversationMessage.create({
    data: {
      clinicId: args.clinicId,
      patientId: args.patientId,
      phone: args.phone,
      direction: args.direction,
      text: args.text,
      rawPayload: args.rawPayload ? args.rawPayload as Prisma.InputJsonValue : Prisma.DbNull,
    },
  });
};

const ensurePatientForWhatsApp = async (clinicId: string, phone: string, customerName: string) => {
  const patient = await ensureWhatsAppContactPatient(clinicId, phone, customerName);
  if (!patient) {
    throw new Error('PATIENT_NAME_REQUIRED');
  }

  return patient;
};

const getAppointmentsForPhone = async (clinicId: string, phone: string) => {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } });
  const timeZone = clinic?.timezone || 'Europe/Istanbul';
  const now = new Date();

  const appointments = await prisma.appointment.findMany({
    where: {
      clinicId,
      deletedAt: null,
      status: { notIn: ['cancelled'] },
      startTime: { gte: now },
      patient: { phone, deletedAt: null },
    },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      status: true,
      appointmentType: { select: { name: true } },
      practitioner: { select: { firstName: true, lastName: true } },
    },
    orderBy: { startTime: 'asc' },
    take: 10,
  });

  return appointments.map(appointment => {
    const start = formatClinicDateTime(appointment.startTime, timeZone);
    const end = formatClinicDateTime(appointment.endTime, timeZone);

    return {
      id: appointment.id,
      date: start.date,
      startTime: start.time,
      endTime: end.time,
      serviceName: appointment.appointmentType?.name ?? null,
      practitionerName: appointment.practitioner ? `${appointment.practitioner.firstName} ${appointment.practitioner.lastName}` : null,
      status: appointment.status,
    } satisfies SavedAppointmentSummary;
  });
};

const createAppointmentFromAssistant = async (
  clinicId: string,
  phone: string,
  customerName: string,
  appointmentTypeId: string,
  selectedSlot: SavedAvailableSlot
) => {
  const patient = await ensurePatientForWhatsApp(clinicId, phone, customerName);
  const startTime = new Date(selectedSlot.startTime);
  const endTime = new Date(selectedSlot.endTime);

  const availability = await checkPractitionerAvailability(clinicId, selectedSlot.practitionerId, startTime, endTime);
  if (!availability.ok) {
    throw new Error('APPOINTMENT_OUTSIDE_AVAILABILITY');
  }

  const overlap = await prisma.appointment.findFirst({
    where: {
      clinicId,
      practitionerId: selectedSlot.practitionerId,
      deletedAt: null,
      status: { notIn: ['cancelled'] },
      OR: [{ startTime: { lt: endTime }, endTime: { gt: startTime } }],
    },
    select: { id: true },
  });

  if (overlap) {
    throw new Error('APPOINTMENT_OVERLAP');
  }

  const appointment = await prisma.appointment.create({
    data: {
      clinicId,
      patientId: patient.id,
      practitionerId: selectedSlot.practitionerId,
      appointmentTypeId,
      startTime,
      endTime,
      status: 'scheduled',
      notes: 'WhatsApp assistant üzerinden oluşturuldu.',
    },
    include: {
      appointmentType: { select: { name: true } },
      practitioner: { select: { firstName: true, lastName: true } },
      patient: { select: { firstName: true, lastName: true } },
    },
  });

  return appointment;
};

const cancelAppointmentForPhone = async (clinicId: string, appointmentId: string, phone: string) => {
  const appointment = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      clinicId,
      deletedAt: null,
      status: { notIn: ['cancelled'] },
      patient: { phone, deletedAt: null },
    },
    include: {
      appointmentType: { select: { name: true } },
      practitioner: { select: { firstName: true, lastName: true } },
    },
  });

  if (!appointment) {
    return null;
  }

  return prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      status: 'cancelled',
      cancellationReason: 'WhatsApp assistant tarafından iptal edildi.',
      notes: appointment.notes ? `${appointment.notes}\nWhatsApp assistant tarafından iptal edildi.` : 'WhatsApp assistant tarafından iptal edildi.',
    },
    include: {
      appointmentType: { select: { name: true } },
      practitioner: { select: { firstName: true, lastName: true } },
    },
  });
};

const handleCancelIntent = async (clinicId: string, phone: string) => {
  const appointments = await getAppointmentsForPhone(clinicId, phone);
  if (appointments.length === 0) {
    await resetWhatsAppConversationState(clinicId, phone);
    return 'İptal edilebilecek aktif bir randevu bulamadım.';
  }

  await upsertWhatsAppConversationState(clinicId, phone, {
    currentIntent: 'cancel_appointment',
    step: 'awaiting_cancel_selection',
    stateJson: { cancellableAppointments: appointments },
  });

  return [
    'İptal etmek istediğiniz randevuyu seçer misiniz?',
    ...appointments.map((appointment, index) => `${index + 1}. ${appointment.date} ${appointment.startTime} - ${appointment.serviceName ?? 'Hizmet bilgisi yok'}`),
  ].join('\n');
};

const handleIncomingWhatsAppMessage = async (input: NormalizedWhatsAppMessage) => {
  const clinic = await getDefaultClinic();
  if (!clinic) {
    return 'Klinik ayarlarına şu anda erişemiyorum.';
  }

  const existingPatient = await findExistingPatientByPhone(clinic.id, input.phone);
  const state = await prisma.whatsAppConversationState.findUnique({
    where: { clinicId_phone: { clinicId: clinic.id, phone: input.phone } },
  });
  if (existingPatient) {
    await saveWhatsAppConversationMessage({
      clinicId: clinic.id,
      patientId: existingPatient.id,
      phone: input.phone,
      direction: 'incoming',
      text: input.text,
      rawPayload: input.rawPayload,
    });
  }
  const stateJson = readConversationStateJson(state?.stateJson);
  const services = await getAssistantServices(clinic.id);
  const extracted = await resolveAssistantExtraction(input.text, services, {
    currentIntent: state?.currentIntent,
    step: state?.step,
    customerName: state?.customerName,
    selectedAppointmentTypeId: state?.selectedAppointmentTypeId,
    selectedAppointmentTypeName: state?.selectedAppointmentTypeName,
    selectedDate: state?.selectedDate,
  });
  const normalizedText = normalizeIntentText(input.text);
  const persistedCustomerName = existingPatient ? getPatientFullName(existingPatient) : null;
  const customerName = state?.customerName || persistedCustomerName;
  const effectiveIntent = extracted.intent !== 'unknown'
    ? extracted.intent
    : (state?.currentIntent as AssistantIntent | null) ?? 'unknown';
  const candidateAppointmentTypeId = state?.selectedAppointmentTypeId ?? extracted.appointmentTypeId ?? null;
  const candidateAppointmentTypeName = state?.selectedAppointmentTypeName ?? extracted.appointmentTypeName ?? null;
  const candidateDate = state?.selectedDate ?? (extracted.dateText ? normalizeDateFromTurkishInput(extracted.dateText, new Date(), WHATSAPP_ASSISTANT_TIME_ZONE) : null);
  const currentStep = (state?.step ?? null) as AssistantStep | 'main_menu' | null;
  const hasActiveBookingFlow = ['awaiting_service', 'awaiting_date', 'awaiting_time'].includes(currentStep ?? '');
  const isResetCommand = ['menü', 'menu', 'başa dön', 'basa don', 'iptal', 'reset'].includes(normalizedText);

  console.info('[whatsapp-assistant] incoming', { phone: input.phone, text: input.text.slice(0, 200) });
  console.info('[whatsapp-assistant] detected', { intent: effectiveIntent, step: state?.step ?? null });

  if (!existingPatient && currentStep !== 'awaiting_name') {
    await upsertWhatsAppConversationState(clinic.id, input.phone, {
      customerName: null,
      currentIntent: null,
      step: 'awaiting_name',
      selectedAppointmentTypeId: null,
      selectedAppointmentTypeName: null,
      selectedPractitionerId: null,
      selectedDate: null,
      selectedTime: null,
      lastMessage: input.text,
      stateJson: null,
    });
    return 'Merhaba, kliniğimize hoş geldiniz. Size yardımcı olabilmem için adınızı ve soyadınızı paylaşır mısınız?';
  }

  if (currentStep === 'awaiting_name') {
    const createdPatient = await createPatientFromWhatsAppName(clinic.id, input.phone, input.text);
    await saveWhatsAppConversationMessage({
      clinicId: clinic.id,
      patientId: createdPatient.id,
      phone: input.phone,
      direction: 'incoming',
      text: input.text,
      rawPayload: input.rawPayload,
    });

    const fullName = getPatientFullName(createdPatient);
    await upsertWhatsAppConversationState(clinic.id, input.phone, {
      customerName: fullName,
      currentIntent: null,
      step: 'main_menu',
      selectedAppointmentTypeId: null,
      selectedAppointmentTypeName: null,
      selectedPractitionerId: null,
      selectedDate: null,
      selectedTime: null,
      lastMessage: input.text,
      stateJson: null,
    });
    return formatMainMenu(fullName, false);
  }

  if (isResetCommand) {
    await upsertWhatsAppConversationState(clinic.id, input.phone, {
      customerName,
      currentIntent: null,
      step: 'main_menu',
      selectedAppointmentTypeId: null,
      selectedAppointmentTypeName: null,
      selectedPractitionerId: null,
      selectedDate: null,
      selectedTime: null,
      lastMessage: input.text,
      stateJson: null,
    });
    return formatMainMenu(customerName, true);
  }

  if ((!currentStep || currentStep === 'main_menu') && (isGreetingMessage(input.text) || effectiveIntent === 'unknown' || normalizedText === '0')) {
    await upsertWhatsAppConversationState(clinic.id, input.phone, {
      customerName,
      currentIntent: null,
      step: 'main_menu',
      lastMessage: input.text,
      stateJson: null,
    });
    return formatMainMenu(customerName, true);
  }

  if (currentStep === 'main_menu') {
    if (normalizedText === '1') {
      await upsertWhatsAppConversationState(clinic.id, input.phone, {
        customerName,
        currentIntent: 'book_appointment',
        step: 'awaiting_service',
        selectedAppointmentTypeId: null,
        selectedAppointmentTypeName: null,
        selectedDate: null,
        selectedTime: null,
        lastMessage: input.text,
        stateJson: null,
      });
      return formatServiceList(services);
    }

    if (normalizedText === '2') {
      const appointments = await getAppointmentsForPhone(clinic.id, input.phone);
      return formatAppointmentLookupForMessage(appointments);
    }

    if (normalizedText === '3') {
      return handleCancelIntent(clinic.id, input.phone);
    }

    if (normalizedText === '4') {
      return [
        'Hizmetlerimiz şu şekilde:',
        ...services.map((service, index) => `${index + 1}. ${service.name}`),
      ].join('\n');
    }

    if (/^\d+$/.test(normalizedText)) {
      return formatMainMenu(customerName, true);
    }
  }

  if (currentStep === 'awaiting_cancel_selection') {
    const appointments = stateJson.cancellableAppointments ?? [];
    const selectedAppointment = /^\d+$/.test(normalizedText) ? appointments[Number(normalizedText) - 1] : null;

    if (!selectedAppointment) {
      return formatWarmPrompt('iptal etmek istediğiniz randevunun numarasını paylaşır mısınız?', customerName);
    }

    const cancelledAppointment = await cancelAppointmentForPhone(clinic.id, selectedAppointment.id, input.phone);
    if (!cancelledAppointment) {
      await resetWhatsAppConversationState(clinic.id, input.phone, customerName);
      return formatWarmPrompt('seçtiğiniz randevuyu iptal ederken bir sorun oluştu. İsterseniz hemen yeniden deneyebiliriz.', customerName);
    }

    await resetWhatsAppConversationState(clinic.id, input.phone, customerName);
    return `${selectedAppointment.date} ${selectedAppointment.startTime} tarihli ${cancelledAppointment.appointmentType?.name ?? 'randevunuz'} iptal edildi. İhtiyacınız olursa yeni bir randevu için de yardımcı olabilirim.`;
  }

  if (!hasActiveBookingFlow && effectiveIntent === 'service_info') {
    await resetWhatsAppConversationState(clinic.id, input.phone, customerName);
    return formatServiceList(services);
  }

  if (!hasActiveBookingFlow && effectiveIntent === 'check_appointment') {
    const appointments = await getAppointmentsForPhone(clinic.id, input.phone);
    await resetWhatsAppConversationState(clinic.id, input.phone, customerName);
    return formatAppointmentLookupForMessage(appointments);
  }

  if (!hasActiveBookingFlow && effectiveIntent === 'cancel_appointment') {
    return handleCancelIntent(clinic.id, input.phone);
  }

  if (effectiveIntent === 'book_appointment' || currentStep) {
    const selectedAppointmentTypeId = candidateAppointmentTypeId;
    const selectedAppointmentTypeName = candidateAppointmentTypeName;

    if (!selectedAppointmentTypeId) {
      if (currentStep === 'main_menu' && normalizedText !== '1') {
        return formatMainMenu(customerName, true);
      }

      const selectedService = extracted.appointmentTypeId
        ? services.find(service => service.id === extracted.appointmentTypeId) ?? findServiceSelection(input.text, services)
        : findServiceSelection(input.text, services);

      if (!selectedService) {
        await upsertWhatsAppConversationState(clinic.id, input.phone, {
          customerName,
          currentIntent: 'book_appointment',
          step: 'awaiting_service',
          lastMessage: input.text,
        });
        return formatServiceList(services);
      }

      await upsertWhatsAppConversationState(clinic.id, input.phone, {
        customerName,
        currentIntent: 'book_appointment',
        step: 'awaiting_date',
        selectedAppointmentTypeId: selectedService.id,
        selectedAppointmentTypeName: selectedService.name,
        lastMessage: input.text,
        stateJson: null,
      });
      return `${selectedService.name} hizmetini seçtiniz. Hangi gün için randevu istersiniz?`;
    }

    const selectedDate = state?.selectedDate ?? candidateDate;

    if (!selectedDate) {
      const normalizedDate = extracted.dateText
        ? normalizeDateFromTurkishInput(extracted.dateText, new Date(), WHATSAPP_ASSISTANT_TIME_ZONE)
        : normalizeDateFromTurkishInput(input.text, new Date(), WHATSAPP_ASSISTANT_TIME_ZONE);
      if (!normalizedDate) {
        await upsertWhatsAppConversationState(clinic.id, input.phone, {
          customerName,
          currentIntent: 'book_appointment',
          step: 'awaiting_date',
          selectedAppointmentTypeId,
          selectedAppointmentTypeName,
          lastMessage: input.text,
        });
        return formatWarmPrompt('tarihi netleştiremedim. İsterseniz bugün, yarın, cumartesi, 16.05 ya da 16 Mayıs gibi yazabilirsiniz.', customerName);
      }

      console.info('[whatsapp-assistant] availability-check', {
        appointmentTypeId: selectedAppointmentTypeId,
        date: normalizedDate,
      });

      try {
        const slots = await buildAvailableSlots(clinic.id, selectedAppointmentTypeId, normalizedDate, state?.selectedPractitionerId ?? undefined);

        if (!slots) {
          return 'Seçtiğiniz hizmeti şu anda sistemde doğrulayamadım. İsterseniz listeden yeniden seçim yapabiliriz.';
        }

        const savedSlots = slots.slice(0, 8).map(slot => ({
          practitionerId: slot.practitioner.id,
          practitionerName: `${slot.practitioner.firstName} ${slot.practitioner.lastName}`,
          startTime: slot.startTime.toISOString(),
          endTime: slot.endTime.toISOString(),
          localStartTime: slot.localStartTime,
          localEndTime: slot.localEndTime,
        } satisfies SavedAvailableSlot));

        console.info('[whatsapp-assistant] availability-result', { count: savedSlots.length });

        if (savedSlots.length === 0) {
          await upsertWhatsAppConversationState(clinic.id, input.phone, {
            customerName,
            currentIntent: 'book_appointment',
            step: 'awaiting_date',
            selectedAppointmentTypeId,
            selectedAppointmentTypeName,
            selectedDate: null,
            selectedTime: null,
            lastMessage: input.text,
            stateJson: null,
          });
          return 'Bu tarih için uygun saat görünmüyor. Uygunsanız size hemen başka bir gün bakabilirim.';
        }

        await upsertWhatsAppConversationState(clinic.id, input.phone, {
          customerName,
          currentIntent: 'book_appointment',
          step: 'awaiting_time',
          selectedAppointmentTypeId,
          selectedAppointmentTypeName,
          selectedDate: normalizedDate,
          selectedTime: null,
          lastMessage: input.text,
          stateJson: { availableSlots: savedSlots },
        });

        return formatAvailabilityMessage(normalizedDate, savedSlots);
      } catch (error) {
        console.error('[whatsapp-assistant] availability-error', error);
        return 'Şu anda randevu takvimine erişirken teknik bir sorun oluştu. Lütfen biraz sonra tekrar deneyin veya klinik ekibine iletilmek üzere talebinizi not edebilirim.';
      }
    }

    if (currentStep === 'awaiting_time') {
      const availableSlots = stateJson.availableSlots ?? [];
      const selectedSlot = /^\d+$/.test(normalizedText)
        ? availableSlots[Number(normalizedText) - 1]
        : availableSlots.find(slot => slot.localStartTime === extracted.time);

      if (!selectedSlot) {
        return formatWarmPrompt('listede paylaştığım uygun saatlerden birini numarasıyla ya da saat olarak yazabilir misiniz?', customerName);
      }

      console.info('[whatsapp-assistant] appointment-create', {
        appointmentTypeId: selectedAppointmentTypeId,
        date: selectedDate,
        time: selectedSlot.localStartTime,
      });

      if (!customerName) {
        await upsertWhatsAppConversationState(clinic.id, input.phone, {
          currentIntent: null,
          step: 'awaiting_name',
          lastMessage: input.text,
          stateJson: null,
        });
        return 'Devam edebilmem için önce adınızı ve soyadınızı paylaşır mısınız?';
      }

      try {
        const appointment = await createAppointmentFromAssistant(
          clinic.id,
          input.phone,
          customerName,
          selectedAppointmentTypeId,
          selectedSlot
        );

        await resetWhatsAppConversationState(clinic.id, input.phone, customerName);

        return `Randevunuzu oluşturdum. ${selectedAppointmentTypeName ?? appointment.appointmentType.name} için ${formatTurkishDateLong(selectedDate, WHATSAPP_ASSISTANT_TIME_ZONE)} tarihinde saat ${selectedSlot.localStartTime} sizi planladım. Dilerseniz başka bir konuda da yardımcı olabilirim.`;
      } catch (error) {
        if (error instanceof Error && (error.message === 'APPOINTMENT_OUTSIDE_AVAILABILITY' || error.message === 'APPOINTMENT_OVERLAP')) {
          await upsertWhatsAppConversationState(clinic.id, input.phone, {
            customerName,
            currentIntent: 'book_appointment',
            step: 'awaiting_date',
            selectedAppointmentTypeId,
            selectedAppointmentTypeName,
            selectedDate: null,
            selectedTime: null,
            lastMessage: input.text,
            stateJson: null,
          });
          return 'Seçtiğiniz saat az önce dolmuş görünüyor. İsterseniz size hemen başka bir gün ya da saat önerebilirim.';
        }

        console.error('[whatsapp-assistant] appointment-create-error', error);
        return 'Randevunuzu oluştururken teknik bir sorun oluştu. Birkaç dakika sonra tekrar deneyebiliriz.';
      }
    }
  }

  await upsertWhatsAppConversationState(clinic.id, input.phone, {
    customerName,
    currentIntent: null,
    step: 'main_menu',
    lastMessage: input.text,
    stateJson: null,
  });

  return formatMainMenu(customerName, true);
};

// --- WhatsApp Public API (Secret Protected) ---

app.post('/api/public/whatsapp/evolution-webhook', optionalWhatsappWebhookSecret, async (req, res) => {
  const normalizedPayload = normalizeEvolutionWebhookPayload(req.body);

  if (normalizedPayload.event && normalizedPayload.event !== 'messages.upsert') {
    return res.status(200).json({ ignored: true, reason: 'unsupported_event' });
  }

  if (normalizedPayload.fromMe) {
    return res.status(200).json({ ignored: true, reason: 'from_me' });
  }

  if (!normalizedPayload.message) {
    return res.status(200).json({ ignored: true, reason: 'no_text_message' });
  }

  try {
    const responseText = await handleIncomingWhatsAppMessage(normalizedPayload.message);
    const clinic = await getDefaultClinic();
    const patient = clinic
      ? await findExistingPatientByPhone(clinic.id, normalizedPayload.message.phone)
      : null;
    await sendTextMessage(normalizedPayload.message.phone, responseText);
    if (clinic && patient) {
      await saveWhatsAppConversationMessage({
        clinicId: clinic.id,
        patientId: patient.id,
        phone: normalizedPayload.message.phone,
        direction: 'outgoing',
        text: responseText,
      });
    }
    console.info('[whatsapp-assistant] send-result', { phone: normalizedPayload.message.phone, instance: normalizedPayload.instance ?? null });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[whatsapp-assistant] webhook-error', error);
    res.status(500).json({ error: 'Failed to process Evolution webhook' });
  }
});

app.get('/api/public/whatsapp/services', authorizeWhatsappApi, async (_req, res) => {
  try {
    const clinic = await getDefaultClinic();
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

    const services = await prisma.appointmentType.findMany({
      where: { clinicId: clinic.id, isActive: true, isService: true },
      select: { id: true, name: true, durationMinutes: true, category: true, description: true },
      orderBy: { name: 'asc' },
    });

    res.json({ clinic: { id: clinic.id, name: clinic.name }, services });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch WhatsApp services' });
  }
});

app.get('/api/public/whatsapp/doctors', authorizeWhatsappApi, async (_req, res) => {
  try {
    const clinic = await getDefaultClinic();
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

    const doctors = await prisma.user.findMany({
      where: { clinicId: clinic.id, role: 'doctor', isActive: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    res.json({ clinic: { id: clinic.id, name: clinic.name }, doctors });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch WhatsApp doctors' });
  }
});

app.get('/api/public/whatsapp/availability', authorizeWhatsappApi, async (req, res) => {
  const validation = whatsappAvailabilityQuerySchema.safeParse(req.query);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    const clinic = await getDefaultClinic();
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

    const slots = await buildAvailableSlots(
      clinic.id,
      validation.data.appointmentTypeId,
      validation.data.date,
      validation.data.practitionerId
    );

    if (!slots) return res.status(404).json({ error: 'Service not found' });
    res.json({ clinic: { id: clinic.id, name: clinic.name }, slots });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch WhatsApp availability' });
  }
});

app.get('/api/public/whatsapp/appointment-lookup', authorizeWhatsappApi, async (req, res) => {
  const validation = whatsappAppointmentLookupQuerySchema.safeParse(req.query);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    const clinic = await getDefaultClinic();
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

    const appointments = await prisma.appointment.findMany({
      where: {
        clinicId: clinic.id,
        deletedAt: null,
        patient: {
          phone: validation.data.phone,
          deletedAt: null,
        },
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        status: true,
        appointmentType: {
          select: { id: true, name: true },
        },
        practitioner: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: { startTime: 'asc' },
      take: 10,
    });

    const timeZone = clinic.timezone || 'Europe/Istanbul';
    const results = appointments.map(appointment => {
      const start = formatClinicDateTime(appointment.startTime, timeZone);
      const end = formatClinicDateTime(appointment.endTime, timeZone);

      return {
        id: appointment.id,
        date: start.date,
        startTime: start.time,
        endTime: end.time,
        service: appointment.appointmentType ? {
          id: appointment.appointmentType.id,
          name: appointment.appointmentType.name,
        } : null,
        practitioner: appointment.practitioner ? {
          id: appointment.practitioner.id,
          name: `${appointment.practitioner.firstName} ${appointment.practitioner.lastName}`,
        } : null,
        status: appointment.status,
      };
    });

    res.json({
      clinic: { id: clinic.id, name: clinic.name },
      appointments: results,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to lookup WhatsApp appointments' });
  }
});

app.post('/api/public/whatsapp/appointment-requests', authorizeWhatsappApi, async (req, res) => {
  const validation = whatsappAppointmentRequestSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    const clinic = await getDefaultClinic();
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

    const existingPatient = await prisma.patient.findFirst({
      where: { clinicId: clinic.id, phone: validation.data.phone, deletedAt: null },
      select: { id: true },
    });

    if (validation.data.appointmentTypeId) {
      const service = await prisma.appointmentType.findFirst({
        where: { id: validation.data.appointmentTypeId, clinicId: clinic.id, isActive: true },
      });
      if (!service) return res.status(400).json({ error: 'Invalid appointment type' });
    }

    if (validation.data.practitionerId) {
      const practitioner = await prisma.user.findFirst({
        where: { id: validation.data.practitionerId, clinicId: clinic.id, role: 'doctor', isActive: true },
      });
      if (!practitioner) return res.status(400).json({ error: 'Invalid practitioner' });
    }

    const request = await prisma.appointmentRequest.create({
      data: {
        clinicId: clinic.id,
        patientId: existingPatient?.id,
        patientName: validation.data.patientName,
        phone: validation.data.phone,
        email: validation.data.email,
        appointmentTypeId: validation.data.appointmentTypeId,
        practitionerId: validation.data.practitionerId,
        preferredStartTime: validation.data.preferredStartTime,
        preferredEndTime: validation.data.preferredEndTime,
        requestType: validation.data.requestType,
        source: 'whatsapp',
        rawMessage: validation.data.rawMessage,
        notes: validation.data.notes,
      },
      include: {
        appointmentType: true,
        practitioner: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    res.status(201).json(request);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create WhatsApp appointment request' });
  }
});

app.post('/api/public/whatsapp/cancel-request', authorizeWhatsappApi, async (req, res) => {
  const validation = whatsappAppointmentRequestSchema.safeParse({ ...req.body, requestType: 'cancel' });
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    const clinic = await getDefaultClinic();
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

    const existingPatient = await prisma.patient.findFirst({
      where: { clinicId: clinic.id, phone: validation.data.phone, deletedAt: null },
      select: { id: true },
    });

    const request = await prisma.appointmentRequest.create({
      data: {
        clinicId: clinic.id,
        patientId: existingPatient?.id,
        patientName: validation.data.patientName,
        phone: validation.data.phone,
        email: validation.data.email,
        requestType: 'cancel',
        source: 'whatsapp',
        rawMessage: validation.data.rawMessage,
        notes: validation.data.notes,
      },
    });

    res.status(201).json(request);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create WhatsApp cancel request' });
  }
});

// --- Protected Routes (Clinic Scoped) ---

app.use('/api', authenticate as express.RequestHandler);

// Users API (Clinic Scoped)
app.get('/api/users', authorize(['admin', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { role } = req.query;

  try {
    const where: any = { clinicId };
    if (role) {
      where.role = String(role);
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { firstName: 'asc' },
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/users', authorize(['admin']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const validation = userCreateSchema.safeParse(req.body);

  if (!validation.success) {
    // Check if it's a password validation error
    const passwordError = validation.error.flatten();
    if (passwordError.fieldErrors.password) {
      const passwordValidation = validatePassword(req.body.password);
      if (!passwordValidation.valid) {
        return res.status(400).json({ 
          error: 'Password does not meet security requirements',
          details: passwordValidation.errors
        });
      }
    }
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    const existing = await prisma.user.findUnique({
      where: { email: validation.data.email },
    });

    if (existing) {
      return res.status(409).json({ error: 'Email is already in use' });
    }

    const passwordHash = await bcrypt.hash(validation.data.password, 12);
    const user = await prisma.user.create({
      data: {
        clinicId,
        firstName: validation.data.firstName,
        lastName: validation.data.lastName,
        email: validation.data.email,
        phone: validation.data.phone,
        role: validation.data.role,
        passwordHash,
        isActive: validation.data.isActive,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'user',
      entityId: user.id,
      action: 'created',
      description: `User ${user.email} created`,
    });

    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.put('/api/users/:id', authorize(['admin']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const validation = userUpdateSchema.safeParse(req.body);

  if (!validation.success) {
    // Check if it's a password validation error
    const passwordError = validation.error.flatten();
    if (passwordError.fieldErrors.password) {
      if (req.body.password) {
        const passwordValidation = validatePassword(req.body.password);
        if (!passwordValidation.valid) {
          return res.status(400).json({ 
            error: 'Password does not meet security requirements',
            details: passwordValidation.errors
          });
        }
      }
    }
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    const existing = await prisma.user.findFirst({
      where: { id, clinicId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (validation.data.email && validation.data.email !== existing.email) {
      const emailOwner = await prisma.user.findUnique({
        where: { email: validation.data.email },
      });
      if (emailOwner) {
        return res.status(409).json({ error: 'Email is already in use' });
      }
    }

    if (id === req.user!.id && validation.data.isActive === false) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }

    const { password, ...rest } = validation.data;
    const user = await prisma.user.update({
      where: { id },
      data: {
        ...rest,
        ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'user',
      entityId: user.id,
      action: 'updated',
      description: `User ${user.email} updated`,
    });

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.get('/api/doctor-availabilities', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;
  const requestedPractitionerId = req.query.practitionerId ? String(req.query.practitionerId) : undefined;
  const practitionerId = role === 'doctor' ? userId : requestedPractitionerId;

  try {
    const availabilities = await prisma.doctorAvailability.findMany({
      where: {
        clinicId,
        ...(practitionerId ? { practitionerId } : {}),
        practitioner: { role: 'doctor', isActive: true },
      },
      include: {
        practitioner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
            isActive: true,
          },
        },
      },
      orderBy: [
        { practitioner: { firstName: 'asc' } },
        { weekday: 'asc' },
        { startTime: 'asc' },
      ],
    });

    res.json(availabilities);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch doctor availabilities' });
  }
});

app.put('/api/doctor-availabilities/:practitionerId', authorize(['admin', 'doctor']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;
  const practitionerId = getParam(req, 'practitionerId');

  if (role === 'doctor' && practitionerId !== userId) {
    return res.status(403).json({ error: 'Doctors can only update their own availability' });
  }

  const validation = availabilityBatchSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    const practitioner = await prisma.user.findFirst({
      where: { id: practitionerId, clinicId, role: 'doctor', isActive: true },
    });

    if (!practitioner) {
      return res.status(404).json({ error: 'Practitioner not found' });
    }

    const updated = await prisma.$transaction(async tx => {
      await tx.doctorAvailability.deleteMany({
        where: { clinicId, practitionerId },
      });

      if (validation.data.slots.length > 0) {
        await tx.doctorAvailability.createMany({
          data: validation.data.slots.map(slot => ({
            clinicId,
            practitionerId,
            weekday: slot.weekday,
            startTime: slot.startTime,
            endTime: slot.endTime,
            isActive: slot.isActive,
          })),
        });
      }

      return tx.doctorAvailability.findMany({
        where: { clinicId, practitionerId },
        orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
      });
    });

    await logActivity({
      clinicId,
      userId,
      entityType: 'doctor_availability',
      entityId: practitionerId,
      action: 'updated',
      description: `Availability updated for ${practitioner.firstName} ${practitioner.lastName}`,
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update doctor availability' });
  }
});

// Dashboard Stats
app.get('/api/dashboard/stats', async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // 1. Stats Queries (Role-Aware)
    const statsPromises: any = {
      todayAppointments: prisma.appointment.count({
        where: { 
          clinicId, 
          startTime: { gte: today, lt: tomorrow }, 
          status: { not: 'cancelled' },
          ...(role === 'doctor' ? { practitionerId: userId } : {})
        },
      }),
      weekAppointments: prisma.appointment.count({
        where: { 
          clinicId, 
          startTime: { gte: weekStart }, 
          status: { not: 'cancelled' },
          ...(role === 'doctor' ? { practitionerId: userId } : {})
        },
      }),
      newPatientsMonth: prisma.patient.count({
        where: { clinicId, createdAt: { gte: firstDayOfMonth }, deletedAt: null },
      }),
      noShowsMonth: prisma.appointment.count({
        where: { 
          clinicId, 
          status: 'no_show', 
          startTime: { gte: firstDayOfMonth },
          ...(role === 'doctor' ? { practitionerId: userId } : {})
        },
      }),
      pendingTasks: prisma.task.count({
        where: { 
          clinicId, 
          status: { in: ['open', 'in_progress'] },
          ...(role === 'doctor' ? { assignedToId: userId } : {})
        },
      }),
      overdueTasks: prisma.task.count({
        where: { 
          clinicId, 
          status: { in: ['open', 'in_progress'] }, 
          dueDate: { lt: new Date() },
          ...(role === 'doctor' ? { assignedToId: userId } : {})
        },
      }),
      openTreatments: prisma.treatmentCase.count({
        where: { 
          clinicId, 
          stage: { notIn: ['completed', 'lost'] },
          ...(role === 'doctor' ? { practitionerId: userId } : {})
        },
      }),
      treatmentValues: prisma.treatmentCase.aggregate({
        where: { 
          clinicId, 
          stage: { notIn: ['completed', 'lost'] },
          ...(role === 'doctor' ? { practitionerId: userId } : {})
        },
        _sum: { estimatedAmount: true, acceptedAmount: true }
      }),
      monthlyRevenue: prisma.payment.aggregate({
        where: { 
          clinicId, 
          paymentStatus: { in: ['paid', 'partial'] },
          paidAt: { gte: firstDayOfMonth }
        },
        _sum: { amount: true }
      }),
      pendingPayments: prisma.payment.aggregate({
        where: { clinicId, paymentStatus: 'pending' },
        _sum: { amount: true }
      }),
      preparedMessagesWeek: prisma.sentMessage.count({
        where: { clinicId, status: 'prepared', createdAt: { gte: weekStart } }
      })
    };

    const results = await Promise.all(Object.values(statsPromises));
    const keys = Object.keys(statsPromises);
    const stats: any = {};
    keys.forEach((key, i) => { stats[key] = results[i]; });

    // 2. Today's Agenda
    const agenda = await prisma.appointment.findMany({
      where: {
        clinicId,
        startTime: { gte: today, lt: tomorrow },
        status: { not: 'cancelled' },
        ...(role === 'doctor' ? { practitionerId: userId } : {})
      },
      include: {
        patient: { select: { firstName: true, lastName: true, phone: true } },
        practitioner: { select: { firstName: true, lastName: true } },
        appointmentType: { select: { name: true, color: true } },
      },
      orderBy: { startTime: 'asc' },
      take: 10
    });

    // 3. Alerts
    const alerts: any[] = [];
    if (stats.overdueTasks > 0) {
      alerts.push({ type: 'danger', icon: 'Clock', title: 'overdueTasks', count: stats.overdueTasks, link: '/tasks?overdue=true' });
    }
    if (stats.noShowsMonth > 0) {
      alerts.push({ type: 'warning', icon: 'UserMinus', title: 'noShowFollowUp', count: stats.noShowsMonth, link: '/appointments?status=no_show' });
    }
    if (stats.pendingPayments._sum.amount > 0) {
      alerts.push({ type: 'info', icon: 'DollarSign', title: 'pendingCollections', value: stats.pendingPayments._sum.amount, link: '/payments?status=pending' });
    }

    // 4. Recent Activity
    const activities = await prisma.activityLog.findMany({
      where: { 
        clinicId,
        ...(role === 'doctor' ? { 
          OR: [
            { userId: userId },
            { entityType: 'appointment', appointment: { practitionerId: userId } },
            { entityType: 'treatment_case', treatmentCase: { practitionerId: userId } }
          ]
        } : {})
      },
      include: {
        user: { select: { firstName: true, lastName: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    res.json({
      stats: {
        todayAppointments: stats.todayAppointments,
        weekAppointments: stats.weekAppointments,
        newPatientsMonth: stats.newPatientsMonth,
        noShowsMonth: stats.noShowsMonth,
        pendingTasks: stats.pendingTasks,
        overdueTasks: stats.overdueTasks,
        openTreatments: stats.openTreatments,
        estimatedValue: stats.treatmentValues._sum.estimatedAmount || 0,
        acceptedValue: stats.treatmentValues._sum.acceptedAmount || 0,
        monthlyRevenue: stats.monthlyRevenue._sum.amount || 0,
        pendingAmount: stats.pendingPayments._sum.amount || 0,
        preparedMessages: stats.preparedMessagesWeek
      },
      agenda,
      alerts,
      activities
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// --- Patients API ---

// List Patients with Search & Filter
app.get('/api/patients', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { search, status, source, includeArchived } = req.query;

  try {
    const where: any = {
      clinicId,
      deletedAt: null,
    };

    if (search) {
      where.OR = [
        { firstName: { contains: String(search) } },
        { lastName: { contains: String(search) } },
        { email: { contains: String(search) } },
        { phone: { contains: String(search) } },
      ];
    }

    if (status) {
      where.patientStatus = String(status);
    } else if (includeArchived !== 'true') {
      where.patientStatus = { not: 'archived' };
    }

    if (source) {
      where.source = String(source);
    }

    const patients = await prisma.patient.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    res.json(patients);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

// Get Single Patient
app.get('/api/patients/:id', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const patient = await prisma.patient.findFirst({
      where: { id, clinicId, deletedAt: null },
      include: {
        appointments: {
          include: { practitioner: true, appointmentType: true },
          orderBy: { startTime: 'desc' },
        },
        activityLogs: {
          include: { user: true },
          orderBy: { createdAt: 'desc' },
        },
        whatsappConversationMessages: {
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        insuranceProvisions: {
          include: { treatmentCase: true, assignedTo: true },
          orderBy: { updatedAt: 'desc' },
        },
        // Placeholders
        treatmentCases: {
          where: { deletedAt: null },
          orderBy: { updatedAt: 'desc' },
        },
        tasks: {
          orderBy: { dueDate: 'asc' },
        },
        payments: {
          where: { paymentStatus: { not: 'cancelled' } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    res.json(patient);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch patient' });
  }
});

// Create Patient
app.post('/api/patients', authorize(['admin', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  
  const validation = patientSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    const patient = await prisma.patient.create({
      data: {
        ...validation.data,
        clinicId,
      },
    });

    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'patient',
      entityId: patient.id,
      action: 'created',
      description: `Patient ${patient.firstName} ${patient.lastName} created`,
    });

    res.json(patient);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create patient' });
  }
});

// Update Patient
app.put('/api/patients/:id', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;

  const validation = patientUpdateSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    // Check if patient exists and belongs to clinic
    const existingPatient = await prisma.patient.findFirst({
      where: { id, clinicId, deletedAt: null },
    });

    if (!existingPatient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    // RBAC: Doctor can only update if they have an appointment with this patient
    if (role === 'doctor') {
      const hasAppointment = await prisma.appointment.findFirst({
        where: { patientId: id, practitionerId: userId, clinicId },
      });
      if (!hasAppointment) {
        return res.status(403).json({ error: 'Forbidden: You can only update your own patients' });
      }
    }

    const patient = await prisma.patient.update({
      where: { id },
      data: validation.data,
    });

    await logActivity({
      clinicId,
      userId,
      entityType: 'patient',
      entityId: patient.id,
      action: 'updated',
      description: `Patient ${patient.firstName} ${patient.lastName} updated`,
    });

    res.json(patient);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update patient' });
  }
});

// Soft Delete / Archive Patient
app.delete('/api/patients/:id', authorize(['admin', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const patient = await prisma.patient.findFirst({
      where: { id, clinicId, deletedAt: null },
    });

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    await prisma.patient.update({
      where: { id },
      data: { patientStatus: 'archived', deletedAt: new Date() },
    });

    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'patient',
      entityId: id,
      action: 'archived',
      description: `Patient ${patient.firstName} ${patient.lastName} archived`,
    });

    res.json({ message: 'Patient archived successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to archive patient' });
  }
});

// --- Appointment Types / Clinic Services API ---

const getServicesHandler = async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { onlyActive, includeInactive } = req.query;

  try {
    const where: any = { clinicId };
    if (includeInactive !== 'true' && onlyActive !== 'false') {
      where.isActive = true;
    }

    const types = await prisma.appointmentType.findMany({
      where,
      orderBy: [
        { category: 'asc' },
        { name: 'asc' }
      ],
    });
    res.json(types);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch services' });
  }
};

const createServiceHandler = async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const validation = appointmentTypeSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    const clinic = await prisma.clinic.findUnique({ where: { id: clinicId } });
    const type = await prisma.appointmentType.create({
      data: {
        ...validation.data,
        clinicId,
        currency: validation.data.currency || clinic?.currency || 'USD',
        isService: validation.data.isService ?? true,
      },
    });
    
    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'setting',
      entityId: type.id,
      action: 'created',
      description: `Service "${type.name}" created`,
    });

    res.json(type);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create service' });
  }
};

const updateServiceHandler = async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const validation = appointmentTypeSchema.partial().safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    const existing = await prisma.appointmentType.findFirst({
      where: { id, clinicId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const type = await prisma.appointmentType.update({
      where: { id },
      data: validation.data,
    });

    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'setting',
      entityId: type.id,
      action: 'updated',
      description: `Service "${type.name}" updated`,
    });

    res.json(type);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update service' });
  }
};

app.get('/api/appointment-types', authorize(['admin', 'doctor', 'receptionist', 'billing']), getServicesHandler);
app.get('/api/services', authorize(['admin', 'doctor', 'receptionist', 'billing']), getServicesHandler);

app.post('/api/appointment-types', authorize(['admin', 'receptionist']), createServiceHandler);
app.post('/api/services', authorize(['admin', 'receptionist']), createServiceHandler);

app.put('/api/appointment-types/:id', authorize(['admin', 'receptionist']), updateServiceHandler);
app.put('/api/services/:id', authorize(['admin', 'receptionist']), updateServiceHandler);

// --- Appointment Requests API ---

app.get('/api/appointment-requests', authorize(['admin', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { status, requestType, source } = req.query;

  try {
    const requests = await prisma.appointmentRequest.findMany({
      where: {
        clinicId,
        ...(status ? { status: String(status) } : {}),
        ...(requestType ? { requestType: String(requestType) } : {}),
        ...(source ? { source: String(source) } : {}),
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        appointmentType: true,
        practitioner: { select: { id: true, firstName: true, lastName: true } },
        convertedAppointment: { select: { id: true, startTime: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch appointment requests' });
  }
});

app.put('/api/appointment-requests/:id/status', authorize(['admin', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const id = getParam(req, 'id');
  const validation = appointmentRequestStatusSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    const existing = await prisma.appointmentRequest.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Appointment request not found' });
    if (existing.status === 'converted') {
      return res.status(400).json({ error: 'Converted requests cannot be changed from this endpoint' });
    }

    const updated = await prisma.appointmentRequest.update({
      where: { id },
      data: {
        status: validation.data.status,
        notes: validation.data.notes ?? existing.notes,
        rejectionReason: validation.data.rejectionReason,
      },
      include: {
        appointmentType: true,
        practitioner: { select: { id: true, firstName: true, lastName: true } },
        convertedAppointment: { select: { id: true, startTime: true, status: true } },
      },
    });

    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'appointment_request',
      entityId: id,
      action: validation.data.status,
      description: `WhatsApp appointment request marked as ${validation.data.status}`,
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update appointment request' });
  }
});

app.post('/api/appointment-requests/:id/convert', authorize(['admin', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const id = getParam(req, 'id');
  const validation = appointmentRequestConvertSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    const request = await prisma.appointmentRequest.findFirst({
      where: { id, clinicId },
      include: { patient: true },
    });

    if (!request) return res.status(404).json({ error: 'Appointment request not found' });
    if (request.status === 'converted') return res.status(400).json({ error: 'Appointment request is already converted' });
    if (request.requestType === 'cancel') return res.status(400).json({ error: 'Cancel requests cannot be converted to appointments' });

    const appointmentTypeId = validation.data.appointmentTypeId || request.appointmentTypeId;
    const practitionerId = validation.data.practitionerId || request.practitionerId;
    const startTime = validation.data.startTime || request.preferredStartTime;
    const endTime = validation.data.endTime || request.preferredEndTime;

    if (!appointmentTypeId || !practitionerId || !startTime || !endTime) {
      return res.status(400).json({ error: 'Service, practitioner, start time, and end time are required for conversion' });
    }

    const [service, practitioner] = await Promise.all([
      prisma.appointmentType.findFirst({ where: { id: appointmentTypeId, clinicId, isActive: true } }),
      prisma.user.findFirst({ where: { id: practitionerId, clinicId, role: 'doctor', isActive: true } }),
    ]);

    if (!service) return res.status(400).json({ error: 'Invalid appointment type' });
    if (!practitioner) return res.status(400).json({ error: 'Invalid practitioner' });

    let patientId = validation.data.patientId || request.patientId;
    if (patientId) {
      const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId, deletedAt: null } });
      if (!patient) return res.status(400).json({ error: 'Invalid patient' });
    } else {
      const [firstName, ...lastNameParts] = request.patientName.trim().split(/\s+/);
      const patient = await prisma.patient.create({
        data: {
          clinicId,
          firstName: firstName || request.patientName,
          lastName: lastNameParts.join(' ') || '-',
          phone: request.phone,
          email: request.email,
          source: 'whatsapp',
          communicationConsent: true,
          notes: 'WhatsApp randevu talebinden oluşturuldu.',
        },
      });
      patientId = patient.id;
    }

    const availability = await checkPractitionerAvailability(clinicId, practitionerId, startTime, endTime);
    if (!availability.ok) {
      return res.status(409).json({
        error: 'Appointment is outside practitioner availability',
        code: 'APPOINTMENT_OUTSIDE_AVAILABILITY',
        availability: availability.slots,
      });
    }

    const overlap = await prisma.appointment.findFirst({
      where: {
        clinicId,
        practitionerId,
        deletedAt: null,
        status: { notIn: ['cancelled'] },
        OR: [{ startTime: { lt: endTime }, endTime: { gt: startTime } }],
      },
    });

    if (overlap) {
      return res.status(409).json({
        error: 'Practitioner already has an appointment during this time',
        code: 'APPOINTMENT_OVERLAP',
      });
    }

    const appointment = await prisma.appointment.create({
      data: {
        clinicId,
        patientId,
        practitionerId,
        appointmentTypeId,
        startTime,
        endTime,
        status: 'scheduled',
        notes: validation.data.notes || request.notes || 'WhatsApp randevu talebinden oluşturuldu.',
        createdById: req.user!.id,
      },
      include: { patient: true, practitioner: true, appointmentType: true },
    });

    const updatedRequest = await prisma.appointmentRequest.update({
      where: { id },
      data: {
        status: 'converted',
        patientId,
        convertedAppointmentId: appointment.id,
        notes: validation.data.notes ?? request.notes,
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
        appointmentType: true,
        practitioner: { select: { id: true, firstName: true, lastName: true } },
        convertedAppointment: { select: { id: true, startTime: true, status: true } },
      },
    });

    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'appointment_request',
      entityId: id,
      action: 'converted',
      description: `WhatsApp appointment request converted to appointment`,
      appointmentId: appointment.id,
    });

    res.status(201).json({ appointment, request: updatedRequest });
  } catch (error) {
    res.status(500).json({ error: 'Failed to convert appointment request' });
  }
});

// --- Appointments API ---

// List Appointments with Search & Filters
app.get('/api/appointments', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;
  const { start, end, status, practitionerId, patientId, search } = req.query;

  try {
    const where: any = { 
      clinicId, 
      deletedAt: null 
    };
    
    // Scoping for doctors
    if (role === 'doctor') {
      where.practitionerId = userId;
    } else if (practitionerId) {
      where.practitionerId = String(practitionerId);
    }

    if (patientId) where.patientId = String(patientId);
    if (status) where.status = String(status);
    
    if (start || end) {
      where.startTime = {};
      if (start) where.startTime.gte = new Date(String(start));
      if (end) where.startTime.lte = new Date(String(end));
    }

    if (search) {
      where.patient = {
        OR: [
          { firstName: { contains: String(search) } },
          { lastName: { contains: String(search) } },
        ],
      };
    }

    const appointments = await prisma.appointment.findMany({
      where,
      include: {
        patient: true,
        practitioner: true,
        appointmentType: true,
      },
      orderBy: { startTime: 'asc' },
    });
    res.json(appointments);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// Get Single Appointment
app.get('/api/appointments/:id', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;

  try {
    const appointment = await prisma.appointment.findFirst({
      where: { id, clinicId, deletedAt: null },
      include: {
        patient: true,
        practitioner: true,
        appointmentType: true,
        activityLogs: {
          include: { user: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    // Doctor scoping
    if (role === 'doctor' && appointment.practitionerId !== userId) {
      return res.status(403).json({ error: 'Forbidden: Access to other doctors appointments is restricted' });
    }

    res.json(appointment);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch appointment' });
  }
});

// Create Appointment
app.post('/api/appointments', authorize(['admin', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const validation = appointmentSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  const { patientId, practitionerId, appointmentTypeId, startTime, endTime } = validation.data;

  try {
    // 1. Validate Scoping (Patient, Practitioner, Type)
    const [patient, practitioner, type] = await Promise.all([
      prisma.patient.findFirst({ where: { id: patientId, clinicId, deletedAt: null } }),
      prisma.user.findFirst({ where: { id: practitionerId, clinicId, role: 'doctor' } }),
      prisma.appointmentType.findFirst({ where: { id: appointmentTypeId, clinicId, isActive: true } }),
    ]);

    if (!patient) return res.status(400).json({ error: 'Invalid patient' });
    if (!practitioner) return res.status(400).json({ error: 'Invalid practitioner' });
    if (!type) return res.status(400).json({ error: 'Invalid appointment type' });

    const availability = await checkPractitionerAvailability(clinicId, practitionerId, startTime, endTime);
    if (!availability.ok) {
      return res.status(409).json({
        error: 'Appointment is outside practitioner availability',
        code: 'APPOINTMENT_OUTSIDE_AVAILABILITY',
        availability: availability.slots,
      });
    }

    // 2. Overlap Protection
    const overlap = await prisma.appointment.findFirst({
      where: {
        clinicId,
        practitionerId,
        deletedAt: null,
        status: { notIn: ['cancelled'] },
        OR: [
          { startTime: { lt: endTime }, endTime: { gt: startTime } },
        ],
      },
    });

    if (overlap) {
      return res.status(409).json({ 
        error: 'Practitioner already has an appointment during this time',
        code: 'APPOINTMENT_OVERLAP' 
      });
    }

    // 3. Create
    const appointment = await prisma.appointment.create({
      data: {
        ...validation.data,
        clinicId,
      },
      include: { patient: true, practitioner: true, appointmentType: true },
    });

    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'appointment',
      entityId: appointment.id,
      action: 'created',
      description: `Appointment created for ${patient.firstName} ${patient.lastName} with Dr. ${practitioner.lastName}`,
    });

    res.json(appointment);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create appointment' });
  }
});

// Update Appointment / Status
app.put('/api/appointments/:id', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;
  
  const validation = appointmentUpdateSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    const existing = await prisma.appointment.findFirst({
      where: { id, clinicId, deletedAt: null },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    // RBAC
    if (role === 'doctor' && existing.practitionerId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    // Billing restriction (handled by authorize, but good to remember)

    // Status Workflow Validation
    if (validation.data.status && validation.data.status !== existing.status) {
      const validTransitions: Record<string, string[]> = {
        'scheduled': ['confirmed', 'cancelled', 'rescheduled', 'no_show', 'completed'],
        'confirmed': ['completed', 'cancelled', 'rescheduled', 'no_show'],
        'rescheduled': ['confirmed', 'cancelled', 'no_show', 'completed'],
        'completed': [], // Terminal
        'cancelled': [], // Terminal
        'no_show': ['rescheduled', 'cancelled'],
      };

      if (!validTransitions[existing.status].includes(validation.data.status)) {
        return res.status(400).json({ error: `Invalid status transition from ${existing.status} to ${validation.data.status}` });
      }

      // Doctors can only mark as completed
      if (role === 'doctor' && validation.data.status !== 'completed') {
        return res.status(403).json({ error: 'Doctors can only mark appointments as completed' });
      }
    }

    const nextPractitionerId = validation.data.practitionerId || existing.practitionerId;
    const nextStartTime = validation.data.startTime || existing.startTime;
    const nextEndTime = validation.data.endTime || existing.endTime;
    const timeOrPractitionerChanged =
      nextPractitionerId !== existing.practitionerId ||
      nextStartTime.getTime() !== existing.startTime.getTime() ||
      nextEndTime.getTime() !== existing.endTime.getTime();

    if (timeOrPractitionerChanged) {
      const availability = await checkPractitionerAvailability(clinicId, nextPractitionerId, nextStartTime, nextEndTime);
      if (!availability.ok) {
        return res.status(409).json({
          error: 'Appointment is outside practitioner availability',
          code: 'APPOINTMENT_OUTSIDE_AVAILABILITY',
          availability: availability.slots,
        });
      }

      const overlap = await prisma.appointment.findFirst({
        where: {
          id: { not: id },
          clinicId,
          practitionerId: nextPractitionerId,
          deletedAt: null,
          status: { notIn: ['cancelled'] },
          OR: [
            { startTime: { lt: nextEndTime }, endTime: { gt: nextStartTime } },
          ],
        },
      });

      if (overlap) {
        return res.status(409).json({ error: 'Overlap detected with another appointment' });
      }
    }

    const updated = await prisma.appointment.update({
      where: { id },
      data: validation.data,
      include: { patient: true, practitioner: true },
    });

    if (validation.data.status && validation.data.status !== existing.status) {
      await logActivity({
        clinicId,
        userId,
        entityType: 'appointment',
        entityId: id,
        action: validation.data.status,
        description: `Appointment status changed from ${existing.status} to ${validation.data.status}`,
      });
    } else {
      await logActivity({
        clinicId,
        userId,
        entityType: 'appointment',
        entityId: id,
        action: 'updated',
        description: `Appointment details updated`,
      });
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update appointment' });
  }
});

// --- Tasks API ---

app.get('/api/tasks', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;
  const { status, priority, assignedToId, patientId, overdue, dueToday, search } = req.query;

  try {
    const where: any = { clinicId };
    
    // Scoping
    if (role === 'doctor') {
      where.OR = [
        { assignedToId: userId },
        { patient: { appointments: { some: { practitionerId: userId } } } }
      ];
    } else if (assignedToId) {
      where.assignedToId = String(assignedToId);
    }

    if (status) where.status = String(status);
    if (priority) where.priority = String(priority);
    if (patientId) where.patientId = String(patientId);

    const now = new Date();
    if (overdue === 'true') {
      where.dueDate = { lt: now };
      where.status = { notIn: ['completed', 'cancelled'] };
    } else if (dueToday === 'true') {
      const todayEnd = new Date(now);
      todayEnd.setHours(23, 59, 59, 999);
      where.dueDate = { gte: now, lte: todayEnd };
    }

    if (search) {
      where.title = { contains: String(search) };
    }

    const tasks = await prisma.task.findMany({
      where,
      include: {
        patient: true,
        assignedTo: true,
        createdBy: true,
        appointment: true,
      },
      orderBy: { dueDate: 'asc' },
    });
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

app.get('/api/tasks/:id', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;

  try {
    const task = await prisma.task.findFirst({
      where: { id, clinicId },
      include: {
        patient: true,
        assignedTo: true,
        createdBy: true,
        appointment: true,
      },
    });

    if (!task) return res.status(404).json({ error: 'Task not found' });

    // Doctor scoping
    if (role === 'doctor' && task.assignedToId !== userId) {
      // Check if linked to doctor's patient
      const hasAccess = await prisma.appointment.findFirst({
        where: { patientId: task.patientId || '', practitionerId: userId, clinicId }
      });
      if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(task);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

app.post('/api/tasks', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const validation = taskSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    // Validate relations
    if (validation.data.patientId) {
      const patient = await prisma.patient.findFirst({ where: { id: validation.data.patientId, clinicId } });
      if (!patient) return res.status(400).json({ error: 'Invalid patient' });
    }
    if (validation.data.appointmentId) {
      const appt = await prisma.appointment.findFirst({ where: { id: validation.data.appointmentId, clinicId } });
      if (!appt) return res.status(400).json({ error: 'Invalid appointment' });
    }
    const assignee = await prisma.user.findFirst({ where: { id: validation.data.assignedToId, clinicId } });
    if (!assignee) return res.status(400).json({ error: 'Invalid assignee' });

    const task = await prisma.task.create({
      data: {
        ...validation.data,
        clinicId,
        createdById: req.user!.id,
      },
    });

    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'task',
      entityId: task.id,
      action: 'created',
      description: `Task "${task.title}" created and assigned to ${assignee.firstName}`,
    });

    res.json(task);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create task' });
  }
});

app.put('/api/tasks/:id', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;
  
  const validation = taskSchema.partial().safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    const existing = await prisma.task.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Task not found' });

    // RBAC: Doctor can only update if assigned to them or if they are the creator
    if (role === 'doctor' && existing.assignedToId !== userId && existing.createdById !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const updated = await prisma.task.update({
      where: { id },
      data: {
        ...validation.data,
        completedAt: validation.data.status === 'completed' && existing.status !== 'completed' ? new Date() : existing.completedAt,
      },
    });

    // Logging reassign
    if (validation.data.assignedToId && validation.data.assignedToId !== existing.assignedToId) {
      await logActivity({
        clinicId,
        userId,
        entityType: 'task',
        entityId: id,
        action: 'reassigned',
        description: `Task "${updated.title}" reassigned`,
      });
    }

    // Logging status change
    if (validation.data.status && validation.data.status !== existing.status) {
      await logActivity({
        clinicId,
        userId,
        entityType: 'task',
        entityId: id,
        action: validation.data.status,
        description: `Task "${updated.title}" marked as ${validation.data.status}`,
      });
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update task' });
  }
});

app.patch('/api/tasks/:id/complete', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { id: userId } = req.user!;

  try {
    const task = await prisma.task.findFirst({ where: { id, clinicId } });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const updated = await prisma.task.update({
      where: { id },
      data: { status: 'completed', completedAt: new Date() },
    });

    await logActivity({
      clinicId,
      userId,
      entityType: 'task',
      entityId: id,
      action: 'completed',
      description: `Task "${task.title}" completed`,
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to complete task' });
  }
});

// --- Treatment Cases API ---

app.get('/api/treatment-cases', authorize(['admin', 'doctor', 'receptionist', 'billing']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;
  const { stage, patientId, practitionerId, minAmount, maxAmount, openOnly, closedOnly, search } = req.query;

  try {
    const where: any = { clinicId, deletedAt: null };
    
    // Scoping
    if (role === 'doctor') {
      where.OR = [
        { practitionerId: userId },
        { patient: { appointments: { some: { practitionerId: userId } } } }
      ];
    } else if (practitionerId) {
      where.practitionerId = String(practitionerId);
    }

    if (stage) where.stage = String(stage);
    if (patientId) where.patientId = String(patientId);
    
    if (openOnly === 'true') {
      where.stage = { notIn: ['completed', 'lost'] };
    } else if (closedOnly === 'true') {
      where.stage = { in: ['completed', 'lost'] };
    }

    if (minAmount || maxAmount) {
      where.estimatedAmount = {};
      if (minAmount) where.estimatedAmount.gte = Number(minAmount);
      if (maxAmount) where.estimatedAmount.lte = Number(maxAmount);
    }

    if (search) {
      where.title = { contains: String(search) };
    }

    const cases = await prisma.treatmentCase.findMany({
      where,
      include: {
        patient: true,
        practitioner: true,
        appointmentType: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(cases);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch treatment cases' });
  }
});

app.get('/api/treatment-cases/:id', authorize(['admin', 'doctor', 'receptionist', 'billing']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;

  try {
    const tCase = await prisma.treatmentCase.findFirst({
      where: { id, clinicId, deletedAt: null },
      include: {
        patient: true,
        practitioner: true,
        appointmentType: true,
        tasks: { include: { assignedTo: true }, orderBy: { dueDate: 'asc' } },
        activityLogs: { include: { user: true }, orderBy: { createdAt: 'desc' } },
        payments: { where: { paymentStatus: { not: 'cancelled' } } },
        insuranceProvisions: { include: { patient: true, assignedTo: true }, orderBy: { updatedAt: 'desc' } },
      },
    });

    if (!tCase) return res.status(404).json({ error: 'Treatment case not found' });

    // Scoping
    if (role === 'doctor' && tCase.practitionerId !== userId) {
      const hasAccess = await prisma.appointment.findFirst({
        where: { patientId: tCase.patientId, practitionerId: userId, clinicId }
      });
      if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(tCase);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch treatment case' });
  }
});

app.post('/api/treatment-cases', authorize(['admin', 'receptionist', 'doctor']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const validation = treatmentCaseSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    // Validate relations
    const patient = await prisma.patient.findFirst({ where: { id: validation.data.patientId, clinicId } });
    if (!patient) return res.status(400).json({ error: 'Invalid patient' });

    if (validation.data.practitionerId) {
      const practitioner = await prisma.user.findFirst({ where: { id: validation.data.practitionerId, clinicId, role: 'doctor' } });
      if (!practitioner) return res.status(400).json({ error: 'Invalid practitioner' });
    }

    if (validation.data.appointmentTypeId) {
      const service = await prisma.appointmentType.findFirst({
        where: { id: validation.data.appointmentTypeId, clinicId, isActive: true },
      });
      if (!service) return res.status(400).json({ error: 'Invalid service' });
    }

    const tCase = await prisma.treatmentCase.create({
      data: {
        ...validation.data,
        clinicId,
        createdById: req.user!.id,
      },
    });

    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'treatment_case',
      entityId: tCase.id,
      action: 'created',
      description: `Treatment case "${tCase.title}" created for ${patient.firstName} ${patient.lastName}`,
    });

    res.json(tCase);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create treatment case' });
  }
});

app.put('/api/treatment-cases/:id', authorize(['admin', 'receptionist', 'doctor']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;
  
  const validation = treatmentCaseSchema.partial().safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    const existing = await prisma.treatmentCase.findFirst({ where: { id, clinicId, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: 'Treatment case not found' });

    // RBAC
    if (role === 'doctor' && existing.practitionerId !== userId && existing.createdById !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (validation.data.practitionerId) {
      const practitioner = await prisma.user.findFirst({ where: { id: validation.data.practitionerId, clinicId, role: 'doctor' } });
      if (!practitioner) return res.status(400).json({ error: 'Invalid practitioner' });
    }

    if (validation.data.appointmentTypeId) {
      const service = await prisma.appointmentType.findFirst({
        where: { id: validation.data.appointmentTypeId, clinicId, isActive: true },
      });
      if (!service) return res.status(400).json({ error: 'Invalid service' });
    }

    // Workflow Logic for stage
    if (validation.data.stage && validation.data.stage !== existing.stage) {
       // Terminal checks
       if (['completed', 'lost'].includes(existing.stage) && role !== 'admin') {
         return res.status(400).json({ error: 'Cannot reopen closed treatment cases' });
       }
       
       if (validation.data.stage === 'lost' && !validation.data.lostReason && !existing.lostReason) {
         return res.status(400).json({ error: 'Lost reason is required when marking as lost' });
       }
    }

    const updateData: any = { ...validation.data };
    if (validation.data.stage === 'completed' || validation.data.stage === 'lost') {
      updateData.closedAt = new Date();
    }

    const updated = await prisma.treatmentCase.update({
      where: { id },
      data: updateData,
    });

    // Logging
    if (validation.data.stage && validation.data.stage !== existing.stage) {
      await logActivity({
        clinicId,
        userId,
        entityType: 'treatment_case',
        entityId: id,
        action: `stage_${validation.data.stage}`,
        description: `Treatment case stage changed from ${existing.stage} to ${validation.data.stage}`,
      });
    }

    if (validation.data.acceptedAmount && validation.data.acceptedAmount !== existing.acceptedAmount) {
      await logActivity({
        clinicId,
        userId,
        entityType: 'treatment_case',
        entityId: id,
        action: 'amount_updated',
        description: `Accepted amount updated to ${validation.data.acceptedAmount} ${updated.currency}`,
      });
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update treatment case' });
  }
});

// --- Insurance Provisions API (Manual Tracking Only) ---

const insuranceInclude = {
  patient: { select: { id: true, firstName: true, lastName: true } },
  treatmentCase: { select: { id: true, title: true, estimatedAmount: true, currency: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true, role: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
};

const getInsuranceDoctorScope = (userId: string) => ({
  OR: [
    { treatmentCase: { practitionerId: userId } },
    { patient: { appointments: { some: { practitionerId: userId } } } },
  ],
});

async function validateInsuranceRelations(data: any, clinicId: string) {
  const patient = data.patientId
    ? await prisma.patient.findFirst({ where: { id: data.patientId, clinicId, deletedAt: null } })
    : null;
  if (data.patientId && !patient) return { error: 'Invalid patient' };

  if (data.treatmentCaseId) {
    const treatmentCase = await prisma.treatmentCase.findFirst({
      where: {
        id: data.treatmentCaseId,
        clinicId,
        deletedAt: null,
        ...(data.patientId ? { patientId: data.patientId } : {}),
      },
    });
    if (!treatmentCase) return { error: 'Invalid treatment case' };
  }

  if (data.assignedToId) {
    const assignee = await prisma.user.findFirst({ where: { id: data.assignedToId, clinicId, isActive: true } });
    if (!assignee) return { error: 'Invalid assignee' };
  }

  return { patient };
}

app.get('/api/insurance-provisions', authorize(['admin', 'receptionist', 'billing', 'doctor']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;
  const { status, insurance_type, patient_id, treatment_case_id, provider_name } = req.query;

  try {
    const where: any = { clinicId };
    if (role === 'doctor') Object.assign(where, getInsuranceDoctorScope(userId));
    if (status) where.status = String(status);
    if (insurance_type) where.insuranceType = String(insurance_type);
    if (patient_id) where.patientId = String(patient_id);
    if (treatment_case_id) where.treatmentCaseId = String(treatment_case_id);
    if (provider_name) where.insuranceProviderName = { contains: String(provider_name) };

    const provisions = await prisma.insuranceProvision.findMany({
      where,
      include: insuranceInclude,
      orderBy: { updatedAt: 'desc' },
    });

    res.json(provisions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch insurance provisions' });
  }
});

app.get('/api/insurance-provisions/:id', authorize(['admin', 'receptionist', 'billing', 'doctor']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;

  try {
    const where: any = { id, clinicId };
    if (role === 'doctor') Object.assign(where, getInsuranceDoctorScope(userId));

    const provision = await prisma.insuranceProvision.findFirst({
      where,
      include: {
        ...insuranceInclude,
        activityLogs: { include: { user: true }, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!provision) return res.status(404).json({ error: 'Insurance provision not found' });
    res.json(provision);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch insurance provision' });
  }
});

app.post('/api/insurance-provisions', authorize(['admin', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const validation = insuranceProvisionSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const relationValidation = await validateInsuranceRelations(validation.data, clinicId);
    if (relationValidation.error) return res.status(400).json({ error: relationValidation.error });

    const provision = await prisma.insuranceProvision.create({
      data: {
        ...validation.data,
        clinicId,
        createdById: req.user!.id,
      },
      include: insuranceInclude,
    });

    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'insurance_provision',
      entityId: provision.id,
      patientId: provision.patientId,
      treatmentCaseId: provision.treatmentCaseId,
      action: 'created',
      description: `Insurance provision created for ${provision.insuranceProviderName}`,
    });

    res.json(provision);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create insurance provision' });
  }
});

app.put('/api/insurance-provisions/:id', authorize(['admin', 'receptionist', 'billing']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;

  const validation = insuranceProvisionUpdateSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const existing = await prisma.insuranceProvision.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Insurance provision not found' });

    const updateData: any = { ...validation.data };
    if (role === 'billing') {
      const allowed = ['status', 'approvedAmount', 'patientResponsibilityAmount', 'currency', 'respondedAt', 'rejectionReason', 'notes', 'provisionNumber'];
      for (const key of Object.keys(updateData)) {
        if (!allowed.includes(key)) delete updateData[key];
      }
    }

    const relationValidation = await validateInsuranceRelations(
      { ...existing, ...updateData, patientId: updateData.patientId || existing.patientId },
      clinicId,
    );
    if (relationValidation.error) return res.status(400).json({ error: relationValidation.error });

    const updated = await prisma.insuranceProvision.update({
      where: { id },
      data: updateData,
      include: insuranceInclude,
    });

    await logActivity({
      clinicId,
      userId,
      entityType: 'insurance_provision',
      entityId: id,
      patientId: updated.patientId,
      treatmentCaseId: updated.treatmentCaseId,
      action: updated.status !== existing.status ? `status_${updated.status}` : 'updated',
      description: updated.status !== existing.status
        ? `Insurance provision status changed from ${existing.status} to ${updated.status}`
        : `Insurance provision updated for ${updated.insuranceProviderName}`,
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update insurance provision' });
  }
});

app.patch('/api/insurance-provisions/:id/status', authorize(['admin', 'receptionist', 'billing']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { id: userId } = req.user!;
  const validation = insuranceStatusSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const existing = await prisma.insuranceProvision.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Insurance provision not found' });

    const status = validation.data.status;
    const updated = await prisma.insuranceProvision.update({
      where: { id },
      data: {
        ...validation.data,
        respondedAt: validation.data.respondedAt || (['approved', 'partially_approved', 'rejected'].includes(status) ? new Date() : undefined),
      },
      include: insuranceInclude,
    });

    await logActivity({
      clinicId,
      userId,
      entityType: 'insurance_provision',
      entityId: id,
      patientId: updated.patientId,
      treatmentCaseId: updated.treatmentCaseId,
      action: `status_${status}`,
      description: `Insurance provision status changed from ${existing.status} to ${status}`,
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update insurance provision status' });
  }
});

app.patch('/api/insurance-provisions/:id/cancel', authorize(['admin', 'receptionist', 'billing']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { id: userId } = req.user!;

  try {
    const existing = await prisma.insuranceProvision.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Insurance provision not found' });

    const updated = await prisma.insuranceProvision.update({
      where: { id },
      data: { status: 'cancelled' },
      include: insuranceInclude,
    });

    await logActivity({
      clinicId,
      userId,
      entityType: 'insurance_provision',
      entityId: id,
      patientId: updated.patientId,
      treatmentCaseId: updated.treatmentCaseId,
      action: 'status_cancelled',
      description: `Insurance provision cancelled for ${updated.insuranceProviderName}`,
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to cancel insurance provision' });
  }
});

// --- Payments API ---

app.get('/api/payments', authorize(['admin', 'billing', 'receptionist', 'doctor']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { role, id: userId } = req.user!;
  const { patientId, treatmentCaseId, paymentStatus, paymentMethod, dateFrom, dateTo } = req.query;

  try {
    const where: any = { clinicId };
    
    // RBAC: Doctor scoping
    if (role === 'doctor') {
      where.OR = [
        { patient: { appointments: { some: { practitionerId: userId } } } },
        { treatmentCase: { practitionerId: userId } }
      ];
    }

    if (patientId) where.patientId = String(patientId);
    if (treatmentCaseId) where.treatmentCaseId = String(treatmentCaseId);
    if (paymentStatus) where.paymentStatus = String(paymentStatus);
    if (paymentMethod) where.paymentMethod = String(paymentMethod);

    if (dateFrom || dateTo) {
      where.paidAt = {};
      if (dateFrom) where.paidAt.gte = new Date(String(dateFrom));
      if (dateTo) where.paidAt.lte = new Date(String(dateTo));
    }

    const payments = await prisma.payment.findMany({
      where,
      include: {
        patient: true,
        treatmentCase: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

app.post('/api/payments', authorize(['admin', 'billing', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const validation = paymentSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    // Validate patient
    const patient = await prisma.patient.findFirst({ where: { id: validation.data.patientId, clinicId } });
    if (!patient) return res.status(400).json({ error: 'Invalid patient' });

    // Validate treatment case
    if (validation.data.treatmentCaseId) {
      const tc = await prisma.treatmentCase.findFirst({ 
        where: { id: validation.data.treatmentCaseId, clinicId, patientId: validation.data.patientId } 
      });
      if (!tc) return res.status(400).json({ error: 'Invalid treatment case' });
    }

    const payment = await prisma.payment.create({
      data: {
        ...validation.data,
        clinicId,
        createdById: req.user!.id,
      },
    });

    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'payment',
      entityId: payment.id,
      action: 'created',
      description: `Payment of ${payment.amount} ${payment.currency} recorded for ${patient.firstName} ${patient.lastName}`,
    });

    res.json(payment);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create payment' });
  }
});

app.put('/api/payments/:id', authorize(['admin', 'billing']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  
  const validation = paymentSchema.partial().safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    const existing = await prisma.payment.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Payment not found' });

    const updated = await prisma.payment.update({
      where: { id },
      data: validation.data,
    });

    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'payment',
      entityId: id,
      action: 'updated',
      description: `Payment ${id} updated`,
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update payment' });
  }
});

app.patch('/api/payments/:id/cancel', authorize(['admin', 'billing']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const existing = await prisma.payment.findFirst({ where: { id, clinicId } });
    if (!existing) return res.status(404).json({ error: 'Payment not found' });

    const updated = await prisma.payment.update({
      where: { id },
      data: { paymentStatus: 'cancelled' },
    });

    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'payment',
      entityId: id,
      action: 'cancelled',
      description: `Payment of ${existing.amount} ${existing.currency} cancelled`,
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to cancel payment' });
  }
});
// --- Message Templates API ---

app.get('/api/message-templates', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { channel, language, isActive } = req.query;

  try {
    const where: any = { clinicId };
    if (channel) where.channel = String(channel);
    if (language) where.language = String(language);
    if (isActive === 'true') where.isActive = true;
    else if (isActive === 'false') where.isActive = false;

    const templates = await prisma.messageTemplate.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    res.json(templates);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

app.post('/api/message-templates', authorize(['admin', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const validation = messageTemplateSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    const template = await prisma.messageTemplate.create({
      data: {
        ...validation.data,
        clinicId,
        createdById: req.user!.id,
      },
    });

    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'message_template',
      entityId: template.id,
      action: 'created',
      description: `Template "${template.name}" created`,
    });

    res.json(template);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create template' });
  }
});

app.put('/api/message-templates/:id', authorize(['admin', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const validation = messageTemplateSchema.partial().safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  try {
    const template = await prisma.messageTemplate.update({
      where: { id, clinicId },
      data: validation.data,
    });

    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'message_template',
      entityId: id,
      action: 'updated',
      description: `Template "${template.name}" updated`,
    });

    res.json(template);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// --- Messages API ---

async function renderTemplate(text: string, context: any) {
  let rendered = text;
  const vars = {
    patient_name: context.patient ? `${context.patient.firstName} ${context.patient.lastName}` : '',
    clinic_name: context.clinic?.name || '',
    appointment_date: context.appointment ? new Date(context.appointment.startTime).toLocaleDateString() : '',
    appointment_time: context.appointment ? new Date(context.appointment.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
    practitioner_name: context.appointment?.practitioner ? `Dr. ${context.appointment.practitioner.firstName} ${context.appointment.practitioner.lastName}` : '',
    treatment_title: context.treatmentCase?.title || '',
    remaining_balance: context.remainingBalance !== undefined ? `${context.remainingBalance} ${context.clinic?.currency || 'USD'}` : '',
  };

  Object.entries(vars).forEach(([key, value]) => {
    rendered = rendered.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
  });

  return rendered;
}

app.post('/api/messages/prepare', authorize(['admin', 'receptionist', 'doctor']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const validation = prepareMessageSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({ error: validation.error.format() });
  }

  const { templateId, patientId, appointmentId, treatmentCaseId, paymentId, channelOverride, customSubject, customBody } = validation.data;

  try {
    // 1. Fetch Context Data
    const [patient, clinic, template, appointment, treatmentCase, payment] = await Promise.all([
      prisma.patient.findFirst({ where: { id: patientId, clinicId } }),
      prisma.clinic.findUnique({ where: { id: clinicId } }),
      templateId ? prisma.messageTemplate.findFirst({ where: { id: templateId, clinicId } }) : Promise.resolve(null),
      appointmentId ? prisma.appointment.findFirst({ where: { id: appointmentId, clinicId, patientId }, include: { practitioner: true } }) : Promise.resolve(null),
      treatmentCaseId ? prisma.treatmentCase.findFirst({ where: { id: treatmentCaseId, clinicId, patientId } }) : Promise.resolve(null),
      paymentId ? prisma.payment.findFirst({ where: { id: paymentId, clinicId, patientId } }) : Promise.resolve(null),
    ]);

    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    let remainingBalance = 0;
    if (treatmentCase) {
      const payments = await prisma.payment.findMany({
        where: { treatmentCaseId: treatmentCase.id, clinicId, paymentStatus: 'paid' }
      });
      const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
      remainingBalance = (treatmentCase.acceptedAmount || treatmentCase.estimatedAmount || 0) - totalPaid;
    }

    const context = { patient, clinic, appointment, treatmentCase, payment, remainingBalance };
    
    const subject = customSubject || (template ? await renderTemplate(template.subject || '', context) : '');
    const body = customBody || (template ? await renderTemplate(template.body, context) : '');
    const channel = channelOverride || (template?.channel as any) || 'sms';

    const message = await prisma.sentMessage.create({
      data: {
        clinicId,
        patientId,
        appointmentId,
        treatmentCaseId,
        paymentId,
        templateId,
        channel,
        recipient: channel === 'email' ? (patient.email || '') : (patient.phone || ''),
        subject,
        body,
        status: 'prepared',
        createdById: req.user!.id,
      },
    });

    await logActivity({
      clinicId,
      userId: req.user!.id,
      entityType: 'message',
      entityId: message.id,
      action: 'prepared',
      description: `Message prepared for ${patient.firstName} ${patient.lastName} via ${channel}`,
    });

    res.json(message);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to prepare message' });
  }
});

app.get('/api/messages', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const { patientId, appointmentId, treatmentCaseId, channel, status } = req.query;

  try {
    const where: any = { clinicId };
    if (patientId) where.patientId = String(patientId);
    if (appointmentId) where.appointmentId = String(appointmentId);
    if (treatmentCaseId) where.treatmentCaseId = String(treatmentCaseId);
    if (channel) where.channel = String(channel);
    if (status) where.status = String(status);

    const messages = await prisma.sentMessage.findMany({
      where,
      include: { patient: true, createdBy: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.get('/api/messages/:id', authorize(['admin', 'doctor', 'receptionist']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const message = await prisma.sentMessage.findFirst({
      where: { id, clinicId },
      include: { patient: true, createdBy: true, template: true },
    });
    if (!message) return res.status(404).json({ error: 'Message not found' });
    res.json(message);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch message' });
  }
});


app.post('/api/message-templates/seed', authorize(['admin']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;

  const defaultTemplates = [
    {
      name: 'Appointment Confirmation',
      channel: 'whatsapp',
      body: 'Hello {{patient_name}}, your appointment at {{clinic_name}} is confirmed for {{appointment_date}} at {{appointment_time}} with {{practitioner_name}}. See you soon!',
      language: 'en',
    },
    {
      name: 'Appointment Reminder (24h)',
      channel: 'sms',
      body: 'Reminder: You have an appointment tomorrow, {{appointment_date}} at {{appointment_time}}, at {{clinic_name}}. Please let us know if you cannot attend.',
      language: 'en',
    },
    {
      name: 'No-Show Follow-Up',
      channel: 'whatsapp',
      body: 'Hello {{patient_name}}, we missed you today at {{clinic_name}}. Would you like to reschedule your appointment? Please contact us.',
      language: 'en',
    },
    {
      name: 'Treatment Quote Follow-Up',
      channel: 'email',
      subject: 'Follow-up on your treatment plan',
      body: 'Hello {{patient_name}}, we are following up on the treatment plan "{{treatment_title}}" discussed recently. Do you have any questions or would you like to proceed?',
      language: 'en',
    },
    {
      name: 'Payment Reminder',
      channel: 'whatsapp',
      body: 'Hello {{patient_name}}, this is a friendly reminder regarding a pending balance of {{remaining_balance}} at {{clinic_name}}. You can settle this at your next visit or via bank transfer.',
      language: 'en',
    },
    // Turkish
    {
      name: 'Randevu Onayı',
      channel: 'whatsapp',
      body: 'Sayın {{patient_name}}, {{clinic_name}} bünyesindeki randevunuz {{appointment_date}} tarihinde saat {{appointment_time}} için onaylanmıştır. Görüşmek üzere!',
      language: 'tr',
    },
    {
      name: 'Randevu Hatırlatma (24s)',
      channel: 'sms',
      body: 'Hatırlatma: Yarın {{appointment_date}} saat {{appointment_time}} için {{clinic_name}} randevunuz bulunmaktadır. Gelemeyecekseniz lütfen bilgi veriniz.',
      language: 'tr',
    },
  ];

  try {
    const created = [];
    for (const t of defaultTemplates) {
      const exists = await prisma.messageTemplate.findFirst({
        where: { clinicId, name: t.name, language: t.language }
      });
      if (!exists) {
        const newT = await prisma.messageTemplate.create({
          data: { ...t, clinicId, createdById: req.user!.id }
        });
        created.push(newT);
      }
    }
    res.json({ message: 'Templates seeded', count: created.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to seed templates' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
