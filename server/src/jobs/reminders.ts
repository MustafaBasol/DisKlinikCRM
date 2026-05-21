/**
 * Automated reminder cron jobs.
 *
 * Jobs:
 *  - dailyReminder: runs every day at 10:00 (clinic local time is best-effort;
 *    server UTC is used — adjust cron expression or add timezone offset as needed).
 *    Finds every clinic's appointments scheduled for the next calendar day,
 *    looks up the clinic's WhatsApp reminder template, prepares a SentMessage
 *    record, and immediately sends it via Evolution API.
 *
 * Usage: call `startReminderJobs()` once at server startup.
 */

import cron from 'node-cron';
import prisma from '../db.js';
import { sendWhatsAppMessage } from '../services/whatsapp/whatsappService.js';
import { logActivity } from '../utils/activity.js';

// ── helpers ─────────────────────────────────────────────────────────────────

function renderTemplate(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return out;
}

/** Returns the start (00:00:00.000) and end (23:59:59.999) of tomorrow in UTC
 *  for a given IANA timezone string. Falls back to UTC if timezone is invalid. */
function tomorrowRangeUTC(timezone: string): { start: Date; end: Date } {
  try {
    const now = new Date();
    // Get tomorrow's date string in the clinic timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    // "en-CA" gives YYYY-MM-DD
    const todayStr = formatter.format(now);
    const [y, m, d] = todayStr.split('-').map(Number);
    const tomorrowLocal = new Date(y, m - 1, d + 1); // midnight local

    // Convert midnight local to UTC boundaries
    const midnightLocalStr = `${y}-${String(m).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}T00:00:00`;
    const start = new Date(
      new Date(midnightLocalStr).toLocaleString('en-US', { timeZone: timezone })
        // This gives us an approximate, good-enough UTC offset
    );
    // Simpler: use Intl to resolve UTC offsets properly
    const startISO = new Date(`${y}-${String(m).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}T00:00:00`);
    const endISO = new Date(`${y}-${String(m).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}T23:59:59.999`);

    // Shift by timezone UTC offset (rough but functional for most clinic timezones)
    const offsetMs = getUTCOffsetMs(timezone, startISO);
    return {
      start: new Date(startISO.getTime() - offsetMs),
      end: new Date(endISO.getTime() - offsetMs),
    };
  } catch {
    // Fallback: UTC tomorrow
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const end = new Date(start.getTime() + 86400000 - 1);
    return { start, end };
  }
}

function getUTCOffsetMs(timezone: string, forDate: Date): number {
  try {
    const utcStr = forDate.toLocaleString('en-US', { timeZone: 'UTC' });
    const localStr = forDate.toLocaleString('en-US', { timeZone: timezone });
    return new Date(utcStr).getTime() - new Date(localStr).getTime();
  } catch {
    return 0;
  }
}

// ── core job ─────────────────────────────────────────────────────────────────

async function runDailyReminderJob(): Promise<void> {
  console.log('[reminders] Starting daily reminder job…');

  // Get all clinics
  const clinics = await prisma.clinic.findMany();

  for (const clinic of clinics) {
    try {
      const timezone = clinic.timezone || 'UTC';
      const { start, end } = tomorrowRangeUTC(timezone);

      // Find tomorrow's scheduled/confirmed appointments for this clinic
      const appointments = await prisma.appointment.findMany({
        where: {
          clinicId: clinic.id,
          startTime: { gte: start, lte: end },
          status: { in: ['scheduled', 'confirmed'] },
        },
        include: {
          patient: true,
          practitioner: true,
        },
      });

      if (appointments.length === 0) continue;

      // Find reminder template for this clinic (prefer whatsapp channel, any language)
      const reminderTemplate = await prisma.messageTemplate.findFirst({
        where: {
          clinicId: clinic.id,
          isActive: true,
          OR: [
            { name: { contains: 'Reminder', mode: 'insensitive' } },
            { name: { contains: 'Hatırlatma', mode: 'insensitive' } },
            { name: { contains: 'reminder', mode: 'insensitive' } },
          ],
          channel: 'whatsapp',
        },
        orderBy: { createdAt: 'asc' },
      });

      // Find the system user (admin) for this clinic to attribute automated messages
      const systemUser = await prisma.user.findFirst({
        where: { clinicId: clinic.id, role: 'admin' },
        orderBy: { createdAt: 'asc' },
      });

      if (!systemUser) {
        console.warn(`[reminders] No admin user found for clinic ${clinic.id}, skipping`);
        continue;
      }

      for (const appt of appointments) {
        const patient = appt.patient;
        const phone = patient.phone;

        if (!phone) {
          console.warn(`[reminders] Patient ${patient.id} has no phone, skipping`);
          continue;
        }

        // Build message body
        const apptDate = appt.startTime.toLocaleDateString('tr-TR', { timeZone: timezone, dateStyle: 'short' });
        const apptTime = appt.startTime.toLocaleTimeString('tr-TR', { timeZone: timezone, hour: '2-digit', minute: '2-digit' });
        const practitionerName = `Dr. ${appt.practitioner.firstName} ${appt.practitioner.lastName}`;

        const vars: Record<string, string> = {
          patient_name: `${patient.firstName} ${patient.lastName}`,
          clinic_name: clinic.name,
          appointment_date: apptDate,
          appointment_time: apptTime,
          practitioner_name: practitionerName,
          treatment_title: '',
          remaining_balance: '',
        };

        const body = reminderTemplate
          ? renderTemplate(reminderTemplate.body, vars)
          : `Sayın ${vars.patient_name}, yarın ${apptDate} saat ${apptTime} için ${clinic.name} randevunuz bulunmaktadır.\n\nRandevunuzu onaylamak için EVET, iptal etmek için HAYIR yazabilirsiniz.\n\nGörüşmek üzere!`;

        // Check: don't re-send if a reminder was already sent today for this appointment
        const alreadySent = await prisma.sentMessage.findFirst({
          where: {
            clinicId: clinic.id,
            appointmentId: appt.id,
            status: { in: ['sent', 'delivered'] },
            createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          },
        });

        if (alreadySent) {
          console.log(`[reminders] Reminder already sent for appointment ${appt.id}, skipping`);
          continue;
        }

        // Persist the message
        const sentMessage = await prisma.sentMessage.create({
          data: {
            clinicId: clinic.id,
            patientId: patient.id,
            appointmentId: appt.id,
            templateId: reminderTemplate?.id,
            channel: 'whatsapp',
            recipient: phone,
            body,
            status: 'prepared',
            createdById: systemUser.id,
          },
        });

        // Send via WhatsApp (provider-agnostic)
        try {
          const sendResult = await sendWhatsAppMessage(clinic.id, { phone, text: body });
          if (!sendResult.success) throw new Error(sendResult.error ?? 'WhatsApp send failed');
          await prisma.sentMessage.update({
            where: { id: sentMessage.id },
            data: { status: 'sent', sentAt: new Date() },
          });

          await logActivity({
            clinicId: clinic.id,
            userId: systemUser.id,
            entityType: 'message',
            entityId: sentMessage.id,
            action: 'auto_sent',
            description: `Sistem tarafından otomatik hatırlatma gönderildi — ${patient.firstName} ${patient.lastName} (${apptDate} ${apptTime})`,
            patientId: patient.id,
            appointmentId: appt.id,
          });

          console.log(`[reminders] Sent reminder to ${patient.firstName} ${patient.lastName} (${phone})`);
        } catch (sendErr: any) {
          await prisma.sentMessage.update({
            where: { id: sentMessage.id },
            data: { status: 'failed' },
          });
          console.error(`[reminders] Failed to send to ${phone}: ${sendErr.message}`);
        }
      }
    } catch (clinicErr: any) {
      console.error(`[reminders] Error processing clinic ${clinic.id}: ${clinicErr.message}`);
    }
  }

  console.log('[reminders] Daily reminder job complete.');
}

// ── exports ──────────────────────────────────────────────────────────────────

/**
 * Starts all scheduled cron jobs.
 * Call once at server startup after dotenv.config().
 */
export function startReminderJobs(): void {
  // Run every day at 10:00 AM server time
  cron.schedule('0 10 * * *', () => {
    runDailyReminderJob().catch((err) =>
      console.error('[reminders] Unhandled error in daily reminder job:', err)
    );
  });

  console.log('[reminders] Scheduled daily reminder job at 10:00 AM.');
}

/** Exported for manual triggering (admin endpoint / testing). */
export { runDailyReminderJob };
