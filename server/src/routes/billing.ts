import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticate, authorize, AuthRequest } from '../middleware/auth.js';
import {
  createCheckoutSession,
  createBillingPortalSession,
  BillingError,
} from '../services/billing/stripeBillingService.js';
import prisma from '../db.js';

const router = Router();

// All billing routes require auth — applied here for clarity (index.ts also applies globally).
router.use(authenticate as any);

// ── POST /api/billing/checkout-session ───────────────────────────────────────

const checkoutSchema = z.object({
  planId: z.string().min(1),
  billingInterval: z.enum(['monthly', 'yearly']),
});

router.post(
  '/billing/checkout-session',
  authorize(['OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
    }

    try {
      const url = await createCheckoutSession({
        clinicId: req.user!.clinicId,
        planId: parsed.data.planId,
        billingInterval: parsed.data.billingInterval,
        actorUserId: req.user!.id,
      });
      return res.json({ url });
    } catch (err) {
      if (err instanceof BillingError) {
        return res.status(err.statusCode).json({ error: err.message, code: err.code });
      }
      console.error('[billing] checkout-session error', err instanceof Error ? err.message : err);
      return res.status(500).json({ error: 'Failed to create checkout session' });
    }
  },
);

// ── POST /api/billing/portal-session ─────────────────────────────────────────

router.post(
  '/billing/portal-session',
  authorize(['OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    try {
      const url = await createBillingPortalSession({
        clinicId: req.user!.clinicId,
        actorUserId: req.user!.id,
      });
      return res.json({ url });
    } catch (err) {
      if (err instanceof BillingError) {
        return res.status(err.statusCode).json({ error: err.message, code: err.code });
      }
      console.error('[billing] portal-session error', err instanceof Error ? err.message : err);
      return res.status(500).json({ error: 'Failed to create billing portal session' });
    }
  },
);

// ── GET /api/billing/subscription ────────────────────────────────────────────

router.get(
  '/billing/subscription',
  async (req: AuthRequest, res: Response) => {
    try {
      const clinic = await prisma.clinic.findUnique({
        where: { id: req.user!.clinicId },
        select: {
          status: true,
          trialEndsAt: true,
          stripeSubscriptionStatus: true,
          stripeCurrentPeriodEnd: true,
          stripeCancelAtPeriodEnd: true,
          subscriptionSyncedAt: true,
          plan: { select: { id: true, name: true, displayName: true } },
        },
      });

      if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

      return res.json({
        plan: clinic.plan ?? null,
        status: clinic.status,
        trialEndsAt: clinic.trialEndsAt ?? null,
        stripeSubscriptionStatus: clinic.stripeSubscriptionStatus ?? null,
        stripeCurrentPeriodEnd: clinic.stripeCurrentPeriodEnd ?? null,
        stripeCancelAtPeriodEnd: clinic.stripeCancelAtPeriodEnd,
        subscriptionSyncedAt: clinic.subscriptionSyncedAt ?? null,
      });
    } catch (err) {
      console.error('[billing] subscription error', err instanceof Error ? err.message : err);
      return res.status(500).json({ error: 'Failed to load subscription info' });
    }
  },
);

export default router;
