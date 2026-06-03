export const userNameSelect = {
  id: true,
  firstName: true,
  lastName: true,
} as const;

export const userPublicSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  role: true,
  isActive: true,
} as const;

export const userNameRoleSelect = {
  id: true,
  firstName: true,
  lastName: true,
  role: true,
} as const;

export const patientNameSelect = {
  id: true,
  firstName: true,
  lastName: true,
} as const;

export const patientContactSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
} as const;

export const patientListSelect = {
  ...patientContactSelect,
  clinicId: true,
  primaryClinicId: true,
  patientStatus: true,
  source: true,
  createdAt: true,
  updatedAt: true,
} as const;
