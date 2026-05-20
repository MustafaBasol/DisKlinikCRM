/**
 * permissions.ts — Frontend İzin Yardımcıları
 *
 * NOT: Frontend izinleri YALNIZCA UX kapısıdır (menü görünürlüğü, buton durumları).
 * Gerçek erişim kontrolü her zaman backend tarafından yapılır.
 *
 * Öncelik sırası:
 *   1. user.permissions (backend /api/me'den gelen bayraklar) — varsa bunlar kullanılır
 *   2. Local normalizeRole() hesabı — fallback olarak kullanılır
 *
 * Bu dosya server/src/utils/roles.ts ile senkronize tutulmalıdır.
 */

type ServerPermissions = {
  canViewOrganizationDashboard?: boolean;
  canDeletePatient?: boolean;
  canManageUsers?: boolean;
  canViewReports?: boolean;
  canManagePayments?: boolean;
  canManageInventory?: boolean;
};

type UserForPermission = {
  role: string;
  canAccessAllClinics?: boolean;
  permissions?: ServerPermissions;
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

export function normalizeRole(userRole: string, canAccessAllClinics = false): CanonicalRole {
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
  if (user?.permissions?.canViewOrganizationDashboard !== undefined) {
    return user.permissions.canViewOrganizationDashboard;
  }
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
  if (user?.permissions?.canDeletePatient !== undefined) {
    return user.permissions.canDeletePatient;
  }
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
  if (user?.permissions?.canManagePayments !== undefined) {
    return user.permissions.canManagePayments;
  }
  const role = getRole(user);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'BILLING'
  );
}

export function canViewReports(user: UserForPermission | null | undefined): boolean {
  if (user?.permissions?.canViewReports !== undefined) {
    return user.permissions.canViewReports;
  }
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
  if (user?.permissions?.canManageUsers !== undefined) {
    return user.permissions.canManageUsers;
  }
  const role = getRole(user);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

export function canViewInventory(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return role !== 'ASSISTANT';
}

export function canManageInventory(user: UserForPermission | null | undefined): boolean {
  if (user?.permissions?.canManageInventory !== undefined) {
    return user.permissions.canManageInventory;
  }
  const role = getRole(user);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}
