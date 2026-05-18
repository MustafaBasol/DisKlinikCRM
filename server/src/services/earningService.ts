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
 * Called after a TreatmentCase is moved to stage 'completed'.
 * Generates a PractitionerEarning for the practitioner
 * if their calculationBase = 'billed'.
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

  // Idempotency: don't double-generate for the same treatment case with billed base
  const exists = await prisma.practitionerEarning.findFirst({
    where: { treatmentCaseId, clinicId, calculationBase: 'billed' },
  });
  if (exists) return;

  const grossAmount = tc.acceptedAmount ?? tc.estimatedAmount ?? 0;
  if (grossAmount <= 0) return;

  const now = new Date();
  const { earningAmount, percentageApplied, fixedAmountApplied } = calcEarning(grossAmount, ruleResult);

  if (earningAmount <= 0 && !fixedAmountApplied) return;

  const earning = await prisma.practitionerEarning.create({
    data: {
      clinicId,
      practitionerId,
      patientId: tc.patientId,
      treatmentCaseId,
      serviceId,
      grossAmount,
      collectedAmount: 0,
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
    description: `Earning of ${earningAmount.toFixed(2)} generated for practitioner from treatment case completion`,
    patientId: tc.patientId,
    treatmentCaseId,
  });
}
