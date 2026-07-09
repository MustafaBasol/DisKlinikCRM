/**
 * noShowFollowUpParity.test.ts — Regression tests for the shared "unresolved
 * no-show" query (server/src/utils/noShowFollowUp.ts).
 *
 * Bug this guards against: the dashboard's "Aranacak Randevular" card and the
 * No-show Takibi page (/no-shows?recoveryStatus=unresolved) used different
 * date windows (calendar month vs. last 30 days) and one of them ignored the
 * recoveryStatus filter entirely, so the two numbers could disagree (e.g.
 * card=1, page=0) even though they claim to show the same thing.
 *
 * Run with: tsx src/tests/noShowFollowUpParity.test.ts
 */

import assert from 'node:assert/strict';
import {
  noShowFollowUpDateRange,
  buildNoShowFollowUpWhere,
  NO_SHOW_FOLLOW_UP_WINDOW_DAYS,
} from '../utils/noShowFollowUp.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: unknown) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ─── 1. noShowFollowUpDateRange — 30 günlük pencere ───────────────────────────

section('1. noShowFollowUpDateRange — 30 günlük pencere');

test('gte tam olarak 30 gün önce (saat 00:00, yerel saat dilimi)', () => {
  const now = new Date('2026-07-09T14:30:00Z');
  const { gte, lte } = noShowFollowUpDateRange(now);
  const expectedStart = new Date(now);
  expectedStart.setDate(expectedStart.getDate() - NO_SHOW_FOLLOW_UP_WINDOW_DAYS);
  expectedStart.setHours(0, 0, 0, 0);
  assert.equal(NO_SHOW_FOLLOW_UP_WINDOW_DAYS, 30);
  assert.equal(gte.getTime(), expectedStart.getTime());
  assert.equal(lte.getTime(), now.getTime(), 'lte should be "now" exactly, matching noShows.ts default range');
});

test('gte saat 00:00:00.000 ile başlar (gün başı)', () => {
  const now = new Date('2026-07-09T23:59:59.999Z');
  const { gte } = noShowFollowUpDateRange(now);
  assert.equal(gte.getHours(), 0);
  assert.equal(gte.getMinutes(), 0);
  assert.equal(gte.getSeconds(), 0);
});

test('deterministic — aynı "now" için her zaman aynı sonucu üretir', () => {
  const now = new Date('2026-07-09T10:00:00Z');
  const a = noShowFollowUpDateRange(now);
  const b = noShowFollowUpDateRange(now);
  assert.deepEqual(a, b);
});

// ─── 2. buildNoShowFollowUpWhere — filtre birleşimi ───────────────────────────

section('2. buildNoShowFollowUpWhere — filtre birleşimi (status + recoveryStatus + tarih + klinik)');

test('status=no_show ve recoveryStatus=unresolved her zaman dahil edilir', () => {
  const where = buildNoShowFollowUpWhere({ clinicId: 'clinic-A' });
  assert.equal(where.status, 'no_show');
  assert.equal(where.recoveryStatus, 'unresolved');
});

test('recoveryStatus alanı sayesinde recovered/contacted no-showlar hariç tutulur', () => {
  const where = buildNoShowFollowUpWhere({ clinicId: 'clinic-A' });
  assert.notEqual(where.recoveryStatus, 'recovered');
  assert.notEqual(where.recoveryStatus, 'contacted');
});

test('klinik kapsamı (clinicIdWhere) where nesnesine olduğu gibi yansır — tek klinik', () => {
  const where = buildNoShowFollowUpWhere({ clinicId: 'clinic-A' });
  assert.equal(where.clinicId, 'clinic-A');
});

test('klinik kapsamı (clinicIdWhere) where nesnesine olduğu gibi yansır — birden fazla klinik', () => {
  const where = buildNoShowFollowUpWhere({ clinicId: { in: ['clinic-A', 'clinic-B'] } });
  assert.deepEqual(where.clinicId, { in: ['clinic-A', 'clinic-B'] });
});

test('practitionerId verilmezse where nesnesine eklenmez (DENTIST olmayan roller)', () => {
  const where = buildNoShowFollowUpWhere({ clinicId: 'clinic-A' });
  assert.ok(!('practitionerId' in where), 'practitionerId should be absent when not provided');
});

test('practitionerId verilirse where nesnesine eklenir (DENTIST kendi randevularıyla sınırlı)', () => {
  const where = buildNoShowFollowUpWhere({ clinicId: 'clinic-A' }, 'doctor-99');
  assert.equal(where.practitionerId, 'doctor-99');
});

test('startTime, noShowFollowUpDateRange ile aynı pencereyi kullanır', () => {
  const now = new Date('2026-07-09T12:00:00Z');
  const where = buildNoShowFollowUpWhere({ clinicId: 'clinic-A' }, undefined, now);
  const expected = noShowFollowUpDateRange(now);
  assert.deepEqual(where.startTime, expected);
});

// ─── 3. Regression: dashboard kartı ile No-show Takibi sayfası aynı sonucu üretir ──

section('3. Regression — dashboard kartı ve /no-shows?recoveryStatus=unresolved aynı filtreyi kullanır');

test('bir recovered no-show, follow-up sayacına dahil edilmemeli (bug senaryosu)', () => {
  // Reproduces the reported bug: dashboard card showed 1 (counted regardless of
  // recoveryStatus), no-show page showed 0 (recoveryStatus=unresolved only).
  const appointments = [
    { status: 'no_show', recoveryStatus: 'recovered', startTime: new Date('2026-07-05') },
  ];
  const now = new Date('2026-07-09T12:00:00Z');
  const where = buildNoShowFollowUpWhere({ clinicId: 'clinic-A' }, undefined, now);

  const matches = appointments.filter(
    (a) =>
      a.status === where.status &&
      a.recoveryStatus === where.recoveryStatus &&
      a.startTime >= (where.startTime as { gte: Date }).gte &&
      a.startTime <= (where.startTime as { gte: Date; lte: Date }).lte,
  );
  assert.equal(matches.length, 0, 'recovered no-show must not be counted as an unresolved follow-up');
});

test('bir unresolved no-show, hem tarih hem klinik hem status eşleşiyorsa sayılır', () => {
  const appointments = [
    { status: 'no_show', recoveryStatus: 'unresolved', startTime: new Date('2026-07-05'), clinicId: 'clinic-A' },
  ];
  const now = new Date('2026-07-09T12:00:00Z');
  const where = buildNoShowFollowUpWhere({ clinicId: 'clinic-A' }, undefined, now);

  const matches = appointments.filter(
    (a) =>
      a.clinicId === where.clinicId &&
      a.status === where.status &&
      a.recoveryStatus === where.recoveryStatus &&
      a.startTime >= (where.startTime as { gte: Date }).gte &&
      a.startTime <= (where.startTime as { gte: Date; lte: Date }).lte,
  );
  assert.equal(matches.length, 1);
});

// ─── Sonuç ────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
console.log('─'.repeat(60));

if (failed > 0) process.exit(1);
