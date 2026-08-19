/**
 * ux001Wave2I18nParity.test.ts — UX-001 Wave 2: asserts the tr/en/fr/de
 * strings introduced by the unified inbox shell (`inbox.json`, new
 * namespace) and the extended Ctrl+K command palette
 * (`common.json` -> `globalSearch.groups` / `globalSearch.actions`) exist,
 * are non-empty, and stay in lockstep across every locale.
 *
 * Mirrors patientDetailNavI18nParity.test.ts — scoped to just the new keys
 * from this wave, not a full audit of every pre-existing locale file.
 *
 * Run with: tsx src/pages/__tests__/ux001Wave2I18nParity.test.ts
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

function loadJson(relativePath: string): any {
  const path = fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

function collectKeyPaths(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    collectKeyPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

function getAtPath(obj: any, path: string): unknown {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

async function main() {
  section('── inbox.json: identical key shape across tr/en/fr/de ──');

  const inboxDocs: Record<string, any> = {};
  for (const locale of LOCALES) inboxDocs[locale] = loadJson(`locales/${locale}/inbox.json`);
  const trInboxKeys = collectKeyPaths(inboxDocs.tr).sort();

  for (const locale of LOCALES) {
    await test(`${locale}/inbox.json has the same key set as tr/inbox.json`, () => {
      const keys = collectKeyPaths(inboxDocs[locale]).sort();
      assert.deepEqual(keys, trInboxKeys, `${locale}/inbox.json key set diverges from tr`);
    });
  }

  await test('every inbox.json value is a non-empty string', () => {
    for (const locale of LOCALES) {
      for (const path of trInboxKeys) {
        const value = getAtPath(inboxDocs[locale], path);
        assert.ok(typeof value === 'string' && value.trim().length > 0, `${locale}.${path} must be a non-empty string`);
      }
    }
  });

  await test('en/fr/de inbox.json values were actually translated, not left as the tr source', () => {
    for (const locale of ['en', 'fr', 'de'] as const) {
      // "whatsapp"/"instagram" are proper nouns and legitimately identical across
      // locales — everything else should read differently from the tr source.
      const translatable = trInboxKeys.filter((p) => !p.endsWith('.whatsapp') && !p.endsWith('.instagram'));
      for (const path of translatable) {
        assert.notEqual(
          getAtPath(inboxDocs[locale], path),
          getAtPath(inboxDocs.tr, path),
          `${locale}.${path} looks untranslated (identical to tr)`,
        );
      }
    }
  });

  section('── common.json globalSearch.groups / globalSearch.actions: identical key shape across tr/en/fr/de ──');

  const commonDocs: Record<string, any> = {};
  for (const locale of LOCALES) commonDocs[locale] = loadJson(`locales/${locale}/common.json`);

  const REQUIRED_ACTION_KEYS = ['newPatient', 'newAppointment', 'openCalendar', 'openInbox', 'openFinance'];
  const REQUIRED_GROUP_KEYS = ['pages', 'actions'];

  for (const locale of LOCALES) {
    await test(`${locale}/common.json defines globalSearch.groups.{${REQUIRED_GROUP_KEYS.join(',')}}`, () => {
      const groups = commonDocs[locale]?.globalSearch?.groups ?? {};
      for (const key of REQUIRED_GROUP_KEYS) {
        assert.ok(
          typeof groups[key] === 'string' && groups[key].trim().length > 0,
          `${locale} is missing a non-empty globalSearch.groups.${key}`,
        );
      }
    });

    await test(`${locale}/common.json defines globalSearch.actions.{${REQUIRED_ACTION_KEYS.join(',')}}`, () => {
      const actions = commonDocs[locale]?.globalSearch?.actions ?? {};
      for (const key of REQUIRED_ACTION_KEYS) {
        assert.ok(
          typeof actions[key] === 'string' && actions[key].trim().length > 0,
          `${locale} is missing a non-empty globalSearch.actions.${key}`,
        );
      }
    });
  }

  await test('en/fr/de globalSearch.groups/actions values were actually translated, not left as the tr source', () => {
    for (const locale of ['en', 'fr', 'de'] as const) {
      for (const key of REQUIRED_GROUP_KEYS) {
        assert.notEqual(
          commonDocs[locale].globalSearch.groups[key],
          commonDocs.tr.globalSearch.groups[key],
          `${locale}.globalSearch.groups.${key} looks untranslated`,
        );
      }
      for (const key of REQUIRED_ACTION_KEYS) {
        assert.notEqual(
          commonDocs[locale].globalSearch.actions[key],
          commonDocs.tr.globalSearch.actions[key],
          `${locale}.globalSearch.actions.${key} looks untranslated`,
        );
      }
    }
  });

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
