/**
 * messageTemplateWabaBinding.test.ts — WhatsApp template ↔ connection/WABA scoping.
 *
 * A MessageTemplate submitted to Meta stores a snapshot of which WhatsApp
 * connection/WABA it was submitted against (metaTemplateConnectionId,
 * metaWabaIdSnapshot). Covers:
 *
 *  1. evaluateTemplateBinding pure logic — matched / unbound / mismatched
 *  2. Automations (isTemplateUsableForConnection) only use matched-binding templates
 *  3. Source regression — submit route persists the binding
 *  4. Source regression — sync route resolves the stored connection, not just the
 *     clinic default, and returns a mismatch error instead of syncing blindly
 *  5. Source regression — status/list responses never leak raw connection/WABA ids
 *  6. Clinic ownership check (resolveConnectionById logic, pure simulation)
 *
 * Run with: tsx src/tests/messageTemplateWabaBinding.test.ts
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

function src(relPath: string) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

// ─── Imports ──────────────────────────────────────────────────────────────────

import { evaluateTemplateBinding } from '../services/whatsapp/templateBinding.js';

process.env.ENCRYPTION_KEY = 'c'.repeat(64);
import { encryptSecret } from '../utils/encryption.js';
import {
  sendNoShowRecoveryWhatsAppWithConnection,
  OUTBOUND_ERRORS,
} from '../services/whatsapp/whatsappOutboundMessaging.js';
import type { WhatsAppConnectionRecord } from '../services/whatsapp/WhatsAppProvider.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const connA = (): WhatsAppConnectionRecord => ({
  id: 'conn-A',
  organizationId: 'org-1',
  provider: 'meta_cloud_api',
  status: 'connected',
  metaWabaId: 'waba-A',
  metaPhoneNumberId: 'phone-A',
  metaAccessTokenEncrypted: encryptSecret('token-A'),
});

const connB = (): WhatsAppConnectionRecord => ({
  id: 'conn-B',
  organizationId: 'org-1',
  provider: 'meta_cloud_api',
  status: 'connected',
  metaWabaId: 'waba-B',
  metaPhoneNumberId: 'phone-B',
  metaAccessTokenEncrypted: encryptSecret('token-B'),
});

async function main() {

  // ── evaluateTemplateBinding pure logic ────────────────────────────────────
  section('evaluateTemplateBinding — matched / unbound / mismatched');

  await test('no stored binding at all → unbound', () => {
    const status = evaluateTemplateBinding({ metaTemplateConnectionId: null, metaWabaIdSnapshot: null }, connA());
    assert.equal(status, 'unbound');
  });

  await test('stored connectionId but no waba snapshot → unbound', () => {
    const status = evaluateTemplateBinding(
      { metaTemplateConnectionId: 'conn-A', metaWabaIdSnapshot: null },
      connA(),
    );
    assert.equal(status, 'unbound');
  });

  await test('stored binding matches current connection id + wabaId → matched', () => {
    const status = evaluateTemplateBinding(
      { metaTemplateConnectionId: 'conn-A', metaWabaIdSnapshot: 'waba-A' },
      connA(),
    );
    assert.equal(status, 'matched');
  });

  await test('stored binding points at a different connection → mismatched', () => {
    const status = evaluateTemplateBinding(
      { metaTemplateConnectionId: 'conn-A', metaWabaIdSnapshot: 'waba-A' },
      connB(),
    );
    assert.equal(status, 'mismatched');
  });

  await test('same connection id but WABA changed underneath it → mismatched', () => {
    const rewiredConnA = { ...connA(), metaWabaId: 'waba-NEW' };
    const status = evaluateTemplateBinding(
      { metaTemplateConnectionId: 'conn-A', metaWabaIdSnapshot: 'waba-A' },
      rewiredConnA,
    );
    assert.equal(status, 'mismatched');
  });

  // ── Automation usability (approved template still requires matching binding) ─
  section('Automations — bound template usability');

  const boundNoShowTemplate = () => ({
    metaTemplateName: 'gelmeyen_hasta_takibi',
    metaTemplateStatus: 'approved',
    metaTemplateLanguage: 'tr',
    metaTemplateVariableMap: { '1': 'patient_name' },
    metaTemplateConnectionId: 'conn-A',
    metaWabaIdSnapshot: 'waba-A',
  });

  await test('approved template with matching stored WABA is usable by automation', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ messages: [{ id: 'ok-1' }] }), { status: 200 });

    const result = await sendNoShowRecoveryWhatsAppWithConnection(
      connA(),
      boundNoShowTemplate(),
      { phone: '905551234567', evolutionPlainText: 'fallback', variables: { patient_name: 'Ayşe' } },
    );
    globalThis.fetch = originalFetch;

    assert.equal(result.success, true, 'template bound to the active connection must be sendable');
  });

  await test('sendXxxWithConnection is purpose/binding-agnostic by design (enforcement lives in the outer query)', () => {
    // The *WithConnection functions accept whatever template the caller passes —
    // binding enforcement happens once, in the outer public function's DB query
    // (see isTemplateUsableForConnection in whatsappOutboundMessaging.ts), mirroring
    // how purpose filtering already works. This documents that boundary.
    const code = src('../services/whatsapp/whatsappOutboundMessaging.ts');
    assert.ok(code.includes('isTemplateUsableForConnection'), 'outer functions must gate template selection on binding');
    assert.ok(code.includes("evaluateTemplateBinding(template, connection) === 'matched'"), 'usability check must require an exact binding match');
  });

  // ── Source regression: submit route persists the binding ─────────────────
  section('Source regression — submit route');

  await test('meta/submit route stores metaTemplateConnectionId + metaWabaIdSnapshot', () => {
    const code = src('../routes/messages.ts');
    assert.ok(code.includes('metaTemplateConnectionId: connection.id'), 'submit must snapshot the connection id');
    assert.ok(code.includes('metaWabaIdSnapshot: connection.metaWabaId'), 'submit must snapshot the WABA id');
  });

  // ── Source regression: sync route uses stored binding safely ─────────────
  section('Source regression — sync route');

  await test('meta/sync route resolves the stored connection via resolveConnectionById when bound', () => {
    const code = src('../routes/messages.ts');
    assert.ok(code.includes('resolveConnectionById(template.metaTemplateConnectionId, clinicId)'),
      'sync must resolve the specific stored connection, scoped to this clinic');
  });

  await test('meta/sync route returns WABA_MISMATCH instead of syncing when binding mismatched', () => {
    const code = src('../routes/messages.ts');
    assert.ok(code.includes('META_ERRORS.WABA_MISMATCH'), 'sync must expose a distinct mismatch error code');
    assert.ok(code.includes("bindingStatus === 'mismatched'"), 'sync must branch on mismatch before calling syncMetaTemplateStatus');
  });

  await test('meta/sync route reports requiresResubmission for unbound legacy templates', () => {
    const code = src('../routes/messages.ts');
    assert.ok(code.includes('requiresResubmission: bindingStatus !== \'matched\''),
      'sync response must flag non-matched bindings for the UI');
  });

  // ── Source regression: no raw ids/secrets leak to the client ─────────────
  section('Source regression — no raw connection ids/secrets in responses');

  await test('meta/status route strips metaTemplateConnectionId/metaWabaIdSnapshot before responding', () => {
    const code = src('../routes/messages.ts');
    assert.ok(code.includes('const { metaTemplateConnectionId, metaWabaIdSnapshot, ...safeTemplate } = template;'),
      'status endpoint must not return raw connection/WABA ids');
  });

  await test('message-templates list route strips metaTemplateConnectionId/metaWabaIdSnapshot before responding', () => {
    const code = src('../routes/messages.ts');
    assert.ok(code.includes('const { metaTemplateConnectionId, metaWabaIdSnapshot, ...safe } = template;'),
      'list endpoint must not return raw connection/WABA ids');
  });

  await test('WhatsAppConnectionRecord fields (tokens) are never assigned into a JSON response literal', () => {
    const code = src('../routes/messages.ts');
    assert.ok(!code.includes('metaAccessTokenEncrypted'), 'messages.ts must never reference the encrypted token field directly');
  });

  // ── Clinic ownership (resolveConnectionById) — pure simulation ───────────
  section('Clinic ownership — resolveConnectionById logic (pure simulation)');

  type ClinicMapping = { clinicId: string; whatsappConnectionId: string; isActive: boolean };

  function simulateResolveConnectionById(
    connectionId: string,
    clinicId: string,
    mappings: ClinicMapping[],
  ): { id: string } | null {
    const mapping = mappings.find(m => m.clinicId === clinicId && m.whatsappConnectionId === connectionId);
    if (!mapping || !mapping.isActive) return null;
    return { id: connectionId };
  }

  await test('clinic can resolve its own connection', () => {
    const result = simulateResolveConnectionById('conn-A', 'clinic-1', [
      { clinicId: 'clinic-1', whatsappConnectionId: 'conn-A', isActive: true },
    ]);
    assert.ok(result);
  });

  await test('clinic cannot resolve a connection belonging to another clinic (cross-clinic isolation)', () => {
    const result = simulateResolveConnectionById('conn-A', 'clinic-2', [
      { clinicId: 'clinic-1', whatsappConnectionId: 'conn-A', isActive: true },
    ]);
    assert.equal(result, null);
  });

  await test('inactive connection mapping resolves to null (requires resubmission-safe error)', () => {
    const result = simulateResolveConnectionById('conn-A', 'clinic-1', [
      { clinicId: 'clinic-1', whatsappConnectionId: 'conn-A', isActive: false },
    ]);
    assert.equal(result, null);
  });

  await test('missing connection mapping resolves to null', () => {
    const result = simulateResolveConnectionById('conn-missing', 'clinic-1', []);
    assert.equal(result, null);
  });

  // ── Multiple connections determinism ──────────────────────────────────────
  section('Multiple connections — deterministic default selection');

  type DefaultMapping = { clinicId: string; isDefault: boolean; createdAt: Date; connectionId: string };

  function simulateResolveDefault(clinicId: string, mappings: DefaultMapping[]): string | null {
    const candidates = mappings.filter(m => m.clinicId === clinicId && m.isDefault);
    candidates.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return candidates[0]?.connectionId ?? null;
  }

  await test('multiple default-flagged connections → most recently created wins (deterministic)', () => {
    const result = simulateResolveDefault('clinic-1', [
      { clinicId: 'clinic-1', isDefault: true, createdAt: new Date('2026-01-01'), connectionId: 'conn-old' },
      { clinicId: 'clinic-1', isDefault: true, createdAt: new Date('2026-06-01'), connectionId: 'conn-new' },
    ]);
    assert.equal(result, 'conn-new');
  });

  await test('no default connection for clinic → null (caller must return a clear error, never guess)', () => {
    const result = simulateResolveDefault('clinic-2', [
      { clinicId: 'clinic-1', isDefault: true, createdAt: new Date('2026-01-01'), connectionId: 'conn-old' },
    ]);
    assert.equal(result, null);
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
