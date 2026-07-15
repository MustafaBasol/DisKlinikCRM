/**
 * Disposable seed for the PR #157 browser-acceptance gate. Never run against
 * a real/shared database — always paired with a throw-away Postgres
 * container (see docs/50-public-booking-slot-consistency-hotfix.md §8).
 *
 * Creates:
 *  - Organization + Clinic with a PUBLISHED ClinicLegalProfile
 *  - Two active doctors (doc-a, doc-b) both available on the target weekday
 *    at the SAME 09:00 local time (Scenario D — shared-time practitioners)
 *  - One active service
 *  - One pending AppointmentRequest occupying doc-a's 10:00 slot on the
 *    target date (Scenario A — pending request must hide that slot)
 *
 * Run with: DATABASE_URL=... npx tsx prisma/seed.e2e-booking.ts
 * Prints a JSON summary (clinicId, targetDate, doctor ids) to stdout.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

function nextWeekday(from: Date, targetWeekday: number, minDaysAhead: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + minDaysAhead);
  while (d.getDay() !== targetWeekday) d.setDate(d.getDate() + 1);
  return d;
}

async function main() {
  // Target: next Wednesday (weekday=3), at least 2 days out so it falls
  // inside the widget's "next 30 days" window regardless of when this runs.
  const target = nextWeekday(new Date(), 3, 2);
  const targetDate = target.toISOString().split('T')[0];

  const organization = await prisma.organization.create({
    data: { name: 'E2E Booking Org', slug: `e2e-booking-org-${Date.now()}`, status: 'active' },
  });

  const clinic = await prisma.clinic.create({
    data: {
      organizationId: organization.id,
      name: 'E2E Booking Clinic',
      timezone: 'Europe/Istanbul',
      currency: 'TRY',
      defaultLanguage: 'tr',
      slug: `e2e-booking-clinic-${Date.now()}`,
      status: 'active',
    },
  });

  await prisma.clinicLegalProfile.create({
    data: {
      organizationId: organization.id,
      clinicId: clinic.id,
      dataControllerTitle: 'E2E Booking Clinic Ltd.',
      privacyNoticeText: 'Bu, PR #157 tarayici kabul testi icin yayinlanmis ornek bir aydinlatma metnidir.',
      privacyNoticeVersion: 'v1-e2e',
      effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
      isPublished: true,
    },
  });

  const docA = await prisma.user.create({
    data: {
      clinicId: clinic.id,
      organizationId: organization.id,
      firstName: 'Doktor',
      lastName: 'Alfa',
      email: `doc-a-${Date.now()}@e2e.test`,
      role: 'doctor',
      passwordHash: 'unused',
      isActive: true,
    },
  });

  const docB = await prisma.user.create({
    data: {
      clinicId: clinic.id,
      organizationId: organization.id,
      firstName: 'Doktor',
      lastName: 'Beta',
      email: `doc-b-${Date.now()}@e2e.test`,
      role: 'doctor',
      passwordHash: 'unused',
      isActive: true,
    },
  });

  const targetWeekday = target.getDay();
  await prisma.doctorAvailability.createMany({
    data: [
      { clinicId: clinic.id, practitionerId: docA.id, weekday: targetWeekday, startTime: '09:00', endTime: '17:00', isActive: true },
      { clinicId: clinic.id, practitionerId: docB.id, weekday: targetWeekday, startTime: '09:00', endTime: '17:00', isActive: true },
    ],
  });

  const service = await prisma.appointmentType.create({
    data: {
      clinicId: clinic.id,
      name: 'E2E Muayene',
      durationMinutes: 30,
      isActive: true,
      isService: true,
    },
  });

  // Scenario A fixture: a pending AppointmentRequest already holds doc-a's
  // 10:00 slot on the target date. The widget must not offer it.
  const pendingStart = new Date(`${targetDate}T10:00:00.000+03:00`);
  const pendingEnd = new Date(pendingStart.getTime() + 30 * 60 * 1000);
  await prisma.appointmentRequest.create({
    data: {
      clinicId: clinic.id,
      patientName: 'Mevcut Bekleyen Talep',
      phone: '+905550000000',
      appointmentTypeId: service.id,
      practitionerId: docA.id,
      preferredStartTime: pendingStart,
      preferredEndTime: pendingEnd,
      requestType: 'appointment',
      source: 'widget',
      status: 'pending',
    },
  });

  console.log(JSON.stringify({
    organizationId: organization.id,
    clinicId: clinic.id,
    targetDate,
    targetWeekday,
    serviceId: service.id,
    docAId: docA.id,
    docBId: docB.id,
    pendingRequestBlockedLocalTime: '10:00',
  }, null, 2));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
