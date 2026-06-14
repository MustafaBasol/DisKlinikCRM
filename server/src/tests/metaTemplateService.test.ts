/**
 * metaTemplateService.test.ts — Unit tests for Meta WhatsApp template management.
 *
 * Tests: name sanitisation, variable conversion, Meta API calls (fetch-mocked),
 * missing config error paths, status normalisation.
 *
 * Run with:  tsx src/tests/metaTemplateService.test.ts
 * No external test framework required.
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

// ─── Setup encryption (required for resolveAccessToken in service) ─────────────
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

import { encryptSecret } from '../utils/encryption.js';
import {
  sanitizeMetaTemplateName,
  convertBodyToMeta,
  createMetaTemplate,
  fetchMetaTemplateStatus,
  META_ERRORS,
} from '../services/metaTemplateService.js';
import type { WhatsAppConnectionRecord } from '../services/whatsapp/WhatsAppProvider.js';

// ─── Base connection for Meta tests ───────────────────────────────────────────

const baseConn: WhatsAppConnectionRecord = {
  id: 'conn-test',
  organizationId: 'org-1',
  provider: 'meta_cloud_api',
  status: 'connected',
};

const connWithWaba = (token?: string): WhatsAppConnectionRecord => ({
  ...baseConn,
  metaWabaId: 'waba-123456',
  metaPhoneNumberId: 'phone-987654',
  metaAccessTokenEncrypted: token ?? encryptSecret('test-access-token'),
});

// ─── Run tests ────────────────────────────────────────────────────────────────

async function main() {

  // ── sanitizeMetaTemplateName ───────────────────────────────────────────────
  section('sanitizeMetaTemplateName');

  await test('converts spaces to underscores and lowercases', () => {
    assert.equal(sanitizeMetaTemplateName('Hello World'), 'hello_world');
  });

  await test('handles Turkish characters (ş ğ ü ı ö ç)', () => {
    const result = sanitizeMetaTemplateName('Randevu Hatırlatma Şablonu');
    assert.ok(/^[a-z0-9_]+$/.test(result), `Expected safe name, got: ${result}`);
    assert.ok(!result.includes('ş') && !result.includes('ı'), `Turkish chars remain: ${result}`);
  });

  await test('collapses multiple special chars into single underscore', () => {
    assert.equal(sanitizeMetaTemplateName('24 Saat -- Randevu!'), '24_saat_randevu');
  });

  await test('trims leading/trailing underscores', () => {
    const result = sanitizeMetaTemplateName('  !!! hello !!! ');
    assert.ok(!result.startsWith('_'), `Starts with underscore: ${result}`);
    assert.ok(!result.endsWith('_'), `Ends with underscore: ${result}`);
  });

  await test('falls back to "template" for empty/symbol-only names', () => {
    assert.equal(sanitizeMetaTemplateName('!!!'), 'template');
    assert.equal(sanitizeMetaTemplateName('   '), 'template');
  });

  await test('truncates at 512 chars', () => {
    const long = 'a'.repeat(600);
    assert.equal(sanitizeMetaTemplateName(long).length, 512);
  });

  await test('produces deterministic output', () => {
    const name = 'Randevu Onayı';
    assert.equal(sanitizeMetaTemplateName(name), sanitizeMetaTemplateName(name));
  });

  // ── convertBodyToMeta ──────────────────────────────────────────────────────
  section('convertBodyToMeta');

  await test('converts named variables to numbered placeholders', () => {
    const body = 'Merhaba {{patient_name}}, {{clinic_name}} randevunuz {{appointment_date}}.';
    const { metaBody, variableMap } = convertBodyToMeta(body);
    assert.equal(metaBody, 'Merhaba {{1}}, {{2}} randevunuz {{3}}.');
    assert.deepEqual(variableMap, { '1': 'patient_name', '2': 'clinic_name', '3': 'appointment_date' });
  });

  await test('handles body with no variables', () => {
    const body = 'Teşekkür ederiz.';
    const { metaBody, variableMap } = convertBodyToMeta(body);
    assert.equal(metaBody, body);
    assert.deepEqual(variableMap, {});
  });

  await test('deduplicates repeated variables (same number reused)', () => {
    const body = '{{patient_name}} ve tekrar {{patient_name}}';
    const { metaBody, variableMap } = convertBodyToMeta(body);
    assert.equal(metaBody, '{{1}} ve tekrar {{1}}');
    assert.deepEqual(variableMap, { '1': 'patient_name' });
  });

  await test('full CRM → Meta conversion (4 variables)', () => {
    const body = 'Sayın {{patient_name}}, {{clinic_name}} randevunuz {{appointment_date}} saat {{appointment_time}}.';
    const { metaBody, variableMap } = convertBodyToMeta(body);
    assert.equal(metaBody, 'Sayın {{1}}, {{2}} randevunuz {{3}} saat {{4}}.');
    assert.deepEqual(variableMap, {
      '1': 'patient_name',
      '2': 'clinic_name',
      '3': 'appointment_date',
      '4': 'appointment_time',
    });
  });

  await test('handles whitespace inside braces ({{ patient_name }})', () => {
    const body = 'Merhaba {{ patient_name }}!';
    const { metaBody, variableMap } = convertBodyToMeta(body);
    assert.equal(metaBody, 'Merhaba {{1}}!');
    assert.equal(variableMap['1'], 'patient_name');
  });

  // ── createMetaTemplate — missing config paths ──────────────────────────────
  section('createMetaTemplate — missing config');

  await test('missing metaWabaId → META_WABA_ID_MISSING', async () => {
    const result = await createMetaTemplate(baseConn, {
      templateName: 'test_template',
      languageCode: 'tr',
      category: 'utility',
      metaBody: 'Hello {{1}}',
      variableMap: { '1': 'patient_name' },
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.code, META_ERRORS.WABA_ID_MISSING);
    }
  });

  await test('missing access token → META_ACCESS_TOKEN_MISSING', async () => {
    const conn: WhatsAppConnectionRecord = { ...baseConn, metaWabaId: 'waba-123' };
    const result = await createMetaTemplate(conn, {
      templateName: 'test_template',
      languageCode: 'tr',
      category: 'utility',
      metaBody: 'Hello',
      variableMap: {},
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.code, META_ERRORS.ACCESS_TOKEN_MISSING);
    }
  });

  // ── createMetaTemplate — fetch mocked ─────────────────────────────────────
  section('createMetaTemplate — fetch mocked');

  await test('successful submission returns metaTemplateId', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init?.body as string ?? '{}');
      return new Response(JSON.stringify({ id: 'meta-tpl-id-999' }), { status: 200 });
    };

    const result = await createMetaTemplate(connWithWaba(), {
      templateName: 'randevu_hatirlatma',
      languageCode: 'tr',
      category: 'utility',
      metaBody: 'Merhaba {{1}}, randevunuz {{2}}.',
      variableMap: { '1': 'patient_name', '2': 'appointment_date' },
    });

    globalThis.fetch = originalFetch;

    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.metaTemplateId, 'meta-tpl-id-999');
    }
    assert.ok(capturedUrl.includes('waba-123456/message_templates'));
    assert.equal(capturedBody.name, 'randevu_hatirlatma');
    assert.equal(capturedBody.category, 'UTILITY');
    assert.equal(capturedBody.language, 'tr');
  });

  await test('access token is never returned in error response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
      JSON.stringify({ error: { message: 'Invalid token' } }),
      { status: 400 },
    );
    const result = await createMetaTemplate(connWithWaba(encryptSecret('super-secret-token')), {
      templateName: 'bad_template',
      languageCode: 'tr',
      category: 'utility',
      metaBody: 'Hi',
      variableMap: {},
    });
    globalThis.fetch = originalFetch;

    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(!result.message.includes('super-secret-token'), 'Token must not appear in error message');
    }
  });

  await test('Meta API error → META_TEMPLATE_SUBMIT_FAILED code', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
      JSON.stringify({ error: { message: 'Template name already exists' } }),
      { status: 400 },
    );
    const result = await createMetaTemplate(connWithWaba(), {
      templateName: 'duplicate_name',
      languageCode: 'en',
      category: 'utility',
      metaBody: 'Hi',
      variableMap: {},
    });
    globalThis.fetch = originalFetch;

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.code, META_ERRORS.SUBMIT_FAILED);
    }
  });

  await test('network error → META_TEMPLATE_SUBMIT_FAILED with safe message', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    const result = await createMetaTemplate(connWithWaba(), {
      templateName: 'network_fail',
      languageCode: 'en',
      category: 'utility',
      metaBody: 'Hi',
      variableMap: {},
    });
    globalThis.fetch = originalFetch;

    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.code, META_ERRORS.SUBMIT_FAILED);
    }
  });

  await test('body with variables includes example component', async () => {
    const originalFetch = globalThis.fetch;
    let capturedComponents: unknown[] = [];
    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string ?? '{}') as Record<string, unknown>;
      capturedComponents = (body.components ?? []) as unknown[];
      return new Response(JSON.stringify({ id: 'tpl-1' }), { status: 200 });
    };

    await createMetaTemplate(connWithWaba(), {
      templateName: 'with_vars',
      languageCode: 'tr',
      category: 'utility',
      metaBody: 'Hi {{1}}',
      variableMap: { '1': 'patient_name' },
    });
    globalThis.fetch = originalFetch;

    assert.ok(capturedComponents.length > 0, 'Must send components');
    const bodyComp = (capturedComponents as Array<Record<string, unknown>>).find((c) => c.type === 'BODY');
    assert.ok(bodyComp, 'Must have BODY component');
    const example = bodyComp?.example as Record<string, unknown> | undefined;
    assert.ok(example?.body_text, 'Must include example.body_text');
  });

  // ── fetchMetaTemplateStatus ────────────────────────────────────────────────
  section('fetchMetaTemplateStatus');

  await test('APPROVED → normalised to "approved"', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
      JSON.stringify({ data: [{ name: 'randevu_hatirlat', status: 'APPROVED', id: 'tpl-1' }] }),
      { status: 200 },
    );
    const result = await fetchMetaTemplateStatus(connWithWaba(), 'randevu_hatirlat');
    globalThis.fetch = originalFetch;

    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.status, 'approved');
      assert.equal(result.rejectionReason, null);
    }
  });

  await test('REJECTED → normalised to "rejected" with rejection reason', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
      JSON.stringify({ data: [{ name: 'bad_template', status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' }] }),
      { status: 200 },
    );
    const result = await fetchMetaTemplateStatus(connWithWaba(), 'bad_template');
    globalThis.fetch = originalFetch;

    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.status, 'rejected');
      assert.equal(result.rejectionReason, 'INVALID_FORMAT');
    }
  });

  await test('PENDING → normalised to "submitted"', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
      JSON.stringify({ data: [{ name: 'pending_tpl', status: 'PENDING' }] }),
      { status: 200 },
    );
    const result = await fetchMetaTemplateStatus(connWithWaba(), 'pending_tpl');
    globalThis.fetch = originalFetch;

    assert.equal(result.success, true);
    if (result.success) assert.equal(result.status, 'submitted');
  });

  await test('empty data array → "unknown" status', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
      JSON.stringify({ data: [] }),
      { status: 200 },
    );
    const result = await fetchMetaTemplateStatus(connWithWaba(), 'nonexistent');
    globalThis.fetch = originalFetch;

    assert.equal(result.success, true);
    if (result.success) assert.equal(result.status, 'unknown');
  });

  await test('missing WABA ID → META_WABA_ID_MISSING', async () => {
    const result = await fetchMetaTemplateStatus(baseConn, 'some_template');
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.code, META_ERRORS.WABA_ID_MISSING);
  });

  await test('missing access token → META_ACCESS_TOKEN_MISSING', async () => {
    const conn: WhatsAppConnectionRecord = { ...baseConn, metaWabaId: 'waba-x' };
    const result = await fetchMetaTemplateStatus(conn, 'tpl');
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.code, META_ERRORS.ACCESS_TOKEN_MISSING);
  });

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error in test runner:', err);
  process.exit(1);
});
