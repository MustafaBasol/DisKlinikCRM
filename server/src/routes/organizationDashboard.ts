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

const router = express.Router();

// Export edilmiş — birim testlerinden çağrılabilir
export function getDateRange(range: string, from?: string, to?: string): { from: Date; to: Date } {
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  switch (range) {
    case 'today': {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      return { from: start, to: endOfToday };
    }
    case 'this_week': {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      start.setHours(0, 0, 0, 0);
      return { from: start, to: endOfToday };
    }
    case 'last_30_days': {
      const start = new Date(now); start.setDate(now.getDate() - 29); start.setHours(0, 0, 0, 0);
      return { from: start, to: endOfToday };
    }
    case 'custom': {
      if (!from || !to) throw new Error('custom range requires from and to');
      const toDate = new Date(to); toDate.setHours(23, 59, 59, 999);
      return { from: new Date(from), to: toDate };
    }
    default: { // this_month
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: start, to: endOfToday };
    }
  }
}

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

      const today = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

      const clinicMetrics = await Promise.all(
        clinics.map(async (clinic) => {
          const [
            todayAppointments,
            appointments,
            completedAppointments,
            cancelledAppointments,
            noShowCount,
            newPatients,
            totalPatients,
            activeTreatmentPlans,
            completedTreatments,
            revenueAgg,
            outstandingAgg,
            staffCount,
            doctorCount,
          ] = await Promise.all([
            // Bugünkü randevu (iptal edilmemiş)
            prisma.appointment.count({
              where: { clinicId: clinic.id, startTime: { gte: today, lt: tomorrow }, status: { not: 'cancelled' } },
            }),
            // Dönem randevusu (iptal edilmemiş)
            prisma.appointment.count({
              where: { clinicId: clinic.id, startTime: { gte: dateRange.from, lte: dateRange.to }, status: { not: 'cancelled' } },
            }),
            // Tamamlanan randevu
            prisma.appointment.count({
              where: { clinicId: clinic.id, startTime: { gte: dateRange.from, lte: dateRange.to }, status: 'completed' },
            }),
            // İptal edilen randevu
            prisma.appointment.count({
              where: { clinicId: clinic.id, startTime: { gte: dateRange.from, lte: dateRange.to }, status: 'cancelled' },
            }),
            // No-show
            prisma.appointment.count({
              where: { clinicId: clinic.id, startTime: { gte: dateRange.from, lte: dateRange.to }, status: 'no_show' },
            }),
            // Yeni hasta (dönemde)
            prisma.patient.count({
              where: { primaryClinicId: clinic.id, createdAt: { gte: dateRange.from, lte: dateRange.to }, deletedAt: null },
            }),
            // Toplam hasta (tüm zamanlar)
            prisma.patient.count({
              where: { primaryClinicId: clinic.id, deletedAt: null },
            }),
            // Aktif tedavi planı
            prisma.treatmentCase.count({
              where: { clinicId: clinic.id, stage: { notIn: ['completed', 'lost'] } },
            }),
            // Tamamlanan tedavi (dönemde)
            prisma.treatmentCase.count({
              where: { clinicId: clinic.id, stage: 'completed', closedAt: { gte: dateRange.from, lte: dateRange.to } },
            }),
            // Tahsil edilen ödeme (dönemde)
            prisma.payment.aggregate({
              where: { clinicId: clinic.id, paymentStatus: { in: ['paid', 'partial'] }, paidAt: { gte: dateRange.from, lte: dateRange.to } },
              _sum: { amount: true },
            }),
            // Bekleyen bakiye (tüm zamanlar)
            prisma.payment.aggregate({
              where: { clinicId: clinic.id, paymentStatus: 'pending' },
              _sum: { amount: true },
            }),
            // Toplam personel
            prisma.userClinic.count({
              where: { clinicId: clinic.id, isActive: true },
            }),
            // Doktor sayısı (DENTIST rolü, büyük/küçük harf duyarsız)
            prisma.userClinic.count({
              where: { clinicId: clinic.id, isActive: true, role: { equals: 'DENTIST', mode: 'insensitive' } },
            }),
          ]);

          const revenue = Number(revenueAgg._sum.amount) || 0;
          const outstandingBalance = Number(outstandingAgg._sum.amount) || 0;
          // noShowRate: 0–1 aralığında ondalık (ör. 0.057 = %5.7)
          const noShowRate = appointments > 0 ? Math.round((noShowCount / appointments) * 1000) / 1000 : 0;

          return {
            clinicId: clinic.id,
            clinicName: clinic.name,
            clinicSlug: clinic.slug,
            status: clinic.status,
            address: clinic.address ?? null,
            todayAppointments,
            appointments,
            completedAppointments,
            cancelledAppointments,
            noShowRate,
            totalPatients,
            newPatients,
            revenue,
            collectedPayments: revenue,
            outstandingBalance,
            activeTreatmentPlans,
            completedTreatments,
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
