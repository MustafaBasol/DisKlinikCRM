import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { messageTemplateSchema, prepareMessageSchema } from '../schemas/index.js';
import { sendWhatsAppMessage, resolveConnectionForClinic, resolveConnectionById } from '../services/whatsapp/whatsappService.js';
import { resolveEffectiveClinicId, validateAndGetClinicIdScope } from '../utils/clinicScope.js';
import { recordOperationalEvent } from '../services/operationalEventService.js';
import { getClinicOperatingPreferences } from '../services/clinicOperatingPreferences.js';
import type { ClinicOperatingPreferences } from '../services/clinicOperatingPreferences.js';
import { patientContactSelect, userNameSelect, userPublicSelect } from '../utils/prismaSelects.js';
import {
  sanitizeMetaTemplateName,
  convertBodyToMeta,
  createMetaTemplate,
  syncMetaTemplateStatus,
  META_ERRORS,
} from '../services/metaTemplateService.js';
import { evaluateTemplateBinding, type TemplateBindingStatus } from '../services/whatsapp/templateBinding.js';
import { sendClinicSms } from '../services/sms/smsService.js';
import type { WhatsAppConnectionRecord } from '../services/whatsapp/WhatsAppProvider.js';
import { assertCommunicationPermission } from '../services/communicationConsent/communicationConsentPolicy.js';
import {
  MESSAGE_TEMPLATE_PURPOSE_TO_COMMUNICATION_PURPOSE,
  DEFAULT_MESSAGE_COMMUNICATION_PURPOSE,
} from '../services/whatsapp/whatsappCommunicationPurposeMap.js';
import type { MessageTemplatePurpose } from '../schemas/index.js';

const router = express.Router();
const LOW_SENSITIVITY_CHANNELS = new Set(['sms', 'whatsapp']);
const SENSITIVE_MESSAGE_VARIABLES = ['treatment_title', 'remaining_balance'];

function dentistPatientAccessWhere(userId: string) {
  return {
    OR: [
      { appointments: { some: { practitionerId: userId, deletedAt: null } } },
      { treatmentCases: { some: { practitionerId: userId, deletedAt: null } } },
    ],
  };
}

function getUnsafeMessageVariable(channel: string | null | undefined, ...texts: Array<string | null | undefined>) {
  if (!LOW_SENSITIVITY_CHANNELS.has(String(channel ?? '').toLowerCase())) return null;
  const combined = texts.filter(Boolean).join('\n');
  return SENSITIVE_MESSAGE_VARIABLES.find(variable =>
    new RegExp(`{{\\s*${variable}\\s*}}`, 'i').test(combined)
  ) ?? null;
}

function formatDateForTemplate(value: Date, preferences: ClinicOperatingPreferences): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: preferences.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const year = parts.find(part => part.type === 'year')?.value ?? '0000';
  const month = parts.find(part => part.type === 'month')?.value ?? '00';
  const day = parts.find(part => part.type === 'day')?.value ?? '00';
  if (preferences.dateFormat === 'MM/dd/yyyy') return `${month}/${day}/${year}`;
  if (preferences.dateFormat === 'dd/MM/yyyy') return `${day}/${month}/${year}`;
  if (preferences.dateFormat === 'yyyy-MM-dd') return `${year}-${month}-${day}`;
  return `${day}.${month}.${year}`;
}

function formatTimeForTemplate(value: Date, preferences: ClinicOperatingPreferences): string {
  return new Intl.DateTimeFormat(preferences.locale, {
    timeZone: preferences.timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: preferences.timeFormat === '12h',
  }).format(value);
}

function formatCurrencyForTemplate(value: number, currency: string, preferences: ClinicOperatingPreferences): string {
  return new Intl.NumberFormat(preferences.locale, { style: 'currency', currency }).format(value);
}

async function renderTemplate(text: string, context: any): Promise<string> {
  let rendered = text;
  const preferences = context.clinic?.id
    ? await getClinicOperatingPreferences(context.clinic.id)
    : undefined;
  const appointmentStart = context.appointment ? new Date(context.appointment.startTime) : null;
  const vars: Record<string, string> = {
    patient_name: context.patient ? `${context.patient.firstName} ${context.patient.lastName}` : '',
    clinic_name: context.clinic?.name || '',
    appointment_date: appointmentStart && preferences ? formatDateForTemplate(appointmentStart, preferences) : '',
    appointment_time: context.appointment
      ? preferences ? formatTimeForTemplate(appointmentStart!, preferences) : new Date(context.appointment.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '',
    practitioner_name: context.appointment?.practitioner
      ? `Dr. ${context.appointment.practitioner.firstName} ${context.appointment.practitioner.lastName}`
      : '',
    treatment_title: context.treatmentCase?.title || '',
    remaining_balance:
      context.remainingBalance !== undefined
        ? preferences
          ? formatCurrencyForTemplate(context.remainingBalance, context.clinic?.currency || preferences.currency, preferences)
          : `${context.remainingBalance} ${context.clinic?.currency || 'USD'}`
        : '',
  };

  Object.entries(vars).forEach(([key, value]) => {
    rendered = rendered.replace(new RegExp(`{{${key}}}`, 'g'), value);
  });

  return rendered;
}

// GET /api/message-templates
router.get('/message-templates', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const selectedClinicId = req.query.clinicId as string | undefined;
  const { channel, language, isActive } = req.query;

  try {
    const clinicScope = await validateAndGetClinicIdScope(req.user!, selectedClinicId, res);
    if (clinicScope === false) return;

    const where: any = { ...clinicScope };
    if (channel) where.channel = String(channel);
    if (language) where.language = String(language);
    if (isActive === 'true') where.isActive = true;
    else if (isActive === 'false') where.isActive = false;

    const templates = await prisma.messageTemplate.findMany({ where, orderBy: { name: 'asc' } });

    const connectionCache = new Map<string, WhatsAppConnectionRecord | null>();
    const withBindingStatus = await Promise.all(templates.map(async (template) => {
      const { metaTemplateConnectionId, metaWabaIdSnapshot, ...safe } = template;
      if (template.channel !== 'whatsapp' || !template.metaTemplateName) return safe;

      if (!connectionCache.has(template.clinicId)) {
        connectionCache.set(template.clinicId, await resolveConnectionForClinic(template.clinicId));
      }
      const connection = connectionCache.get(template.clinicId) ?? null;
      const bindingStatus: TemplateBindingStatus = connection
        ? evaluateTemplateBinding(template, connection)
        : 'unbound';

      return { ...safe, bindingStatus, requiresResubmission: bindingStatus !== 'matched' };
    }));

    res.json(withBindingStatus);
  } catch {
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// POST /api/message-templates
// Template authoring is a management responsibility; RECEPTIONIST can READ and SEND
// but should not create or modify reusable templates.
router.post('/message-templates', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']), async (req: AuthRequest, res: Response) => {
  const selectedClinicId = req.query.clinicId as string | undefined;
  const clinicId = await resolveEffectiveClinicId(req.user!, selectedClinicId);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

  const validation = messageTemplateSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const unsafeVariable = getUnsafeMessageVariable(validation.data.channel, validation.data.subject, validation.data.body);
    if (unsafeVariable) {
      return res.status(400).json({
        error: `SMS/WhatsApp templates cannot include sensitive variable {{${unsafeVariable}}}`,
      });
    }

    const template = await prisma.messageTemplate.create({
      data: { ...validation.data, clinicId, createdById: req.user!.id },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'message_template', entityId: template.id,
      action: 'created', description: `"${template.name}" mesaj şablonu oluşturuldu`,
    });

    res.json(template);
  } catch {
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// PUT /api/message-templates/:id
// Same rationale as POST: template management restricted to management roles.
router.put('/message-templates/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const selectedClinicId = req.query.clinicId as string | undefined;
  const validation = messageTemplateSchema.partial().safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const clinicScope = await validateAndGetClinicIdScope(req.user!, selectedClinicId, res);
    if (clinicScope === false) return;

    const existing = await prisma.messageTemplate.findFirst({ where: { id, ...clinicScope } });
    if (!existing) return res.status(404).json({ error: 'Template not found' });

    const nextChannel = validation.data.channel ?? existing.channel;
    const nextSubject = validation.data.subject ?? existing.subject;
    const nextBody = validation.data.body ?? existing.body;
    const unsafeVariable = getUnsafeMessageVariable(nextChannel, nextSubject, nextBody);
    if (unsafeVariable) {
      return res.status(400).json({
        error: `SMS/WhatsApp templates cannot include sensitive variable {{${unsafeVariable}}}`,
      });
    }

    const template = await prisma.messageTemplate.update({
      where: { id },
      data: validation.data,
    });

    await logActivity({
      clinicId: existing.clinicId, userId: req.user!.id, entityType: 'message_template', entityId: id,
      action: 'updated', description: `"${template.name}" mesaj şablonu güncellendi`,
    });

    res.json(template);
  } catch {
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// POST /api/message-templates/seed
router.post('/message-templates/seed', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']), async (req: AuthRequest, res: Response) => {
  const selectedClinicId = req.query.clinicId as string | undefined;
  const clinicId = await resolveEffectiveClinicId(req.user!, selectedClinicId);
  if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

  const defaultTemplates = [
    {
      name: 'Appointment Confirmation',
      channel: 'whatsapp',
      body: 'Hello {{patient_name}}, your appointment at {{clinic_name}} is confirmed for {{appointment_date}} at {{appointment_time}} with {{practitioner_name}}. See you soon!',
      language: 'en',
      purpose: 'appointment_confirmation',
    },
    {
      name: 'Appointment Reminder (24h)',
      channel: 'sms',
      body: 'Reminder: You have an appointment tomorrow, {{appointment_date}} at {{appointment_time}}, at {{clinic_name}}. Please let us know if you cannot attend.',
      language: 'en',
      purpose: 'appointment_reminder',
    },
    {
      name: 'No-Show Follow-Up',
      channel: 'whatsapp',
      body: 'Hello {{patient_name}}, we missed you today at {{clinic_name}}. Would you like to reschedule your appointment? Please contact us.',
      language: 'en',
      purpose: 'no_show_recovery',
    },
    {
      name: 'Treatment Quote Follow-Up',
      channel: 'email',
      subject: 'Follow-up on your treatment plan',
      body: 'Hello {{patient_name}}, we are following up on the treatment plan "{{treatment_title}}" discussed recently. Do you have any questions or would you like to proceed?',
      language: 'en',
      purpose: 'general_message',
    },
    {
      name: 'Payment Reminder',
      channel: 'whatsapp',
      body: 'Hello {{patient_name}}, this is a friendly reminder about your pending clinic balance at {{clinic_name}}. Please contact the clinic for details.',
      language: 'en',
      purpose: 'payment_reminder',
    },
    {
      name: 'Randevu Onayı',
      channel: 'whatsapp',
      body: 'Sayın {{patient_name}}, {{clinic_name}} bünyesindeki randevunuz {{appointment_date}} tarihinde saat {{appointment_time}} için onaylanmıştır. Görüşmek üzere!',
      language: 'tr',
      purpose: 'appointment_confirmation',
    },
    {
      name: 'Randevu Hatırlatma (24s)',
      channel: 'sms',
      body: 'Hatırlatma: Yarın {{appointment_date}} saat {{appointment_time}} için {{clinic_name}} randevunuz bulunmaktadır. Gelemeyecekseniz lütfen bilgi veriniz.',
      language: 'tr',
      purpose: 'appointment_reminder',
    },
    // SMS add-on defaults
    {
      name: 'SMS Appointment Confirmation',
      channel: 'sms',
      body: '{{clinic_name}}: Dear {{patient_name}}, your appointment on {{appointment_date}} at {{appointment_time}} is confirmed.',
      language: 'en',
      purpose: 'appointment_confirmation',
    },
    {
      name: 'SMS Randevu Onayı',
      channel: 'sms',
      body: '{{clinic_name}}: Sayın {{patient_name}}, {{appointment_date}} {{appointment_time}} randevunuz onaylanmıştır.',
      language: 'tr',
      purpose: 'appointment_confirmation',
    },
    {
      name: 'SMS Appointment Cancellation',
      channel: 'sms',
      body: '{{clinic_name}}: Dear {{patient_name}}, your appointment on {{appointment_date}} at {{appointment_time}} has been cancelled. Please contact us to rebook.',
      language: 'en',
      purpose: 'appointment_cancellation',
    },
    {
      name: 'SMS Randevu İptali',
      channel: 'sms',
      body: '{{clinic_name}}: Sayın {{patient_name}}, {{appointment_date}} {{appointment_time}} randevunuz iptal edilmiştir. Yeni randevu için bizimle iletişime geçebilirsiniz.',
      language: 'tr',
      purpose: 'appointment_cancellation',
    },
  ];

  try {
    const created = [];
    for (const t of defaultTemplates) {
      const exists = await prisma.messageTemplate.findFirst({ where: { clinicId, name: t.name, language: t.language } });
      if (!exists) {
        const newT = await prisma.messageTemplate.create({ data: { ...t, clinicId, createdById: req.user!.id } });
        created.push(newT);
      }
    }
    res.json({ message: 'Templates seeded', count: created.length });
  } catch {
    res.status(500).json({ error: 'Failed to seed templates' });
  }
});

// POST /api/messages/prepare
router.post('/messages/prepare', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const { normalizedRole, id: userId } = req.user!;
  const validation = prepareMessageSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  const { templateId, patientId, clinicId: bodyClinicId, appointmentId, treatmentCaseId, paymentId, channelOverride, customSubject, customBody } = validation.data;

  try {
    const selectedClinicId = bodyClinicId ?? (req.query.clinicId as string | undefined);
    const clinicId = await resolveEffectiveClinicId(req.user!, selectedClinicId);
    if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

    const patientWhere: any = { id: patientId, clinicId };
    if (normalizedRole === 'DENTIST') {
      Object.assign(patientWhere, dentistPatientAccessWhere(userId));
    }

    const [patient, clinic, template, appointment, treatmentCase, payment] = await Promise.all([
      prisma.patient.findFirst({ where: patientWhere, select: patientContactSelect }),
      prisma.clinic.findUnique({ where: { id: clinicId } }),
      templateId ? prisma.messageTemplate.findFirst({ where: { id: templateId, clinicId } }) : Promise.resolve(null),
      appointmentId
        ? prisma.appointment.findFirst({ where: { id: appointmentId, clinicId, patientId }, include: { practitioner: { select: userPublicSelect } } })
        : Promise.resolve(null),
      treatmentCaseId
        ? prisma.treatmentCase.findFirst({ where: { id: treatmentCaseId, clinicId, patientId } })
        : Promise.resolve(null),
      paymentId ? prisma.payment.findFirst({ where: { id: paymentId, clinicId, patientId } }) : Promise.resolve(null),
    ]);

    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    let remainingBalance = 0;
    if (treatmentCase) {
      const payments = await prisma.payment.findMany({
        where: { treatmentCaseId: treatmentCase.id, clinicId, paymentStatus: 'paid' },
      });
      const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
      remainingBalance = (treatmentCase.acceptedAmount || treatmentCase.estimatedAmount || 0) - totalPaid;
    }

    const channel = channelOverride || (template?.channel as any) || 'sms';
    const unsafeVariable = getUnsafeMessageVariable(
      channel,
      customSubject ?? template?.subject,
      customBody ?? template?.body,
    );
    if (unsafeVariable) {
      return res.status(400).json({
        error: `SMS/WhatsApp messages cannot include sensitive variable {{${unsafeVariable}}}`,
      });
    }

    const context = { patient, clinic, appointment, treatmentCase, payment, remainingBalance };

    const subject = customSubject || (template ? await renderTemplate(template.subject || '', context) : '');
    const body = customBody || (template ? await renderTemplate(template.body, context) : '');

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
      clinicId, userId: req.user!.id, entityType: 'message', entityId: message.id,
      action: 'prepared',
      description: `${patient.firstName} ${patient.lastName} için ${channel} kanalında mesaj hazırlandı`,
    });

    res.json(message);
  } catch (error: any) {
    console.error('[messages] prepare error:', error?.message ?? error);
    res.status(500).json({ error: 'Failed to prepare message' });
  }
});

// GET /api/messages
router.get('/messages', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const { normalizedRole, id: userId } = req.user!;
  const { patientId, appointmentId, treatmentCaseId, channel, status, clinicId: selectedClinicId } = req.query;

  const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
  if (scope === false) return;

  try {
    const where: any = { ...scope };
    if (patientId) where.patientId = String(patientId);
    if (appointmentId) where.appointmentId = String(appointmentId);
    if (treatmentCaseId) where.treatmentCaseId = String(treatmentCaseId);
    if (channel) where.channel = String(channel);
    if (status) where.status = String(status);
    if (normalizedRole === 'DENTIST') {
      where.patient = dentistPatientAccessWhere(userId);
    }

    const messages = await prisma.sentMessage.findMany({
      where,
      include: { patient: { select: patientContactSelect }, createdBy: { select: userNameSelect } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(messages);
  } catch {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// GET /api/messages/:id
router.get('/messages/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const { normalizedRole, id: userId } = req.user!;

  try {
    const where: any = { id, clinicId };
    if (normalizedRole === 'DENTIST') {
      where.patient = dentistPatientAccessWhere(userId);
    }
    const message = await prisma.sentMessage.findFirst({
      where,
      include: { patient: { select: patientContactSelect }, createdBy: { select: userNameSelect }, template: true },
    });
    if (!message) return res.status(404).json({ error: 'Message not found' });
    res.json(message);
  } catch {
    res.status(500).json({ error: 'Failed to fetch message' });
  }
});

// POST /api/messages/:id/send
router.post('/messages/:id/send', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const message = await prisma.sentMessage.findFirst({
      where: { id, clinicId },
      include: { patient: { select: patientContactSelect }, template: true },
    });
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (message.status !== 'prepared') {
      return res.status(400).json({ error: 'Only prepared messages can be sent' });
    }
    if (!message.recipient) {
      return res.status(400).json({ error: 'Message has no recipient' });
    }

    if (message.channel === 'sms') {
      // SMS is a paid add-on: route through the SMS pipeline (entitlement,
      // consent, quota, region routing). Never silently mark SMS as sent.
      const smsResult = await sendClinicSms({
        organizationId: req.user!.organizationId,
        clinicId,
        patientId: message.patientId,
        appointmentId: message.appointmentId,
        purpose: 'manual_message',
        body: message.body,
        createdById: req.user!.id,
      });
      if (!smsResult.ok) {
        await prisma.sentMessage.update({ where: { id }, data: { status: 'failed' } });
        await logActivity({
          clinicId, userId: req.user!.id, entityType: 'message', entityId: id,
          action: 'send_failed',
          description: `${message.patient.firstName} ${message.patient.lastName} için SMS gönderilemedi: ${smsResult.error}`,
        });
        const httpStatus = smsResult.code === 'addon_disabled' || smsResult.code === 'quota_exceeded' ? 402
          : smsResult.code === 'consent_blocked' ? 403
          : smsResult.code === 'send_failed' ? 502
          : 400;
        return res.status(httpStatus).json({ error: smsResult.error, code: smsResult.code });
      }
    }

    if (message.channel === 'whatsapp') {
      // KVKK-HIGH-007: this generic dispatch path (manual composer + recall
      // drafts) previously called sendWhatsAppMessage with zero consent
      // context at all — the one wired-in gap among the app's WhatsApp
      // senders. No pre-existing legacy gate exists here to reconcile with,
      // so this calls the central decision service directly, governed purely
      // by the existing enforcementMode (disabled today — this is a
      // zero-behavior-change fix until a future rollout enables it).
      const templatePurpose = (message.template?.purpose as MessageTemplatePurpose | undefined) ?? undefined;
      const communicationPurpose = templatePurpose
        ? MESSAGE_TEMPLATE_PURPOSE_TO_COMMUNICATION_PURPOSE[templatePurpose]
        : DEFAULT_MESSAGE_COMMUNICATION_PURPOSE;

      const permission = await assertCommunicationPermission({
        organizationId: req.user!.organizationId,
        clinicId,
        patientId: message.patientId,
        channel: 'whatsapp',
        purpose: communicationPurpose,
      });
      if (permission.blocked) {
        await prisma.sentMessage.update({ where: { id }, data: { status: 'blocked_by_consent' } });
        await logActivity({
          clinicId, userId: req.user!.id, entityType: 'message', entityId: id,
          action: 'send_blocked',
          description: `${message.patient.firstName} ${message.patient.lastName} için WhatsApp mesajı iletişim izni nedeniyle engellendi`,
        });
        return res.status(403).json({ error: 'Patient consent rules block this WhatsApp message.', code: 'consent_blocked' });
      }

      try {
        const sendResult = await sendWhatsAppMessage(clinicId, { phone: message.recipient, text: message.body });
        if (!sendResult.success) throw new Error(sendResult.error ?? 'WhatsApp send failed');
      } catch (sendErr: any) {
        await prisma.sentMessage.update({ where: { id }, data: { status: 'failed' } });
        await logActivity({
          clinicId, userId: req.user!.id, entityType: 'message', entityId: id,
          action: 'send_failed',
          description: `${message.patient.firstName} ${message.patient.lastName} için WhatsApp gönderilemedi: ${sendErr.message}`,
        });
        recordOperationalEvent({
          organizationId: req.user!.organizationId,
          clinicId,
          severity: 'error',
          source: 'whatsapp',
          message: `WhatsApp send failed: ${sendErr.message}`,
          metadata: { messageId: id, recipient: message.recipient, patientId: message.patientId },
        });
        return res.status(502).json({ error: 'WhatsApp send failed', detail: sendErr.message });
      }
    }

    const updated = await prisma.sentMessage.update({
      where: { id },
      data: { status: 'sent', sentAt: new Date() },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'message', entityId: id,
      action: 'sent',
      description: `${message.patient.firstName} ${message.patient.lastName} adresine ${message.channel} ile mesaj gönderildi`,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ── Meta WhatsApp Template Management ────────────────────────────────────────

// POST /api/message-templates/:id/meta/submit
router.post('/message-templates/:id/meta/submit', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicScope = await validateAndGetClinicIdScope(req.user!, undefined, res);
  if (clinicScope === false) return;

  try {
    const template = await prisma.messageTemplate.findFirst({ where: { id, ...clinicScope } });
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const clinicId = template.clinicId;

    if (template.channel !== 'whatsapp') {
      return res.status(400).json({ error: 'Only WhatsApp templates can be submitted for WhatsApp approval.' });
    }

    const connection = await resolveConnectionForClinic(clinicId);
    if (!connection) {
      return res.status(422).json({ code: META_ERRORS.CONNECTION_NOT_FOUND, error: 'Bu işlemi yapabilmek için önce WhatsApp Cloud API bağlantısı kurulmalıdır.' });
    }
    if (!connection.metaWabaId) {
      return res.status(422).json({ code: META_ERRORS.WABA_ID_MISSING, error: 'WhatsApp işletme hesabı bilgileri eksik. Lütfen WhatsApp bağlantı ayarlarını kontrol edin.' });
    }

    const { metaBody, variableMap } = convertBodyToMeta(template.body);

    const body = req.body as Record<string, unknown>;
    const requestedName = typeof body.metaTemplateName === 'string' ? body.metaTemplateName.trim() : '';
    const templateName = requestedName
      ? sanitizeMetaTemplateName(requestedName)
      : sanitizeMetaTemplateName(template.name);

    const languageCode = typeof body.metaTemplateLanguage === 'string' ? body.metaTemplateLanguage : (template.language === 'tr' ? 'tr' : template.language === 'fr' ? 'fr' : 'en');
    const category = typeof body.metaTemplateCategory === 'string' ? body.metaTemplateCategory : 'utility';

    const result = await createMetaTemplate(connection, {
      templateName,
      languageCode,
      category,
      metaBody,
      variableMap,
    });

    if (!result.success) {
      return res.status(422).json({ code: result.code, error: result.message });
    }

    const updated = await prisma.messageTemplate.update({
      where: { id },
      data: {
        metaTemplateName: templateName,
        metaTemplateLanguage: languageCode,
        metaTemplateCategory: category,
        metaTemplateStatus: 'submitted',
        metaTemplateId: result.metaTemplateId ?? undefined,
        metaTemplateVariableMap: variableMap,
        metaTemplateSubmittedAt: new Date(),
        metaTemplateRejectionReason: null,
        // Snapshot which connection/WABA this submission targeted, so later
        // sync/usage can detect if the clinic's active connection has changed.
        metaTemplateConnectionId: connection.id,
        metaWabaIdSnapshot: connection.metaWabaId,
        metaPhoneNumberIdSnapshot: connection.metaPhoneNumberId ?? null,
      },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'message_template', entityId: id,
      action: 'meta_submitted', description: `"${template.name}" şablonu WhatsApp onayına gönderildi`,
    });

    res.json({
      status: updated.metaTemplateStatus,
      metaTemplateName: updated.metaTemplateName,
      metaTemplateLanguage: updated.metaTemplateLanguage,
      metaTemplateCategory: updated.metaTemplateCategory,
      metaTemplateSubmittedAt: updated.metaTemplateSubmittedAt,
      variableMap: updated.metaTemplateVariableMap,
    });
  } catch {
    res.status(500).json({ error: 'Failed to submit template for WhatsApp approval' });
  }
});

// POST /api/message-templates/:id/meta/sync
router.post('/message-templates/:id/meta/sync', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicScope = await validateAndGetClinicIdScope(req.user!, undefined, res);
  if (clinicScope === false) return;

  try {
    const template = await prisma.messageTemplate.findFirst({ where: { id, ...clinicScope } });
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const clinicId = template.clinicId;
    if (!template.metaTemplateName) {
      return res.status(400).json({ error: 'This template has not been submitted for WhatsApp approval yet.' });
    }

    let connection: WhatsAppConnectionRecord | null = null;
    let bindingStatus: TemplateBindingStatus = 'unbound';

    if (template.metaTemplateConnectionId) {
      // Template has a stored binding — use that specific connection, not whatever
      // is currently the clinic's default, so we never silently sync against the
      // wrong WABA.
      connection = await resolveConnectionById(template.metaTemplateConnectionId, clinicId);
      if (!connection) {
        return res.status(422).json({
          code: META_ERRORS.CONNECTION_NOT_FOUND,
          error: 'Bu şablonun bağlı olduğu WhatsApp bağlantısı artık bulunamıyor veya devre dışı bırakılmış. Lütfen şablonu yeniden gönderin.',
        });
      }
      bindingStatus = evaluateTemplateBinding(template, connection);
      if (bindingStatus === 'mismatched') {
        return res.status(409).json({
          code: META_ERRORS.WABA_MISMATCH,
          error: 'Bu şablon farklı bir WhatsApp Business hesabı için onaylanmış olabilir. Mevcut bağlantıda kullanmadan önce yeniden gönderim/onay gerekebilir.',
          requiresResubmission: true,
        });
      }
    } else {
      // Legacy template with no stored binding — fall back to the clinic's default
      // connection, but flag the result as unbound so the UI can warn the user.
      connection = await resolveConnectionForClinic(clinicId);
    }

    if (!connection) {
      return res.status(422).json({ code: META_ERRORS.CONNECTION_NOT_FOUND, error: 'Bu işlemi yapabilmek için önce WhatsApp Cloud API bağlantısı kurulmalıdır.' });
    }
    if (!connection.metaWabaId) {
      return res.status(422).json({ code: META_ERRORS.WABA_ID_MISSING, error: 'WhatsApp işletme hesabı bilgileri eksik. Lütfen WhatsApp bağlantı ayarlarını kontrol edin.' });
    }

    const result = await syncMetaTemplateStatus(id, connection);
    if (!result.success) {
      return res.status(422).json({ code: result.code, error: result.message });
    }

    res.json({
      status: result.status,
      rejectionReason: result.rejectionReason,
      lastSyncedAt: new Date(),
      bindingStatus,
      requiresResubmission: bindingStatus !== 'matched',
    });
  } catch {
    res.status(500).json({ error: 'Failed to sync WhatsApp approval status' });
  }
});

// GET /api/message-templates/:id/meta/status
router.get('/message-templates/:id/meta/status', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicScope = await validateAndGetClinicIdScope(req.user!, undefined, res);
  if (clinicScope === false) return;

  try {
    const template = await prisma.messageTemplate.findFirst({
      where: { id, ...clinicScope },
      select: {
        id: true,
        clinicId: true,
        metaTemplateName: true,
        metaTemplateLanguage: true,
        metaTemplateCategory: true,
        metaTemplateStatus: true,
        metaTemplateRejectionReason: true,
        metaTemplateLastSyncedAt: true,
        metaTemplateSubmittedAt: true,
        metaTemplateVariableMap: true,
        metaTemplateConnectionId: true,
        metaWabaIdSnapshot: true,
      },
    });
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const clinicId = template.clinicId;

    let bindingStatus: TemplateBindingStatus = 'unbound';
    if (template.metaTemplateName) {
      const connection = template.metaTemplateConnectionId
        ? await resolveConnectionById(template.metaTemplateConnectionId, clinicId)
        : await resolveConnectionForClinic(clinicId);
      bindingStatus = connection ? evaluateTemplateBinding(template, connection) : 'unbound';
    }

    const { metaTemplateConnectionId, metaWabaIdSnapshot, clinicId: _clinicId, ...safeTemplate } = template;
    res.json({
      ...safeTemplate,
      bindingStatus,
      requiresResubmission: Boolean(template.metaTemplateName) && bindingStatus !== 'matched',
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch WhatsApp approval status' });
  }
});

export default router;
