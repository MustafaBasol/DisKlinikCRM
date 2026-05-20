import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { validatePassword } from '../utils/helpers.js';

const router = express.Router();

// GET /api/register/check-slug/:slug — Slug müsait mi?
router.get('/check-slug/:slug', async (req: Request, res: Response) => {
  const raw = req.params.slug as string;
  const slug = raw.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  if (slug.length < 3) {
    return res.status(400).json({ available: false, error: 'Slug must be at least 3 characters' });
  }

  try {
    const existing = await prisma.clinic.findFirst({ where: { slug } });
    res.json({ available: !existing, slug });
  } catch {
    res.status(500).json({ error: 'Failed to check slug' });
  }
});

// POST /api/register/clinic — Self-service klinik kaydı
router.post('/clinic', async (req: Request, res: Response) => {
  const { clinicName, slug, adminFirstName, adminLastName, adminEmail, adminPassword, currency, timezone } = req.body;

  if (!clinicName || !slug || !adminFirstName || !adminLastName || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'clinicName, slug, adminFirstName, adminLastName, adminEmail, adminPassword are required' });
  }

  const slugClean = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (slugClean.length < 3) {
    return res.status(400).json({ error: 'slug must be at least 3 characters' });
  }

  if (!adminEmail.includes('@')) {
    return res.status(400).json({ error: 'Invalid admin email' });
  }

  const pwCheck = validatePassword(adminPassword);
  if (!pwCheck.valid) {
    return res.status(400).json({ error: 'Password does not meet requirements', details: pwCheck.errors });
  }

  try {
    const existingSlug = await prisma.clinic.findFirst({ where: { slug: slugClean } });
    if (existingSlug) {
      return res.status(409).json({ error: 'This slug is already taken. Please choose another.' });
    }

    // Starter plan bul (yoksa plansız oluştur)
    const starterPlan = await prisma.plan.findUnique({ where: { name: 'starter' } });

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    const passwordHash = await bcrypt.hash(adminPassword, 12);

    const result = await prisma.$transaction(async (tx) => {
      // 1. Organization oluştur
      const org = await tx.organization.create({
        data: {
          name: clinicName,
          slug: slugClean,
          status: 'trial',
          planId: starterPlan?.id ?? null,
          trialEndsAt,
        },
      });

      // 2. Clinic oluştur
      const clinic = await tx.clinic.create({
        data: {
          organizationId: org.id,
          name: clinicName,
          slug: slugClean,
          currency: currency ?? 'TRY',
          timezone: timezone ?? 'Europe/Istanbul',
          defaultLanguage: 'tr',
          status: 'trial',
          trialEndsAt,
          planId: starterPlan?.id ?? null,
          maxUsers: 5,
          maxPatients: 200,
        },
      });

      // 3. Admin kullanıcı oluştur
      const adminUser = await tx.user.create({
        data: {
          clinicId: clinic.id,
          organizationId: org.id,
          firstName: adminFirstName,
          lastName: adminLastName,
          email: adminEmail,
          passwordHash,
          role: 'admin',
          isActive: true,
          defaultClinicId: clinic.id,
          canAccessAllClinics: true,
        },
      });

      // 4. UserClinic üyelik kaydı
      await tx.userClinic.create({
        data: { userId: adminUser.id, clinicId: clinic.id, role: 'ADMIN', isActive: true },
      });

      // 5. Organization owner ata
      await tx.organization.update({ where: { id: org.id }, data: { ownerId: adminUser.id } });

      return { clinic, adminUser };
    });

    res.status(201).json({
      message: 'Clinic registered successfully. Trial period starts now.',
      clinic: {
        id: result.clinic.id,
        name: result.clinic.name,
        slug: result.clinic.slug,
        status: result.clinic.status,
        trialEndsAt: result.clinic.trialEndsAt,
      },
    });
  } catch {
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

export default router;
