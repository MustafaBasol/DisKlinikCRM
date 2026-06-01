import prisma from '../db.js';
import { getNotificationPreferences } from './notificationPreferences.js';
import { sendWhatsAppMessage } from './whatsapp/whatsappService.js';

export async function sendTaskAssignmentNotification(
  clinicId: string,
  task: { assignedToId?: string | null },
): Promise<void> {
  if (!task.assignedToId) return;

  try {
    const preferences = await getNotificationPreferences(clinicId);
    if (!preferences.whatsapp.taskAssignment.enabled) return;

    const assignee = await prisma.user.findFirst({
      where: {
        id: task.assignedToId,
        isActive: true,
        OR: [
          { defaultClinicId: clinicId },
          { userClinics: { some: { clinicId } } },
        ],
      },
      select: {
        firstName: true,
        phone: true,
      },
    });

    if (!assignee?.phone) return;

    const body = `Merhaba ${assignee.firstName}, size yeni bir görev atandı. Lütfen CRM içindeki Görevler sayfasından kontrol edin.`;
    const result = await sendWhatsAppMessage(clinicId, { phone: assignee.phone, text: body });
    if (!result.success) {
      console.warn(`[task-assignment] WhatsApp notification failed: ${result.error ?? 'unknown error'}`);
    }
  } catch (error: any) {
    console.warn(`[task-assignment] WhatsApp notification skipped: ${error.message}`);
  }
}
