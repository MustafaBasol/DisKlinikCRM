/**
 * patientEmergencyContactsI18nParity.test.ts — US-01.2: asserts the
 * tr/en/fr/de patients.json `detail.emergencyContacts` section stays in
 * lockstep (same keys) and covers every required string (section title,
 * empty state, add/edit/delete, primary, legal decision-maker, contact type
 * options, field labels, validation messages, minor-patient warning,
 * success/error messages).
 *
 * Scoped to the `detail.emergencyContacts` subtree only (not the whole
 * patients.json file) — mirrors inventoryI18nParity.test.ts but avoids
 * asserting parity over unrelated pre-existing sections of patients.json.
 *
 * Run with: tsx src/pages/__tests__/patientEmergencyContactsI18nParity.test.ts
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

function loadEmergencyContactsSection(locale: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`../../locales/${locale}/patients.json`, import.meta.url));
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return data?.detail?.emergencyContacts ?? {};
}

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  let keys: string[] = [];
  for (const k of Object.keys(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    const value = obj[k];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys = keys.concat(flatten(value as Record<string, unknown>, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

// One representative key per required category from the task spec (section
// header, empty state, add, edit, delete, primary, legal decision-maker,
// contact type options, field labels, validation, minor warning, success/error).
const REQUIRED_KEYS = [
  'title',
  'empty',
  'addNew',
  'addTitle',
  'edit',
  'editTitle',
  'delete',
  'deleteConfirm',
  'deleteFailed',
  'primary',
  'legalDecisionMaker',
  'minorWarning',
  'types.SPOUSE',
  'types.PARENT',
  'types.GUARDIAN',
  'types.CHILD',
  'types.SIBLING',
  'types.OTHER',
  'form.contactType',
  'form.fullName',
  'form.phone',
  'form.phoneCountryCode',
  'form.email',
  'form.occupation',
  'form.isPrimary',
  'form.isLegalDecisionMaker',
  'form.fullNameRequired',
  'form.phoneRequired',
  'form.saveFailed',
];

async function main() {
  section('── tr/en/fr/de patients.json "detail.emergencyContacts" key parity ──');

  const keySets: Record<string, Set<string>> = {};
  for (const locale of LOCALES) {
    await test(`${locale}/patients.json detail.emergencyContacts loads and is non-empty`, () => {
      const flat = flatten(loadEmergencyContactsSection(locale));
      keySets[locale] = new Set(flat);
      assert.ok(keySets[locale].size > 0, `${locale} emergencyContacts section must not be empty`);
    });
  }

  const base = keySets.tr;
  for (const locale of LOCALES) {
    await test(`${locale} has the exact same emergencyContacts key set as tr (no missing/extra keys)`, () => {
      const missing = [...base].filter((k) => !keySets[locale].has(k));
      const extra = [...keySets[locale]].filter((k) => !base.has(k));
      assert.deepEqual(missing, [], `missing in ${locale}`);
      assert.deepEqual(extra, [], `extra in ${locale} (not in tr)`);
    });
  }

  section('── US-01.2 required key categories present in every locale ──────────');

  for (const locale of LOCALES) {
    await test(`${locale} defines every required emergencyContacts key`, () => {
      for (const key of REQUIRED_KEYS) {
        assert.ok(keySets[locale].has(key), `${locale} is missing "${key}"`);
      }
    });
  }

  section('── No empty string values (a present-but-blank translation is a bug) ──');

  for (const locale of LOCALES) {
    await test(`${locale} emergencyContacts has no empty-string values`, () => {
      const section = loadEmergencyContactsSection(locale);
      const flatEntries: [string, unknown][] = [];
      const walk = (obj: Record<string, unknown>, prefix = '') => {
        for (const k of Object.keys(obj)) {
          const full = prefix ? `${prefix}.${k}` : k;
          const value = obj[k];
          if (value && typeof value === 'object' && !Array.isArray(value)) walk(value as Record<string, unknown>, full);
          else flatEntries.push([full, value]);
        }
      };
      walk(section);
      for (const [key, value] of flatEntries) {
        assert.ok(typeof value === 'string' && value.trim().length > 0, `${locale}.${key} must be a non-empty string`);
      }
    });
  }

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
