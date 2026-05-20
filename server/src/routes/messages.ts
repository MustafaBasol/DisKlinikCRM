import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { getParam } from '../utils/helpers.js';
import { messageTemplateSchema, prepareMessageSchema } from '../schemas/index.js';
import { sendTextMessage } from '../services/evolutionApi.js';
import { validateAndGetClinicIdScope } from '../utils/clinicScope.js';

const router = express.Router();

async function renderTemplate(text: string, context: any): Promise<string> {
  let rendered = text;
  const vars: Record<string, string> = {
    patient_name: context.patient ? `${context.patient.firstName} ${context.patient.lastName}` : '',
    clinic_name: context.clinic?.name || '',
    appointment_date: context.appointment ? new Date(context.appointment.startTime).toLocaleDateString() : '',
    appointment_time: context.appointment
      ? new Date(context.appointment.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '',
    practitioner_name: context.appointment?.practitioner
      ? `Dr. ${context.appointment.practitioner.firstName} ${context.appointment.practitioner.lastName}`
      : '',
    treatment_title: context.treatmentCase?.title || '',
    remaining_balance:
      context.remainingBalance !== undefined
        ? `${context.remainingBalance} ${context.clinic?.currency || 'USD'}`
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
router.post('/message-templates', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const clinicId = req.user!.clinicId;
  const validation = messageTemplateSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
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
router.put('/message-templates/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;
  const validation = messageTemplateSchema.partial().safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const template = await prisma.messageTemplate.update({
      where: { id, clinicId },
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
      body: 'Hello {{patient_name}}, this is a friendly reminder regarding a pending balance of {{remaining_balance}} at {{clinic_name}}. You can settle this at your next visit or via bank transfer.',
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
  const validation = prepareMessageSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  const { templateId, patientId, appointmentId, treatmentCaseId, paymentId, channelOverride, customSubject, customBody } = validation.data;

  try {
    const [patient, clinic, template, appointment, treatmentCase, payment] = await Promise.all([
      prisma.patient.findFirst({ where: { id: patientId, clinicId } }),
      prisma.clinic.findUnique({ where: { id: clinicId } }),
      templateId ? prisma.messageTemplate.findFirst({ where: { id: templateId, clinicId } }) : Promise.resolve(null),
      appointmentId
        ? prisma.appointment.findFirst({ where: { id: appointmentId, clinicId, patientId }, include: { practitioner: true } })
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
      clinicId, userId: req.user!.id, entityType: 'message', entityId: message.id,
      action: 'prepared',
      description: `${patient.firstName} ${patient.lastName} için ${channel} kanalında mesaj hazırlandı`,
    });

    res.json(message);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to prepare message' });
  }
});

// GET /api/messages
router.get('/messages', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
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
  } catch {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// GET /api/messages/:id
router.get('/messages/:id', authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']), async (req: AuthRequest, res: Response) => {
  const id = getParam(req, 'id');
  const clinicId = req.user!.clinicId;

  try {
    const message = await prisma.sentMessage.findFirst({
      where: { id, clinicId },
      include: { patient: true, createdBy: true, template: true },
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
      include: { patient: true },
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
        await sendTextMessage(message.recipient, message.body);
      } catch (sendErr: any) {
        await prisma.sentMessage.update({ where: { id }, data: { status: 'failed' } });
        await logActivity({
          clinicId, userId: req.user!.id, entityType: 'message', entityId: id,
          action: 'send_failed',
          description: `${message.patient.firstName} ${message.patient.lastName} için WhatsApp gönderilemedi: ${sendErr.message}`,
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
