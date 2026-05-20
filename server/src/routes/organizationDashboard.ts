/**
 * organizationDashboard.ts — Şube Yönetimi Dashboard (Sprint 5)
 *
 * GET /api/organization/dashboard?range=this_month
 *
 * Güvenlik kuralları:
 * 1. Yalnızca OWNER, ORG_ADMIN, admin rolleri erişebilir.
 * 2. Tüm sorgular organizationId ile scope edilir.
 * 3. Frontend'den gelen clinicId'ler DB'den doğrulanır.
 */

import express, { Response } from 'express';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';

const router = express.Router();

// Tarih aralığı hesapla
function getDateRange(range: string, from?: string, to?: string): { from: Date; to: Date } {
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  switch (range) {
    case 'today': {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      return { from: start, to: endOfToday };
    }
    case 'this_week': {
      const start = new Date(now); start.setDate(now.getDate() - now.getDay()); start.setHours(0, 0, 0, 0);
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

// GET /api/organization/dashboard
router.get(
  '/organization/dashboard',
  authorize(['admin', 'OWNER', 'ORG_ADMIN']),
  async (req: AuthRequest, res: Response) => {
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
      // Kullanıcının erişebildiği klinikleri belirle
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
        return res.json({ summary: {}, clinics: [], insights: {} });
      }

      // Klinik bilgilerini çek
      const clinics = await prisma.clinic.findMany({
        where: { id: { in: scopeClinicIds }, organizationId: orgId },
        select: { id: true, name: true, status: true },
      });

      const today = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

      // Her klinik için metrikleri paralel çek
      const clinicMetrics = await Promise.all(
        clinics.map(async (clinic) => {
          const [
            todayAppointments,
            monthlyAppointments,
            noShowCount,
            totalAppointments,
            newPatients,
            activeTreatmentPlans,
            completedTreatments,
            revenueAgg,
            outstandingAgg,
            staffCount,
          ] = await Promise.all([
            prisma.appointment.count({
              where: { clinicId: clinic.id, startTime: { gte: today, lt: tomorrow }, status: { not: 'cancelled' } },
            }),
            prisma.appointment.count({
              where: { clinicId: clinic.id, startTime: { gte: dateRange.from, lte: dateRange.to }, status: { not: 'cancelled' } },
            }),
            prisma.appointment.count({
              where: { clinicId: clinic.id, startTime: { gte: dateRange.from, lte: dateRange.to }, status: 'no_show' },
            }),
            prisma.appointment.count({
              where: { clinicId: clinic.id, startTime: { gte: dateRange.from, lte: dateRange.to }, status: { not: 'cancelled' } },
            }),
            prisma.patient.count({
              where: { primaryClinicId: clinic.id, createdAt: { gte: dateRange.from, lte: dateRange.to }, deletedAt: null },
            }),
            prisma.treatmentCase.count({
              where: { clinicId: clinic.id, stage: { notIn: ['completed', 'lost'] } },
            }),
            prisma.treatmentCase.count({
              where: { clinicId: clinic.id, stage: 'completed', closedAt: { gte: dateRange.from, lte: dateRange.to } },
            }),
            prisma.payment.aggregate({
              where: { clinicId: clinic.id, paymentStatus: { in: ['paid', 'partial'] }, paidAt: { gte: dateRange.from, lte: dateRange.to } },
              _sum: { amount: true },
            }),
            prisma.payment.aggregate({
              where: { clinicId: clinic.id, paymentStatus: 'pending' },
              _sum: { amount: true },
            }),
            prisma.userClinic.count({
              where: { clinicId: clinic.id, isActive: true },
            }),
          ]);

          const monthlyRevenue = Number(revenueAgg._sum.amount) || 0;
          const outstandingBalance = Number(outstandingAgg._sum.amount) || 0;
          const noShowRate = totalAppointments > 0 ? Math.round((noShowCount / totalAppointments) * 1000) / 1000 : 0;

          return {
            clinicId: clinic.id,
            clinicName: clinic.name,
            status: clinic.status,
            todayAppointments,
            monthlyAppointments,
            monthlyRevenue,
            outstandingBalance,
            newPatients,
            activeTreatmentPlans,
            completedTreatments,
            noShowRate,
            staffCount,
          };
        })
      );

      // Özet toplamlar
      const summary = {
        totalClinics: clinics.length,
        todayAppointments: clinicMetrics.reduce((s, c) => s + c.todayAppointments, 0),
        monthlyAppointments: clinicMetrics.reduce((s, c) => s + c.monthlyAppointments, 0),
        monthlyRevenue: clinicMetrics.reduce((s, c) => s + c.monthlyRevenue, 0),
        outstandingBalance: clinicMetrics.reduce((s, c) => s + c.outstandingBalance, 0),
        newPatients: clinicMetrics.reduce((s, c) => s + c.newPatients, 0),
        activeTreatmentPlans: clinicMetrics.reduce((s, c) => s + c.activeTreatmentPlans, 0),
        averageNoShowRate: clinicMetrics.length > 0
          ? Math.round((clinicMetrics.reduce((s, c) => s + c.noShowRate, 0) / clinicMetrics.length) * 1000) / 1000
          : 0,
        activeUsers: clinicMetrics.reduce((s, c) => s + c.staffCount, 0),
      };

      // İçgörüler
      const topRevenue = clinicMetrics.reduce((best, c) => c.monthlyRevenue > best.monthlyRevenue ? c : best, clinicMetrics[0]);
      const topAppointments = clinicMetrics.reduce((best, c) => c.monthlyAppointments > best.monthlyAppointments ? c : best, clinicMetrics[0]);
      const topOutstanding = clinicMetrics.reduce((best, c) => c.outstandingBalance > best.outstandingBalance ? c : best, clinicMetrics[0]);
      const topNoShow = clinicMetrics.reduce((best, c) => c.noShowRate > best.noShowRate ? c : best, clinicMetrics[0]);
      const topNewPatients = clinicMetrics.reduce((best, c) => c.newPatients > best.newPatients ? c : best, clinicMetrics[0]);

      const insights = {
        topRevenueClinic: { clinicId: topRevenue?.clinicId, clinicName: topRevenue?.clinicName, value: topRevenue?.monthlyRevenue },
        highestAppointmentClinic: { clinicId: topAppointments?.clinicId, clinicName: topAppointments?.clinicName, value: topAppointments?.monthlyAppointments },
        highestOutstandingBalanceClinic: { clinicId: topOutstanding?.clinicId, clinicName: topOutstanding?.clinicName, value: topOutstanding?.outstandingBalance },
        highestNoShowClinic: { clinicId: topNoShow?.clinicId, clinicName: topNoShow?.clinicName, value: topNoShow?.noShowRate },
        topNewPatientClinic: { clinicId: topNewPatients?.clinicId, clinicName: topNewPatients?.clinicName, value: topNewPatients?.newPatients },
      };

      res.json({ summary, clinics: clinicMetrics, insights });
    } catch (err: any) {
      console.error('[org-dashboard] error:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to fetch organization dashboard' });
    }
  }
);

export default router;
