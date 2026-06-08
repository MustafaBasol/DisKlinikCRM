import { z } from 'zod';
import prisma from '../db.js';

export const recallActionModeValues = [
  'LIST_ONLY',
  'CREATE_TASK',
  'CREATE_MESSAGE_DRAFT',
  'AUTO_SEND_WHATSAPP',
] as const;

export const recallSendTimingValues = ['SAME_DAY', 'NEXT_DAY', 'MANUAL'] as const;

const timeStringSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const templateIdSchema = z.string().uuid().nullable().optional();

export const recallSettingsSchema = z.object({
  isEnabled: z.boolean().default(false),
  defaultActionMode: z.enum(recallActionModeValues).default('LIST_ONLY'),
  checkupEnabled: z.boolean().default(true),
  checkupAfterDays: z.number().int().min(30).max(730).default(180),
  checkupSendTiming: z.enum(recallSendTimingValues).default('MANUAL'),
  checkupSendTime: timeStringSchema.default('10:00'),
  checkupActionMode: z.enum(recallActionModeValues).default('LIST_ONLY'),
  checkupMessageTemplateId: templateIdSchema,
  treatmentPlanFollowupEnabled: z.boolean().default(true),
  treatmentPlanFollowupAfterDays: z.number().int().min(1).max(180).default(7),
  treatmentPlanFollowupRepeatDays: z.number().int().min(1).max(180).default(14),
  treatmentPlanFollowupMaxAttempts: z.number().int().min(1).max(10).default(3),
  treatmentPlanFollowupActionMode: z.enum(recallActionModeValues).default('CREATE_TASK'),
  treatmentPlanFollowupMessageTemplateId: templateIdSchema,
  incompleteTreatmentEnabled: z.boolean().default(true),
  incompleteTreatmentAfterDays: z.number().int().min(1).max(365).default(14),
  incompleteTreatmentActionMode: z.enum(recallActionModeValues).default('CREATE_TASK'),
  incompleteTreatmentMessageTemplateId: templateIdSchema,
  incompleteTreatmentAutoCreateTask: z.boolean().default(true),
  noShowFollowupEnabled: z.boolean().default(true),
  noShowFollowupAfterHours: z.number().int().min(1).max(720).default(24),
  noShowFollowupActionMode: z.enum(recallActionModeValues).default('CREATE_TASK'),
  noShowFollowupMessageTemplateId: templateIdSchema,
  noShowFollowupAutoCreateTask: z.boolean().default(true),
  paymentFollowupEnabled: z.boolean().default(true),
  paymentFollowupAfterDays: z.number().int().min(1).max(180).default(3),
  paymentFollowupActionMode: z.enum(recallActionModeValues).default('CREATE_TASK'),
  paymentFollowupMessageTemplateId: templateIdSchema,
  respectCommunicationConsent: z.boolean().default(true),
});

export type RecallSettings = z.infer<typeof recallSettingsSchema>;
export type RecallActionMode = (typeof recallActionModeValues)[number];

export const DEFAULT_RECALL_SETTINGS: RecallSettings = recallSettingsSchema.parse({});

function normalizeRecallSettings(raw: unknown): RecallSettings {
  const parsed = recallSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_RECALL_SETTINGS;
}

export async function getRecallSettings(clinicId: string): Promise<RecallSettings> {
  const settings = await prisma.clinicRecallSetting.findUnique({
    where: { clinicId },
  });

  if (!settings) return { ...DEFAULT_RECALL_SETTINGS };

  return normalizeRecallSettings({
    isEnabled: settings.isEnabled,
    defaultActionMode: settings.defaultActionMode,
    checkupEnabled: settings.checkupEnabled,
    checkupAfterDays: settings.checkupAfterDays,
    checkupSendTiming: settings.checkupSendTiming,
    checkupSendTime: settings.checkupSendTime,
    checkupActionMode: settings.checkupActionMode,
    checkupMessageTemplateId: settings.checkupMessageTemplateId,
    treatmentPlanFollowupEnabled: settings.treatmentPlanFollowupEnabled,
    treatmentPlanFollowupAfterDays: settings.treatmentPlanFollowupAfterDays,
    treatmentPlanFollowupRepeatDays: settings.treatmentPlanFollowupRepeatDays,
    treatmentPlanFollowupMaxAttempts: settings.treatmentPlanFollowupMaxAttempts,
    treatmentPlanFollowupActionMode: settings.treatmentPlanFollowupActionMode,
    treatmentPlanFollowupMessageTemplateId: settings.treatmentPlanFollowupMessageTemplateId,
    incompleteTreatmentEnabled: settings.incompleteTreatmentEnabled,
    incompleteTreatmentAfterDays: settings.incompleteTreatmentAfterDays,
    incompleteTreatmentActionMode: settings.incompleteTreatmentActionMode,
    incompleteTreatmentMessageTemplateId: settings.incompleteTreatmentMessageTemplateId,
    incompleteTreatmentAutoCreateTask: settings.incompleteTreatmentAutoCreateTask,
    noShowFollowupEnabled: settings.noShowFollowupEnabled,
    noShowFollowupAfterHours: settings.noShowFollowupAfterHours,
    noShowFollowupActionMode: settings.noShowFollowupActionMode,
    noShowFollowupMessageTemplateId: settings.noShowFollowupMessageTemplateId,
    noShowFollowupAutoCreateTask: settings.noShowFollowupAutoCreateTask,
    paymentFollowupEnabled: settings.paymentFollowupEnabled,
    paymentFollowupAfterDays: settings.paymentFollowupAfterDays,
    paymentFollowupActionMode: settings.paymentFollowupActionMode,
    paymentFollowupMessageTemplateId: settings.paymentFollowupMessageTemplateId,
    respectCommunicationConsent: settings.respectCommunicationConsent,
  });
}

export async function upsertRecallSettings(
  clinicId: string,
  rawSettings: unknown,
): Promise<RecallSettings> {
  const settings = normalizeRecallSettings(rawSettings);

  await prisma.clinicRecallSetting.upsert({
    where: { clinicId },
    create: { clinicId, ...settings },
    update: settings,
  });

  return settings;
}
