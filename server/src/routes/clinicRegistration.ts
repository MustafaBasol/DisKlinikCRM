import crypto from 'crypto';
import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { validatePassword, createRateLimiter } from '../utils/helpers.js';
import { sendMail } from '../services/emailService.js';
import { buildEmailVerificationEmail } from '../services/emailTemplates.js';

const router = express.Router();

// Unauthenticated endpoints — throttle per IP to prevent mass tenant creation
// and slug/email probing.
const registrationLimiter = createRateLimiter(5, 60 * 60 * 1000, 'clinic-registration');
const slugCheckLimiter = createRateLimiter(60, 15 * 60 * 1000, 'slug-check');

// GET /api/register/check-slug/:slug — Slug müsait mi?
router.get('/check-slug/:slug', async (req: Request, res: Response) => {
  const clientIp = req.ip || 'unknown';
  if (!(await slugCheckLimiter.check(clientIp))) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  await slugCheckLimiter.record(clientIp);

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
  const clientIp = req.ip || 'unknown';
  if (!(await registrationLimiter.check(clientIp))) {
    return res.status(429).json({ error: 'Too many registration attempts. Please try again later.' });
  }
  await registrationLimiter.record(clientIp);

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

    const existingEmail = await prisma.user.findFirst({
      where: { email: { equals: adminEmail, mode: 'insensitive' } },
      select: { id: true },
    });
    // Bilinçli karar: EMAIL_ALREADY_EXISTS enumeration'a izin verir ama
    // registrationLimiter (5/saat/IP) toplu taramayı pratik olmaktan çıkarır;
    // jenerik hata ise meşru kayıt olan kullanıcıyı çözümsüz bırakırdı.
    if (existingEmail) {
      return res.status(409).json({
        error: 'Bu e-posta adresi zaten kullanımda. Lütfen farklı bir e-posta adresi kullanın.',
        code: 'EMAIL_ALREADY_EXISTS',
      });
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

      // 3. Admin kullanıcı oluştur (emailVerifiedAt = null — doğrulama e-postası bekleniyor)
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
          emailVerifiedAt: null,
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

    // Send verification email (non-blocking — registration succeeds even if SMTP fails)
    try {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await prisma.emailVerificationToken.create({
        data: { userId: result.adminUser.id, tokenHash, expiresAt },
      });

      const appBaseUrl = (process.env.APP_BASE_URL || 'https://app.noramedi.com').replace(/\/$/, '');
      const verifyUrl = `${appBaseUrl}/verify-email?token=${rawToken}`;

      const emailPayload = buildEmailVerificationEmail({ firstName: adminFirstName, verifyUrl });
      const mailResult = await sendMail({ to: adminEmail, ...emailPayload });
      if (!mailResult.sent) {
        console.warn(`[clinic-register] Verification email not sent for user ${result.adminUser.id}: ${mailResult.reason}`);
      }
    } catch (emailErr) {
      console.warn('[clinic-register] Failed to send verification email:', (emailErr as Error).message);
    }

    res.status(201).json({
      message: 'Clinic registered successfully. Please check your email to verify your account before logging in.',
      clinic: {
        id: result.clinic.id,
        name: result.clinic.name,
        slug: result.clinic.slug,
        status: result.clinic.status,
        trialEndsAt: result.clinic.trialEndsAt,
      },
      emailVerificationRequired: true,
    });
  } catch {
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

export default router;
