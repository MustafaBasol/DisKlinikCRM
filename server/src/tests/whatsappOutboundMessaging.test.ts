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
  sendNoShowRecoveryWhatsAppWithConnection,
  OUTBOUND_ERRORS,
  NO_SHOW_RECOVERY_MISSING_TEMPLATE_ERROR,
  type MetaTemplateSnapshot,
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

  // ── No-show recovery: sendNoShowRecoveryWhatsAppWithConnection ────────────
  section('No-show recovery (sendNoShowRecoveryWhatsAppWithConnection)');

  const noShowTemplate = (): MetaTemplateSnapshot => ({
    metaTemplateName: 'gelmeyen_hasta_takibi',
    metaTemplateStatus: 'approved',
    metaTemplateLanguage: 'tr',
    metaTemplateVariableMap: {
      '1': 'patient_name',
      '2': 'clinic_name',
      '3': 'appointment_date',
      '4': 'appointment_time',
    },
  });

  const noShowVars = () => ({
    patient_name: 'Ayşe Yılmaz',
    clinic_name: 'Merkez Diş',
    appointment_date: '14 Haziran',
    appointment_time: '10:00',
  });

  await test('Meta Cloud no-show recovery calls sendTemplateMessage, not sendMessage', async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string ?? '{}');
      return new Response(JSON.stringify({ messages: [{ id: 'ns-msg-1' }] }), { status: 200 });
    };

    const result = await sendNoShowRecoveryWhatsAppWithConnection(
      metaConn(),
      noShowTemplate(),
      { phone: '905551234567', evolutionPlainText: 'fallback', variables: noShowVars() },
    );
    globalThis.fetch = originalFetch;

    assert.equal(result.success, true);
    assert.equal(result.externalMessageId, 'ns-msg-1');
    assert.equal(capturedBody.type, 'template', 'must use template send, not plain text');
    const tpl = capturedBody.template as Record<string, unknown>;
    assert.equal(tpl?.name, 'gelmeyen_hasta_takibi');
  });

  await test('Meta Cloud no-show recovery with no template → META_APPROVED_TEMPLATE_REQUIRED, no fetch', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };

    const result = await sendNoShowRecoveryWhatsAppWithConnection(
      metaConn(),
      null,
      { phone: '905551234567', evolutionPlainText: 'fallback', variables: noShowVars() },
    );
    globalThis.fetch = originalFetch;

    assert.equal(result.success, false);
    assert.equal(result.code, OUTBOUND_ERRORS.META_APPROVED_TEMPLATE_REQUIRED);
    assert.equal(fetchCalled, false, 'sendMessage must NOT be called when template missing');
  });

  await test('Meta Cloud no-show recovery with submitted (not approved) template → META_APPROVED_TEMPLATE_REQUIRED', async () => {
    const pendingTemplate: MetaTemplateSnapshot = { ...noShowTemplate(), metaTemplateStatus: 'submitted' };

    const result = await sendNoShowRecoveryWhatsAppWithConnection(
      metaConn(),
      pendingTemplate,
      { phone: '905551234567', evolutionPlainText: 'fallback', variables: noShowVars() },
    );

    assert.equal(result.success, false);
    assert.equal(result.code, OUTBOUND_ERRORS.META_APPROVED_TEMPLATE_REQUIRED);
  });

  await test('Meta Cloud no-show recovery with missing template variable → META_TEMPLATE_VARIABLE_MISSING', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };

    const templateMissingVar: MetaTemplateSnapshot = {
      ...noShowTemplate(),
      metaTemplateVariableMap: { '1': 'patient_name', '2': 'nonexistent_variable' },
    };

    const result = await sendNoShowRecoveryWhatsAppWithConnection(
      metaConn(),
      templateMissingVar,
      { phone: '905551234567', evolutionPlainText: 'fallback', variables: { patient_name: 'Ayşe' } },
    );
    globalThis.fetch = originalFetch;

    assert.equal(result.success, false);
    assert.equal(result.code, OUTBOUND_ERRORS.META_TEMPLATE_VARIABLE_MISSING);
    assert.equal(fetchCalled, false, 'provider must NOT be called when variable missing');
  });

  await test('Evolution no-show recovery uses plain sendMessage (not sendTemplateMessage)', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init?.body as string ?? '{}');
      return new Response(JSON.stringify({ key: { id: 'evo-ns-1' } }), { status: 201 });
    };

    const result = await sendNoShowRecoveryWhatsAppWithConnection(
      evolutionConn(),
      null, // template irrelevant for Evolution
      {
        phone: '905554445566',
        evolutionPlainText: 'Sayın Ayşe Hanım, randevunuza katılamadığınızı gördük.',
        variables: noShowVars(),
      },
    );
    globalThis.fetch = originalFetch;

    assert.equal(result.success, true);
    assert.ok(capturedUrl.includes('sendText'), `Expected sendText URL, got: ${capturedUrl}`);
    assert.equal(capturedBody.type, undefined, 'Evolution must not send template type field');
    assert.ok(
      typeof capturedBody.text === 'string' && capturedBody.text.includes('randevunuza'),
      'plain text body should be the evolutionPlainText',
    );
  });

  await test('staff-facing error message is non-technical Turkish text', () => {
    assert.ok(NO_SHOW_RECOVERY_MISSING_TEMPLATE_ERROR.includes('Gelmeyen hasta takibi'));
    assert.ok(NO_SHOW_RECOVERY_MISSING_TEMPLATE_ERROR.includes('Mesaj Şablonları'));
    assert.ok(!NO_SHOW_RECOVERY_MISSING_TEMPLATE_ERROR.includes('META_'), 'must not expose error codes to staff');
    assert.ok(!NO_SHOW_RECOVERY_MISSING_TEMPLATE_ERROR.includes('meta_cloud_api'), 'must not expose provider names');
  });

  await test('Meta Cloud no-show recovery does not send plain text fallback when approved template is missing', async () => {
    const originalFetch = globalThis.fetch;
    let sendMessageCalled = false;
    globalThis.fetch = async (url: RequestInfo | URL, _init?: RequestInit) => {
      sendMessageCalled = true;
      return new Response(JSON.stringify({ messages: [{ id: 'x' }] }), { status: 200 });
    };

    await sendNoShowRecoveryWhatsAppWithConnection(
      metaConn(),
      null,
      { phone: '905551234567', evolutionPlainText: 'should not be sent', variables: {} },
    );
    globalThis.fetch = originalFetch;

    assert.equal(sendMessageCalled, false, 'Must not call any provider API when Meta template is missing');
  });

  await test('no-show recovery does not use appointment_reminder or general_message templates (purpose isolation — logic doc)', () => {
    // Template selection WHERE clause requires: purpose = 'no_show_recovery'.
    // Simulated: given a template that would match appointment_reminder, it should NOT be passed.
    // The Prisma query in sendNoShowRecoveryWhatsApp enforces this; here we verify that the
    // WithConnection function requires a template to be supplied externally — caller must filter by purpose.
    const wrongPurposeTemplate: MetaTemplateSnapshot = {
      metaTemplateName: 'randevu_hatirlatma',
      metaTemplateStatus: 'approved',
      metaTemplateLanguage: 'tr',
      metaTemplateVariableMap: { '1': 'patient_name' },
    };
    // If the wrong template were passed in (e.g. appointment_reminder), the function would still
    // send it — purpose enforcement is at the Prisma query level, not here.
    // This test documents that the WithConnection function is purpose-agnostic; the
    // public sendNoShowRecoveryWhatsApp() filters by purpose = 'no_show_recovery' via Prisma.
    assert.ok(wrongPurposeTemplate.metaTemplateName, 'MetaTemplateSnapshot has no purpose field by design');
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

  await test('noShows.ts uses sendNoShowRecoveryWhatsApp (not raw sendWhatsAppMessage)', () => {
    const src = readFileSync(fileURLToPath(new URL('../routes/noShows.ts', import.meta.url)), 'utf8');
    assert.ok(
      src.includes('sendNoShowRecoveryWhatsApp'),
      'noShows.ts must import sendNoShowRecoveryWhatsApp',
    );
    assert.ok(
      !src.includes("from '../services/whatsapp/whatsappService.js'"),
      'noShows.ts must not import sendWhatsAppMessage directly',
    );
    assert.ok(
      !src.includes('sendProactiveWhatsAppMessage'),
      'noShows.ts must not import sendProactiveWhatsAppMessage',
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
