import express from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { authenticate, generateToken, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { checkLoginAttempt, recordLoginAttempt, resetLoginAttempts } from '../utils/helpers.js';
import {
  normalizeRole,
  canAccessOrganizationDashboard,
  canDeletePatient,
  canManageUsers,
  canAccessReports,
  canWriteFinancialData,
  canManageInventory,
  canManageBranches,
  canAssignUserClinics,
} from '../utils/roles.js';

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (!checkLoginAttempt(email)) {
      return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
    }

    const user = await prisma.user.findFirst({
      where: { email },
      include: {
        clinic: true,
        userClinics: {
          where: { isActive: true },
          select: { clinicId: true, role: true },
        },
      },
    });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      recordLoginAttempt(email);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.isActive) {
      recordLoginAttempt(email);
      return res.status(403).json({ error: 'User account is inactive' });
    }

    resetLoginAttempts(email);

    // Gerçek klinik erişim listesini UserClinic tablosundan al
    const allowedClinicIds = user.userClinics.map(uc => uc.clinicId);
    const canAccessAllClinics = user.canAccessAllClinics;

    const token = generateToken({
      id: user.id,
      clinicId: user.defaultClinicId ?? allowedClinicIds[0] ?? user.clinicId,
      organizationId: user.organizationId,
      allowedClinicIds,
      canAccessAllClinics,
      role: user.role,
    });

    await logActivity({
      clinicId: user.clinicId,
      userId: user.id,
      entityType: 'user',
      entityId: user.id,
      action: 'login',
      description: `${user.email} sisteme giriş yaptı`,
    });

    res.json({
      token,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
        canAccessAllClinics: user.canAccessAllClinics,
        allowedClinicIds,
        clinic: {
          id: user.clinic.id,
          name: user.clinic.name,
          currency: user.clinic.currency,
          timezone: user.clinic.timezone,
        },
      },
    });
  } catch {
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate as express.RequestHandler, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        clinic: true,
        organization: { select: { id: true, name: true, slug: true, status: true } },
        userClinics: {
          where: { isActive: true },
          include: {
            clinic: {
              select: { id: true, name: true, slug: true, status: true, timezone: true, currency: true },
            },
          },
        },
      },
    });
    if (!user) return res.status(401).json({ error: 'User not found' });

    const allowedClinicIds = user.userClinics.map(uc => uc.clinicId);

    const roleObj = { role: user.role, canAccessAllClinics: user.canAccessAllClinics };

    res.json({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      normalizedRole: normalizeRole(user.role, user.canAccessAllClinics),
      organizationId: user.organizationId,
      canAccessAllClinics: user.canAccessAllClinics,
      allowedClinicIds,
      organization: user.organization,
      clinics: user.userClinics.map(uc => ({
        ...uc.clinic,
        memberRole: uc.role,
      })),
      // Geriye dönük uyumluluk
      clinic: {
        id: user.clinic.id,
        name: user.clinic.name,
        currency: user.clinic.currency,
        timezone: user.clinic.timezone,
      },
      defaultClinicId: user.defaultClinicId ?? null,
      // Backend tarafından hesaplanmış izin bayrakları (frontend UX için)
      permissions: {
        canViewOrganizationDashboard: canAccessOrganizationDashboard(roleObj),
        canDeletePatient: canDeletePatient(roleObj),
        canManageUsers: canManageUsers(roleObj),
        canViewReports: canAccessReports(roleObj),
        canManagePayments: canWriteFinancialData(roleObj),
        canManageInventory: canManageInventory(roleObj),
        canManageBranches: canManageBranches(roleObj),
        canAssignUserClinics: canAssignUserClinics(roleObj),
      },
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default router;
