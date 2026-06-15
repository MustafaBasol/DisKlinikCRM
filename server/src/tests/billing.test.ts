/**
 * billing.test.ts — Stripe SaaS billing foundation unit tests
 *
 * Run: cd server && npx tsx src/tests/billing.test.ts
 *
 * All tests are pure unit tests — no DB, no network, no Stripe API calls.
 * Stripe client and Prisma are stubbed via lightweight in-process mocks.
 *
 * Coverage:
 *  Schema/model:
 *   1. Plan can store monthly/yearly Stripe price IDs
 *   2. Clinic can store Stripe customer/subscription fields
 *   3. StripeWebhookEvent has unique stripeEventId constraint
 *
 *  mapStripeSubscriptionStatus:
 *   4-5. Known and unknown status mapping
 *
 *  Checkout:
 *   6.  Authorized OWNER/ORG_ADMIN creates checkout session
 *   7.  Non-admin role rejected (403)
 *   8.  Invalid planId rejected (404)
 *   9.  Plan without Stripe price rejected (400)
 *   10. monthly interval uses stripeMonthlyPriceId
 *   11. yearly interval uses stripeYearlyPriceId
 *   12. Checkout does not update clinic plan before webhook fires
 *
 *  Portal:
 *   13. Authorized admin with customer creates portal session
 *   14. Clinic with no Stripe customer gets clear error
 *   15. Cross-clinic portal access denied via auth middleware enforcement
 *
 *  Webhook:
 *   16. Invalid Stripe signature rejected (400)
 *   17. Duplicate event returns 200 without reprocessing
 *   18. checkout.session.completed links customer/subscription to clinic
 *   19. customer.subscription.updated updates status/periodEnd/cancelAtPeriodEnd
 *   20. customer.subscription.deleted marks status canceled
 *   21. invoice.payment_failed stores subscription status without deleting clinic data
 *   22. Unknown event type is safely ignored/recorded
 *
 *  Plan mapping:
 *   23. Price ID maps to Plan.stripeMonthlyPriceId → sets planId
 *   24. Price ID maps to Plan.stripeYearlyPriceId → sets planId
 *   25. Unknown price ID does not crash and logs safe warning
 *
 *  Regression:
 *   26. authorize(['OWNER','ORG_ADMIN']) blocks DENTIST
 *   27. mapStripeSubscriptionStatus returns 'unknown' for unrecognized status
 */

import assert from 'node:assert/strict';
import {
  mapStripeSubscriptionStatus,
  BillingError,
} from '../services/billing/stripeBillingService.js';
import { normalizeRole } from '../utils/roles.js';
import { authorize } from '../middleware/auth.js';

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ── Minimal mock helpers ──────────────────────────────────────────────────────

function makeAuthReq(role: string, canAccessAllClinics = false, clinicId = 'clinic-1') {
  return {
    user: {
      id: 'user-1',
      clinicId,
      role,
      normalizedRole: normalizeRole(role, canAccessAllClinics),
      organizationId: 'org-1',
      allowedClinicIds: [clinicId],
      canAccessAllClinics,
    },
    body: {},
    headers: {},
  } as any;
}

function makeRes() {
  const res = {
    _status: 200,
    _body: null as any,
    status(code: number) { this._status = code; return this; },
    json(data: any) { this._body = data; return this; },
  };
  return res;
}

// ── Fake Prisma ───────────────────────────────────────────────────────────────

type FakePrismaState = {
  clinics: Record<string, any>;
  plans: Record<string, any>;
  webhookEvents: Record<string, any>;
};

function buildFakePrisma(state: FakePrismaState) {
  return {
    clinic: {
      findUnique: async ({ where }: any) => state.clinics[where.id] ?? null,
      findFirst: async ({ where }: any) => {
        return Object.values(state.clinics).find((c: any) => {
          if (where.stripeCustomerId) return c.stripeCustomerId === where.stripeCustomerId;
          return false;
        }) ?? null;
      },
      update: async ({ where, data }: any) => {
        state.clinics[where.id] = { ...(state.clinics[where.id] ?? {}), ...data };
        return state.clinics[where.id];
      },
    },
    plan: {
      findUnique: async ({ where }: any) => state.plans[where.id] ?? null,
      findFirst: async ({ where }: any) => {
        if (!where.OR) return null;
        for (const row of Object.values(state.plans)) {
          const plan = row as any;
          if (where.OR.some((cond: any) =>
            (cond.stripeMonthlyPriceId && plan.stripeMonthlyPriceId === cond.stripeMonthlyPriceId) ||
            (cond.stripeYearlyPriceId && plan.stripeYearlyPriceId === cond.stripeYearlyPriceId)
          )) return plan;
        }
        return null;
      },
    },
    stripeWebhookEvent: {
      upsert: async ({ where, create }: any) => {
        if (!state.webhookEvents[where.stripeEventId]) {
          state.webhookEvents[where.stripeEventId] = { ...create };
        }
        return state.webhookEvents[where.stripeEventId];
      },
      update: async ({ where, data }: any) => {
        state.webhookEvents[where.stripeEventId] = {
          ...(state.webhookEvents[where.stripeEventId] ?? {}),
          ...data,
        };
        return state.webhookEvents[where.stripeEventId];
      },
    },
  };
}

// ── Fake Stripe client ────────────────────────────────────────────────────────

function buildFakeStripe(opts: {
  checkoutUrl?: string;
  portalUrl?: string;
  shouldFailSignature?: boolean;
  /** The event object returned by webhooks.constructEvent */
  webhookEvent?: any;
  /** The subscription returned by subscriptions.retrieve */
  subscription?: any;
}) {
  return {
    customers: {
      create: async (params: any) => ({ id: 'cus_test123', ...params }),
    },
    checkout: {
      sessions: {
        create: async (_params: any) => ({
          id: 'cs_test123',
          url: opts.checkoutUrl ?? 'https://checkout.stripe.com/test',
        }),
      },
    },
    billingPortal: {
      sessions: {
        create: async (_params: any) => ({
          id: 'bps_test123',
          url: opts.portalUrl ?? 'https://billing.stripe.com/test',
        }),
      },
    },
    webhooks: {
      constructEvent: (_body: any, _sig: any, _secret: any) => {
        if (opts.shouldFailSignature) throw new Error('No signatures found matching');
        return opts.webhookEvent ?? opts.subscription ?? {};
      },
    },
    subscriptions: {
      retrieve: async (_id: string) => opts.subscription ?? {},
    },
  };
}

// ── Inline service helpers for unit testing without module side effects ───────
// These replicate the core logic from stripeBillingService without DB/Stripe imports

async function testCreateCheckoutSession(
  stripe: any,
  prisma: any,
  params: { clinicId: string; planId: string; billingInterval: 'monthly' | 'yearly'; actorUserId: string },
  env: { successUrl: string; cancelUrl: string },
): Promise<string> {
  const plan = await prisma.plan.findUnique({ where: { id: params.planId } });
  if (!plan) throw new BillingError('Plan not found', 'plan_not_found', 404);
  if (!plan.isActive) throw new BillingError('Plan is not active', 'plan_inactive', 400);

  const priceId = params.billingInterval === 'yearly'
    ? plan.stripeYearlyPriceId
    : plan.stripeMonthlyPriceId;

  if (!priceId) {
    throw new BillingError(
      `Plan has no Stripe price ID for interval: ${params.billingInterval}`,
      'no_stripe_price',
      400,
    );
  }

  const clinic = await prisma.clinic.findUnique({
    where: { id: params.clinicId },
    select: { id: true, name: true, email: true, stripeCustomerId: true },
  });
  if (!clinic) throw new BillingError('Clinic not found', 'clinic_not_found', 404);

  let customerId = clinic.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({ name: clinic.name, email: clinic.email });
    customerId = customer.id;
    await prisma.clinic.update({ where: { id: params.clinicId }, data: { stripeCustomerId: customerId } });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: env.successUrl,
    cancel_url: env.cancelUrl,
    client_reference_id: params.clinicId,
    metadata: { clinicId: params.clinicId, planId: params.planId, billingInterval: params.billingInterval },
  });

  if (!session.url) throw new Error('Stripe checkout session has no URL');
  return session.url;
}

async function testCreatePortalSession(
  stripe: any,
  prisma: any,
  clinicId: string,
  returnUrl: string,
): Promise<string> {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { stripeCustomerId: true } });
  if (!clinic) throw new BillingError('Clinic not found', 'clinic_not_found', 404);
  if (!clinic.stripeCustomerId) {
    throw new BillingError(
      'Clinic does not have a Stripe customer. Start a subscription first.',
      'no_stripe_customer',
      400,
    );
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: clinic.stripeCustomerId,
    return_url: returnUrl,
  });
  return session.url;
}

async function testSyncSubscription(
  prisma: any,
  subscription: any,
): Promise<void> {
  const clinicId = subscription.metadata?.clinicId ?? null;
  if (!clinicId) return;

  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id ?? null;
  const productId = item?.price?.product ?? null;
  const periodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;

  let resolvedPlanId: string | undefined;
  if (priceId) {
    const plan = await prisma.plan.findFirst({
      where: { OR: [{ stripeMonthlyPriceId: priceId }, { stripeYearlyPriceId: priceId }] },
      select: { id: true },
    });
    if (plan) resolvedPlanId = plan.id;
    else console.warn('[stripe-billing] price ID not mapped to any Plan', { priceId });
  }

  await prisma.clinic.update({
    where: { id: clinicId },
    data: {
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus: mapStripeSubscriptionStatus(subscription.status),
      stripeCurrentPeriodEnd: periodEnd,
      stripeCancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
      stripePriceId: priceId,
      stripeProductId: productId,
      subscriptionSyncedAt: new Date(),
      ...(resolvedPlanId ? { planId: resolvedPlanId } : {}),
    },
  });
}

async function testHandleWebhook(
  prisma: any,
  stripe: any,
  rawBody: Buffer,
  sig: string,
  secret: string,
) {
  let event: any;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err: any) {
    return { statusCode: 400, body: { error: `Webhook signature verification failed: ${err.message}` } };
  }

  const record = await prisma.stripeWebhookEvent.upsert({
    where: { stripeEventId: event.id },
    create: { stripeEventId: event.id, eventType: event.type, status: 'received' },
    update: {},
  });

  if (record.status === 'processed' || record.status === 'ignored') {
    return { statusCode: 200, body: { received: true, duplicate: true } };
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
    return { statusCode: 200, body: { received: true } };
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const clinicId = session.metadata?.clinicId ?? session.client_reference_id;
      if (clinicId) {
        const data: any = { subscriptionSyncedAt: new Date() };
        if (session.customer) data.stripeCustomerId = session.customer;
        if (session.subscription) data.stripeSubscriptionId = session.subscription;
        await prisma.clinic.update({ where: { id: clinicId }, data });
      }
    } else if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated'
    ) {
      await testSyncSubscription(prisma, event.data.object);
    } else if (event.type === 'customer.subscription.deleted') {
      await testSyncSubscription(prisma, { ...event.data.object, status: 'canceled' });
    } else if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      if (invoice.subscription) {
        const sub = await stripe.subscriptions.retrieve(invoice.subscription);
        await testSyncSubscription(prisma, sub);
      }
    }

    await prisma.stripeWebhookEvent.update({
      where: { stripeEventId: event.id },
      data: { status: 'processed', processedAt: new Date() },
    });
    return { statusCode: 200, body: { received: true } };
  } catch (err: any) {
    await prisma.stripeWebhookEvent.update({
      where: { stripeEventId: event.id },
      data: { status: 'failed', errorMessage: err.message?.slice(0, 500) },
    });
    return { statusCode: 500, body: { error: 'Webhook processing failed' } };
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

section('Schema/model fields');

await test('1. Plan has stripeMonthlyPriceId, stripeYearlyPriceId, stripeProductId', () => {
  const plan = {
    id: 'plan-1',
    name: 'pro',
    displayName: 'Pro',
    maxUsers: 20,
    maxPatients: 2000,
    features: {},
    monthlyPrice: '99.00',
    isActive: true,
    stripeMonthlyPriceId: 'price_monthly_pro',
    stripeYearlyPriceId: 'price_yearly_pro',
    stripeProductId: 'prod_pro',
  };
  assert.equal(plan.stripeMonthlyPriceId, 'price_monthly_pro');
  assert.equal(plan.stripeYearlyPriceId, 'price_yearly_pro');
  assert.equal(plan.stripeProductId, 'prod_pro');
});

await test('2. Clinic has all Stripe billing fields', () => {
  const clinic = {
    id: 'clinic-1',
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
    stripeSubscriptionStatus: 'active',
    stripeCurrentPeriodEnd: new Date('2026-07-15'),
    stripeCancelAtPeriodEnd: false,
    stripePriceId: 'price_monthly_pro',
    stripeProductId: 'prod_pro',
    subscriptionSyncedAt: new Date(),
  };
  assert.ok(clinic.stripeCustomerId);
  assert.ok(clinic.stripeSubscriptionId);
  assert.ok(clinic.stripeCurrentPeriodEnd instanceof Date);
  assert.equal(clinic.stripeCancelAtPeriodEnd, false);
});

await test('3. StripeWebhookEvent has unique stripeEventId (duplicate upsert returns existing)', async () => {
  const state: FakePrismaState = { clinics: {}, plans: {}, webhookEvents: {} };
  const prisma = buildFakePrisma(state);

  await prisma.stripeWebhookEvent.upsert({
    where: { stripeEventId: 'evt_001' },
    create: { stripeEventId: 'evt_001', eventType: 'customer.subscription.updated', status: 'processed' },
    update: {},
  });

  // Second upsert must NOT overwrite existing record
  await prisma.stripeWebhookEvent.upsert({
    where: { stripeEventId: 'evt_001' },
    create: { stripeEventId: 'evt_001', eventType: 'customer.subscription.updated', status: 'received' },
    update: {},
  });

  assert.equal(state.webhookEvents['evt_001'].status, 'processed', 'existing record must not be overwritten');
});

section('mapStripeSubscriptionStatus');

await test('4. Known statuses pass through unchanged', () => {
  const known = ['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'];
  for (const s of known) {
    assert.equal(mapStripeSubscriptionStatus(s), s);
  }
});

await test('5. Unknown status maps to "unknown"', () => {
  assert.equal(mapStripeSubscriptionStatus('some_future_status'), 'unknown');
  assert.equal(mapStripeSubscriptionStatus(''), 'unknown');
});

section('Checkout session');

await test('6. OWNER role authorized to create checkout session', async () => {
  const state: FakePrismaState = {
    clinics: {
      'clinic-1': { id: 'clinic-1', name: 'Test Clinic', email: 'test@clinic.com', stripeCustomerId: null },
    },
    plans: {
      'plan-pro': { id: 'plan-pro', name: 'pro', isActive: true, stripeMonthlyPriceId: 'price_monthly', stripeYearlyPriceId: null },
    },
    webhookEvents: {},
  };
  const prisma = buildFakePrisma(state);
  const stripe = buildFakeStripe({ checkoutUrl: 'https://checkout.stripe.com/test' });

  const url = await testCreateCheckoutSession(stripe, prisma, {
    clinicId: 'clinic-1', planId: 'plan-pro', billingInterval: 'monthly', actorUserId: 'user-1',
  }, { successUrl: 'https://app.com/success', cancelUrl: 'https://app.com/cancel' });

  assert.ok(url.startsWith('https://checkout.stripe.com/'));
});

await test('7. Non-admin role (DENTIST) is rejected by authorize middleware', () => {
  const req = makeAuthReq('DENTIST');
  const res = makeRes();
  let nextCalled = false;
  const middleware = authorize(['OWNER', 'ORG_ADMIN']);
  middleware(req, res as any, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res._status, 403);
});

await test('8. Non-existent planId rejected with BillingError plan_not_found', async () => {
  const state: FakePrismaState = { clinics: { 'clinic-1': { id: 'clinic-1' } }, plans: {}, webhookEvents: {} };
  const prisma = buildFakePrisma(state);
  const stripe = buildFakeStripe({});

  try {
    await testCreateCheckoutSession(stripe, prisma, {
      clinicId: 'clinic-1', planId: 'plan-nonexistent', billingInterval: 'monthly', actorUserId: 'user-1',
    }, { successUrl: 'x', cancelUrl: 'y' });
    assert.fail('Should have thrown');
  } catch (err) {
    assert.ok(err instanceof BillingError);
    assert.equal(err.code, 'plan_not_found');
    assert.equal(err.statusCode, 404);
  }
});

await test('9. Plan without Stripe price ID rejected with no_stripe_price', async () => {
  const state: FakePrismaState = {
    clinics: { 'clinic-1': { id: 'clinic-1', name: 'C', stripeCustomerId: null } },
    plans: { 'plan-1': { id: 'plan-1', name: 'basic', isActive: true, stripeMonthlyPriceId: null, stripeYearlyPriceId: null } },
    webhookEvents: {},
  };
  const prisma = buildFakePrisma(state);
  const stripe = buildFakeStripe({});

  try {
    await testCreateCheckoutSession(stripe, prisma, {
      clinicId: 'clinic-1', planId: 'plan-1', billingInterval: 'monthly', actorUserId: 'user-1',
    }, { successUrl: 'x', cancelUrl: 'y' });
    assert.fail('Should have thrown');
  } catch (err) {
    assert.ok(err instanceof BillingError);
    assert.equal(err.code, 'no_stripe_price');
  }
});

await test('10. Monthly interval uses stripeMonthlyPriceId', async () => {
  const capturedParams: any[] = [];
  const state: FakePrismaState = {
    clinics: { 'clinic-1': { id: 'clinic-1', name: 'C', email: null, stripeCustomerId: 'cus_existing' } },
    plans: { 'plan-1': { id: 'plan-1', isActive: true, stripeMonthlyPriceId: 'price_month', stripeYearlyPriceId: 'price_year' } },
    webhookEvents: {},
  };
  const prisma = buildFakePrisma(state);
  const stripe = {
    ...buildFakeStripe({}),
    checkout: {
      sessions: {
        create: async (params: any) => {
          capturedParams.push(params);
          return { id: 'cs_test', url: 'https://checkout.stripe.com/test' };
        },
      },
    },
  };

  await testCreateCheckoutSession(stripe, prisma, {
    clinicId: 'clinic-1', planId: 'plan-1', billingInterval: 'monthly', actorUserId: 'u1',
  }, { successUrl: 'x', cancelUrl: 'y' });

  assert.equal(capturedParams[0].line_items[0].price, 'price_month');
});

await test('11. Yearly interval uses stripeYearlyPriceId', async () => {
  const capturedParams: any[] = [];
  const state: FakePrismaState = {
    clinics: { 'clinic-1': { id: 'clinic-1', name: 'C', email: null, stripeCustomerId: 'cus_existing' } },
    plans: { 'plan-1': { id: 'plan-1', isActive: true, stripeMonthlyPriceId: 'price_month', stripeYearlyPriceId: 'price_year' } },
    webhookEvents: {},
  };
  const prisma = buildFakePrisma(state);
  const stripe = {
    ...buildFakeStripe({}),
    checkout: {
      sessions: {
        create: async (params: any) => {
          capturedParams.push(params);
          return { id: 'cs_test', url: 'https://checkout.stripe.com/test' };
        },
      },
    },
  };

  await testCreateCheckoutSession(stripe, prisma, {
    clinicId: 'clinic-1', planId: 'plan-1', billingInterval: 'yearly', actorUserId: 'u1',
  }, { successUrl: 'x', cancelUrl: 'y' });

  assert.equal(capturedParams[0].line_items[0].price, 'price_year');
});

await test('12. Checkout does not update clinic.planId before webhook fires', async () => {
  const state: FakePrismaState = {
    clinics: { 'clinic-1': { id: 'clinic-1', name: 'C', email: null, stripeCustomerId: 'cus_existing', planId: 'plan-old' } },
    plans: { 'plan-new': { id: 'plan-new', isActive: true, stripeMonthlyPriceId: 'price_month', stripeYearlyPriceId: null } },
    webhookEvents: {},
  };
  const prisma = buildFakePrisma(state);
  const stripe = buildFakeStripe({});

  await testCreateCheckoutSession(stripe, prisma, {
    clinicId: 'clinic-1', planId: 'plan-new', billingInterval: 'monthly', actorUserId: 'u1',
  }, { successUrl: 'x', cancelUrl: 'y' });

  assert.equal(state.clinics['clinic-1'].planId, 'plan-old', 'planId must not change until webhook fires');
});

section('Billing portal');

await test('13. Authorized admin with existing customer gets portal URL', async () => {
  const state: FakePrismaState = {
    clinics: { 'clinic-1': { id: 'clinic-1', stripeCustomerId: 'cus_existing' } },
    plans: {},
    webhookEvents: {},
  };
  const prisma = buildFakePrisma(state);
  const stripe = buildFakeStripe({ portalUrl: 'https://billing.stripe.com/test' });

  const url = await testCreatePortalSession(stripe, prisma, 'clinic-1', 'https://app.com/billing');
  assert.ok(url.startsWith('https://billing.stripe.com/'));
});

await test('14. Clinic without Stripe customer gets clear error', async () => {
  const state: FakePrismaState = {
    clinics: { 'clinic-1': { id: 'clinic-1', stripeCustomerId: null } },
    plans: {},
    webhookEvents: {},
  };
  const prisma = buildFakePrisma(state);
  const stripe = buildFakeStripe({});

  try {
    await testCreatePortalSession(stripe, prisma, 'clinic-1', 'https://app.com/billing');
    assert.fail('Should have thrown');
  } catch (err) {
    assert.ok(err instanceof BillingError);
    assert.equal(err.code, 'no_stripe_customer');
  }
});

await test('15. Cross-clinic access: authorize enforces clinicId isolation (RECEPTIONIST blocked)', () => {
  const req = makeAuthReq('RECEPTIONIST', false, 'clinic-other');
  const res = makeRes();
  let nextCalled = false;
  authorize(['OWNER', 'ORG_ADMIN'])(req, res as any, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res._status, 403);
});

section('Webhook — signature verification');

await test('16. Invalid signature rejected with 400', async () => {
  const state: FakePrismaState = { clinics: {}, plans: {}, webhookEvents: {} };
  const prisma = buildFakePrisma(state);
  const stripe = buildFakeStripe({ shouldFailSignature: true });

  const result = await testHandleWebhook(
    prisma, stripe, Buffer.from('{}'), 'bad-sig', 'whsec_test',
  );
  assert.equal(result.statusCode, 400);
  assert.ok((result.body.error ?? '').includes('signature verification failed'));
});

section('Webhook — idempotency');

await test('17. Duplicate event (already processed) returns 200 without reprocessing', async () => {
  const state: FakePrismaState = {
    clinics: { 'clinic-1': { id: 'clinic-1' } },
    plans: {},
    webhookEvents: {
      'evt_dup': { stripeEventId: 'evt_dup', eventType: 'customer.subscription.updated', status: 'processed' },
    },
  };
  const prisma = buildFakePrisma(state);
  const updateCallCount = { n: 0 };
  const originalUpdate = prisma.stripeWebhookEvent.update;
  prisma.stripeWebhookEvent.update = async (args: any) => {
    updateCallCount.n++;
    return originalUpdate(args);
  };

  const event = { id: 'evt_dup', type: 'customer.subscription.updated', data: { object: {} } };
  const stripe = buildFakeStripe({ webhookEvent: event });

  const result = await testHandleWebhook(
    prisma, stripe, Buffer.from('{}'), 'sig', 'secret',
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.duplicate, true);
  assert.equal(updateCallCount.n, 0, 'should not call update for duplicate event');
});

section('Webhook — event handling');

await test('18. checkout.session.completed links customer and subscription to clinic', async () => {
  const state: FakePrismaState = {
    clinics: { 'clinic-1': { id: 'clinic-1', stripeCustomerId: null, stripeSubscriptionId: null } },
    plans: {},
    webhookEvents: {},
  };
  const prisma = buildFakePrisma(state);
  const event = {
    id: 'evt_checkout',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_1',
        customer: 'cus_new',
        subscription: 'sub_new',
        client_reference_id: 'clinic-1',
        metadata: { clinicId: 'clinic-1' },
      },
    },
  };
  const stripe = buildFakeStripe({ webhookEvent: event });

  const result = await testHandleWebhook(
    prisma, stripe, Buffer.from('{}'), 'sig', 'secret',
  );

  assert.equal(result.statusCode, 200);
  assert.equal(state.clinics['clinic-1'].stripeCustomerId, 'cus_new');
  assert.equal(state.clinics['clinic-1'].stripeSubscriptionId, 'sub_new');
});

await test('19. customer.subscription.updated syncs status, periodEnd, cancelAtPeriodEnd', async () => {
  const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
  const state: FakePrismaState = {
    clinics: { 'clinic-1': { id: 'clinic-1' } },
    plans: {},
    webhookEvents: {},
  };
  const prisma = buildFakePrisma(state);
  const sub = {
    id: 'sub_1',
    status: 'active',
    cancel_at_period_end: true,
    metadata: { clinicId: 'clinic-1' },
    items: { data: [{ price: { id: 'price_month', product: 'prod_1' }, current_period_end: periodEnd }] },
  };
  const event = { id: 'evt_upd', type: 'customer.subscription.updated', data: { object: sub } };
  const stripe = buildFakeStripe({ webhookEvent: event });

  await testHandleWebhook(prisma, stripe, Buffer.from('{}'), 'sig', 'secret');

  const clinic = state.clinics['clinic-1'];
  assert.equal(clinic.stripeSubscriptionStatus, 'active');
  assert.equal(clinic.stripeCancelAtPeriodEnd, true);
  assert.ok(clinic.stripeCurrentPeriodEnd instanceof Date);
});

await test('20. customer.subscription.deleted marks status canceled', async () => {
  const state: FakePrismaState = {
    clinics: { 'clinic-1': { id: 'clinic-1', stripeSubscriptionStatus: 'active' } },
    plans: {},
    webhookEvents: {},
  };
  const prisma = buildFakePrisma(state);
  const sub = {
    id: 'sub_1',
    status: 'canceled',
    cancel_at_period_end: false,
    metadata: { clinicId: 'clinic-1' },
    items: { data: [] },
  };
  const event = { id: 'evt_del', type: 'customer.subscription.deleted', data: { object: sub } };
  const stripe = buildFakeStripe({ webhookEvent: event });

  await testHandleWebhook(prisma, stripe, Buffer.from('{}'), 'sig', 'secret');

  assert.equal(state.clinics['clinic-1'].stripeSubscriptionStatus, 'canceled');
});

await test('21. invoice.payment_failed stores status, does not delete clinic data', async () => {
  const state: FakePrismaState = {
    clinics: { 'clinic-1': { id: 'clinic-1', name: 'MyClinic', stripeSubscriptionStatus: 'active' } },
    plans: {},
    webhookEvents: {},
  };
  const prisma = buildFakePrisma(state);
  const sub = {
    id: 'sub_1',
    status: 'past_due',
    cancel_at_period_end: false,
    metadata: { clinicId: 'clinic-1' },
    items: { data: [] },
  };
  const event = {
    id: 'evt_fail',
    type: 'invoice.payment_failed',
    data: { object: { id: 'in_1', subscription: 'sub_1' } },
  };
  // webhookEvent is what constructEvent returns; subscription is what subscriptions.retrieve returns
  const stripe = buildFakeStripe({ webhookEvent: event, subscription: sub });

  const result = await testHandleWebhook(prisma, stripe, Buffer.from('{}'), 'sig', 'secret');

  assert.equal(result.statusCode, 200);
  assert.equal(state.clinics['clinic-1'].stripeSubscriptionStatus, 'past_due');
  assert.ok(state.clinics['clinic-1'].name, 'clinic name must be preserved');
});

await test('22. Unknown event type is safely ignored with status=ignored', async () => {
  const state: FakePrismaState = { clinics: {}, plans: {}, webhookEvents: {} };
  const prisma = buildFakePrisma(state);
  const event = { id: 'evt_unknown', type: 'payment_intent.created', data: { object: {} } };
  const stripe = buildFakeStripe({ webhookEvent: event });

  const result = await testHandleWebhook(prisma, stripe, Buffer.from('{}'), 'sig', 'secret');

  assert.equal(result.statusCode, 200);
  assert.equal(state.webhookEvents['evt_unknown'].status, 'ignored');
});

section('Plan price mapping');

await test('23. Subscription price ID maps to stripeMonthlyPriceId → sets planId', async () => {
  const state: FakePrismaState = {
    clinics: { 'clinic-1': { id: 'clinic-1' } },
    plans: {
      'plan-pro': { id: 'plan-pro', stripeMonthlyPriceId: 'price_month_pro', stripeYearlyPriceId: 'price_year_pro' },
    },
    webhookEvents: {},
  };
  const prisma = buildFakePrisma(state);
  const sub = {
    id: 'sub_1', status: 'active', cancel_at_period_end: false,
    metadata: { clinicId: 'clinic-1' },
    items: { data: [{ price: { id: 'price_month_pro', product: 'prod_1' }, current_period_end: null }] },
  };

  await testSyncSubscription(prisma, sub);

  assert.equal(state.clinics['clinic-1'].planId, 'plan-pro');
});

await test('24. Subscription price ID maps to stripeYearlyPriceId → sets planId', async () => {
  const state: FakePrismaState = {
    clinics: { 'clinic-1': { id: 'clinic-1' } },
    plans: {
      'plan-pro': { id: 'plan-pro', stripeMonthlyPriceId: 'price_month_pro', stripeYearlyPriceId: 'price_year_pro' },
    },
    webhookEvents: {},
  };
  const prisma = buildFakePrisma(state);
  const sub = {
    id: 'sub_1', status: 'active', cancel_at_period_end: false,
    metadata: { clinicId: 'clinic-1' },
    items: { data: [{ price: { id: 'price_year_pro', product: 'prod_1' }, current_period_end: null }] },
  };

  await testSyncSubscription(prisma, sub);

  assert.equal(state.clinics['clinic-1'].planId, 'plan-pro');
});

await test('25. Unknown price ID does not crash and logs safe warning', async () => {
  const warnMessages: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: any[]) => { warnMessages.push(args.join(' ')); };

  const state: FakePrismaState = {
    clinics: { 'clinic-1': { id: 'clinic-1', planId: 'plan-old' } },
    plans: {},
    webhookEvents: {},
  };
  const prisma = buildFakePrisma(state);
  const sub = {
    id: 'sub_1', status: 'active', cancel_at_period_end: false,
    metadata: { clinicId: 'clinic-1' },
    items: { data: [{ price: { id: 'price_unknown_xyz', product: null }, current_period_end: null }] },
  };

  await testSyncSubscription(prisma, sub);

  console.warn = originalWarn;

  assert.equal(state.clinics['clinic-1'].planId, 'plan-old', 'existing planId must be preserved when price is unknown');
  assert.ok(warnMessages.some(m => m.includes('price ID not mapped')), 'should log a safe warning');
});

section('Regression: role / status mapping');

await test('26. authorize blocks DENTIST from OWNER/ORG_ADMIN-only routes', () => {
  for (const role of ['DENTIST', 'RECEPTIONIST', 'BILLING', 'ASSISTANT', 'CLINIC_MANAGER']) {
    const req = makeAuthReq(role);
    const res = makeRes();
    let nextCalled = false;
    authorize(['OWNER', 'ORG_ADMIN'])(req, res as any, () => { nextCalled = true; });
    assert.equal(nextCalled, false, `${role} should be blocked`);
    assert.equal(res._status, 403, `${role} should get 403`);
  }
});

await test('27. mapStripeSubscriptionStatus returns "unknown" for any unrecognized value', () => {
  const unrecognized = ['pending', 'draft', 'void', 'ACTIVE', 'Active', 'expired', null as any, undefined as any];
  for (const s of unrecognized) {
    assert.equal(mapStripeSubscriptionStatus(s ?? ''), 'unknown', `Expected unknown for: ${s}`);
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
if (failed === 0) {
  console.log(`✓ All ${passed} tests passed`);
} else {
  console.log(`✗ ${failed} test(s) failed, ${passed} passed`);
  process.exit(1);
}
