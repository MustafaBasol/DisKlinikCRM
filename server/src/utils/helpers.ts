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
// NOTE: state is in-memory — it resets on process restart and is NOT shared
// across instances. Move to a shared store (Redis/DB counter) before running
// multiple replicas behind a load balancer.

export interface RateLimiter {
  check: (key: string) => boolean;
  record: (key: string) => void;
  reset: (key: string) => void;
}

// Süresi dolan girdiler yalnızca aynı key tekrar okunursa siliniyordu; tek
// seferlik key'ler (IP, e-posta) Map'te sonsuza dek kalır ve bellek sızıntısına
// dönerdi (docs/45 orta-8). Periyodik süpürme ile üst sınır konur.
const sweepExpiredEntries = (
  map: Map<string, { count: number; timestamp: number }>,
  windowMs: number,
): void => {
  setInterval(() => {
    const now = Date.now();
    for (const [key, attempt] of map) {
      if (now - attempt.timestamp > windowMs) map.delete(key);
    }
  }, Math.max(windowMs, 60_000)).unref();
};

export const createRateLimiter = (max: number, windowMs: number): RateLimiter => {
  const attempts = new Map<string, { count: number; timestamp: number }>();
  sweepExpiredEntries(attempts, windowMs);
  return {
    check(key: string): boolean {
      const now = Date.now();
      const attempt = attempts.get(key);
      if (!attempt) return true;
      if (now - attempt.timestamp > windowMs) {
        attempts.delete(key);
        return true;
      }
      return attempt.count < max;
    },
    record(key: string): void {
      const now = Date.now();
      const attempt = attempts.get(key);
      if (!attempt || now - attempt.timestamp > windowMs) {
        attempts.set(key, { count: 1, timestamp: now });
      } else {
        attempt.count++;
      }
    },
    reset(key: string): void {
      attempts.delete(key);
    },
  };
};

// --- Security: Rate Limiting (Login Attempts) ---

const loginAttempts = new Map<string, { count: number; timestamp: number }>();
sweepExpiredEntries(loginAttempts, 15 * 60 * 1000);

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

// --- Security: Rate Limiting (Forgot Password) ---
// Max 3 attempts per email per 60 minutes

const forgotPasswordAttempts = new Map<string, { count: number; timestamp: number }>();
const FORGOT_PASSWORD_MAX = 3;
const FORGOT_PASSWORD_WINDOW_MS = 60 * 60 * 1000;
sweepExpiredEntries(forgotPasswordAttempts, FORGOT_PASSWORD_WINDOW_MS);

export const checkForgotPasswordAttempt = (key: string): boolean => {
  const now = Date.now();
  const attempt = forgotPasswordAttempts.get(key);
  if (!attempt) return true;
  if (now - attempt.timestamp > FORGOT_PASSWORD_WINDOW_MS) {
    forgotPasswordAttempts.delete(key);
    return true;
  }
  return attempt.count < FORGOT_PASSWORD_MAX;
};

export const recordForgotPasswordAttempt = (key: string): void => {
  const now = Date.now();
  const attempt = forgotPasswordAttempts.get(key);
  if (!attempt) {
    forgotPasswordAttempts.set(key, { count: 1, timestamp: now });
  } else if (now - attempt.timestamp > FORGOT_PASSWORD_WINDOW_MS) {
    forgotPasswordAttempts.set(key, { count: 1, timestamp: now });
  } else {
    attempt.count++;
  }
};

// --- Security: Rate Limiting (Resend Email Verification) ---
// Max 3 attempts per email/IP per 60 minutes

const resendVerificationAttempts = new Map<string, { count: number; timestamp: number }>();
const RESEND_VERIFICATION_MAX = 3;
const RESEND_VERIFICATION_WINDOW_MS = 60 * 60 * 1000;

export const checkResendVerificationAttempt = (key: string): boolean => {
  const now = Date.now();
  const attempt = resendVerificationAttempts.get(key);
  if (!attempt) return true;
  if (now - attempt.timestamp > RESEND_VERIFICATION_WINDOW_MS) {
    resendVerificationAttempts.delete(key);
    return true;
  }
  return attempt.count < RESEND_VERIFICATION_MAX;
};

export const recordResendVerificationAttempt = (key: string): void => {
  const now = Date.now();
  const attempt = resendVerificationAttempts.get(key);
  if (!attempt) {
    resendVerificationAttempts.set(key, { count: 1, timestamp: now });
  } else if (now - attempt.timestamp > RESEND_VERIFICATION_WINDOW_MS) {
    resendVerificationAttempts.set(key, { count: 1, timestamp: now });
  } else {
    attempt.count++;
  }
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
