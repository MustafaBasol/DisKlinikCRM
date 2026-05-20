import express, { Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import {
  authenticatePlatformAdmin,
  generatePlatformToken,
  PlatformAdminRequest,
} from '../middleware/platformAuth.js';

const router = express.Router();

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

    const token = generatePlatformToken({ id: admin.id, email: admin.email });
    res.json({ token, admin: { id: admin.id, name: admin.name, email: admin.email } });
  } catch {
    res.status(500).json({ error: 'Login failed' });
  }
});

// All routes below require platform admin auth
router.use(authenticatePlatformAdmin as express.RequestHandler);

// ─── Platform Stats ───────────────────────────────────────────────────────────

// GET /api/platform/stats
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

// ─── Clinics ─────────────────────────────────────────────────────────────────

// GET /api/platform/clinics
router.get('/clinics', async (req, res: Response) => {
  const { status, search } = req.query;

  try {
    const where: any = {};
    if (status) where.status = String(status);
    if (search) {
      where.OR = [
        { name: { contains: String(search), mode: 'insensitive' } },
        { slug: { contains: String(search), mode: 'insensitive' } },
        { email: { contains: String(search), mode: 'insensitive' } },
      ];
    }

    const clinics = await prisma.clinic.findMany({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        email: true,
        phone: true,
        currency: true,
        timezone: true,
        trialEndsAt: true,
        maxUsers: true,
        maxPatients: true,
        createdAt: true,
        plan: { select: { name: true, displayName: true } },
        _count: { select: { users: true, patients: true, appointments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(clinics);
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

// POST /api/platform/clinics  — Manuel klinik oluşturma
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
      // Organization oluştur
      const org = await tx.organization.create({
        data: {
          name,
          slug: slugClean,
          status: 'active',
          planId: planId ?? null,
        },
      });

      // Clinic oluştur
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

// PATCH /api/platform/clinics/:id/status — Durum değiştir
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

// PATCH /api/platform/clinics/:id/plan — Plan değiştir
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

// ─── Plans ───────────────────────────────────────────────────────────────────

// GET /api/platform/plans
router.get('/plans', async (_req, res: Response) => {
  try {
    const plans = await prisma.plan.findMany({
      orderBy: { monthlyPrice: 'asc' },
      include: { _count: { select: { clinics: true } } },
    });
    res.json(plans);
  } catch {
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

// POST /api/platform/plans
router.post('/plans', async (req, res: Response) => {
  const { name, displayName, maxUsers, maxPatients, features, monthlyPrice } = req.body;

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
      },
    });
    res.status(201).json(plan);
  } catch {
    res.status(500).json({ error: 'Failed to create plan' });
  }
});

export default router;
