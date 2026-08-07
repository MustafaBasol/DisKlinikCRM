/**
 * organizationAppointmentMetrics.ts — Appointment domain's public read contract
 * for the organization dashboard (F2-ORG-DASH-METRICS-CONTRACT).
 *
 * Extracted from server/src/routes/organizationDashboard.ts, which read
 * `prisma.appointment` directly (a cross-domain access — organizationDashboard
 * is owned by core-org-clinic-membership per ADR-F2-ORG-DASH-OWNERSHIP, while
 * Appointment is owned by clinical-appointments-availability). This module is
 * the accepted target-end-state (ADR Option D) contract closing that gap for
 * the appointment metric family.
 *
 * Contract properties (per the F2-GUARDRAIL-PREP-010-C reference template):
 * - Owner domain: clinical-appointments-availability (owns the Appointment model).
 * - Tenant context: `clinicId` is a required, leading parameter. Callers must
 *   supply an already-authorized clinic id (e.g. from an organization-scoped,
 *   role-checked clinic list) — this function performs no authorization of
 *   its own and does not accept a raw request body/query clinic id.
 * - Output DTO: `OrganizationAppointmentMetrics`, a purpose-built aggregate —
 *   no Prisma `Appointment` record or field is returned.
 * - No raw Prisma leakage: every query is a `count()`; nothing is `select`ed.
 * - Audit ownership: none — pure read, no audit entry expected.
 * - Transaction ownership: none — five independent counts, no `$transaction`.
 * - Backward compatibility: additive; this is a new export with zero prior
 *   callers, so there is nothing to preserve compatibility with beyond the
 *   caller (organizationDashboard.ts) this task migrates.
 * - Rollback: delete this file and revert its one call site.
 */

import prisma from '../../db.js';

export interface OrganizationAppointmentMetricsRange {
  from: Date;
  to: Date;
}

export interface OrganizationAppointmentMetrics {
  todayAppointments: number;
  appointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  /** 0-1 decimal ratio (e.g. 0.057 = 5.7%), rounded to 3 decimals. */
  noShowRate: number;
}

export async function getOrganizationAppointmentMetrics(
  clinicId: string,
  range: OrganizationAppointmentMetricsRange
): Promise<OrganizationAppointmentMetrics> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const [todayAppointments, appointments, completedAppointments, cancelledAppointments, noShowCount] =
    await Promise.all([
      prisma.appointment.count({
        where: { clinicId, startTime: { gte: today, lt: tomorrow }, status: { not: 'cancelled' } },
      }),
      prisma.appointment.count({
        where: { clinicId, startTime: { gte: range.from, lte: range.to }, status: { not: 'cancelled' } },
      }),
      prisma.appointment.count({
        where: { clinicId, startTime: { gte: range.from, lte: range.to }, status: 'completed' },
      }),
      prisma.appointment.count({
        where: { clinicId, startTime: { gte: range.from, lte: range.to }, status: 'cancelled' },
      }),
      prisma.appointment.count({
        where: { clinicId, startTime: { gte: range.from, lte: range.to }, status: 'no_show' },
      }),
    ]);

  const noShowRate = appointments > 0 ? Math.round((noShowCount / appointments) * 1000) / 1000 : 0;

  return { todayAppointments, appointments, completedAppointments, cancelledAppointments, noShowRate };
}
