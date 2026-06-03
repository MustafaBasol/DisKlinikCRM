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

const router = express.Router();

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

  try {
    const admin = await prisma.platformAdmin.findUnique({ where: { email } });
    if (!admin || !admin.isActive) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

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
      select: { id: true, email: true, name: true, isActive: true, createdAt: true },
    });
    if (!admin) return res.status(404).json({ error: 'Not found' });
    res.json(admin);
  } catch {
    res.status(500).json({ error: 'Failed to fetch profile' });
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
          plan: { select: { name: true, displayName: true } },
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

export default router;
