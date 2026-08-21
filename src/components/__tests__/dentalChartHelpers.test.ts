/**
 * dentalChartHelpers.test.ts — DENTAL-CHART-UX-001
 *
 * Pure domain + geometry logic behind the dental chart: FDI validity across
 * both dentitions, anatomical crown-form mapping, initial-chart resolution,
 * and the SVG path data itself. No React, no API — mirrors the repo's existing
 * hand-rolled tsx test style (patientDetailTabsHelpers.test.ts).
 *
 * Run with: tsx src/components/__tests__/dentalChartHelpers.test.ts
 *
 * The load-bearing assertions here are the BACKWARD-COMPATIBILITY ones: every
 * permanent FDI number must still be valid and must still map to exactly the
 * crown form it mapped to before primary teeth existed, because those numbers
 * are already persisted in ToothRecord rows in production.
 */

import assert from 'node:assert/strict';
import {
  getToothDentition,
  getToothShape,
  isPermanentToothFdi,
  isPrimaryToothFdi,
  isValidToothFdi,
  PERMANENT_FDI,
  PRIMARY_FDI,
  resolveInitialDentition,
  toothChartAgeInYears,
  LOWER_LEFT,
  LOWER_LEFT_PRIMARY,
  LOWER_RIGHT,
  LOWER_RIGHT_PRIMARY,
  UPPER_LEFT,
  UPPER_LEFT_PRIMARY,
  UPPER_RIGHT,
  UPPER_RIGHT_PRIMARY,
  type ToothShape,
} from '../dentalChart.types';
import {
  CROWN_MARGIN_PATH,
  getToothGeometry,
  IMPLANT_FIXTURE_PATH,
  IMPLANT_THREAD_PATH,
  type Dentition,
} from '../toothGeometry';

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

/**
 * The crown-form mapping exactly as it behaved BEFORE primary teeth were
 * added (position >= 6 molar, >= 4 premolar, 3 canine, else incisor), written
 * out literally so a future edit to getToothShape cannot silently redefine
 * what an already-stored adult tooth number means.
 */
const LEGACY_PERMANENT_SHAPES: Record<number, ToothShape> = {};
for (const fdi of PERMANENT_FDI) {
  const position = fdi % 10;
  LEGACY_PERMANENT_SHAPES[fdi] =
    position >= 6 ? 'molar' : position >= 4 ? 'premolar' : position === 3 ? 'canine' : 'incisor';
}

const ALL_SHAPES: ToothShape[] = ['molar', 'premolar', 'canine', 'incisor'];
const ALL_DENTITIONS: Dentition[] = ['permanent', 'primary'];

/** Every numeric token in a path — all of them are coordinates in the 64x88 box. */
function pathNumbers(d: string): number[] {
  return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

/**
 * Splits a path into (x, y) pairs. Only valid for paths built purely from
 * M/L/C/Z, where every number is half of a coordinate pair — the assertion
 * below enforces that, so a future H/V edit fails loudly instead of silently
 * shifting every coordinate by one and making these checks meaningless.
 */
function pathPoints(d: string): { xs: number[]; ys: number[] } {
  assert.ok(!/[HhVvAaQqTtSs]/.test(d), `pathPoints only handles M/L/C/Z paths, got: ${d.slice(0, 48)}`);
  const numbers = pathNumbers(d);
  assert.equal(numbers.length % 2, 0, `odd coordinate count in path: ${d.slice(0, 48)}`);
  const xs: number[] = [];
  const ys: number[] = [];
  numbers.forEach((value, index) => (index % 2 === 0 ? xs : ys).push(value));
  return { xs, ys };
}

async function main() {
  section('FDI ranges — permanent and primary are disjoint, which is why no migration is needed');

  await test('the permanent arch is the unchanged 32 teeth', () => {
    assert.equal(PERMANENT_FDI.length, 32);
    assert.deepEqual(
      [...PERMANENT_FDI].sort((a, b) => a - b),
      [...UPPER_RIGHT, ...UPPER_LEFT, ...LOWER_RIGHT, ...LOWER_LEFT].sort((a, b) => a - b),
    );
  });

  await test('the primary arch is 20 teeth, five per quadrant, quadrants 5-8', () => {
    assert.equal(PRIMARY_FDI.length, 20);
    for (const quadrant of [5, 6, 7, 8]) {
      const inQuadrant = PRIMARY_FDI.filter((fdi) => Math.floor(fdi / 10) === quadrant);
      assert.equal(inQuadrant.length, 5, `quadrant ${quadrant} must hold 5 primary teeth`);
      assert.deepEqual(
        inQuadrant.map((fdi) => fdi % 10).sort(),
        [1, 2, 3, 4, 5],
        `quadrant ${quadrant} must be positions 1-5`,
      );
    }
  });

  await test('primary quadrant arrays match PRIMARY_FDI exactly (no tooth defined twice or dropped)', () => {
    assert.deepEqual(
      [...UPPER_RIGHT_PRIMARY, ...UPPER_LEFT_PRIMARY, ...LOWER_RIGHT_PRIMARY, ...LOWER_LEFT_PRIMARY].sort((a, b) => a - b),
      [...PRIMARY_FDI].sort((a, b) => a - b),
    );
  });

  await test('no integer is valid in BOTH dentitions — a stored toothFdi is never ambiguous', () => {
    const permanent = new Set(PERMANENT_FDI);
    for (const fdi of PRIMARY_FDI) {
      assert.ok(!permanent.has(fdi), `FDI ${fdi} would be ambiguous across dentitions`);
    }
  });

  await test('there is no primary 6th/7th/8th tooth — a primary arch has no premolars or third molars', () => {
    for (const fdi of [56, 57, 58, 66, 67, 68, 76, 77, 78, 86, 87, 88]) {
      assert.equal(isValidToothFdi(fdi), false, `FDI ${fdi} must be rejected`);
    }
  });

  await test('malformed numbers stay rejected (position 0, quadrant 0, out of range)', () => {
    for (const fdi of [0, 10, 19, 20, 29, 30, 39, 40, 49, 50, 59, 60, 69, 70, 79, 80, 89, 90, 99, -11, 111]) {
      assert.equal(isValidToothFdi(fdi), false, `FDI ${fdi} must be rejected`);
    }
  });

  await test('every permanent FDI is still valid (backward compatibility with stored records)', () => {
    for (const fdi of PERMANENT_FDI) {
      assert.ok(isValidToothFdi(fdi), `FDI ${fdi} must stay valid`);
      assert.ok(isPermanentToothFdi(fdi));
      assert.ok(!isPrimaryToothFdi(fdi));
      assert.equal(getToothDentition(fdi), 'permanent');
    }
  });

  await test('every primary FDI is valid and reports the primary dentition', () => {
    for (const fdi of PRIMARY_FDI) {
      assert.ok(isValidToothFdi(fdi), `FDI ${fdi} must be valid`);
      assert.ok(isPrimaryToothFdi(fdi));
      assert.ok(!isPermanentToothFdi(fdi));
      assert.equal(getToothDentition(fdi), 'primary');
    }
  });

  await test('an unknown number is reported as permanent, so legacy data keeps rendering on the adult chart', () => {
    assert.equal(getToothDentition(99), 'permanent');
  });

  section('getToothShape — permanent behaviour is frozen, primary has no premolars');

  await test('every permanent tooth maps to exactly the crown form it mapped to before', () => {
    for (const fdi of PERMANENT_FDI) {
      assert.equal(getToothShape(fdi), LEGACY_PERMANENT_SHAPES[fdi], `FDI ${fdi} changed crown form`);
    }
  });

  await test('primary positions 4 and 5 are MOLARS, not premolars (the deciduous arch has no premolars)', () => {
    for (const fdi of PRIMARY_FDI) {
      const position = fdi % 10;
      if (position >= 4) {
        assert.equal(getToothShape(fdi), 'molar', `primary FDI ${fdi} must be drawn as a molar`);
      }
    }
  });

  await test('no primary tooth is ever shaped as a premolar', () => {
    for (const fdi of PRIMARY_FDI) {
      assert.notEqual(getToothShape(fdi), 'premolar', `primary FDI ${fdi} must not be a premolar`);
    }
  });

  await test('primary position 3 is the canine and positions 1-2 are incisors', () => {
    for (const fdi of PRIMARY_FDI) {
      const position = fdi % 10;
      if (position === 3) assert.equal(getToothShape(fdi), 'canine', `FDI ${fdi}`);
      if (position <= 2) assert.equal(getToothShape(fdi), 'incisor', `FDI ${fdi}`);
    }
  });

  await test('the same position number means different forms across dentitions (15 premolar vs 55 molar)', () => {
    assert.equal(getToothShape(15), 'premolar');
    assert.equal(getToothShape(55), 'molar');
    assert.equal(getToothShape(14), 'premolar');
    assert.equal(getToothShape(54), 'molar');
  });

  section('getToothGeometry — every combination is drawable and anatomically root-correct');

  await test('every shape/dentition/jaw combination yields a crown and at least one root', () => {
    for (const shape of ALL_SHAPES) {
      for (const dentition of ALL_DENTITIONS) {
        for (const isUpper of [true, false]) {
          const geometry = getToothGeometry(shape, dentition, isUpper);
          const where = `${dentition}/${shape}/${isUpper ? 'upper' : 'lower'}`;
          assert.ok(geometry.crown.length > 0, `${where} has no crown path`);
          assert.ok(geometry.roots.length >= 1, `${where} has no roots`);
          assert.ok(geometry.surface.length > 0, `${where} has no surface detail`);
          assert.ok(geometry.cervical.length > 0, `${where} has no cervical line`);
        }
      }
    }
  });

  await test('crown and root paths are closed subpaths starting with an absolute moveto', () => {
    for (const shape of ALL_SHAPES) {
      for (const dentition of ALL_DENTITIONS) {
        for (const isUpper of [true, false]) {
          const geometry = getToothGeometry(shape, dentition, isUpper);
          const where = `${dentition}/${shape}/${isUpper ? 'upper' : 'lower'}`;
          assert.ok(geometry.crown.startsWith('M'), `${where} crown must start with M`);
          assert.ok(geometry.crown.trimEnd().endsWith('Z'), `${where} crown must be closed`);
          for (const [index, root] of geometry.roots.entries()) {
            assert.ok(root.startsWith('M'), `${where} root ${index} must start with M`);
            assert.ok(root.trimEnd().endsWith('Z'), `${where} root ${index} must be closed`);
          }
        }
      }
    }
  });

  await test('upper molars are three-rooted and lower molars two-rooted, in both dentitions', () => {
    for (const dentition of ALL_DENTITIONS) {
      assert.equal(getToothGeometry('molar', dentition, true).roots.length, 3, `${dentition} upper molar`);
      assert.equal(getToothGeometry('molar', dentition, false).roots.length, 2, `${dentition} lower molar`);
    }
  });

  await test('anterior teeth and premolars are single-rooted regardless of jaw', () => {
    for (const shape of ['premolar', 'canine', 'incisor'] as ToothShape[]) {
      for (const dentition of ALL_DENTITIONS) {
        for (const isUpper of [true, false]) {
          assert.equal(
            getToothGeometry(shape, dentition, isUpper).roots.length,
            1,
            `${dentition}/${shape}/${isUpper ? 'upper' : 'lower'} must be single-rooted`,
          );
        }
      }
    }
  });

  await test('the primary and permanent drawings are genuinely different, not the same paths reused', () => {
    for (const shape of ALL_SHAPES) {
      assert.notEqual(
        getToothGeometry(shape, 'permanent', false).crown,
        getToothGeometry(shape, 'primary', false).crown,
        `${shape} must have a distinct primary crown`,
      );
    }
  });

  await test('primary molar roots splay wider than permanent ones (the paediatric anatomical cue)', () => {
    const horizontalExtent = (dentition: Dentition, isUpper: boolean) => {
      const xs = getToothGeometry('molar', dentition, isUpper).roots.flatMap((d) => pathPoints(d).xs);
      return { min: Math.min(...xs), max: Math.max(...xs) };
    };

    for (const isUpper of [true, false]) {
      const jaw = isUpper ? 'upper' : 'lower';
      const permanent = horizontalExtent('permanent', isUpper);
      const primary = horizontalExtent('primary', isUpper);
      assert.ok(
        primary.min < permanent.min,
        `${jaw} primary molar roots must splay further mesially (${primary.min} vs ${permanent.min})`,
      );
      assert.ok(
        primary.max > permanent.max,
        `${jaw} primary molar roots must splay further distally (${primary.max} vs ${permanent.max})`,
      );
    }
  });

  await test('primary roots are shorter than permanent ones (a deciduous tooth is a smaller tooth)', () => {
    for (const shape of ALL_SHAPES) {
      for (const isUpper of [true, false]) {
        const deepest = (dentition: Dentition) =>
          Math.max(...getToothGeometry(shape, dentition, isUpper).roots.flatMap((d) => pathPoints(d).ys));
        assert.ok(
          deepest('primary') < deepest('permanent'),
          `${isUpper ? 'upper' : 'lower'} primary ${shape} root must be shorter (${deepest('primary')} vs ${deepest('permanent')})`,
        );
      }
    }
  });

  await test('every coordinate stays inside the 64x88 viewBox, so no tooth is clipped', () => {
    const paths: string[] = [IMPLANT_FIXTURE_PATH, IMPLANT_THREAD_PATH, CROWN_MARGIN_PATH];
    for (const shape of ALL_SHAPES) {
      for (const dentition of ALL_DENTITIONS) {
        for (const isUpper of [true, false]) {
          const geometry = getToothGeometry(shape, dentition, isUpper);
          paths.push(geometry.crown, geometry.surface, geometry.cervical, ...geometry.roots);
        }
      }
    }
    for (const d of paths) {
      for (const value of pathNumbers(d)) {
        assert.ok(value >= 0 && value <= 88, `coordinate ${value} escapes the viewBox in path: ${d.slice(0, 48)}`);
      }
    }
  });

  await test('crown and root x-coordinates stay inside the 64-wide viewBox specifically', () => {
    for (const shape of ALL_SHAPES) {
      for (const dentition of ALL_DENTITIONS) {
        for (const isUpper of [true, false]) {
          const geometry = getToothGeometry(shape, dentition, isUpper);
          for (const d of [geometry.crown, ...geometry.roots]) {
            const { xs, ys } = pathPoints(d);
            for (const x of xs) {
              assert.ok(x >= 0 && x <= 64, `x=${x} escapes the 64-wide viewBox: ${d.slice(0, 48)}`);
            }
            for (const y of ys) {
              assert.ok(y >= 0 && y <= 88, `y=${y} escapes the 88-tall viewBox: ${d.slice(0, 48)}`);
            }
          }
        }
      }
    }
  });

  section('resolveInitialDentition — recorded data beats the age heuristic');

  await test('an empty chart with no date of birth opens on the adult chart', () => {
    assert.equal(
      resolveInitialDentition({ hasPermanentRecords: false, hasPrimaryRecords: false }),
      'permanent',
    );
  });

  await test('primary-only records open the paediatric chart even for an adult date of birth', () => {
    assert.equal(
      resolveInitialDentition({
        dateOfBirth: '1985-04-02',
        hasPermanentRecords: false,
        hasPrimaryRecords: true,
      }),
      'primary',
    );
  });

  await test('permanent-only records open the adult chart even for a toddler date of birth', () => {
    assert.equal(
      resolveInitialDentition({
        dateOfBirth: '2023-04-02',
        hasPermanentRecords: true,
        hasPrimaryRecords: false,
        now: new Date('2026-06-15T12:00:00Z'),
      }),
      'permanent',
    );
  });

  await test('an empty chart for a child under 6 opens the paediatric chart', () => {
    assert.equal(
      resolveInitialDentition({
        dateOfBirth: '2021-06-16',
        hasPermanentRecords: false,
        hasPrimaryRecords: false,
        now: new Date('2026-06-15T12:00:00Z'),
      }),
      'primary',
    );
  });

  await test('at exactly 6 the adult chart becomes the default (first permanent molars are erupting)', () => {
    assert.equal(
      resolveInitialDentition({
        dateOfBirth: '2020-06-15',
        hasPermanentRecords: false,
        hasPrimaryRecords: false,
        now: new Date('2026-06-15T12:00:00Z'),
      }),
      'permanent',
    );
  });

  await test('mixed dentition (records on both arches) falls back to the age rule, not to whichever is bigger', () => {
    const base = { hasPermanentRecords: true, hasPrimaryRecords: true, now: new Date('2026-06-15T12:00:00Z') };
    assert.equal(resolveInitialDentition({ ...base, dateOfBirth: '2022-01-01' }), 'primary');
    assert.equal(resolveInitialDentition({ ...base, dateOfBirth: '2014-01-01' }), 'permanent');
  });

  await test('an unparseable date of birth never throws and never forces the paediatric chart', () => {
    assert.equal(
      resolveInitialDentition({
        dateOfBirth: 'not-a-date',
        hasPermanentRecords: false,
        hasPrimaryRecords: false,
      }),
      'permanent',
    );
  });

  section('toothChartAgeInYears');

  await test('a missing or unparseable date of birth yields null rather than a guessed age', () => {
    assert.equal(toothChartAgeInYears(null), null);
    assert.equal(toothChartAgeInYears(undefined), null);
    assert.equal(toothChartAgeInYears(''), null);
    assert.equal(toothChartAgeInYears('not-a-date'), null);
  });

  await test('the birthday boundary is handled without an off-by-one', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    assert.equal(toothChartAgeInYears('2020-06-15', now), 6);
    assert.equal(toothChartAgeInYears('2020-06-16', now), 5);
    assert.equal(toothChartAgeInYears(new Date('2026-01-01'), now), 0);
  });

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
