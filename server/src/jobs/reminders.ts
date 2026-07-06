/**
 * Automated notification jobs.
 *
 * The scheduler wakes up every five minutes and checks each clinic's local
 * notification preferences before sending WhatsApp reminders.
 */

import cron from 'node-cron';
import prisma from '../db.js';
import { getClinicOperatingPreferences } from '../services/clinicOperatingPreferences.js';
import type { ClinicOperatingPreferences } from '../services/clinicOperatingPreferences.js';
import { getNotificationPreferences } from '../services/notificationPreferences.js';
import { sendWhatsAppMessage } from '../services/whatsapp/whatsappService.js';
import { sendProactiveWhatsAppMessage } from '../services/whatsapp/whatsappOutboundMessaging.js';
import { logActivity } from '../utils/activity.js';
import { patientContactSelect, userPublicSelect } from '../utils/prismaSelects.js';
import { processScheduledPostTreatmentMessages } from '../services/postTreatmentMessaging.js';

type ClinicForReminder = {
  id: string;
  name: string;
  organizationId: string;
};

const SEND_WINDOW_MINUTES = 5;

const redactPhone = (phone: string | null | undefined) => {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length <= 4) return '***';
  return `***${digits.slice(-4)}`;
};

function renderTemplate(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return out;
}

function hasSensitiveLowChannelVariable(text: string | null | undefined): boolean {
  return /{{\s*(treatment_title|remaining_balance)\s*}}/i.test(text ?? '');
}

function getLocalParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour === '24' ? '00' : parts.hour);

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function getUTCOffsetMs(timezone: string, forDate: Date): number {
  try {
    const parts = getLocalParts(forDate, timezone);
    const localAsUTC = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    return localAsUTC - forDate.getTime();
  } catch {
    return 0;
  }
}

function localDateRangeUTC(
  timezone: string,
  daysFromNow: number,
  now = new Date(),
): { start: Date; end: Date; dateKey: string } {
  const localNow = getLocalParts(now, timezone);
  const targetLocalMidnight = Date.UTC(localNow.year, localNow.month - 1, localNow.day + daysFromNow);
  const nextLocalMidnight = Date.UTC(localNow.year, localNow.month - 1, localNow.day + daysFromNow + 1);
  const start = new Date(targetLocalMidnight - getUTCOffsetMs(timezone, new Date(targetLocalMidnight)));
  const end = new Date(nextLocalMidnight - getUTCOffsetMs(timezone, new Date(nextLocalMidnight)) - 1);
  const dateKey = new Date(targetLocalMidnight).toISOString().slice(0, 10);
  return { start, end, dateKey };
}

function parseTimeToMinutes(sendTime: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(sendTime);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function shouldRunAtConfiguredTime(sendTime: string, timezone: string, now = new Date()): boolean {
  const scheduled = parseTimeToMinutes(sendTime);
  if (scheduled === null) return false;
  const localNow = getLocalParts(now, timezone);
  const current = localNow.hour * 60 + localNow.minute;
  const diff = current - scheduled;
  return diff >= 0 && diff < SEND_WINDOW_MINUTES;
}

function formatPatientName(patient: { firstName: string; lastName: string }): string {
  return `${patient.firstName} ${patient.lastName}`.trim();
}

function formatPatientNameForSchedule(patient: { firstName: string; lastName: string }): string {
  const lastInitial = patient.lastName ? `${patient.lastName.charAt(0)}.` : '';
  return `${patient.firstName} ${lastInitial}`.trim();
}

function getDatePartsForPreference(value: Date, preferences: ClinicOperatingPreferences) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: preferences.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);

  return {
    year: parts.find(part => part.type === 'year')?.value ?? '0000',
    month: parts.find(part => part.type === 'month')?.value ?? '00',
    day: parts.find(part => part.type === 'day')?.value ?? '00',
  };
}

function formatDateWithPreference(value: Date, preferences: ClinicOperatingPreferences): string {
  const { day, month, year } = getDatePartsForPreference(value, preferences);
  if (preferences.dateFormat === 'MM/dd/yyyy') return `${month}/${day}/${year}`;
  if (preferences.dateFormat === 'dd/MM/yyyy') return `${day}/${month}/${year}`;
  if (preferences.dateFormat === 'yyyy-MM-dd') return `${year}-${month}-${day}`;
  return `${day}.${month}.${year}`;
}

function formatTimeWithPreference(value: Date, preferences: ClinicOperatingPreferences): string {
  return new Intl.DateTimeFormat(preferences.locale, {
    timeZone: preferences.timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: preferences.timeFormat === '12h',
  }).format(value);
}

function formatMoney(amount: number, currency: string, preferences: ClinicOperatingPreferences): string {
  return new Intl.NumberFormat(preferences.locale, {
    style: 'currency',
    currency,
  }).format(amount);
}

async function getSystemUserForClinic(clinicId: string, organizationId: string) {
  return prisma.user.findFirst({
    where: {
      organizationId,
      isActive: true,
      role: { in: ['admin', 'owner', 'org_admin', 'clinic_manager', 'OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER'] },
      OR: [
        { defaultClinicId: clinicId },
        { userClinics: { some: { clinicId } } },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });
}

// Exported for testing: picks the most recently updated template from a candidate list.
export function selectBestTemplate<T extends { updatedAt: Date; id: string }>(
  templates: T[],
  purpose: string,
  clinicId: string,
): T | null {
  if (templates.length === 0) return null;
  if (templates.length > 1) {
    console.warn(
      `[reminders] ${templates.length} active "${purpose}" templates for clinic ${clinicId}; using most recently updated (id: ${templates[0].id}).`,
    );
  }
  return [...templates].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
}

async function findWhatsAppTemplateByPurpose(clinicId: string, purpose: string) {
  const templates = await prisma.messageTemplate.findMany({
    where: { clinicId, isActive: true, channel: 'whatsapp', purpose },
  });
  return selectBestTemplate(templates, purpose, clinicId);
}

async function runPatientAppointmentRemindersForClinic(
  clinic: ClinicForReminder,
  timezone: string,
  daysBefore: number,
  operatingPreferences: ClinicOperatingPreferences,
): Promise<void> {
  const { start, end } = localDateRangeUTC(timezone, daysBefore);
  const appointments = await prisma.appointment.findMany({
    where: {
      clinicId: clinic.id,
      startTime: { gte: start, lte: end },
      status: { in: ['scheduled', 'confirmed'] },
    },
    include: {
      patient: { select: patientContactSelect },
      practitioner: { select: userPublicSelect },
    },
  });

  if (appointments.length === 0) return;

  const [reminderTemplate, systemUser] = await Promise.all([
    findWhatsAppTemplateByPurpose(clinic.id, 'appointment_reminder'),
    getSystemUserForClinic(clinic.id, clinic.organizationId),
  ]);
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0));

  for (const appointment of appointments) {
    const patient = appointment.patient;
    if (!patient.phone) {
      console.warn(`[reminders] Patient ${patient.id} has no phone, skipping`);
      continue;
    }

    const appointmentDate = formatDateWithPreference(appointment.startTime, operatingPreferences);
    const appointmentTime = formatTimeWithPreference(appointment.startTime, operatingPreferences);
    const practitionerName = `Dr. ${appointment.practitioner.firstName} ${appointment.practitioner.lastName}`;
    const vars: Record<string, string> = {
      patient_name: formatPatientName(patient),
      clinic_name: clinic.name,
      appointment_date: appointmentDate,
      appointment_time: appointmentTime,
      practitioner_name: practitionerName,
      treatment_title: '',
      remaining_balance: '',
    };
    const dayLabel = daysBefore === 0 ? 'bugün' : `${daysBefore} gün sonra`;
    const body = reminderTemplate
      ? renderTemplate(reminderTemplate.body, vars)
      : `Sayın ${vars.patient_name}, ${clinic.name} randevunuz ${dayLabel} ${appointmentDate} saat ${appointmentTime} için planlanmıştır.\n\nRandevunuzu onaylamak için EVET, iptal etmek için HAYIR yazabilirsiniz.`;

    const alreadySent = await prisma.sentMessage.findFirst({
      where: {
        clinicId: clinic.id,
        appointmentId: appointment.id,
        status: { in: ['sent', 'delivered'] },
        createdAt: { gte: todayStart },
      },
    });
    if (alreadySent) continue;

    const sentMessage = await prisma.sentMessage.create({
      data: {
        clinicId: clinic.id,
        patientId: patient.id,
        appointmentId: appointment.id,
        templateId: reminderTemplate?.id,
        channel: 'whatsapp',
        recipient: patient.phone,
        body,
        status: 'prepared',
        createdById: systemUser?.id,
      },
    });

    try {
      const sendResult = await sendProactiveWhatsAppMessage({
        clinicId: clinic.id,
        phone: patient.phone,
        text: body,
        templateId: reminderTemplate?.id,
        variables: vars,
      });
      if (!sendResult.success) throw new Error(sendResult.error ?? 'WhatsApp send failed');

      await prisma.sentMessage.update({
        where: { id: sentMessage.id },
        data: { status: 'sent', sentAt: new Date() },
      });

      if (systemUser) {
        await logActivity({
          clinicId: clinic.id,
          userId: systemUser.id,
          entityType: 'message',
          entityId: sentMessage.id,
          action: 'auto_sent',
          description: `Otomatik randevu hatırlatması gönderildi: ${formatPatientName(patient)} (${appointmentDate} ${appointmentTime})`,
          patientId: patient.id,
          appointmentId: appointment.id,
        });
      }
    } catch (sendErr: any) {
      await prisma.sentMessage.update({
        where: { id: sentMessage.id },
        data: { status: 'failed' },
      });
      console.error(`[reminders] Failed to send appointment reminder to ${redactPhone(patient.phone)}: ${sendErr.message}`);
    }
  }
}

async function runPractitionerDailyScheduleForClinic(
  clinic: Pick<ClinicForReminder, 'id' | 'name'>,
  timezone: string,
  daysBefore: number,
  operatingPreferences: ClinicOperatingPreferences,
): Promise<void> {
  const { start, end, dateKey } = localDateRangeUTC(timezone, daysBefore);
  const appointments = await prisma.appointment.findMany({
    where: {
      clinicId: clinic.id,
      startTime: { gte: start, lte: end },
      status: { in: ['scheduled', 'confirmed'] },
    },
    include: {
      patient: { select: patientContactSelect },
      practitioner: { select: userPublicSelect },
    },
    orderBy: { startTime: 'asc' },
  });

  if (appointments.length === 0) return;

  type ScheduleAppointment = (typeof appointments)[number];
  const grouped = new Map<string, ScheduleAppointment[]>();
  for (const appointment of appointments) {
    const existing = grouped.get(appointment.practitionerId) ?? [];
    existing.push(appointment);
    grouped.set(appointment.practitionerId, existing);
  }

  const targetLabel = formatDateWithPreference(start, operatingPreferences);

  for (const practitionerAppointments of grouped.values()) {
    const practitioner = practitionerAppointments[0]?.practitioner;
    if (!practitioner?.phone) continue;

    const sentKey = `notification.lastSent.practitionerSchedule.${practitioner.id}.${dateKey}`;
    const alreadySent = await prisma.setting.findUnique({
      where: {
        clinicId_key: {
          clinicId: clinic.id,
          key: sentKey,
        },
      },
    });
    if (alreadySent) continue;

    const lines = practitionerAppointments.map((appointment) => {
      const time = formatTimeWithPreference(appointment.startTime, operatingPreferences);
      return `${time} - ${formatPatientNameForSchedule(appointment.patient)}`;
    });
    const body = [
      `${clinic.name} - ${targetLabel} programınız`,
      '',
      ...lines,
      '',
      'Not: WhatsApp mesajında tedavi veya tıbbi detay paylaşılmamıştır.',
    ].join('\n');

    try {
      const sendResult = await sendWhatsAppMessage(clinic.id, { phone: practitioner.phone, text: body });
      if (!sendResult.success) throw new Error(sendResult.error ?? 'WhatsApp send failed');

      await prisma.setting.upsert({
        where: {
          clinicId_key: {
            clinicId: clinic.id,
            key: sentKey,
          },
        },
        create: {
          clinicId: clinic.id,
          key: sentKey,
          value: new Date().toISOString(),
        },
        update: {
          value: new Date().toISOString(),
        },
      });
    } catch (sendErr: any) {
      console.error(`[reminders] Failed to send practitioner schedule to ${practitioner.id}: ${sendErr.message}`);
    }
  }
}

async function runPaymentRemindersForClinic(
  clinic: ClinicForReminder,
  timezone: string,
  daysBefore: number,
  operatingPreferences: ClinicOperatingPreferences,
): Promise<void> {
  const { start, end, dateKey } = localDateRangeUTC(timezone, daysBefore);
  const installments = await prisma.paymentPlanInstallment.findMany({
    where: {
      dueDate: { gte: start, lte: end },
      status: 'pending',
      plan: {
        clinicId: clinic.id,
        status: 'active',
      },
    },
    include: {
      plan: {
        include: {
          patient: { select: patientContactSelect },
        },
      },
    },
    orderBy: { dueDate: 'asc' },
  });

  if (installments.length === 0) return;

  const [paymentTemplate, systemUser] = await Promise.all([
    findWhatsAppTemplateByPurpose(clinic.id, 'payment_reminder'),
    getSystemUserForClinic(clinic.id, clinic.organizationId),
  ]);
  const safePaymentTemplate = paymentTemplate && !hasSensitiveLowChannelVariable(paymentTemplate.body)
    ? paymentTemplate
    : null;

  for (const installment of installments) {
    const patient = installment.plan.patient;
    if (!patient.phone) continue;

    const subjectKey = `payment-installment-reminder:${installment.id}:${dateKey}`;
    const alreadySent = await prisma.sentMessage.findFirst({
      where: {
        clinicId: clinic.id,
        channel: 'whatsapp',
        subject: subjectKey,
        status: { in: ['prepared', 'sent', 'delivered'] },
      },
    });
    if (alreadySent) continue;

    const dueDate = formatDateWithPreference(installment.dueDate, operatingPreferences);
    const vars: Record<string, string> = {
      patient_name: formatPatientName(patient),
      clinic_name: clinic.name,
      appointment_date: '',
      appointment_time: '',
      practitioner_name: '',
      treatment_title: '',
      remaining_balance: '',
    };
    const body = safePaymentTemplate
      ? renderTemplate(safePaymentTemplate.body, vars)
      : `Sayın ${vars.patient_name}, ${clinic.name} ödeme planınızdaki taksit için son ödeme tarihi ${dueDate}. Detaylar için kliniğinizle iletişime geçebilirsiniz.`;

    const sentMessage = await prisma.sentMessage.create({
      data: {
        clinicId: clinic.id,
        patientId: patient.id,
        templateId: safePaymentTemplate?.id,
        channel: 'whatsapp',
        recipient: patient.phone,
        subject: subjectKey,
        body,
        status: 'prepared',
        createdById: systemUser?.id,
      },
    });

    try {
      const sendResult = await sendProactiveWhatsAppMessage({
        clinicId: clinic.id,
        phone: patient.phone,
        text: body,
        templateId: safePaymentTemplate?.id,
        variables: vars,
      });
      if (!sendResult.success) throw new Error(sendResult.error ?? 'WhatsApp send failed');

      await prisma.sentMessage.update({
        where: { id: sentMessage.id },
        data: { status: 'sent', sentAt: new Date() },
      });

      if (systemUser) {
        await logActivity({
          clinicId: clinic.id,
          userId: systemUser.id,
          entityType: 'message',
          entityId: sentMessage.id,
          action: 'auto_sent',
          description: `Otomatik ödeme hatırlatması gönderildi: ${formatPatientName(patient)} (${dueDate})`,
          patientId: patient.id,
        });
      }
    } catch (sendErr: any) {
      await prisma.sentMessage.update({
        where: { id: sentMessage.id },
        data: { status: 'failed' },
      });
      console.error(`[reminders] Failed to send payment reminder to ${redactPhone(patient.phone)}: ${sendErr.message}`);
    }
  }
}

async function runDailyReminderJob(): Promise<void> {
  console.log('[reminders] Starting notification reminder job...');

  const clinics = await prisma.clinic.findMany();

  for (const clinic of clinics) {
    try {
      const [preferences, operatingPreferences] = await Promise.all([
        getNotificationPreferences(clinic.id),
        getClinicOperatingPreferences(clinic.id),
      ]);
      const timezone = operatingPreferences.timezone || clinic.timezone || 'UTC';

      if (
        preferences.whatsapp.patientAppointmentReminder.enabled &&
        shouldRunAtConfiguredTime(preferences.whatsapp.patientAppointmentReminder.sendTime, timezone)
      ) {
        await runPatientAppointmentRemindersForClinic(
          clinic,
          timezone,
          preferences.whatsapp.patientAppointmentReminder.daysBefore,
          operatingPreferences,
        );
      }

      if (
        preferences.whatsapp.practitionerDailySchedule.enabled &&
        shouldRunAtConfiguredTime(preferences.whatsapp.practitionerDailySchedule.sendTime, timezone)
      ) {
        await runPractitionerDailyScheduleForClinic(
          clinic,
          timezone,
          preferences.whatsapp.practitionerDailySchedule.daysBefore,
          operatingPreferences,
        );
      }

      if (
        preferences.whatsapp.paymentReminder.enabled &&
        shouldRunAtConfiguredTime(preferences.whatsapp.paymentReminder.sendTime, timezone)
      ) {
        await runPaymentRemindersForClinic(
          clinic,
          timezone,
          preferences.whatsapp.paymentReminder.daysBefore,
          operatingPreferences,
        );
      }
    } catch (clinicErr: any) {
      console.error(`[reminders] Error processing clinic ${clinic.id}: ${clinicErr.message}`);
    }
  }

  console.log('[reminders] Notification reminder job complete.');
}

// Overlap kilidi: klinik sayısı arttıkça tek koşu 5 dakikayı aşabilir.
// Kilit olmadan koşular üst üste biner ve dedup kontrolündeki
// "kontrol et → gönder" yarış penceresi mükerrer hasta mesajına yol açar.
// Not: process-içi kilittir; birden fazla replika çalıştırılacaksa DB-tabanlı
// (advisory lock) kilide taşınmalıdır.
let reminderJobRunning = false;
let postTreatmentJobRunning = false;

export function startReminderJobs(): void {
  cron.schedule('*/5 * * * *', () => {
    if (reminderJobRunning) {
      console.warn('[reminders] Previous notification reminder run still in progress, skipping this tick.');
    } else {
      reminderJobRunning = true;
      runDailyReminderJob()
        .catch((err) =>
          console.error('[reminders] Unhandled error in notification reminder job:', err),
        )
        .finally(() => {
          reminderJobRunning = false;
        });
    }

    if (postTreatmentJobRunning) {
      console.warn('[reminders] Previous post-treatment messaging run still in progress, skipping this tick.');
    } else {
      postTreatmentJobRunning = true;
      processScheduledPostTreatmentMessages()
        .catch((err) =>
          console.error('[reminders] Unhandled error in post-treatment messaging job:', err),
        )
        .finally(() => {
          postTreatmentJobRunning = false;
        });
    }
  });

  console.log('[reminders] Scheduled notification reminder job every 5 minutes.');
}

export { runDailyReminderJob };
