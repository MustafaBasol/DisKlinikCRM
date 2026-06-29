import crypto from 'crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { authenticate, generateToken, AuthRequest } from '../middleware/auth.js';
import { csrfProtection } from '../middleware/csrf.js';
import { logActivity } from '../utils/activity.js';
import {
  checkLoginAttempt, recordLoginAttempt, resetLoginAttempts, validatePassword,
  checkForgotPasswordAttempt, recordForgotPasswordAttempt,
} from '../utils/helpers.js';
import { clearAuthCookies, createCsrfToken, createSessionId, issueSessionCookies, setCsrfCookie } from '../utils/sessionCookies.js';
import { sendMail } from '../services/emailService.js';
import { buildPasswordResetEmail } from '../services/emailTemplates.js';
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
  canManageWhatsAppConnections,
  canViewWhatsAppStatus,
  canAssignWhatsAppToClinic,
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
          include: {
            clinic: { select: { id: true, name: true, slug: true, status: true, timezone: true, currency: true } },
          },
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

    // canAccessAllClinics=true kullanıcılar (OWNER/ORG_ADMIN) tüm org kliniklerini görmeli
    let clinicsPayload: { id: string; name: string; slug: string | null; status: string; timezone: string | null; currency: string | null; memberRole: string }[];
    if (canAccessAllClinics && user.organizationId) {
      const orgClinics = await prisma.clinic.findMany({
        where: { organizationId: user.organizationId, status: { not: 'cancelled' } },
        select: { id: true, name: true, slug: true, status: true, timezone: true, currency: true },
        orderBy: { createdAt: 'asc' },
      });
      clinicsPayload = orgClinics.map(c => ({ ...c, memberRole: user.role.toUpperCase() }));
    } else {
      clinicsPayload = user.userClinics.map(uc => ({ ...uc.clinic, memberRole: uc.role }));
    }

    const sessionId = createSessionId();
    const token = generateToken({
      id: user.id,
      clinicId: user.defaultClinicId ?? allowedClinicIds[0] ?? user.clinicId,
      organizationId: user.organizationId,
      allowedClinicIds,
      canAccessAllClinics,
      role: user.role,
      sessionId,
    });
    const csrfToken = issueSessionCookies(res, 'clinic', token, sessionId);

    await logActivity({
      clinicId: user.clinicId,
      userId: user.id,
      entityType: 'user',
      entityId: user.id,
      action: 'login',
      description: `${user.email} sisteme giriş yaptı`,
    });

    res.json({
      csrfToken,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
        canAccessAllClinics: user.canAccessAllClinics,
        allowedClinicIds,
        clinics: clinicsPayload,
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

// GET /api/auth/csrf
router.get('/csrf', authenticate as express.RequestHandler, (req: AuthRequest, res) => {
  const sessionId = req.user?.sessionId;
  if (!sessionId) {
    return res.status(401).json({ error: 'Unauthorized: Invalid session' });
  }

  const csrfToken = createCsrfToken('clinic', sessionId);
  setCsrfCookie(res, 'clinic', csrfToken);
  res.json({ csrfToken });
});

// POST /api/auth/logout
router.post(
  '/logout',
  authenticate as express.RequestHandler,
  csrfProtection('clinic'),
  (_req: AuthRequest, res) => {
    clearAuthCookies(res, 'clinic');
    res.json({ success: true });
  },
);

// POST /api/auth/change-password
router.post(
  '/change-password',
  authenticate as express.RequestHandler,
  csrfProtection('clinic'),
  async (req: AuthRequest, res) => {
    const { currentPassword, newPassword } = req.body ?? {};

    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({
        error: 'Current password and new password are required',
        code: 'PASSWORD_FIELDS_REQUIRED',
      });
    }

    const trimmedCurrentPassword = currentPassword.trim();
    if (!trimmedCurrentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Current password and new password are required',
        code: 'PASSWORD_FIELDS_REQUIRED',
      });
    }

    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        error: 'Password does not meet security requirements',
        code: 'PASSWORD_WEAK',
        details: passwordValidation.errors,
      });
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { id: true, clinicId: true, email: true, passwordHash: true },
      });

      if (!user) {
        return res.status(401).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      }

      const currentPasswordMatches = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!currentPasswordMatches) {
        return res.status(400).json({
          error: 'Current password is incorrect',
          code: 'CURRENT_PASSWORD_INCORRECT',
        });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(newPassword, 12) },
      });

      await logActivity({
        clinicId: user.clinicId,
        userId: user.id,
        entityType: 'user',
        entityId: user.id,
        action: 'password_changed',
        description: `${user.email} kullanici sifresini guncelledi`,
      });

      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Failed to change password', code: 'PASSWORD_CHANGE_FAILED' });
    }
  },
);

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

    // canAccessAllClinics=true kullanıcılar (OWNER/ORG_ADMIN) tüm org kliniklerini görmeli;
    // aksi hâlde yeni oluşturulan şubeler UserClinic kaydı olmadığından header'da çıkmaz.
    let clinicsPayload: { id: string; name: string; slug: string | null; status: string; timezone: string | null; currency: string | null; memberRole: string }[];
    if (user.canAccessAllClinics && user.organizationId) {
      const orgClinics = await prisma.clinic.findMany({
        where: { organizationId: user.organizationId, status: { not: 'cancelled' } },
        select: { id: true, name: true, slug: true, status: true, timezone: true, currency: true },
        orderBy: { createdAt: 'asc' },
      });
      clinicsPayload = orgClinics.map(c => ({ ...c, memberRole: user.role.toUpperCase() }));
    } else {
      clinicsPayload = user.userClinics.map(uc => ({ ...uc.clinic, memberRole: uc.role }));
    }

    const allowedClinicIds = clinicsPayload.map(c => c.id);

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
      clinics: clinicsPayload,
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
        // WhatsApp izinleri
        canManageWhatsAppConnections: canManageWhatsAppConnections(roleObj),
        canViewWhatsAppStatus: canViewWhatsAppStatus(roleObj),
        canAssignWhatsAppToClinic: canAssignWhatsAppToClinic(roleObj),
      },
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

const RESET_TOKEN_EXPIRY_MINUTES = 60;
const GENERIC_RESET_RESPONSE = { message: 'If an account with that email exists, a password reset link has been sent.' };

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body ?? {};

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.json(GENERIC_RESET_RESPONSE);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const ip = String(req.ip ?? req.socket?.remoteAddress ?? 'unknown');
  const emailKey = `email:${normalizedEmail}`;
  const ipKey = `ip:${ip}`;

  if (!checkForgotPasswordAttempt(emailKey) || !checkForgotPasswordAttempt(ipKey)) {
    return res.json(GENERIC_RESET_RESPONSE);
  }

  recordForgotPasswordAttempt(emailKey);
  recordForgotPasswordAttempt(ipKey);

  try {
    const user = await prisma.user.findFirst({
      where: { email: normalizedEmail, isActive: true },
      select: { id: true, firstName: true, email: true, clinicId: true },
    });

    if (!user) {
      return res.json(GENERIC_RESET_RESPONSE);
    }

    // Invalidate all existing unused tokens for this user
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });

    // Generate a cryptographically secure random token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);

    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    const appBaseUrl = (process.env.APP_BASE_URL || 'https://app.noramedi.com').replace(/\/$/, '');
    const resetUrl = `${appBaseUrl}/reset-password?token=${rawToken}`;

    const emailPayload = buildPasswordResetEmail({
      firstName: user.firstName,
      resetUrl,
      expiryMinutes: RESET_TOKEN_EXPIRY_MINUTES,
    });

    const result = await sendMail({ to: user.email, ...emailPayload });
    if (!result.sent) {
      console.warn(`[forgot-password] Email not sent for user ${user.id}: ${result.reason}`);
    }
  } catch (err) {
    console.error('[forgot-password] Error:', (err as Error).message);
  }

  return res.json(GENERIC_RESET_RESPONSE);
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body ?? {};

  if (!token || typeof token !== 'string' || !newPassword || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'Token and new password are required', code: 'RESET_FIELDS_REQUIRED' });
  }

  const passwordValidation = validatePassword(newPassword);
  if (!passwordValidation.valid) {
    return res.status(400).json({
      error: 'Password does not meet security requirements',
      code: 'PASSWORD_WEAK',
      details: passwordValidation.errors,
    });
  }

  const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');

  try {
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, clinicId: true, email: true, isActive: true } } },
    });

    if (!resetToken) {
      return res.status(400).json({ error: 'Invalid or expired reset token', code: 'RESET_TOKEN_INVALID' });
    }

    if (resetToken.usedAt) {
      return res.status(400).json({ error: 'Reset token has already been used', code: 'RESET_TOKEN_USED' });
    }

    if (resetToken.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Reset token has expired', code: 'RESET_TOKEN_EXPIRED' });
    }

    if (!resetToken.user.isActive) {
      return res.status(400).json({ error: 'Invalid or expired reset token', code: 'RESET_TOKEN_INVALID' });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash: newPasswordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    try {
      await logActivity({
        clinicId: resetToken.user.clinicId,
        userId: resetToken.userId,
        entityType: 'user',
        entityId: resetToken.userId,
        action: 'password_reset',
        description: `${resetToken.user.email} şifresini e-posta doğrulamasıyla sıfırladı`,
      });
    } catch {
      // activity log failure must not block the response
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('[reset-password] Error:', (err as Error).message);
    return res.status(500).json({ error: 'Failed to reset password', code: 'RESET_FAILED' });
  }
});

export default router;
