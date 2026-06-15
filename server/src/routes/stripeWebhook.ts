import { Router, Request, Response } from 'express';
import { getStripeClient, handleStripeWebhookEvent } from '../services/billing/stripeBillingService.js';

const router = Router();

// ── POST /api/webhooks/stripe ─────────────────────────────────────────────────
// No user auth — Stripe signature verification is the security layer.
// rawBody is captured by the global express.json verify callback in index.ts.

router.post(
  '/webhooks/stripe',
  async (req: Request, res: Response) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not configured');
      return res.status(500).json({ error: 'Webhook not configured' });
    }

    const sig = req.headers['stripe-signature'];
    if (!sig) {
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }

    const rawBody: Buffer | undefined = (req as any).rawBody;
    if (!rawBody) {
      return res.status(400).json({ error: 'Missing raw body' });
    }

    let event: any;
    try {
      const stripe = getStripeClient();
      event = stripe.webhooks.constructEvent(rawBody, sig as string, secret);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(400).json({ error: `Webhook signature verification failed: ${message}` });
    }

    try {
      await handleStripeWebhookEvent(event);
      return res.json({ received: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[stripe-webhook] event processing failed', {
        eventType: event.type,
        eventId: event.id,
        error: message,
      });
      return res.status(500).json({ error: 'Webhook processing failed' });
    }
  },
);

export default router;
