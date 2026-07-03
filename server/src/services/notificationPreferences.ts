import { z } from 'zod';
import prisma from '../db.js';

export const NOTIFICATION_PREFERENCES_KEY = 'notification.preferences';

const timeStringSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const whatsappTimedPreferenceSchema = z.object({
  enabled: z.boolean(),
  daysBefore: z.number().int().min(0).max(7),
  sendTime: timeStringSchema,
});

const togglePreferenceSchema = z.object({
  enabled: z.boolean(),
});

export const notificationPreferencesSchema = z.object({
  whatsapp: z.object({
    patientAppointmentReminder: whatsappTimedPreferenceSchema,
    practitionerDailySchedule: whatsappTimedPreferenceSchema,
    taskAssignment: togglePreferenceSchema,
    paymentReminder: whatsappTimedPreferenceSchema,
  }),
  inApp: z.object({
    upcomingAppointments: z.object({
      enabled: z.boolean(),
      leadHours: z.number().int().min(1).max(24),
    }),
    overdueTasks: togglePreferenceSchema,
    appointmentRequests: togglePreferenceSchema,
    lowStock: togglePreferenceSchema,
    labOrdersOverdue: togglePreferenceSchema,
  }),
});

export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  whatsapp: {
    patientAppointmentReminder: {
      enabled: true,
      daysBefore: 1,
      sendTime: '10:00',
    },
    practitionerDailySchedule: {
      enabled: false,
      daysBefore: 1,
      sendTime: '18:00',
    },
    taskAssignment: {
      enabled: false,
    },
    paymentReminder: {
      enabled: false,
      daysBefore: 1,
      sendTime: '10:00',
    },
  },
  inApp: {
    upcomingAppointments: {
      enabled: true,
      leadHours: 2,
    },
    overdueTasks: {
      enabled: true,
    },
    appointmentRequests: {
      enabled: true,
    },
    lowStock: {
      enabled: true,
    },
    labOrdersOverdue: {
      enabled: true,
    },
  },
};

function cloneDefaultPreferences(): NotificationPreferences {
  return JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_PREFERENCES)) as NotificationPreferences;
}

export function normalizeNotificationPreferences(raw: unknown): NotificationPreferences {
  const base = cloneDefaultPreferences();

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const value = raw as Partial<NotificationPreferences>;

    base.whatsapp.patientAppointmentReminder = {
      ...base.whatsapp.patientAppointmentReminder,
      ...(value.whatsapp?.patientAppointmentReminder ?? {}),
    };
    base.whatsapp.practitionerDailySchedule = {
      ...base.whatsapp.practitionerDailySchedule,
      ...(value.whatsapp?.practitionerDailySchedule ?? {}),
    };
    base.whatsapp.taskAssignment = {
      ...base.whatsapp.taskAssignment,
      ...(value.whatsapp?.taskAssignment ?? {}),
    };
    base.whatsapp.paymentReminder = {
      ...base.whatsapp.paymentReminder,
      ...(value.whatsapp?.paymentReminder ?? {}),
    };
    base.inApp.upcomingAppointments = {
      ...base.inApp.upcomingAppointments,
      ...(value.inApp?.upcomingAppointments ?? {}),
    };
    base.inApp.overdueTasks = {
      ...base.inApp.overdueTasks,
      ...(value.inApp?.overdueTasks ?? {}),
    };
    base.inApp.appointmentRequests = {
      ...base.inApp.appointmentRequests,
      ...(value.inApp?.appointmentRequests ?? {}),
    };
    base.inApp.lowStock = {
      ...base.inApp.lowStock,
      ...(value.inApp?.lowStock ?? {}),
    };
    base.inApp.labOrdersOverdue = {
      ...base.inApp.labOrdersOverdue,
      ...(value.inApp?.labOrdersOverdue ?? {}),
    };
  }

  const parsed = notificationPreferencesSchema.safeParse(base);
  return parsed.success ? parsed.data : cloneDefaultPreferences();
}

export async function getNotificationPreferences(clinicId: string): Promise<NotificationPreferences> {
  const setting = await prisma.setting.findUnique({
    where: {
      clinicId_key: {
        clinicId,
        key: NOTIFICATION_PREFERENCES_KEY,
      },
    },
  });

  if (!setting) return cloneDefaultPreferences();

  try {
    return normalizeNotificationPreferences(JSON.parse(setting.value));
  } catch {
    return cloneDefaultPreferences();
  }
}

export async function upsertNotificationPreferences(
  clinicId: string,
  preferences: NotificationPreferences,
): Promise<NotificationPreferences> {
  const normalized = normalizeNotificationPreferences(preferences);

  await prisma.setting.upsert({
    where: {
      clinicId_key: {
        clinicId,
        key: NOTIFICATION_PREFERENCES_KEY,
      },
    },
    create: {
      clinicId,
      key: NOTIFICATION_PREFERENCES_KEY,
      value: JSON.stringify(normalized),
    },
    update: {
      value: JSON.stringify(normalized),
    },
  });

  return normalized;
}

export function getEnabledInAppNotificationTypes(preferences: NotificationPreferences): string[] {
  const enabledTypes: string[] = [];

  if (preferences.inApp.upcomingAppointments.enabled) enabledTypes.push('upcoming_appointment');
  if (preferences.inApp.overdueTasks.enabled) enabledTypes.push('overdue_task');
  if (preferences.inApp.appointmentRequests.enabled) enabledTypes.push('appointment_request');
  if (preferences.inApp.lowStock.enabled) enabledTypes.push('low_stock');
  if (preferences.inApp.labOrdersOverdue.enabled) enabledTypes.push('lab_case_overdue');

  return enabledTypes;
}
