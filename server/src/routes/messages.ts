import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { messageTemplateSchema, prepareMessageSchema } from '../schemas/index.js';
import { sendWhatsAppMessage } from '../services/whatsapp/whatsappService.js';
import { validateAndGetClinicIdScope } from '../utils/clinicScope.js';
import { recordOperationalEvent } from '../services/operationalEventService.js';
import { getClinicOperatingPreferences } from '../services/clinicOperatingPreferences.js';
import type { ClinicOperatingPreferences } from '../services/clinicOperatingPreferences.js';
import { patientContactSelect, userNameSelect, userPublicSelect } from '../utils/prismaSelects.js';

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
    res.json(templates);
  } catch {
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// POST /api/message-templates
// Template authoring is a management responsibility; RECEPTIONIST can READ and SEND
// but should not create or modify reusable templates.
router.post('/message-templates', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
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
  const clinicId = req.user!.clinicId;
  const validation = messageTemplateSchema.partial().safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const existing = await prisma.messageTemplate.findFirst({ where: { id, clinicId } });
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
      clinicId, userId: req.user!.id, entityType: 'message_template', entityId: id,
      action: 'updated', description: `"${template.name}" mesaj şablonu güncellendi`,
    });

    res.json(template);
  } catch {
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// POST /api/message-templates/seed
router.post('/message-templates/seed', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']), async (req: AuthRequest, res: Response) => {
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
      body: 'Hello {{patient_name}}, this is a friendly reminder about your pending clinic balance at {{clinic_name}}. Please contact the clinic for details.',
      language: 'en',
    },
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
  const clinicId = req.user!.clinicId;
  const { normalizedRole, id: userId } = req.user!;
  const validation = prepareMessageSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  const { templateId, patientId, appointmentId, treatmentCaseId, paymentId, channelOverride, customSubject, customBody } = validation.data;

  try {
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
  const clinicId = req.user!.clinicId;
  const { normalizedRole, id: userId } = req.user!;
  const { patientId, appointmentId, treatmentCaseId, channel, status } = req.query;

  try {
    const where: any = { clinicId };
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
      include: { patient: { select: patientContactSelect } },
    });
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (message.status !== 'prepared') {
      return res.status(400).json({ error: 'Only prepared messages can be sent' });
    }
    if (!message.recipient) {
      return res.status(400).json({ error: 'Message has no recipient' });
    }

    if (message.channel === 'whatsapp') {
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

export default router;
