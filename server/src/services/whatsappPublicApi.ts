import { z } from 'zod';

const optionalUuid = z.preprocess(
  value => value === '' ? null : value,
  z.string().uuid().optional().nullable()
);

export const whatsappAppointmentRequestSchema = z.object({
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

export const whatsappAvailabilityQuerySchema = z.object({
  appointmentTypeId: z.string().uuid('Invalid appointment type ID'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format'),
  practitionerId: z.string().uuid().optional(),
});

export const whatsappAppointmentLookupQuerySchema = z.object({
  phone: z.string().trim().min(6, 'Phone is required'),
});

const readString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
};

export const getProvidedWhatsappSecret = (headers: {
  authorization?: string;
  xWhatsappSecret?: string | string[];
}) => {
  const bearerToken = headers.authorization?.startsWith('Bearer ')
    ? headers.authorization.slice(7)
    : undefined;

  return readString(headers.xWhatsappSecret, bearerToken);
};

export const validateWhatsappApiSecret = (configuredSecret: string | undefined, headers: {
  authorization?: string;
  xWhatsappSecret?: string | string[];
}) => {
  if (!configuredSecret?.trim()) {
    return 'not_configured';
  }

  return getProvidedWhatsappSecret(headers) === configuredSecret.trim()
    ? null
    : 'invalid';
};

export const validateOptionalWebhookSecret = (configuredSecret: string | undefined, headers: {
  authorization?: string;
  xWhatsappSecret?: string | string[];
}) => {
  if (!configuredSecret?.trim()) {
    return null;
  }

  return getProvidedWhatsappSecret(headers) === configuredSecret.trim()
    ? null
    : 'invalid';
};
