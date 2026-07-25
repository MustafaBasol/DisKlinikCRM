/**
 * metaWhatsAppPostBookingHandler.test.ts — Real production-path regression test
 * for the post_booking new-appointment defect (BOOKING-FLOW-HOTFIX-001).
 *
 * Unlike whatsappIdentityAndPostBooking.test.ts (which calls
 * resolveStepAwareWhatsAppIntent / buildFreshBookingTransition directly), this
 * file drives the actual exported handler that runs after
 * POST /api/public/whatsapp/meta/webhook — processMetaWhatsAppIncomingMessage —
 * against a REAL disposable PostgreSQL database via the real Prisma client
 * (server/src/db.ts). Only the outbound Meta Graph API HTTP call
 * (MetaCloudWhatsAppProvider.sendMessage) is mocked, via globalThis.fetch —
 * the same convention already used by whatsappOutboundMessaging.test.ts /
 * whatsappProvider.test.ts / instagramProvider.test.ts. Nothing about the
 * identity resolution, shared-phone guard, consent gate, or post_booking
 * branch itself is reimplemented or bypassed.
 *
 * Requires DATABASE_URL to point at a disposable Postgres before import,
 * since server/src/db.ts opens a live pg pool at import time. Do not run
 * against a production database.
 *
 * Run with:
 *   cd server && DATABASE_URL=<disposable-postgres> npx tsx src/tests/metaWhatsAppPostBookingHandler.test.ts
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.ENCRYPTION_KEY = 'c'.repeat(64);
delete process.env.GOOGLE_AI_STUDIO_API_KEY;
delete process.env.GEMINI_API_KEY;

import prisma from '../db.js';
import {
  processMetaWhatsAppIncomingMessage,
  buildMetaWaConversationKey,
} from '../services/whatsapp/metaWhatsAppAiProcessor.js';

let passed = 0;
let failed = 0;

function section(title: string) {
  console.log(`\n${title}`);
}

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: unknown) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    failed++;
  }
}

// The exact generic dead-end reply the post_booking step sends for an
// unrecognized message — a regression must never produce this text for a
// clear new-booking request, nor for a clear cancel/status/change/handoff one.
const GENERIC_POST_BOOKING_FALLBACK =
  'Randevu talebinizin durumunu sorabilir, saat veya tarih değişikliği isteyebilir, iptal talep edebilir ya da yetkili biriyle görüşmek isteyebilirsiniz. Nasıl yardımcı olabilirim?';

const createdOrgIds = new Set<string>();

// ── Fixture builder ──────────────────────────────────────────────────────────

async function createFixture(labelPrefix: string) {
  const suffix = randomUUID().slice(0, 8);

  const organization = await prisma.organization.create({
    data: { name: `${labelPrefix} Org ${suffix}`, slug: `${labelPrefix}-org-${suffix}`.toLowerCase() },
  });
  createdOrgIds.add(organization.id);

  const clinic = await prisma.clinic.create({
    data: {
      name: `${labelPrefix} Clinic ${suffix}`,
      slug: `${labelPrefix}-clinic-${suffix}`.toLowerCase(),
      organizationId: organization.id,
      timezone: 'Europe/Istanbul',
    },
  });

  // Published legal profile + accepted consent log — required by the consent
  // gate (channelConsentGate.ts) that runs before the post_booking branch on
  // every message. Without this, every message would be diverted to the
  // consent prompt and never reach post_booking at all.
  await prisma.clinicLegalProfile.create({
    data: {
      organizationId: organization.id,
      clinicId: clinic.id,
      isPublished: true,
      privacyNoticeVersion: '1.0',
    },
  });

  const connection = await prisma.whatsAppConnection.create({
    data: {
      organizationId: organization.id,
      name: `${labelPrefix} Meta Connection ${suffix}`,
      provider: 'meta_cloud_api',
      status: 'connected',
      metaPhoneNumberId: `test-phone-id-${suffix}`,
      // Not real AES-GCM ciphertext — MetaCloudWhatsAppProvider's
      // resolveAccessToken() falls back to using it as-is on decrypt failure
      // ("Legacy / test records stored unencrypted — accept as-is").
      metaAccessTokenEncrypted: `test-access-token-${suffix}`,
      isActive: true,
    },
  });

  const [service1, service2] = await Promise.all([
    prisma.appointmentType.create({
      data: { clinicId: clinic.id, name: 'Diş Taşı Temizliği', durationMinutes: 30, isActive: true, isService: true },
    }),
    prisma.appointmentType.create({
      data: { clinicId: clinic.id, name: 'Kanal Tedavisi', durationMinutes: 60, isActive: true, isService: true },
    }),
  ]);

  const phone = `9055${suffix}`.padEnd(12, '1');

  return { organization, clinic, connection, services: [service1, service2], phone, suffix };
}

async function acceptConsent(fixture: Awaited<ReturnType<typeof createFixture>>) {
  await prisma.channelConsentLog.create({
    data: {
      organizationId: fixture.organization.id,
      clinicId: fixture.clinic.id,
      channel: 'whatsapp',
      contactIdentifier: fixture.phone,
      consentStatus: 'accepted',
      consentTextVersion: '1.0',
      consentTextSnapshot: 'test-snapshot',
      privacyUrl: 'https://example.invalid/kvkk',
      acceptedAt: new Date(),
    },
  });
}

async function createPostBookingState(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  overrides: { customerName?: string | null; stateJson?: Record<string, unknown> } = {},
) {
  const conversationKey = buildMetaWaConversationKey(fixture.connection.id, fixture.phone);
  await prisma.whatsAppConversationState.create({
    data: {
      clinicId: fixture.clinic.id,
      phone: conversationKey,
      customerName: overrides.customerName ?? 'Ayşe Yılmaz',
      currentIntent: null,
      step: 'post_booking',
      selectedAppointmentTypeId: null,
      selectedAppointmentTypeName: null,
      selectedPractitionerId: null,
      selectedDate: null,
      selectedTime: null,
      stateJson: (overrides.stateJson ?? {}) as any,
    },
  });
  return conversationKey;
}

async function readState(fixture: Awaited<ReturnType<typeof createFixture>>, conversationKey: string) {
  const row = await prisma.whatsAppConversationState.findUnique({
    where: { clinicId_phone: { clinicId: fixture.clinic.id, phone: conversationKey } },
  });
  return row;
}

async function cleanupAllFixtures(): Promise<void> {
  const orgIds = Array.from(createdOrgIds);
  if (orgIds.length === 0) return;

  const clinics = await prisma.clinic.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } });
  const clinicIds = clinics.map((c) => c.id);
  const connections = await prisma.whatsAppConnection.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } });
  const connectionIds = connections.map((c) => c.id);

  await prisma.whatsAppConversationMessage.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.whatsAppConversationState.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.whatsAppInboxEntry.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.contactRequest.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.appointmentRequest.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.channelConsentLog.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.clinicLegalProfile.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.appointmentType.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.patient.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.whatsAppConnection.deleteMany({ where: { id: { in: connectionIds } } });
  await prisma.clinic.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });

  createdOrgIds.clear();
}

// ── Meta Graph API mock (outbound send only — see file header) ──────────────

function mockSuccessfulMetaSend() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: `wamid.mock.${randomUUID()}` }] }), {
      status: 200,
    })) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function main() {
  section('processMetaWhatsAppIncomingMessage — post_booking + "yeni randevu almak istiyorum" (production defect, real handler path)');

  await test(
    'transitions post_booking -> awaiting_service, sends the real service list, clears stale state, preserves selectedPatientId, and leaves the prior AppointmentRequest untouched',
    async () => {
      const fixture = await createFixture('newbooking');
      await acceptConsent(fixture);

      const patient = await prisma.patient.create({
        data: {
          clinicId: fixture.clinic.id,
          organizationId: fixture.organization.id,
          firstName: 'Ayşe',
          lastName: 'Yılmaz',
          phone: fixture.phone,
        },
      });

      const priorRequest = await prisma.appointmentRequest.create({
        data: {
          clinicId: fixture.clinic.id,
          patientId: patient.id,
          patientName: 'Ayşe Yılmaz',
          phone: fixture.phone,
          appointmentTypeId: fixture.services[0].id,
          requestType: 'appointment',
          source: 'meta_whatsapp',
          status: 'approved',
        },
      });

      const conversationKey = await createPostBookingState(fixture, {
        stateJson: {
          selectedPatientId: patient.id,
          lastBookingSummary: { serviceName: 'Diş Taşı Temizliği', date: '2026-08-01', time: '10:00' },
        },
      });

      const restoreFetch = mockSuccessfulMetaSend();
      let result;
      try {
        result = await processMetaWhatsAppIncomingMessage({
          organizationId: fixture.organization.id,
          clinicId: fixture.clinic.id,
          connectionId: fixture.connection.id,
          phone: fixture.phone,
          messageId: `wamid.in.${fixture.suffix}`,
          text: 'yeni randevu almak istiyorum',
        });
      } finally {
        restoreFetch();
      }

      // 3. intent resolves to new_booking_request (observable via the resulting
      // reply + state transition, asserted below) and 4/6/8 together:
      assert.equal(result.status, 'processed');
      assert.notEqual(result.replyText, GENERIC_POST_BOOKING_FALLBACK);
      // 7. outbound reply contains the real service list
      for (const service of fixture.services) {
        assert.ok(result.replyText.includes(service.name), `reply should list "${service.name}"`);
      }

      const state = await readState(fixture, conversationKey);
      assert.ok(state, 'conversation state row must exist');
      // 4. persisted conversation state becomes awaiting_service
      assert.equal(state!.step, 'awaiting_service');
      // 5. stale booking fields are cleared
      assert.equal(state!.selectedAppointmentTypeId, null);
      assert.equal(state!.selectedAppointmentTypeName, null);
      assert.equal(state!.selectedPractitionerId, null);
      assert.equal(state!.selectedDate, null);
      assert.equal(state!.selectedTime, null);
      const stateJson = (state!.stateJson ?? {}) as Record<string, unknown>;
      assert.equal(stateJson.lastBookingSummary, undefined, 'stale lastBookingSummary must be cleared');
      // 6. validated selectedPatientId is preserved
      assert.equal(stateJson.selectedPatientId, patient.id);

      // 9. no AppointmentRequest is created
      const requestCount = await prisma.appointmentRequest.count({ where: { clinicId: fixture.clinic.id } });
      assert.equal(requestCount, 1, 'only the pre-existing request should exist — none created');

      // 10. previous AppointmentRequest is not modified
      const requestAfter = await prisma.appointmentRequest.findUnique({ where: { id: priorRequest.id } });
      assert.ok(requestAfter);
      assert.equal(requestAfter!.status, priorRequest.status);
      assert.equal(requestAfter!.updatedAt.getTime(), priorRequest.updatedAt.getTime(), 'prior request must be untouched');

      await cleanupAllFixtures();
    },
  );

  section('processMetaWhatsAppIncomingMessage — post_booking negative cases must NOT trigger the fresh-booking transition (real handler path)');

  await test('"mevcut randevumu sil" at post_booking routes to human handoff (cancel_request), not a fresh booking', async () => {
    const fixture = await createFixture('cancelneg');
    await acceptConsent(fixture);
    const conversationKey = await createPostBookingState(fixture);

    const restoreFetch = mockSuccessfulMetaSend();
    let result;
    try {
      result = await processMetaWhatsAppIncomingMessage({
        organizationId: fixture.organization.id,
        clinicId: fixture.clinic.id,
        connectionId: fixture.connection.id,
        phone: fixture.phone,
        messageId: `wamid.in.${fixture.suffix}`,
        text: 'mevcut randevumu sil',
      });
    } finally {
      restoreFetch();
    }

    assert.equal(result.status, 'processed');
    assert.notEqual(result.replyText, GENERIC_POST_BOOKING_FALLBACK);
    for (const service of fixture.services) {
      assert.ok(!result.replyText.includes(service.name), 'must NOT send the fresh-booking service list');
    }

    const state = await readState(fixture, conversationKey);
    assert.ok(state);
    assert.notEqual(state!.step, 'awaiting_service');

    const requestCount = await prisma.appointmentRequest.count({ where: { clinicId: fixture.clinic.id } });
    assert.equal(requestCount, 0, 'cancel_request must never create an AppointmentRequest');

    const contactRequestCount = await prisma.contactRequest.count({ where: { clinicId: fixture.clinic.id, type: 'staff_handoff' } });
    assert.equal(contactRequestCount, 1, 'cancel_request routes to a staff handoff, not silence or a new booking');

    await cleanupAllFixtures();
  });

  section('processMetaWhatsAppIncomingMessage — shared-phone safety (real handler path)');

  await test(
    'an unresolved multi-patient/shared-phone situation is intercepted before it can ever reach the post_booking new-booking transition',
    async () => {
      const fixture = await createFixture('sharedphone');
      await acceptConsent(fixture);

      // Two patients share this phone and no selectedPatientId has been
      // recorded — identity is genuinely ambiguous.
      await prisma.patient.create({
        data: { clinicId: fixture.clinic.id, organizationId: fixture.organization.id, firstName: 'Mehmet', lastName: 'Yılmaz', phone: fixture.phone },
      });
      await prisma.patient.create({
        data: { clinicId: fixture.clinic.id, organizationId: fixture.organization.id, firstName: 'Zeynep', lastName: 'Yılmaz', phone: fixture.phone },
      });

      const conversationKey = await createPostBookingState(fixture, { customerName: null, stateJson: {} });

      const restoreFetch = mockSuccessfulMetaSend();
      let result;
      try {
        result = await processMetaWhatsAppIncomingMessage({
          organizationId: fixture.organization.id,
          clinicId: fixture.clinic.id,
          connectionId: fixture.connection.id,
          phone: fixture.phone,
          messageId: `wamid.in.${fixture.suffix}`,
          text: 'yeni randevu almak istiyorum',
        });
      } finally {
        restoreFetch();
      }

      assert.equal(result.status, 'processed');
      // The shared-phone selection prompt, never the fresh-booking service list.
      assert.ok(result.replyText.includes('birden fazla hasta kaydı'), 'must ask which patient, not start a fresh booking');
      for (const service of fixture.services) {
        assert.ok(!result.replyText.includes(service.name), 'must NOT reach buildFreshBookingTransition\'s service list');
      }

      const state = await readState(fixture, conversationKey);
      assert.ok(state);
      assert.equal(state!.step, 'awaiting_patient_selection');
      assert.notEqual(state!.step, 'awaiting_service');
      const stateJson = (state!.stateJson ?? {}) as Record<string, unknown>;
      assert.equal((stateJson.pendingPatientOptions as unknown[] | undefined)?.length, 2);

      const requestCount = await prisma.appointmentRequest.count({ where: { clinicId: fixture.clinic.id } });
      assert.equal(requestCount, 0);

      await cleanupAllFixtures();
    },
  );

  section('Summary');
  console.log('\n─────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  await cleanupAllFixtures();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error('Test runner error:', err);
  await cleanupAllFixtures().catch(() => {});
  process.exit(1);
});
