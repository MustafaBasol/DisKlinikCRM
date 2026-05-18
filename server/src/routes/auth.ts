import express from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { authenticate, generateToken, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { checkLoginAttempt, recordLoginAttempt, resetLoginAttempts } from '../utils/helpers.js';

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

    const user = await prisma.user.findUnique({
      where: { email },
      include: { clinic: true },
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

    const token = generateToken({
      id: user.id,
      clinicId: user.clinicId,
      role: user.role,
    });

    await logActivity({
      clinicId: user.clinicId,
      userId: user.id,
      entityType: 'user',
      entityId: user.id,
      action: 'login',
      description: `User ${user.email} logged in`,
    });

    res.json({
      token,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
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
      include: { clinic: true },
    });
    if (!user) return res.status(401).json({ error: 'User not found' });

    res.json({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      clinic: {
        id: user.clinic.id,
        name: user.clinic.name,
        currency: user.clinic.currency,
        timezone: user.clinic.timezone,
      },
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default router;
