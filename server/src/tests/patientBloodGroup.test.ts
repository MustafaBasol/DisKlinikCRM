/**
 * patientBloodGroup.test.ts — F3-DATA-MIG-TODAY-001-R8
 *
 * The structured blood-group field, end to end through the PATIENT DOMAIN.
 *
 * WHY THIS FILE EXISTS, separately from migrationMapping.test.ts:
 * a migration destination that the product cannot READ, EDIT or ERASE is a
 * write-only dead end, and writing KVKK Art. 6 special-category data into one
 * would be indefensible. R7 rejected `patient.notes` on exactly that argument
 * until the argument was checked against the code and found false. So the
 * claim "Patient.bloodGroup is a real domain field" is asserted here rather
 * than assumed: schema shape, migration safety, write validation, subject
 * access, bulk export and anonymization.
 *
 * The mapping side — catalog entry, KANGURUBU's disposition, normalization,
 * the sensitive-review gate — lives in migrationMapping.test.ts section R8.
 *
 * Read-only and DATABASE-FREE: it parses schema.prisma and the relevant source
 * files as text and imports the real zod schemas and the real bulk-export
 * allow-list. Harness shape copied from migrationPatientSchemaDrift.test.ts —
 * standalone tsx script, node:assert/strict, hand-rolled counters. There is no
 * vitest/jest here.
 *
 * NO REAL PATIENT DATA. Every value below is synthetic.
 *
 * Run with: tsx src/tests/patientBloodGroup.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  patientBloodGroupValues,
  patientSchema,
  patientUpdateSchema,
} from '../schemas/index.js';
import { PATIENT_SELECT } from '../services/privacy/clinicBulkExportFieldAllowlists.js';
import { getDestinationField } from '../services/migration/contracts.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '../..');
const REPO_ROOT = resolve(SERVER_ROOT, '..');

function readServer(relPath: string): string {
  return readFileSync(resolve(SERVER_ROOT, relPath), 'utf8');
}

const SCHEMA = readServer('prisma/schema.prisma');
const MIGRATION_DIR = 'prisma/migrations/20260819130000_add_patient_blood_group';

/** The body of `model Patient { ... }`. */
const PATIENT_MODEL = (() => {
  const start = SCHEMA.indexOf('\nmodel Patient {');
  assert.notEqual(start, -1, 'model Patient must exist');
  const bodyStart = SCHEMA.indexOf('{', start) + 1;
  const end = SCHEMA.indexOf('\n}', bodyStart);
  return SCHEMA.slice(bodyStart, end);
})();

/** The single declaration line for a Patient field, comments excluded. */
function patientFieldLine(name: string): string {
  const lines = PATIENT_MODEL.split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('//') && !l.startsWith('///') && !l.startsWith('@@'))
    .filter((l) => new RegExp(`^${name}\\s`).test(l));
  assert.equal(lines.length, 1, `expected exactly one ${name} declaration on Patient, found ${lines.length}`);
  return lines[0]!;
}

// ══════════════════════════════════════════════════════════════════════════
// A. SCHEMA SHAPE
// ══════════════════════════════════════════════════════════════════════════

section('A. Patient.bloodGroup schema shape');

await test('A1: it is declared, OPTIONAL, and carries no default', () => {
  const line = patientFieldLine('bloodGroup');
  assert.match(line, /^bloodGroup\s+String\?/, 'nullable String — absence must be representable');
  assert.equal(line.includes('@default'), false, 'a default would fabricate a blood group for every existing row');
  assert.equal(line.includes('@unique'), false, 'blood group is shared by millions of people');
});

await test('A2: it is a documented String, NOT a Prisma enum — and here is why that matters', () => {
  // The repo-wide convention for closed vocabularies (gender, patientStatus,
  // source, pregnancyStatus) is a documented String. The DECISIVE reason,
  // though, is migrationPatientSchemaDrift.test.ts: it enumerates Patient
  // columns by filtering PRISMA_SCALAR_TYPES, so a native enum column would be
  // INVISIBLE to that permanent guard — fail-open on anonymization, subject
  // access and bulk export, for the one field that most needs them.
  assert.equal(SCHEMA.includes('enum BloodGroup'), false, 'a native enum would escape the Patient privacy drift guard');
  const drift = readServer('src/tests/migrationPatientSchemaDrift.test.ts');
  assert.ok(
    drift.includes('PRISMA_SCALAR_TYPES.has(f.baseType)'),
    'the drift guard still filters on scalar types — the premise of this decision',
  );
});

await test('A3: the doc comment records the decision rather than leaving it to be re-derived', () => {
  const idx = PATIENT_MODEL.indexOf('bloodGroup            String?');
  assert.notEqual(idx, -1);
  const preceding = PATIENT_MODEL.slice(0, idx);
  const docBlock = preceding.slice(preceding.lastIndexOf('  chartNumber'));
  for (const required of ['R8', 'A_POSITIVE', 'O_NEGATIVE', 'UNKNOWN', 'anonymization']) {
    assert.ok(docBlock.includes(required), `the doc comment must mention ${required}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// B. MIGRATION SAFETY
// ══════════════════════════════════════════════════════════════════════════

section('B. the migration is additive and rollback-safe');

await test('B1: exactly one ADD COLUMN, and no destructive statement anywhere', () => {
  const sql = readServer(`${MIGRATION_DIR}/migration.sql`);
  const statements = sql
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('--'));
  assert.deepEqual(
    statements,
    ['ALTER TABLE "Patient" ADD COLUMN "bloodGroup" TEXT;'],
    'one additive statement, nothing else',
  );
  for (const forbidden of ['DROP ', 'DELETE ', 'TRUNCATE', 'UPDATE ', 'NOT NULL', 'DEFAULT ', 'CREATE TYPE']) {
    assert.equal(
      statements.some((s) => s.toUpperCase().includes(forbidden)),
      false,
      `the migration must contain no ${forbidden.trim()}`,
    );
  }
});

await test('B2: zero backfill — no existing row is given a blood group it never had', () => {
  // Comment lines are stripped first: this file's header comment discusses
  // INSERTs and rollback in prose, and matching that prose would be a false
  // positive on exactly the check that must not be weakened.
  const sql = readServer(`${MIGRATION_DIR}/migration.sql`)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('--'))
    .join('\n')
    .toUpperCase();
  assert.equal(sql.includes('INSERT'), false);
  assert.equal(sql.includes('UPDATE'), false);
  assert.equal(sql.includes('SET '), false);
  // NULL with no default is what makes the previous release's INSERTs stay
  // valid, which is what makes rollback application-only.
});

// ══════════════════════════════════════════════════════════════════════════
// C. WRITE VALIDATION (rectification path)
// ══════════════════════════════════════════════════════════════════════════

section('C. create/update validation');

const BASE = { firstName: 'Synthetic', lastName: 'Fixture' };

await test('C1: all eight canonical values are accepted on create and on update', () => {
  assert.equal(patientBloodGroupValues.length, 8);
  for (const value of patientBloodGroupValues) {
    assert.equal(patientSchema.safeParse({ ...BASE, bloodGroup: value }).success, true, `${value} must be accepted`);
    assert.equal(patientUpdateSchema.safeParse({ bloodGroup: value }).success, true, `${value} must be updatable`);
  }
});

await test('C2: absence stays representable — omitted, null and empty string all mean "not recorded"', () => {
  assert.equal(patientSchema.safeParse(BASE).success, true, 'omitting it must be legal');
  assert.equal(patientSchema.safeParse({ ...BASE, bloodGroup: null }).success, true);
  const emptied = patientSchema.safeParse({ ...BASE, bloodGroup: '' });
  assert.equal(emptied.success, true);
  assert.equal(
    emptied.success && emptied.data.bloodGroup,
    null,
    "the form's empty option must become NULL, not the string ''",
  );
});

await test('C3: anything outside the vocabulary is REJECTED, never coerced and never stored raw', () => {
  for (const bad of ['A+', '0 Rh+', 'a_positive', 'UNKNOWN', 'UNSPECIFIED', 'C_POSITIVE', 'A', 42, true, {}]) {
    assert.equal(
      patientSchema.safeParse({ ...BASE, bloodGroup: bad }).success,
      false,
      `${JSON.stringify(bad)} must be rejected by the write schema`,
    );
  }
  // Note 'A+' and '0 Rh+' above: raw legacy spellings are the MIGRATION
  // transform's input, never the API's. Normalization happens once, in
  // blood_group_tr, and the API only ever sees canonical tokens.
});

await test('C4: the vocabulary is declared ONCE and every consumer agrees with it', () => {
  const dest = getDestinationField('patient.bloodGroup');
  assert.ok(dest, 'the migration destination must exist');
  assert.deepEqual(
    [...(dest.enumValues ?? [])],
    [...patientBloodGroupValues],
    'the migration catalog and the write schema must not drift apart',
  );
  const frontend = readFileSync(resolve(REPO_ROOT, 'src/constants/patientBloodGroup.ts'), 'utf8');
  for (const value of patientBloodGroupValues) {
    assert.ok(frontend.includes(`'${value}'`), `the patient form must offer ${value}`);
  }
  assert.equal(
    /'(?!A_|B_|AB_|O_)[A-Z][A-Z_]*'/.test(frontend.slice(frontend.indexOf('PATIENT_BLOOD_GROUP_VALUES'), frontend.indexOf('] as const'))),
    false,
    'the form must offer no value the API would reject',
  );
});

// ══════════════════════════════════════════════════════════════════════════
// D. KVKK DATA-SUBJECT RIGHTS
// ══════════════════════════════════════════════════════════════════════════

section('D. access, rectification and erasure are all serviceable');

await test('D1: ACCESS — the Art. 11 subject-access export carries it', () => {
  const src = readServer('src/routes/patientPrivacy.ts');
  const collectAt = src.indexOf('async function collectStructuredExportData');
  assert.notEqual(collectAt, -1);
  const findAt = src.indexOf('prisma.patient.findFirst(', collectAt);
  const selectAt = src.indexOf('select: {', findAt);
  const block = src.slice(selectAt, src.indexOf('},', selectAt));
  assert.ok(
    /\bbloodGroup:\s*true\b/.test(block),
    'special-category status raises the bar for PROCESSING, it does not narrow the subject’s right to see',
  );
});

await test('D2: RECTIFICATION — the update schema admits it and the route persists it', () => {
  assert.equal(patientUpdateSchema.safeParse({ bloodGroup: 'O_NEGATIVE' }).success, true);
  const route = readServer('src/routes/patients.ts');
  // The PUT persists the validated object wholesale, so admitting the field on
  // patientUpdateSchema is sufficient — assert that this is still HOW it works
  // rather than assuming it.
  assert.ok(
    route.includes('patientUpdateSchema.safeParse(req.body)'),
    'the PUT must still validate through patientUpdateSchema',
  );
  assert.ok(
    /data:\s*\{\s*\.\.\.validation\.data/.test(route),
    'the PUT must still persist the validated payload wholesale',
  );
});

await test('D3: ERASURE — anonymization clears it, in BOTH passes', () => {
  const src = readServer('src/services/privacy/patientAnonymization.ts');
  const mainAt = src.indexOf('prisma.patient.update(');
  assert.notEqual(mainAt, -1);
  const mainBlock = src.slice(mainAt, src.indexOf('});', mainAt));
  assert.ok(/\bbloodGroup:\s*null\b/.test(mainBlock), 'the first anonymization must null it');

  const repairAt = src.indexOf('prisma.patient.updateMany(');
  assert.notEqual(repairAt, -1, 'the already-anonymized repair pass must still exist');
  const repairBlock = src.slice(repairAt, src.indexOf('});', repairAt));
  assert.ok(
    /\bbloodGroup:\s*null\b/.test(repairBlock),
    'a patient anonymized BEFORE this field shipped must be repaired, or their blood group survives erasure forever',
  );
});

await test('D4: the clinic bulk export includes it — an export missing it would be an incomplete contract', () => {
  assert.equal((PATIENT_SELECT as Record<string, unknown>).bloodGroup, true);
});

// ══════════════════════════════════════════════════════════════════════════
// E. THE MIGRATION WRITE PATH STAYS GATED
// ══════════════════════════════════════════════════════════════════════════

section('E. the migration may only ever write a REVIEWED blood group');

await test('E1: the executor writes it from the reviewed draft and from nothing else', () => {
  const executor = readServer('src/services/migration/executor.ts');
  const createBlock = executor.slice(
    executor.indexOf('tx.patient.create('),
    executor.indexOf('tx.migrationRecord.create('),
  );
  const assignments = createBlock.match(/(^|[^A-Za-z0-9_.])bloodGroup:\s*([^,]+),/gm) ?? [];
  assert.equal(assignments.length, 1, 'exactly one bloodGroup assignment in the patient create');
  assert.ok(
    /bloodGroup:\s*row\.draft\.bloodGroup,/.test(createBlock),
    'it must come from row.draft.bloodGroup and nothing else — no literal, no source cell',
  );
});

await test('E2: the draft may only take it from the patient.bloodGroup destination mapping', () => {
  const rowBuilder = readServer('src/services/migration/rowBuilder.ts');
  assert.ok(
    rowBuilder.includes("bloodGroup: asString(read('patient.bloodGroup')),"),
    'the draft field must be fed by the destination catalog key, i.e. by a mapping',
  );
  // compileMapping only compiles WRITING states, so a column still sitting in
  // SENSITIVE_REVIEW_REQUIRED contributes nothing. If that set ever grew,
  // unapproved special-category data would start importing itself.
  const writing = rowBuilder.match(/const WRITING_STATES = new Set\(\[([^\]]*)\]\)/);
  assert.ok(writing, 'WRITING_STATES not found in rowBuilder.ts');
  const states = writing[1]!.split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean);
  assert.deepEqual(states.sort(), ['AUTO_CONFIDENT', 'RESOLVED']);
});

await test('E3: no blood-group value is ever logged, warned with, or put in a row outcome', () => {
  const transforms = readServer('src/services/migration/mapping/transforms.ts');
  const start = transforms.indexOf('const bloodGroupTr: TransformFn');
  assert.notEqual(start, -1);
  const body = transforms.slice(start, transforms.indexOf('\n};', start));
  assert.equal(body.includes('console.'), false, 'transforms never log');
  // Warnings are emitted as bare CODE literals; nothing interpolates `raw`,
  // `compact` or `tail` into a warning or an error message.
  for (const forbidden of ['${raw', '${compact', '${tail', '${sign']) {
    assert.equal(body.includes(forbidden), false, `no warning may interpolate ${forbidden}}`);
  }
  const executor = readServer('src/services/migration/executor.ts');
  assert.equal(
    /console\.[a-z]+\([^)]*bloodGroup/.test(executor),
    false,
    'the executor must never log the field',
  );
});

// ─── Sonuç ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Toplam: ${passed + failed}  ✓ ${passed}  ✗ ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test başarısız oldu.`);
  process.exit(1);
} else {
  console.log('\nTüm testler geçti.');
}
