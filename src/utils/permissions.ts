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
  canManageBranches?: boolean;
  canAssignUserClinics?: boolean;
  // WhatsApp izinleri
  canManageWhatsAppConnections?: boolean;
  canViewWhatsAppStatus?: boolean;
  canAssignWhatsAppToClinic?: boolean;
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
      // Admin her zaman organizasyon seviyesinde bir yöneticidir;
      // canAccessAllClinics yalnızca OWNER vs ORG_ADMIN ayrımını belirler.
      return canAccessAllClinics ? 'OWNER' : 'ORG_ADMIN';
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

/**
 * Şube yönetimi (oluştur / düzenle / durum değiştir):
 * Yalnızca OWNER ve ORG_ADMIN.
 */
export function canManageBranches(user: UserForPermission | null | undefined): boolean {
  if (user?.permissions?.canManageBranches !== undefined) {
    return user.permissions.canManageBranches;
  }
  const role = getRole(user);
  return role === 'OWNER' || role === 'ORG_ADMIN';
}

/**
 * Şube görüntüleme (listeleme / detay):
 * OWNER, ORG_ADMIN ve CLINIC_MANAGER (yalnızca atandıkları şubeler).
 */
export function canViewBranches(user: UserForPermission | null | undefined): boolean {
  if (user?.permissions?.canManageBranches !== undefined) {
    return user.permissions.canManageBranches;
  }
  const role = getRole(user);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

/**
 * Kullanıcı-klinik atama:
 * OWNER ve ORG_ADMIN: tüm şubelere.
 * CLINIC_MANAGER: kendi yönettiği şubelere, org-level roller hariç.
 */
export function canAssignUserClinics(user: UserForPermission | null | undefined): boolean {
  if (user?.permissions?.canAssignUserClinics !== undefined) {
    return user.permissions.canAssignUserClinics;
  }
  const role = getRole(user);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

/**
 * Klinik çalışma saatleri yönetimi:
 * OWNER, ORG_ADMIN, CLINIC_MANAGER.
 */
export function canManageClinicSchedule(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

/**
 * Doktor müsaitlik yönetimi:
 * Yönetim rolleri tüm doktorlar için; DENTIST yalnızca kendi programı.
 * doctorId sağlanmazsa yönetim rolü kontrolü yapılır.
 */
export function canManageDoctorSchedule(
  user: UserForPermission | null | undefined,
  userId?: string,
  doctorId?: string,
): boolean {
  const role = getRole(user);
  if (role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER') return true;
  if (role === 'DENTIST' && userId && doctorId && userId === doctorId) return true;
  return false;
}

// ─── WhatsApp Bağlantısı İzinleri ─────────────────────────────────────────────

/**
 * Organizasyon düzeyinde WhatsApp bağlantısı yönetme.
 * Yalnızca OWNER ve ORG_ADMIN.
 */
export function canManageWhatsAppConnections(user: UserForPermission | null | undefined): boolean {
  if (user?.permissions?.canManageWhatsAppConnections !== undefined) {
    return user.permissions.canManageWhatsAppConnections;
  }
  const role = getRole(user);
  return role === 'OWNER' || role === 'ORG_ADMIN';
}

/**
 * Şubeye WhatsApp bağlantısı atama.
 */
export function canAssignWhatsAppToClinic(user: UserForPermission | null | undefined): boolean {
  if (user?.permissions?.canAssignWhatsAppToClinic !== undefined) {
    return user.permissions.canAssignWhatsAppToClinic;
  }
  const role = getRole(user);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

/**
 * WhatsApp bağlantı durumunu görüntüleme.
 */
export function canViewWhatsAppStatus(user: UserForPermission | null | undefined): boolean {
  if (user?.permissions?.canViewWhatsAppStatus !== undefined) {
    return user.permissions.canViewWhatsAppStatus;
  }
  const role = getRole(user);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

/**
 * WhatsApp mesajı gönderme.
 */
export function canSendWhatsAppMessages(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'RECEPTIONIST' ||
    role === 'DENTIST'
  );
}

// ─── WhatsApp Inbox İzinleri ──────────────────────────────────────────────────

/**
 * Org düzeyindeki atanmamış WhatsApp gelen kutusunu görüntüleme.
 */
export function canViewWhatsAppInbox(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'RECEPTIONIST'
  );
}

/**
 * Atanmamış WhatsApp konuşmasını bir kliniğe çözümleme.
 */
export function canResolveWhatsAppConversation(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

/**
 * WhatsApp konuşmasına mevcut bir hastayı bağlama.
 */
export function canLinkWhatsAppPatient(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'RECEPTIONIST'
  );
}

/**
 * Finans / Fatura Panosu erişimi.
 * OWNER, ORG_ADMIN, CLINIC_MANAGER, BILLING.
 * DENTIST, RECEPTIONIST, ASSISTANT erişemez.
 */
export function canViewFinanceDashboard(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'BILLING'
  );
}

// ── Sprint 13: Operational Monitoring ─────────────────────────────────────────

/**
 * Operasyonel izleme sayfasına erişim (denetim günlükleri + operasyonel olaylar).
 * OWNER, ORG_ADMIN, CLINIC_MANAGER.
 * DENTIST, RECEPTIONIST, BILLING, ASSISTANT erişemez.
 */
export function canViewOperations(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

/**
 * Operasyonel olayı çözüldü olarak işaretleme.
 * OWNER, ORG_ADMIN, CLINIC_MANAGER.
 */
export function canResolveOperationalEvents(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

// ── Sprint 18: No-show Tracking ───────────────────────────────────────────────

/**
 * No-show panosu görüntüleme.
 * OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST, DENTIST (read-only).
 * BILLING ve ASSISTANT erişemez.
 */
export function canViewNoShowDashboard(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'RECEPTIONIST' ||
    role === 'DENTIST'
  );
}

/**
 * No-show olarak işaretleme ve kurtarma durumu güncelleme.
 * OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST.
 * DENTIST kendi randevularını işaretleyebilir (backend'de ayrıca kontrol edilir).
 */
export function canManageNoShows(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'RECEPTIONIST' ||
    role === 'DENTIST'
  );
}

/**
 * No-show kurtarma WhatsApp mesajı gönderme.
 * OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST.
 */
export function canSendNoShowRecoveryMessage(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'RECEPTIONIST'
  );
}

/**
 * No-show takip görevi oluşturma.
 * OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST.
 */
export function canCreateNoShowFollowUpTask(user: UserForPermission | null | undefined): boolean {
  const role = getRole(user);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'RECEPTIONIST'
  );
}
