/**
 * whatsappIdentityAndPostBooking.test.ts — Regression tests for:
 *  - the extended step-aware NLU taxonomy (awaiting_date/awaiting_time escalation
 *    intents, awaiting_name, post_booking)
 *  - the isStuckBookingStep escape predicate now covering awaiting_name/post_booking
 *  - hasValidLastName, the placeholder-name guard used before creating a real
 *    Patient/AppointmentRequest
 *
 * These are pure, DB-free unit tests (this repo's test convention — see
 * whatsappStepAwareNlu.test.ts / patientSharedPhone.test.ts). The patient
 * creation/linking and AppointmentRequest paths in metaWhatsAppAiProcessor.ts use
 * the real Prisma client directly (like the rest of that file) and are not covered
 * by an isolated unit test here — see the PR description for why, and the manual
 * staging verification steps to run before deploying.
 *
 * Run with: cd server && npx tsx src/tests/whatsappIdentityAndPostBooking.test.ts
 */

import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY = 'c'.repeat(64);
delete process.env.GOOGLE_AI_STUDIO_API_KEY;
delete process.env.GEMINI_API_KEY;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

import {
  resolveStepAwareWhatsAppIntent,
  type ResolveStepAwareWhatsAppIntentArgs,
} from '../services/whatsappStepAwareNlu.js';
import type { BookingServiceOption } from '../services/whatsappBookingFlow.js';
import {
  isStuckBookingStep,
  hasValidLastName,
  buildFreshBookingTransition,
} from '../services/whatsapp/metaWhatsAppAiProcessor.js';

// The exact generic dead-end reply the post_booking step used to send for any
// unrecognized message (production defect: a new-booking request never left
// this fallback). A regression must never produce this text for a clear
// new-booking request.
const GENERIC_POST_BOOKING_FALLBACK =
  'Randevu talebinizin durumunu sorabilir, saat veya tarih değişikliği isteyebilir, iptal talep edebilir ya da yetkili biriyle görüşmek isteyebilirsiniz. Nasıl yardımcı olabilirim?';

const SERVICES: BookingServiceOption[] = [
  { id: 'svc-1', name: 'Diş Taşı Temizliği', durationMinutes: 30 },
  { id: 'svc-2', name: 'Ağız, Diş ve Çene Cerrahisi', durationMinutes: 60 },
];

function baseArgs(overrides: Partial<ResolveStepAwareWhatsAppIntentArgs>): ResolveStepAwareWhatsAppIntentArgs {
  return {
    clinicId: 'clinic-1',
    phone: 'whatsapp:conn-1:33753849141',
    currentStep: 'awaiting_date',
    currentIntent: 'book_appointment',
    lastMessage: null,
    userText: '',
    availableServices: SERVICES,
    selectedService: null,
    selectedDate: null,
    selectedTime: null,
    ...overrides,
  };
}

async function main() {
  section('resolveStepAwareWhatsAppIntent — awaiting_date extras');

  await test('"hizmeti değiştirmek istiyorum" at awaiting_date classifies as change_service', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'awaiting_date', userText: 'hizmeti değiştirmek istiyorum' }),
    );
    assert.equal(decision.intent, 'change_service');
  });

  await test('"hangi günler uygunsunuz" at awaiting_date classifies as ask_available_dates', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'awaiting_date', userText: 'hangi günler uygunsunuz' }),
    );
    assert.equal(decision.intent, 'ask_available_dates');
  });

  section('resolveStepAwareWhatsAppIntent — awaiting_time extras');

  await test('"tarihi değiştirelim" at awaiting_time classifies as change_date (not left unresolved)', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'awaiting_time', userText: 'tarihi değiştirelim' }),
    );
    assert.equal(decision.intent, 'change_date');
  });

  await test('"hizmeti değiştirmek istiyorum" at awaiting_time classifies as change_service', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'awaiting_time', userText: 'hizmeti değiştirmek istiyorum' }),
    );
    assert.equal(decision.intent, 'change_service');
  });

  section('resolveStepAwareWhatsAppIntent — awaiting_name (name itself is never AI-classified)');

  await test('"neden istiyorsunuz" at awaiting_name classifies as ask_why_name_needed', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'awaiting_name', userText: 'neden istiyorsunuz' }),
    );
    assert.equal(decision.intent, 'ask_why_name_needed');
  });

  await test('awaiting_name decision never contains a name/patient field — actual name parsing stays deterministic', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'awaiting_name', userText: 'Ayşe Yılmaz' }),
    );
    const keys = Object.keys(decision);
    assert.ok(!keys.some(k => k.toLowerCase().includes('patient')));
    assert.ok(!keys.some(k => k.toLowerCase().includes('name')));
  });

  section('resolveStepAwareWhatsAppIntent — post_booking');

  await test('"teşekkürler" at post_booking classifies as gratitude', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'post_booking', userText: 'teşekkürler' }),
    );
    assert.equal(decision.intent, 'gratitude');
  });

  await test('"iyi günler" at post_booking classifies as closing, not greeting (context-dependent phrase)', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'post_booking', userText: 'iyi günler' }),
    );
    assert.equal(decision.intent, 'closing');
  });

  await test('"durumu nedir" at post_booking classifies as ask_request_status', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'post_booking', userText: 'durumu nedir' }),
    );
    assert.equal(decision.intent, 'ask_request_status');
  });

  await test('"saati değiştirmek istiyorum" at post_booking classifies as change_request', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'post_booking', userText: 'saati değiştirmek istiyorum' }),
    );
    assert.equal(decision.intent, 'change_request');
  });

  await test('"iptal etmek istiyorum" at post_booking classifies as cancel_request (not the generic cancel_flow)', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'post_booking', userText: 'iptal etmek istiyorum' }),
    );
    assert.equal(decision.intent, 'cancel_request');
  });

  await test('unrelated text at post_booking classifies as unknown_post_booking_request (not a raw dead-end)', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'post_booking', userText: 'asdkjaskjd' }),
    );
    assert.equal(decision.intent, 'unknown_post_booking_request');
  });

  await test('"temsilciyle görüşmek istiyorum" at post_booking is still human_handoff (general intents take priority)', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'post_booking', userText: 'temsilciyle görüşmek istiyorum' }),
    );
    assert.equal(decision.intent, 'human_handoff');
  });

  section('resolveStepAwareWhatsAppIntent — post_booking new-booking recognition (production defect)');

  const NEW_BOOKING_PHRASES = [
    'randevu almak istiyorum',
    'yeni randevu almak istiyorum',
    'başka bir randevu almak istiyorum',
    'yeni randevu',
    'randevu',
    'tekrar randevu oluşturmak istiyorum',
    'başka randevu oluştur',
    'yeniden randevu almak istiyorum',
  ];

  for (const phrase of NEW_BOOKING_PHRASES) {
    await test(`"${phrase}" at post_booking classifies as new_booking_request (not unknown_post_booking_request)`, async () => {
      const { decision } = await resolveStepAwareWhatsAppIntent(
        baseArgs({ currentStep: 'post_booking', userText: phrase }),
      );
      assert.equal(decision.intent, 'new_booking_request');
    });
  }

  await test('"randevumu iptal etmek istiyorum" still classifies as cancel_request, not new_booking_request (specific intent keeps priority over the bare "randevu" match)', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'post_booking', userText: 'randevumu iptal etmek istiyorum' }),
    );
    assert.equal(decision.intent, 'cancel_request');
  });

  await test('"randevu durumu ne" still classifies as ask_request_status, not new_booking_request', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'post_booking', userText: 'randevu durumu ne' }),
    );
    assert.equal(decision.intent, 'ask_request_status');
  });

  await test('new_booking_request is only recognized at post_booking, not injected into other steps\' allowed intents', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'awaiting_date', userText: 'randevu almak istiyorum' }),
    );
    assert.notEqual(decision.intent, 'new_booking_request');
  });

  section('buildFreshBookingTransition — post_booking → fresh booking entry (production defect fix)');

  const SERVICES_FOR_TRANSITION: Array<{ id: string; name: string; durationMinutes: number }> = [
    { id: 'svc-1', name: 'Diş Taşı Temizliği', durationMinutes: 30 },
    { id: 'svc-2', name: 'Ağız, Diş ve Çene Cerrahisi', durationMinutes: 60 },
  ];

  await test('leaves post_booking and lands on awaiting_service, not the generic fallback', () => {
    const { stateUpdate, reply } = buildFreshBookingTransition({
      customerName: 'Ayşe Yılmaz',
      services: SERVICES_FOR_TRANSITION,
      selectedPatientId: 'patient-1',
      text: 'yeni randevu almak istiyorum',
      messageId: 'wamid.1',
    });
    assert.equal(stateUpdate.step, 'awaiting_service');
    assert.notEqual(stateUpdate.step, 'post_booking');
    assert.equal(stateUpdate.currentIntent, 'book_appointment');
    assert.notEqual(reply, GENERIC_POST_BOOKING_FALLBACK);
  });

  await test('sends the real active service list', () => {
    const { reply } = buildFreshBookingTransition({
      customerName: 'Ayşe Yılmaz',
      services: SERVICES_FOR_TRANSITION,
      selectedPatientId: null,
      text: 'randevu almak istiyorum',
      messageId: null,
    });
    for (const service of SERVICES_FOR_TRANSITION) {
      assert.ok(reply.includes(service.name), `reply should list "${service.name}"`);
    }
  });

  await test('clears stale service/date/time/practitioner fields from the previous booking', () => {
    const { stateUpdate } = buildFreshBookingTransition({
      customerName: 'Ayşe Yılmaz',
      services: SERVICES_FOR_TRANSITION,
      selectedPatientId: null,
      text: 'randevu almak istiyorum',
      messageId: null,
    });
    assert.equal(stateUpdate.selectedAppointmentTypeId, null);
    assert.equal(stateUpdate.selectedAppointmentTypeName, null);
    assert.equal(stateUpdate.selectedPractitionerId, null);
    assert.equal(stateUpdate.selectedDate, null);
    assert.equal(stateUpdate.selectedTime, null);
  });

  await test('preserves a validated selectedPatientId (resolved existing patient is not forced through identity collection again)', () => {
    const { stateUpdate } = buildFreshBookingTransition({
      customerName: 'Ayşe Yılmaz',
      services: SERVICES_FOR_TRANSITION,
      selectedPatientId: 'patient-42',
      text: 'randevu almak istiyorum',
      messageId: null,
    });
    assert.deepEqual(stateUpdate.stateJson, { selectedPatientId: 'patient-42' });
  });

  await test('does not fabricate a patient identity when none was resolved', () => {
    const { stateUpdate } = buildFreshBookingTransition({
      customerName: null,
      services: SERVICES_FOR_TRANSITION,
      selectedPatientId: null,
      text: 'randevu almak istiyorum',
      messageId: null,
    });
    assert.equal(stateUpdate.stateJson, null);
  });

  await test('does not reference AppointmentRequest creation — the previous request is left untouched', () => {
    const { stateUpdate, reply } = buildFreshBookingTransition({
      customerName: 'Ayşe Yılmaz',
      services: SERVICES_FOR_TRANSITION,
      selectedPatientId: 'patient-1',
      text: 'randevu almak istiyorum',
      messageId: null,
    });
    // A fresh-booking transition only ever produces a conversation-state patch
    // and a reply string — it has no createAppointment/AppointmentRequest
    // dependency at all, so a previous request can never be modified,
    // cancelled, or duplicated merely by entering service selection again.
    assert.deepEqual(Object.keys(stateUpdate).sort(), [
      'currentIntent',
      'customerName',
      'lastMessage',
      'lastProviderMessageId',
      'selectedAppointmentTypeId',
      'selectedAppointmentTypeName',
      'selectedDate',
      'selectedPractitionerId',
      'selectedTime',
      'step',
      'stateJson',
    ].sort());
    assert.equal(typeof reply, 'string');
  });

  await test('falls back gracefully (no crash, no generic fallback) when no active services exist', () => {
    const { reply } = buildFreshBookingTransition({
      customerName: 'Ayşe Yılmaz',
      services: [],
      selectedPatientId: null,
      text: 'randevu almak istiyorum',
      messageId: null,
    });
    assert.notEqual(reply, GENERIC_POST_BOOKING_FALLBACK);
    assert.equal(typeof reply, 'string');
    assert.ok(reply.length > 0);
  });

  section('isStuckBookingStep — human-handoff escape now covers name collection and post-booking');

  await test('isStuckBookingStep is true for awaiting_name and post_booking', () => {
    assert.equal(isStuckBookingStep('awaiting_name'), true);
    assert.equal(isStuckBookingStep('post_booking'), true);
  });

  section('hasValidLastName — placeholder-name guard before creating a real Patient/AppointmentRequest');

  await test('rejects empty, placeholder, and "-" last names', () => {
    assert.equal(hasValidLastName(''), false);
    assert.equal(hasValidLastName(null), false);
    assert.equal(hasValidLastName('-'), false);
    assert.equal(hasValidLastName('bilinmiyor'), false);
    assert.equal(hasValidLastName('unknown'), false);
  });

  await test('accepts a real last name', () => {
    assert.equal(hasValidLastName('Duman'), true);
  });

  section('Summary');
  console.log('\n─────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
