/**
 * channelConsentFlowResume.test.ts — Regression tests for the channel-consent
 * flow-resume hotfix (branch fix/channel-consent-flow-resume).
 *
 * Bug: when channel consent (KVKK) was required mid-booking-flow (e.g. right
 * after the user answered "which date?"), the conversation state was wiped
 * (step/currentIntent set to null) instead of resumed, so after accepting
 * consent the bot fell back to "randevu almak veya bilgi sormak için
 * talebinizi yazabilirsiniz" instead of continuing the booking.
 *
 * These tests exercise the real exported helpers used by the three channel
 * processors (Evolution WhatsApp, Meta WhatsApp Cloud, Instagram) — not a
 * reimplementation — so they fail if the production logic regresses.
 *
 * Run with: cd server && npx tsx src/tests/channelConsentFlowResume.test.ts
 */

import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY = 'c'.repeat(64);
process.env.APP_BASE_URL = 'https://app.noramedi.com';

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
  CONSENT_RESUMABLE_STEPS as EvolutionResumableSteps,
  isConsentResumableStep as evolutionIsResumable,
  buildConsentResumeMessage as evolutionBuildResumeMessage,
  type AssistantService as EvolutionAssistantService,
  type ConversationStateJson as EvolutionStateJson,
} from '../routes/whatsapp.js';

import {
  CONSENT_RESUMABLE_STEPS as MetaResumableSteps,
  isConsentResumableStep as metaIsResumable,
  buildConsentResumeMessage as metaBuildResumeMessage,
  type MetaWaService,
  type MetaWaStateJson,
} from '../services/whatsapp/metaWhatsAppAiProcessor.js';

import {
  CONSENT_RESUMABLE_STEPS as InstagramResumableSteps,
  isConsentResumableStep as instagramIsResumable,
  buildConsentResumeMessage as instagramBuildResumeMessage,
  type InstagramAssistantService,
  type InstagramAssistantStateJson,
} from '../services/instagram/instagramAiConversationProcessor.js';

import { CONSENT_ACCEPTED_TEXT } from '../services/channelConsentGate.js';

const SERVICE: EvolutionAssistantService & MetaWaService & InstagramAssistantService = {
  id: 'svc-1',
  name: 'Ağız, Diş ve Çene Cerrahisi',
  durationMinutes: 30,
};

// ── Evolution WhatsApp (server/src/routes/whatsapp.ts) ─────────────────────────

section('Evolution WhatsApp — resumable step classification');

await test('awaiting_date is resumable', () => {
  assert.equal(evolutionIsResumable('awaiting_date'), true);
});

await test('awaiting_service, awaiting_time, awaiting_confirmation, awaiting_name, awaiting_patient_selection are resumable', () => {
  for (const step of ['awaiting_service', 'awaiting_time', 'awaiting_confirmation', 'awaiting_name', 'awaiting_patient_selection']) {
    assert.equal(evolutionIsResumable(step), true, `expected ${step} to be resumable`);
  }
});

await test('main_menu and null are NOT resumable (fresh conversations do not "resume")', () => {
  assert.equal(evolutionIsResumable('main_menu'), false);
  assert.equal(evolutionIsResumable(null), false);
  assert.equal(evolutionIsResumable(undefined), false);
});

await test('awaiting_channel_consent itself is not resumable (cannot resume into itself)', () => {
  assert.equal(evolutionIsResumable('awaiting_channel_consent'), false);
});

section('Evolution WhatsApp — resume message construction (no data loss)');

await test('awaiting_date resume message mentions the previously selected service and does not fall back to generic text', () => {
  const stateJson: EvolutionStateJson = {};
  const msg = evolutionBuildResumeMessage('awaiting_date', {
    services: [SERVICE],
    selectedAppointmentTypeName: SERVICE.name,
    selectedDate: null,
    stateJson,
  });
  assert.ok(msg.startsWith('Teşekkürler, onayınızı aldık.'));
  assert.ok(msg.includes(SERVICE.name), 'resume message should mention the already-selected service');
  assert.ok(msg.includes('hangi gün'));
  assert.notEqual(msg, CONSENT_ACCEPTED_TEXT);
});

await test('awaiting_date resume message falls back to a safe re-ask when service name is unknown (never invents facts)', () => {
  const msg = evolutionBuildResumeMessage('awaiting_date', {
    services: [SERVICE], selectedAppointmentTypeName: null, selectedDate: null, stateJson: {},
  });
  assert.ok(msg.includes('tekrar yazar mısınız'));
});

await test('awaiting_service resume message re-shows the service list', () => {
  const msg = evolutionBuildResumeMessage('awaiting_service', {
    services: [SERVICE], selectedAppointmentTypeName: null, selectedDate: null, stateJson: {},
  });
  assert.ok(msg.includes(SERVICE.name));
});

await test('awaiting_patient_selection resume message re-shows the preserved pendingPatientOptions list', () => {
  const stateJson: EvolutionStateJson = {
    pendingPatientOptions: [
      { id: 'p1', firstName: 'Ayşe', lastName: 'Yılmaz' },
      { id: 'p2', firstName: 'Ali', lastName: 'Yılmaz' },
    ],
  };
  const msg = evolutionBuildResumeMessage('awaiting_patient_selection', {
    services: [SERVICE], selectedAppointmentTypeName: null, selectedDate: null, stateJson,
  });
  assert.ok(msg.includes('Ayşe Yılmaz'));
  assert.ok(msg.includes('Ali Yılmaz'));
});

await test('CONSENT_RESUMABLE_STEPS covers all documented Evolution booking steps', () => {
  for (const step of ['awaiting_service', 'awaiting_date', 'awaiting_time', 'awaiting_name', 'awaiting_patient_selection', 'awaiting_confirmation']) {
    assert.ok(EvolutionResumableSteps.includes(step as typeof EvolutionResumableSteps[number]), `missing ${step}`);
  }
});

// ── Meta WhatsApp Cloud (server/src/services/whatsapp/metaWhatsAppAiProcessor.ts) ──

section('Meta WhatsApp Cloud — resumable step classification');

await test('awaiting_date, awaiting_service, awaiting_time, awaiting_confirmation, awaiting_patient_selection are resumable', () => {
  for (const step of ['awaiting_date', 'awaiting_service', 'awaiting_time', 'awaiting_confirmation', 'awaiting_patient_selection']) {
    assert.equal(metaIsResumable(step), true, `expected ${step} to be resumable`);
  }
});

await test('main_menu is not resumable', () => {
  assert.equal(metaIsResumable('main_menu'), false);
});

section('Meta WhatsApp Cloud — resume message construction');

await test('awaiting_date resume message mentions the previously selected service', () => {
  const stateJson: MetaWaStateJson = {};
  const msg = metaBuildResumeMessage('awaiting_date', {
    services: [SERVICE], selectedAppointmentTypeName: SERVICE.name, selectedDate: null, stateJson,
  });
  assert.ok(msg.includes(SERVICE.name));
  assert.notEqual(msg, CONSENT_ACCEPTED_TEXT);
});

await test('awaiting_patient_selection preserves selectedPatientId context (shared-phone scenario) via stateJson', () => {
  const stateJson: MetaWaStateJson = {
    selectedPatientId: 'patient-123',
    pendingPatientOptions: [{ id: 'patient-123', firstName: 'Ayşe', lastName: 'Yılmaz' }],
  };
  const msg = metaBuildResumeMessage('awaiting_patient_selection', {
    services: [SERVICE], selectedAppointmentTypeName: null, selectedDate: null, stateJson,
  });
  assert.ok(msg.includes('Ayşe Yılmaz'));
  // The resume message construction does not drop selectedPatientId from the stateJson it was given.
  assert.equal(stateJson.selectedPatientId, 'patient-123');
});

// ── Instagram (server/src/services/instagram/instagramAiConversationProcessor.ts) ──

section('Instagram — resumable step classification and resume messages');

await test('awaiting_date, awaiting_service, awaiting_time, awaiting_confirmation, awaiting_name, awaiting_phone are resumable', () => {
  for (const step of ['awaiting_date', 'awaiting_service', 'awaiting_time', 'awaiting_confirmation', 'awaiting_name', 'awaiting_phone']) {
    assert.equal(instagramIsResumable(step), true, `expected ${step} to be resumable`);
  }
});

await test('main_menu is not resumable', () => {
  assert.equal(instagramIsResumable('main_menu'), false);
});

await test('awaiting_date resume message mentions the previously selected service', () => {
  const stateJson: InstagramAssistantStateJson = {};
  const msg = instagramBuildResumeMessage('awaiting_date', {
    services: [SERVICE], selectedAppointmentTypeName: SERVICE.name, selectedDate: null, stateJson,
  });
  assert.ok(msg.includes(SERVICE.name));
});

await test('CONSENT_RESUMABLE_STEPS does not include awaiting_handoff_note (handoff notes should not silently resume booking)', () => {
  assert.equal(InstagramResumableSteps.includes('awaiting_handoff_note' as never), false);
});

// ── Final report ──────────────────────────────────────────────────────────────

console.log(`\n─────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
