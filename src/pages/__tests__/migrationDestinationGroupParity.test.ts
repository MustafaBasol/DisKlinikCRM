/**
 * migrationDestinationGroupParity.test.ts —
 * F3-DATA-MIG-TODAY-001-R11-PRESERVED-SOURCE-MAPPING-UX.
 *
 * THE REGRESSION THIS EXISTS TO PREVENT.
 *
 * R10 added `legacy.preservedSourceValue` (group `legacy_preservation`) to the
 * BACKEND destination catalog and proved, with backend tests, that the
 * destination exists, validates, and executes. It never became reachable in
 * production, because the mapping screen does not render the backend catalog
 * directly: it renders `destinations` filtered through the FRONTEND's own
 * hard-coded `DESTINATION_GROUPS` whitelist (MigrationMappingStep.tsx renders
 * `destinationGroups.map(group => destinations.filter(d => d.group === group))`).
 *
 * `legacy_preservation` was absent from that whitelist, so every preservation
 * destination the server sent was silently dropped before reaching an
 * `<option>`. The operator-visible symptom was NOT an error: the six real
 * first-customer columns (SUBEDOSYANO, UNVANI, BABAADI, ANNEADI, MEDENIHALI,
 * KVKKILKKODU) arrive as AUTO_REVIEW with `destinationField` ALREADY set to
 * `legacy.preservedSourceValue`, so the `<select>` held a value with no
 * matching `<option>` — which renders blank. The column looked unmapped, and
 * once the operator touched the dropdown there was no way back to preservation.
 *
 * Two independent whitelists describing one catalog is the actual defect
 * class, so this test asserts the two can never drift again — a backend group
 * added without a frontend counterpart fails here, at the boundary, instead of
 * silently disappearing from a production dropdown.
 *
 * Run with: tsx src/pages/__tests__/migrationDestinationGroupParity.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DESTINATION_FIELDS } from '../../../server/src/services/migration/contracts.js';
import { DESTINATION_GROUPS } from '../../services/platformMigrationApi.js';

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

/** The destination key R11 exists to make reachable. */
const PRESERVATION_KEY = 'legacy.preservedSourceValue';
const PRESERVATION_GROUP = 'legacy_preservation';

/**
 * The ONE backend group that must never reach the dropdown.
 *
 * `historical_evidence` is the narrow exception that lets a LEGAL_BLOCKED
 * consent column past the data-loss gate (dataLossGate.ts,
 * hasAcceptedHistoricalEvidenceDisposition). R10 deliberately left it EMPTY and
 * put legacy preservation in its own `legacy_preservation` group precisely so
 * that shipping preservation could not, as a side effect, unlock the consent
 * exception.
 *
 * So the parity rule below is "no ACCIDENTAL omission", not "expose
 * everything": this group is omitted on purpose, and the tests assert both that
 * it stays out of the whitelist and that it stays empty. If a destination is
 * ever added to it, the emptiness test fails and a human has to make a
 * consent decision deliberately — instead of a parity test quietly instructing
 * them to render it in the operator's dropdown.
 */
const DELIBERATELY_UNRENDERED_GROUPS = ['historical_evidence'] as const;

function loadPlatformLocale(locale: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`../../locales/${locale}/platform.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

function mappingSection(locale: string): Record<string, any> {
  const data = loadPlatformLocale(locale) as any;
  return data?.migration?.mapping ?? {};
}

async function main() {
  console.log('\n🧪 migration destination group parity (R11)\n');

  section('── frontend/backend catalog parity ──────────────────────────────');

  await test('every backend group carrying destinations is renderable by the frontend', () => {
    const frontendGroups = DESTINATION_GROUPS as readonly string[];
    const backendGroups = [...new Set(DESTINATION_FIELDS.map((d) => String(d.group)))].sort();
    const missing = backendGroups.filter(
      (g) =>
        !frontendGroups.includes(g) &&
        !(DELIBERATELY_UNRENDERED_GROUPS as readonly string[]).includes(g),
    );
    assert.deepEqual(
      missing,
      [],
      `backend groups absent from the frontend DESTINATION_GROUPS whitelist ` +
        `(their destinations would be silently dropped from the dropdown): ${missing.join(', ')}`,
    );
  });

  await test('the frontend whitelist names no group the backend does not define', () => {
    const backendGroups = new Set(DESTINATION_FIELDS.map((d) => String(d.group)));
    const stray = (DESTINATION_GROUPS as readonly string[]).filter((g) => !backendGroups.has(g));
    assert.deepEqual(stray, [], `frontend groups with no backend destinations: ${stray.join(', ')}`);
  });

  await test('the consent-exception group is never rendered and is still empty', () => {
    for (const group of DELIBERATELY_UNRENDERED_GROUPS) {
      assert.ok(
        !(DESTINATION_GROUPS as readonly string[]).includes(group),
        `"${group}" must never be operator-selectable: it is the narrow exception that lets a ` +
          `LEGAL_BLOCKED consent column past the data-loss gate.`,
      );
      const inGroup = DESTINATION_FIELDS.filter((d) => String(d.group) === group).map((d) => d.key);
      assert.deepEqual(
        inGroup,
        [],
        `"${group}" gained destination(s) [${inGroup.join(', ')}]. R10 kept it structurally ` +
          `empty so preservation could not unlock the consent exception. Adding one is a ` +
          `program-owner consent decision, not a mapping change — and it must NOT simply be ` +
          `added to the frontend dropdown to make this test pass.`,
      );
    }
  });

  section('── the preservation destination specifically ────────────────────');

  await test(`${PRESERVATION_KEY} exists in the backend catalog under ${PRESERVATION_GROUP}`, () => {
    const dest = DESTINATION_FIELDS.find((d) => d.key === PRESERVATION_KEY);
    assert.ok(dest, `${PRESERVATION_KEY} must exist in DESTINATION_FIELDS`);
    assert.equal(dest!.group, PRESERVATION_GROUP);
  });

  await test('the preservation destination survives the dropdown group filter', () => {
    // Reproduces MigrationMappingStep's exact rendering pipeline.
    const rendered = (DESTINATION_GROUPS as readonly string[]).flatMap((group) =>
      DESTINATION_FIELDS.filter((d) => d.group === group).map((d) => d.key),
    );
    assert.ok(
      rendered.includes(PRESERVATION_KEY),
      `${PRESERVATION_KEY} is dropped by the group filter, so no <option> is ever rendered ` +
        `and an operator cannot select "Korunan Kaynak Değeri".`,
    );
  });

  await test('preservation is declared independently multi-usable (many columns, one destination)', () => {
    const dest = DESTINATION_FIELDS.find((d) => d.key === PRESERVATION_KEY)!;
    assert.equal(
      dest.allowsIndependentMultiUse,
      true,
      'many source columns must be able to preserve without a destination-collision error',
    );
  });

  section('── locale parity for the group label ────────────────────────────');

  await test('every destination group has a label in all four locales', () => {
    for (const locale of LOCALES) {
      const groups = mappingSection(locale).groups ?? {};
      for (const group of DESTINATION_GROUPS) {
        assert.ok(
          typeof groups[group] === 'string' && groups[group].length > 0,
          `${locale}/platform.json migration.mapping.groups.${group} is missing`,
        );
      }
    }
  });

  await test('the group label sets are identical across locales (no locale-only key)', () => {
    const keySets = LOCALES.map((l) => Object.keys(mappingSection(l).groups ?? {}).sort());
    for (const keys of keySets) assert.deepEqual(keys, keySets[0]);
  });

  console.log(`\n${failed === 0 ? '✅' : '❌'} passed: ${passed}, failed: ${failed}\n`);
  if (failed > 0) process.exit(1);
}

main();
