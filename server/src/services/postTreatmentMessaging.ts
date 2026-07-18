/**
 * Post-treatment messaging service.
 *
 * Handles scheduling, rendering and sending clinic-configured post-treatment
 * messages when appointments or procedures are marked as completed.
 */

import prisma from '../db.js';
import { sendPostTreatmentWhatsApp } from './whatsapp/whatsappOutboundMessaging.js';
import { sendMessage as sendInstagramMessage } from './instagram/InstagramMessagingProvider.js';
import type { InstagramConnectionRecord } from './instagram/InstagramMessagingProvider.js';
import { logActivity } from '../utils/activity.js';

// ── Template variable substitution ──────────────────────────────────────────

function renderTemplate(body: string, vars: Record<string, string>): string {
  let out = body;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return out;
}

function buildTemplateVars(ctx: TriggerContext): Record<string, string> {
  return {
    patientName: ctx.patientName ?? '',
    clinicName: ctx.clinicName ?? '',
    doctorName: ctx.doctorName ?? '',
    treatmentName: ctx.treatmentName ?? '',
    packageName: ctx.packageName ?? '',
    appointmentDate: ctx.appointmentDate ?? '',
    clinicPhone: ctx.clinicPhone ?? '',
  };
}

// ── Types ─────────────────────────────────────────────────────────────────

export type PostTreatmentTriggerSource =
  | 'appointment_completed'
  | 'procedure_completed'
  | 'package_item_completed'
  | 'package_completed';

export interface TriggerContext {
  organizationId: string;
  clinicId: string;
  patientId: string;
  patientName?: string | null;
  patientPhone?: string | null;
  clinicName?: string | null;
  clinicPhone?: string | null;
  doctorName?: string | null;
  treatmentName?: string | null;
  packageName?: string | null;
  appointmentDate?: string | null;
  // Source record IDs for deduplication
  appointmentId?: string | null;
  treatmentCaseId?: string | null;
  treatmentProcedureId?: string | null;
  treatmentPackageApplicationId?: string | null;
  serviceId?: string | null;
  packageId?: string | null;
  sourceType: PostTreatmentTriggerSource;
}

// ── Recipient resolution ──────────────────────────────────────────────────

type ResolvedRecipient =
  | { channel: 'whatsapp'; phone: string }
  | { channel: 'instagram'; instagramConnectionId: string; externalSenderId: string }
  | { channel: 'no_recipient' };

async function resolveRecipient(
  clinicId: string,
  patientId: string,
  patientPhone: string | null | undefined,
  templateChannel: string,
): Promise<ResolvedRecipient> {
  const normalizedPhone = patientPhone?.replace(/\D/g, '') ?? null;
  const hasValidPhone = Boolean(normalizedPhone && normalizedPhone.length >= 6 && normalizedPhone.length <= 15);

  if (templateChannel === 'whatsapp' || (templateChannel === 'preferred' && hasValidPhone)) {
    if (hasValidPhone) return { channel: 'whatsapp', phone: normalizedPhone! };
  }

  if (templateChannel === 'instagram' || (templateChannel === 'preferred' && !hasValidPhone)) {
    // Try to find linked Instagram conversation
    const igEntry = await prisma.instagramInboxEntry.findFirst({
      where: { patientId, status: 'open' },
      include: {
        instagramConnection: { select: { id: true, isActive: true, accessTokenEncrypted: true, facebookPageId: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (igEntry?.instagramConnection?.isActive && igEntry.externalSenderId) {
      return {
        channel: 'instagram',
        instagramConnectionId: igEntry.instagramConnectionId!,
        externalSenderId: igEntry.externalSenderId,
      };
    }
  }

  return { channel: 'no_recipient' };
}

// ── Enqueue ───────────────────────────────────────────────────────────────

export async function enqueueTreatmentMessages(ctx: TriggerContext, serviceId?: string | null, packageId?: string | null): Promise<void> {
  // Find active templates for the given service or package
  const where = serviceId
    ? { clinicId: ctx.clinicId, isActive: true, targetType: 'service', serviceId }
    : packageId
      ? { clinicId: ctx.clinicId, isActive: true, targetType: 'package', treatmentPackageId: packageId }
      : null;

  if (!where) return;

  const templates = await prisma.postTreatmentMessageTemplate.findMany({ where });
  if (templates.length === 0) return;

  const patient = await prisma.patient.findUnique({
    where: { id: ctx.patientId },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
  if (!patient) return;

  const patientPhone = patient.phone ?? ctx.patientPhone ?? null;
  const patientName = ctx.patientName ?? `${patient.firstName} ${patient.lastName}`.trim();

  for (const template of templates) {
    const rendered = renderTemplate(template.messageBody, buildTemplateVars({ ...ctx, patientName, patientPhone }));

    const scheduledAt = new Date(Date.now() + template.sendDelayMinutes * 60_000);
    const status = template.requireStaffApproval ? 'waiting_approval' : 'pending';

    // Determine recipient (needed for logging; actual send happens at scheduled time)
    const recipient = await resolveRecipient(ctx.clinicId, ctx.patientId, patientPhone, template.channel);
    const recipientValue = recipient.channel === 'whatsapp'
      ? recipient.phone
      : recipient.channel === 'instagram'
        ? recipient.externalSenderId
        : null;

    // Duplicate check — upsert won't throw, but we log a skip
    const existingCheck = await prisma.postTreatmentMessageQueue.findFirst({
      where: {
        patientId: ctx.patientId,
        templateId: template.id,
        appointmentId: ctx.appointmentId ?? null,
        treatmentProcedureId: ctx.treatmentProcedureId ?? null,
      },
    });

    if (existingCheck) {
      console.info('[post-treatment] duplicate-skipped', {
        templateId: template.id,
        patientIdSuffix: ctx.patientId.slice(-4),
        appointmentIdSuffix: ctx.appointmentId?.slice(-4),
        procedureIdSuffix: ctx.treatmentProcedureId?.slice(-4),
        duplicateSkipped: true,
      });
      continue;
    }

    await prisma.postTreatmentMessageQueue.create({
      data: {
        organizationId: ctx.organizationId,
        clinicId: ctx.clinicId,
        patientId: ctx.patientId,
        templateId: template.id,
        appointmentId: ctx.appointmentId ?? null,
        treatmentCaseId: ctx.treatmentCaseId ?? null,
        treatmentProcedureId: ctx.treatmentProcedureId ?? null,
        treatmentPackageApplicationId: ctx.treatmentPackageApplicationId ?? null,
        serviceId: serviceId ?? null,
        packageId: packageId ?? null,
        channel: recipient.channel === 'no_recipient' ? template.channel : recipient.channel,
        recipient: recipientValue,
        messageBodyRendered: rendered,
        status: recipient.channel === 'no_recipient' ? 'no_recipient' : status,
        scheduledAt,
        sourceType: ctx.sourceType,
      },
    });

    console.info('[post-treatment] enqueued', {
      templateId: template.id,
      clinicIdSuffix: ctx.clinicId.slice(-4),
      patientIdSuffix: ctx.patientId.slice(-4),
      channel: template.channel,
      recipientResolved: recipient.channel,
      sendDelayMinutes: template.sendDelayMinutes,
      requireStaffApproval: template.requireStaffApproval,
      status,
      scheduledAt: scheduledAt.toISOString(),
      sourceType: ctx.sourceType,
    });
  }
}

// ── Appointment completed trigger ──────────────────────────────────────────

export async function triggerOnAppointmentCompleted(args: {
  appointmentId: string;
  clinicId: string;
  organizationId: string;
  patientId: string;
  serviceId: string;
  appointmentTypeId: string;
  practitionerName?: string | null;
  appointmentDate?: string | null;
  treatmentCaseId?: string | null;
}): Promise<void> {
  const [patient, clinic, service] = await Promise.all([
    prisma.patient.findUnique({ where: { id: args.patientId }, select: { firstName: true, lastName: true, phone: true } }),
    prisma.clinic.findUnique({ where: { id: args.clinicId }, select: { name: true, phone: true } }),
    prisma.appointmentType.findUnique({ where: { id: args.serviceId }, select: { name: true } }),
  ]);

  await enqueueTreatmentMessages({
    organizationId: args.organizationId,
    clinicId: args.clinicId,
    patientId: args.patientId,
    patientName: patient ? `${patient.firstName} ${patient.lastName}`.trim() : null,
    patientPhone: patient?.phone ?? null,
    clinicName: clinic?.name ?? null,
    clinicPhone: clinic?.phone ?? null,
    doctorName: args.practitionerName ?? null,
    treatmentName: service?.name ?? null,
    appointmentDate: args.appointmentDate ?? null,
    appointmentId: args.appointmentId,
    treatmentCaseId: args.treatmentCaseId ?? null,
    sourceType: 'appointment_completed',
  }, args.serviceId, null);
}

// ── Procedure completed trigger ────────────────────────────────────────────

export async function triggerOnProcedureCompleted(args: {
  procedureId: string;
  clinicId: string;
  organizationId: string;
  patientId: string;
  serviceId?: string | null;
  treatmentCaseId: string;
  packageApplicationId?: string | null;
  treatmentPackageId?: string | null;
  procedureName?: string | null;
}): Promise<void> {
  if (!args.serviceId) return; // No service linked, nothing to trigger

  const [patient, clinic, service] = await Promise.all([
    prisma.patient.findUnique({ where: { id: args.patientId }, select: { firstName: true, lastName: true, phone: true } }),
    prisma.clinic.findUnique({ where: { id: args.clinicId }, select: { name: true, phone: true } }),
    prisma.appointmentType.findUnique({ where: { id: args.serviceId }, select: { name: true } }),
  ]);

  const sourceType: PostTreatmentTriggerSource = args.treatmentPackageId
    ? 'package_item_completed'
    : 'procedure_completed';

  await enqueueTreatmentMessages({
    organizationId: args.organizationId,
    clinicId: args.clinicId,
    patientId: args.patientId,
    patientName: patient ? `${patient.firstName} ${patient.lastName}`.trim() : null,
    patientPhone: patient?.phone ?? null,
    clinicName: clinic?.name ?? null,
    clinicPhone: clinic?.phone ?? null,
    treatmentName: service?.name ?? args.procedureName ?? null,
    treatmentProcedureId: args.procedureId,
    treatmentCaseId: args.treatmentCaseId,
    treatmentPackageApplicationId: args.packageApplicationId ?? null,
    serviceId: args.serviceId,
    sourceType,
  }, args.serviceId, null);
}

// ── Package completed trigger ─────────────────────────────────────────────

export async function triggerOnPackageCompleted(args: {
  packageApplicationId: string;
  packageId: string;
  clinicId: string;
  organizationId: string;
  patientId: string;
  treatmentCaseId?: string | null;
  packageName?: string | null;
}): Promise<void> {
  const [patient, clinic, pkg] = await Promise.all([
    prisma.patient.findUnique({ where: { id: args.patientId }, select: { firstName: true, lastName: true, phone: true } }),
    prisma.clinic.findUnique({ where: { id: args.clinicId }, select: { name: true, phone: true } }),
    prisma.treatmentPackage.findUnique({ where: { id: args.packageId }, select: { name: true } }),
  ]);

  await enqueueTreatmentMessages({
    organizationId: args.organizationId,
    clinicId: args.clinicId,
    patientId: args.patientId,
    patientName: patient ? `${patient.firstName} ${patient.lastName}`.trim() : null,
    patientPhone: patient?.phone ?? null,
    clinicName: clinic?.name ?? null,
    clinicPhone: clinic?.phone ?? null,
    packageName: pkg?.name ?? args.packageName ?? null,
    treatmentPackageApplicationId: args.packageApplicationId,
    treatmentCaseId: args.treatmentCaseId ?? null,
    packageId: args.packageId,
    sourceType: 'package_completed',
  }, null, args.packageId);
}

// ── Scheduled message processor ───────────────────────────────────────────

export async function processScheduledPostTreatmentMessages(): Promise<void> {
  const now = new Date();

  const pending = await prisma.postTreatmentMessageQueue.findMany({
    where: { status: 'pending', scheduledAt: { lte: now } },
    include: {
      template: { select: { channel: true } },
      patient: { select: { phone: true, firstName: true, lastName: true } },
      service: { select: { name: true } },
    },
    take: 50,
    orderBy: { scheduledAt: 'asc' },
  });

  for (const entry of pending) {
    await sendQueueEntry(entry);
  }
}

async function sendQueueEntry(entry: {
  id: string;
  clinicId: string;
  organizationId: string;
  patientId: string;
  channel: string;
  recipient: string | null;
  messageBodyRendered: string;
  templateId: string;
  appointmentId: string | null;
  patient: { phone: string | null; firstName: string; lastName: string };
  service: { name: string } | null;
}): Promise<void> {
  let success = false;
  let errorMsg: string | null = null;

  try {
    if (entry.channel === 'whatsapp') {
      const phone = entry.recipient ?? entry.patient.phone ?? null;
      if (!phone) throw new Error('NO_PHONE');

      // Build variable dict for Meta Cloud template substitution.
      // Evolution ignores variables and uses messageBodyRendered (plain text).
      const patientName = `${entry.patient.firstName} ${entry.patient.lastName}`.trim();

      const [clinic, appointment] = await Promise.all([
        prisma.clinic.findUnique({
          where: { id: entry.clinicId },
          select: { name: true, phone: true },
        }),
        entry.appointmentId
          ? prisma.appointment.findUnique({
              where: { id: entry.appointmentId },
              select: {
                startTime: true,
                practitioner: { select: { firstName: true, lastName: true } },
              },
            })
          : null,
      ]);

      const variables: Record<string, string> = {
        patient_name: patientName,
        clinic_name: clinic?.name ?? '',
        clinic_phone: clinic?.phone ?? '',
        service_name: entry.service?.name ?? '',
      };

      if (appointment) {
        const dt = appointment.startTime;
        variables.appointment_date = dt.toLocaleDateString('tr-TR', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
        variables.appointment_time = dt.toLocaleTimeString('tr-TR', {
          hour: '2-digit',
          minute: '2-digit',
        });
        if (appointment.practitioner) {
          variables.practitioner_name =
            `${appointment.practitioner.firstName} ${appointment.practitioner.lastName}`.trim();
        }
      }

      const sendResult = await sendPostTreatmentWhatsApp({
        clinicId: entry.clinicId,
        phone,
        evolutionPlainText: entry.messageBodyRendered,
        variables,
        organizationId: entry.organizationId,
        patientId: entry.patientId,
        consentPurpose: 'clinical_followup',
      });

      if (!sendResult.success) {
        const msg = sendResult.code
          ? `${sendResult.code}: ${sendResult.error ?? 'WhatsApp send failed'}`
          : (sendResult.error ?? 'WhatsApp send failed');
        throw new Error(msg);
      }
      success = true;
    } else if (entry.channel === 'instagram') {
      if (!entry.recipient) throw new Error('NO_INSTAGRAM_RECIPIENT');

      const igEntry = await prisma.instagramInboxEntry.findFirst({
        where: { externalSenderId: entry.recipient, patientId: entry.patientId },
        include: { instagramConnection: true },
      });
      if (!igEntry?.instagramConnection) throw new Error('NO_INSTAGRAM_CONNECTION');

      const result = await sendInstagramMessage(igEntry.instagramConnection as InstagramConnectionRecord, {
        recipientIgsid: entry.recipient,
        text: entry.messageBodyRendered,
      });
      if (!result.success) throw new Error(result.error ?? 'Instagram send failed');
      success = true;
    } else {
      throw new Error(`UNKNOWN_CHANNEL:${entry.channel}`);
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[post-treatment] send-failed', {
      queueId: entry.id,
      clinicIdSuffix: entry.clinicId.slice(-4),
      patientIdSuffix: entry.patientId.slice(-4),
      channel: entry.channel,
      error: errorMsg.slice(0, 200),
    });
  }

  await prisma.postTreatmentMessageQueue.update({
    where: { id: entry.id },
    data: {
      status: success ? 'sent' : 'failed',
      sentAt: success ? new Date() : null,
      errorMessage: errorMsg,
    },
  });

  if (success) {
    // Log to patient activity
    const systemUser = await prisma.user.findFirst({
      where: { clinicId: entry.clinicId, isActive: true },
      select: { id: true },
    });
    if (systemUser) {
      await logActivity({
        clinicId: entry.clinicId,
        userId: systemUser.id,
        entityType: 'patient',
        entityId: entry.patientId,
        action: 'post_treatment_message_sent',
        description: `Tedavi sonrası mesaj gönderildi (${entry.channel})`,
        patientId: entry.patientId,
        metadata: {
          systemGenerated: true,
          channel: entry.channel,
          templateId: entry.templateId,
          queueId: entry.id,
        },
      }).catch(() => {});
    }
  }
}

// ── Staff approval ────────────────────────────────────────────────────────

export async function approveAndSendQueueEntry(queueId: string, clinicId: string): Promise<void> {
  const entry = await prisma.postTreatmentMessageQueue.findFirst({
    where: { id: queueId, clinicId, status: 'waiting_approval' },
    include: {
      patient: { select: { phone: true, firstName: true, lastName: true } },
      template: { select: { channel: true } },
      service: { select: { name: true } },
    },
  });
  if (!entry) throw new Error('QUEUE_ENTRY_NOT_FOUND');

  // Set to pending so the regular processor can pick it up, or send immediately
  await sendQueueEntry(entry);
}
