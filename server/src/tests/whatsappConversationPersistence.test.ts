/**
 * whatsappConversationPersistence.test.ts — WhatsAppConversationMessage persistence
 *
 * Covers the production bug where inbound/outbound WhatsApp messages (Meta Cloud
 * and Evolution) were only reflected in WhatsAppInboxEntry/State and never
 * persisted to WhatsAppConversationMessage, so the patient detail Messages tab
 * stayed empty.
 *
 * Tests (against an in-memory fake of the prisma delegate):
 *  - inbound message is persisted even when no patient is resolved (patientId null)
 *  - unique patient resolution stores patientId immediately
 *  - shared-phone ambiguity never auto-assigns a patient
 *  - duplicate providerMessageId does not create a second row
 *  - staff link/patient creation backfills only unlinked rows for the same clinic+phone
 *  - patient detail query (clinicId + patientId) returns messages after backfill
 *
 * Run with: tsx src/tests/whatsappConversationPersistence.test.ts
 */

import assert from 'node:assert/strict';

import {
  persistWhatsAppConversationMessage,
  backfillConversationMessagePatient,
  isUniqueConstraintError,
  type ConversationMessageDb,
} from '../services/whatsapp/conversationMessageStore.js';

// ─── Test harness (house pattern) ────────────────────────────────────────────

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

// ─── In-memory fake of the prisma WhatsAppConversationMessage delegate ───────

type Row = {
  id: string;
  clinicId: string;
  patientId: string | null;
  phone: string;
  providerMessageId: string | null;
  direction: string;
  text: string;
  createdAt: Date;
};

function makeFakeDb() {
  const rows: Row[] = [];
  let seq = 0;

  const db: ConversationMessageDb = {
    whatsAppConversationMessage: {
      async create({ data }) {
        // Enforce @@unique([clinicId, providerMessageId]) like PostgreSQL
        if (
          data.providerMessageId !== null &&
          rows.some(r => r.clinicId === data.clinicId && r.providerMessageId === data.providerMessageId)
        ) {
          const err = new Error('Unique constraint failed') as Error & { code: string };
          err.code = 'P2002';
          throw err;
        }
        const row: Row = {
          id: `msg-${++seq}`,
          clinicId: data.clinicId,
          patientId: data.patientId,
          phone: data.phone,
          providerMessageId: data.providerMessageId,
          direction: data.direction,
          text: data.text,
          createdAt: new Date(),
        };
        rows.push(row);
        return { id: row.id };
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const row of rows) {
          if (row.clinicId === where.clinicId && row.phone === where.phone && row.patientId === null) {
            row.patientId = data.patientId;
            count++;
          }
        }
        return { count };
      },
    },
  };

  return { db, rows };
}

// Mirrors the patient detail query in routes/patients.ts (where: { patientId, clinicId })
const patientDetailMessages = (rows: Row[], clinicId: string, patientId: string) =>
  rows.filter(r => r.clinicId === clinicId && r.patientId === patientId);

// Mirrors the unique-resolution rule shared by both providers: exactly one
// phone match links immediately; ambiguity stays unlinked.
const resolveUniquePatientId = (matches: Array<{ id: string }>): string | null =>
  matches.length === 1 ? matches[0].id : null;

const CLINIC = 'clinic-1';
const PHONE = '905072623879';

// ─── Tests ────────────────────────────────────────────────────────────────────

const tests: Promise<void>[] = [];

section('Inbound persistence (Meta Cloud & Evolution write path)');

tests.push(test('inbound message with no resolved patient is persisted with patientId null', async () => {
  const { db, rows } = makeFakeDb();
  const result = await persistWhatsAppConversationMessage({
    clinicId: CLINIC,
    patientId: resolveUniquePatientId([]),
    phone: PHONE,
    direction: 'incoming',
    text: 'onaylıyorum',
    providerMessageId: 'wamid.1',
    rawPayload: { source: 'meta' },
  }, db);
  assert.equal(result.created, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].patientId, null);
  assert.equal(rows[0].direction, 'incoming');
  assert.equal(rows[0].phone, PHONE);
}));

tests.push(test('phone is normalized (JID suffix and formatting stripped)', async () => {
  const { db, rows } = makeFakeDb();
  await persistWhatsAppConversationMessage({
    clinicId: CLINIC,
    patientId: null,
    phone: '+90 507 262 38 79@s.whatsapp.net',
    direction: 'incoming',
    text: 'merhaba',
  }, db);
  assert.equal(rows[0].phone, PHONE);
}));

tests.push(test('uniquely resolved patient is linked immediately', async () => {
  const { db, rows } = makeFakeDb();
  await persistWhatsAppConversationMessage({
    clinicId: CLINIC,
    patientId: resolveUniquePatientId([{ id: 'patient-faruk' }]),
    phone: PHONE,
    direction: 'incoming',
    text: 'randevu istiyorum',
    providerMessageId: 'wamid.2',
  }, db);
  assert.equal(rows[0].patientId, 'patient-faruk');
}));

tests.push(test('shared phone with multiple matches stays unlinked (no wrong-patient assignment)', async () => {
  const { db, rows } = makeFakeDb();
  await persistWhatsAppConversationMessage({
    clinicId: CLINIC,
    patientId: resolveUniquePatientId([{ id: 'patient-a' }, { id: 'patient-b' }]),
    phone: PHONE,
    direction: 'incoming',
    text: 'merhaba',
    providerMessageId: 'wamid.3',
  }, db);
  assert.equal(rows[0].patientId, null);
}));

tests.push(test('outgoing reply is persisted with direction outgoing', async () => {
  const { db, rows } = makeFakeDb();
  await persistWhatsAppConversationMessage({
    clinicId: CLINIC,
    patientId: null,
    phone: PHONE,
    direction: 'outgoing',
    text: 'Randevunuz onaylandı.',
    providerMessageId: 'wamid.out.1',
  }, db);
  assert.equal(rows[0].direction, 'outgoing');
}));

section('Idempotency');

tests.push(test('duplicate providerMessageId does not create a second row', async () => {
  const { db, rows } = makeFakeDb();
  const first = await persistWhatsAppConversationMessage({
    clinicId: CLINIC, patientId: null, phone: PHONE,
    direction: 'incoming', text: 'onaylıyorum', providerMessageId: 'wamid.dup',
  }, db);
  const second = await persistWhatsAppConversationMessage({
    clinicId: CLINIC, patientId: null, phone: PHONE,
    direction: 'incoming', text: 'onaylıyorum', providerMessageId: 'wamid.dup',
  }, db);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(rows.length, 1);
}));

tests.push(test('messages without providerMessageId are always stored (no false dedupe)', async () => {
  const { db, rows } = makeFakeDb();
  for (let i = 0; i < 2; i++) {
    await persistWhatsAppConversationMessage({
      clinicId: CLINIC, patientId: null, phone: PHONE,
      direction: 'outgoing', text: 'aynı yanıt',
    }, db);
  }
  assert.equal(rows.length, 2);
}));

tests.push(test('isUniqueConstraintError detects P2002 only', () => {
  const p2002 = Object.assign(new Error('dup'), { code: 'P2002' });
  assert.equal(isUniqueConstraintError(p2002), true);
  assert.equal(isUniqueConstraintError(new Error('other')), false);
  assert.equal(isUniqueConstraintError(null), false);
}));

section('Backfill on patient link (inbox link-patient / resolve / patient creation)');

tests.push(test('backfill links unlinked rows for same clinic+phone and returns count', async () => {
  const { db, rows } = makeFakeDb();
  await persistWhatsAppConversationMessage({ clinicId: CLINIC, patientId: null, phone: PHONE, direction: 'incoming', text: 'm1', providerMessageId: 'w1' }, db);
  await persistWhatsAppConversationMessage({ clinicId: CLINIC, patientId: null, phone: PHONE, direction: 'outgoing', text: 'r1' }, db);
  const count = await backfillConversationMessagePatient({ clinicId: CLINIC, phone: PHONE, patientId: 'patient-faruk' }, db);
  assert.equal(count, 2);
  assert.ok(rows.every(r => r.patientId === 'patient-faruk'));
}));

tests.push(test('backfill does not touch rows already linked to another patient (shared phone safety)', async () => {
  const { db, rows } = makeFakeDb();
  await persistWhatsAppConversationMessage({ clinicId: CLINIC, patientId: 'patient-sibling', phone: PHONE, direction: 'incoming', text: 'm1', providerMessageId: 'w1' }, db);
  await persistWhatsAppConversationMessage({ clinicId: CLINIC, patientId: null, phone: PHONE, direction: 'incoming', text: 'm2', providerMessageId: 'w2' }, db);
  const count = await backfillConversationMessagePatient({ clinicId: CLINIC, phone: PHONE, patientId: 'patient-faruk' }, db);
  assert.equal(count, 1);
  assert.equal(rows[0].patientId, 'patient-sibling');
  assert.equal(rows[1].patientId, 'patient-faruk');
}));

tests.push(test('backfill does not touch other clinics or other phones', async () => {
  const { db, rows } = makeFakeDb();
  await persistWhatsAppConversationMessage({ clinicId: 'clinic-2', patientId: null, phone: PHONE, direction: 'incoming', text: 'm1' }, db);
  await persistWhatsAppConversationMessage({ clinicId: CLINIC, patientId: null, phone: '905000000000', direction: 'incoming', text: 'm2' }, db);
  const count = await backfillConversationMessagePatient({ clinicId: CLINIC, phone: PHONE, patientId: 'patient-faruk' }, db);
  assert.equal(count, 0);
  assert.ok(rows.every(r => r.patientId === null));
}));

tests.push(test('backfill normalizes phone the same way persistence does', async () => {
  const { db } = makeFakeDb();
  await persistWhatsAppConversationMessage({ clinicId: CLINIC, patientId: null, phone: `${PHONE}@s.whatsapp.net`, direction: 'incoming', text: 'm1' }, db);
  const count = await backfillConversationMessagePatient({ clinicId: CLINIC, phone: '+90 507 262 38 79', patientId: 'patient-faruk' }, db);
  assert.equal(count, 1);
}));

section('Patient detail Messages tab (routes/patients.ts query shape)');

tests.push(test('patient detail query returns messages only after link/backfill', async () => {
  const { db, rows } = makeFakeDb();
  // 1. Inbound arrives before staff links the patient (the Faruk production case)
  await persistWhatsAppConversationMessage({ clinicId: CLINIC, patientId: null, phone: PHONE, direction: 'incoming', text: 'onaylıyorum', providerMessageId: 'wamid.x' }, db);
  await persistWhatsAppConversationMessage({ clinicId: CLINIC, patientId: null, phone: PHONE, direction: 'outgoing', text: 'Teşekkürler' }, db);
  assert.equal(patientDetailMessages(rows, CLINIC, 'patient-faruk').length, 0);

  // 2. Staff links the inbox entry → backfill runs
  await backfillConversationMessagePatient({ clinicId: CLINIC, phone: PHONE, patientId: 'patient-faruk' }, db);
  const visible = patientDetailMessages(rows, CLINIC, 'patient-faruk');
  assert.equal(visible.length, 2);
  assert.deepEqual(visible.map(m => m.direction).sort(), ['incoming', 'outgoing']);
}));

tests.push(test('messages for a uniquely resolved patient are visible immediately', async () => {
  const { db, rows } = makeFakeDb();
  await persistWhatsAppConversationMessage({ clinicId: CLINIC, patientId: 'patient-faruk', phone: PHONE, direction: 'incoming', text: 'merhaba', providerMessageId: 'wamid.y' }, db);
  assert.equal(patientDetailMessages(rows, CLINIC, 'patient-faruk').length, 1);
}));

// ─── Runner ───────────────────────────────────────────────────────────────────

Promise.all(tests).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
