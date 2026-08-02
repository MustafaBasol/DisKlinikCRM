/**
 * inventoryI18nParity.test.ts — asserts the tr/en/fr/de inventory.json locale
 * files stay in lockstep, and that the US-05.2 unit-conversion keys exist in
 * all four (unit management, purchase/consumption unit, conversion factor,
 * normalized quantity, inactive unit, validation errors, historical
 * conversion-factor protection).
 *
 * Run with: tsx src/pages/__tests__/inventoryI18nParity.test.ts
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

function loadLocale(locale: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`../../locales/${locale}/inventory.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
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

const REQUIRED_UNIT_CONVERSION_KEYS = [
  'tabs.units',
  'unitManagement.newUnit',
  'unitManagement.createTitle',
  'unitManagement.editTitle',
  'unitManagement.empty',
  'unitManagement.fields.name',
  'unitManagement.fields.abbreviation',
  'unitManagement.fields.status',
  'unitManagement.status.active',
  'unitManagement.status.inactive',
  'unitConversion.sectionTitle',
  'unitConversion.purchaseUnit',
  'unitConversion.consumptionUnit',
  'unitConversion.conversionFactor',
  'unitConversion.inactiveSuffix',
  'transaction.fields.unit',
  'transaction.normalizedPreview',
  'transaction.errors.insufficientStockGeneric',
  'errors.unitInactive',
  'errors.unitNotAssigned',
  'errors.unitCrossClinic',
  'errors.conversionFactorMissing',
  'errors.conversionFactorInvalid',
  'errors.conversionFactorLocked',
  'errors.unitConfigIncomplete',
  'errors.adjustmentUnitUnsupported',
  'errors.unitFieldsRequired',
  'errors.unitDuplicate',
];

async function main() {
  section('── tr/en/fr/de inventory.json parity ────────────────────────────');

  const keySets: Record<string, Set<string>> = {};
  for (const locale of LOCALES) {
    await test(`${locale}/inventory.json is valid JSON`, () => {
      const data = loadLocale(locale);
      keySets[locale] = new Set(flatten(data));
      assert.ok(keySets[locale].size > 0);
    });
  }

  const base = keySets.tr;
  for (const locale of LOCALES) {
    await test(`${locale}/inventory.json has the exact same key set as tr (no missing/extra keys)`, () => {
      const missing = [...base].filter((k) => !keySets[locale].has(k));
      const extra = [...keySets[locale]].filter((k) => !base.has(k));
      assert.deepEqual(missing, [], `missing in ${locale}`);
      assert.deepEqual(extra, [], `extra in ${locale} (not in tr)`);
    });
  }

  section('── US-05.2 unit-conversion keys present in all locales ───────────');

  for (const locale of LOCALES) {
    await test(`${locale} defines every required unit-conversion key`, () => {
      for (const key of REQUIRED_UNIT_CONVERSION_KEYS) {
        assert.ok(keySets[locale].has(key), `${locale} is missing "${key}"`);
      }
    });
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
