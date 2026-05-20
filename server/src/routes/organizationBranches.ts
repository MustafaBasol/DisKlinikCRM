/**
 * organizationBranches.ts — Şube Yönetimi + Kullanıcı-Klinik Atama (Sprint 6)
 *
 * Şube Yönetimi:
 *   GET    /api/organization/clinics          — Şubeleri listele
 *   POST   /api/organization/clinics          — Yeni şube oluştur (OWNER/ORG_ADMIN)
 *   GET    /api/organization/clinics/:id      — Şube detayı
 *   PUT    /api/organization/clinics/:id      — Şube güncelle (OWNER/ORG_ADMIN)
 *   PATCH  /api/organization/clinics/:id/status — Durum değiştir (OWNER/ORG_ADMIN)
 *
 * Kullanıcı-Klinik Atama:
 *   GET    /api/organization/users/:userId/clinics — Kullanıcının klinik atamalarını getir
 *   PUT    /api/organization/users/:userId/clinics — Klinik atamalarını güncelle
 *
 * Güvenlik kuralları:
 *   1. Tüm sorgular req.user.organizationId ile scope edilir.
 *   2. Hedef klinik organizasyona ait olmalıdır (cross-org koruması).
 *   3. Hedef kullanıcı organizasyona ait olmalıdır.
 *   4. CLINIC_MANAGER yalnızca atandığı kliniklere kullanıcı atayabilir.
 *   5. CLINIC_MANAGER OWNER/ORG_ADMIN rolü atayamaz.
 *   6. defaultClinicId atanmış kliniklerden biri olmalıdır.
 */

import express, { Response } from 'express';
import { z } from 'zod';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { normalizeRole, canManageBranches, canAssignUserClinics } from '../utils/roles.js';
import { logActivity } from '../utils/activity.js';

const router = express.Router();

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const slugPattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

const branchCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .max(60)
    .regex(slugPattern, 'Slug must be lowercase letters, numbers and hyphens only'),
  address: z.string().max(255).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  email: z.string().email('Invalid email').optional().nullable().or(z.literal('')),
  status: z.enum(['trial', 'active', 'inactive', 'suspended']).default('active'),
});

const branchUpdateSchema = branchCreateSchema.partial().omit({ slug: true }).extend({
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(slugPattern, 'Slug must be lowercase letters, numbers and hyphens only')
    .optional(),
});

const branchStatusSchema = z.object({
  status: z.enum(['active', 'inactive', 'suspended']),
});

const VALID_CLINIC_ROLES = [
  'OWNER',
  'ORG_ADMIN',
  'CLINIC_MANAGER',
  'DENTIST',
  'RECEPTIONIST',
  'BILLING',
  'ASSISTANT',
] as const;

type ClinicRole = (typeof VALID_CLINIC_ROLES)[number];

/** Roles that CLINIC_MANAGER is not allowed to assign */
const ORG_LEVEL_ROLES: ClinicRole[] = ['OWNER', 'ORG_ADMIN'];

const userClinicAssignmentSchema = z.object({
  assignments: z
    .array(
      z.object({
        clinicId: z.string().uuid('Invalid clinic ID'),
        role: z.enum(VALID_CLINIC_ROLES),
      })
    )
    .min(0),
  defaultClinicId: z.string().uuid('Invalid clinic ID').optional().nullable(),
});

// ─── Helper: verify a list of clinicIds belong to the org ────────────────────

async function verifyClinicsBelongToOrg(
  clinicIds: string[],
  organizationId: string
): Promise<boolean> {
  if (clinicIds.length === 0) return true;
  const found = await prisma.clinic.findMany({
    where: { id: { in: clinicIds }, organizationId },
    select: { id: true },
  });
  return found.length === clinicIds.length;
}

// ─── GET /api/organization/clinics ───────────────────────────────────────────

router.get(
  '/organization/clinics',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    const { organizationId, canAccessAllClinics, allowedClinicIds } = req.user!;

    try {
      const where: any = { organizationId };

      // CLINIC_MANAGER yalnızca atandığı şubeleri görür
      if (!canAccessAllClinics) {
        where.id = { in: allowedClinicIds };
      }

      const clinics = await prisma.clinic.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          address: true,
          phone: true,
          email: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              userClinics: { where: { isActive: true } },
              appointments: {
                where: {
                  startTime: {
                    gte: new Date(new Date().setHours(0, 0, 0, 0)),
                    lte: new Date(new Date().setHours(23, 59, 59, 999)),
                  },
                },
              },
            },
          },
        },
        orderBy: { name: 'asc' },
      });

      res.json(clinics);
    } catch {
      res.status(500).json({ error: 'Failed to fetch clinic branches' });
    }
  }
);

// ─── POST /api/organization/clinics ──────────────────────────────────────────

router.post(
  '/organization/clinics',
  authorize(['OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    if (!canManageBranches(req.user!)) {
      return res.status(403).json({ error: 'Only OWNER or ORG_ADMIN can create clinic branches' });
    }

    const parsed = branchCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.format() });
    }

    const { name, slug, address, phone, email, status } = parsed.data;
    const orgId = req.user!.organizationId;

    try {
      // Slug organizasyon içinde benzersiz olmalı (@@unique([organizationId, slug]))
      const existing = await prisma.clinic.findFirst({
        where: { organizationId: orgId, slug },
        select: { id: true },
      });
      if (existing) {
        return res.status(409).json({ error: 'A branch with this slug already exists in your organization' });
      }

      const clinic = await prisma.clinic.create({
        data: {
          organizationId: orgId,
          name,
          slug,
          address: address ?? null,
          phone: phone ?? null,
          email: email || null,
          status,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          address: true,
          phone: true,
          email: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await logActivity({
        clinicId: clinic.id,
        userId: req.user!.id,
        entityType: 'clinic',
        entityId: clinic.id,
        action: 'created',
        description: `Yeni şube oluşturuldu: ${clinic.name}`,
      });

      res.status(201).json(clinic);
    } catch {
      res.status(500).json({ error: 'Failed to create clinic branch' });
    }
  }
);

// ─── GET /api/organization/clinics/:id ───────────────────────────────────────

router.get(
  '/organization/clinics/:id',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    const { organizationId, canAccessAllClinics, allowedClinicIds } = req.user!;

    // CLINIC_MANAGER yalnızca atandığı şubeleri görebilir
    if (!canAccessAllClinics && !allowedClinicIds.includes(id)) {
      return res.status(403).json({ error: 'Access denied to this clinic branch' });
    }

    try {
      const clinic = await prisma.clinic.findFirst({
        where: { id, organizationId },
        select: {
          id: true,
          name: true,
          slug: true,
          address: true,
          phone: true,
          email: true,
          status: true,
          timezone: true,
          currency: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              userClinics: { where: { isActive: true } },
              patients: true,
              appointments: true,
            },
          },
        },
      });

      if (!clinic) {
        return res.status(404).json({ error: 'Clinic branch not found' });
      }

      res.json(clinic);
    } catch {
      res.status(500).json({ error: 'Failed to fetch clinic branch' });
    }
  }
);

// ─── PUT /api/organization/clinics/:id ───────────────────────────────────────

router.put(
  '/organization/clinics/:id',
  authorize(['OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    if (!canManageBranches(req.user!)) {
      return res.status(403).json({ error: 'Only OWNER or ORG_ADMIN can update clinic branches' });
    }

    const id = req.params.id as string;
    const orgId = req.user!.organizationId as string;

    const parsed = branchUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.format() });
    }

    try {
      // Klinik bu organizasyona ait mi?
      const existing = await prisma.clinic.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true, slug: true },
      });
      if (!existing) {
        return res.status(404).json({ error: 'Clinic branch not found or access denied' });
      }

      // Slug değişiyorsa benzersizlik kontrolü
      if (parsed.data.slug && parsed.data.slug !== existing.slug) {
        const slugConflict = await prisma.clinic.findFirst({
          where: { organizationId: orgId, slug: parsed.data.slug, id: { not: id } },
          select: { id: true },
        });
        if (slugConflict) {
          return res.status(409).json({ error: 'A branch with this slug already exists in your organization' });
        }
      }

      const updateData: any = {};
      if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
      if (parsed.data.slug !== undefined) updateData.slug = parsed.data.slug;
      if (parsed.data.address !== undefined) updateData.address = parsed.data.address;
      if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone;
      if (parsed.data.email !== undefined) updateData.email = parsed.data.email || null;
      if (parsed.data.status !== undefined) updateData.status = parsed.data.status;

      const clinic = await prisma.clinic.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          name: true,
          slug: true,
          address: true,
          phone: true,
          email: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await logActivity({
        clinicId: clinic.id,
        userId: req.user!.id,
        entityType: 'clinic',
        entityId: clinic.id,
        action: 'updated',
        description: `Şube güncellendi: ${clinic.name}`,
      });

      res.json(clinic);
    } catch {
      res.status(500).json({ error: 'Failed to update clinic branch' });
    }
  }
);

// ─── PATCH /api/organization/clinics/:id/status ───────────────────────────────

router.patch(
  '/organization/clinics/:id/status',
  authorize(['OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    if (!canManageBranches(req.user!)) {
      return res.status(403).json({ error: 'Only OWNER or ORG_ADMIN can change clinic status' });
    }

    const id = req.params.id as string;
    const orgId = req.user!.organizationId as string;

    const parsed = branchStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.format() });
    }

    try {
      const existing = await prisma.clinic.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true, name: true },
      });
      if (!existing) {
        return res.status(404).json({ error: 'Clinic branch not found or access denied' });
      }

      const clinic = await prisma.clinic.update({
        where: { id },
        data: { status: parsed.data.status },
        select: { id: true, name: true, status: true, updatedAt: true },
      });

      await logActivity({
        clinicId: clinic.id,
        userId: req.user!.id,
        entityType: 'clinic',
        entityId: clinic.id,
        action: 'updated',
        description: `Şube durumu değiştirildi: ${clinic.name} → ${clinic.status}`,
      });

      res.json(clinic);
    } catch {
      res.status(500).json({ error: 'Failed to update clinic branch status' });
    }
  }
);

// ─── GET /api/organization/users/:userId/clinics ─────────────────────────────

router.get(
  '/organization/users/:userId/clinics',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    if (!canAssignUserClinics(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions to view user clinic assignments' });
    }

    const userId = req.params.userId as string;
    const { organizationId, canAccessAllClinics, allowedClinicIds } = req.user!;

    try {
      // Hedef kullanıcı bu organizasyona ait mi?
      const targetUser = await prisma.user.findFirst({
        where: { id: userId, organizationId },
        select: { id: true, firstName: true, lastName: true, email: true, role: true, defaultClinicId: true },
      });
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found or access denied' });
      }

      // CLINIC_MANAGER yalnızca kendi atandığı kliniklerdeki kullanıcıları görebilir
      const baseWhere: any = { userId, isActive: true };
      if (!canAccessAllClinics) {
        baseWhere.clinicId = { in: allowedClinicIds };
      }

      const userClinics = await prisma.userClinic.findMany({
        where: baseWhere,
        include: {
          clinic: {
            select: { id: true, name: true, slug: true, status: true },
          },
        },
        orderBy: { clinic: { name: 'asc' } },
      });

      res.json({
        user: targetUser,
        defaultClinicId: targetUser.defaultClinicId,
        clinics: userClinics.map(uc => ({
          id: uc.id,
          clinicId: uc.clinicId,
          clinic: uc.clinic,
          role: uc.role,
          isActive: uc.isActive,
          createdAt: uc.createdAt,
        })),
      });
    } catch {
      res.status(500).json({ error: 'Failed to fetch user clinic assignments' });
    }
  }
);

// ─── PUT /api/organization/users/:userId/clinics ──────────────────────────────

router.put(
  '/organization/users/:userId/clinics',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    if (!canAssignUserClinics(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions to assign clinic access' });
    }

    const userId = req.params.userId as string;
    const { organizationId, canAccessAllClinics, allowedClinicIds, role, canAccessAllClinics: actorCanAll } = req.user!;
    const actorNormalizedRole = normalizeRole(role, actorCanAll);

    const parsed = userClinicAssignmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.format() });
    }

    const { assignments, defaultClinicId } = parsed.data;

    try {
      // Hedef kullanıcı bu organizasyona ait mi?
      const targetUser = await prisma.user.findFirst({
        where: { id: userId, organizationId },
        select: { id: true, firstName: true, lastName: true, email: true, canAccessAllClinics: true },
      });
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found or access denied' });
      }

      // Atama listesindeki tüm klinik ID'leri bu organizasyona ait mi?
      const clinicIds = assignments.map(a => a.clinicId);
      if (clinicIds.length > 0) {
        const allBelong = await verifyClinicsBelongToOrg(clinicIds, organizationId);
        if (!allBelong) {
          return res.status(403).json({ error: 'One or more clinics do not belong to your organization' });
        }
      }

      // CLINIC_MANAGER kısıtlamaları
      if (actorNormalizedRole === 'CLINIC_MANAGER') {
        // OWNER/ORG_ADMIN rolü atayamaz
        for (const a of assignments) {
          if (ORG_LEVEL_ROLES.includes(a.role as ClinicRole)) {
            return res.status(403).json({
              error: `CLINIC_MANAGER cannot assign ${a.role} role`,
            });
          }
        }
        // Yalnızca kendi atandığı kliniklere atama yapabilir
        for (const clinicId of clinicIds) {
          if (!allowedClinicIds.includes(clinicId)) {
            return res.status(403).json({
              error: 'CLINIC_MANAGER can only assign users to clinics they manage',
            });
          }
        }
      }

      // defaultClinicId atanmış kliniklerden biri olmalı
      if (defaultClinicId && clinicIds.length > 0 && !clinicIds.includes(defaultClinicId)) {
        return res.status(400).json({ error: 'defaultClinicId must be one of the assigned clinics' });
      }

      // Ayrıca defaultClinicId'nin organizasyona ait olduğunu doğrula
      if (defaultClinicId) {
        const defaultClinicBelongs = await verifyClinicsBelongToOrg([defaultClinicId], organizationId);
        if (!defaultClinicBelongs) {
          return res.status(403).json({ error: 'defaultClinicId does not belong to your organization' });
        }
      }

      // Transaction: Mevcut UserClinic kayıtlarını güncelle, yenilerini oluştur
      await prisma.$transaction(async (tx) => {
        // CLINIC_MANAGER ise yalnızca kendi yönettiği kliniklerdeki kayıtları etkile
        // OWNER/ORG_ADMIN ise kullanıcının tüm klinik atamalarını güncelle

        if (!canAccessAllClinics) {
          // CLINIC_MANAGER: Yalnızca allowedClinicIds kapsamındaki mevcut atamaları deaktive et
          await tx.userClinic.updateMany({
            where: { userId, clinicId: { in: allowedClinicIds } },
            data: { isActive: false },
          });
        } else {
          // OWNER/ORG_ADMIN: Kullanıcının tüm klinik atamalarını deaktive et
          await tx.userClinic.updateMany({
            where: { userId },
            data: { isActive: false },
          });
        }

        // Yeni atamaları oluştur / mevcut olanları aktif et
        for (const assignment of assignments) {
          await tx.userClinic.upsert({
            where: { userId_clinicId: { userId, clinicId: assignment.clinicId } },
            create: {
              userId,
              clinicId: assignment.clinicId,
              role: assignment.role,
              isActive: true,
            },
            update: {
              role: assignment.role,
              isActive: true,
            },
          });
        }

        // defaultClinicId güncelle
        if (defaultClinicId !== undefined) {
          await tx.user.update({
            where: { id: userId },
            data: { defaultClinicId: defaultClinicId || null },
          });
        }
      });

      // Güncel atama listesini döndür
      const updatedAssignments = await prisma.userClinic.findMany({
        where: { userId, isActive: true },
        include: {
          clinic: { select: { id: true, name: true, slug: true, status: true } },
        },
        orderBy: { clinic: { name: 'asc' } },
      });

      await logActivity({
        clinicId: req.user!.clinicId,
        userId: req.user!.id,
        entityType: 'user',
        entityId: userId,
        action: 'updated',
        description: `Kullanıcı klinik atamaları güncellendi: ${targetUser.email}`,
      });

      res.json({
        userId,
        assignments: updatedAssignments.map(uc => ({
          id: uc.id,
          clinicId: uc.clinicId,
          clinic: uc.clinic,
          role: uc.role,
          isActive: uc.isActive,
        })),
      });
    } catch {
      res.status(500).json({ error: 'Failed to update user clinic assignments' });
    }
  }
);

export default router;
