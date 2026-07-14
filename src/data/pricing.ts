export type BillingPeriod = 'monthly' | 'yearly';

export type PlanKey = 'starter' | 'professional' | 'enterprise';

export interface PricingPlanConfig {
  key: PlanKey;
  featureCount: number;
  highlighted: boolean;
  hasFixedPrice: boolean;
}

export const pricingPlans: PricingPlanConfig[] = [
  { key: 'starter', featureCount: 7, highlighted: false, hasFixedPrice: false },
  { key: 'professional', featureCount: 8, highlighted: true, hasFixedPrice: false },
  { key: 'enterprise', featureCount: 9, highlighted: false, hasFixedPrice: true },
];

/** Formats a whole-number TRY amount as "2.390 TL" (fixed grouping, independent of active UI locale). */
export const formatTRY = (amount: number): string => `${new Intl.NumberFormat('tr-TR').format(amount)} TL`;
