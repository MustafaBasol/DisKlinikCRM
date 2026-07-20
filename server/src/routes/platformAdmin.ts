import express, { Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import {
  authenticatePlatformAdmin,
  generatePlatformToken,
  PlatformAdminRequest,
} from '../middleware/platformAuth.js';
import { csrfProtection } from '../middleware/csrf.js';
import { clearAuthCookies, createCsrfToken, createSessionId, issueSessionCookies, setCsrfCookie } from '../utils/sessionCookies.js';
import { loadDataRetentionConfig } from '../services/privacy/dataRetentionPolicy.js';
import { getPlatformSetting, setPlatformSetting } from '../services/platformSettings.js';
import {
  LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY,
  isLegacyConsentCorrectionRuntimeEnabled,
} from '../services/communicationConsent/legacyConsentCorrection.js';
import { createRateLimiter } from '../utils/helpers.js';
import { encryptSecretTagged, decryptSecretTagged } from '../utils/encryption.js';
import { generateTotpSecret, verifyTotp, buildOtpAuthUri } from '../utils/totp.js';
import { platformSmsProviderSchema, smsRoutingPreviewSchema } from '../schemas/index.js';
import { AVAILABLE_SMS_PROVIDERS } from '../services/sms/smsProviders.js';
import {
  encryptProviderCredentials,
  runPlatformSmsProviderTest,
  sanitizePlatformSmsProvider,
} from '../services/sms/platformSmsProviders.js';
import { resolveSmsRouting, SMS_ROUTING_POLICIES } from '../services/sms/smsRoutingPolicy.js';
import { getSmsEntitlement } from '../services/sms/smsEntitlement.js';
import { evaluateAuthLoginFailureSignal } from '../services/security/securityDetectionRules.js';

const router = express.Router();

// Brute-force protection for the most privileged credential in the system:
// 5 attempts per email and 20 per IP, both over 15 minutes.
const platformLoginEmailLimiter = createRateLimiter(5, 15 * 60 * 1000, 'platform-login-email');
const platformLoginIpLimiter = createRateLimiter(20, 15 * 60 * 1000, 'platform-login-ip');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parsePagination(query: any): { skip: number; take: number; page: number; limit: number } {
  const rawPage = parseInt(String(query.page ?? '1'), 10);
  const rawLimit = parseInt(String(query.limit ?? '25'), 10);
  const page = Math.max(1, isNaN(rawPage) ? 1 : rawPage);
  const limit = Math.min(100, Math.max(1, isNaN(rawLimit) ? 25 : rawLimit));
  return { skip: (page - 1) * limit, take: limit, page, limit };
}

// ─── Auth ────────────────────────────────────────────────────────────────────

// POST /api/platform/auth/login
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const clientIp = req.ip || 'unknown';

  if (!(await platformLoginEmailLimiter.check(normalizedEmail)) || !(await platformLoginIpLimiter.check(clientIp))) {
    return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  }

  try {
    const admin = await prisma.platformAdmin.findUnique({ where: { email } });
    if (!admin || !admin.isActive) {
      await platformLoginEmailLimiter.record(normalizedEmail);
      await platformLoginIpLimiter.record(clientIp);
      evaluateAuthLoginFailureSignal({ accountIdentifier: normalizedEmail, context: 'platform', ip: clientIp, userAgent: req.headers['user-agent'] as string | undefined });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) {
      await platformLoginEmailLimiter.record(normalizedEmail);
      await platformLoginIpLimiter.record(clientIp);
      evaluateAuthLoginFailureSignal({ accountIdentifier: normalizedEmail, context: 'platform', ip: clientIp, userAgent: req.headers['user-agent'] as string | undefined });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // MFA etkinse ikinci faktörü doğrula (şifre doğrulandıktan sonra —
    // MFA_REQUIRED cevabı şifresi geçersiz birine hesap durumu sızdırmaz)
    if (admin.totpEnabledAt) {
      const totpCode = String(req.body.totpCode ?? '').trim();
      if (!totpCode) {
        return res.status(401).json({ error: 'MFA code required', code: 'MFA_REQUIRED' });
      }
      const totpSecret = decryptSecretTagged(admin.totpSecretEncrypted);
      if (!totpSecret || !verifyTotp(totpSecret, totpCode)) {
        await platformLoginEmailLimiter.record(normalizedEmail);
        await platformLoginIpLimiter.record(clientIp);
        evaluateAuthLoginFailureSignal({ accountIdentifier: normalizedEmail, context: 'platform', ip: clientIp, userAgent: req.headers['user-agent'] as string | undefined });
        return res.status(401).json({ error: 'Invalid MFA code', code: 'MFA_INVALID' });
      }
    }

    await platformLoginEmailLimiter.reset(normalizedEmail);

    const sessionId = createSessionId();
    const token = generatePlatformToken({
      id: admin.id,
      email: admin.email,
      sessionId,
      sessionType: 'platform',
    });
    const csrfToken = issueSessionCookies(res, 'platform', token, sessionId);

    res.json({
      csrfToken,
      admin: { id: admin.id, name: admin.name, email: admin.email, createdAt: admin.createdAt },
    });
  } catch {
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/platform/auth/csrf
router.get('/auth/csrf', authenticatePlatformAdmin as express.RequestHandler, (req: PlatformAdminRequest, res) => {
  const sessionId = req.platformAdmin?.sessionId;
  if (!sessionId) {
    return res.status(401).json({ error: 'Unauthorized: Invalid session' });
  }

  const csrfToken = createCsrfToken('platform', sessionId);
  setCsrfCookie(res, 'platform', csrfToken);
  res.json({ csrfToken });
});

// POST /api/platform/auth/logout
router.post(
  '/auth/logout',
  authenticatePlatformAdmin as express.RequestHandler,
  csrfProtection('platform'),
  (_req: PlatformAdminRequest, res) => {
    clearAuthCookies(res, 'platform');
    res.json({ success: true });
  },
);

// All routes below require platform admin auth
router.use(authenticatePlatformAdmin as express.RequestHandler, csrfProtection('platform'));

// GET /api/platform/me
router.get('/me', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const admin = await prisma.platformAdmin.findUnique({
      where: { id: req.platformAdmin!.id },
      select: { id: true, email: true, name: true, isActive: true, createdAt: true, totpEnabledAt: true },
    });
    if (!admin) return res.status(404).json({ error: 'Not found' });
    res.json({ ...admin, mfaEnabled: !!admin.totpEnabledAt, totpEnabledAt: undefined });
  } catch {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ─── MFA (TOTP) ──────────────────────────────────────────────────────────────

// POST /api/platform/auth/mfa/setup — yeni secret üret (henüz etkin değil)
router.post('/auth/mfa/setup', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const admin = await prisma.platformAdmin.findUnique({ where: { id: req.platformAdmin!.id } });
    if (!admin) return res.status(404).json({ error: 'Not found' });
    if (admin.totpEnabledAt) {
      return res.status(400).json({ error: 'MFA is already enabled. Disable it first to re-enroll.' });
    }

    const secret = generateTotpSecret();
    await prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { totpSecretEncrypted: encryptSecretTagged(secret) },
    });

    // Secret yalnızca bu cevapta düz döner (QR/manuel giriş için); DB'de şifreli.
    res.json({ secret, otpauthUri: buildOtpAuthUri(secret, admin.email) });
  } catch {
    res.status(500).json({ error: 'Failed to start MFA setup' });
  }
});

// POST /api/platform/auth/mfa/verify — setup'ı kodla onayla, MFA'yı etkinleştir
router.post('/auth/mfa/verify', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const code = String(req.body?.code ?? '').trim();
    const admin = await prisma.platformAdmin.findUnique({ where: { id: req.platformAdmin!.id } });
    if (!admin) return res.status(404).json({ error: 'Not found' });
    if (admin.totpEnabledAt) return res.status(400).json({ error: 'MFA is already enabled' });

    const secret = decryptSecretTagged(admin.totpSecretEncrypted);
    if (!secret) return res.status(400).json({ error: 'MFA setup not started' });
    if (!verifyTotp(secret, code)) {
      return res.status(400).json({ error: 'Invalid MFA code' });
    }

    await prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { totpEnabledAt: new Date() },
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to verify MFA code' });
  }
});

// POST /api/platform/auth/mfa/disable — şifre + geçerli kod ister
router.post('/auth/mfa/disable', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const code = String(req.body?.code ?? '').trim();
    const password = String(req.body?.password ?? '');
    const admin = await prisma.platformAdmin.findUnique({ where: { id: req.platformAdmin!.id } });
    if (!admin) return res.status(404).json({ error: 'Not found' });
    if (!admin.totpEnabledAt) return res.status(400).json({ error: 'MFA is not enabled' });

    const passwordValid = await bcrypt.compare(password, admin.passwordHash);
    const secret = decryptSecretTagged(admin.totpSecretEncrypted);
    if (!passwordValid || !secret || !verifyTotp(secret, code)) {
      return res.status(401).json({ error: 'Invalid password or MFA code' });
    }

    await prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { totpSecretEncrypted: null, totpEnabledAt: null },
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to disable MFA' });
  }
});

// ─── Dashboard ───────────────────────────────────────────────────────────────

// GET /api/platform/dashboard
router.get('/dashboard', async (_req, res: Response) => {
  try {
    const now = new Date();
    const trialSoonDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // +7 days

    const [
      totalOrgs,
      activeOrgs,
      suspendedOrgs,
      totalClinics,
      totalUsers,
      totalPatients,
      trialEndingSoon,
      recentOrgs,
      orgsByPlan,
      whatsappCount,
    ] = await Promise.all([
      prisma.organization.count(),
      prisma.organization.count({ where: { status: 'active' } }),
      prisma.organization.count({ where: { status: 'suspended' } }),
      prisma.clinic.count(),
      prisma.user.count(),
      prisma.patient.count(),
      prisma.organization.count({
        where: { trialEndsAt: { gte: now, lte: trialSoonDate } },
      }),
      prisma.organization.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true, name: true, slug: true, status: true, createdAt: true,
          plan: { select: { displayName: true } },
          _count: { select: { clinics: true, users: true } },
        },
      }),
      prisma.organization.groupBy({
        by: ['planId'],
        _count: { _all: true },
      }),
      prisma.whatsAppConnection.count({ where: { status: 'connected' } }),
    ]);

    res.json({
      totals: {
        organizations: totalOrgs,
        activeOrganizations: activeOrgs,
        suspendedOrganizations: suspendedOrgs,
        clinics: totalClinics,
        users: totalUsers,
        patients: totalPatients,
        trialEndingSoon,
        whatsappConnections: whatsappCount,
      },
      recentOrganizations: recentOrgs,
      organizationsByPlan: orgsByPlan,
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

// Legacy stats endpoint — kept for backward compat
router.get('/stats', async (_req, res: Response) => {
  try {
    const [clinicCount, userCount, patientCount, appointmentCount] = await Promise.all([
      prisma.clinic.count(),
      prisma.user.count(),
      prisma.patient.count(),
      prisma.appointment.count(),
    ]);

    const clinicsByStatus = await prisma.clinic.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    res.json({
      totals: { clinics: clinicCount, users: userCount, patients: patientCount, appointments: appointmentCount },
      clinicsByStatus: clinicsByStatus.reduce((acc: Record<string, number>, row) => {
        acc[row.status] = row._count._all;
        return acc;
      }, {}),
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ─── Organizations ────────────────────────────────────────────────────────────

// GET /api/platform/organizations
router.get('/organizations', async (req, res: Response) => {
  const { skip, take, page, limit } = parsePagination(req.query);
  const { status, search } = req.query;

  try {
    const where: any = {};
    if (status) where.status = String(status);
    if (search) {
      where.OR = [
        { name: { contains: String(search), mode: 'insensitive' } },
        { slug: { contains: String(search), mode: 'insensitive' } },
      ];
    }

    const [total, organizations] = await Promise.all([
      prisma.organization.count({ where }),
      prisma.organization.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, slug: true, status: true,
          trialEndsAt: true, ownerId: true, createdAt: true, updatedAt: true,
          plan: { select: { name: true, displayName: true } },
          _count: { select: { clinics: true, users: true, patients: true } },
        },
      }),
    ]);

    res.json({ data: organizations, total, page, limit, pages: Math.ceil(total / limit) });
  } catch {
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

// GET /api/platform/organizations/:id
router.get('/organizations/:id', async (req, res: Response) => {
  const { id } = req.params;

  try {
    const org = await prisma.organization.findUnique({
      where: { id },
      include: {
        plan: true,
        clinics: {
          select: {
            id: true, name: true, slug: true, status: true, createdAt: true,
            _count: { select: { users: true, patients: true } },
          },
        },
        _count: { select: { clinics: true, users: true, patients: true } },
      },
    });

    if (!org) return res.status(404).json({ error: 'Organization not found' });

    // Find owner user if ownerId set
    let owner = null;
    if (org.ownerId) {
      owner = await prisma.user.findFirst({
        where: { id: org.ownerId },
        select: { id: true, firstName: true, lastName: true, email: true, role: true },
      });
    }

    res.json({ ...org, owner });
  } catch {
    res.status(500).json({ error: 'Failed to fetch organization' });
  }
});

// PATCH /api/platform/organizations/:id/status
router.patch('/organizations/:id/status', async (req, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  const allowed = ['trial', 'active', 'suspended', 'cancelled'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
  }

  try {
    const org = await prisma.organization.findUnique({ where: { id } });
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const updated = await prisma.organization.update({ where: { id }, data: { status } });
    res.json({ id: updated.id, status: updated.status });
  } catch {
    res.status(500).json({ error: 'Failed to update organization status' });
  }
});

// PATCH /api/platform/organizations/:id/plan
router.patch('/organizations/:id/plan', async (req, res: Response) => {
  const { id } = req.params;
  const { planId } = req.body;

  if (!planId) {
    return res.status(400).json({ error: 'planId required' });
  }

  try {
    const org = await prisma.organization.findUnique({ where: { id } });
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const updated = await prisma.organization.update({ where: { id }, data: { planId } });
    res.json({ id: updated.id, planId: updated.planId });
  } catch {
    res.status(500).json({ error: 'Failed to update organization plan' });
  }
});

// PATCH /api/platform/organizations/:id/trial
router.patch('/organizations/:id/trial', async (req, res: Response) => {
  const { id } = req.params;
  const { trialEndsAt } = req.body;

  if (!trialEndsAt) {
    return res.status(400).json({ error: 'trialEndsAt required (ISO date string)' });
  }

  const date = new Date(trialEndsAt);
  if (isNaN(date.getTime())) {
    return res.status(400).json({ error: 'trialEndsAt must be a valid date' });
  }

  try {
    const org = await prisma.organization.findUnique({ where: { id } });
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const updated = await prisma.organization.update({
      where: { id },
      data: { trialEndsAt: date, status: 'trial' },
    });
    res.json({ id: updated.id, trialEndsAt: updated.trialEndsAt, status: updated.status });
  } catch {
    res.status(500).json({ error: 'Failed to update trial' });
  }
});

// ─── Clinics ─────────────────────────────────────────────────────────────────

// GET /api/platform/clinics
router.get('/clinics', async (req, res: Response) => {
  const { skip, take, page, limit } = parsePagination(req.query);
  const { status, search, organizationId } = req.query;

  try {
    const where: any = {};
    if (status) where.status = String(status);
    if (organizationId) where.organizationId = String(organizationId);
    if (search) {
      where.OR = [
        { name: { contains: String(search), mode: 'insensitive' } },
        { slug: { contains: String(search), mode: 'insensitive' } },
        { email: { contains: String(search), mode: 'insensitive' } },
      ];
    }

    const [total, clinics] = await Promise.all([
      prisma.clinic.count({ where }),
      prisma.clinic.findMany({
        where,
        skip,
        take,
        select: {
          id: true, name: true, slug: true, status: true,
          email: true, phone: true, address: true,
          currency: true, timezone: true, trialEndsAt: true,
          maxUsers: true, maxPatients: true, createdAt: true,
          organization: { select: { id: true, name: true, slug: true } },
          plan: { select: { name: true, displayName: true, features: true } },
          smsSettings: {
            select: {
              addonEnabled: true, monthlyQuota: true,
              turkeyAllowed: true, europeAllowed: true, routingPolicy: true,
            },
          },
          _count: { select: { users: true, patients: true, appointments: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    res.json({ data: clinics, total, page, limit, pages: Math.ceil(total / limit) });
  } catch {
    res.status(500).json({ error: 'Failed to fetch clinics' });
  }
});

// GET /api/platform/clinics/:id
router.get('/clinics/:id', async (req, res: Response) => {
  const { id } = req.params;

  try {
    const clinic = await prisma.clinic.findUnique({
      where: { id },
      include: {
        plan: true,
        organization: { select: { id: true, name: true, slug: true, status: true } },
        _count: {
          select: { users: true, patients: true, appointments: true, payments: true },
        },
      },
    });

    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

    res.json(clinic);
  } catch {
    res.status(500).json({ error: 'Failed to fetch clinic' });
  }
});

// POST /api/platform/clinics — Manuel klinik oluşturma
router.post('/clinics', async (req: PlatformAdminRequest, res: Response) => {
  const { name, slug, email, phone, address, currency, timezone, defaultLanguage, planId, maxUsers, maxPatients } = req.body;

  if (!name || !slug) {
    return res.status(400).json({ error: 'name and slug are required' });
  }

  const slugClean = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  try {
    const existing = await prisma.clinic.findFirst({ where: { slug: slugClean } });
    if (existing) return res.status(409).json({ error: 'Slug already in use' });

    const clinic = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name, slug: slugClean, status: 'active', planId: planId ?? null },
      });

      return tx.clinic.create({
        data: {
          organizationId: org.id,
          name,
          slug: slugClean,
          email,
          phone,
          address,
          currency: currency ?? 'TRY',
          timezone: timezone ?? 'Europe/Istanbul',
          defaultLanguage: defaultLanguage ?? 'tr',
          status: 'active',
          planId: planId ?? null,
          maxUsers: maxUsers ?? 10,
          maxPatients: maxPatients ?? 500,
        },
      });
    });

    res.status(201).json(clinic);
  } catch {
    res.status(500).json({ error: 'Failed to create clinic' });
  }
});

// PATCH /api/platform/clinics/:id/status
router.patch('/clinics/:id/status', async (req, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  const allowed = ['trial', 'active', 'suspended', 'cancelled'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
  }

  try {
    const clinic = await prisma.clinic.findUnique({ where: { id } });
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

    const updated = await prisma.clinic.update({ where: { id }, data: { status } });
    res.json({ id: updated.id, status: updated.status });
  } catch {
    res.status(500).json({ error: 'Failed to update clinic status' });
  }
});

// PATCH /api/platform/clinics/:id/plan
router.patch('/clinics/:id/plan', async (req, res: Response) => {
  const { id } = req.params;
  const { planId, maxUsers, maxPatients } = req.body;

  try {
    const clinic = await prisma.clinic.findUnique({ where: { id } });
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

    const data: any = {};
    if (planId !== undefined) data.planId = planId;
    if (maxUsers !== undefined) data.maxUsers = maxUsers;
    if (maxPatients !== undefined) data.maxPatients = maxPatients;

    const updated = await prisma.clinic.update({ where: { id }, data });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update clinic plan' });
  }
});

// PATCH /api/platform/clinics/:id/sms-addon — sell/enable the SMS add-on,
// set monthly quota, allowed destination regions, and routing policy.
// Clinics cannot edit any of this — it is sold/configured by platform admin.
router.patch('/clinics/:id/sms-addon', async (req, res: Response) => {
  const { id } = req.params;
  const { addonEnabled, monthlyQuota, turkeyAllowed, europeAllowed, routingPolicy } = req.body;

  if (addonEnabled !== undefined && typeof addonEnabled !== 'boolean') {
    return res.status(400).json({ error: 'addonEnabled must be a boolean' });
  }
  if (monthlyQuota !== undefined && (!Number.isInteger(monthlyQuota) || monthlyQuota < 0 || monthlyQuota > 1_000_000)) {
    return res.status(400).json({ error: 'monthlyQuota must be a non-negative integer' });
  }
  if (turkeyAllowed !== undefined && typeof turkeyAllowed !== 'boolean') {
    return res.status(400).json({ error: 'turkeyAllowed must be a boolean' });
  }
  if (europeAllowed !== undefined && typeof europeAllowed !== 'boolean') {
    return res.status(400).json({ error: 'europeAllowed must be a boolean' });
  }
  if (routingPolicy !== undefined && !(SMS_ROUTING_POLICIES as readonly string[]).includes(routingPolicy)) {
    return res.status(400).json({ error: `routingPolicy must be one of: ${SMS_ROUTING_POLICIES.join(', ')}` });
  }

  try {
    const clinic = await prisma.clinic.findUnique({ where: { id }, select: { id: true, organizationId: true } });
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

    const settings = await prisma.clinicSmsSettings.upsert({
      where: { clinicId: id },
      update: {
        ...(addonEnabled !== undefined ? { addonEnabled } : {}),
        ...(monthlyQuota !== undefined ? { monthlyQuota } : {}),
        ...(turkeyAllowed !== undefined ? { turkeyAllowed } : {}),
        ...(europeAllowed !== undefined ? { europeAllowed } : {}),
        ...(routingPolicy !== undefined ? { routingPolicy } : {}),
      },
      create: {
        clinicId: id,
        organizationId: clinic.organizationId,
        addonEnabled: addonEnabled ?? false,
        monthlyQuota: monthlyQuota ?? 0,
        turkeyAllowed: turkeyAllowed ?? false,
        europeAllowed: europeAllowed ?? false,
        routingPolicy: routingPolicy ?? 'automatic_by_recipient_phone_region',
      },
      select: {
        clinicId: true, addonEnabled: true, monthlyQuota: true,
        turkeyAllowed: true, europeAllowed: true, routingPolicy: true,
      },
    });
    res.json(settings);
  } catch {
    res.status(500).json({ error: 'Failed to update SMS add-on' });
  }
});

// POST /api/platform/clinics/:id/sms-addon/preview-routing — platform-admin-only
// dry run of the exact same resolver AND entitlement logic the real send
// pipeline uses (sendClinicSms -> getSmsEntitlement -> resolveSmsRouting), so
// preview and real send can never diverge — including for clinics enabled via
// a plan feature rather than the paid add-on.
router.post('/clinics/:id/sms-addon/preview-routing', async (req, res: Response) => {
  const parsed = smsRoutingPreviewSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid preview payload' });
  }

  try {
    const entitlement = await getSmsEntitlement(req.params.id);
    if (!entitlement.enabled || !entitlement.effective) {
      return res.json({
        normalizedPhone: null, detectedRegion: null, targetRegion: null,
        blocked: true, blockedReason: 'addon_disabled',
        blockedMessage: 'SMS add-on is not active for this clinic.', provider: null,
      });
    }

    const routing = await resolveSmsRouting(parsed.data.phone, entitlement.effective);
    if (!routing.ok) {
      return res.json({
        normalizedPhone: routing.normalizedPhone,
        detectedRegion: routing.detectedRegion,
        targetRegion: null,
        blocked: true,
        blockedReason: routing.code,
        blockedMessage: routing.message,
        provider: null,
      });
    }

    let displayName = routing.providerKey;
    if (routing.providerSource === 'platform_default') {
      const row = await prisma.platformSmsProvider.findFirst({
        where: { region: routing.targetRegion, providerCode: routing.providerKey, isActive: true },
        select: { displayName: true },
      });
      displayName = row?.displayName ?? routing.providerKey;
    }

    res.json({
      normalizedPhone: routing.normalizedPhone,
      detectedRegion: routing.detectedRegion,
      targetRegion: routing.targetRegion,
      blocked: false,
      blockedReason: null,
      blockedMessage: null,
      provider: { key: routing.providerKey, displayName, source: routing.providerSource },
    });
  } catch {
    res.status(500).json({ error: 'Failed to preview SMS routing' });
  }
});

// ─── Platform SMS Providers ──────────────────────────────────────────────────
// Global Turkey/Europe provider configs sold behind the clinic SMS add-on.
// Credentials are encrypted at rest and NEVER returned in responses.

// GET /api/platform/sms-providers — list configs (sanitized) + known adapter keys
router.get('/sms-providers', async (_req, res: Response) => {
  try {
    const rows = await prisma.platformSmsProvider.findMany({
      orderBy: [{ region: 'asc' }, { isDefault: 'desc' }, { displayName: 'asc' }],
    });
    res.json({ providers: rows.map(sanitizePlatformSmsProvider), adapters: AVAILABLE_SMS_PROVIDERS });
  } catch {
    res.status(500).json({ error: 'Failed to fetch SMS providers' });
  }
});

// PUT /api/platform/sms-providers — upsert by (region, providerCode)
router.put('/sms-providers', async (req, res: Response) => {
  const parsed = platformSmsProviderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid provider payload' });
  }
  const { region, providerCode, displayName, isActive, isDefault, senderName, credentials } = parsed.data;
  const encrypted = encryptProviderCredentials(credentials ?? null);

  try {
    const row = await prisma.$transaction(async (tx) => {
      // A region has at most one default provider.
      if (isDefault) {
        await tx.platformSmsProvider.updateMany({
          where: { region, NOT: { providerCode } },
          data: { isDefault: false },
        });
      }
      return tx.platformSmsProvider.upsert({
        where: { region_providerCode: { region, providerCode } },
        update: {
          displayName,
          ...(isActive !== undefined ? { isActive } : {}),
          ...(isDefault !== undefined ? { isDefault } : {}),
          ...(senderName !== undefined ? { senderName } : {}),
          // Omitted/empty credentials keep the stored encrypted value;
          // a non-empty object replaces it entirely.
          ...(encrypted ? { credentials: encrypted } : {}),
        },
        create: {
          region,
          providerCode,
          displayName,
          isActive: isActive ?? false,
          isDefault: isDefault ?? false,
          senderName: senderName ?? null,
          credentials: encrypted ?? undefined,
        },
      });
    });
    res.json(sanitizePlatformSmsProvider(row));
  } catch {
    res.status(500).json({ error: 'Failed to save SMS provider' });
  }
});

// POST /api/platform/sms-providers/:id/test — safe connectivity check (no send)
router.post('/sms-providers/:id/test', async (req, res: Response) => {
  try {
    const row = await prisma.platformSmsProvider.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'SMS provider not found' });

    const result = await runPlatformSmsProviderTest(row);
    const updated = await prisma.platformSmsProvider.update({
      where: { id: row.id },
      data: { lastTestedAt: new Date(), lastTestOk: result.ok, lastTestError: result.error },
    });
    res.json({ ok: result.ok, error: result.error, provider: sanitizePlatformSmsProvider(updated) });
  } catch {
    res.status(500).json({ error: 'Failed to test SMS provider' });
  }
});

// DELETE /api/platform/sms-providers/:id
router.delete('/sms-providers/:id', async (req, res: Response) => {
  try {
    await prisma.platformSmsProvider.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: 'SMS provider not found' });
  }
});

// GET /api/platform/clinics/:id/users
router.get('/clinics/:id/users', async (req, res: Response) => {
  const { id } = req.params;

  try {
    const users = await prisma.user.findMany({
      where: { clinicId: id },
      select: {
        id: true, firstName: true, lastName: true, email: true,
        role: true, isActive: true, lastLoginAt: true, createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(users);
  } catch {
    res.status(500).json({ error: 'Failed to fetch clinic users' });
  }
});

// ─── Users ────────────────────────────────────────────────────────────────────

// GET /api/platform/users
router.get('/users', async (req, res: Response) => {
  const { skip, take, page, limit } = parsePagination(req.query);
  const { status, role, organizationId, search } = req.query;

  try {
    const where: any = {};
    if (status === 'active') where.isActive = true;
    else if (status === 'inactive') where.isActive = false;
    if (role) where.role = String(role);
    if (organizationId) where.organizationId = String(organizationId);
    if (search) {
      where.OR = [
        { firstName: { contains: String(search), mode: 'insensitive' } },
        { lastName: { contains: String(search), mode: 'insensitive' } },
        { email: { contains: String(search), mode: 'insensitive' } },
      ];
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, firstName: true, lastName: true, email: true, phone: true,
          role: true, isActive: true, canAccessAllClinics: true,
          lastLoginAt: true, createdAt: true,
          organization: { select: { id: true, name: true, slug: true } },
          defaultClinic: { select: { id: true, name: true, slug: true } },
          clinic: { select: { id: true, name: true, slug: true } },
        },
      }),
    ]);

    res.json({ data: users, total, page, limit, pages: Math.ceil(total / limit) });
  } catch {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// PATCH /api/platform/users/:id/status
router.patch('/users/:id/status', async (req, res: Response) => {
  const { id } = req.params;
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'isActive must be a boolean' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const updated = await prisma.user.update({ where: { id }, data: { isActive } });
    res.json({ id: updated.id, isActive: updated.isActive });
  } catch {
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

// ─── Plans ───────────────────────────────────────────────────────────────────

// GET /api/platform/plans
router.get('/plans', async (_req, res: Response) => {
  try {
    const plans = await prisma.plan.findMany({
      orderBy: { monthlyPrice: 'asc' },
      include: { _count: { select: { clinics: true, organizations: true } } },
    });
    res.json(plans);
  } catch {
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

// POST /api/platform/plans
router.post('/plans', async (req, res: Response) => {
  const { name, displayName, maxUsers, maxPatients, features, monthlyPrice, isActive } = req.body;

  if (!name || !displayName || maxUsers == null || maxPatients == null) {
    return res.status(400).json({ error: 'name, displayName, maxUsers, maxPatients required' });
  }

  try {
    const plan = await prisma.plan.create({
      data: {
        name: name.toLowerCase(),
        displayName,
        maxUsers,
        maxPatients,
        features: features ?? {},
        monthlyPrice: monthlyPrice ?? 0,
        isActive: isActive ?? true,
      },
    });
    res.status(201).json(plan);
  } catch {
    res.status(500).json({ error: 'Failed to create plan' });
  }
});

// PUT /api/platform/plans/:id
router.put('/plans/:id', async (req, res: Response) => {
  const { id } = req.params;
  const { displayName, maxUsers, maxPatients, features, monthlyPrice, isActive } = req.body;

  try {
    const existing = await prisma.plan.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Plan not found' });

    const data: any = {};
    if (displayName !== undefined) data.displayName = displayName;
    if (maxUsers !== undefined) data.maxUsers = maxUsers;
    if (maxPatients !== undefined) data.maxPatients = maxPatients;
    if (features !== undefined) data.features = features;
    if (monthlyPrice !== undefined) data.monthlyPrice = monthlyPrice;
    if (isActive !== undefined) data.isActive = isActive;

    const updated = await prisma.plan.update({ where: { id }, data });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

// ─── System / Health ──────────────────────────────────────────────────────────

// GET /api/platform/system
router.get('/system', async (_req, res: Response) => {
  try {
    // DB health check
    let dbStatus = 'ok';
    let dbError: string | undefined;
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (e: any) {
      dbStatus = 'error';
      dbError = e?.message ?? 'Unknown error';
    }

    const [
      evolutionConnCount,
      metaConnCount,
      totalConnected,
      recentFailedMessages,
    ] = await Promise.all([
      prisma.whatsAppConnection.count({ where: { provider: 'evolution_api' } }),
      prisma.whatsAppConnection.count({ where: { provider: 'meta_cloud_api' } }),
      prisma.whatsAppConnection.count({ where: { status: 'connected' } }),
      prisma.sentMessage.count({ where: { status: 'failed' } }),
    ]);

    res.json({
      status: dbStatus === 'ok' ? 'healthy' : 'degraded',
      database: { status: dbStatus, error: dbError },
      api: { status: 'ok' },
      whatsapp: {
        evolution: evolutionConnCount,
        meta: metaConnCount,
        connected: totalConnected,
      },
      recentFailedMessages,
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch system status' });
  }
});

// ─── Privacy / Data Retention ─────────────────────────────────────────────────

function buildPolicyResponse(
  config: ReturnType<typeof loadDataRetentionConfig>,
  runtimeCleanupEnabled: boolean,
) {
  const envCleanupEnabled = config.enabled;
  const effectiveCleanupEnabled = envCleanupEnabled && runtimeCleanupEnabled;
  const cleanupEnabledSource: 'env_disabled' | 'runtime_disabled' | 'enabled' =
    !envCleanupEnabled ? 'env_disabled'
    : !runtimeCleanupEnabled ? 'runtime_disabled'
    : 'enabled';

  return {
    envCleanupEnabled,
    runtimeCleanupEnabled,
    effectiveCleanupEnabled,
    cleanupEnabledSource,
    cron: config.cronSchedule,
    conversationMessagesDays: config.conversationMessagesDays,
    conversationStateDays: config.conversationStateDays,
    operationalEventsDays: config.operationalEventsDays,
    inboundEventDays: config.inboundEventDays,
    resolvedContactRequestDays: config.resolvedContactRequestDays,
    batchSize: config.batchSize,
  };
}

// GET /api/platform/privacy/data-retention/policy
// Returns current retention policy config including runtime toggle. No secrets. Platform-admin only.
router.get('/privacy/data-retention/policy', async (_req, res: Response) => {
  const config = loadDataRetentionConfig();
  const runtimeVal = await getPlatformSetting('privacy.dataRetention.runtimeEnabled');
  const runtimeCleanupEnabled = runtimeVal === 'true';
  res.json(buildPolicyResponse(config, runtimeCleanupEnabled));
});

// PATCH /api/platform/privacy/data-retention/settings
// Update runtime toggle for automatic cleanup. Platform-admin only.
router.patch('/privacy/data-retention/settings', async (req, res: Response) => {
  const { runtimeCleanupEnabled } = req.body ?? {};
  if (typeof runtimeCleanupEnabled !== 'boolean') {
    res.status(400).json({ error: 'runtimeCleanupEnabled must be a boolean' });
    return;
  }
  await setPlatformSetting('privacy.dataRetention.runtimeEnabled', String(runtimeCleanupEnabled));
  const config = loadDataRetentionConfig();
  res.json(buildPolicyResponse(config, runtimeCleanupEnabled));
});

// ─── Privacy / Legacy Consent Correction Runtime Toggle (KVKK-HIGH-008-F1) ────
// Same PlatformSetting-backed pattern as the data-retention toggle above —
// reused, not duplicated as a new settings framework. This is a platform-wide
// kill switch (not per-tenant rollout allowlisting): default false, and the
// legacy-corrections mutation route (communicationPreferences.ts) denies by
// default whenever this setting is absent or not exactly 'true'.

// GET /api/platform/privacy/legacy-consent-correction/policy
// Returns current runtime toggle state. Platform-admin only.
router.get('/privacy/legacy-consent-correction/policy', async (_req, res: Response) => {
  const runtimeEnabled = await isLegacyConsentCorrectionRuntimeEnabled();
  res.json({ runtimeEnabled });
});

// PATCH /api/platform/privacy/legacy-consent-correction/settings
// Enable/disable the legacy consent correction workflow. Platform-admin only.
router.patch('/privacy/legacy-consent-correction/settings', async (req: PlatformAdminRequest, res: Response) => {
  const { runtimeEnabled } = req.body ?? {};
  if (typeof runtimeEnabled !== 'boolean') {
    res.status(400).json({ error: 'runtimeEnabled must be a boolean' });
    return;
  }
  await setPlatformSetting(LEGACY_CONSENT_CORRECTION_RUNTIME_SETTING_KEY, String(runtimeEnabled));
  // No dedicated platform-admin audit table exists (AuditLog.organizationId
  // is mandatory, so it cannot record a platform-wide setting change) —
  // structured console logging is this router's existing convention for
  // this class of action (see /backups/run, /backups/restore-test above).
  console.log(`[platform-privacy] Legacy consent correction runtime toggle set to ${runtimeEnabled} by admin ${req.platformAdmin?.email}`);
  res.json({ runtimeEnabled });
});

// POST /api/platform/privacy/data-retention/run
// Trigger or dry-run the data retention cleanup. Platform-admin only.
// Live run is blocked if DATA_RETENTION_CLEANUP_ENABLED=false (env hard-switch).
router.post('/privacy/data-retention/run', async (req, res: Response) => {
  const dryRun = req.body?.dryRun !== false; // default to dry-run for safety
  if (!dryRun) {
    const config = loadDataRetentionConfig();
    if (!config.enabled) {
      res.status(403).json({ error: 'Live cleanup is disabled at the environment level (DATA_RETENTION_CLEANUP_ENABLED=false).' });
      return;
    }
  }
  try {
    const { runDataRetentionCleanup } = await import('../jobs/dataRetentionCleanupJob.js');
    const summary = await runDataRetentionCleanup({ dryRun });
    res.json({ success: true, summary });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: `Data retention run failed: ${msg}` });
  }
});

// ─── Backups ──────────────────────────────────────────────────────────────────

// GET /api/platform/backups/status
router.get('/backups/status', async (_req, res: Response) => {
  try {
    const { getBackupStatus } = await import('../services/backupService.js');
    const status = await getBackupStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: `Failed to get backup status: ${err?.message ?? 'Unknown error'}` });
  }
});

// GET /api/platform/backups/logs?lines=100
router.get('/backups/logs', async (req, res: Response) => {
  const rawLines = parseInt(String(req.query.lines ?? '100'), 10);
  const lines = Math.min(300, Math.max(1, isNaN(rawLines) ? 100 : rawLines));
  try {
    const { getBackupLogs } = await import('../services/backupService.js');
    const logLines = await getBackupLogs(lines);
    res.json({ lines: logLines, count: logLines.length, requestedLines: lines });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to get backup logs: ${err?.message ?? 'Unknown error'}` });
  }
});

// POST /api/platform/backups/run
router.post('/backups/run', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const { runBackup, isBackupRunning } = await import('../services/backupService.js');
    if (isBackupRunning()) {
      return res.status(409).json({ error: 'A backup is already running' });
    }
    console.log(`[platform-backup] Manual backup triggered by admin ${req.platformAdmin?.email}`);
    const result = await runBackup();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: `Backup run failed: ${err?.message ?? 'Unknown error'}` });
  }
});

// POST /api/platform/backups/restore-test
router.post('/backups/restore-test', async (req: PlatformAdminRequest, res: Response) => {
  const { filename } = req.body ?? {};
  if (filename !== undefined && typeof filename !== 'string') {
    return res.status(400).json({ error: 'filename must be a string' });
  }
  try {
    const { runRestoreTest, isRestoreTestRunning } = await import('../services/backupService.js');
    if (isRestoreTestRunning()) {
      return res.status(409).json({ error: 'A restore test is already running' });
    }
    console.log(`[platform-backup] Restore test triggered by admin ${req.platformAdmin?.email}, file: ${filename ?? 'latest'}`);
    const result = await runRestoreTest(filename);
    res.json(result);
  } catch (err: any) {
    const status = err?.message?.includes('Invalid') || err?.message?.includes('not found') ? 400 : 500;
    res.status(status).json({ error: err?.message ?? 'Restore test failed' });
  }
});

// ─── Mail Test ────────────────────────────────────────────────────────────────

// POST /api/platform/mail/test
router.post(
  '/mail/test',
  authenticatePlatformAdmin as express.RequestHandler,
  csrfProtection('platform'),
  async (req: PlatformAdminRequest, res) => {
    const { to } = req.body ?? {};

    if (!to || typeof to !== 'string' || !to.includes('@')) {
      return res.status(400).json({ error: 'A valid recipient email address is required' });
    }

    const recipient = to.trim().toLowerCase();

    try {
      const { sendMail } = await import('../services/emailService.js');
      const { buildTestEmail } = await import('../services/emailTemplates.js');

      const payload = buildTestEmail({ to: recipient });
      const result = await sendMail({ to: recipient, ...payload });

      if (!result.sent) {
        return res.status(503).json({
          success: false,
          reason: result.reason ?? 'Email not sent',
          smtpConfigured: process.env.MAIL_ENABLED === 'true',
        });
      }

      console.log(`[platform-mail-test] Test email sent to ${recipient} by admin ${req.platformAdmin?.email}`);

      return res.json({
        success: true,
        to: recipient,
        smtpHost: process.env.SMTP_HOST ?? '(not set)',
        smtpPort: process.env.SMTP_PORT ?? '(not set)',
        smtpFrom: process.env.SMTP_FROM ?? '(not set)',
      });
    } catch (err: any) {
      console.error('[platform-mail-test] Error:', err?.message);
      return res.status(500).json({ success: false, error: 'Failed to send test email' });
    }
  },
);

export default router;

