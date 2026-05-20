/**
 * schedules.ts — Şube Çalışma Saatleri + Müsaitlik API
 *
 * Endpoints:
 *   GET  /api/clinics/:clinicId/working-hours          — Klinik çalışma saatlerini listele
 *   PUT  /api/clinics/:clinicId/working-hours          — Tüm günleri toplu kaydet (upsert)
 *   GET  /api/clinics/:clinicId/doctors                — Bu klinikle ilişkili doktorlar
 *   GET  /api/availability                             — Müsait zaman dilimleri
 */

import express, { Response } from 'express';
import { z } from 'zod';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { getParam, timeToMinutes, minutesToTime } from '../utils/helpers.js';
import { getAccessibleClinicIds } from '../utils/clinicScope.js';
import { normalizeRole } from '../utils/roles.js';

const router = express.Router();

// ─── Şema doğrulama ─────────────────────────────────────────────────────────

const workingHoursItemSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isClosed: z.boolean().default(false),
});

const workingHoursBatchSchema = z.object({
  hours: z.array(workingHoursItemSchema).min(1).max(7),
});

// ─── Yardımcı: klinik erişim kontrolü ───────────────────────────────────────

async function assertClinicAccess(
  req: AuthRequest,
  clinicId: string,
  res: Response,
): Promise<boolean> {
  const accessible = await getAccessibleClinicIds(req.user!);
  if (!accessible.includes(clinicId)) {
    res.status(403).json({ error: 'Access denied to requested clinic' });
    return false;
  }
  return true;
}

// ─── GET /api/clinics/:clinicId/working-hours ────────────────────────────────

router.get(
  '/clinics/:clinicId/working-hours',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const clinicId = getParam(req, 'clinicId');

    try {
      if (!(await assertClinicAccess(req, clinicId, res))) return;

      const stored = await prisma.clinicWorkingHours.findMany({
        where: { clinicId },
        orderBy: { dayOfWeek: 'asc' },
      });

      // 7 günlük tam liste döndür; eksik günler için varsayılan doldur
      const defaults: Record<number, { isClosed: boolean }> = {
        0: { isClosed: true },  // Pazar — kapalı
        1: { isClosed: false },
        2: { isClosed: false },
        3: { isClosed: false },
        4: { isClosed: false },
        5: { isClosed: false },
        6: { isClosed: false }, // Cumartesi
      };

      const result = Array.from({ length: 7 }, (_, day) => {
        const existing = stored.find(s => s.dayOfWeek === day);
        if (existing) return existing;
        return { id: null, clinicId, dayOfWeek: day, ...defaults[day] };
      });

      res.json(result);
    } catch {
      res.status(500).json({ error: 'Failed to fetch working hours' });
    }
  },
);

// ─── PUT /api/clinics/:clinicId/working-hours ────────────────────────────────

router.put(
  '/clinics/:clinicId/working-hours',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']),
  async (req: AuthRequest, res: Response) => {
    const clinicId = getParam(req, 'clinicId');

    try {
      if (!(await assertClinicAccess(req, clinicId, res))) return;

      // CLINIC_MANAGER yalnızca kendi kliniklerini yönetir; OWNER/ORG_ADMIN kısıtlaması yok
      const canonicalRole = normalizeRole(req.user!.role, req.user!.canAccessAllClinics ?? false);
      if (canonicalRole === 'CLINIC_MANAGER') {
        // clinicId erişimini yukarıda assertClinicAccess ile doğruladık — yeterli
      }

      const clinic = await prisma.clinic.findFirst({
        where: { id: clinicId },
        select: { organizationId: true },
      });
      if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

      const validation = workingHoursBatchSchema.safeParse(req.body);
      if (!validation.success) return res.status(400).json({ error: validation.error.format() });

      const updated = await prisma.$transaction(async tx => {
        const results = await Promise.all(
          validation.data.hours.map(h =>
            tx.clinicWorkingHours.upsert({
              where: { clinicId_dayOfWeek: { clinicId, dayOfWeek: h.dayOfWeek } },
              create: {
                clinicId,
                organizationId: clinic.organizationId,
                dayOfWeek: h.dayOfWeek,
                isClosed: h.isClosed,
              },
              update: {
                isClosed: h.isClosed,
              },
            }),
          ),
        );
        return results.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
      });

      res.json(updated);
    } catch {
      res.status(500).json({ error: 'Failed to update working hours' });
    }
  },
);

// ─── GET /api/clinics/:clinicId/doctors ─────────────────────────────────────
// Bu klinikle UserClinic tablosundan ilişkilendirilmiş aktif doktorlar

router.get(
  '/clinics/:clinicId/doctors',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const clinicId = getParam(req, 'clinicId');

    try {
      if (!(await assertClinicAccess(req, clinicId, res))) return;

      const assignments = await prisma.userClinic.findMany({
        where: {
          clinicId,
          isActive: true,
          user: { isActive: true },
          OR: [{ role: 'DENTIST' }, { role: 'dentist' }, { role: 'doctor' }],
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
              isActive: true,
            },
          },
        },
        orderBy: { user: { firstName: 'asc' } },
      });

      // UserClinic kaydı olmayan ama User.clinicId bu klinik olan doktorları da dahil et
      // (tek şubeli eski veri uyumluluğu için)
      const assignedIds = assignments.map(a => a.userId);
      const legacyDoctors = await prisma.user.findMany({
        where: {
          clinicId,
          isActive: true,
          role: { in: ['doctor', 'DENTIST', 'dentist'] },
          id: { notIn: assignedIds },
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          isActive: true,
        },
      });

      const doctors = [
        ...assignments.map(a => a.user),
        ...legacyDoctors,
      ].sort((a, b) => a.firstName.localeCompare(b.firstName));

      res.json(doctors);
    } catch {
      res.status(500).json({ error: 'Failed to fetch clinic doctors' });
    }
  },
);

// ─── GET /api/availability ──────────────────────────────────────────────────
// Belirli klinik + doktor + tarih için müsait zaman dilimlerini hesapla
// Query params: clinicId, doctorId, date (YYYY-MM-DD), duration (default: 30 dk)

router.get(
  '/availability',
  authorize(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']),
  async (req: AuthRequest, res: Response) => {
    const { clinicId, doctorId, date, duration: durationStr } = req.query as Record<string, string>;
    const duration = parseInt(durationStr ?? '30', 10);

    if (!clinicId || !doctorId || !date) {
      return res.status(400).json({ error: 'clinicId, doctorId ve date zorunludur' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date YYYY-MM-DD formatında olmalı' });
    }

    try {
      if (!(await assertClinicAccess(req, clinicId, res))) return;

      const clinic = await prisma.clinic.findFirst({
        where: { id: clinicId },
        select: { timezone: true },
      });
      if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

      const timeZone = clinic.timezone || 'Europe/Istanbul';

      // Tarihin haftanın hangi günü olduğunu hesapla
      const [year, month, day] = date.split('-').map(Number);
      const localDate = new Date(year, month - 1, day);
      const dayOfWeek = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(localDate);
      const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const weekday = weekdayMap[dayOfWeek];

      // Klinik çalışma saatleri, doktor müsaitliği, doktor izin günü, mevcut randevular
      const [workingHours, doctorSlots, offDay, existingAppointments] = await Promise.all([
        prisma.clinicWorkingHours.findUnique({
          where: { clinicId_dayOfWeek: { clinicId, dayOfWeek: weekday } },
        }),
        prisma.doctorAvailability.findMany({
          where: { clinicId, practitionerId: doctorId, weekday, isActive: true },
          orderBy: { startTime: 'asc' },
        }),
        prisma.doctorOffDay.findFirst({
          where: { clinicId, practitionerId: doctorId, date },
        }),
        prisma.appointment.findMany({
          where: {
            clinicId,
            practitionerId: doctorId,
            deletedAt: null,
            status: { notIn: ['cancelled'] },
            startTime: {
              gte: new Date(`${date}T00:00:00`),
              lt: new Date(`${date}T23:59:59`),
            },
          },
          select: { startTime: true, endTime: true },
          orderBy: { startTime: 'asc' },
        }),
      ]);

      // İzin günü — sıfır müsait slot
      if (offDay) {
        return res.json({ date, doctorId, clinicId, slots: [], reason: 'off_day' });
      }

      // Klinik kapalı (çalışma saatleri tanımlanmış ve isClosed=true)
      if (workingHours?.isClosed) {
        return res.json({ date, doctorId, clinicId, slots: [], reason: 'clinic_closed' });
      }

      // Sadece doktor müsaitlik pencerelerini kullan
      const windows: Array<{ start: number; end: number }> = [];

      if (doctorSlots.length > 0) {
        doctorSlots.forEach(s => {
          windows.push({ start: timeToMinutes(s.startTime), end: timeToMinutes(s.endTime) });
        });
      }

      // Mevcut randevuları dolu aralık olarak işaretle
      const bookedRanges = existingAppointments.map(a => {
        const startMin = a.startTime.getUTCHours() * 60 + a.startTime.getUTCMinutes();
        const endMin = a.endTime.getUTCHours() * 60 + a.endTime.getUTCMinutes();
        return { start: startMin, end: endMin };
      });

      // Pencereler içinde boş slot oluştur (UTC offset yok: sadece saat kısmını karşılaştırıyoruz)
      const slots: Array<{ startTime: string; endTime: string; available: boolean }> = [];

      for (const window of windows) {
        let cursor = window.start;
        while (cursor + duration <= window.end) {
          const slotEnd = cursor + duration;
          const isBooked = bookedRanges.some(r => cursor < r.end && slotEnd > r.start);
          slots.push({
            startTime: minutesToTime(cursor),
            endTime: minutesToTime(slotEnd),
            available: !isBooked,
          });
          cursor += duration;
        }
      }

      res.json({ date, doctorId, clinicId, slots, timeZone });
    } catch {
      res.status(500).json({ error: 'Failed to compute availability' });
    }
  },
);

export default router;
