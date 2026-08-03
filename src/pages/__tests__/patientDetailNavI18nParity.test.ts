/**
 * patientDetailNavI18nParity.test.ts — US-01.X: asserts the tr/en/fr/de
 * patients.json `detail.moreTab` / `detail.moreTabMenuAriaLabel` strings
 * (introduced by the primary-tabs + More-menu patient-detail navigation
 * redesign) exist, are non-empty, and stay in lockstep across every locale.
 *
 * Scoped to just these two new keys — mirrors
 * patientEmergencyContactsI18nParity.test.ts but avoids asserting parity
 * over unrelated pre-existing sections of patients.json.
 *
 * Run with: tsx src/pages/__tests__/patientDetailNavI18nParity.test.ts
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
const REQUIRED_KEYS = ['moreTab', 'moreTabMenuAriaLabel'] as const;

function loadDetailSection(locale: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`../../locales/${locale}/patients.json`, import.meta.url));
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return data?.detail ?? {};
}

async function main() {
  section('── tr/en/fr/de patients.json "detail.moreTab*" key parity ──');

  const values: Record<string, Record<string, unknown>> = {};
  for (const locale of LOCALES) {
    await test(`${locale}/patients.json defines every required moreTab* key`, () => {
      const detail = loadDetailSection(locale);
      values[locale] = detail;
      for (const key of REQUIRED_KEYS) {
        assert.ok(key in detail, `${locale} is missing "detail.${key}"`);
      }
    });
  }

  section('── No empty string values ──');

  for (const locale of LOCALES) {
    await test(`${locale} moreTab* values are non-empty strings`, () => {
      for (const key of REQUIRED_KEYS) {
        const value = values[locale]?.[key];
        assert.ok(typeof value === 'string' && value.trim().length > 0, `${locale}.detail.${key} must be a non-empty string`);
      }
    });
  }

  section('── Every locale provides a distinct translation (not left in one source language) ──');

  await test('moreTab differs from the tr source string in en/fr/de (was actually translated)', () => {
    for (const locale of ['en', 'fr', 'de'] as const) {
      assert.notEqual(values[locale]!.moreTab, values.tr!.moreTab, `${locale}.detail.moreTab looks untranslated`);
    }
  });

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
