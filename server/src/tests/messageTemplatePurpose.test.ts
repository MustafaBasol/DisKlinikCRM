/**
 * messageTemplatePurpose.test.ts — Tests for the MessageTemplate purpose field.
 *
 * Covers:
 *  1. Schema validation (no DB required)
 *  2. Reminder selection logic — selectBestTemplate pure function
 *  3. Source regression checks — reminders.ts uses purpose-based lookup
 *  4. UI regression checks — form and table include purpose
 *  5. Outbound safety regression — Meta Cloud still fails safely without approved template
 *
 * Run with: tsx src/tests/messageTemplatePurpose.test.ts
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

// ─── Imports ──────────────────────────────────────────────────────────────────

import { messageTemplateSchema, MESSAGE_TEMPLATE_PURPOSES } from '../schemas/index.js';
import { selectBestTemplate } from '../jobs/reminders.js';

// Setup for outbound safety test
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
import { encryptSecret } from '../utils/encryption.js';
import { sendProactiveWhatsAppMessageWithConnection, OUTBOUND_ERRORS } from '../services/whatsapp/whatsappOutboundMessaging.js';
import type { WhatsAppConnectionRecord } from '../services/whatsapp/WhatsAppProvider.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function src(relPath: string) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

function makeTemplate(id: string, updatedAt: Date) {
  return { id, updatedAt };
}

const metaConn = (): WhatsAppConnectionRecord => ({
  id: 'conn-meta',
  organizationId: 'org-1',
  provider: 'meta_cloud_api',
  status: 'connected',
  metaPhoneNumberId: 'phone-111',
  metaAccessTokenEncrypted: encryptSecret('test-token-abc'),
});

// ─── Run tests ────────────────────────────────────────────────────────────────

async function main() {

  // ── Schema validation ──────────────────────────────────────────────────────
  section('Schema validation');

  await test('messageTemplateSchema accepts a valid purpose', () => {
    const result = messageTemplateSchema.safeParse({
      name: 'Test',
      channel: 'whatsapp',
      body: 'Hello {{patient_name}}',
      language: 'tr',
      purpose: 'appointment_reminder',
    });
    assert.ok(result.success, `parse failed: ${JSON.stringify(!result.success && result.error.format())}`);
    assert.equal(result.data.purpose, 'appointment_reminder');
  });

  await test('messageTemplateSchema update (partial) accepts purpose', () => {
    const result = messageTemplateSchema.partial().safeParse({ purpose: 'payment_reminder' });
    assert.ok(result.success, 'partial schema must accept purpose alone');
    assert.equal(result.data?.purpose, 'payment_reminder');
  });

  await test('missing purpose defaults to general_message', () => {
    const result = messageTemplateSchema.safeParse({
      name: 'Test',
      channel: 'sms',
      body: 'Hello',
      language: 'en',
    });
    assert.ok(result.success);
    assert.equal(result.data.purpose, 'general_message');
  });

  await test('invalid purpose is rejected', () => {
    const result = messageTemplateSchema.safeParse({
      name: 'Test',
      channel: 'whatsapp',
      body: 'Hello',
      language: 'tr',
      purpose: 'invalid_purpose_value',
    });
    assert.ok(!result.success, 'invalid purpose must fail validation');
  });

  await test('all 6 defined purpose values are accepted', () => {
    for (const p of MESSAGE_TEMPLATE_PURPOSES) {
      const result = messageTemplateSchema.safeParse({
        name: 'Test',
        channel: 'sms',
        body: 'Hello',
        language: 'en',
        purpose: p,
      });
      assert.ok(result.success, `purpose "${p}" should be valid`);
    }
  });

  // ── selectBestTemplate pure function ───────────────────────────────────────
  section('Template selection logic (selectBestTemplate)');

  await test('returns null for empty list', () => {
    assert.equal(selectBestTemplate([], 'appointment_reminder', 'clinic-1'), null);
  });

  await test('returns the single template when only one exists', () => {
    const t1 = makeTemplate('t1', new Date('2026-06-01'));
    assert.equal(selectBestTemplate([t1], 'appointment_reminder', 'clinic-1')?.id, 't1');
  });

  await test('returns most recently updated when multiple templates exist', () => {
    const older = makeTemplate('t-old', new Date('2026-05-01'));
    const newer = makeTemplate('t-new', new Date('2026-06-14'));
    const mid   = makeTemplate('t-mid', new Date('2026-06-01'));
    const result = selectBestTemplate([older, mid, newer], 'appointment_reminder', 'clinic-1');
    assert.equal(result?.id, 't-new', 'should pick newest updatedAt');
  });

  await test('does not mutate the input array', () => {
    const templates = [
      makeTemplate('a', new Date('2026-06-14')),
      makeTemplate('b', new Date('2026-06-01')),
    ];
    const originalOrder = templates.map(t => t.id).join(',');
    selectBestTemplate(templates, 'payment_reminder', 'clinic-1');
    assert.equal(templates.map(t => t.id).join(','), originalOrder, 'input array must not be mutated');
  });

  // ── reminders.ts structure regression ─────────────────────────────────────
  section('reminders.ts — source regression (purpose-based lookup)');

  await test('reminders.ts uses findWhatsAppTemplateByPurpose (not name-based matching)', () => {
    const code = src('../jobs/reminders.ts');
    assert.ok(code.includes('findWhatsAppTemplateByPurpose'), 'must use purpose-based lookup');
    assert.ok(!code.includes("'Hatırlatma'") && !code.includes("'Reminder'") && !code.includes("'Hatirlama'"),
      'must not contain old name-based reminder strings');
  });

  await test("reminders.ts selects 'appointment_reminder' purpose for appointment job", () => {
    const code = src('../jobs/reminders.ts');
    assert.ok(code.includes("'appointment_reminder'"), "must query purpose = 'appointment_reminder'");
  });

  await test("reminders.ts selects 'payment_reminder' purpose for payment job", () => {
    const code = src('../jobs/reminders.ts');
    assert.ok(code.includes("'payment_reminder'"), "must query purpose = 'payment_reminder'");
    assert.ok(!code.includes("'Ödeme'") && !code.includes("'Odeme'") && !code.includes("'Payment'"),
      'must not contain old payment name-based strings');
  });

  // ── UI regression ──────────────────────────────────────────────────────────
  section('UI regression (source inspection)');

  await test('MessageTemplateForm.tsx includes purpose select field', () => {
    const code = src('../../../src/components/MessageTemplateForm.tsx');
    assert.ok(code.includes("formData.purpose"), 'form must include purpose in formData');
    assert.ok(code.includes('messageTemplates:purpose.label'), 'form must render purpose label from i18n');
    assert.ok(code.includes('PURPOSES'), 'form must iterate PURPOSES array');
  });

  await test('MessageTemplates.tsx table includes purpose column', () => {
    const code = src('../../../src/pages/MessageTemplates.tsx');
    assert.ok(code.includes('messageTemplates:purpose.label'), 'table header must use purpose i18n key');
    assert.ok(code.includes('template.purpose'), 'table row must render template.purpose');
  });

  await test('WhatsApp approval badges still present in MessageTemplates.tsx', () => {
    const code = src('../../../src/pages/MessageTemplates.tsx');
    assert.ok(code.includes('MetaApprovalBadge'), 'MetaApprovalBadge must still be present');
    assert.ok(code.includes('handleMetaSubmit'), 'WhatsApp approval submit action must still be present');
    assert.ok(code.includes('handleMetaSync'), 'WhatsApp approval sync action must still be present');
  });

  await test('WhatsApp channel hint still present in MessageTemplateForm.tsx', () => {
    const code = src('../../../src/components/MessageTemplateForm.tsx');
    assert.ok(code.includes('whatsappApproval.channelHint'), 'WhatsApp channel hint must remain in form');
  });

  // ── Outbound safety regression ─────────────────────────────────────────────
  section('Outbound safety regression');

  await test('Meta Cloud: no approved template → META_APPROVED_TEMPLATE_REQUIRED (no sendMessage)', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };

    const result = await sendProactiveWhatsAppMessageWithConnection(
      metaConn(),
      null,
      { phone: '905551234567', text: 'fallback', variables: {} },
    );
    globalThis.fetch = originalFetch;

    assert.equal(result.success, false);
    assert.equal(result.code, OUTBOUND_ERRORS.META_APPROVED_TEMPLATE_REQUIRED);
    assert.equal(fetchCalled, false, 'provider must NOT be called when no approved template');
  });

  // ─── Summary ─────────────────────────────────────────────────────────────

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error in test runner:', err);
  process.exit(1);
});
