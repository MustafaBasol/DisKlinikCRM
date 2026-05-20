/**
 * permissions.ts — Frontend İzin Yardımcıları
 *
 * NOT: Frontend izinleri YALNIZCA UX kapısıdır (menü görünürlüğü, buton durumları).
 * Gerçek erişim kontrolü her zaman backend tarafından yapılır.
 *
 * Bu dosya server/src/utils/roles.ts ile senkronize tutulmalıdır.
 * Rol normalizasyon mantığı değişirse burada da güncellenmeli.
 */

type UserForPermission = {
  role: string;
  canAccessAllClinics?: boolean;
};

// ─── Rol normalizasyonu (server/src/utils/roles.ts ile aynı mantık) ────────

type CanonicalRole =
  | 'OWNER'
  | 'ORG_ADMIN'
  | 'CLINIC_MANAGER'
  | 'DENTIST'
  | 'RECEPTIONIST'
  | 'BILLING'
  | 'ASSISTANT';

function normalizeRole(userRole: string, canAccessAllClinics = false): CanonicalRole {
  switch (userRole.toLowerCase()) {
    case 'owner':
      return 'OWNER';
    case 'org_admin':
      return 'ORG_ADMIN';
    case 'clinic_manager':
      return 'CLINIC_MANAGER';
    case 'admin':
      return canAccessAllClinics ? 'OWNER' : 'CLINIC_MANAGER';
    case 'doctor':
    case 'dentist':
      return 'DENTIST';
    case 'receptionist':
      return 'RECEPTIONIST';
    case 'billing':
      return 'BILLING';
    case 'assistant':
      return 'ASSISTANT';
    default:
      return 'ASSISTANT';
  }
}

function getRole(user: UserForPermission | null | undefined): CanonicalRole {
  if (!user) return 'ASSISTANT';
  return normalizeRole(user.role, user.canAccessAllClinics ?? false);
}

// ─── İzin fonksiyonları ──────────────────────────────────────────────────────

/** Dashboard: BILLING hariç tüm roller görebilir */
export function canViewDashboard(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return role !== 'ASSISTANT';
}

/**
 * Organization Dashboard: yalnızca OWNER ve ORG_ADMIN.
 * Legacy "admin" + canAccessAllClinics=false → CLINIC_MANAGER → HAYIR.
 * Legacy "admin" + canAccessAllClinics=true  → OWNER → EVET.
 */
export function canViewOrganizationDashboard(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return role === 'OWNER' || role === 'ORG_ADMIN';
}

export function canViewPatients(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'DENTIST' ||
    role === 'RECEPTIONIST'
  );
}

export function canCreatePatient(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'RECEPTIONIST'
  );
}

/** Hasta silme: yalnızca yönetim rolleri */
export function canDeletePatient(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

export function canViewAppointments(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'DENTIST' ||
    role === 'RECEPTIONIST'
  );
}

export function canCreateAppointment(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'RECEPTIONIST'
  );
}

export function canViewPayments(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'BILLING' ||
    role === 'RECEPTIONIST'
  );
}

export function canManagePayments(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'BILLING'
  );
}

export function canViewReports(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'BILLING'
  );
}

export function canViewUsers(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

export function canManageUsers(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

export function canViewInventory(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return role !== 'ASSISTANT';
}

export function canManageInventory(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}
