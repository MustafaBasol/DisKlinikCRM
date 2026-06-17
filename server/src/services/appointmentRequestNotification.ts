/**
 * appointmentRequestNotification.ts — Sends confirmation messages to patients
 * after a clinic staff member approves (converts) an appointment request.
 *
 * Routes the notification to the original channel:
 *   - whatsapp → sendAppointmentConfirmationWhatsApp (template or plain text)
 *   - instagram → Instagram DM via InstagramMessagingProvider
 *   - manual / unknown → no outbound notification
 */

import prisma from '../db.js';
import { sendAppointmentConfirmationWhatsApp } from './whatsapp/whatsappOutboundMessaging.js';
import {
  sendMessage as sendInstagramMessage,
  type InstagramConnectionRecord,
} from './instagram/InstagramMessagingProvider.js';

function formatConfirmationText(args: {
  patientName: string;
  clinicName: string;
  dateStr: string;
  timeStr: string;
  serviceName: string;
  practitionerName: string;
}): string {
  return (
    `Randevunuz onaylandı!\n\n` +
    `Tarih: ${args.dateStr}\n` +
    `Saat: ${args.timeStr}\n` +
    `Hizmet: ${args.serviceName}\n` +
    `Uzman: ${args.practitionerName}\n\n` +
    `${args.clinicName} kliniğimizde sizi bekliyoruz.`
  );
}

export async function sendAppointmentRequestConfirmationNotification(args: {
  clinicId: string;
  source: string;
  phone: string | null;
  externalSenderId: string | null;
  sourceConnectionId: string | null;
  patientName: string;
  appointment: {
    startTime: Date;
    appointmentType: { name: string };
    practitioner: { firstName: string; lastName: string };
  };
}): Promise<void> {
  const {
    clinicId,
    source,
    phone,
    externalSenderId,
    sourceConnectionId,
    patientName,
    appointment,
  } = args;

  const normalizedSource = String(source ?? '').toLowerCase();
  if (normalizedSource === 'manual') return;

  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { name: true },
  });
  const clinicName = clinic?.name ?? 'Kliniğimiz';

  const dt = appointment.startTime;
  const dateStr = dt.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = dt.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const practitionerName = `${appointment.practitioner.firstName} ${appointment.practitioner.lastName}`.trim();
  const serviceName = appointment.appointmentType.name;

  const plainText = formatConfirmationText({
    patientName,
    clinicName,
    dateStr,
    timeStr,
    serviceName,
    practitionerName,
  });

  const variables: Record<string, string> = {
    patient_name: patientName,
    clinic_name: clinicName,
    appointment_date: dateStr,
    appointment_time: timeStr,
    service_name: serviceName,
    practitioner_name: practitionerName,
  };

  if (normalizedSource === 'instagram') {
    if (!externalSenderId || !sourceConnectionId) {
      console.warn('[appointment-confirmation] instagram notification skipped: missing externalSenderId or sourceConnectionId', {
        clinicId,
        sourceConnectionId: sourceConnectionId ? '[present]' : null,
        externalSenderId: externalSenderId ? '[present]' : null,
      });
      return;
    }
    const conn = await prisma.instagramConnection.findFirst({
      where: { id: sourceConnectionId, isActive: true },
    });
    if (!conn) {
      console.warn('[appointment-confirmation] instagram connection not found or inactive', { sourceConnectionId });
      return;
    }
    const result = await sendInstagramMessage(conn as unknown as InstagramConnectionRecord, {
      recipientIgsid: externalSenderId,
      text: plainText,
    });
    if (!result.success) {
      console.warn('[appointment-confirmation] instagram DM failed', { error: result.error });
    }
    return;
  }

  // Default: treat as whatsapp
  if (!phone) {
    console.warn('[appointment-confirmation] whatsapp notification skipped: no phone on request', { clinicId });
    return;
  }
  const result = await sendAppointmentConfirmationWhatsApp({
    clinicId,
    phone,
    evolutionPlainText: plainText,
    variables,
    connectionId: sourceConnectionId,
  });
  if (!result.success) {
    console.warn('[appointment-confirmation] whatsapp send failed', { code: result.code, error: result.error });
  }
}
