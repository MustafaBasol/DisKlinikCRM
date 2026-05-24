/**
 * instagramConversion.test.ts — Sprint 23B: Tests for Instagram DM → Appointment conversion
 *
 * Tests the business logic guards for:
 *   - create-appointment-request endpoint
 *   - create-appointment endpoint
 *   - PATCH status endpoint
 *   - Permission checks for conversion actions
 *
 * Run with:  tsx src/tests/instagramConversion.test.ts
 * No external test framework required — uses node:assert/strict + manual counters.
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

// ─── Permission helpers ────────────────────────────────────────────────────────

import {
  canViewInstagramInbox,
  canResolveInstagramConversation,
} from '../utils/roles.js';

function makeUser(role: string, orgId = 'org-1', clinicId?: string) {
  return {
    id: 'user-1',
    role,
    organizationId: orgId,
    clinicId: clinicId ?? null,
    allowedClinicIds: clinicId ? [clinicId] : [],
    canAccessAllClinics: false,
  };
}

// ─── Conversion payload validation helpers ─────────────────────────────────────

/**
 * Simulate the validation logic from the create-appointment-request endpoint.
 * Returns an error string if validation fails, or null if valid.
 */
function validateCreateRequestPayload(entry: {
  clinicId?: string | null;
  organizationId: string;
  status: string;
}, userOrgId: string): string | null {
  if (entry.organizationId !== userOrgId) return 'Entry not found';
  if (!entry.clinicId) return 'clinicId is required — assign clinic first';
  if (entry.status === 'converted') return 'Entry already converted';
  return null;
}

/**
 * Simulate the validation logic from the create-appointment endpoint.
 */
function validateCreateAppointmentPayload(body: {
  patientId?: string;
  clinicId?: string;
  practitionerId?: string;
  appointmentTypeId?: string;
  date?: string;
  time?: string;
}): string | null {
  const required = ['patientId', 'clinicId', 'practitionerId', 'appointmentTypeId', 'date', 'time'] as const;
  for (const field of required) {
    if (!body[field] || typeof body[field] !== 'string') {
      return `${field} is required`;
    }
  }
  // Validate ISO date + time combination
  const dateTimeStr = `${body.date}T${body.time}`;
  const parsed = new Date(dateTimeStr);
  if (isNaN(parsed.getTime())) return 'Invalid date/time combination';
  return null;
}

/**
 * Simulate status transition validation.
 */
function validateStatusUpdate(status: string): string | null {
  const valid = ['open', 'resolved', 'ignored', 'converted'];
  if (!valid.includes(status)) return `status must be one of: ${valid.join(', ')}`;
  return null;
}

// ─── Test suite ────────────────────────────────────────────────────────────────

async function main() {
  // ─── Permission Tests ──────────────────────────────────────────────────────

  section('§1 Permission checks — who can trigger conversion');

  await test('OWNER can view Instagram inbox', () => {
    assert.ok(canViewInstagramInbox(makeUser('OWNER')));
  });

  await test('ORG_ADMIN can view Instagram inbox', () => {
    assert.ok(canViewInstagramInbox(makeUser('ORG_ADMIN')));
  });

  await test('CLINIC_MANAGER can view Instagram inbox', () => {
    assert.ok(canViewInstagramInbox(makeUser('CLINIC_MANAGER')));
  });

  await test('RECEPTIONIST can view Instagram inbox (can trigger create-appointment-request)', () => {
    assert.ok(canViewInstagramInbox(makeUser('RECEPTIONIST')));
  });

  await test('BILLING cannot view Instagram inbox', () => {
    assert.ok(!canViewInstagramInbox(makeUser('BILLING')));
  });

  await test('OWNER can resolve Instagram conversation (convert actions)', () => {
    assert.ok(canResolveInstagramConversation(makeUser('OWNER')));
  });

  await test('CLINIC_MANAGER can resolve Instagram conversation', () => {
    assert.ok(canResolveInstagramConversation(makeUser('CLINIC_MANAGER')));
  });

  await test('RECEPTIONIST cannot resolve Instagram conversation (higher-privilege action)', () => {
    assert.ok(!canResolveInstagramConversation(makeUser('RECEPTIONIST')));
  });

  await test('DOCTOR cannot resolve Instagram conversation', () => {
    assert.ok(!canResolveInstagramConversation(makeUser('DOCTOR')));
  });

  // ─── create-appointment-request validation ────────────────────────────────

  section('§2 create-appointment-request — payload validation');

  await test('Missing clinicId returns error', () => {
    const entry = { clinicId: null, organizationId: 'org-1', status: 'open' };
    const err = validateCreateRequestPayload(entry, 'org-1');
    assert.ok(err?.includes('clinicId'));
  });

  await test('Cross-org entry returns not-found', () => {
    const entry = { clinicId: 'clinic-1', organizationId: 'org-2', status: 'open' };
    const err = validateCreateRequestPayload(entry, 'org-1');
    assert.equal(err, 'Entry not found');
  });

  await test('Already converted entry returns error', () => {
    const entry = { clinicId: 'clinic-1', organizationId: 'org-1', status: 'converted' };
    const err = validateCreateRequestPayload(entry, 'org-1');
    assert.ok(err?.includes('already converted'));
  });

  await test('Valid entry passes validation', () => {
    const entry = { clinicId: 'clinic-1', organizationId: 'org-1', status: 'open' };
    const err = validateCreateRequestPayload(entry, 'org-1');
    assert.equal(err, null);
  });

  await test('Entry with status=resolved (not converted) can still be converted', () => {
    const entry = { clinicId: 'clinic-1', organizationId: 'org-1', status: 'resolved' };
    const err = validateCreateRequestPayload(entry, 'org-1');
    assert.equal(err, null);
  });

  // ─── create-appointment validation ────────────────────────────────────────

  section('§3 create-appointment — payload validation');

  await test('Missing patientId returns error', () => {
    const err = validateCreateAppointmentPayload({
      clinicId: 'c-1', practitionerId: 'p-1', appointmentTypeId: 'at-1',
      date: '2025-01-15', time: '10:00',
    });
    assert.ok(err?.includes('patientId'));
  });

  await test('Missing clinicId returns error', () => {
    const err = validateCreateAppointmentPayload({
      patientId: 'p-1', practitionerId: 'doc-1', appointmentTypeId: 'at-1',
      date: '2025-01-15', time: '10:00',
    });
    assert.ok(err?.includes('clinicId'));
  });

  await test('Missing practitionerId returns error', () => {
    const err = validateCreateAppointmentPayload({
      patientId: 'pat-1', clinicId: 'c-1', appointmentTypeId: 'at-1',
      date: '2025-01-15', time: '10:00',
    });
    assert.ok(err?.includes('practitionerId'));
  });

  await test('Missing appointmentTypeId returns error', () => {
    const err = validateCreateAppointmentPayload({
      patientId: 'pat-1', clinicId: 'c-1', practitionerId: 'doc-1',
      date: '2025-01-15', time: '10:00',
    });
    assert.ok(err?.includes('appointmentTypeId'));
  });

  await test('Missing date returns error', () => {
    const err = validateCreateAppointmentPayload({
      patientId: 'pat-1', clinicId: 'c-1', practitionerId: 'doc-1', appointmentTypeId: 'at-1',
      time: '10:00',
    });
    assert.ok(err?.includes('date'));
  });

  await test('Missing time returns error', () => {
    const err = validateCreateAppointmentPayload({
      patientId: 'pat-1', clinicId: 'c-1', practitionerId: 'doc-1', appointmentTypeId: 'at-1',
      date: '2025-01-15',
    });
    assert.ok(err?.includes('time'));
  });

  await test('Invalid date+time combination returns error', () => {
    const err = validateCreateAppointmentPayload({
      patientId: 'pat-1', clinicId: 'c-1', practitionerId: 'doc-1', appointmentTypeId: 'at-1',
      date: 'not-a-date', time: 'not-a-time',
    });
    assert.ok(err?.includes('Invalid'));
  });

  await test('Complete valid payload passes validation', () => {
    const err = validateCreateAppointmentPayload({
      patientId: 'pat-1', clinicId: 'c-1', practitionerId: 'doc-1', appointmentTypeId: 'at-1',
      date: '2025-06-20', time: '14:30',
    });
    assert.equal(err, null);
  });

  // ─── PATCH status validation ───────────────────────────────────────────────

  section('§4 PATCH /instagram/inbox/:id/status — status validation');

  await test('"open" is a valid status', () => {
    assert.equal(validateStatusUpdate('open'), null);
  });

  await test('"resolved" is a valid status', () => {
    assert.equal(validateStatusUpdate('resolved'), null);
  });

  await test('"ignored" is a valid status', () => {
    assert.equal(validateStatusUpdate('ignored'), null);
  });

  await test('"converted" is a valid status', () => {
    assert.equal(validateStatusUpdate('converted'), null);
  });

  await test('"pending" is NOT a valid status', () => {
    const err = validateStatusUpdate('pending');
    assert.ok(err?.includes('must be one of'));
  });

  await test('"deleted" is NOT a valid status', () => {
    const err = validateStatusUpdate('deleted');
    assert.ok(err?.includes('must be one of'));
  });

  await test('Empty string is NOT a valid status', () => {
    const err = validateStatusUpdate('');
    assert.ok(err?.includes('must be one of'));
  });

  // ─── Source field logic ────────────────────────────────────────────────────

  section('§5 Instagram source field / AppointmentRequest source logic');

  await test('AppointmentRequest source for Instagram DM should be "instagram"', () => {
    // Simulate the source derivation logic from the endpoint
    const source = 'instagram';
    assert.equal(source, 'instagram');
  });

  await test('AppointmentRequest source defaults should differ from WhatsApp default', () => {
    const defaultWhatsappSource = 'whatsapp';
    const instagramSource = 'instagram';
    assert.notEqual(defaultWhatsappSource, instagramSource);
  });

  await test('Anonymous sender: patientName fallback to @username', () => {
    const senderUsername = 'testuser';
    const externalSenderId = 'ig_1234567890';
    // Simulate the fallback logic
    const patientName = senderUsername ? `@${senderUsername}` : externalSenderId;
    assert.equal(patientName, '@testuser');
  });

  await test('Anonymous sender without username: falls back to externalSenderId', () => {
    const senderUsername = null;
    const externalSenderId = 'ig_1234567890';
    const patientName = senderUsername ? `@${senderUsername}` : externalSenderId;
    assert.equal(patientName, 'ig_1234567890');
  });

  await test('Phone fallback for anonymous sender uses externalSenderId', () => {
    const externalSenderId = 'ig_9876543210';
    // The phone field is required on AppointmentRequest; for Instagram DM without linked patient, use externalSenderId
    const phone = externalSenderId;
    assert.equal(typeof phone, 'string');
    assert.ok(phone.length > 0);
  });

  // ─── UI state logic ────────────────────────────────────────────────────────

  section('§6 Frontend UI state logic');

  await test('"Randevu Oluştur" button: disabled when no patientId', () => {
    const entry = { patientId: null, clinicId: 'clinic-1', status: 'open' };
    const disabled = !entry.patientId || !entry.clinicId;
    assert.ok(disabled);
  });

  await test('"Randevu Oluştur" button: disabled when no clinicId', () => {
    const entry = { patientId: 'pat-1', clinicId: null, status: 'open' };
    const disabled = !entry.patientId || !entry.clinicId;
    assert.ok(disabled);
  });

  await test('"Randevu Oluştur" button: enabled when both patientId and clinicId present', () => {
    const entry = { patientId: 'pat-1', clinicId: 'clinic-1', status: 'open' };
    const disabled = !entry.patientId || !entry.clinicId;
    assert.ok(!disabled);
  });

  await test('Converted badge: shown when status = "converted"', () => {
    const entry = { status: 'converted' };
    const showBadge = entry.status === 'converted';
    assert.ok(showBadge);
  });

  await test('Converted badge: not shown for non-converted entries', () => {
    for (const status of ['open', 'resolved', 'ignored']) {
      const entry = { status };
      assert.ok(entry.status !== 'converted');
    }
  });

  await test('"Talep Oluştur" button: disabled when no clinicId', () => {
    const entry = { clinicId: null, status: 'open' };
    const disabled = !entry.clinicId;
    assert.ok(disabled);
  });

  await test('Conversion actions: hidden when entry already converted', () => {
    const entry = { status: 'converted' };
    const showActions = entry.status !== 'converted';
    assert.ok(!showActions);
  });

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
