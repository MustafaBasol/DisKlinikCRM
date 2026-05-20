import { AuthRequest } from '../middleware/auth.js';
import prisma from '../db.js';

// --- Generic Helpers ---

export const getParam = (req: AuthRequest, key: string): string => {
  const value = req.params[key];
  return Array.isArray(value) ? value[0] : value;
};

export const timeToMinutes = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

export const minutesToTime = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

export const getZonedDateParts = (date: Date, timeZone: string) => {
  const weekdayLabel = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  const timeParts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(timeParts.find(part => part.type === 'hour')?.value ?? '0');
  const minute = Number(timeParts.find(part => part.type === 'minute')?.value ?? '0');
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    weekday: weekdayMap[weekdayLabel],
    minutes: hour * 60 + minute,
  };
};

export const formatClinicDateTime = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(date);

  const year = parts.find(part => part.type === 'year')?.value ?? '0000';
  const month = parts.find(part => part.type === 'month')?.value ?? '00';
  const day = parts.find(part => part.type === 'day')?.value ?? '00';
  const hour = parts.find(part => part.type === 'hour')?.value ?? '00';
  const minute = parts.find(part => part.type === 'minute')?.value ?? '00';

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
  };
};

// --- Security: Password Validation ---

export const validatePassword = (password: string): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (password.length < 8) errors.push('Password must be at least 8 characters long');
  if (password.length > 128) errors.push('Password must be less than 128 characters');
  if (!/[A-Z]/.test(password)) errors.push('Password must contain at least one uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('Password must contain at least one lowercase letter');
  if (!/\d/.test(password)) errors.push('Password must contain at least one number');
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character (!@#$%^&* etc)');
  }

  return { valid: errors.length === 0, errors };
};

// --- Security: Rate Limiting (Login Attempts) ---

const loginAttempts = new Map<string, { count: number; timestamp: number }>();

export const checkLoginAttempt = (email: string): boolean => {
  const now = Date.now();
  const attempt = loginAttempts.get(email);
  if (!attempt) return true;
  if (now - attempt.timestamp > 15 * 60 * 1000) {
    loginAttempts.delete(email);
    return true;
  }
  return attempt.count < 5;
};

export const recordLoginAttempt = (email: string): void => {
  const now = Date.now();
  const attempt = loginAttempts.get(email);
  if (!attempt) {
    loginAttempts.set(email, { count: 1, timestamp: now });
  } else if (now - attempt.timestamp > 15 * 60 * 1000) {
    loginAttempts.set(email, { count: 1, timestamp: now });
  } else {
    attempt.count++;
  }
};

export const resetLoginAttempts = (email: string): void => {
  loginAttempts.delete(email);
};

// --- Practitioner Availability Check ---

export const checkPractitionerAvailability = async (
  clinicId: string,
  practitionerId: string,
  startTime: Date,
  endTime: Date,
) => {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { timezone: true },
  });
  const timeZone = clinic?.timezone || 'Europe/Istanbul';
  const start = getZonedDateParts(startTime, timeZone);
  const end = getZonedDateParts(endTime, timeZone);

  if (start.weekday !== end.weekday) {
    return { ok: false, slots: [], timeZone, reason: 'cross_midnight' };
  }

  // Build the clinic-local date string (YYYY-MM-DD) for off-day check
  const { date: localDate } = formatClinicDateTime(startTime, timeZone);

  const [slots, offDay, clinicHours] = await Promise.all([
    prisma.doctorAvailability.findMany({
      where: { clinicId, practitionerId, weekday: start.weekday, isActive: true },
      orderBy: { startTime: 'asc' },
    }),
    prisma.doctorOffDay.findFirst({
      where: { clinicId, practitionerId, date: localDate },
    }),
    prisma.clinicWorkingHours.findUnique({
      where: { clinicId_dayOfWeek: { clinicId, dayOfWeek: start.weekday } },
    }),
  ]);

  if (offDay) {
    return { ok: false, slots, timeZone, reason: 'off_day', offDay };
  }

  // Klinik o gün kapalıysa randevu kabul etme
  if (clinicHours?.isClosed) {
    return { ok: false, slots, timeZone, reason: 'clinic_closed' };
  }

  const ok = slots.some(slot => {
    const slotStart = timeToMinutes(slot.startTime);
    const slotEnd = timeToMinutes(slot.endTime);
    return start.minutes >= slotStart && end.minutes <= slotEnd;
  });

  return { ok, slots, timeZone };
};
