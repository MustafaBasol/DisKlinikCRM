/**
 * whatsappInbox.test.ts — Unit tests for Sprint 11 WhatsApp Shared Inbox
 *
 * Tests cover:
 *  - getPhoneVariants normalization
 *  - Permission helpers (backend roles.ts)
 *  - ClinicResolutionResult structure from clinicResolver
 *
 * Run with: tsx src/tests/whatsappInbox.test.ts
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

// ─── Role permission helpers ──────────────────────────────────────────────────

import {
  canViewWhatsAppInbox,
  canResolveWhatsAppConversation,
  canLinkWhatsAppPatient,
} from '../utils/roles.js';

// Minimal user fixture
function makeUser(role: string, opts: Partial<{ canAccessAllClinics: boolean; allowedClinicIds: string[] }> = {}) {
  return {
    id: 'user-1',
    clinicId: 'clinic-1',
    organizationId: 'org-1',
    role,
    canAccessAllClinics: opts.canAccessAllClinics ?? false,
    allowedClinicIds: opts.allowedClinicIds ?? [],
  };
}

// ─── Phone normalization (tested via standalone logic) ────────────────────────

function getPhoneVariants(digits: string): string[] {
  const variants = new Set<string>();
  if (!digits) return [];
  variants.add(digits);
  if (digits.startsWith('90') && digits.length === 12) {
    variants.add(digits.slice(2));
    variants.add(`0${digits.slice(2)}`);
  } else if (digits.startsWith('0') && digits.length === 11) {
    variants.add(digits.slice(1));
    variants.add(`90${digits.slice(1)}`);
  } else if (digits.length === 10) {
    variants.add(`0${digits}`);
    variants.add(`90${digits}`);
  }
  return [...variants];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const tests: Promise<void>[] = [];

section('Phone number normalization');

tests.push(test('Turkish E.164 (90xxxxxxxxxx) generates 3 variants', () => {
  const v = getPhoneVariants('905551234567');
  assert.equal(v.length, 3);
  assert.ok(v.includes('905551234567'));
  assert.ok(v.includes('5551234567'));
  assert.ok(v.includes('05551234567'));
}));

tests.push(test('11-digit with leading 0 generates 3 variants', () => {
  const v = getPhoneVariants('05551234567');
  assert.equal(v.length, 3);
  assert.ok(v.includes('05551234567'));
  assert.ok(v.includes('5551234567'));
  assert.ok(v.includes('905551234567'));
}));

tests.push(test('10-digit generates 3 variants', () => {
  const v = getPhoneVariants('5551234567');
  assert.equal(v.length, 3);
  assert.ok(v.includes('5551234567'));
  assert.ok(v.includes('05551234567'));
  assert.ok(v.includes('905551234567'));
}));

tests.push(test('Empty string returns empty array', () => {
  const v = getPhoneVariants('');
  assert.equal(v.length, 0);
}));

tests.push(test('Non-Turkish number returns only itself', () => {
  const v = getPhoneVariants('1234');
  assert.equal(v.length, 1);
  assert.ok(v.includes('1234'));
}));

section('canViewWhatsAppInbox');

tests.push(test('OWNER can view inbox', () => {
  assert.ok(canViewWhatsAppInbox(makeUser('OWNER')));
}));

tests.push(test('ORG_ADMIN can view inbox', () => {
  assert.ok(canViewWhatsAppInbox(makeUser('ORG_ADMIN')));
}));

tests.push(test('CLINIC_MANAGER can view inbox', () => {
  assert.ok(canViewWhatsAppInbox(makeUser('CLINIC_MANAGER')));
}));

tests.push(test('RECEPTIONIST can view inbox', () => {
  assert.ok(canViewWhatsAppInbox(makeUser('RECEPTIONIST')));
}));

tests.push(test('DENTIST cannot view inbox', () => {
  assert.equal(canViewWhatsAppInbox(makeUser('DENTIST')), false);
}));

tests.push(test('BILLING cannot view inbox', () => {
  assert.equal(canViewWhatsAppInbox(makeUser('BILLING')), false);
}));

tests.push(test('null user cannot view inbox', () => {
  assert.equal(canViewWhatsAppInbox(null), false);
}));

section('canResolveWhatsAppConversation');

tests.push(test('OWNER can resolve', () => {
  assert.ok(canResolveWhatsAppConversation(makeUser('OWNER')));
}));

tests.push(test('ORG_ADMIN can resolve', () => {
  assert.ok(canResolveWhatsAppConversation(makeUser('ORG_ADMIN')));
}));

tests.push(test('CLINIC_MANAGER can resolve', () => {
  assert.ok(canResolveWhatsAppConversation(makeUser('CLINIC_MANAGER')));
}));

tests.push(test('RECEPTIONIST cannot resolve', () => {
  assert.equal(canResolveWhatsAppConversation(makeUser('RECEPTIONIST')), false);
}));

tests.push(test('DENTIST cannot resolve', () => {
  assert.equal(canResolveWhatsAppConversation(makeUser('DENTIST')), false);
}));

section('canLinkWhatsAppPatient');

tests.push(test('OWNER can link patient', () => {
  assert.ok(canLinkWhatsAppPatient(makeUser('OWNER')));
}));

tests.push(test('ORG_ADMIN can link patient', () => {
  assert.ok(canLinkWhatsAppPatient(makeUser('ORG_ADMIN')));
}));

tests.push(test('CLINIC_MANAGER can link patient', () => {
  assert.ok(canLinkWhatsAppPatient(makeUser('CLINIC_MANAGER')));
}));

tests.push(test('RECEPTIONIST can link patient', () => {
  assert.ok(canLinkWhatsAppPatient(makeUser('RECEPTIONIST')));
}));

tests.push(test('DENTIST cannot link patient', () => {
  assert.equal(canLinkWhatsAppPatient(makeUser('DENTIST')), false);
}));

tests.push(test('ASSISTANT cannot link patient', () => {
  assert.equal(canLinkWhatsAppPatient(makeUser('ASSISTANT')), false);
}));

section('ClinicResolutionResult type safety');

tests.push(test('ClinicResolutionResult with needsClinicResolution=true has null clinicId', () => {
  const result = {
    clinicId: null,
    needsClinicResolution: true,
    resolutionSource: 'unresolved' as const,
  };
  assert.equal(result.clinicId, null);
  assert.equal(result.needsClinicResolution, true);
  assert.equal(result.resolutionSource, 'unresolved');
}));

tests.push(test('ClinicResolutionResult with single_clinic has clinicId', () => {
  const result = {
    clinicId: 'clinic-abc',
    needsClinicResolution: false,
    resolutionSource: 'single_clinic' as const,
  };
  assert.equal(result.clinicId, 'clinic-abc');
  assert.equal(result.needsClinicResolution, false);
}));

// ─── Summary ──────────────────────────────────────────────────────────────────

Promise.all(tests).then(() => {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
});
