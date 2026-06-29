import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

export const logActivity = async (data: {
  clinicId: string;
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  description?: string;
  patientId?: string | null;
  appointmentId?: string | null;
  treatmentCaseId?: string | null;
  insuranceProvisionId?: string | null;
  metadata?: any;
}) => {
  try {
    const relationFields: any = {};
    if (data.entityType === 'patient') relationFields.patientId = data.entityId;
    if (data.entityType === 'appointment') relationFields.appointmentId = data.entityId;
    if (data.entityType === 'treatment_case') relationFields.treatmentCaseId = data.entityId;
    if (data.entityType === 'insurance_provision') relationFields.insuranceProvisionId = data.entityId;
    if (data.patientId) relationFields.patientId = data.patientId;
    if (data.appointmentId) relationFields.appointmentId = data.appointmentId;
    if (data.treatmentCaseId) relationFields.treatmentCaseId = data.treatmentCaseId;
    if (data.insuranceProvisionId) relationFields.insuranceProvisionId = data.insuranceProvisionId;

    await prisma.activityLog.create({
      data: {
        clinicId: data.clinicId,
        userId: data.userId,
        entityType: data.entityType,
        entityId: data.entityId,
        ...relationFields,
        action: data.action,
        description: data.description,
        metadataJson: data.metadata ? JSON.stringify(data.metadata) : null,
      },
    });
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
};
