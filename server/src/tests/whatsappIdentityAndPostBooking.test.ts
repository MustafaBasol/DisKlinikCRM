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
} from '../services/whatsapp/metaWhatsAppAiProcessor.js';

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
