import { AuthRequest } from '../middleware/auth.js';
import prisma from '../db.js';
import { createCounterStore } from './counterStore.js';

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

export const getZonedDateTimeParts = (date: Date, timeZone: string) => {
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

  return {
    year: Number(parts.find(part => part.type === 'year')?.value ?? '0'),
    month: Number(parts.find(part => part.type === 'month')?.value ?? '0'),
    day: Number(parts.find(part => part.type === 'day')?.value ?? '0'),
    hour: Number(parts.find(part => part.type === 'hour')?.value ?? '0'),
    minute: Number(parts.find(part => part.type === 'minute')?.value ?? '0'),
  };
};

export const localDateTimeToClinicDate = (date: string, time: string, timeZone: string) => {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const zonedGuess = getZonedDateTimeParts(new Date(utcGuess), timeZone);
  const zonedGuessUtc = Date.UTC(
    zonedGuess.year,
    zonedGuess.month - 1,
    zonedGuess.day,
    zonedGuess.hour,
    zonedGuess.minute,
  );
  const desiredUtc = utcGuess - (zonedGuessUtc - utcGuess);

  return new Date(desiredUtc);
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

// --- Security: Generic Rate Limiter Factory ---
// Sayaçlar paylaşımlı store'da tutulur (REDIS_URL varsa Redis, yoksa bellek —
// bkz. utils/counterStore.ts). Redis ile birden fazla replika aynı limitleri
// paylaşır (docs/45 Faz 3 #9); bu yüzden API async'tir.

export interface RateLimiter {
  check: (key: string) => Promise<boolean>;
  record: (key: string) => Promise<void>;
  reset: (key: string) => Promise<void>;
}

// namespace: Redis key öneki — limiter başına sabit ve benzersiz olmalı.
export const createRateLimiter = (max: number, windowMs: number, namespace: string): RateLimiter => {
  const store = createCounterStore(namespace);
  return {
    async check(key: string): Promise<boolean> {
      return (await store.get(key, windowMs)) < max;
    },
    async record(key: string): Promise<void> {
      await store.increment(key, windowMs);
    },
    async reset(key: string): Promise<void> {
      await store.reset(key);
    },
  };
};

// --- Security: Rate Limiting (Login Attempts) ---
// Max 5 attempts per email per 15 minutes

const loginLimiter = createRateLimiter(5, 15 * 60 * 1000, 'login-email');

export const checkLoginAttempt = (email: string): Promise<boolean> => loginLimiter.check(email);
export const recordLoginAttempt = (email: string): Promise<void> => loginLimiter.record(email);
export const resetLoginAttempts = (email: string): Promise<void> => loginLimiter.reset(email);

// --- Security: Rate Limiting (Forgot Password) ---
// Max 3 attempts per email per 60 minutes

const forgotPasswordLimiter = createRateLimiter(3, 60 * 60 * 1000, 'forgot-password');

export const checkForgotPasswordAttempt = (key: string): Promise<boolean> =>
  forgotPasswordLimiter.check(key);
export const recordForgotPasswordAttempt = (key: string): Promise<void> =>
  forgotPasswordLimiter.record(key);

// --- Security: Rate Limiting (Resend Email Verification) ---
// Max 3 attempts per email/IP per 60 minutes

const resendVerificationLimiter = createRateLimiter(3, 60 * 60 * 1000, 'resend-verification');

export const checkResendVerificationAttempt = (key: string): Promise<boolean> =>
  resendVerificationLimiter.check(key);
export const recordResendVerificationAttempt = (key: string): Promise<void> =>
  resendVerificationLimiter.record(key);

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

  if (slots.length === 0) {
    return { ok: false, slots, timeZone, reason: 'doctor_availability_missing' };
  }

  const ok = slots.some(slot => {
    const slotStart = timeToMinutes(slot.startTime);
    const slotEnd = timeToMinutes(slot.endTime);
    return start.minutes >= slotStart && end.minutes <= slotEnd;
  });

  return { ok, slots, timeZone };
};
