/**
 * whatsappOutboundMessaging.test.ts — Unit tests for the proactive outbound dispatcher.
 *
 * Covers: template parameter building, provider routing, missing template guard,
 * missing variable guard, and Evolution fallback.
 *
 * Run with:  tsx src/tests/whatsappOutboundMessaging.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
  buildTemplateComponents,
  sendProactiveWhatsAppMessageWithConnection,
  OUTBOUND_ERRORS,
} from '../services/whatsapp/whatsappOutboundMessaging.js';
import type { WhatsAppConnectionRecord } from '../services/whatsapp/WhatsAppProvider.js';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const metaConn = (): WhatsAppConnectionRecord => ({
  id: 'conn-meta',
  organizationId: 'org-1',
  provider: 'meta_cloud_api',
  status: 'connected',
  metaPhoneNumberId: 'phone-111',
  metaAccessTokenEncrypted: encryptSecret('test-token-abc'),
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

const approvedTemplate = () => ({
  metaTemplateName: 'randevu_hatirlatma',
  metaTemplateStatus: 'approved',
  metaTemplateLanguage: 'tr',
  metaTemplateVariableMap: {
    '1': 'patient_name',
    '2': 'clinic_name',
    '3': 'appointment_date',
    '4': 'appointment_time',
  },
});

const sampleVars = () => ({
  patient_name: 'Mustafa Basol',
  clinic_name: 'Aile Diş Kliniği',
  appointment_date: '15 Haziran',
  appointment_time: '14:30',
  practitioner_name: 'Dr. Ayşe',
  treatment_title: '',
  remaining_balance: '',
});

// ─── Run tests ────────────────────────────────────────────────────────────────

async function main() {

  // ── Template parameter mapping ─────────────────────────────────────────────
  section('Template parameter mapping');

  await test('builds ordered Meta template parameters from variableMap', () => {
    const result = buildTemplateComponents(
      { '1': 'patient_name', '2': 'clinic_name', '3': 'appointment_date' },
      { patient_name: 'Mustafa', clinic_name: 'Aile Diş', appointment_date: '15 Haz' },
    );
    assert.ok(!('code' in result), 'should not return error');
    if ('components' in result) {
      const body = (result.components as Array<Record<string, unknown>>)[0];
      assert.equal(body?.type, 'body');
      const params = body?.parameters as Array<{ type: string; text: string }>;
      assert.equal(params[0]?.text, 'Mustafa');
      assert.equal(params[1]?.text, 'Aile Diş');
      assert.equal(params[2]?.text, '15 Haz');
    }
  });

  await test('fails with META_TEMPLATE_VARIABLE_MISSING when required variable absent', () => {
    const result = buildTemplateComponents(
      { '1': 'patient_name', '2': 'missing_var' },
      { patient_name: 'Mustafa' }, // missing_var not present
    );
    assert.ok('code' in result, 'should return error');
    if ('code' in result) {
      assert.equal(result.code, OUTBOUND_ERRORS.META_TEMPLATE_VARIABLE_MISSING);
      assert.ok(result.error.includes('missing_var'));
    }
  });

  await test('ignores extra variables that are not in variableMap', () => {
    const result = buildTemplateComponents(
      { '1': 'patient_name' },
      { patient_name: 'Mustafa', extra_var: 'unused', another_extra: 'also unused' },
    );
    assert.ok(!('code' in result), 'extra vars must not cause error');
    if ('components' in result) {
      const params = ((result.components as Array<Record<string, unknown>>)[0]
        ?.parameters) as Array<{ type: string; text: string }>;
      assert.equal(params.length, 1);
      assert.equal(params[0]?.text, 'Mustafa');
    }
  });

  await test('sorts numeric keys correctly: 1,2,3,10 not 1,10,2,3', () => {
    const result = buildTemplateComponents(
      { '1': 'a', '2': 'b', '3': 'c', '10': 'd' },
      { a: 'A', b: 'B', c: 'C', d: 'D' },
    );
    assert.ok('components' in result, 'should succeed');
    if ('components' in result) {
      const params = ((result.components as Array<Record<string, unknown>>)[0]
        ?.parameters) as Array<{ type: string; text: string }>;
      assert.deepEqual(
        params.map((p) => p.text),
        ['A', 'B', 'C', 'D'], // 1, 2, 3, 10 — not 1, 10, 2, 3
      );
    }
  });

  // ── Meta Cloud provider behavior ───────────────────────────────────────────
  section('Meta Cloud provider behavior');

  await test('Meta Cloud proactive appointment reminder uses sendTemplateMessage', async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string ?? '{}');
      return new Response(
        JSON.stringify({ messages: [{ id: 'meta-msg-1' }] }),
        { status: 200 },
      );
    };

    const result = await sendProactiveWhatsAppMessageWithConnection(
      metaConn(),
      approvedTemplate(),
      { phone: '905551234567', text: 'fallback', variables: sampleVars() },
    );
    globalThis.fetch = originalFetch;

    assert.equal(result.success, true);
    assert.equal(result.externalMessageId, 'meta-msg-1');
    assert.equal(capturedBody.type, 'template');
    const tpl = capturedBody.template as Record<string, unknown>;
    assert.equal(tpl?.name, 'randevu_hatirlatma');
    assert.equal((tpl?.language as Record<string, unknown>)?.code, 'tr');
  });

  await test('Meta Cloud proactive payment reminder uses sendTemplateMessage', async () => {
    const originalFetch = globalThis.fetch;
    let calledUrl = '';
    globalThis.fetch = async (url: RequestInfo | URL, _init?: RequestInit) => {
      calledUrl = String(url);
      return new Response(
        JSON.stringify({ messages: [{ id: 'meta-msg-2' }] }),
        { status: 200 },
      );
    };

    const paymentTemplate = {
      metaTemplateName: 'odeme_hatirlatma',
      metaTemplateStatus: 'approved',
      metaTemplateLanguage: 'tr',
      metaTemplateVariableMap: { '1': 'patient_name', '2': 'clinic_name' },
    };

    const result = await sendProactiveWhatsAppMessageWithConnection(
      metaConn(),
      paymentTemplate,
      {
        phone: '905559876543',
        text: 'fallback',
        variables: { patient_name: 'Ahmet', clinic_name: 'Güneş Diş', remaining_balance: '' },
      },
    );
    globalThis.fetch = originalFetch;

    assert.equal(result.success, true);
    assert.ok(calledUrl.includes('phone-111/messages'));
  });

  await test('sendProactiveWhatsAppMessageWithConnection routes any approved template via sendTemplateMessage', async () => {
    // This tests the generic routing capability of the function — NOT the production
    // post-treatment queue (postTreatmentMessaging.ts is NOT migrated in this PR;
    // see test below that asserts postTreatmentMessaging.ts does not import sendProactiveWhatsAppMessage).
    const originalFetch = globalThis.fetch;
    let capturedComponents: unknown[] = [];
    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string ?? '{}') as Record<string, unknown>;
      const tpl = body.template as Record<string, unknown>;
      capturedComponents = tpl?.components as unknown[] ?? [];
      return new Response(JSON.stringify({ messages: [{ id: 'meta-msg-3' }] }), { status: 200 });
    };

    const genericTemplate = {
      metaTemplateName: 'genel_sablon',
      metaTemplateStatus: 'approved',
      metaTemplateLanguage: 'tr',
      metaTemplateVariableMap: { '1': 'patient_name', '2': 'clinic_name' },
    };

    const result = await sendProactiveWhatsAppMessageWithConnection(
      metaConn(),
      genericTemplate,
      {
        phone: '905553334455',
        text: 'fallback',
        variables: { patient_name: 'Zeynep', clinic_name: 'Aile Diş' },
      },
    );
    globalThis.fetch = originalFetch;

    assert.equal(result.success, true);
    // Verify template components were sent (not empty plain-text body)
    assert.ok(Array.isArray(capturedComponents) && capturedComponents.length > 0);
  });

  await test('Meta Cloud missing approved template → META_APPROVED_TEMPLATE_REQUIRED, no sendMessage call', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };

    const result = await sendProactiveWhatsAppMessageWithConnection(
      metaConn(),
      null, // no template
      { phone: '905551111111', text: 'fallback', variables: {} },
    );
    globalThis.fetch = originalFetch;

    assert.equal(result.success, false);
    assert.equal(result.code, OUTBOUND_ERRORS.META_APPROVED_TEMPLATE_REQUIRED);
    assert.equal(fetchCalled, false, 'sendMessage must NOT be called when template missing');
  });

  await test('Meta Cloud pending (not approved) template → META_APPROVED_TEMPLATE_REQUIRED', async () => {
    const pendingTemplate = {
      ...approvedTemplate(),
      metaTemplateStatus: 'submitted', // not yet approved
    };

    const result = await sendProactiveWhatsAppMessageWithConnection(
      metaConn(),
      pendingTemplate,
      { phone: '905552222222', text: 'fallback', variables: sampleVars() },
    );

    assert.equal(result.success, false);
    assert.equal(result.code, OUTBOUND_ERRORS.META_APPROVED_TEMPLATE_REQUIRED);
  });

  await test('Meta Cloud missing variable → META_TEMPLATE_VARIABLE_MISSING, provider not called', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };

    const templateWithExtraVar = {
      ...approvedTemplate(),
      metaTemplateVariableMap: {
        '1': 'patient_name',
        '2': 'nonexistent_variable', // not in variables
      },
    };

    const result = await sendProactiveWhatsAppMessageWithConnection(
      metaConn(),
      templateWithExtraVar,
      { phone: '905553333333', text: 'fallback', variables: { patient_name: 'Fatma' } },
    );
    globalThis.fetch = originalFetch;

    assert.equal(result.success, false);
    assert.equal(result.code, OUTBOUND_ERRORS.META_TEMPLATE_VARIABLE_MISSING);
    assert.equal(fetchCalled, false, 'provider must NOT be called when variable missing');
  });

  await test('Evolution provider uses sendMessage fallback (not sendTemplateMessage)', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init?.body as string ?? '{}');
      return new Response(JSON.stringify({ key: { id: 'evo-msg-1' } }), { status: 201 });
    };

    const result = await sendProactiveWhatsAppMessageWithConnection(
      evolutionConn(),
      null, // template irrelevant for Evolution
      { phone: '905554445566', text: 'Sayın Mustafa, randevunuz yarın.', variables: sampleVars() },
    );
    globalThis.fetch = originalFetch;

    assert.equal(result.success, true);
    // Evolution sendText endpoint, not Meta template endpoint
    assert.ok(capturedUrl.includes('sendText'), `Expected sendText URL, got: ${capturedUrl}`);
    assert.ok(!String(capturedBody.type ?? '').includes('template'), 'Must not send template type');
  });

  // ── Empty variable map edge cases ──────────────────────────────────────────
  section('Edge cases');

  await test('empty variableMap → components array is empty, send succeeds', async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string ?? '{}');
      return new Response(JSON.stringify({ messages: [{ id: 'meta-msg-4' }] }), { status: 200 });
    };

    const noVarTemplate = {
      metaTemplateName: 'genel_bilgi',
      metaTemplateStatus: 'approved',
      metaTemplateLanguage: 'tr',
      metaTemplateVariableMap: null, // no variables in template
    };

    const result = await sendProactiveWhatsAppMessageWithConnection(
      metaConn(),
      noVarTemplate,
      { phone: '905556667788', text: 'fallback', variables: {} },
    );
    globalThis.fetch = originalFetch;

    assert.equal(result.success, true);
    // No components should be sent when no variables
    const tpl = capturedBody.template as Record<string, unknown>;
    assert.ok(
      !tpl?.components || (tpl.components as unknown[]).length === 0,
      'No body component should be sent for no-variable template',
    );
  });

  await test('empty string variable value is allowed (not treated as missing)', () => {
    const result = buildTemplateComponents(
      { '1': 'patient_name', '2': 'remaining_balance' },
      { patient_name: 'Ahmet', remaining_balance: '' }, // empty string is present
    );
    assert.ok(!('code' in result), 'empty string variable must not fail');
    if ('components' in result) {
      const params = ((result.components as Array<Record<string, unknown>>)[0]
        ?.parameters) as Array<{ type: string; text: string }>;
      assert.equal(params[1]?.text, '');
    }
  });

  await test('Meta Cloud template send API error propagates as failure', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { message: 'Template param mismatch' } }), { status: 400 });

    const result = await sendProactiveWhatsAppMessageWithConnection(
      metaConn(),
      approvedTemplate(),
      { phone: '905558889900', text: 'fallback', variables: sampleVars() },
    );
    globalThis.fetch = originalFetch;

    assert.equal(result.success, false);
    assert.ok(result.error, 'error message must be present');
  });

  await test('Meta Cloud network error propagates as failure', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };

    const result = await sendProactiveWhatsAppMessageWithConnection(
      metaConn(),
      approvedTemplate(),
      { phone: '905558889901', text: 'fallback', variables: sampleVars() },
    );
    globalThis.fetch = originalFetch;

    assert.equal(result.success, false);
    assert.ok(result.error, 'error message must be present');
  });

  // ── Inbound / manual paths are unchanged (regression checks) ──────────────
  section('Inbound & manual paths (regression)');

  await test('inbound AI reply path uses sendMessage via whatsappService (not sendProactiveWhatsAppMessage)', () => {
    const src = readFileSync(fileURLToPath(new URL('../routes/whatsapp.ts', import.meta.url)), 'utf8');
    assert.ok(
      !src.includes('sendProactiveWhatsAppMessage'),
      'whatsapp.ts (inbound AI) must not import sendProactiveWhatsAppMessage',
    );
  });

  await test('manual staff inbox reply path does not import sendProactiveWhatsAppMessage', () => {
    const src = readFileSync(fileURLToPath(new URL('../routes/whatsappInbox.ts', import.meta.url)), 'utf8');
    assert.ok(
      !src.includes('sendProactiveWhatsAppMessage'),
      'whatsappInbox.ts must not import sendProactiveWhatsAppMessage',
    );
  });

  await test('noShows.ts (manual recovery) does not import sendProactiveWhatsAppMessage', () => {
    const src = readFileSync(fileURLToPath(new URL('../routes/noShows.ts', import.meta.url)), 'utf8');
    assert.ok(
      !src.includes('sendProactiveWhatsAppMessage'),
      'noShows.ts (manual staff action) must not import sendProactiveWhatsAppMessage',
    );
  });

  await test('postTreatmentMessaging.ts (queue processor) does not import sendProactiveWhatsAppMessage', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../services/postTreatmentMessaging.ts', import.meta.url)),
      'utf8',
    );
    assert.ok(
      !src.includes('sendProactiveWhatsAppMessage'),
      'postTreatmentMessaging.ts must not import sendProactiveWhatsAppMessage (PostTreatmentMessageTemplate has no Meta fields)',
    );
  });

  await test('reminders.ts imports sendProactiveWhatsAppMessage for appointment and payment jobs', () => {
    const src = readFileSync(fileURLToPath(new URL('../jobs/reminders.ts', import.meta.url)), 'utf8');
    assert.ok(
      src.includes('sendProactiveWhatsAppMessage'),
      'reminders.ts must import sendProactiveWhatsAppMessage for automated jobs',
    );
    assert.ok(
      src.includes('sendWhatsAppMessage'),
      'reminders.ts must still import sendWhatsAppMessage for practitioner schedule',
    );
  });

  // ─── Summary ────────────────────────────────────────────────────────────────

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error in test runner:', err);
  process.exit(1);
});
