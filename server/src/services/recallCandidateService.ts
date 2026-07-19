import prisma from '../db.js';
import { logActivity } from '../utils/activity.js';
import {
  getRecallSettings,
  RecallActionMode,
  RecallSettings,
} from './recallSettings.js';
import { resolveCommunicationConsent, type LegacyGateSignal } from './communicationConsent/legacyReconciliationResolver.js';

export const ACTIVE_RECALL_STATUSES = [
  'PENDING',
  'TASK_CREATED',
  'MESSAGE_DRAFTED',
  'CONTACTED',
  'SNOOZED',
] as const;

export const recallCandidateInclude = {
  clinic: { select: { id: true, name: true, currency: true, defaultLanguage: true } },
  patient: {
    select: {
      id: true,
      organizationId: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      communicationConsent: true,
      marketingConsent: true,
    },
  },
  treatmentCase: {
    select: {
      id: true,
      title: true,
      stage: true,
      estimatedAmount: true,
      acceptedAmount: true,
      currency: true,
    },
  },
  appointment: {
    select: {
      id: true,
      startTime: true,
      status: true,
      appointmentType: { select: { id: true, name: true, basePrice: true, currency: true } },
      practitioner: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  payment: { select: { id: true, amount: true, currency: true, paymentStatus: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  messageTemplate: { select: { id: true, name: true, channel: true, language: true } },
  actions: {
    orderBy: { createdAt: 'desc' as const },
    take: 5,
    include: {
      performedBy: { select: { id: true, firstName: true, lastName: true } },
      task: { select: { id: true, title: true, status: true } },
      message: { select: { id: true, status: true, body: true, createdAt: true } },
    },
  },
};

type RecallType =
  | 'ROUTINE_CHECKUP'
  | 'TREATMENT_PLAN_NOT_STARTED'
  | 'INCOMPLETE_TREATMENT'
  | 'NO_SHOW_FOLLOW_UP'
  | 'PAYMENT_FOLLOW_UP'
  | 'MANUAL';

type CandidateSeed = {
  clinicId: string;
  patientId: string;
  recallType: RecallType;
  sourceType: string;
  sourceId: string;
  dueAt: Date;
  priority: string;
  estimatedValue?: number | null;
  treatmentCaseId?: string | null;
  treatmentPlanProcedureId?: string | null;
  appointmentId?: string | null;
  paymentId?: string | null;
  assignedToId?: string | null;
  messageTemplateId?: string | null;
  maxAttempts?: number;
  note?: string | null;
};

type GenerateStats = {
  settingsEnabled: boolean;
  generated: number;
  skipped: number;
  byType: Record<string, number>;
};

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addHours(date: Date, hours: number): Date {
  const next = new Date(date);
  next.setHours(next.getHours() + hours);
  return next;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function maxDate(...dates: Array<Date | null | undefined>): Date | null {
  const valid = dates.filter((date): date is Date => !!date);
  if (valid.length === 0) return null;
  return new Date(Math.max(...valid.map(date => date.getTime())));
}

function moneyValue(...values: Array<number | null | undefined>): number | null {
  const value = values.find(item => typeof item === 'number' && Number.isFinite(item));
  return value ?? null;
}

function calculatePriority(type: RecallType, estimatedValue: number | null | undefined, referenceDate: Date): string {
  const value = estimatedValue ?? 0;
  const ageDays = daysBetween(new Date(), referenceDate);

  if (type === 'PAYMENT_FOLLOW_UP' && value >= 10000) return 'URGENT';
  if (type === 'PAYMENT_FOLLOW_UP' && value >= 3000) return 'HIGH';
  if (type === 'INCOMPLETE_TREATMENT') return 'HIGH';
  if (type === 'NO_SHOW_FOLLOW_UP' && value >= 3000) return 'HIGH';
  if (type === 'TREATMENT_PLAN_NOT_STARTED' && (value >= 5000 || ageDays > 30)) return 'HIGH';
  if (type === 'ROUTINE_CHECKUP') return 'MEDIUM';
  if (value > 0 && value < 300) return 'LOW';
  return 'MEDIUM';
}

function getTemplateIdForType(type: RecallType, settings: RecallSettings): string | null | undefined {
  if (type === 'ROUTINE_CHECKUP') return settings.checkupMessageTemplateId;
  if (type === 'TREATMENT_PLAN_NOT_STARTED') return settings.treatmentPlanFollowupMessageTemplateId;
  if (type === 'INCOMPLETE_TREATMENT') return settings.incompleteTreatmentMessageTemplateId;
  if (type === 'NO_SHOW_FOLLOW_UP') return settings.noShowFollowupMessageTemplateId;
  if (type === 'PAYMENT_FOLLOW_UP') return settings.paymentFollowupMessageTemplateId;
  return null;
}

function getActionModeForType(type: RecallType, settings: RecallSettings): RecallActionMode {
  if (type === 'ROUTINE_CHECKUP') return settings.checkupActionMode;
  if (type === 'TREATMENT_PLAN_NOT_STARTED') return settings.treatmentPlanFollowupActionMode;
  if (type === 'INCOMPLETE_TREATMENT') return settings.incompleteTreatmentActionMode;
  if (type === 'NO_SHOW_FOLLOW_UP') return settings.noShowFollowupActionMode;
  if (type === 'PAYMENT_FOLLOW_UP') return settings.paymentFollowupActionMode;
  return settings.defaultActionMode;
}

function taskPriority(priority: string): string {
  if (priority === 'URGENT') return 'urgent';
  if (priority === 'HIGH') return 'high';
  if (priority === 'LOW') return 'low';
  return 'normal';
}

function patientName(patient: { firstName: string; lastName: string }): string {
  return `${patient.firstName} ${patient.lastName}`.trim();
}

function defaultTaskTitle(type: string, patient: { firstName: string; lastName: string }): string {
  const name = patientName(patient);
  if (type === 'ROUTINE_CHECKUP') return `Recall check-up: ${name}`;
  if (type === 'TREATMENT_PLAN_NOT_STARTED') return `Follow up treatment plan: ${name}`;
  if (type === 'INCOMPLETE_TREATMENT') return `Follow up incomplete treatment: ${name}`;
  if (type === 'NO_SHOW_FOLLOW_UP') return `No-show follow-up: ${name}`;
  if (type === 'PAYMENT_FOLLOW_UP') return `Payment follow-up: ${name}`;
  return `Recall follow-up: ${name}`;
}

function defaultMessageBody(type: string): string {
  if (type === 'ROUTINE_CHECKUP') {
    return 'Hello {{patientName}}, this is a friendly reminder from {{clinicName}} that it may be time for your routine check-up. Would you like us to help plan an appointment?';
  }
  if (type === 'TREATMENT_PLAN_NOT_STARTED') {
    return 'Hello {{patientName}}, we would be happy to help with the treatment plan previously prepared for you. If you have questions, we can answer them or plan a suitable appointment.';
  }
  if (type === 'INCOMPLETE_TREATMENT') {
    return 'Hello {{patientName}}, we would like to help you continue the next steps of your care. We can help plan a suitable appointment when you are available.';
  }
  if (type === 'NO_SHOW_FOLLOW_UP') {
    return 'Hello {{patientName}}, would you like to choose a new date for the appointment you missed? We can help find a suitable time.';
  }
  if (type === 'PAYMENT_FOLLOW_UP') {
    return 'Hello {{patientName}}, we would like to help with your clinic payment record. Please contact us when convenient.';
  }
  return 'Hello {{patientName}}, {{clinicName}} would like to follow up with you. Please contact us when convenient.';
}

function renderRecallMessage(
  text: string,
  context: { patient: { firstName: string; lastName: string }; clinic: { name: string } },
): string {
  const replacements: Record<string, string> = {
    patientName: patientName(context.patient),
    patient_name: patientName(context.patient),
    clinicName: context.clinic.name,
    clinic_name: context.clinic.name,
  };

  return Object.entries(replacements).reduce(
    (body, [key, value]) => body.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value),
    text,
  );
}

function hasUnsafeWhatsAppVariable(text: string): boolean {
  return /{{\s*(treatment_title|remaining_balance|diagnosis|procedure|tooth|health_detail)\s*}}/i.test(text);
}

async function hasUpcomingAppointment(clinicId: string, patientId: string): Promise<boolean> {
  const count = await prisma.appointment.count({
    where: {
      clinicId,
      patientId,
      deletedAt: null,
      startTime: { gte: new Date() },
      status: { in: ['scheduled', 'confirmed'] },
    },
  });
  return count > 0;
}

async function createCandidateIfMissing(seed: CandidateSeed, actorUserId: string) {
  const existing = await prisma.recallCandidate.findFirst({
    where: {
      clinicId: seed.clinicId,
      patientId: seed.patientId,
      recallType: seed.recallType,
      sourceType: seed.sourceType,
      sourceId: seed.sourceId,
      status: { in: [...ACTIVE_RECALL_STATUSES] },
    },
    select: { id: true },
  });
  if (existing) return null;

  try {
    const candidate = await prisma.recallCandidate.create({
      data: {
        clinicId: seed.clinicId,
        patientId: seed.patientId,
        recallType: seed.recallType,
        priority: seed.priority,
        status: 'PENDING',
        sourceType: seed.sourceType,
        sourceId: seed.sourceId,
        treatmentCaseId: seed.treatmentCaseId ?? null,
        treatmentPlanProcedureId: seed.treatmentPlanProcedureId ?? null,
        appointmentId: seed.appointmentId ?? null,
        paymentId: seed.paymentId ?? null,
        estimatedValue: seed.estimatedValue ?? null,
        dueAt: seed.dueAt,
        nextActionAt: seed.dueAt,
        maxAttempts: seed.maxAttempts ?? 3,
        assignedToId: seed.assignedToId ?? null,
        messageTemplateId: seed.messageTemplateId ?? null,
        note: seed.note ?? null,
      },
      include: recallCandidateInclude,
    });

    await logActivity({
      clinicId: seed.clinicId,
      userId: actorUserId,
      entityType: 'recall_candidate',
      entityId: candidate.id,
      action: 'recall_candidate_created',
      description: `Recall candidate created for ${patientName(candidate.patient)}`,
      patientId: seed.patientId,
      appointmentId: seed.appointmentId ?? null,
      treatmentCaseId: seed.treatmentCaseId ?? null,
      metadata: { recallType: seed.recallType, sourceType: seed.sourceType, sourceId: seed.sourceId },
    });

    return candidate;
  } catch (error: any) {
    if (error?.code === 'P2002') return null;
    throw error;
  }
}

async function resolveTaskAssignee(
  clinicId: string,
  preferredUserId?: string | null,
  actorUserId?: string | null,
): Promise<string | null> {
  const candidates = [preferredUserId, actorUserId].filter(Boolean) as string[];
  for (const userId of candidates) {
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        OR: [
          { clinicId },
          { canAccessAllClinics: true },
          { userClinics: { some: { clinicId, isActive: true } } },
        ],
      },
      select: { id: true },
    });
    if (user) return user.id;
  }

  const fallback = await prisma.user.findFirst({
    where: {
      isActive: true,
      OR: [
        { clinicId },
        { userClinics: { some: { clinicId, isActive: true } } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return fallback?.id ?? null;
}

export async function createRecallTaskForCandidate(
  candidateId: string,
  actorUserId: string,
  note?: string,
) {
  const candidate = await prisma.recallCandidate.findUnique({
    where: { id: candidateId },
    include: recallCandidateInclude,
  });
  if (!candidate) throw new Error('Recall candidate not found');

  const existingAction = await prisma.recallAction.findFirst({
    where: { candidateId, actionType: 'TASK_CREATED', taskId: { not: null } },
    include: { task: true },
  });
  if (existingAction?.task) return existingAction.task;

  const assignedToId = await resolveTaskAssignee(candidate.clinicId, candidate.assignedToId, actorUserId);
  if (!assignedToId) throw new Error('No active clinic user available for recall task assignment');

  const task = await prisma.task.create({
    data: {
      clinicId: candidate.clinicId,
      patientId: candidate.patientId,
      treatmentCaseId: candidate.treatmentCaseId,
      appointmentId: candidate.appointmentId,
      assignedToId,
      createdById: actorUserId,
      title: defaultTaskTitle(candidate.recallType, candidate.patient),
      description: note || candidate.note || `Suggested recall action: ${candidate.recallType}`,
      dueDate: candidate.nextActionAt ?? candidate.dueAt,
      priority: taskPriority(candidate.priority),
      status: 'open',
    },
  });

  await prisma.recallCandidate.update({
    where: { id: candidate.id },
    data: {
      status: 'TASK_CREATED',
      assignedToId,
      nextActionAt: candidate.nextActionAt ?? candidate.dueAt,
    },
  });

  await prisma.recallAction.create({
    data: {
      clinicId: candidate.clinicId,
      candidateId: candidate.id,
      patientId: candidate.patientId,
      actionType: 'TASK_CREATED',
      performedById: actorUserId,
      taskId: task.id,
      note,
    },
  });

  await logActivity({
    clinicId: candidate.clinicId,
    userId: actorUserId,
    entityType: 'recall_candidate',
    entityId: candidate.id,
    action: 'recall_task_created',
    description: `Recall task created for ${patientName(candidate.patient)}`,
    patientId: candidate.patientId,
    appointmentId: candidate.appointmentId,
    treatmentCaseId: candidate.treatmentCaseId,
    metadata: { taskId: task.id, recallType: candidate.recallType },
  });

  return task;
}

export async function prepareRecallMessageForCandidate(candidateId: string, actorUserId: string) {
  const candidate = await prisma.recallCandidate.findUnique({
    where: { id: candidateId },
    include: recallCandidateInclude,
  });
  if (!candidate) throw new Error('Recall candidate not found');

  const settings = await getRecallSettings(candidate.clinicId);
  if (settings.respectCommunicationConsent) {
    // Single orchestration point shared with SMS — see
    // legacyReconciliationResolver.ts. No hard-veto concept for recall
    // (WhatsApp has no opt-out field like smsOptOut), so this never reaches
    // the legacy/central conflict branch; the per-clinic
    // respectCommunicationConsent escape hatch above is preserved exactly as
    // before when it's false.
    const legacySignal: LegacyGateSignal = candidate.patient.communicationConsent
      ? { allowed: true, hardVeto: false, reasonCode: 'legacy_ok' }
      : { allowed: false, hardVeto: false, reasonCode: 'missing_communication_consent' };
    const resolved = await resolveCommunicationConsent(legacySignal, {
      organizationId: candidate.patient.organizationId,
      clinicId: candidate.clinicId,
      patientId: candidate.patientId,
      channel: 'whatsapp',
      purpose: 'recall',
    });
    if (!resolved.finalAllowed) {
      throw new Error('Patient communication consent is not enabled');
    }
  }
  if (!candidate.patient.phone) {
    throw new Error('Patient has no phone number');
  }

  const existingAction = await prisma.recallAction.findFirst({
    where: { candidateId, actionType: 'MESSAGE_DRAFTED', messageId: { not: null } },
    include: { message: true },
    orderBy: { createdAt: 'desc' },
  });
  if (existingAction?.message) return existingAction.message;

  const template = candidate.messageTemplateId
    ? await prisma.messageTemplate.findFirst({
        where: {
          id: candidate.messageTemplateId,
          clinicId: candidate.clinicId,
          channel: 'whatsapp',
          isActive: true,
        },
      })
    : null;

  const rawBody = template?.body || defaultMessageBody(candidate.recallType);
  if (hasUnsafeWhatsAppVariable(rawBody)) {
    throw new Error('Recall WhatsApp draft contains sensitive variables');
  }

  const body = renderRecallMessage(rawBody, {
    patient: candidate.patient,
    clinic: candidate.clinic,
  });

  const message = await prisma.sentMessage.create({
    data: {
      clinicId: candidate.clinicId,
      patientId: candidate.patientId,
      appointmentId: candidate.appointmentId,
      treatmentCaseId: candidate.treatmentCaseId,
      paymentId: candidate.paymentId,
      templateId: template?.id ?? null,
      channel: 'whatsapp',
      recipient: candidate.patient.phone,
      body,
      status: 'prepared',
      createdById: actorUserId,
    },
  });

  await prisma.recallCandidate.update({
    where: { id: candidate.id },
    data: {
      status: 'MESSAGE_DRAFTED',
      lastMessageDraft: body,
      messageTemplateId: template?.id ?? candidate.messageTemplateId,
    },
  });

  await prisma.recallAction.create({
    data: {
      clinicId: candidate.clinicId,
      candidateId: candidate.id,
      patientId: candidate.patientId,
      actionType: 'MESSAGE_DRAFTED',
      performedById: actorUserId,
      messageId: message.id,
    },
  });

  await logActivity({
    clinicId: candidate.clinicId,
    userId: actorUserId,
    entityType: 'recall_candidate',
    entityId: candidate.id,
    action: 'recall_message_drafted',
    description: `Recall WhatsApp draft created for ${patientName(candidate.patient)}`,
    patientId: candidate.patientId,
    appointmentId: candidate.appointmentId,
    treatmentCaseId: candidate.treatmentCaseId,
    metadata: { messageId: message.id, recallType: candidate.recallType },
  });

  return message;
}

async function applyConfiguredAction(candidateId: string, settings: RecallSettings, actorUserId: string) {
  const candidate = await prisma.recallCandidate.findUnique({
    where: { id: candidateId },
    select: { recallType: true },
  });
  if (!candidate) return;

  const mode = getActionModeForType(candidate.recallType as RecallType, settings);
  const autoTask =
    (candidate.recallType === 'INCOMPLETE_TREATMENT' && settings.incompleteTreatmentAutoCreateTask) ||
    (candidate.recallType === 'NO_SHOW_FOLLOW_UP' && settings.noShowFollowupAutoCreateTask);

  if (mode === 'CREATE_TASK' || (mode === 'LIST_ONLY' && autoTask)) {
    await createRecallTaskForCandidate(candidateId, actorUserId).catch(() => undefined);
    return;
  }

  if (mode === 'CREATE_MESSAGE_DRAFT' || mode === 'AUTO_SEND_WHATSAPP') {
    try {
      await prepareRecallMessageForCandidate(candidateId, actorUserId);
    } catch {
      await createRecallTaskForCandidate(
        candidateId,
        actorUserId,
        'WhatsApp draft was skipped because contact consent or phone data was not available.',
      ).catch(() => undefined);
    }
  }
}

async function recordCreated(
  seed: CandidateSeed,
  settings: RecallSettings,
  actorUserId: string,
  stats: GenerateStats,
) {
  const candidate = await createCandidateIfMissing(seed, actorUserId);
  if (!candidate) {
    stats.skipped += 1;
    return;
  }

  stats.generated += 1;
  stats.byType[seed.recallType] = (stats.byType[seed.recallType] ?? 0) + 1;
  await applyConfiguredAction(candidate.id, settings, actorUserId);
}

export async function generateRecallCandidatesForClinic(clinicId: string, actorUserId: string): Promise<GenerateStats> {
  const settings = await getRecallSettings(clinicId);
  const stats: GenerateStats = { settingsEnabled: settings.isEnabled, generated: 0, skipped: 0, byType: {} };

  if (!settings.isEnabled) return stats;

  await generateRoutineCheckupCandidates(clinicId, settings, actorUserId, stats);
  await generateTreatmentPlanNotStartedCandidates(clinicId, settings, actorUserId, stats);
  await generateIncompleteTreatmentCandidates(clinicId, settings, actorUserId, stats);
  await generateNoShowCandidates(clinicId, settings, actorUserId, stats);
  await generatePaymentFollowupCandidates(clinicId, settings, actorUserId, stats);

  return stats;
}

async function generateRoutineCheckupCandidates(
  clinicId: string,
  settings: RecallSettings,
  actorUserId: string,
  stats: GenerateStats,
) {
  if (!settings.checkupEnabled) return;
  const cutoff = addDays(new Date(), -settings.checkupAfterDays);
  const latestByPatient = new Map<string, {
    patientId: string;
    sourceType: string;
    sourceId: string;
    date: Date;
    estimatedValue: number | null;
    appointmentId?: string | null;
    treatmentCaseId?: string | null;
  }>();

  const appointments = await prisma.appointment.findMany({
    where: { clinicId, deletedAt: null, status: 'completed' },
    include: {
      patient: { select: { id: true, deletedAt: true } },
      appointmentType: { select: { basePrice: true } },
    },
    orderBy: { endTime: 'desc' },
    take: 1000,
  });

  for (const appointment of appointments) {
    if (appointment.patient.deletedAt) continue;
    const current = latestByPatient.get(appointment.patientId);
    if (current && current.date >= appointment.endTime) continue;
    latestByPatient.set(appointment.patientId, {
      patientId: appointment.patientId,
      sourceType: 'APPOINTMENT',
      sourceId: appointment.id,
      date: appointment.endTime,
      estimatedValue: appointment.appointmentType.basePrice ?? null,
      appointmentId: appointment.id,
    });
  }

  const completedCases = await prisma.treatmentCase.findMany({
    where: { clinicId, deletedAt: null, stage: 'completed' },
    include: { patient: { select: { id: true, deletedAt: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 1000,
  });

  for (const treatmentCase of completedCases) {
    if (treatmentCase.patient.deletedAt) continue;
    const date = treatmentCase.closedAt ?? treatmentCase.updatedAt;
    const current = latestByPatient.get(treatmentCase.patientId);
    if (current && current.date >= date) continue;
    latestByPatient.set(treatmentCase.patientId, {
      patientId: treatmentCase.patientId,
      sourceType: 'TREATMENT_CASE',
      sourceId: treatmentCase.id,
      date,
      estimatedValue: moneyValue(treatmentCase.acceptedAmount, treatmentCase.estimatedAmount),
      treatmentCaseId: treatmentCase.id,
    });
  }

  for (const event of latestByPatient.values()) {
    if (event.date > cutoff) continue;
    if (await hasUpcomingAppointment(clinicId, event.patientId)) continue;
    const dueAt = addDays(event.date, settings.checkupAfterDays);
    await recordCreated({
      clinicId,
      patientId: event.patientId,
      recallType: 'ROUTINE_CHECKUP',
      sourceType: event.sourceType,
      sourceId: event.sourceId,
      appointmentId: event.appointmentId ?? null,
      treatmentCaseId: event.treatmentCaseId ?? null,
      dueAt,
      estimatedValue: event.estimatedValue,
      priority: calculatePriority('ROUTINE_CHECKUP', event.estimatedValue, event.date),
      messageTemplateId: getTemplateIdForType('ROUTINE_CHECKUP', settings),
      note: 'Routine check-up recall generated from the latest completed appointment or treatment.',
    }, settings, actorUserId, stats);
  }
}

async function generateTreatmentPlanNotStartedCandidates(
  clinicId: string,
  settings: RecallSettings,
  actorUserId: string,
  stats: GenerateStats,
) {
  if (!settings.treatmentPlanFollowupEnabled) return;
  const cutoff = addDays(new Date(), -settings.treatmentPlanFollowupAfterDays);

  const cases = await prisma.treatmentCase.findMany({
    where: {
      clinicId,
      deletedAt: null,
      stage: { in: ['new', 'quote_sent'] },
      createdAt: { lte: cutoff },
    },
    include: {
      patient: { select: { id: true, deletedAt: true } },
      procedures: { select: { id: true, status: true, estimatedCost: true, completedAt: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });

  for (const treatmentCase of cases) {
    if (treatmentCase.patient.deletedAt) continue;
    const hasStarted = treatmentCase.procedures.some(
      procedure => procedure.status === 'in_progress' || procedure.status === 'completed' || !!procedure.completedAt,
    );
    if (hasStarted) continue;

    const estimated = moneyValue(
      treatmentCase.acceptedAmount,
      treatmentCase.estimatedAmount,
      treatmentCase.procedures.reduce((sum, procedure) => sum + (procedure.estimatedCost ?? 0), 0),
    );
    const dueAt = addDays(treatmentCase.createdAt, settings.treatmentPlanFollowupAfterDays);

    await recordCreated({
      clinicId,
      patientId: treatmentCase.patientId,
      recallType: 'TREATMENT_PLAN_NOT_STARTED',
      sourceType: 'TREATMENT_CASE',
      sourceId: treatmentCase.id,
      treatmentCaseId: treatmentCase.id,
      dueAt,
      estimatedValue: estimated,
      priority: calculatePriority('TREATMENT_PLAN_NOT_STARTED', estimated, treatmentCase.createdAt),
      maxAttempts: settings.treatmentPlanFollowupMaxAttempts,
      messageTemplateId: getTemplateIdForType('TREATMENT_PLAN_NOT_STARTED', settings),
      note: 'Treatment plan was created but no procedure has started yet.',
    }, settings, actorUserId, stats);
  }
}

async function generateIncompleteTreatmentCandidates(
  clinicId: string,
  settings: RecallSettings,
  actorUserId: string,
  stats: GenerateStats,
) {
  if (!settings.incompleteTreatmentEnabled) return;
  const cutoff = addDays(new Date(), -settings.incompleteTreatmentAfterDays);

  const cases = await prisma.treatmentCase.findMany({
    where: {
      clinicId,
      deletedAt: null,
      stage: { notIn: ['completed', 'lost'] },
      procedures: { some: { status: { in: ['planned', 'in_progress', 'completed'] } } },
    },
    include: {
      patient: { select: { id: true, deletedAt: true } },
      procedures: {
        select: {
          id: true,
          status: true,
          estimatedCost: true,
          completedAt: true,
          updatedAt: true,
          createdAt: true,
        },
      },
    },
    orderBy: { updatedAt: 'asc' },
    take: 500,
  });

  for (const treatmentCase of cases) {
    if (treatmentCase.patient.deletedAt) continue;
    const activeProcedures = treatmentCase.procedures.filter(procedure => procedure.status !== 'cancelled');
    const completed = activeProcedures.filter(procedure => procedure.status === 'completed' || !!procedure.completedAt);
    const pending = activeProcedures.filter(
      procedure => procedure.status === 'planned' || procedure.status === 'in_progress',
    );
    const isIncomplete = (completed.length > 0 && pending.length > 0) ||
      (treatmentCase.stage === 'in_progress' && pending.length > 0);
    if (!isIncomplete) continue;

    const lastProcedureDate = maxDate(
      treatmentCase.updatedAt,
      ...activeProcedures.map(procedure => procedure.completedAt ?? procedure.updatedAt ?? procedure.createdAt),
    );
    if (!lastProcedureDate || lastProcedureDate > cutoff) continue;

    const estimated = moneyValue(
      treatmentCase.acceptedAmount,
      treatmentCase.estimatedAmount,
      pending.reduce((sum, procedure) => sum + (procedure.estimatedCost ?? 0), 0),
    );
    const dueAt = addDays(lastProcedureDate, settings.incompleteTreatmentAfterDays);

    await recordCreated({
      clinicId,
      patientId: treatmentCase.patientId,
      recallType: 'INCOMPLETE_TREATMENT',
      sourceType: 'TREATMENT_CASE',
      sourceId: treatmentCase.id,
      treatmentCaseId: treatmentCase.id,
      dueAt,
      estimatedValue: estimated,
      priority: calculatePriority('INCOMPLETE_TREATMENT', estimated, lastProcedureDate),
      messageTemplateId: getTemplateIdForType('INCOMPLETE_TREATMENT', settings),
      note: 'Treatment has started but still has pending steps.',
    }, settings, actorUserId, stats);
  }
}

async function generateNoShowCandidates(
  clinicId: string,
  settings: RecallSettings,
  actorUserId: string,
  stats: GenerateStats,
) {
  if (!settings.noShowFollowupEnabled) return;
  const cutoff = addHours(new Date(), -settings.noShowFollowupAfterHours);

  const appointments = await prisma.appointment.findMany({
    where: {
      clinicId,
      deletedAt: null,
      status: 'no_show',
      OR: [
        { noShowMarkedAt: { lte: cutoff } },
        { noShowMarkedAt: null, startTime: { lte: cutoff } },
      ],
    },
    include: {
      patient: { select: { id: true, deletedAt: true } },
      appointmentType: { select: { basePrice: true } },
    },
    orderBy: { startTime: 'desc' },
    take: 500,
  });

  for (const appointment of appointments) {
    if (appointment.patient.deletedAt) continue;
    if (await hasUpcomingAppointment(clinicId, appointment.patientId)) continue;
    const referenceDate = appointment.noShowMarkedAt ?? appointment.startTime;
    const estimated = appointment.appointmentType.basePrice ?? null;
    const dueAt = addHours(referenceDate, settings.noShowFollowupAfterHours);

    await recordCreated({
      clinicId,
      patientId: appointment.patientId,
      recallType: 'NO_SHOW_FOLLOW_UP',
      sourceType: 'APPOINTMENT',
      sourceId: appointment.id,
      appointmentId: appointment.id,
      dueAt,
      estimatedValue: estimated,
      priority: calculatePriority('NO_SHOW_FOLLOW_UP', estimated, referenceDate),
      messageTemplateId: getTemplateIdForType('NO_SHOW_FOLLOW_UP', settings),
      note: 'No-show appointment needs follow-up and rescheduling.',
    }, settings, actorUserId, stats);
  }
}

async function generatePaymentFollowupCandidates(
  clinicId: string,
  settings: RecallSettings,
  actorUserId: string,
  stats: GenerateStats,
) {
  if (!settings.paymentFollowupEnabled) return;
  const cutoff = addDays(new Date(), -settings.paymentFollowupAfterDays);

  const installments = await prisma.paymentPlanInstallment.findMany({
    where: {
      dueDate: { lte: cutoff },
      status: { in: ['pending', 'overdue'] },
      plan: { clinicId, status: 'active' },
    },
    include: {
      plan: {
        include: {
          patient: { select: { id: true, deletedAt: true } },
          treatmentCase: { select: { id: true } },
        },
      },
    },
    orderBy: { dueDate: 'asc' },
    take: 500,
  });

  for (const installment of installments) {
    if (installment.plan.patient.deletedAt) continue;
    const dueAt = addDays(installment.dueDate, settings.paymentFollowupAfterDays);

    await recordCreated({
      clinicId,
      patientId: installment.plan.patientId,
      recallType: 'PAYMENT_FOLLOW_UP',
      sourceType: 'PAYMENT_PLAN_INSTALLMENT',
      sourceId: installment.id,
      treatmentCaseId: installment.plan.treatmentCaseId ?? null,
      paymentId: installment.paymentId ?? null,
      dueAt,
      estimatedValue: installment.amount,
      priority: calculatePriority('PAYMENT_FOLLOW_UP', installment.amount, installment.dueDate),
      messageTemplateId: getTemplateIdForType('PAYMENT_FOLLOW_UP', settings),
      note: 'Payment plan installment is overdue. Use gentle non-collection language.',
    }, settings, actorUserId, stats);
  }
}
