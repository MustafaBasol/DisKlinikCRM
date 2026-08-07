// F2-GUARDRAIL-VAL-003-R1 focused regression tests for the import-matcher
// fix in ../verifyVal003Candidates.mjs (Copilot review: the matcher resolved
// only a basename and did a substring search over the raw specifier text,
// so e.g. target "services/storage.ts" would false-positive-match an import
// from "../services/fileStorage.js", and two same-named files in different
// directories were indistinguishable). The fix resolves the full normalized
// module path of each import specifier and requires exact equality against
// the target's full normalized path.
//
// Run: node --test scripts/architecture-guardrail-validation/__tests__/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeModulePath,
  resolveRelativeSpecifier,
  findImportSpecifiersForSymbol,
  callerImportsTargetSymbol,
} from '../verifyVal003Candidates.mjs';

test('normalizeModulePath strips known JS/TS extensions and normalizes separators', () => {
  assert.equal(normalizeModulePath('server/src/services/fileStorage.ts'), 'server/src/services/fileStorage');
  assert.equal(normalizeModulePath('server/src/services/fileStorage.js'), 'server/src/services/fileStorage');
  assert.equal(normalizeModulePath('server\\src\\services\\fileStorage.ts'), 'server/src/services/fileStorage');
  assert.equal(normalizeModulePath('server/src/services/fileStorage'), 'server/src/services/fileStorage');
});

test('resolveRelativeSpecifier returns null for bare/package specifiers', () => {
  assert.equal(resolveRelativeSpecifier('server/src/routes/x.ts', 'express'), null);
  assert.equal(resolveRelativeSpecifier('server/src/routes/x.ts', '@prisma/client'), null);
});

test('resolveRelativeSpecifier resolves a relative specifier against the caller directory, extension-insensitively', () => {
  assert.equal(
    resolveRelativeSpecifier('server/src/routes/attachments.ts', '../services/fileStorage.js'),
    'server/src/services/fileStorage',
  );
  // Extensionless relative import — must resolve safely to the same key.
  assert.equal(
    resolveRelativeSpecifier('server/src/routes/attachments.ts', '../services/fileStorage'),
    'server/src/services/fileStorage',
  );
});

test('resolveRelativeSpecifier distinguishes same-basename modules in different directories', () => {
  const fromA = resolveRelativeSpecifier('server/src/routes/x.ts', '../services/a/thing.js');
  const fromB = resolveRelativeSpecifier('server/src/routes/x.ts', '../services/b/thing.js');
  assert.equal(fromA, 'server/src/services/a/thing');
  assert.equal(fromB, 'server/src/services/b/thing');
  assert.notEqual(fromA, fromB);
});

test('findImportSpecifiersForSymbol isolates the specifier per import clause (named, aliased, default, namespace)', () => {
  const content = `
import express from 'express';
import { deleteFile, saveFile } from '../services/fileStorage.js';
import { authorize as auth } from '../middleware/auth.js';
import * as roles from '../utils/roles.js';
`;
  assert.deepEqual(findImportSpecifiersForSymbol(content, 'deleteFile'), ['../services/fileStorage.js']);
  assert.deepEqual(findImportSpecifiersForSymbol(content, 'saveFile'), ['../services/fileStorage.js']);
  assert.deepEqual(findImportSpecifiersForSymbol(content, 'auth'), ['../middleware/auth.js']);
  assert.deepEqual(findImportSpecifiersForSymbol(content, 'roles'), ['../utils/roles.js']);
  assert.deepEqual(findImportSpecifiersForSymbol(content, 'express'), ['express']);
  // A symbol that isn't imported anywhere in the clause yields no hits.
  assert.deepEqual(findImportSpecifiersForSymbol(content, 'notImported'), []);
});

test('findImportSpecifiersForSymbol respects word boundaries (no partial-identifier match)', () => {
  const content = `import { authorize } from '../middleware/auth.js';`;
  // "auth" is a substring of "authorize" but not the imported identifier.
  assert.deepEqual(findImportSpecifiersForSymbol(content, 'auth'), []);
  assert.deepEqual(findImportSpecifiersForSymbol(content, 'authorize'), ['../middleware/auth.js']);
});

test('findImportSpecifiersForSymbol handles multi-line import clauses', () => {
  const content = `
import {
  buildStorageKey,
  deleteFile,
  fileNameFromKey,
} from '../services/fileStorage.js';
`;
  assert.deepEqual(findImportSpecifiersForSymbol(content, 'deleteFile'), ['../services/fileStorage.js']);
});

test('callerImportsTargetSymbol: exact-path match required — no basename substring false positive', () => {
  // Regression fixture shaped after the real bug: target "services/storage.ts"
  // must NOT match an import from "../services/fileStorage.js", even though
  // the old basename-substring matcher treated "storage" as found inside
  // "fileStorage.js".
  const content = `import { deleteFile } from '../services/fileStorage.js';`;
  assert.equal(
    callerImportsTargetSymbol('server/src/routes/attachments.ts', content, 'deleteFile', 'services/storage.ts'),
    false,
  );
  // The correct target must still match.
  assert.equal(
    callerImportsTargetSymbol('server/src/routes/attachments.ts', content, 'deleteFile', 'services/fileStorage.ts'),
    true,
  );
});

test('callerImportsTargetSymbol: distinguishes same-basename modules in different directories end-to-end', () => {
  const content = `import { thing } from '../services/a/thing.js';`;
  assert.equal(
    callerImportsTargetSymbol('server/src/routes/x.ts', content, 'thing', 'services/a/thing.ts'),
    true,
  );
  assert.equal(
    callerImportsTargetSymbol('server/src/routes/x.ts', content, 'thing', 'services/b/thing.ts'),
    false,
  );
});

test('callerImportsTargetSymbol: extensionless relative import resolves safely', () => {
  const content = `import { deleteFile } from '../services/fileStorage';`;
  assert.equal(
    callerImportsTargetSymbol('server/src/routes/attachments.ts', content, 'deleteFile', 'services/fileStorage.ts'),
    true,
  );
});

test('callerImportsTargetSymbol: false when the symbol is not imported at all', () => {
  const content = `import { saveFile } from '../services/fileStorage.js';`;
  assert.equal(
    callerImportsTargetSymbol('server/src/routes/attachments.ts', content, 'deleteFile', 'services/fileStorage.ts'),
    false,
  );
});

test('callerImportsTargetSymbol: real repo fixture — attachments.ts still imports deleteFile from services/fileStorage.ts', () => {
  // Integration-style sanity check against one of the 88 real VAL-003
  // candidates, reading the actual file from disk (test runs from repo root).
  const content = fs.readFileSync('server/src/routes/attachments.ts', 'utf8');
  assert.equal(
    callerImportsTargetSymbol('server/src/routes/attachments.ts', content, 'deleteFile', 'services/fileStorage.ts'),
    true,
  );
});
