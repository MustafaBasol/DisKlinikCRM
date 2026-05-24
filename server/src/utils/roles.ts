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
      // Legacy admin: canAccessAllClinics varsa OWNER, yoksa CLINIC_MANAGER.
      // canAccessAllClinics=true → organizasyon sahibi gibi davranır (OWNER).
      // canAccessAllClinics=false → şube yöneticisi olarak davranır (CLINIC_MANAGER).
      // ORG_ADMIN rolünü almak için kullanıcının role=ORG_ADMIN olarak güncellenmesi gerekir.
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

// ── WhatsApp Bağlantısı Yetkileri ─────────────────────────────────────────────

/**
 * Organizasyon düzeyinde WhatsApp bağlantısı yönetme (oluştur / düzenle / sil).
 * Yalnızca OWNER ve ORG_ADMIN.
 */
export function canManageWhatsAppConnections(user: UserForRole): boolean {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return role === 'OWNER' || role === 'ORG_ADMIN';
}

/**
 * Şubeye WhatsApp bağlantısı atama.
 * OWNER, ORG_ADMIN: tüm şubeler. CLINIC_MANAGER: yalnızca kendi şubesi.
 */
export function canAssignWhatsAppToClinic(user: UserForRole): boolean {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

/**
 * WhatsApp bağlantı durumunu görüntüleme.
 * OWNER, ORG_ADMIN, CLINIC_MANAGER görüntüleyebilir.
 */
export function canViewWhatsAppStatus(user: UserForRole): boolean {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

/**
 * WhatsApp mesajı gönderme.
 * Mesaj gönderme yetkisi olan tüm roller.
 */
export function canSendWhatsAppMessages(user: UserForRole): boolean {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'RECEPTIONIST' ||
    role === 'DENTIST'
  );
}

// ── WhatsApp Inbox İzinleri ────────────────────────────────────────────────────

/**
 * Org düzeyindeki atanmamış WhatsApp gelen kutusunu görüntüleme.
 * OWNER ve ORG_ADMIN her şeyi görebilir.
 * CLINIC_MANAGER ve RECEPTIONIST yalnızca kendi şubelerine atanmış konuşmaları görebilir.
 */
export function canViewWhatsAppInbox(user: UserForRole | null | undefined): boolean {
  if (!user) return false;
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'RECEPTIONIST'
  );
}

/**
 * Atanmamış WhatsApp konuşmasını bir kliniğe çözümleme.
 * OWNER ve ORG_ADMIN tüm kliniklere çözümleyebilir.
 * CLINIC_MANAGER yalnızca kendi kliniklerine çözümleyebilir.
 */
export function canResolveWhatsAppConversation(user: UserForRole | null | undefined): boolean {
  if (!user) return false;
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

/**
 * WhatsApp konuşmasına mevcut bir hastayı bağlama.
 * OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST yapabilir.
 */
export function canLinkWhatsAppPatient(user: UserForRole | null | undefined): boolean {
  if (!user) return false;
  const role = normalizeRole(user.role, user.canAccessAllClinics);
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
export function canViewFinanceDashboard(user: UserForRole | null | undefined): boolean {
  if (!user) return false;
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'BILLING'
  );
}

// ── Sprint 13: Operational Monitoring İzinleri ────────────────────────────────

/**
 * Denetim günlüklerini ve operasyonel olayları görüntüleme.
 * OWNER / ORG_ADMIN: organizasyon genelinde.
 * CLINIC_MANAGER: yalnızca atandığı şubeler.
 * DENTIST / RECEPTIONIST / BILLING / ASSISTANT: erişim yok.
 */
export function canViewOperations(user: UserForRole | null | undefined): boolean {
  if (!user) return false;
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

/**
 * Operasyonel olayı çözüldü olarak işaretleme.
 * OWNER / ORG_ADMIN: tüm olaylar.
 * CLINIC_MANAGER: yalnızca kendi şubesindeki olaylar (rota içinde kontrol edilir).
 */
export function canResolveOperationalEvents(user: UserForRole | null | undefined): boolean {
  if (!user) return false;
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

// ── Sprint 18: No-show Tracking İzinleri ─────────────────────────────────────

/**
 * No-show panosunu görüntüleme.
 * OWNER, ORG_ADMIN: organizasyon genelinde.
 * CLINIC_MANAGER, RECEPTIONIST: yalnızca atandığı şubeler.
 * DENTIST: yalnızca kendi randevuları (rota içinde kontrol edilir).
 * BILLING, ASSISTANT: erişim yok.
 */
export function canViewNoShowDashboard(user: UserForRole | null | undefined): boolean {
  if (!user) return false;
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'RECEPTIONIST' ||
    role === 'DENTIST'
  );
}

/**
 * No-show olarak işaretleme ve recovery durumu güncelleme.
 * DENTIST yalnızca kendi randevularını işaretleyebilir (rota içinde kontrol edilir).
 * BILLING ve ASSISTANT yapamaz.
 */
export function canManageNoShows(user: UserForRole | null | undefined): boolean {
  if (!user) return false;
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'RECEPTIONIST' ||
    role === 'DENTIST'
  );
}

/**
 * No-show recovery WhatsApp mesajı gönderme.
 * BILLING ve ASSISTANT yapamaz.
 */
export function canSendNoShowRecoveryMessage(user: UserForRole | null | undefined): boolean {
  if (!user) return false;
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'RECEPTIONIST'
  );
}

/**
 * No-show takip görevi oluşturma.
 * BILLING ve ASSISTANT yapamaz.
 */
export function canCreateNoShowFollowUpTask(user: UserForRole | null | undefined): boolean {
  if (!user) return false;
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'RECEPTIONIST' ||
    role === 'DENTIST'
  );
}

// ── Sprint 23: Instagram DM Integration İzinleri ──────────────────────────────

/**
 * Instagram bağlantısı oluşturma / düzenleme / silme.
 * Yalnızca OWNER ve ORG_ADMIN.
 */
export function canManageInstagramConnections(user: UserForRole | null | undefined): boolean {
  if (!user) return false;
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return role === 'OWNER' || role === 'ORG_ADMIN';
}

/**
 * Şubeye Instagram bağlantısı atama.
 * OWNER, ORG_ADMIN: tüm şubeler. CLINIC_MANAGER: yalnızca kendi şubesi.
 */
export function canAssignInstagramToClinic(user: UserForRole | null | undefined): boolean {
  if (!user) return false;
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

/**
 * Instagram bağlantı durumunu görüntüleme.
 * OWNER, ORG_ADMIN, CLINIC_MANAGER görüntüleyebilir.
 */
export function canViewInstagramStatus(user: UserForRole | null | undefined): boolean {
  if (!user) return false;
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}

/**
 * Instagram gelen kutusunu görüntüleme.
 * OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST.
 */
export function canViewInstagramInbox(user: UserForRole | null | undefined): boolean {
  if (!user) return false;
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'RECEPTIONIST'
  );
}

/**
 * Instagram DM'ye yanıt gönderme.
 * OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST.
 */
export function canReplyInstagramMessages(user: UserForRole | null | undefined): boolean {
  if (!user) return false;
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return (
    role === 'OWNER' ||
    role === 'ORG_ADMIN' ||
    role === 'CLINIC_MANAGER' ||
    role === 'RECEPTIONIST'
  );
}

/**
 * Instagram konuşmasını bir kliniğe veya hastaya çözümleme.
 * OWNER ve ORG_ADMIN tüm kliniklere çözümleyebilir.
 * CLINIC_MANAGER yalnızca kendi kliniklerine.
 */
export function canResolveInstagramConversation(user: UserForRole | null | undefined): boolean {
  if (!user) return false;
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  return role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';
}


