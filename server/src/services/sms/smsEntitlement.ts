/**
 * smsEntitlement.ts — SMS add-on activation and monthly quota accounting.
 *
 * SMS is DISABLED by default. A clinic can send SMS only when:
 *   - ClinicSmsSettings.addonEnabled === true (per-clinic add-on sale), or
 *   - the clinic's / organization's plan has features.sms === true.
 *
 * Note: this intentionally differs from requireFeature() in planLimits.ts,
 * which treats a missing feature key as allowed. For a paid add-on the key
 * must be explicitly true.
 *
 * Quota is reserved with a guarded atomic increment on SmsUsageCounter so
 * concurrent sends cannot exceed the monthly quota.
 */

import prisma from '../../db.js';

/** Default monthly quota when SMS comes from a plan feature without explicit clinic settings. */
const DEFAULT_PLAN_MONTHLY_QUOTA = Math.max(
  0,
  parseInt(process.env.SMS_DEFAULT_PLAN_MONTHLY_QUOTA ?? '100', 10) || 0,
);

export type SmsEntitlementSettings = {
  id: string;
  addonEnabled: boolean;
  monthlyQuota: number;
  senderName: string | null;
  turkeyProvider: string | null;
  turkeyProviderConfig: unknown;
  europeProvider: string | null;
  europeProviderConfig: unknown;
  turkeyAllowed: boolean;
  europeAllowed: boolean;
  routingPolicy: string;
};

/**
 * Normalized routing-relevant settings that are ALWAYS complete when SMS is
 * enabled, regardless of whether enablement comes from the paid clinic
 * add-on or a plan feature. Both the real send pipeline and the platform
 * admin preview endpoint must resolve routing from this object (never from
 * the raw `settings` row directly) so they can never diverge.
 */
export type EffectiveSmsRoutingSettings = {
  turkeyAllowed: boolean;
  europeAllowed: boolean;
  routingPolicy: string;
  turkeyProvider: string | null;
  turkeyProviderConfig: unknown;
  europeProvider: string | null;
  europeProviderConfig: unknown;
  senderName: string | null;
};

export type SmsEntitlement = {
  enabled: boolean;
  source: 'clinic_addon' | 'plan_feature' | null;
  monthlyQuota: number;
  /** Raw ClinicSmsSettings row, or null when the clinic never had one created. */
  settings: SmsEntitlementSettings | null;
  /**
   * Effective routing settings for resolveSmsRouting(). Non-null whenever
   * `enabled` is true. Plan-enabled clinics without an admin-managed
   * ClinicSmsSettings row (or with a stale addonEnabled=false row from
   * before the add-on was configured) default both destination regions to
   * allowed, preserving previously-working plan-granted SMS sending.
   */
  effective: EffectiveSmsRoutingSettings | null;
};

function planHasSmsFeature(features: unknown): boolean {
  return !!features && typeof features === 'object'
    && (features as Record<string, unknown>).sms === true;
}

/**
 * Build the effective routing settings for an entitled clinic.
 *
 * - clinic_addon: the ClinicSmsSettings row is admin-managed for the add-on,
 *   so its turkeyAllowed/europeAllowed/routingPolicy are used as-is.
 * - plan_feature: region flags on ClinicSmsSettings only carry real meaning
 *   once an admin has actively enabled the add-on (addonEnabled === true).
 *   Otherwise (row missing, or a stale/never-configured row with
 *   addonEnabled === false) default both regions to allowed so plan-granted
 *   SMS keeps working exactly as it did before routing policy existed.
 */
export function buildEffectiveSmsRoutingSettings(
  source: 'clinic_addon' | 'plan_feature',
  settings: SmsEntitlementSettings | null,
): EffectiveSmsRoutingSettings {
  const adminManaged = source === 'clinic_addon' || settings?.addonEnabled === true;
  if (settings && adminManaged) {
    return {
      turkeyAllowed: settings.turkeyAllowed,
      europeAllowed: settings.europeAllowed,
      routingPolicy: settings.routingPolicy,
      turkeyProvider: settings.turkeyProvider,
      turkeyProviderConfig: settings.turkeyProviderConfig,
      europeProvider: settings.europeProvider,
      europeProviderConfig: settings.europeProviderConfig,
      senderName: settings.senderName,
    };
  }
  return {
    turkeyAllowed: true,
    europeAllowed: true,
    routingPolicy: settings?.routingPolicy ?? 'automatic_by_recipient_phone_region',
    turkeyProvider: settings?.turkeyProvider ?? null,
    turkeyProviderConfig: settings?.turkeyProviderConfig ?? null,
    europeProvider: settings?.europeProvider ?? null,
    europeProviderConfig: settings?.europeProviderConfig ?? null,
    senderName: settings?.senderName ?? null,
  };
}

export async function getSmsEntitlement(clinicId: string): Promise<SmsEntitlement> {
  const [settings, clinic] = await Promise.all([
    prisma.clinicSmsSettings.findUnique({
      where: { clinicId },
      select: {
        id: true,
        addonEnabled: true,
        monthlyQuota: true,
        senderName: true,
        turkeyProvider: true,
        turkeyProviderConfig: true,
        europeProvider: true,
        europeProviderConfig: true,
        turkeyAllowed: true,
        europeAllowed: true,
        routingPolicy: true,
      },
    }),
    prisma.clinic.findUnique({
      where: { id: clinicId },
      select: {
        plan: { select: { features: true } },
        organization: { select: { plan: { select: { features: true } } } },
      },
    }),
  ]);

  const planEnabled =
    planHasSmsFeature(clinic?.organization?.plan?.features) ||
    planHasSmsFeature(clinic?.plan?.features);

  if (settings?.addonEnabled) {
    return {
      enabled: true, source: 'clinic_addon', monthlyQuota: settings.monthlyQuota, settings,
      effective: buildEffectiveSmsRoutingSettings('clinic_addon', settings),
    };
  }
  if (planEnabled) {
    return {
      enabled: true,
      source: 'plan_feature',
      monthlyQuota: settings?.monthlyQuota ?? DEFAULT_PLAN_MONTHLY_QUOTA,
      settings,
      effective: buildEffectiveSmsRoutingSettings('plan_feature', settings),
    };
  }
  return { enabled: false, source: null, monthlyQuota: 0, settings, effective: null };
}

/** Current usage period key, e.g. "2026-07" (UTC). */
export function currentSmsPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function getSmsMonthlyUsage(clinicId: string, period = currentSmsPeriod()): Promise<number> {
  const counter = await prisma.smsUsageCounter.findUnique({
    where: { clinicId_period: { clinicId, period } },
    select: { sentCount: true },
  });
  return counter?.sentCount ?? 0;
}

/**
 * Atomically reserve one quota slot. Returns true when a slot was reserved,
 * false when the quota is exhausted (or zero).
 */
export async function reserveSmsQuotaSlot(
  clinicId: string,
  monthlyQuota: number,
  period = currentSmsPeriod(),
): Promise<boolean> {
  if (monthlyQuota <= 0) return false;

  // Guarded increment: only succeeds while sentCount < quota.
  const updated = await prisma.smsUsageCounter.updateMany({
    where: { clinicId, period, sentCount: { lt: monthlyQuota } },
    data: { sentCount: { increment: 1 } },
  });
  if (updated.count === 1) return true;

  const existing = await prisma.smsUsageCounter.findUnique({
    where: { clinicId_period: { clinicId, period } },
    select: { id: true },
  });
  if (existing) return false; // Row exists but guard failed → quota exhausted

  try {
    await prisma.smsUsageCounter.create({ data: { clinicId, period, sentCount: 1 } });
    return true;
  } catch {
    // Unique violation → another request created the row concurrently; retry the guarded increment once.
    const retry = await prisma.smsUsageCounter.updateMany({
      where: { clinicId, period, sentCount: { lt: monthlyQuota } },
      data: { sentCount: { increment: 1 } },
    });
    return retry.count === 1;
  }
}

/** Best-effort release of a reserved slot when the provider send fails. */
export async function releaseSmsQuotaSlot(clinicId: string, period = currentSmsPeriod()): Promise<void> {
  await prisma.smsUsageCounter.updateMany({
    where: { clinicId, period, sentCount: { gt: 0 } },
    data: { sentCount: { decrement: 1 } },
  }).catch(() => { /* usage stats only — never block the caller */ });
}
