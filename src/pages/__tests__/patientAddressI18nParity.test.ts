/**
 * patientAddressI18nParity.test.ts — F3-DATA-MIG-TODAY-001-R10: asserts the
 * tr/en/fr/de patients.json strings introduced for the structured patient
 * address (address line, district/ilçe, province/il, postal code, country)
 * and for the secondary phone numbers (PatientContactPoint) sub-resource stay
 * in lockstep across all four locales.
 *
 * Scoped to just this feature's own subtree — the flat `form.*` address
 * labels, the whole `form.secondaryPhones` object and the whole
 * `detail.address` object — rather than the whole patients.json file. This
 * mirrors patientEmergencyContactsI18nParity.test.ts and deliberately avoids
 * asserting parity over unrelated pre-existing sections of patients.json.
 *
 * Scoping caveat, stated explicitly: the flat `form.*` labels are PICKED by
 * name (they are siblings of dozens of unrelated `form` keys), so an "extra"
 * key can only be detected inside the two fully-owned subtrees. Missing keys
 * are detected everywhere, via both the key-set equality check and
 * REQUIRED_KEYS.
 *
 * Run with: tsx src/pages/__tests__/patientAddressI18nParity.test.ts
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

// The flat address labels that live directly on `form` (they are consumed as
// t('patients:form.address') & co., so they cannot be moved into a subtree).
const FLAT_FORM_KEYS = [
  'addressSection',
  'address',
  'addressPlaceholder',
  'district',
  'districtPlaceholder',
  'province',
  'provincePlaceholder',
  'postalCode',
  'postalCodePlaceholder',
  'country',
  'countryPlaceholder',
  'phonePrimaryHint',
];

/**
 * Builds this feature's scope for one locale: the picked flat `form` labels
 * plus the two subtrees it fully owns, flattened into one namespace.
 */
function loadAddressScope(locale: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`../../locales/${locale}/patients.json`, import.meta.url));
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const form = data?.form ?? {};
  const scope: Record<string, unknown> = {};
  for (const key of FLAT_FORM_KEYS) {
    if (Object.prototype.hasOwnProperty.call(form, key)) scope[`form.${key}`] = form[key];
  }
  scope['form.secondaryPhones'] = form?.secondaryPhones ?? {};
  scope['detail.address'] = data?.detail?.address ?? {};
  return scope;
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

// One key per required category: the five address fields plus their section
// header, the primary-phone marker, the secondary-phone list/add/edit/delete
// flow, its validation and failure messages, the create-mode explanation, and
// all four contact-type options.
const REQUIRED_KEYS = [
  'form.addressSection',
  'form.address',
  'form.addressPlaceholder',
  'form.district',
  'form.districtPlaceholder',
  'form.province',
  'form.provincePlaceholder',
  'form.postalCode',
  'form.postalCodePlaceholder',
  'form.country',
  'form.countryPlaceholder',
  'form.phonePrimaryHint',
  'form.secondaryPhones.title',
  'form.secondaryPhones.description',
  'form.secondaryPhones.addNew',
  'form.secondaryPhones.addTitle',
  'form.secondaryPhones.add',
  'form.secondaryPhones.empty',
  'form.secondaryPhones.availableAfterCreate',
  'form.secondaryPhones.contactType',
  'form.secondaryPhones.value',
  'form.secondaryPhones.valuePlaceholder',
  'form.secondaryPhones.label',
  'form.secondaryPhones.labelPlaceholder',
  'form.secondaryPhones.edit',
  'form.secondaryPhones.delete',
  'form.secondaryPhones.deleteConfirm',
  'form.secondaryPhones.deleteConfirmYes',
  'form.secondaryPhones.valueRequired',
  'form.secondaryPhones.saveFailed',
  'form.secondaryPhones.deleteFailed',
  'form.secondaryPhones.loadFailed',
  'form.secondaryPhones.types.mobile',
  'form.secondaryPhones.types.home',
  'form.secondaryPhones.types.work',
  'form.secondaryPhones.types.other',
  'detail.address.title',
  'detail.address.secondaryPhoneBadge',
  'detail.address.secondaryPhonesLoadFailed',
];

async function main() {
  section('── tr/en/fr/de patients.json patient-address + secondary-phone key parity ──');

  const keySets: Record<string, Set<string>> = {};
  for (const locale of LOCALES) {
    await test(`${locale}/patients.json address scope loads and is non-empty`, () => {
      const flat = flatten(loadAddressScope(locale));
      keySets[locale] = new Set(flat);
      assert.ok(keySets[locale].size > 0, `${locale} address scope must not be empty`);
    });
  }

  const base = keySets.tr;
  for (const locale of LOCALES) {
    await test(`${locale} has the exact same address key set as tr (no missing/extra keys)`, () => {
      const missing = [...base].filter((k) => !keySets[locale].has(k));
      const extra = [...keySets[locale]].filter((k) => !base.has(k));
      assert.deepEqual(missing, [], `missing in ${locale}`);
      assert.deepEqual(extra, [], `extra in ${locale} (not in tr)`);
    });
  }

  section('── R10 required key categories present in every locale ─────────────────');

  for (const locale of LOCALES) {
    await test(`${locale} defines every required address/secondary-phone key`, () => {
      for (const key of REQUIRED_KEYS) {
        assert.ok(keySets[locale].has(key), `${locale} is missing "${key}"`);
      }
    });
  }

  section('── No empty string values (a present-but-blank translation is a bug) ──');

  for (const locale of LOCALES) {
    await test(`${locale} address scope has no empty-string values`, () => {
      const scope = loadAddressScope(locale);
      const flatEntries: [string, unknown][] = [];
      const walk = (obj: Record<string, unknown>, prefix = '') => {
        for (const k of Object.keys(obj)) {
          const full = prefix ? `${prefix}.${k}` : k;
          const value = obj[k];
          if (value && typeof value === 'object' && !Array.isArray(value)) walk(value as Record<string, unknown>, full);
          else flatEntries.push([full, value]);
        }
      };
      walk(scope);
      for (const [key, value] of flatEntries) {
        assert.ok(typeof value === 'string' && value.trim().length > 0, `${locale}.${key} must be a non-empty string`);
      }
    });
  }

  section('── tr is the source language: its address labels are the agreed wording ──');

  await test('tr uses the agreed Turkish terms (İlçe / İl / Posta Kodu / Ülke)', () => {
    const tr = loadAddressScope('tr') as Record<string, string>;
    assert.equal(tr['form.address'], 'Adres');
    assert.equal(tr['form.district'], 'İlçe');
    assert.equal(tr['form.province'], 'İl');
    assert.equal(tr['form.postalCode'], 'Posta Kodu');
    assert.equal(tr['form.country'], 'Ülke');
  });

  await test('tr contact-type options are Cep / Ev / İş / Diğer', () => {
    const types = (loadAddressScope('tr')['form.secondaryPhones'] as any).types as Record<string, string>;
    assert.equal(types.mobile, 'Cep');
    assert.equal(types.home, 'Ev');
    assert.equal(types.work, 'İş');
    assert.equal(types.other, 'Diğer');
  });

  await test('fr and de are genuinely translated, not English copied across', () => {
    const en = loadAddressScope('en') as Record<string, any>;
    for (const locale of ['fr', 'de']) {
      const other = loadAddressScope(locale) as Record<string, any>;
      // Field labels that must NOT be identical to the English wording.
      for (const key of ['form.addressSection', 'form.postalCode', 'form.country', 'form.phonePrimaryHint']) {
        assert.notEqual(other[key], en[key], `${locale}.${key} is identical to the English string`);
      }
      assert.notEqual(
        other['form.secondaryPhones'].title,
        en['form.secondaryPhones'].title,
        `${locale} secondaryPhones.title is identical to the English string`,
      );
    }
  });

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
