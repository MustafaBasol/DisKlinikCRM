/**
 * tenantModelClassification.test.ts — F3-1 tenant-classification drift guard.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * utils/tenantModelClassification.ts states, as data, who owns every Prisma
 * model. A registry nothing checks is prose with semicolons: it drifts the
 * first time someone adds a model, and the drift is invisible because an
 * unclassified table simply has no entry — the exact shape of a silent
 * cross-tenant exposure.
 *
 * This suite is the enforcement half. It parses the REAL
 * server/prisma/schema.prisma as text and holds the registry to it in both
 * directions, so that:
 *   - adding a Prisma model without classifying it FAILS CI (Test A);
 *   - deleting or renaming a model without updating the registry FAILS (B);
 *   - claiming an ownership column or parent relation the schema does not
 *     actually have FAILS (C);
 *   - a model with no clinicId can never become "global" by omission (D);
 *   - anything whose ownership is undecided stays loud and is provably not
 *     treated as tenant-safe (E).
 *
 * DATABASE-FREE and read-only: text parsing plus a direct import of the
 * registry. No Prisma client, no DATABASE_URL, no network. Harness shape
 * copied from migrationPatientSchemaDrift.test.ts — standalone tsx script,
 * node:assert/strict, hand-rolled counters. There is no vitest/jest here.
 *
 * Never make a failure here go away by moving a model into PLATFORM_GLOBAL or
 * onto an exemption list. The decision this suite forces IS the feature.
 *
 * Run with: tsx src/tests/tenantModelClassification.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TENANT_MODEL_CLASSIFICATION,
  TENANT_MODEL_CLASSIFICATION_BY_MODEL,
  assertTenantOwnershipResolved,
  getTenantClassification,
  isTenantGuardApplicable,
  modelsRequiringExplicitReview,
  modelsRequiringFutureSchemaWork,
  requireTenantClassification,
  tenantClassificationCounts,
  type TenantClassification,
  type TenantModelEntry,
} from '../utils/tenantModelClassification.js';

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

// ── schema.prisma parsing ────────────────────────────────────────────────────
// Text-based on purpose: the contract is over the DECLARED schema, so this must
// hold with no migrated database and no generated Prisma client.
//
// CRLF is normalized away up front. This repository is developed on Windows and
// schema.prisma is checked out with CRLF line terminators; a parser that splits
// on bare '\n' would otherwise leave a trailing '\r' on every token and match
// nothing, which reads as "no tenant columns anywhere" rather than as an error.

type ParsedField = {
  name: string;
  rawType: string;
  baseType: string;
  isList: boolean;
  isOptional: boolean;
  attrs: string;
};

type ParsedModel = {
  name: string;
  fields: ParsedField[];
  fieldsByName: Map<string, ParsedField>;
};

function parseSchemaModels(schemaText: string): ParsedModel[] {
  const schema = schemaText.replace(/\r\n/g, '\n');
  const models: ParsedModel[] = [];
  let current: { name: string; fields: ParsedField[] } | null = null;

  for (const rawLine of schema.split('\n')) {
    const line = rawLine.trim();

    const opening = /^model\s+(\w+)\s*\{/.exec(line);
    if (opening) {
      assert.equal(current, null, `nested model block before ${opening[1]} — parser assumption broken`);
      current = { name: opening[1]!, fields: [] };
      continue;
    }
    if (!current) continue;
    if (line === '}') {
      models.push({
        name: current.name,
        fields: current.fields,
        fieldsByName: new Map(current.fields.map((f) => [f.name, f])),
      });
      current = null;
      continue;
    }
    if (!line || line.startsWith('//')) continue;
    if (line.startsWith('@@')) continue;

    const field = /^(\w+)\s+([A-Za-z]\w*(?:\[\])?\??)(.*)$/.exec(line);
    if (!field) continue;
    const rawType = field[2]!;
    current.fields.push({
      name: field[1]!,
      rawType,
      baseType: rawType.replace(/\[\]|\?/g, ''),
      isList: rawType.endsWith('[]'),
      isOptional: rawType.endsWith('?'),
      attrs: (field[3] ?? '').trim(),
    });
  }

  assert.equal(current, null, 'unterminated model block in schema.prisma');
  return models;
}

const SCHEMA_TEXT = readFileSync(resolve(SERVER_ROOT, 'prisma/schema.prisma'), 'utf8');
const SCHEMA_MODELS = parseSchemaModels(SCHEMA_TEXT);
const SCHEMA_MODEL_NAMES = SCHEMA_MODELS.map((m) => m.name);
const SCHEMA_BY_NAME = new Map(SCHEMA_MODELS.map((m) => [m.name, m]));

/** Sanity floor on the parser itself: a regression that parses nothing must not read as "all clear". */
function assertParserSane() {
  assert.ok(
    SCHEMA_MODELS.length >= 100,
    `parsed only ${SCHEMA_MODELS.length} models from schema.prisma — the parser, not the schema, is almost certainly broken`,
  );
  const patient = SCHEMA_BY_NAME.get('Patient');
  assert.ok(patient, 'Patient must parse');
  assert.ok(patient!.fieldsByName.has('clinicId'), 'Patient.clinicId must parse — parser regression otherwise');
  assert.equal(
    patient!.fieldsByName.get('clinicId')!.isOptional,
    false,
    'Patient.clinicId must parse as NOT NULL — parser regression otherwise',
  );
}

/** Classifications whose correctness is not a mechanical read of the model's own columns. */
const RATIONALE_REQUIRED: ReadonlySet<TenantClassification> = new Set<TenantClassification>([
  'PLATFORM_GLOBAL',
  'SYSTEM_INTERNAL',
  'PARENT_SCOPED',
  'EXPLICIT_REVIEW_REQUIRED',
]);

/** guardMode values that are legal for a given classification. */
const ALLOWED_GUARD_MODES: Readonly<Record<TenantClassification, readonly string[]>> = {
  ORGANIZATION_SCOPED_DIRECT: ['AUTO_FILTER_ORGANIZATION_ID'],
  CLINIC_SCOPED_DIRECT: ['AUTO_FILTER_CLINIC_ID', 'AUTO_FILTER_DUAL_KEY'],
  PARENT_SCOPED: ['PARENT_OWNERSHIP_VALIDATION'],
  PLATFORM_GLOBAL: ['NO_TENANT_FILTER'],
  SYSTEM_INTERNAL: ['SYSTEM_CONTEXT_ONLY'],
  EXPLICIT_REVIEW_REQUIRED: ['BLOCKED_PENDING_REVIEW'],
};

function entryFor(model: string): TenantModelEntry {
  const entry = TENANT_MODEL_CLASSIFICATION_BY_MODEL[model];
  assert.ok(entry, `no registry entry for ${model}`);
  return entry!;
}

async function main() {
  console.log('F3-1 tenant model classification — schema/registry drift guard');

  section('Parser sanity');
  await test('schema.prisma parses into a plausible model set (CRLF-safe)', assertParserSane);

  // ── Test A ─────────────────────────────────────────────────────────────────
  section('Test A — every Prisma model is classified');

  await test('every model declared in schema.prisma has a classification entry', () => {
    const missing = SCHEMA_MODEL_NAMES.filter((name) => !TENANT_MODEL_CLASSIFICATION_BY_MODEL[name]);
    assert.deepEqual(
      missing,
      [],
      `these Prisma models have no tenant classification: ${missing.join(', ')}. ` +
        'Add each to TENANT_MODEL_CLASSIFICATION in utils/tenantModelClassification.ts. ' +
        'An unclassified model is never assumed to be global — decide its owner.',
    );
  });

  await test('classification count equals the schema model count', () => {
    assert.equal(
      TENANT_MODEL_CLASSIFICATION.length,
      SCHEMA_MODEL_NAMES.length,
      'registry size and schema model count must move together',
    );
  });

  await test('no model is classified twice', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const entry of TENANT_MODEL_CLASSIFICATION) {
      if (seen.has(entry.model)) duplicates.push(entry.model);
      seen.add(entry.model);
    }
    assert.deepEqual(duplicates, [], `duplicate registry entries: ${duplicates.join(', ')}`);
  });

  await test('registry order matches schema.prisma declaration order (keeps the diff reviewable)', () => {
    assert.deepEqual(
      TENANT_MODEL_CLASSIFICATION.map((e) => e.model),
      SCHEMA_MODEL_NAMES,
      'add new entries in the position the model occupies in schema.prisma',
    );
  });

  // ── Test B ─────────────────────────────────────────────────────────────────
  section('Test B — classification does not reference nonexistent models');

  await test('every classification entry names a model that still exists in schema.prisma', () => {
    const stale = TENANT_MODEL_CLASSIFICATION.map((e) => e.model).filter((m) => !SCHEMA_BY_NAME.has(m));
    assert.deepEqual(
      stale,
      [],
      `these classification entries reference models that no longer exist: ${stale.join(', ')}. ` +
        'A renamed model leaves the new name unclassified and the old entry lying — remove or rename the entry.',
    );
  });

  await test('every declared PARENT_SCOPED target model exists', () => {
    const broken = TENANT_MODEL_CLASSIFICATION.filter((e) => e.parent && !SCHEMA_BY_NAME.has(e.parent.model)).map(
      (e) => `${e.model} -> ${e.parent!.model}`,
    );
    assert.deepEqual(broken, [], `parent models missing from schema.prisma: ${broken.join(', ')}`);
  });

  // ── Test C ─────────────────────────────────────────────────────────────────
  section('Test C — declared ownership fields are real');

  await test('declared organizationId columns exist with the declared nullability', () => {
    const problems: string[] = [];
    for (const entry of TENANT_MODEL_CLASSIFICATION) {
      const model = SCHEMA_BY_NAME.get(entry.model);
      if (!model) continue;
      const actual = model.fieldsByName.get('organizationId');
      if (entry.organizationIdField === null) {
        if (actual) problems.push(`${entry.model}: registry says no organizationId, schema declares one`);
        continue;
      }
      if (entry.organizationIdField !== 'organizationId') {
        problems.push(`${entry.model}: organizationIdField must be 'organizationId' or null, got '${entry.organizationIdField}'`);
        continue;
      }
      if (!actual) { problems.push(`${entry.model}: registry declares organizationId, schema has none`); continue; }
      if (actual.isOptional !== entry.organizationIdNullable) {
        problems.push(
          `${entry.model}: organizationIdNullable=${entry.organizationIdNullable} but schema declares ${actual.rawType}`,
        );
      }
    }
    assert.deepEqual(problems, [], problems.join('\n      '));
  });

  await test('declared clinicId columns exist with the declared nullability', () => {
    const problems: string[] = [];
    for (const entry of TENANT_MODEL_CLASSIFICATION) {
      const model = SCHEMA_BY_NAME.get(entry.model);
      if (!model) continue;
      const actual = model.fieldsByName.get('clinicId');
      if (entry.clinicIdField === null) {
        if (actual) problems.push(`${entry.model}: registry says no clinicId, schema declares one`);
        continue;
      }
      if (entry.clinicIdField !== 'clinicId') {
        problems.push(`${entry.model}: clinicIdField must be 'clinicId' or null, got '${entry.clinicIdField}'`);
        continue;
      }
      if (!actual) { problems.push(`${entry.model}: registry declares clinicId, schema has none`); continue; }
      if (actual.isOptional !== entry.clinicIdNullable) {
        problems.push(`${entry.model}: clinicIdNullable=${entry.clinicIdNullable} but schema declares ${actual.rawType}`);
      }
    }
    assert.deepEqual(problems, [], problems.join('\n      '));
  });

  await test('CLINIC_SCOPED_DIRECT models really carry a NOT NULL clinicId', () => {
    const problems: string[] = [];
    for (const entry of TENANT_MODEL_CLASSIFICATION) {
      if (entry.classification !== 'CLINIC_SCOPED_DIRECT') continue;
      const actual = SCHEMA_BY_NAME.get(entry.model)?.fieldsByName.get('clinicId');
      if (!actual || actual.isOptional) {
        problems.push(
          `${entry.model}: classified CLINIC_SCOPED_DIRECT but schema declares clinicId as ${actual?.rawType ?? 'absent'}. ` +
            'A nullable or missing clinic key cannot be the sole tenant predicate.',
        );
      }
    }
    assert.deepEqual(problems, [], problems.join('\n      '));
  });

  await test('ORGANIZATION_SCOPED_DIRECT models really carry a NOT NULL organizationId (Organization itself excepted)', () => {
    const problems: string[] = [];
    for (const entry of TENANT_MODEL_CLASSIFICATION) {
      if (entry.classification !== 'ORGANIZATION_SCOPED_DIRECT') continue;
      if (entry.model === 'Organization') {
        // The tenant root: its own id IS the organization identity.
        assert.equal(entry.organizationIdField, null, 'Organization must not declare an organizationId column');
        assert.ok(entry.rationale, 'Organization must record why it has no organizationId column');
        continue;
      }
      const actual = SCHEMA_BY_NAME.get(entry.model)?.fieldsByName.get('organizationId');
      if (!actual || actual.isOptional) {
        problems.push(
          `${entry.model}: classified ORGANIZATION_SCOPED_DIRECT but schema declares organizationId as ${actual?.rawType ?? 'absent'}`,
        );
      }
    }
    assert.deepEqual(problems, [], problems.join('\n      '));
  });

  await test('AUTO_FILTER_DUAL_KEY is claimed only where BOTH tenant columns are NOT NULL', () => {
    const problems: string[] = [];
    for (const entry of TENANT_MODEL_CLASSIFICATION) {
      if (entry.guardMode !== 'AUTO_FILTER_DUAL_KEY') continue;
      const model = SCHEMA_BY_NAME.get(entry.model);
      const org = model?.fieldsByName.get('organizationId');
      const clinic = model?.fieldsByName.get('clinicId');
      if (!org || org.isOptional || !clinic || clinic.isOptional) {
        problems.push(
          `${entry.model}: AUTO_FILTER_DUAL_KEY requires NOT NULL organizationId AND clinicId, schema has ` +
            `organizationId=${org?.rawType ?? 'absent'} clinicId=${clinic?.rawType ?? 'absent'}`,
        );
      }
    }
    assert.deepEqual(problems, [], problems.join('\n      '));
  });

  await test('organizationDerivedVia is declared exactly where organization identity is not held directly', () => {
    const problems: string[] = [];
    for (const entry of TENANT_MODEL_CLASSIFICATION) {
      const holdsOrgDirectly = entry.organizationIdField !== null && !entry.organizationIdNullable;
      const shouldDerive = entry.classification === 'CLINIC_SCOPED_DIRECT' && !holdsOrgDirectly;
      if (shouldDerive && entry.organizationDerivedVia === null) {
        problems.push(`${entry.model}: clinic-scoped without a trustworthy organizationId must record organizationDerivedVia`);
      }
      if (!shouldDerive && entry.organizationDerivedVia !== null) {
        problems.push(`${entry.model}: organizationDerivedVia is set but organization identity is held directly`);
      }
    }
    assert.deepEqual(problems, [], problems.join('\n      '));
  });

  await test('the clinicId -> Clinic.organizationId hop that organizationDerivedVia relies on still exists', () => {
    const derived = TENANT_MODEL_CLASSIFICATION.filter((e) => e.organizationDerivedVia !== null);
    assert.ok(derived.length > 0, 'expected at least one model deriving organization identity through Clinic');
    for (const entry of derived) {
      assert.equal(
        entry.organizationDerivedVia,
        'clinicId -> Clinic.organizationId',
        `${entry.model}: unrecognized derivation path '${entry.organizationDerivedVia}' — the hop below only verifies the Clinic one`,
      );
    }
    const clinicOrg = SCHEMA_BY_NAME.get('Clinic')?.fieldsByName.get('organizationId');
    assert.ok(clinicOrg, 'Clinic.organizationId must exist — every clinic-scoped model derives its organization through it');
    assert.equal(
      clinicOrg!.isOptional,
      false,
      'Clinic.organizationId must stay NOT NULL: if it becomes nullable, organization identity for ' +
        `${derived.length} clinic-scoped models silently becomes underivable`,
    );
    const clinicOrgRelation = SCHEMA_BY_NAME.get('Clinic')?.fieldsByName.get('organization');
    assert.ok(clinicOrgRelation, 'Clinic.organization relation must exist');
    assert.equal(clinicOrgRelation!.baseType, 'Organization', 'Clinic.organization must point at Organization');
    assert.equal(clinicOrgRelation!.isOptional, false, 'Clinic.organization must be a required to-one relation');
    assert.match(
      clinicOrgRelation!.attrs,
      /@relation\([^)]*fields:\s*\[\s*organizationId\s*\]/,
      'the Clinic -> Organization link must remain FK-enforced on organizationId',
    );
  });

  await test('PARENT_SCOPED declarations match a real relation field, FK scalar and target model', () => {
    const problems: string[] = [];
    for (const entry of TENANT_MODEL_CLASSIFICATION) {
      if (!entry.parent) continue;
      const model = SCHEMA_BY_NAME.get(entry.model);
      if (!model) continue;
      const relation = model.fieldsByName.get(entry.parent.relationField);
      if (!relation) {
        problems.push(`${entry.model}: declared parent relation '${entry.parent.relationField}' does not exist`);
        continue;
      }
      if (relation.baseType !== entry.parent.model) {
        problems.push(
          `${entry.model}.${entry.parent.relationField} points at ${relation.baseType}, registry says ${entry.parent.model}`,
        );
      }
      if (relation.isList) {
        problems.push(`${entry.model}.${entry.parent.relationField} is a list — a parent path must be to-one`);
      }
      if (relation.isOptional) {
        problems.push(
          `${entry.model}.${entry.parent.relationField} is optional — an optional parent cannot carry tenant identity for every row`,
        );
      }
      const fk = model.fieldsByName.get(entry.parent.foreignKeyField);
      if (!fk) {
        problems.push(`${entry.model}: declared foreign key '${entry.parent.foreignKeyField}' does not exist`);
      } else if (fk.isOptional) {
        problems.push(`${entry.model}.${entry.parent.foreignKeyField} is nullable — tenant identity would be underivable for null rows`);
      }
      if (!/fields:\s*\[\s*\w+\s*\]/.test(relation.attrs)) {
        problems.push(`${entry.model}.${entry.parent.relationField} is not an FK-bearing relation`);
      }
    }
    assert.deepEqual(problems, [], problems.join('\n      '));
  });

  await test('PARENT_SCOPED models genuinely have no tenant column of their own', () => {
    const problems: string[] = [];
    for (const entry of TENANT_MODEL_CLASSIFICATION) {
      if (entry.classification !== 'PARENT_SCOPED') continue;
      assert.ok(entry.parent, `${entry.model}: PARENT_SCOPED must declare its parent path`);
      const model = SCHEMA_BY_NAME.get(entry.model);
      const org = model?.fieldsByName.get('organizationId');
      const clinic = model?.fieldsByName.get('clinicId');
      if (org || clinic) {
        problems.push(
          `${entry.model}: classified PARENT_SCOPED but the schema now declares a direct tenant column ` +
            `(organizationId=${org?.rawType ?? 'absent'} clinicId=${clinic?.rawType ?? 'absent'}). ` +
            'Reclassify it as direct-scoped rather than deriving through a parent.',
        );
      }
    }
    assert.deepEqual(problems, [], problems.join('\n      '));
  });

  // ── Test D ─────────────────────────────────────────────────────────────────
  section('Test D — platform/global models are explicit, never a default');

  await test('every model without a clinicId column is still explicitly classified', () => {
    const unclassified = SCHEMA_MODELS.filter((m) => !m.fieldsByName.has('clinicId')).filter(
      (m) => !TENANT_MODEL_CLASSIFICATION_BY_MODEL[m.name],
    );
    assert.deepEqual(
      unclassified.map((m) => m.name),
      [],
      'a model must never become effectively unprotected just because it has no clinicId column',
    );
  });

  await test('PLATFORM_GLOBAL and SYSTEM_INTERNAL each carry a recorded rationale', () => {
    const missing = TENANT_MODEL_CLASSIFICATION.filter(
      (e) => RATIONALE_REQUIRED.has(e.classification) && !(e.rationale && e.rationale.trim().length >= 40),
    ).map((e) => `${e.model} (${e.classification})`);
    assert.deepEqual(
      missing,
      [],
      `these classifications are positive assertions and must record WHY: ${missing.join(', ')}`,
    );
  });

  await test('PLATFORM_GLOBAL is never claimed for a model that carries a tenant column', () => {
    const problems: string[] = [];
    for (const entry of TENANT_MODEL_CLASSIFICATION) {
      if (entry.classification !== 'PLATFORM_GLOBAL') continue;
      const model = SCHEMA_BY_NAME.get(entry.model);
      const org = model?.fieldsByName.get('organizationId');
      const clinic = model?.fieldsByName.get('clinicId');
      if (org || clinic) {
        problems.push(
          `${entry.model}: classified PLATFORM_GLOBAL but declares ` +
            `${org ? 'organizationId ' : ''}${clinic ? 'clinicId' : ''} — a tenant column contradicts "not tenant-owned"`,
        );
      }
      assert.equal(entry.organizationDerivedVia, null, `${entry.model}: PLATFORM_GLOBAL cannot derive an organization`);
      assert.equal(entry.parent, null, `${entry.model}: PLATFORM_GLOBAL cannot inherit from a parent`);
    }
    assert.deepEqual(problems, [], problems.join('\n      '));
  });

  await test('PLATFORM_GLOBAL and SYSTEM_INTERNAL are not treated as tenant-guarded', () => {
    for (const entry of TENANT_MODEL_CLASSIFICATION) {
      if (entry.classification !== 'PLATFORM_GLOBAL' && entry.classification !== 'SYSTEM_INTERNAL') continue;
      assert.equal(
        isTenantGuardApplicable(entry.model),
        false,
        `${entry.model}: ${entry.classification} must not report a tenant guard as applicable`,
      );
    }
  });

  await test('guardMode is consistent with classification for every entry', () => {
    const problems: string[] = [];
    for (const entry of TENANT_MODEL_CLASSIFICATION) {
      const allowed = ALLOWED_GUARD_MODES[entry.classification];
      if (!allowed.includes(entry.guardMode)) {
        problems.push(`${entry.model}: guardMode '${entry.guardMode}' is not valid for ${entry.classification}`);
      }
    }
    assert.deepEqual(problems, [], problems.join('\n      '));
  });

  await test('rls candidacy is consistent with classification', () => {
    const problems: string[] = [];
    for (const entry of TENANT_MODEL_CLASSIFICATION) {
      if (entry.classification === 'EXPLICIT_REVIEW_REQUIRED' && entry.rls !== 'REQUIRES_DESIGN_REVIEW') {
        problems.push(`${entry.model}: unresolved ownership cannot be an RLS ${entry.rls}`);
      }
      if (entry.classification === 'PLATFORM_GLOBAL' && entry.rls !== 'NOT_APPLICABLE') {
        problems.push(`${entry.model}: PLATFORM_GLOBAL must be RLS NOT_APPLICABLE, got ${entry.rls}`);
      }
      const tenantOwned =
        entry.classification === 'ORGANIZATION_SCOPED_DIRECT' ||
        entry.classification === 'CLINIC_SCOPED_DIRECT' ||
        entry.classification === 'PARENT_SCOPED';
      if (tenantOwned && entry.rls !== 'CANDIDATE') {
        problems.push(`${entry.model}: a tenant-owned model should be an RLS CANDIDATE, got ${entry.rls}`);
      }
    }
    assert.deepEqual(problems, [], problems.join('\n      '));
  });

  await test('ORGANIZATION_ID_NOT_NULL is recorded only where a nullable organizationId actually exists', () => {
    const problems: string[] = [];
    for (const entry of TENANT_MODEL_CLASSIFICATION) {
      if (entry.futureSchemaWork !== 'ORGANIZATION_ID_NOT_NULL') continue;
      if (entry.organizationIdField === null || !entry.organizationIdNullable) {
        problems.push(`${entry.model}: recorded as needing an organizationId NOT NULL tightening, but no nullable column exists`);
      }
    }
    assert.deepEqual(problems, [], problems.join('\n      '));

    // The inverse: a nullable organizationId must not be silently tolerated.
    const untracked = TENANT_MODEL_CLASSIFICATION.filter(
      (e) => e.organizationIdField !== null && e.organizationIdNullable && e.futureSchemaWork === 'NONE',
    ).map((e) => e.model);
    assert.deepEqual(
      untracked,
      [],
      `these models declare a nullable organizationId but record no future schema work: ${untracked.join(', ')}`,
    );
  });

  // ── Test E ─────────────────────────────────────────────────────────────────
  section('Test E — ambiguous cases stay visible and never pass as safe');

  await test('EXPLICIT_REVIEW_REQUIRED entries fail closed on every axis', () => {
    const review = modelsRequiringExplicitReview();
    assert.ok(review.length > 0, 'expected the known ambiguous models to still be recorded as such');
    for (const entry of review) {
      assert.equal(entry.guardMode, 'BLOCKED_PENDING_REVIEW', `${entry.model}: must not declare a usable guard mode`);
      assert.equal(entry.rls, 'REQUIRES_DESIGN_REVIEW', `${entry.model}: must not be an RLS candidate`);
      assert.equal(
        entry.futureSchemaWork,
        'TENANT_OWNERSHIP_DECISION_REQUIRED',
        `${entry.model}: the open ownership question must be recorded as outstanding work`,
      );
      assert.ok(entry.rationale && entry.rationale.length >= 40, `${entry.model}: must record why ownership is ambiguous`);
      assert.equal(isTenantGuardApplicable(entry.model), false, `${entry.model}: must not report as guardable`);
      assert.throws(
        () => assertTenantOwnershipResolved(entry.model),
        /EXPLICIT_REVIEW_REQUIRED/,
        `${entry.model}: guard-side assertion must refuse it`,
      );
    }
  });

  await test('no tenant-safe classification inherits from a model whose ownership is unresolved', () => {
    const problems: string[] = [];
    for (const entry of TENANT_MODEL_CLASSIFICATION) {
      if (entry.classification !== 'PARENT_SCOPED' || !entry.parent) continue;
      const parent = getTenantClassification(entry.parent.model);
      assert.ok(parent, `${entry.model}: parent ${entry.parent.model} is unclassified`);
      const parentIsTenantOwned =
        parent!.classification === 'ORGANIZATION_SCOPED_DIRECT' ||
        parent!.classification === 'CLINIC_SCOPED_DIRECT' ||
        parent!.classification === 'PARENT_SCOPED';
      if (!parentIsTenantOwned) {
        problems.push(
          `${entry.model}: PARENT_SCOPED through ${entry.parent.model}, which is ${parent!.classification}. ` +
            'Ambiguity is inherited, not resolved — reclassify the child as EXPLICIT_REVIEW_REQUIRED.',
        );
      }
    }
    assert.deepEqual(problems, [], problems.join('\n      '));
  });

  await test('an unknown model fails closed rather than defaulting to global', () => {
    assert.equal(getTenantClassification('ModelThatDoesNotExist'), undefined);
    assert.throws(() => requireTenantClassification('ModelThatDoesNotExist'), /no tenant classification/);
    assert.throws(() => isTenantGuardApplicable('ModelThatDoesNotExist'), /no tenant classification/);
    assert.throws(() => assertTenantOwnershipResolved('ModelThatDoesNotExist'), /no tenant classification/);
  });

  await test('the registry is frozen — no consumer can mutate the classification at runtime', () => {
    assert.ok(Object.isFrozen(TENANT_MODEL_CLASSIFICATION), 'TENANT_MODEL_CLASSIFICATION must be frozen');
    assert.ok(Object.isFrozen(TENANT_MODEL_CLASSIFICATION_BY_MODEL), 'the model index must be frozen');
  });

  await test('classification counts sum to the schema model count', () => {
    const counts = tenantClassificationCounts();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    assert.equal(total, SCHEMA_MODEL_NAMES.length, 'per-class counts must account for every model exactly once');
  });

  // ── Loud reporting ─────────────────────────────────────────────────────────
  section('Tenant classification summary (reported on every run)');
  const counts = tenantClassificationCounts();
  for (const [name, count] of Object.entries(counts)) console.log(`  ${name.padEnd(28)} ${count}`);
  console.log(`  ${'TOTAL'.padEnd(28)} ${TENANT_MODEL_CLASSIFICATION.length}`);

  const review = modelsRequiringExplicitReview();
  console.log(`\n  EXPLICIT_REVIEW_REQUIRED (${review.length}) — NOT tenant-safe, must not be guarded by guess:`);
  for (const entry of review) console.log(`    - ${entry.model}`);

  const future = modelsRequiringFutureSchemaWork();
  console.log(`\n  Future schema work recorded (${future.length}) — no migration is created by F3-1:`);
  for (const entry of future) console.log(`    - ${entry.model}: ${entry.futureSchemaWork}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
