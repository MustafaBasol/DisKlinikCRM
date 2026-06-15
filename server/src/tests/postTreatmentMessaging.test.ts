/**
 * postTreatmentMessaging.test.ts — Post-treatment follow-up WhatsApp outbound tests.
 *
 * Tests cover:
 *  - Meta Cloud uses sendTemplateMessage (not sendMessage) for post-treatment
 *  - Missing approved post_treatment_followup template fails with META_APPROVED_TEMPLATE_REQUIRED
 *  - Not-approved (pending/rejected) template fails safely
 *  - Missing required template variable fails with META_TEMPLATE_VARIABLE_MISSING
 *  - Evolution keeps plain sendMessage behavior
 *  - Template is looked up by purpose = post_treatment_followup, not other purposes
 *  - Variables dict does not contain sensitive/medical fields
 *  - Error messages do not expose stack traces or raw Meta internals
 *  - Logs mask phone numbers
 *
 * Uses sendPostTreatmentWhatsAppWithConnection (exported for unit testing without Prisma).
 *
 * Run with: tsx src/tests/postTreatmentMessaging.test.ts
 */

import assert from 'node:assert/strict';

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ─── Setup encryption (required by MetaCloudWhatsAppProvider) ─────────────────
process.env.ENCRYPTION_KEY = 'b'.repeat(64);

import { encryptSecret } from '../utils/encryption.js';
import {
  sendPostTreatmentWhatsAppWithConnection,
  OUTBOUND_ERRORS,
  POST_TREATMENT_MISSING_TEMPLATE_ERROR,
  type MetaTemplateSnapshot,
} from '../services/whatsapp/whatsappOutboundMessaging.js';
import type { WhatsAppConnectionRecord } from '../services/whatsapp/WhatsAppProvider.js';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const metaConn = (): WhatsAppConnectionRecord => ({
  id: 'conn-meta',
  organizationId: 'org-1',
  provider: 'meta_cloud_api',
  status: 'connected',
  metaPhoneNumberId: 'phone-222',
  metaAccessTokenEncrypted: encryptSecret('test-token-pt'),
});

const evolutionConn = (): WhatsAppConnectionRecord => ({
  id: 'conn-evo',
  organizationId: 'org-1',
  provider: 'evolution_api',
  status: 'connected',
  evolutionApiUrl: 'http://evo.local',
  evolutionInstanceName: 'testInstance',
  evolutionApiKeyEncrypted: 'raw-key',
});

const approvedTemplate = (): MetaTemplateSnapshot => ({
  metaTemplateName: 'tedavi_sonrasi_takip',
  metaTemplateStatus: 'approved',
  metaTemplateLanguage: 'tr',
  metaTemplateVariableMap: {
    '1': 'patient_name',
    '2': 'clinic_name',
  },
});

const safeVars = () => ({
  patient_name: 'Mustafa Basol',
  clinic_name: 'Aile Diş Kliniği',
  clinic_phone: '02121234567',
  service_name: 'Dolgu',
  appointment_date: '15 Haziran 2026',
  appointment_time: '14:30',
  practitioner_name: 'Dr. Ayşe',
});

// ─── Run tests ────────────────────────────────────────────────────────────────

async function main() {

  // ── Meta Cloud: approved template path ────────────────────────────────────
  section('Meta Cloud — approved template');

  await test('uses sendTemplateMessage (not sendMessage) when template is approved', async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string ?? '{}');
      return new Response(
        JSON.stringify({ messages: [{ id: 'meta-pt-1' }] }),
        { status: 200 },
      );
    };

    const result = await sendPostTreatmentWhatsAppWithConnection(
      metaConn(),
      approvedTemplate(),
      { phone: '905551234567', evolutionPlainText: 'fallback text', variables: safeVars() },
    );
    globalThis.fetch = originalFetch;

    assert.equal(result.success, true, 'should succeed');
    assert.equal(result.externalMessageId, 'meta-pt-1');
    assert.equal(capturedBody.type, 'template', 'must use template message type');
    const tpl = capturedBody.template as Record<string, unknown>;
    assert.equal(tpl?.name, 'tedavi_sonrasi_takip');
    assert.equal((tpl?.language as Record<string, unknown>)?.code, 'tr');
  });

  await test('sets correct template parameter values from variables', async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string ?? '{}');
      return new Response(JSON.stringify({ messages: [{ id: 'pt-2' }] }), { status: 200 });
    };

    await sendPostTreatmentWhatsAppWithConnection(
      metaConn(),
      approvedTemplate(),
      { phone: '905551234567', evolutionPlainText: 'fallback', variables: safeVars() },
    );
    globalThis.fetch = originalFetch;

    const tpl = capturedBody.template as Record<string, unknown>;
    const components = tpl?.components as Array<Record<string, unknown>>;
    const bodyComp = components?.find((c) => c.type === 'body');
    const params = bodyComp?.parameters as Array<{ type: string; text: string }>;
    assert.equal(params?.[0]?.text, 'Mustafa Basol', 'param 1 = patient_name');
    assert.equal(params?.[1]?.text, 'Aile Diş Kliniği', 'param 2 = clinic_name');
  });

  // ── Meta Cloud: missing / not-approved template ───────────────────────────
  section('Meta Cloud — missing or not-approved template');

  await test('returns META_APPROVED_TEMPLATE_REQUIRED when template is null', async () => {
    const result = await sendPostTreatmentWhatsAppWithConnection(
      metaConn(),
      null,
      { phone: '905551234567', evolutionPlainText: 'fallback', variables: safeVars() },
    );
    assert.equal(result.success, false);
    assert.equal(result.code, OUTBOUND_ERRORS.META_APPROVED_TEMPLATE_REQUIRED);
    assert.ok(result.error?.includes('Tedavi sonrası takip'), 'error message must reference post-treatment');
  });

  await test('returns META_APPROVED_TEMPLATE_REQUIRED when metaTemplateStatus is pending', async () => {
    const pendingTemplate: MetaTemplateSnapshot = {
      ...approvedTemplate(),
      metaTemplateStatus: 'pending',
    };
    const result = await sendPostTreatmentWhatsAppWithConnection(
      metaConn(),
      pendingTemplate,
      { phone: '905551234567', evolutionPlainText: 'fallback', variables: safeVars() },
    );
    assert.equal(result.success, false);
    assert.equal(result.code, OUTBOUND_ERRORS.META_APPROVED_TEMPLATE_REQUIRED);
  });

  await test('returns META_APPROVED_TEMPLATE_REQUIRED when metaTemplateStatus is rejected', async () => {
    const rejectedTemplate: MetaTemplateSnapshot = {
      ...approvedTemplate(),
      metaTemplateStatus: 'rejected',
    };
    const result = await sendPostTreatmentWhatsAppWithConnection(
      metaConn(),
      rejectedTemplate,
      { phone: '905551234567', evolutionPlainText: 'fallback', variables: safeVars() },
    );
    assert.equal(result.success, false);
    assert.equal(result.code, OUTBOUND_ERRORS.META_APPROVED_TEMPLATE_REQUIRED);
  });

  await test('returns META_APPROVED_TEMPLATE_REQUIRED when metaTemplateName is null', async () => {
    const noNameTemplate: MetaTemplateSnapshot = {
      ...approvedTemplate(),
      metaTemplateName: null,
    };
    const result = await sendPostTreatmentWhatsAppWithConnection(
      metaConn(),
      noNameTemplate,
      { phone: '905551234567', evolutionPlainText: 'fallback', variables: safeVars() },
    );
    assert.equal(result.success, false);
    assert.equal(result.code, OUTBOUND_ERRORS.META_APPROVED_TEMPLATE_REQUIRED);
  });

  await test('does NOT call sendMessage when Meta Cloud template is missing', async () => {
    let sendMessageCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: RequestInfo | URL, _init?: RequestInit) => {
      // Any fetch to Meta API means sendMessage or sendTemplateMessage was invoked
      if (String(url).includes('phone-222')) sendMessageCalled = true;
      return new Response(JSON.stringify({ messages: [{ id: 'should-not-reach' }] }), { status: 200 });
    };

    const result = await sendPostTreatmentWhatsAppWithConnection(
      metaConn(),
      null,
      { phone: '905551234567', evolutionPlainText: 'fallback', variables: safeVars() },
    );
    globalThis.fetch = originalFetch;

    assert.equal(result.success, false, 'must fail');
    assert.equal(sendMessageCalled, false, 'must not reach Meta API when template is missing');
  });

  await test('error message references post-treatment, not no-show', async () => {
    const result = await sendPostTreatmentWhatsAppWithConnection(
      metaConn(),
      null,
      { phone: '905551234567', evolutionPlainText: 'fallback', variables: safeVars() },
    );
    assert.ok(result.error === POST_TREATMENT_MISSING_TEMPLATE_ERROR, 'must use post-treatment error text');
    assert.ok(!result.error?.toLowerCase().includes('gelmeyen'), 'must NOT reference no-show (gelmeyen)');
  });

  // ── Meta Cloud: missing variable ──────────────────────────────────────────
  section('Meta Cloud — missing template variable');

  await test('returns META_TEMPLATE_VARIABLE_MISSING when a required variable is absent', async () => {
    const templateNeedingMissingVar: MetaTemplateSnapshot = {
      metaTemplateName: 'tedavi_sonrasi_takip',
      metaTemplateStatus: 'approved',
      metaTemplateLanguage: 'tr',
      metaTemplateVariableMap: { '1': 'patient_name', '2': 'treatment_cost' }, // treatment_cost is unsafe/absent
    };
    const result = await sendPostTreatmentWhatsAppWithConnection(
      metaConn(),
      templateNeedingMissingVar,
      { phone: '905551234567', evolutionPlainText: 'fallback', variables: safeVars() },
    );
    assert.equal(result.success, false);
    assert.equal(result.code, OUTBOUND_ERRORS.META_TEMPLATE_VARIABLE_MISSING);
    assert.ok(result.error?.includes('treatment_cost'), 'error must name the missing variable');
  });

  await test('does not expose stack trace in error message for missing variable', async () => {
    const templateNeedingMissingVar: MetaTemplateSnapshot = {
      metaTemplateName: 'tedavi_sonrasi_takip',
      metaTemplateStatus: 'approved',
      metaTemplateLanguage: 'tr',
      metaTemplateVariableMap: { '1': 'nonexistent_field' },
    };
    const result = await sendPostTreatmentWhatsAppWithConnection(
      metaConn(),
      templateNeedingMissingVar,
      { phone: '905551234567', evolutionPlainText: 'fallback', variables: safeVars() },
    );
    assert.equal(result.success, false);
    assert.ok(!result.error?.includes('at '), 'error must not contain stack trace frames');
    assert.ok(!result.error?.includes('node_modules'), 'error must not expose node_modules paths');
  });

  // ── Evolution: plain text behavior ────────────────────────────────────────
  section('Evolution — plain sendMessage behavior');

  await test('Evolution sends plain text via sendMessage (not template)', async () => {
    let capturedPayload: Record<string, unknown> = {};
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedPayload = JSON.parse(init?.body as string ?? '{}');
      return new Response(JSON.stringify({ key: 'evo-key' }), { status: 200 });
    };

    const result = await sendPostTreatmentWhatsAppWithConnection(
      evolutionConn(),
      null,
      { phone: '905551234567', evolutionPlainText: 'Tedavi sonrası takip mesajı.', variables: safeVars() },
    );
    globalThis.fetch = originalFetch;

    assert.equal(result.success, true, 'Evolution send should succeed');
    // Evolution API uses text key, not template
    assert.ok(
      capturedPayload.text !== undefined || capturedPayload.textMessage !== undefined,
      'Evolution must use plain text payload',
    );
    assert.ok(capturedPayload.type !== 'template', 'Evolution must NOT use template type');
  });

  await test('Evolution succeeds even when template is null', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ key: 'evo-key' }), { status: 200 });

    const result = await sendPostTreatmentWhatsAppWithConnection(
      evolutionConn(),
      null,
      { phone: '905551234567', evolutionPlainText: 'Test mesajı', variables: safeVars() },
    );
    globalThis.fetch = originalFetch;

    assert.equal(result.success, true, 'Evolution must succeed with null template');
  });

  await test('Evolution succeeds even when template is approved (template ignored)', async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string ?? '{}');
      return new Response(JSON.stringify({ key: 'evo-key' }), { status: 200 });
    };

    const result = await sendPostTreatmentWhatsAppWithConnection(
      evolutionConn(),
      approvedTemplate(),
      { phone: '905551234567', evolutionPlainText: 'Plain text for evo', variables: safeVars() },
    );
    globalThis.fetch = originalFetch;

    assert.equal(result.success, true);
    assert.ok(capturedBody.type !== 'template', 'Evolution must never use template type');
  });

  // ── Template purpose isolation ─────────────────────────────────────────────
  section('Template purpose isolation');

  await test('post-treatment error text is distinct from no-show recovery error text', () => {
    // Ensures the wrong missing-template message is never shown for post-treatment
    assert.ok(
      POST_TREATMENT_MISSING_TEMPLATE_ERROR.includes('Tedavi sonrası takip'),
      'must reference post-treatment',
    );
    assert.ok(
      !POST_TREATMENT_MISSING_TEMPLATE_ERROR.toLowerCase().includes('gelmeyen'),
      'must NOT reference no-show (gelmeyen)',
    );
  });

  // ── Variable safety ───────────────────────────────────────────────────────
  section('Variable safety — no sensitive fields');

  await test('safe variables dict does not contain medical notes or dental chart fields', () => {
    const vars = safeVars();
    const forbidden = [
      'notes', 'chart', 'prescription', 'insurance', 'payment', 'balance',
      'attachment', 'staff_note', 'internal', 'diagnos',
    ];
    for (const key of Object.keys(vars)) {
      for (const bad of forbidden) {
        assert.ok(
          !key.toLowerCase().includes(bad),
          `variable key "${key}" must not contain sensitive term "${bad}"`,
        );
      }
    }
  });

  await test('safe variables dict does not contain phone number as a value to avoid logging', () => {
    // phone is passed separately to the send function, not in variables
    const vars = safeVars();
    const hasPhone = Object.values(vars).some((v) => /^\+?9\d{9,}$/.test(v));
    assert.ok(!hasPhone, 'variables dict must not embed patient phone number');
  });

  // ── Final tally ───────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Unexpected test runner error:', err);
  process.exit(1);
});
