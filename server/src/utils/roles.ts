/**
 * roles.ts — Merkezi Rol Normalizasyonu ve Yetki Yardımcıları
 *
 * Kanonik roller (uzun vadeli):
 *   OWNER | ORG_ADMIN | CLINIC_MANAGER | DENTIST | RECEPTIONIST | BILLING | ASSISTANT
 *
 * Eski (legacy) roller User.role'de küçük harf olarak saklanır:
 *   admin | doctor | receptionist | billing
 *
 * Normalizasyon kuralları:
 *   admin + canAccessAllClinics=true   → OWNER
 *   admin + canAccessAllClinics=false  → CLINIC_MANAGER
 *   owner / OWNER                      → OWNER
 *   org_admin / ORG_ADMIN              → ORG_ADMIN
 *   clinic_manager / CLINIC_MANAGER    → CLINIC_MANAGER
 *   doctor / DENTIST                   → DENTIST
 *   receptionist / RECEPTIONIST        → RECEPTIONIST
 *   billing / BILLING                  → BILLING
 *   assistant / ASSISTANT              → ASSISTANT
 *
 * Önemli:
 *   - authorize() middleware bunu kullanarak kanonik rolleri ve legacy rolleri destekler.
 *   - Doğrudan ham rol string karşılaştırması yapmak yerine bu yardımcıları kullanın.
 *   - UserClinic.role şube bazlı yetki kaynağıdır; User.role organizasyon geneli varsayılandır.
 */

export type CanonicalRole =
  | 'OWNER'
  | 'ORG_ADMIN'
  | 'CLINIC_MANAGER'
  | 'DENTIST'
  | 'RECEPTIONIST'
  | 'BILLING'
  | 'ASSISTANT';

export type UserForRole = {
  role: string;
  canAccessAllClinics?: boolean;
};

/**
 * Ham rol string'ini + canAccessAllClinics bayrağını kanonik role dönüştürür.
 * Bilinmeyen roller varsayılan olarak en kısıtlayıcı role (ASSISTANT) yönlendirilir.
 */
export function normalizeRole(
  userRole: string,
  canAccessAllClinics: boolean = false
): CanonicalRole {
  switch (userRole.toLowerCase()) {
    case 'owner':
      return 'OWNER';
    case 'org_admin':
      return 'ORG_ADMIN';
    case 'clinic_manager':
      return 'CLINIC_MANAGER';
    case 'admin':
      // Legacy admin: canAccessAllClinics varsa OWNER, yoksa CLINIC_MANAGER
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
      // Bilinmeyen rol → erişimi kısıtla
      return 'ASSISTANT';
  }
}

/**
 * Belirli bir klinik için kullanıcının efektif kanonik rolünü döndürür.
 *
 * - canAccessAllClinics=true ise organizasyon düzeyindeki rol kullanılır.
 * - userClinicRole sağlanmışsa (UserClinic.role) şube bazlı rol kullanılır.
 * - Hiçbiri yoksa User.role kullanılır (canAccessAllClinics=false varsayımıyla).
 * - Erişim yoksa null döner.
 */
export function getEffectiveRoleForClinic(
  user: UserForRole & {
    allowedClinicIds?: string[];
    userClinicRole?: string | null;
  },
  clinicId: string
): CanonicalRole | null {
  const canAll = (user as any).canAccessAllClinics === true;

  if (canAll) {
    return normalizeRole(user.role, true);
  }

  // Şubeye atanmış UserClinic.role varsa onu kullan
  if (user.userClinicRole) {
    return normalizeRole(user.userClinicRole, false);
  }

  // Kullanıcının bu kliniğe erişimi var mı?
  const allowed = user.allowedClinicIds ?? [];
  if (!allowed.includes(clinicId)) {
    return null; // Erişim yok
  }

  return normalizeRole(user.role, false);
}

// ─── İzin yardımcı fonksiyonları ─────────────────────────────────────────────

export function isOwner(user: UserForRole): boolean {
  return normalizeRole(user.role, user.canAccessAllClinics) === 'OWNER';
}

export function isOrganizationAdmin(user: UserForRole): boolean {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return role === 'OWNER' || role === 'ORG_ADMIN';
}

/**
 * Organization Dashboard'a erişim:
 * - OWNER: evet
 * - ORG_ADMIN: evet
 * - Legacy admin + canAccessAllClinics=true: evet (OWNER'a normalize olur)
 * - Legacy admin + canAccessAllClinics=false: hayır (CLINIC_MANAGER'a normalize olur)
 * - Diğerleri: hayır
 */
export function canAccessOrganizationDashboard(user: UserForRole): boolean {
  return isOrganizationAdmin(user);
}

export function canManageUsers(user: UserForRole): boolean {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

export function canManageClinicSettings(user: UserForRole): boolean {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

/**
 * Hasta silme: yalnızca yönetici/yönetim rolleri
 * RECEPTIONIST ve DENTIST silemez (soft-delete bile olsa)
 */
export function canDeletePatient(user: UserForRole): boolean {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

export function canViewFinancialData(user: UserForRole): boolean {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'BILLING'
  );
}

export function canWriteFinancialData(user: UserForRole): boolean {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'BILLING'
  );
}

export function canManageClinicalData(user: UserForRole): boolean {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'DENTIST'
  );
}

export function canManageAppointments(user: UserForRole): boolean {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'RECEPTIONIST' ||
    role === 'DENTIST'
  );
}

export function canManageInventory(user: UserForRole): boolean {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

export function canAccessReports(user: UserForRole): boolean {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'BILLING'
  );
}

/**
 * Şube yönetimi: Yeni şube oluşturma, şube düzenleme, şube durumu değiştirme.
 * Yalnızca OWNER ve ORG_ADMIN yapabilir.
 * CLINIC_MANAGER yalnızca kendi atandığı şubeleri görüntüleyebilir.
 */
export function canManageBranches(user: UserForRole): boolean {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return role === 'OWNER' || role === 'ORG_ADMIN';
}

/**
 * Kullanıcı-klinik atama: Kullanıcıları şubelere atama / rol güncelleme.
 * OWNER ve ORG_ADMIN: tüm şubelere atama yapabilir.
 * CLINIC_MANAGER: yalnızca kendi atandığı şubelere, OWNER/ORG_ADMIN rolü hariç atama yapabilir.
 */
export function canAssignUserClinics(user: UserForRole): boolean {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

/**
 * Klinik çalışma saatleri yönetimi.
 * OWNER, ORG_ADMIN: tüm şubeler.
 * CLINIC_MANAGER: yalnızca atandığı şubeler.
 */
export function canManageClinicSchedule(user: UserForRole): boolean {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

/**
 * Doktor müsaitlik yönetimi.
 * OWNER, ORG_ADMIN, CLINIC_MANAGER: herhangi bir doktor için.
 * DENTIST: yalnızca kendi programı (doctorId ile kontrol edilir).
 */
export function canManageDoctorSchedule(user: UserForRole & { id?: string }, doctorId?: string): boolean {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  if (role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER') return true;
  if (role === 'DENTIST' && user.id && doctorId && user.id === doctorId) return true;
  return false;
}

/**
 * Müsait slot görüntüleme: kimlik doğrulaması yapılmış tüm kullanıcılar.
 */
export function canViewAvailability(_user: UserForRole): boolean {
  return true;
}
