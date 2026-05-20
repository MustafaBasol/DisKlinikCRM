/**
 * clinicScope.ts — Merkezi Güvenlik Filtresi (Sprint 4)
 *
 * Kural 1: buildClinicScopeWhere her zaman organizationId içerir — asla sadece clinicId döndürmez.
 * Kural 2: Frontend'den gelen selectedClinicId asla güvenilmez; organizasyon + erişim kontrolü yapılır.
 * Kural 3: canAccessAllClinics = true ise DB'den organizasyon altındaki klinik id'leri alınır.
 * Kural 4: allowedClinicIds = [] + canAccessAllClinics = false → sıfır klinik erişimi.
 */

import { Response } from 'express';
import prisma from '../db.js';
import { AuthRequest } from '../middleware/auth.js';

export type ClinicScopeWhere =
  | { organizationId: string }                               // OWNER/ORG_ADMIN, selectedClinicId=all
  | { organizationId: string; clinicId: string }             // Belirli klinik
  | { organizationId: string; clinicId: { in: string[] } }; // Birden fazla atanmış klinik

/**
 * Kullanıcının erişim haklarına ve seçili kliniğe göre Prisma where filtresi oluşturur.
 * null döndürmesi → erişim yok (403 verilmeli).
 */
export async function buildClinicScopeWhere(
  user: NonNullable<AuthRequest['user']>,
  selectedClinicId: string | undefined
): Promise<ClinicScopeWhere | null> {
  const orgId = user.organizationId;

  if (!selectedClinicId || selectedClinicId === 'all') {
    // Tüm şubeler görünümü
    if (user.canAccessAllClinics) {
      return { organizationId: orgId };
    }
    if (user.allowedClinicIds.length === 0) return null; // Hiçbir klinige ataması yok
    return { organizationId: orgId, clinicId: { in: user.allowedClinicIds } };
  }

  // Belirli klinik seçilmiş:
  // 1. Klinik bu organizasyona ait mi? (DB doğrulaması — cross-org koruması)
  const clinic = await prisma.clinic.findFirst({
    where: { id: selectedClinicId, organizationId: orgId },
    select: { id: true },
  });
  if (!clinic) return null; // Farklı organizasyon kliniği → 403

  // 2. Kullanıcının bu klinige erişimi var mı?
  if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(selectedClinicId)) {
    return null; // Atanmamış klinik → 403
  }

  return { organizationId: orgId, clinicId: selectedClinicId };
}

/**
 * buildClinicScopeWhere'yi çağırır ve hata durumunda 403 gönderir.
 * false döndürmesi → res.json zaten gönderildi, route'ta return yapılmalı.
 */
export async function validateAndGetScope(
  user: NonNullable<AuthRequest['user']>,
  selectedClinicId: string | undefined,
  res: Response
): Promise<ClinicScopeWhere | false> {
  const scope = await buildClinicScopeWhere(user, selectedClinicId);
  if (scope === null) {
    res.status(403).json({ error: 'Access denied to requested clinic' });
    return false;
  }
  return scope;
}

/**
 * Geriye dönük uyumluluk için: clinicId = user.clinicId scope'u.
 * Tek klinikli kullanıcılar için scope oluşturur.
 * allowedClinicIds listesindeki ilk klinik veya defaultClinicId kullanılır.
 */
export function getLegacyScope(user: NonNullable<AuthRequest['user']>): { clinicId: string } {
  return { clinicId: user.clinicId };
}

// ─── organizationId olmayan modeller için (MessageTemplate, PaymentPlan vb.) ───

export type ClinicIdScopeWhere =
  | { clinicId: string }
  | { clinicId: { in: string[] } };

/**
 * organizationId içermeyen modeller için klinik bazlı Prisma where filtresi.
 * null → erişim yok (403 gönderilmeli).
 */
export async function buildClinicIdScope(
  user: NonNullable<AuthRequest['user']>,
  selectedClinicId: string | undefined
): Promise<ClinicIdScopeWhere | null> {
  const orgId = user.organizationId;

  if (selectedClinicId && selectedClinicId !== 'all') {
    // Klinik bu organizasyona ait mi?
    const clinic = await prisma.clinic.findFirst({
      where: { id: selectedClinicId, organizationId: orgId },
      select: { id: true },
    });
    if (!clinic) return null;
    if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(selectedClinicId)) {
      return null;
    }
    return { clinicId: selectedClinicId };
  }

  if (user.canAccessAllClinics) {
    const orgClinics = await prisma.clinic.findMany({
      where: { organizationId: orgId },
      select: { id: true },
    });
    return { clinicId: { in: orgClinics.map(c => c.id) } };
  }

  if (user.allowedClinicIds.length === 0) return null;
  return { clinicId: { in: user.allowedClinicIds } };
}

export async function validateAndGetClinicIdScope(
  user: NonNullable<AuthRequest['user']>,
  selectedClinicId: string | undefined,
  res: Response
): Promise<ClinicIdScopeWhere | false> {
  const scope = await buildClinicIdScope(user, selectedClinicId);
  if (scope === null) {
    res.status(403).json({ error: 'Access denied to requested clinic' });
    return false;
  }
  return scope;
}
