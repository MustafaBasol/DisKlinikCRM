import prisma from '../db.js';
import { logActivity } from '../utils/activity.js';

/**
 * Looks up the compensation rule applicable for a practitioner + service combination.
 * Service-specific rules take precedence over the default practitioner rule.
 */
async function getApplicableRule(
  practitionerId: string,
  serviceId: string | null | undefined,
  clinicId: string,
) {
  if (serviceId) {
    const serviceRule = await prisma.serviceCompensationRule.findFirst({
      where: { practitionerId, serviceId, clinicId, isActive: true },
    });
    if (serviceRule) return { type: 'service' as const, rule: serviceRule };
  }

  const defaultRule = await prisma.practitionerCompensationRule.findFirst({
    where: { practitionerId, clinicId, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  return defaultRule ? { type: 'default' as const, rule: defaultRule } : null;
}

function calcEarning(
  amount: number,
  ruleResult: Awaited<ReturnType<typeof getApplicableRule>>,
): { earningAmount: number; percentageApplied: number | null; fixedAmountApplied: number | null } {
  if (!ruleResult) return { earningAmount: 0, percentageApplied: null, fixedAmountApplied: null };

  const { type, rule } = ruleResult;

  if (type === 'service') {
    const sr = rule as any;
    if (sr.percentage) {
      return { earningAmount: amount * (sr.percentage / 100), percentageApplied: sr.percentage, fixedAmountApplied: null };
    }
    if (sr.fixedAmount) {
      return { earningAmount: sr.fixedAmount, percentageApplied: null, fixedAmountApplied: sr.fixedAmount };
    }
    return { earningAmount: 0, percentageApplied: null, fixedAmountApplied: null };
  }

  // Default rule
  const dr = rule as any;
  const compType: string = dr.compensationType || 'percentage';

  if (compType === 'percentage' && dr.defaultPercentage) {
    return { earningAmount: amount * (dr.defaultPercentage / 100), percentageApplied: dr.defaultPercentage, fixedAmountApplied: null };
  }
  if (compType === 'fixed_plus_percentage' && dr.defaultPercentage) {
    // Percentage portion only; fixed monthly portion is generated separately by monthly job
    return { earningAmount: amount * (dr.defaultPercentage / 100), percentageApplied: dr.defaultPercentage, fixedAmountApplied: null };
  }
  // 'fixed' and 'per_service' (without service rule) skip per-payment earning
  return { earningAmount: 0, percentageApplied: null, fixedAmountApplied: null };
}

/**
 * Called after a Payment is marked as 'paid'.
 * Generates a PractitionerEarning for the treatment case's practitioner
 * if their calculationBase = 'collected'.
 */
export async function generateEarningFromPayment(
  paymentId: string,
  clinicId: string,
  actingUserId: string,
) {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, clinicId },
    include: { treatmentCase: { select: { id: true, practitionerId: true, appointmentTypeId: true, patientId: true } } },
  });

  if (!payment || !payment.treatmentCase?.practitionerId) return;

  const { treatmentCase } = payment;
  const practitionerId = treatmentCase.practitionerId as string;
  const serviceId = treatmentCase.appointmentTypeId ?? null;

  const ruleResult = await getApplicableRule(practitionerId, serviceId, clinicId);
  if (!ruleResult) return;

  const dr = ruleResult.rule as any;
  const calculationBase: string = dr.calculationBase ?? 'collected';
  if (calculationBase !== 'collected') return;

  // Idempotency: don't double-generate for the same payment
  const exists = await prisma.practitionerEarning.findFirst({ where: { paymentId, clinicId } });
  if (exists) return;

  const paidAt = payment.paidAt ?? new Date();
  const periodMonth = paidAt.getMonth() + 1;
  const periodYear = paidAt.getFullYear();

  const { earningAmount, percentageApplied, fixedAmountApplied } = calcEarning(payment.amount, ruleResult);

  if (earningAmount <= 0 && !fixedAmountApplied) return;

  const earning = await prisma.practitionerEarning.create({
    data: {
      clinicId,
      practitionerId,
      patientId: payment.patientId,
      treatmentCaseId: treatmentCase.id,
      paymentId: payment.id,
      serviceId,
      grossAmount: payment.amount,
      collectedAmount: payment.amount,
      earningAmount,
      calculationBase: 'collected',
      percentageApplied,
      fixedAmountApplied,
      status: 'pending',
      periodMonth,
      periodYear,
    },
  });

  // Also update the billed-base earning's collectedAmount for this treatment case (if any)
  const billedEarning = await prisma.practitionerEarning.findFirst({
    where: { treatmentCaseId: treatmentCase.id, clinicId, calculationBase: 'billed' },
  });
  if (billedEarning) {
    const paymentsAgg = await prisma.payment.aggregate({
      where: { treatmentCaseId: treatmentCase.id, clinicId, paymentStatus: 'paid', deletedAt: null },
      _sum: { amount: true },
    });
    await prisma.practitionerEarning.update({
      where: { id: billedEarning.id },
      data: { collectedAmount: paymentsAgg._sum.amount ?? 0 },
    });
  }

  await logActivity({
    clinicId,
    userId: actingUserId,
    entityType: 'practitioner_earning',
    entityId: earning.id,
    action: 'generated',
    description: `Earning of ${earningAmount.toFixed(2)} generated for practitioner from payment`,
    patientId: payment.patientId,
    treatmentCaseId: treatmentCase.id,
  });
}

/**
 * Called after a TreatmentCase has a known cost (create, update, or completed).
 * Generates or updates a PractitionerEarning for billed-base practitioners.
 */
export async function generateEarningFromTreatmentCase(
  treatmentCaseId: string,
  clinicId: string,
  actingUserId: string,
) {
  const tc = await prisma.treatmentCase.findFirst({
    where: { id: treatmentCaseId, clinicId },
  });

  if (!tc?.practitionerId) return;

  const practitionerId = tc.practitionerId;
  const serviceId = tc.appointmentTypeId ?? null;

  const ruleResult = await getApplicableRule(practitionerId, serviceId, clinicId);
  if (!ruleResult) return;

  const dr = ruleResult.rule as any;
  const calculationBase: string = dr.calculationBase ?? 'collected';
  if (calculationBase !== 'billed') return;

  const grossAmount = tc.acceptedAmount ?? tc.estimatedAmount ?? 0;
  if (grossAmount <= 0) return;

  const { earningAmount, percentageApplied, fixedAmountApplied } = calcEarning(grossAmount, ruleResult);
  if (earningAmount <= 0 && !fixedAmountApplied) return;

  // Count collected payments for this treatment case
  const paymentsAgg = await prisma.payment.aggregate({
    where: { treatmentCaseId, clinicId, paymentStatus: 'paid', deletedAt: null },
    _sum: { amount: true },
  });
  const collectedAmount = paymentsAgg._sum.amount ?? 0;

  const existing = await prisma.practitionerEarning.findFirst({
    where: { treatmentCaseId, clinicId, calculationBase: 'billed' },
  });

  if (existing) {
    // Update if gross amount or collected amount changed
    if (existing.grossAmount !== grossAmount || existing.collectedAmount !== collectedAmount || existing.earningAmount !== earningAmount) {
      await prisma.practitionerEarning.update({
        where: { id: existing.id },
        data: { grossAmount, earningAmount, percentageApplied, fixedAmountApplied, collectedAmount },
      });
    }
    return;
  }

  const now = new Date();
  const earning = await prisma.practitionerEarning.create({
    data: {
      clinicId,
      practitionerId,
      patientId: tc.patientId,
      treatmentCaseId,
      serviceId,
      grossAmount,
      collectedAmount,
      earningAmount,
      calculationBase: 'billed',
      percentageApplied,
      fixedAmountApplied,
      status: 'pending',
      periodMonth: now.getMonth() + 1,
      periodYear: now.getFullYear(),
    },
  });

  await logActivity({
    clinicId,
    userId: actingUserId,
    entityType: 'practitioner_earning',
    entityId: earning.id,
    action: 'generated',
    description: `Earning of ${earningAmount.toFixed(2)} generated for practitioner from treatment case cost`,
    patientId: tc.patientId,
    treatmentCaseId,
  });
}
