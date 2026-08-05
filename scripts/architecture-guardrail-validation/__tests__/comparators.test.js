// F2-GUARDRAIL-VAL-001-R1 focused regression tests for the comparator
// contract fix in ../buildSample.js (Copilot review: comparators returned 1
// instead of 0 when compared keys were equal, violating the
// Array.prototype.sort contract and risking engine-dependent tie ordering).
//
// Run: node --test scripts/architecture-guardrail-validation/__tests__/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareCodeUnits, compareByIdAsc } from '../buildSample.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'buildSample.js'), 'utf8');

test('compareCodeUnits returns 0 for identical keys (equal-key contract)', () => {
  assert.equal(compareCodeUnits('abc', 'abc'), 0);
  assert.equal(compareCodeUnits('', ''), 0);
  assert.equal(compareCodeUnits('core-tenant-security|utils/secrets.ts|import', 'core-tenant-security|utils/secrets.ts|import'), 0);
});

test('compareCodeUnits returns -1/1 for ordered keys and is antisymmetric', () => {
  assert.equal(compareCodeUnits('a', 'b'), -1);
  assert.equal(compareCodeUnits('b', 'a'), 1);
  assert.equal(compareCodeUnits('a10', 'a2'), -1); // code-unit order: '1' (0x31) < '2' (0x32)
  assert.equal(compareCodeUnits('a2', 'a10'), 1);
});

test('compareCodeUnits is locale-independent (code-unit order, not collation)', () => {
  // Under code-unit comparison, uppercase 'A' (0x41) always sorts strictly
  // before lowercase 'a' (0x61). Locale-aware collation (localeCompare) does
  // not guarantee this — results vary by locale/options. This pins the
  // comparator to a stable, engine-independent order.
  assert.equal(compareCodeUnits('A', 'a'), -1);
  assert.equal(compareCodeUnits('a', 'A'), 1);
  assert.equal(compareCodeUnits('_', 'a'), -1); // 0x5F < 0x61
});

test('compareByIdAsc returns 0 for two findings with identical length and identical id', () => {
  const a = { id: 'dup00000000dupid' };
  const b = { id: 'dup00000000dupid' };
  assert.equal(a.id.length, b.id.length);
  assert.equal(compareByIdAsc(a, b), 0);
  assert.equal(compareByIdAsc(b, a), 0);
});

test('compareByIdAsc is a stable total order across duplicate and near-duplicate ids', () => {
  const items = [{ id: 'bb' }, { id: 'aa' }, { id: 'bb' }, { id: 'aa' }, { id: 'ab' }];
  const sorted = [...items].sort(compareByIdAsc);
  assert.deepEqual(sorted.map((x) => x.id), ['aa', 'aa', 'ab', 'bb', 'bb']);
});

test('buildSample.js source contains no defective `? -1 : 1` comparator branch', () => {
  // Guards against regression to the pre-fix pattern where ties returned 1
  // instead of 0. Every comparator ternary in this file must resolve to a
  // three-way (-1/0/1) or reuse compareCodeUnits/compareByIdAsc.
  assert.ok(
    !/\?\s*-1\s*:\s*1\b/.test(SCRIPT_SOURCE),
    'found a two-way `? -1 : 1` comparator branch that never returns 0 for equal keys',
  );
});

test('buildSample.js does not use localeCompare (must stay locale-independent)', () => {
  assert.ok(!SCRIPT_SOURCE.includes('localeCompare'));
});
