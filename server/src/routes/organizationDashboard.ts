/**
 * organizationDashboard.ts — Sprint 9: Advanced Metrics + Branch Performance Insights
 *
 * GET /api/organization/dashboard?range=this_month&from=...&to=...
 *
 * Yetki kuralları:
 * 1. Yalnızca OWNER veya ORG_ADMIN erişebilir.
 *    - Legacy "admin" + canAccessAllClinics=true → OWNER → erişim verilir.
 *    - Legacy "admin" + canAccessAllClinics=false → CLINIC_MANAGER → erişim REDDEDİLİR.
 * 2. Tüm sorgular organizationId ile scope edilir.
 * 3. canAccessOrganizationDashboard() ile çift katmanlı kontrol yapılır.
 *
 * Döndürülen metriklere eklenenler (Sprint 9):
 *  - completedAppointments, cancelledAppointments per branch
 *  - doctorCount per branch (DENTIST rolü)
 *  - totalPatients per branch (tüm zamanlar)
 *  - collectedPayments (revenue ile aynı, explicit)
 *  - activeClinics, completedTreatmentCases, collectedPayments özet metrikleri
 *  - lowestRevenueClinic içgörüsü
 *  - clinicSlug (frontend navigasyon için)
 */

import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { canAccessOrganizationDashboard } from '../utils/roles.js';
import { getDateRange } from '../utils/helpers.js';
import { getOrganizationAppointmentMetrics } from '../services/appointments/organizationAppointmentMetrics.js';
import { getOrganizationPatientMetrics } from '../services/patientOrganizationMetrics.js';
import { getOrganizationTreatmentCaseMetrics } from '../services/treatmentCaseOrganizationMetrics.js';
import { getOrganizationPaymentMetrics } from '../services/paymentOrganizationMetrics.js';

const router = express.Router();

const EMPTY_SUMMARY = {
  totalClinics: 0,
  activeClinics: 0,
  todayAppointments: 0,
  totalAppointments: 0,
  completedAppointments: 0,
  cancelledAppointments: 0,
  monthlyRevenue: 0,
  collectedPayments: 0,
  outstandingBalance: 0,
  newPatients: 0,
  activeTreatmentPlans: 0,
  completedTreatmentCases: 0,
  averageNoShowRate: 0,
  staffCount: 0,
};

// GET /api/organization/dashboard
router.get(
  '/organization/dashboard',
  authorize(['OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
    if (!canAccessOrganizationDashboard(req.user!)) {
      return res.status(403).json({ error: 'Organization dashboard requires organization-level access' });
    }

    const orgId = req.user!.organizationId;
    const { range = 'this_month', from: fromParam, to: toParam } = req.query;

    let dateRange: { from: Date; to: Date };
    try {
      dateRange = getDateRange(
        String(range),
        fromParam ? String(fromParam) : undefined,
        toParam ? String(toParam) : undefined
      );
    } catch {
      return res.status(400).json({ error: 'Invalid date range parameters' });
    }

    try {
      let scopeClinicIds: string[];
      if (req.user!.canAccessAllClinics) {
        const orgClinics = await prisma.clinic.findMany({
          where: { organizationId: orgId, status: { not: 'cancelled' } },
          select: { id: true },
        });
        scopeClinicIds = orgClinics.map(c => c.id);
      } else {
        scopeClinicIds = req.user!.allowedClinicIds;
      }

      if (scopeClinicIds.length === 0) {
        return res.json({ summary: EMPTY_SUMMARY, clinics: [], insights: {} });
      }

      const clinics = await prisma.clinic.findMany({
        where: { id: { in: scopeClinicIds }, organizationId: orgId },
        select: { id: true, name: true, slug: true, status: true, address: true },
      });

      // Computed once for the whole request (not per clinic) so every clinic's
      // todayAppointments uses the same "today" window, even if the request
      // straddles local midnight while the per-clinic Promise.all is in flight.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      const todayRange = { from: today, to: tomorrow };

      const clinicMetrics = await Promise.all(
        clinics.map(async (clinic) => {
          const [appointmentMetrics, patientMetrics, treatmentCaseMetrics, paymentMetrics, staffCount, doctorCount] =
            await Promise.all([
              getOrganizationAppointmentMetrics(clinic.id, { range: dateRange, todayRange }),
              getOrganizationPatientMetrics(clinic.id, dateRange),
              getOrganizationTreatmentCaseMetrics(clinic.id, dateRange),
              getOrganizationPaymentMetrics(clinic.id, dateRange),
              // Toplam personel
              prisma.userClinic.count({
                where: { clinicId: clinic.id, isActive: true },
              }),
              // Doktor sayısı (DENTIST rolü, büyük/küçük harf duyarsız)
              prisma.userClinic.count({
                where: { clinicId: clinic.id, isActive: true, role: { equals: 'DENTIST', mode: 'insensitive' } },
              }),
            ]);

          return {
            clinicId: clinic.id,
            clinicName: clinic.name,
            clinicSlug: clinic.slug,
            status: clinic.status,
            address: clinic.address ?? null,
            todayAppointments: appointmentMetrics.todayAppointments,
            appointments: appointmentMetrics.appointments,
            completedAppointments: appointmentMetrics.completedAppointments,
            cancelledAppointments: appointmentMetrics.cancelledAppointments,
            noShowRate: appointmentMetrics.noShowRate,
            totalPatients: patientMetrics.totalPatients,
            newPatients: patientMetrics.newPatients,
            revenue: paymentMetrics.revenue,
            collectedPayments: paymentMetrics.revenue,
            outstandingBalance: paymentMetrics.outstandingBalance,
            activeTreatmentPlans: treatmentCaseMetrics.activeTreatmentPlans,
            completedTreatments: treatmentCaseMetrics.completedTreatments,
            staffCount,
            doctorCount,
          };
        })
      );

      const activeClinics = clinics.filter(c => c.status === 'active').length;
      const totalAppointmentsSum = clinicMetrics.reduce((s, c) => s + c.appointments, 0);
      const avgNoShow = clinicMetrics.length > 0
        ? Math.round((clinicMetrics.reduce((s, c) => s + c.noShowRate, 0) / clinicMetrics.length) * 1000) / 1000
        : 0;

      const summary = {
        totalClinics: clinics.length,
        activeClinics,
        todayAppointments: clinicMetrics.reduce((s, c) => s + c.todayAppointments, 0),
        totalAppointments: totalAppointmentsSum,
        completedAppointments: clinicMetrics.reduce((s, c) => s + c.completedAppointments, 0),
        cancelledAppointments: clinicMetrics.reduce((s, c) => s + c.cancelledAppointments, 0),
        monthlyRevenue: clinicMetrics.reduce((s, c) => s + c.revenue, 0),
        collectedPayments: clinicMetrics.reduce((s, c) => s + c.revenue, 0),
        outstandingBalance: clinicMetrics.reduce((s, c) => s + c.outstandingBalance, 0),
        newPatients: clinicMetrics.reduce((s, c) => s + c.newPatients, 0),
        activeTreatmentPlans: clinicMetrics.reduce((s, c) => s + c.activeTreatmentPlans, 0),
        completedTreatmentCases: clinicMetrics.reduce((s, c) => s + c.completedTreatments, 0),
        averageNoShowRate: avgNoShow,
        staffCount: clinicMetrics.reduce((s, c) => s + c.staffCount, 0),
      };

      if (clinicMetrics.length === 0) {
        return res.json({ summary, clinics: clinicMetrics, insights: {} });
      }

      const topRevenue    = clinicMetrics.reduce((b, c) => c.revenue > b.revenue ? c : b, clinicMetrics[0]);
      const lowestRevenue = clinicMetrics.reduce((b, c) => c.revenue < b.revenue ? c : b, clinicMetrics[0]);
      const topAppts      = clinicMetrics.reduce((b, c) => c.appointments > b.appointments ? c : b, clinicMetrics[0]);
      const topOutstanding= clinicMetrics.reduce((b, c) => c.outstandingBalance > b.outstandingBalance ? c : b, clinicMetrics[0]);
      const topNoShow     = clinicMetrics.reduce((b, c) => c.noShowRate > b.noShowRate ? c : b, clinicMetrics[0]);
      const topNewPts     = clinicMetrics.reduce((b, c) => c.newPatients > b.newPatients ? c : b, clinicMetrics[0]);

      const mk = (m: typeof clinicMetrics[0], val: number) => ({ clinicId: m.clinicId, clinicName: m.clinicName, value: val });

      const insights = {
        topRevenueClinic:               mk(topRevenue,    topRevenue.revenue),
        lowestRevenueClinic:            mk(lowestRevenue, lowestRevenue.revenue),
        highestAppointmentClinic:       mk(topAppts,      topAppts.appointments),
        highestOutstandingBalanceClinic:mk(topOutstanding,topOutstanding.outstandingBalance),
        highestNoShowClinic:            mk(topNoShow,     topNoShow.noShowRate),
        topNewPatientClinic:            mk(topNewPts,     topNewPts.newPatients),
      };

      res.json({ summary, clinics: clinicMetrics, insights });
    } catch (err: any) {
      console.error('[org-dashboard] error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to fetch organization dashboard' });
    }
  }
);

export default router;
