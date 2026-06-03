import prisma from '../db.js';
import { normalizeRole, type CanonicalRole } from './roles.js';

export async function findPatientInClinic(patientId: string, clinicId: string) {
  return prisma.patient.findFirst({
    where: {
      id: patientId,
      deletedAt: null,
      OR: [
        { clinicId },
        { primaryClinicId: clinicId },
        { patientClinics: { some: { clinicId } } },
      ],
    },
    select: { id: true, firstName: true, lastName: true, clinicId: true },
  });
}

export async function findAppointmentTypeInClinic(appointmentTypeId: string, clinicId: string) {
  return prisma.appointmentType.findFirst({
    where: { id: appointmentTypeId, clinicId, isActive: true },
    select: { id: true, name: true, durationMinutes: true },
  });
}

export async function findTreatmentCaseInClinic(treatmentCaseId: string, clinicId: string, patientId?: string | null) {
  return prisma.treatmentCase.findFirst({
    where: {
      id: treatmentCaseId,
      clinicId,
      deletedAt: null,
      ...(patientId ? { patientId } : {}),
    },
    select: { id: true, patientId: true, practitionerId: true, title: true },
  });
}

export async function findAppointmentInClinic(appointmentId: string, clinicId: string, patientId?: string | null) {
  return prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      clinicId,
      deletedAt: null,
      ...(patientId ? { patientId } : {}),
    },
    select: { id: true, patientId: true, practitionerId: true },
  });
}

export async function findUserAssignedToClinic(
  userId: string,
  clinicId: string,
  options?: { roles?: CanonicalRole[] },
) {
  const user = await prisma.user.findFirst({
    where: { id: userId, isActive: true },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      clinicId: true,
      role: true,
      canAccessAllClinics: true,
      userClinics: {
        where: { clinicId, isActive: true },
        select: { role: true },
        take: 1,
      },
    },
  });
  if (!user) return null;

  const assigned = user.clinicId === clinicId || user.canAccessAllClinics || user.userClinics.length > 0;
  if (!assigned) return null;

  const clinicRole = user.userClinics[0]?.role;
  const effectiveRole = user.canAccessAllClinics
    ? normalizeRole(user.role, true)
    : normalizeRole(clinicRole || user.role, false);

  if (options?.roles && !options.roles.includes(effectiveRole)) return null;
  return { ...user, effectiveRole };
}

export async function validateTaskRelations(
  data: {
    patientId?: string | null;
    appointmentId?: string | null;
    treatmentCaseId?: string | null;
    assignedToId?: string | null;
  },
  clinicId: string,
) {
  const patientId = data.patientId || undefined;

  if (patientId && !(await findPatientInClinic(patientId, clinicId))) {
    return { error: 'Invalid patient' };
  }

  if (data.appointmentId) {
    const appointment = await findAppointmentInClinic(data.appointmentId, clinicId, patientId);
    if (!appointment) return { error: 'Invalid appointment' };
  }

  if (data.treatmentCaseId) {
    const treatmentCase = await findTreatmentCaseInClinic(data.treatmentCaseId, clinicId, patientId);
    if (!treatmentCase) return { error: 'Invalid treatment case' };
  }

  if (data.assignedToId) {
    const assignee = await findUserAssignedToClinic(data.assignedToId, clinicId);
    if (!assignee) return { error: 'Invalid assignee' };
  }

  return { error: null };
}
