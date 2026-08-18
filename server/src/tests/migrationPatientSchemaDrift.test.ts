/**
 * migrationPatientSchemaDrift.test.ts — F3-DATA-MIG-TODAY-001 / F3-DATA-MIG-003
 * permanent schema-drift guard for `Patient` and `PatientIdentityDocument`.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Before it, adding a column to `Patient` broke NOTHING in CI. A new scalar
 * was silently absent from all three of the product's privacy surfaces at
 * once:
 *   - anonymization (services/privacy/patientAnonymization.ts) — a
 *     hand-enumerated DENY-list, i.e. fail-OPEN: a field nobody remembered is
 *     simply never anonymized;
 *   - the KVKK Art. 11 subject-access export (routes/patientPrivacy.ts);
 *   - the clinic bulk export contract
 *     (services/privacy/clinicBulkExportFieldAllowlists.ts).
 * Those three lists had already drifted apart from each other in production
 * code (smsOptOut / smsOptOutAt / primaryClinicId are in one and not the
 * others), which is exactly the failure mode this guard converts from silent
 * to loud.
 *
 * THE CONTRACT: every scalar declared on `Patient` in schema.prisma must
 * appear EITHER in the relevant privacy surface OR on the matching
 * ..._EXEMPT list below, each with a one-line recorded reason. A NEW Patient
 * scalar added later therefore FAILS this test until someone consciously
 * decides, and writes down, whether it is anonymized / exported / disclosed.
 * That decision-forcing failure IS the feature — never "fix" a failure here
 * by adding the field to an EXEMPT list without a real reason.
 *
 * Read-only and DATABASE-FREE: it parses server/prisma/schema.prisma and the
 * three real source files as text, and imports the bulk-export allow-list
 * constants directly (they are exported). Harness shape copied from
 * kvkkHigh007High008SchemaIntegrity.test.ts — standalone tsx script,
 * node:assert/strict, hand-rolled counters. There is no vitest/jest here.
 *
 * Run with: tsx src/tests/migrationPatientSchemaDrift.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PATIENT_SELECT } from '../services/privacy/clinicBulkExportFieldAllowlists.js';

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

function readSource(relPath: string): string {
  return readFileSync(resolve(SERVER_ROOT, relPath), 'utf8');
}

// ── Minimal schema.prisma parsing ────────────────────────────────────────────
// Deliberately text-based, not @prisma/client introspection: the point is to
// catch a change to the DECLARED schema in review/CI, with no migrated
// database and no generated client required.

const SCHEMA = readSource('prisma/schema.prisma');

const PRISMA_SCALAR_TYPES = new Set([
  'String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes',
]);

type ModelField = { name: string; rawType: string; baseType: string; isList: boolean; isOptional: boolean; attrs: string };

type ParsedModel = { name: string; body: string; fields: ModelField[]; blockAttributes: string[] };

function parseModel(schema: string, modelName: string): ParsedModel {
  const start = schema.indexOf(`\nmodel ${modelName} {`);
  assert.notEqual(start, -1, `model ${modelName} must exist in schema.prisma`);
  const bodyStart = schema.indexOf('{', start) + 1;
  const end = schema.indexOf('\n}', bodyStart);
  assert.notEqual(end, -1, `model ${modelName} must be closed`);
  const body = schema.slice(bodyStart, end);

  const fields: ModelField[] = [];
  const blockAttributes: string[] = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('///')) continue;
    if (line.startsWith('@@')) { blockAttributes.push(line); continue; }
    const m = /^(\w+)\s+([A-Za-z]\w*(?:\[\])?\??)(.*)$/.exec(line);
    if (!m) continue;
    const rawType = m[2]!;
    fields.push({
      name: m[1]!,
      rawType,
      baseType: rawType.replace(/\[\]|\?/g, ''),
      isList: rawType.endsWith('[]'),
      isOptional: rawType.endsWith('?'),
      attrs: (m[3] ?? '').trim(),
    });
  }
  return { name: modelName, body, fields, blockAttributes };
}

const patientModel = parseModel(SCHEMA, 'Patient');
const identityModel = parseModel(SCHEMA, 'PatientIdentityDocument');

/** Every scalar column declared on Patient — the universe this guard enforces over. */
const PATIENT_SCALARS = patientModel.fields
  .filter((f) => !f.isList && PRISMA_SCALAR_TYPES.has(f.baseType))
  .map((f) => f.name);

function fieldOf(model: ParsedModel, name: string): ModelField | undefined {
  return model.fields.find((f) => f.name === name);
}

// ── Source-derived field sets ────────────────────────────────────────────────

/** Extracts the `{ ... }` object literal starting at `openBraceIndex`, brace-matched. */
function extractBlock(source: string, openBraceIndex: number): string {
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(openBraceIndex + 1, i);
    }
  }
  throw new Error('unbalanced braces while extracting object literal');
}

/** Top-level `key:` names of an object-literal body, ignoring comment lines. */
function objectKeys(blockBody: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  for (const rawLine of blockBody.split('\n')) {
    const line = rawLine.trim();
    const opens = (line.match(/[{[]/g) ?? []).length;
    const closes = (line.match(/[}\]]/g) ?? []).length;
    if (!line.startsWith('//')) {
      const m = /^(\w+)\s*:/.exec(line);
      if (m && depth === 0) keys.push(m[1]!);
    }
    depth += opens - closes;
  }
  return keys;
}

const ANONYMIZATION_SOURCE = readSource('src/services/privacy/patientAnonymization.ts');

/** The `data: { ... }` payload of the single `prisma.patient.update()` call. */
const ANONYMIZATION_PAYLOAD_FIELDS = (() => {
  const updateAt = ANONYMIZATION_SOURCE.indexOf('prisma.patient.update(');
  assert.notEqual(updateAt, -1, 'patientAnonymization.ts must still contain a prisma.patient.update() call');
  const dataAt = ANONYMIZATION_SOURCE.indexOf('data: {', updateAt);
  assert.notEqual(dataAt, -1, 'the patient update must still carry a data: { ... } payload');
  return objectKeys(extractBlock(ANONYMIZATION_SOURCE, ANONYMIZATION_SOURCE.indexOf('{', dataAt)));
})();

const PATIENT_PRIVACY_SOURCE = readSource('src/routes/patientPrivacy.ts');

/** The Patient `select: { ... }` of the KVKK Art. 11 subject-access collection. */
const SUBJECT_ACCESS_SELECT_FIELDS = (() => {
  const collectAt = PATIENT_PRIVACY_SOURCE.indexOf('async function collectStructuredExportData');
  assert.notEqual(collectAt, -1, 'patientPrivacy.ts must still declare collectStructuredExportData');
  const findAt = PATIENT_PRIVACY_SOURCE.indexOf('prisma.patient.findFirst(', collectAt);
  assert.notEqual(findAt, -1, 'the subject-access collection must still read the patient row');
  const selectAt = PATIENT_PRIVACY_SOURCE.indexOf('select: {', findAt);
  assert.notEqual(selectAt, -1, 'the subject-access patient read must still use an explicit select');
  return objectKeys(extractBlock(PATIENT_PRIVACY_SOURCE, PATIENT_PRIVACY_SOURCE.indexOf('{', selectAt)));
})();

const BULK_EXPORT_SELECT_FIELDS = Object.entries(PATIENT_SELECT)
  .filter(([, v]) => v === true)
  .map(([k]) => k);

// ── The documented EXEMPT lists ──────────────────────────────────────────────
// Each entry needs a one-line reason. Adding a field here is a deliberate,
// reviewable privacy decision — not a way to silence this test.

/** Patient scalars that are legitimately NOT written by anonymization. */
const ANONYMIZATION_EXEMPT: Record<string, string> = {
  id: 'primary key — the row is preserved (never hard-deleted), so its identity must survive',
  clinicId: 'tenant scope; clearing it would orphan the row from every clinic-scoped query',
  organizationId: 'tenant scope (NOT NULL); same reason as clinicId',
  primaryClinicId: 'branch preference, not patient PII — operational routing metadata',
  patientStatus: 'lifecycle state (new/active/archived), a closed vocabulary carrying no PII',
  source: 'acquisition channel (google/referral/...), a closed vocabulary carrying no PII',
  smsOptOut: 'KVKK suppression flag — MUST survive anonymization or outbound SMS could resume',
  smsOptOutAt: 'evidence of when the suppression was recorded; part of the same consent record',
  primaryPractitionerId: 'identifies a STAFF member, not the patient; clearing it destroys clinical/operational history without reducing patient re-identification risk',
  isAnonymized: 'set to true BY anonymization — it is the outcome flag, not a target',
  anonymizedAt: 'anonymization audit evidence written by this very operation',
  anonymizedById: 'anonymization audit evidence written by this very operation',
  anonymizationReason: 'anonymization audit evidence written by this very operation (already length-capped)',
  createdAt: 'record-keeping timestamp; retention/statute-of-limitation reporting depends on it',
  updatedAt: 'record-keeping timestamp maintained by Prisma (@updatedAt)',
  deletedAt: 'soft-delete marker; anonymization and deletion are distinct lifecycle states',
};

/** Patient scalars that are legitimately NOT in the clinic bulk export contract. */
const BULK_EXPORT_EXEMPT: Record<string, string> = {
  clinicId: 'the export is already per-clinic; the column would be a constant in every row',
  organizationId: 'internal tenant key with no consumer in the export package',
  primaryPractitionerId: 'staff foreign key, not patient data, and no export consumer reads it today',
  anonymizedById: 'internal staff user id — exporting it would disclose staff identity to the export recipient',
  anonymizationReason: 'free-text staff justification, not patient data; may itself contain incidental notes',
  deletedAt: 'internal soft-delete bookkeeping; the export deliberately carries live records only',
};

/** Patient scalars that are legitimately NOT in the KVKK subject-access export. */
const SUBJECT_ACCESS_EXEMPT: Record<string, string> = {
  clinicId: 'internal tenant key — not personal data about the subject',
  organizationId: 'internal tenant key — not personal data about the subject',
  primaryClinicId: 'internal branch-routing key; the subject is told which clinic holds the data by the export itself',
  primaryPractitionerId: 'identifies a STAFF member — a third party\'s personal data, out of scope for this subject\'s access right',
  smsOptOut: 'consent/suppression state is disclosed through the dedicated consent surfaces, not duplicated here',
  smsOptOutAt: 'same as smsOptOut — consent evidence lives in the consent record',
  anonymizedById: 'internal staff user id — a third party\'s personal data',
  anonymizationReason: 'free-text staff justification about the request, not personal data held about the subject',
  deletedAt: 'internal soft-delete bookkeeping',
};

function assertCoverage(
  label: string,
  covered: string[],
  exempt: Record<string, string>,
  hint: string,
) {
  const coveredSet = new Set(covered);
  const uncovered = PATIENT_SCALARS.filter((f) => !coveredSet.has(f) && !(f in exempt));
  assert.deepEqual(
    uncovered,
    [],
    `Patient scalar(s) ${JSON.stringify(uncovered)} are neither handled by ${label} nor listed in its EXEMPT map. ${hint}`,
  );
  // An EXEMPT entry for a field that no longer exists is dead documentation.
  const scalarSet = new Set(PATIENT_SCALARS);
  const stale = Object.keys(exempt).filter((f) => !scalarSet.has(f));
  assert.deepEqual(stale, [], `${label} EXEMPT list references Patient scalar(s) that no longer exist: ${JSON.stringify(stale)}`);
  for (const [field, reason] of Object.entries(exempt)) {
    assert.ok(reason.trim().length >= 15, `${label} EXEMPT entry "${field}" must record a real one-line reason`);
  }
}

async function main() {
  console.log('Patient / PatientIdentityDocument schema-drift guard (F3-DATA-MIG-TODAY-001, F3-DATA-MIG-003)');

  section('1. New Patient scalars are additive and nullable');

  for (const name of ['gender', 'chartNumber', 'primaryPractitionerId']) {
    await test(`Patient.${name} is declared String? with no default`, () => {
      const field = fieldOf(patientModel, name);
      assert.ok(field, `Patient.${name} must exist`);
      assert.equal(field!.rawType, 'String?', `Patient.${name} must stay nullable String? — a non-null type would require a backfill and could not represent "not recorded"`);
      assert.ok(!/@default\(/.test(field!.attrs), `Patient.${name} must have NO @default — a default would silently invent data for every existing row`);
    });
  }

  section('2. Tenant-first indexes');

  await test('Patient declares @@index([clinicId, chartNumber]) with the tenant column FIRST', () => {
    assert.ok(
      patientModel.blockAttributes.includes('@@index([clinicId, chartNumber])'),
      'the index must lead with clinicId so it is usable under the clinic scope every query already applies',
    );
  });

  await test('Patient declares @@index([clinicId, primaryPractitionerId]) with the tenant column FIRST', () => {
    assert.ok(
      patientModel.blockAttributes.includes('@@index([clinicId, primaryPractitionerId])'),
      'the index must lead with clinicId',
    );
  });

  section('3. chartNumber must NOT be unique');

  await test('Patient.chartNumber carries no @unique and no @@unique', () => {
    const field = fieldOf(patientModel, 'chartNumber')!;
    assert.ok(!/@unique/.test(field.attrs), 'measured source data has legitimate duplicate chartNumber pairs — a hard unique constraint would block go-live before any human reviewed them');
    const uniques = patientModel.blockAttributes.filter((a) => a.startsWith('@@unique') && a.includes('chartNumber'));
    assert.deepEqual(uniques, [], 'no composite unique may include chartNumber for the same reason');
  });

  section('4. PatientIdentityDocument constraints');

  await test('@@unique([patientId, docType]) is declared (the one genuine invariant)', () => {
    assert.ok(
      identityModel.blockAttributes.includes('@@unique([patientId, docType])'),
      'one document per type per patient is the invariant all legacy data satisfies',
    );
  });

  await test('@@index([organizationId, docType, lookupHash]) is declared with organizationId FIRST', () => {
    assert.ok(
      identityModel.blockAttributes.includes('@@index([organizationId, docType, lookupHash])'),
      'the tenant column leading this index is LOAD-BEARING, not incidental: lookup must be tenant-scoped by construction',
    );
  });

  await test('lookupHash has no unique constraint alone, and none without organizationId', () => {
    const field = fieldOf(identityModel, 'lookupHash');
    assert.ok(field, 'PatientIdentityDocument.lookupHash must exist');
    assert.ok(!/@unique/.test(field!.attrs), 'a field-level @unique on lookupHash would make the token a cross-tenant, cross-patient correlator and would reject legitimate duplicate legacy values');
    for (const attr of identityModel.blockAttributes) {
      if (!attr.startsWith('@@unique') || !attr.includes('lookupHash')) continue;
      assert.ok(
        attr.includes('organizationId'),
        `@@unique on lookupHash without organizationId is a cross-tenant constraint: ${attr}`,
      );
    }
    assert.ok(!identityModel.blockAttributes.includes('@@unique([lookupHash])'), 'no @@unique([lookupHash])');
    assert.ok(!identityModel.blockAttributes.includes('@@unique([docType, lookupHash])'), 'no @@unique([docType, lookupHash]) — it would be tenant-blind');
  });

  await test('cryptoVersion is declared Int @default(1)', () => {
    const field = fieldOf(identityModel, 'cryptoVersion');
    assert.ok(field, 'PatientIdentityDocument.cryptoVersion must exist');
    assert.equal(field!.rawType, 'Int');
    assert.ok(/@default\(1\)/.test(field!.attrs), 'cryptoVersion must default to generation 1 so an added rotation mechanism is an additive backfill, not a destructive rewrite');
  });

  section('5. Auto-leak guard — identity data must NEVER be a Patient scalar');

  await test('Patient declares no identity scalar (tcNo/nationalId/identityNumber/valueEncrypted/lookupHash)', () => {
    const forbidden = ['tcNo', 'tckn', 'nationalId', 'identityNumber', 'passportNumber', 'valueEncrypted', 'lookupHash', 'cryptoVersion'];
    const present = forbidden.filter((name) => fieldOf(patientModel, name) !== undefined);
    assert.deepEqual(
      present,
      [],
      'GET /patients/:id responds with a whole-record spread, so ANY Patient scalar auto-leaks to every authorized clinic client with zero code change — identity data must stay in the child model',
    );
  });

  await test('identityDocuments is a RELATION to PatientIdentityDocument, never inlined', () => {
    const field = fieldOf(patientModel, 'identityDocuments');
    assert.ok(field, 'Patient.identityDocuments must exist');
    assert.equal(field!.rawType, 'PatientIdentityDocument[]', 'it must remain a list relation — returned only when explicitly included');
    assert.ok(!PRISMA_SCALAR_TYPES.has(field!.baseType), 'identityDocuments must not be a scalar');
    assert.ok(!PATIENT_SCALARS.includes('identityDocuments'), 'identityDocuments must never enter the scalar universe');
  });

  section('6. THE DRIFT GUARD — every Patient scalar is handled or documented-exempt');

  await test('sanity: the Patient scalar universe was parsed and is non-trivial', () => {
    assert.ok(PATIENT_SCALARS.length >= 25, `expected the full Patient scalar list, parsed ${PATIENT_SCALARS.length}: ${JSON.stringify(PATIENT_SCALARS)}`);
    for (const expected of ['gender', 'chartNumber', 'primaryPractitionerId', 'firstName', 'deletedAt']) {
      assert.ok(PATIENT_SCALARS.includes(expected), `parser must see Patient.${expected}`);
    }
  });

  await test('anonymization: every Patient scalar is nulled/rewritten or documented ANONYMIZATION_EXEMPT', () => {
    assertCoverage(
      'anonymization (patientAnonymization.ts prisma.patient.update data payload)',
      ANONYMIZATION_PAYLOAD_FIELDS,
      ANONYMIZATION_EXEMPT,
      'Anonymization is a hand-enumerated DENY-list and therefore fail-OPEN: decide explicitly whether the new field is patient PII (add it to the payload) or not (add it here with a reason).',
    );
  });

  await test('clinic bulk export: every Patient scalar is in PATIENT_SELECT or documented BULK_EXPORT_EXEMPT', () => {
    assertCoverage(
      'clinic bulk export (PATIENT_SELECT)',
      BULK_EXPORT_SELECT_FIELDS,
      BULK_EXPORT_EXEMPT,
      'Decide explicitly whether the new field belongs in the versioned export data contract.',
    );
  });

  await test('KVKK subject access: every Patient scalar is in the export select or documented SUBJECT_ACCESS_EXEMPT', () => {
    assertCoverage(
      'KVKK Art. 11 subject access (patientPrivacy.ts collectStructuredExportData patient select)',
      SUBJECT_ACCESS_SELECT_FIELDS,
      SUBJECT_ACCESS_EXEMPT,
      'Decide explicitly whether the new field is personal data the subject is entitled to receive.',
    );
  });

  section('7. This sprint\'s three fields reached the surfaces they were supposed to');

  await test('gender and chartNumber are anonymized; primaryPractitionerId is deliberately not', () => {
    assert.ok(ANONYMIZATION_PAYLOAD_FIELDS.includes('gender'), 'gender is demographic PII and must be nulled');
    assert.ok(ANONYMIZATION_PAYLOAD_FIELDS.includes('chartNumber'), 'chartNumber is a re-identification vector against the physical paper archive and must be nulled');
    assert.ok(!ANONYMIZATION_PAYLOAD_FIELDS.includes('primaryPractitionerId'), 'primaryPractitionerId identifies staff, not the patient — see ANONYMIZATION_EXEMPT');
  });

  await test('anonymization hard-deletes the patient\'s identity documents', () => {
    assert.match(
      ANONYMIZATION_SOURCE,
      /patientIdentityDocument\.deleteMany\(\s*\{\s*where:\s*\{\s*patientId\s*\}/,
      'an identity number has no clinical value to preserve, so it is destroyed outright rather than nulled or redacted',
    );
  });

  await test('gender and chartNumber reached both export surfaces', () => {
    for (const field of ['gender', 'chartNumber']) {
      assert.ok(BULK_EXPORT_SELECT_FIELDS.includes(field), `PATIENT_SELECT must export ${field}`);
      assert.ok(SUBJECT_ACCESS_SELECT_FIELDS.includes(field), `the KVKK subject-access select must include ${field}`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
