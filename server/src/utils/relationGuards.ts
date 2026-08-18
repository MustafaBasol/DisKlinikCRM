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

/**
 * Practitioner role values accepted for clinic-practitioner eligibility.
 * Canonical ('DENTIST') plus legacy-cased storage ('dentist' / 'doctor' —
 * see roles.ts's documented normalization table). Single source of truth
 * for "is this user an eligible practitioner for this clinic" — used by
 * both the external-calendar mapping UI's dropdown (local-options) and the
 * mapping write-path's server-side validation, so a direct API call can
 * never map a non-practitioner (receptionist/manager/billing) user even
 * though the UI no longer lists them. Mirrors the pre-existing
 * getClinicPractitioners()/getActiveDoctorCountForClinic() pattern in
 * routes/whatsapp.ts.
 */
const PRACTITIONER_ROLE_VALUES = ['DENTIST', 'dentist', 'doctor'] as const;

// `role` is the role that made this user eligible FOR THIS CLINIC: the
// branch-scoped UserClinic role when there is one, otherwise the legacy
// primary-assignment User.role. Additive — existing callers ignore it.
type ClinicPractitioner = { id: string; firstName: string; lastName: string; role: string };

/**
 * Lists this clinic's eligible practitioners: users with an active
 * branch-scoped UserClinic assignment carrying a practitioner role, plus
 * users whose legacy primary User.clinicId assignment carries a
 * practitioner role (deduplicated), both requiring User.isActive. Excludes
 * other-clinic and other-org users purely via the clinicId filter.
 */
export async function listClinicPractitioners(clinicId: string): Promise<ClinicPractitioner[]> {
  const assignments = await prisma.userClinic.findMany({
    where: {
      clinicId,
      isActive: true,
      user: { isActive: true },
      role: { in: [...PRACTITIONER_ROLE_VALUES] },
    },
    select: {
      userId: true,
      role: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  const assignedIds = new Set(assignments.map((a) => a.userId));
  const assignedPractitioners = assignments.map((a) => ({ ...a.user, role: a.role }));
  const legacyPractitioners = await prisma.user.findMany({
    where: {
      clinicId,
      isActive: true,
      role: { in: [...PRACTITIONER_ROLE_VALUES] },
      id: { notIn: [...assignedIds] },
    },
    select: { id: true, firstName: true, lastName: true, role: true },
  });
  return [...assignedPractitioners, ...legacyPractitioners].sort((a, b) =>
    `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
  );
}

/**
 * Single-user eligibility check: is `userId` an eligible practitioner for
 * `clinicId`? Same rule as listClinicPractitioners (branch-scoped
 * UserClinic role, or legacy User.clinicId role, either with a
 * practitioner role value and User.isActive) — used to validate a mapping
 * write so it can't accept a non-practitioner or another clinic/org's user.
 */
export async function findClinicPractitioner(
  userId: string,
  clinicId: string,
): Promise<ClinicPractitioner | null> {
  const branchAssignment = await prisma.userClinic.findFirst({
    where: {
      userId,
      clinicId,
      isActive: true,
      user: { isActive: true },
      role: { in: [...PRACTITIONER_ROLE_VALUES] },
    },
    select: { role: true, user: { select: { id: true, firstName: true, lastName: true } } },
  });
  if (branchAssignment) return { ...branchAssignment.user, role: branchAssignment.role };

  return prisma.user.findFirst({
    where: {
      id: userId,
      clinicId,
      isActive: true,
      role: { in: [...PRACTITIONER_ROLE_VALUES] },
    },
    select: { id: true, firstName: true, lastName: true, role: true },
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
