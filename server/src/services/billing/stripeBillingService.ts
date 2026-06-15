import Stripe from 'stripe';
import prisma from '../../db.js';

type StripeClient = InstanceType<typeof Stripe>;

// ── Minimal local shapes for Stripe objects ───────────────────────────────────
// We use these instead of importing Stripe.*  types that are not accessible
// under moduleResolution:node pointing at the CJS entry point.

interface StripeSubscriptionItem {
  price?: { id?: string; product?: string | null };
  current_period_end?: number | null;
}

interface StripeSubscription {
  id: string;
  status: string;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string> | null;
  items?: { data?: StripeSubscriptionItem[] };
}

interface StripeCheckoutSession {
  id: string;
  customer?: string | { id?: string } | null;
  subscription?: string | StripeSubscription | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
}

interface StripeInvoice {
  id: string;
  subscription?: string | null;
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: unknown };
}

// ── Stripe client ─────────────────────────────────────────────────────────────

let _stripe: StripeClient | null = null;

export function getStripeClient(): StripeClient {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
    _stripe = new Stripe(key, { apiVersion: '2026-05-27.dahlia' });
  }
  return _stripe;
}

// ── Status mapping ────────────────────────────────────────────────────────────

export function mapStripeSubscriptionStatus(status: string): string {
  const valid = [
    'active', 'trialing', 'past_due', 'canceled', 'unpaid',
    'incomplete', 'incomplete_expired', 'paused',
  ];
  return valid.includes(status) ? status : 'unknown';
}

// ── Customer management ───────────────────────────────────────────────────────

export async function createOrGetStripeCustomerForClinic(
  clinicId: string,
): Promise<string> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true, name: true, email: true, stripeCustomerId: true },
  });
  if (!clinic) throw new Error(`Clinic not found: ${clinicId}`);

  if (clinic.stripeCustomerId) return clinic.stripeCustomerId;

  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    name: clinic.name,
    email: clinic.email ?? undefined,
    metadata: { clinicId },
  });

  await prisma.clinic.update({
    where: { id: clinicId },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

// ── Checkout session ──────────────────────────────────────────────────────────

export async function createCheckoutSession({
  clinicId,
  planId,
  billingInterval,
  actorUserId,
}: {
  clinicId: string;
  planId: string;
  billingInterval: 'monthly' | 'yearly';
  actorUserId: string;
}): Promise<string> {
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      name: true,
      stripeMonthlyPriceId: true,
      stripeYearlyPriceId: true,
      isActive: true,
    },
  });

  if (!plan) throw new BillingError('Plan not found', 'plan_not_found', 404);
  if (!plan.isActive) throw new BillingError('Plan is not active', 'plan_inactive', 400);

  const priceId =
    billingInterval === 'yearly' ? plan.stripeYearlyPriceId : plan.stripeMonthlyPriceId;

  if (!priceId) {
    throw new BillingError(
      `Plan has no Stripe price ID for interval: ${billingInterval}`,
      'no_stripe_price',
      400,
    );
  }

  const successUrl = process.env.STRIPE_SUCCESS_URL;
  const cancelUrl = process.env.STRIPE_CANCEL_URL;
  if (!successUrl || !cancelUrl) {
    throw new Error('STRIPE_SUCCESS_URL or STRIPE_CANCEL_URL is not configured');
  }

  const customerId = await createOrGetStripeCustomerForClinic(clinicId);
  const stripe = getStripeClient();

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: clinicId,
    metadata: {
      clinicId,
      planId,
      billingInterval,
      actorUserId,
      env: process.env.NODE_ENV ?? 'development',
    },
    subscription_data: {
      metadata: { clinicId, planId, billingInterval },
    },
  });

  if (!session.url) throw new Error('Stripe checkout session has no URL');
  return session.url;
}

// ── Billing portal ────────────────────────────────────────────────────────────

export async function createBillingPortalSession({
  clinicId,
}: {
  clinicId: string;
  actorUserId: string;
}): Promise<string> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { stripeCustomerId: true },
  });

  if (!clinic) throw new BillingError('Clinic not found', 'clinic_not_found', 404);
  if (!clinic.stripeCustomerId) {
    throw new BillingError(
      'Clinic does not have a Stripe customer. Start a subscription first.',
      'no_stripe_customer',
      400,
    );
  }

  const returnUrl = process.env.STRIPE_BILLING_PORTAL_RETURN_URL;
  if (!returnUrl) throw new Error('STRIPE_BILLING_PORTAL_RETURN_URL is not configured');

  const stripe = getStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: clinic.stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
}

// ── Subscription sync ─────────────────────────────────────────────────────────

export async function syncClinicSubscriptionFromStripe(
  subscription: StripeSubscription,
): Promise<void> {
  const clinicId = subscription.metadata?.clinicId ?? null;

  if (!clinicId) {
    console.warn('[stripe-billing] subscription has no clinicId in metadata', {
      subscriptionId: subscription.id,
    });
    return;
  }

  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id ?? null;
  const productId = item?.price?.product ?? null;
  const periodEnd = item?.current_period_end
    ? new Date(item.current_period_end * 1000)
    : null;

  // Resolve planId from Stripe price ID
  let resolvedPlanId: string | undefined;
  if (priceId) {
    const plan = await prisma.plan.findFirst({
      where: {
        OR: [
          { stripeMonthlyPriceId: priceId },
          { stripeYearlyPriceId: priceId },
        ],
      },
      select: { id: true },
    });
    if (plan) {
      resolvedPlanId = plan.id;
    } else {
      console.warn('[stripe-billing] price ID not mapped to any Plan', { priceId });
    }
  }

  await prisma.clinic.update({
    where: { id: clinicId },
    data: {
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus: mapStripeSubscriptionStatus(subscription.status),
      stripeCurrentPeriodEnd: periodEnd,
      stripeCancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
      stripePriceId: priceId,
      stripeProductId: typeof productId === 'string' ? productId : null,
      subscriptionSyncedAt: new Date(),
      ...(resolvedPlanId ? { planId: resolvedPlanId } : {}),
    },
  });
}

// ── Webhook event handling ────────────────────────────────────────────────────

export async function handleStripeWebhookEvent(
  event: StripeEvent,
): Promise<{ status: 'processed' | 'ignored' }> {
  const record = await prisma.stripeWebhookEvent.upsert({
    where: { stripeEventId: event.id },
    create: {
      stripeEventId: event.id,
      eventType: event.type,
      status: 'received',
    },
    update: {},
  });

  // Idempotency: already in terminal state
  if (record.status === 'processed' || record.status === 'ignored') {
    return { status: record.status as 'processed' | 'ignored' };
  }

  const handledTypes = new Set([
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_succeeded',
    'invoice.payment_failed',
  ]);

  if (!handledTypes.has(event.type)) {
    await prisma.stripeWebhookEvent.update({
      where: { stripeEventId: event.id },
      data: { status: 'ignored', processedAt: new Date() },
    });
    return { status: 'ignored' };
  }

  try {
    await processKnownEvent(event);

    await prisma.stripeWebhookEvent.update({
      where: { stripeEventId: event.id },
      data: { status: 'processed', processedAt: new Date() },
    });

    return { status: 'processed' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await prisma.stripeWebhookEvent.update({
      where: { stripeEventId: event.id },
      data: {
        status: 'failed',
        errorMessage: message.slice(0, 500),
      },
    });
    throw err;
  }
}

async function processKnownEvent(event: StripeEvent): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as StripeCheckoutSession;
      const clinicId = session.metadata?.clinicId ?? session.client_reference_id ?? null;
      if (!clinicId) {
        console.warn('[stripe-billing] checkout.session.completed: no clinicId', {
          sessionId: session.id,
        });
        return;
      }

      const customerId = typeof session.customer === 'string'
        ? session.customer
        : (session.customer as any)?.id ?? null;

      const subscriptionId = typeof session.subscription === 'string'
        ? session.subscription
        : typeof session.subscription === 'object' && session.subscription !== null
          ? (session.subscription as StripeSubscription).id
          : null;

      const data: Record<string, unknown> = { subscriptionSyncedAt: new Date() };
      if (customerId) data.stripeCustomerId = customerId;
      if (subscriptionId) data.stripeSubscriptionId = subscriptionId;

      await prisma.clinic.update({ where: { id: clinicId }, data });

      if (typeof session.subscription === 'object' && session.subscription !== null) {
        await syncClinicSubscriptionFromStripe(session.subscription as StripeSubscription);
      }
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      await syncClinicSubscriptionFromStripe(event.data.object as StripeSubscription);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as StripeSubscription;
      await syncClinicSubscriptionFromStripe({ ...sub, status: 'canceled' });
      break;
    }

    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed': {
      const invoice = event.data.object as StripeInvoice;
      const subscriptionId = typeof invoice.subscription === 'string'
        ? invoice.subscription
        : null;
      if (subscriptionId) {
        const stripe = getStripeClient();
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        await syncClinicSubscriptionFromStripe(sub as unknown as StripeSubscription);
      }
      break;
    }
  }
}

// ── Error class ───────────────────────────────────────────────────────────────

export class BillingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}
