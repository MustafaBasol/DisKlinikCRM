/**
 * dentalChartOrientationI18nParity.test.ts — DENTAL-CHART-UX-001-R2 (Lane E)
 *
 * Asserts the tr/en/fr/de `patients.json` R2 key groups under `dentalChart.*`
 * — orientation, view, toothFamily, surface, navigation, timeline, and the
 * three new top-level keys (toothLabel, scheduledFor, completedOn) — exist,
 * are non-empty, and stay in lockstep across every locale. Also asserts full
 * deep key-set parity across the WHOLE `dentalChart` subtree (not just the R2
 * groups), since a single locale file drifting anywhere under that subtree
 * would leave a raw key path or an empty string on a clinician-facing screen.
 *
 * Modelled on dentalChartDentitionI18nParity.test.ts, scoped to the R2 keys
 * (dentition.* parity is already covered there and is deliberately not
 * re-asserted here).
 *
 * `toothFamily.*` is load-bearing beyond display text: it mirrors the
 * `ToothFamily` union in `src/components/odontogram/toothIdentity.ts` key for
 * key, so a locale missing one would print a raw key path in the tooth
 * detail panel for that specific family.
 *
 * Run with: tsx src/pages/__tests__/dentalChartOrientationI18nParity.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

const LOCALES = ['tr', 'en', 'fr', 'de'] as const;
type Locale = (typeof LOCALES)[number];

type Json = { [key: string]: Json | string | number | boolean | null };

function loadDentalChart(locale: Locale): Json {
  const path = fileURLToPath(new URL(`../../locales/${locale}/patients.json`, import.meta.url));
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return (data?.dentalChart ?? {}) as Json;
}

/** Recursively flattens an object into dot-joined leaf paths, e.g. "orientation.rightShort". */
function flattenLeaves(obj: Json, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') {
      Object.assign(out, flattenLeaves(v as Json, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

function getIn(obj: Json, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    return (acc as Json)[key];
  }, obj);
}

// ── The R2 key groups ────────────────────────────────────────────────────

const ORIENTATION_KEYS = [
  'rightShort',
  'leftShort',
  'rightLabel',
  'leftLabel',
  'upperRightQuadrant',
  'upperLeftQuadrant',
  'lowerRightQuadrant',
  'lowerLeftQuadrant',
] as const;

const VIEW_KEYS = ['lateral', 'occlusal', 'dualHint'] as const;

// Mirrors the ToothFamily union in ../../components/odontogram/toothIdentity.ts
// exactly — this list IS the union's member names, deliberately hand-listed
// here (not imported) so a locale test can run without importing a .tsx-tree
// module and so a union edit that isn't mirrored here fails loudly.
const TOOTH_FAMILY_KEYS = [
  'central_incisor',
  'lateral_incisor',
  'canine',
  'first_premolar',
  'second_premolar',
  'first_molar',
  'second_molar',
  'third_molar',
] as const;

const SURFACE_KEYS = ['mesial', 'distal', 'buccal', 'lingual', 'palatal', 'central', 'incisal'] as const;

const NAVIGATION_KEYS = ['previousTooth', 'nextTooth', 'jumpLabel', 'jumpPlaceholder', 'jumpInvalid'] as const;

const TIMELINE_KEYS = [
  'title',
  'empty',
  'record_created',
  'record_updated',
  'procedure_added',
  'procedure_scheduled',
  'procedure_completed',
] as const;

const TOP_LEVEL_KEYS = ['toothLabel', 'scheduledFor', 'completedOn'] as const;

const GROUPS: Array<{ name: string; prefix: string; keys: readonly string[] }> = [
  { name: 'orientation', prefix: 'orientation', keys: ORIENTATION_KEYS },
  { name: 'view', prefix: 'view', keys: VIEW_KEYS },
  { name: 'toothFamily', prefix: 'toothFamily', keys: TOOTH_FAMILY_KEYS },
  { name: 'surface', prefix: 'surface', keys: SURFACE_KEYS },
  { name: 'navigation', prefix: 'navigation', keys: NAVIGATION_KEYS },
  { name: 'timeline', prefix: 'timeline', keys: TIMELINE_KEYS },
  { name: 'top-level', prefix: '', keys: TOP_LEVEL_KEYS },
];

function fullKey(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

// ── Keys exempted from the "must differ from the tr/en source" check ──────
//
// Each exemption is a genuine coincidence in correct data, not a leftover
// English/Turkish string — asserting equality-must-differ on these would
// fail on data that is actually right, which the task brief explicitly
// warns against.
//
//   - orientation.rightShort / leftShort: intentionally single letters
//     ("R"/"L" in en/tr/de; "D"/"G" in fr) — too short to carry translated
//     "content" and legitimately coincide when a language's own abbreviation
//     happens to match.
//   - surface.mesial / distal / lingual / central: Latin/international
//     anatomical terms that are spelled identically (or near-identically) in
//     several of these languages by design — that is correct dentistry, not
//     an untranslated string.
//   - toothFamily.canine: "canine" is the standard French dental term too
//     (fr.toothFamily.canine === "Canine", matching en exactly) — a genuine
//     cognate, not a translation left in English.
//   - toothLabel: contains ONLY interpolation placeholders
//     ("{{quadrant}} {{family}}" / "{{family}} ({{quadrant}})"), no literal
//     words, so tr coinciding with en's placeholder order is not a
//     translation gap. It is checked separately below for placeholder
//     presence, per the task brief ("assert presence, not order").
const NOT_CHECKED_FOR_ENGLISH_LEFTOVER = new Set<string>([
  'orientation.rightShort',
  'orientation.leftShort',
  'surface.mesial',
  'surface.distal',
  'surface.lingual',
  'surface.central',
  'toothFamily.canine',
  'toothLabel',
]);

async function main() {
  section('── R2 key groups exist and are non-empty, per locale ──');

  const dentalChart: Record<Locale, Json> = {} as Record<Locale, Json>;
  for (const locale of LOCALES) {
    dentalChart[locale] = loadDentalChart(locale);
  }

  for (const group of GROUPS) {
    await test(`every locale defines dentalChart.${group.prefix || '(root)'} { ${group.keys.join(', ')} }`, () => {
      for (const locale of LOCALES) {
        const container = group.prefix ? getIn(dentalChart[locale], group.prefix) : dentalChart[locale];
        assert.ok(
          container !== undefined && container !== null && typeof container === 'object',
          `${locale}.dentalChart.${group.prefix} is missing`,
        );
        for (const key of group.keys) {
          const value = (container as Json)[key];
          assert.ok(
            typeof value === 'string' && value.trim().length > 0,
            `${locale}.dentalChart.${fullKey(group.prefix, key)} must be a non-empty string`,
          );
        }
      }
    });
  }

  await test('toothFamily key set exactly matches the ToothFamily union member names, per locale (no extra/missing)', () => {
    for (const locale of LOCALES) {
      const container = getIn(dentalChart[locale], 'toothFamily') as Json;
      assert.deepEqual(
        Object.keys(container).sort(),
        [...TOOTH_FAMILY_KEYS].sort(),
        `${locale}.dentalChart.toothFamily key set has drifted from the ToothFamily union`,
      );
    }
  });

  section('── Full deep key-set parity across the whole dentalChart subtree ──');

  const flat: Record<Locale, Record<string, unknown>> = {} as Record<Locale, Record<string, unknown>>;
  for (const locale of LOCALES) {
    flat[locale] = flattenLeaves(dentalChart[locale]);
  }

  await test('every locale has the identical set of leaf keys under dentalChart', () => {
    const referenceKeys = Object.keys(flat.en).sort();
    for (const locale of LOCALES) {
      assert.deepEqual(
        Object.keys(flat[locale]).sort(),
        referenceKeys,
        `${locale}.dentalChart leaf key set does not match en (drift somewhere under dentalChart.*)`,
      );
    }
  });

  await test('every leaf value under dentalChart is a non-empty string, in every locale', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(flat[locale])) {
        assert.ok(
          typeof value === 'string' && value.trim().length > 0,
          `${locale}.dentalChart.${key} must be a non-empty string, got ${JSON.stringify(value)}`,
        );
      }
    }
  });

  section('── No locale left an untranslated (English) string, for the R2 translated keys ──');

  await test('tr/fr/de differ from en for every R2 key not explicitly exempted as a legitimate coincidence', () => {
    for (const group of GROUPS) {
      for (const key of group.keys) {
        const path = fullKey(group.prefix, key);
        if (NOT_CHECKED_FOR_ENGLISH_LEFTOVER.has(path)) continue;
        const enValue = flat.en[path];
        for (const locale of ['tr', 'fr', 'de'] as const) {
          assert.notEqual(
            flat[locale][path],
            enValue,
            `${locale}.dentalChart.${path} matches the en string exactly — looks untranslated`,
          );
        }
      }
    }
  });

  section('── toothLabel carries both interpolation placeholders in every locale (word order is locale-specific by design) ──');

  await test('toothLabel contains {{quadrant}} and {{family}} in every locale', () => {
    for (const locale of LOCALES) {
      const label = String(flat[locale].toothLabel ?? '');
      assert.ok(label.includes('{{quadrant}}'), `${locale}.dentalChart.toothLabel is missing {{quadrant}}`);
      assert.ok(label.includes('{{family}}'), `${locale}.dentalChart.toothLabel is missing {{family}}`);
    }
  });

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
