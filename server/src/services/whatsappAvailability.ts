import type { PrismaClient } from '@prisma/client';
import type { TimePreference } from './whatsappInterpreter.js';
import {
  checkAppointmentOverlap,
  checkAppointmentRequestConflict,
} from './appointments/appointmentAvailabilityService.js';

/** Default slot duration (minutes) used when no service/appointmentType is selected yet. */
const DEFAULT_SLOT_DURATION_MINUTES = 30;

export type SavedAvailableSlot = {
  practitionerId: string;
  practitionerName: string;
  startTime: string;
  endTime: string;
  localStartTime: string;
  localEndTime: string;
};

export type RawAvailableSlot = {
  practitioner: { id: string; firstName: string; lastName: string };
  startTime: Date;
  endTime: Date;
  localStartTime: string;
  localEndTime: string;
};

export type AvailabilitySnapshot = {
  allSlots: SavedAvailableSlot[];
  shownSlots: SavedAvailableSlot[];
};

const timeToMinutes = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

export const getSlotMinutes = (slot: SavedAvailableSlot) => timeToMinutes(slot.localStartTime);

export const filterSlotsByTimePreference = (slots: SavedAvailableSlot[], preference: TimePreference) => {
  return slots.filter(slot => {
    const minutes = getSlotMinutes(slot);
    switch (preference) {
      case 'afternoon':
        return minutes >= 12 * 60;
      case 'morning':
        return minutes < 12 * 60;
      case 'noon':
        return minutes >= 11 * 60 + 30 && minutes <= 13 * 60;
      case 'evening':
        return minutes >= 16 * 60;
      default:
        return true;
    }
  });
};

export const filterSlotsByTimeThreshold = (slots: SavedAvailableSlot[], thresholdMinutes: number) => {
  return slots.filter(slot => getSlotMinutes(slot) >= thresholdMinutes);
};

export const slotIdentity = (slot: SavedAvailableSlot) => `${slot.practitionerId}:${slot.startTime}`;

export const formatSlotListMessage = (heading: string, slots: SavedAvailableSlot[]) => [
  heading,
  ...slots.map((slot, index) => `${index + 1}. ${slot.localStartTime}${slot.practitionerName ? ` (${slot.practitionerName})` : ''}`),
  '',
  'Size uygun olan saati numarasıyla veya saat/hekim adıyla paylaşabilirsiniz.',
].join('\n');

export const findNearbySlotsForTime = (slots: SavedAvailableSlot[], requestedTime: string, thresholdMinutes = 30) => {
  const requestedMinutes = timeToMinutes(requestedTime);
  return slots.filter(slot => Math.abs(getSlotMinutes(slot) - requestedMinutes) <= thresholdMinutes);
};

export const saveSlotsForState = (slots: RawAvailableSlot[]): SavedAvailableSlot[] => slots.map(slot => ({
  practitionerId: slot.practitioner.id,
  practitionerName: `${slot.practitioner.firstName} ${slot.practitioner.lastName}`,
  startTime: slot.startTime.toISOString(),
  endTime: slot.endTime.toISOString(),
  localStartTime: slot.localStartTime,
  localEndTime: slot.localEndTime,
}));

export const createAvailabilitySnapshot = (slots: RawAvailableSlot[], shownLimit = 8): AvailabilitySnapshot => {
  const allSlots = saveSlotsForState(slots);
  return {
    allSlots,
    shownSlots: allSlots.slice(0, shownLimit),
  };
};

const minutesToTime = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

const getZonedDateParts = (date: Date, timeZone: string) => {
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

const getZonedDateTimeParts = (date: Date, timeZone: string) => {
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

const localDateTimeToClinicDate = (date: string, time: string, timeZone: string) => {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const zonedGuess = getZonedDateTimeParts(new Date(utcGuess), timeZone);
  const zonedGuessUtc = Date.UTC(
    zonedGuess.year,
    zonedGuess.month - 1,
    zonedGuess.day,
    zonedGuess.hour,
    zonedGuess.minute
  );
  const desiredUtc = utcGuess - (zonedGuessUtc - utcGuess);

  return new Date(desiredUtc);
};

export const buildAvailableSlots = async (
  prisma: PrismaClient,
  clinicId: string,
  appointmentTypeId: string | null | undefined,
  date: string,
  practitionerId?: string | null
) => {
  const [clinic, service, practitioners] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: clinicId } }),
    appointmentTypeId
      ? prisma.appointmentType.findFirst({ where: { id: appointmentTypeId, clinicId, isActive: true } })
      : Promise.resolve(null),
    prisma.user.findMany({
      where: {
        clinicId,
        role: 'doctor',
        isActive: true,
        ...(practitionerId ? { id: practitionerId } : {}),
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    }),
  ]);

  // A serviceId was supplied but does not resolve to an active service for
  // this clinic — distinct from "no service selected yet" (appointmentTypeId
  // falsy), which is allowed and falls back to DEFAULT_SLOT_DURATION_MINUTES.
  if (appointmentTypeId && !service) {
    return null;
  }

  const timeZone = clinic?.timezone || 'Europe/Istanbul';
  const weekday = getZonedDateParts(localDateTimeToClinicDate(date, '12:00', timeZone), timeZone).weekday;

  // Klinik o gün kapalıysa hiç slot üretme
  const clinicHours = await prisma.clinicWorkingHours.findUnique({
    where: { clinicId_dayOfWeek: { clinicId, dayOfWeek: weekday } },
  });
  if (clinicHours?.isClosed) {
    return [];
  }

  const durationMinutes = service?.durationMinutes ?? DEFAULT_SLOT_DURATION_MINUTES;
  const results: RawAvailableSlot[] = [];
  const now = new Date();

  for (const practitioner of practitioners) {
    // Skip practitioner if they have an off-day on this date
    const offDay = await prisma.doctorOffDay.findFirst({
      where: { clinicId, practitionerId: practitioner.id, date },
    });
    if (offDay) continue;

    const availabilities = await prisma.doctorAvailability.findMany({
      where: { clinicId, practitionerId: practitioner.id, weekday, isActive: true },
      orderBy: { startTime: 'asc' },
    });

    for (const availability of availabilities) {
      let cursor = timeToMinutes(availability.startTime);
      const end = timeToMinutes(availability.endTime);

      while (cursor + durationMinutes <= end) {
        const slotStart = minutesToTime(cursor);
        const slotEnd = minutesToTime(cursor + durationMinutes);
        const startTime = localDateTimeToClinicDate(date, slotStart, timeZone);
        const endTime = localDateTimeToClinicDate(date, slotEnd, timeZone);

        // Canonical conflict rules — same functions submit-time
        // assertSlotAvailable is built from, so a slot shown here can never
        // be rejected at submission for a reason this check should have caught.
        if (startTime > now) {
          const conflictParams = { clinicId, practitionerId: practitioner.id, startTime, endTime };
          const [hasAppointmentOverlap, hasRequestConflict] = await Promise.all([
            checkAppointmentOverlap(prisma, conflictParams),
            checkAppointmentRequestConflict(prisma, conflictParams),
          ]);

          if (!hasAppointmentOverlap && !hasRequestConflict) {
            results.push({
              practitioner,
              startTime,
              endTime,
              localStartTime: slotStart,
              localEndTime: slotEnd,
            });
          }
        }

        cursor += 30;
      }
    }
  }

  return results.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
};

export const loadAvailabilityForDate = async (
  prisma: PrismaClient,
  clinicId: string,
  appointmentTypeId: string,
  date: string,
  selectedPractitionerId?: string | null
) => {
  const slots = await buildAvailableSlots(prisma, clinicId, appointmentTypeId, date, selectedPractitionerId ?? undefined);
  if (!slots) {
    return null;
  }

  return createAvailabilitySnapshot(slots);
};
