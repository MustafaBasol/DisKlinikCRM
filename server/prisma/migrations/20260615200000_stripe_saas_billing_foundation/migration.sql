-- Migration: stripe_saas_billing_foundation
-- Adds Stripe SaaS billing fields to Clinic and Plan, and the StripeWebhookEvent idempotency model.

-- Clinic: Stripe billing fields
ALTER TABLE "Clinic" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "Clinic" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "Clinic" ADD COLUMN "stripeSubscriptionStatus" TEXT;
ALTER TABLE "Clinic" ADD COLUMN "stripeCurrentPeriodEnd" TIMESTAMP(3);
ALTER TABLE "Clinic" ADD COLUMN "stripeCancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Clinic" ADD COLUMN "stripePriceId" TEXT;
ALTER TABLE "Clinic" ADD COLUMN "stripeProductId" TEXT;
ALTER TABLE "Clinic" ADD COLUMN "subscriptionSyncedAt" TIMESTAMP(3);

-- Plan: Stripe price mapping
ALTER TABLE "Plan" ADD COLUMN "stripeMonthlyPriceId" TEXT;
ALTER TABLE "Plan" ADD COLUMN "stripeYearlyPriceId" TEXT;
ALTER TABLE "Plan" ADD COLUMN "stripeProductId" TEXT;

-- StripeWebhookEvent: idempotency model
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StripeWebhookEvent_stripeEventId_key" ON "StripeWebhookEvent"("stripeEventId");
