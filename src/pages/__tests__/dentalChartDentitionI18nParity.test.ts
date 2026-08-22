/**
 * dentalChartDentitionI18nParity.test.ts — DENTAL-CHART-UX-001
 *
 * Asserts the tr/en/fr/de `patients.json` `dentalChart.dentition.*` strings
 * (added by the adult/primary chart switch) exist, are non-empty, and stay in
 * lockstep across every locale.
 *
 * Scoped to just the new `dentition` subtree — mirrors
 * patientDetailNavI18nParity.test.ts, and deliberately avoids asserting parity
 * over the pre-existing parts of dentalChart, which are not this task's to own.
 *
 * The `permanent`/`primary` keys are load-bearing beyond the switch itself:
 * ToothDetailPanel looks them up dynamically as
 * `dentalChart.dentition.${dentition}`, so a locale missing either one would
 * print a raw key path into the clinician-facing tooth panel.
 *
 * Run with: tsx src/pages/__tests__/dentalChartDentitionI18nParity.test.ts
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
const REQUIRED_KEYS = ['switchLabel', 'permanent', 'primary', 'permanentHint', 'primaryHint'] as const;

function loadDentitionSection(locale: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`../../locales/${locale}/patients.json`, import.meta.url));
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return data?.dentalChart?.dentition ?? {};
}

async function main() {
  section('── tr/en/fr/de patients.json "dentalChart.dentition.*" key parity ──');

  const values: Record<string, Record<string, unknown>> = {};

  for (const locale of LOCALES) {
    await test(`${locale}/patients.json defines every required dentition key`, () => {
      const dentition = loadDentitionSection(locale);
      values[locale] = dentition;
      for (const key of REQUIRED_KEYS) {
        assert.ok(key in dentition, `${locale} is missing "dentalChart.dentition.${key}"`);
      }
    });
  }

  await test('no locale carries an EXTRA dentition key the others lack', () => {
    for (const locale of LOCALES) {
      assert.deepEqual(
        Object.keys(values[locale] ?? {}).sort(),
        [...REQUIRED_KEYS].sort(),
        `${locale} dentition key set has drifted`,
      );
    }
  });

  section('── No empty string values ──');

  for (const locale of LOCALES) {
    await test(`${locale} dentition values are non-empty strings`, () => {
      for (const key of REQUIRED_KEYS) {
        const value = values[locale]?.[key];
        assert.ok(
          typeof value === 'string' && value.trim().length > 0,
          `${locale}.dentalChart.dentition.${key} must be a non-empty string`,
        );
      }
    });
  }

  section('── The two dentition labels are distinguishable within each locale ──');

  await test('permanent and primary never render as the same word', () => {
    for (const locale of LOCALES) {
      assert.notEqual(
        values[locale]!.permanent,
        values[locale]!.primary,
        `${locale} labels both charts identically, so the switch would be unreadable`,
      );
    }
  });

  section('── Every locale provides a distinct translation (not left in one source language) ──');

  await test('the primary-chart label differs from the tr source string in en/fr/de', () => {
    for (const locale of ['en', 'fr', 'de'] as const) {
      assert.notEqual(
        values[locale]!.primary,
        values.tr!.primary,
        `${locale}.dentalChart.dentition.primary looks untranslated`,
      );
    }
  });

  section('── Hints name the FDI range each chart covers ──');

  await test('every locale states the 11-48 and 51-85 FDI ranges in its hints', () => {
    for (const locale of LOCALES) {
      assert.match(String(values[locale]!.permanentHint), /11-48/, `${locale} permanentHint must state the FDI range`);
      assert.match(String(values[locale]!.primaryHint), /51-85/, `${locale} primaryHint must state the FDI range`);
    }
  });

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
