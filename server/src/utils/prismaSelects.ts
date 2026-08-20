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

// Deliberately identity + contact + status only. NO address fields:
// address / city / postalCode / country have never been part of the list
// payload, and F3-DATA-MIG-TODAY-001-R10 keeps the new `district` scalar out
// of it for the same reason — `district` must behave exactly like its sibling
// `city`. GET /api/patients therefore returns neither; both are returned by
// GET /api/patients/:id, which reads the full Patient row via `include`
// (routes/patients.ts). Adding only `district` here would make the list
// payload inconsistent with the rest of the address block, and would widen
// what BILLING sees (patientListSelect is also the BILLING field-minimization
// select — see patientEmergencyContacts.test.ts section 13).
export const patientListSelect = {
  ...patientContactSelect,
  clinicId: true,
  primaryClinicId: true,
  patientStatus: true,
  source: true,
  createdAt: true,
  updatedAt: true,
} as const;
