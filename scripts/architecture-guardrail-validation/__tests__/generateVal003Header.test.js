// F2-GUARDRAIL-VAL-003-R1 focused regression tests for the docblock-opener
// fix in ../generateVal003BaselineEntries.mjs (Copilot review: the header
// extraction regex did not correctly match the "/**" opener, so the raw
// "/**" text leaked into the extracted evidence snippet instead of being
// stripped like the "*" body / "*/" closer lines were).
//
// Run: node --test scripts/architecture-guardrail-validation/__tests__/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripDocCommentMarkers, extractHeaderSnippet } from '../generateVal003BaselineEntries.mjs';

test('stripDocCommentMarkers correctly strips the "/**" opener line (not just body/closer)', () => {
  assert.equal(stripDocCommentMarkers('/**'), '');
  assert.equal(stripDocCommentMarkers('/** fileStorage.ts — shared storage abstraction.'), 'fileStorage.ts — shared storage abstraction.');
});

test('stripDocCommentMarkers strips a body "*" marker line', () => {
  assert.equal(stripDocCommentMarkers(' * Generic file storage helpers used across domains.'), 'Generic file storage helpers used across domains.');
});

test('stripDocCommentMarkers strips a closer "*/" line', () => {
  assert.equal(stripDocCommentMarkers(' */'), '');
});

test('stripDocCommentMarkers strips a same-line "/** ... */" combined docblock', () => {
  assert.equal(stripDocCommentMarkers('/** Shared platform module. */'), 'Shared platform module.');
});

test('extractHeaderSnippet: full opener/body/closer block extracts only the body text, opener/closer produce no noise', () => {
  // Only opener + first 2 body lines are considered (matches the up-to-3
  // comment-line convention exercised separately below) — the opener strips
  // to "" and drops out, leaving the two body lines.
  const header = [
    '/**',
    ' * fileStorage.ts',
    ' * Generic, domain-agnostic file storage helpers.',
    ' */',
    "import { readFileSync } from 'node:fs';",
  ].join('\n');

  const snippet = extractHeaderSnippet(header);

  // The raw "/**" opener token must not leak into the extracted snippet.
  assert.ok(!snippet.includes('/**'), `snippet leaked the raw opener: "${snippet}"`);
  assert.equal(snippet, 'fileStorage.ts Generic, domain-agnostic file storage helpers.');
});

test('extractHeaderSnippet: returns null when the header has no doc comment at all', () => {
  const header = ["import express from 'express';", 'const x = 1;'].join('\n');
  assert.equal(extractHeaderSnippet(header), null);
});

test('extractHeaderSnippet: returns null for an opener+closer doc comment with no body text', () => {
  const header = ['/**', ' */', "import express from 'express';"].join('\n');
  assert.equal(extractHeaderSnippet(header), null);
});

test('extractHeaderSnippet: caps at 3 comment lines (matches the up-to-3-line evidence convention)', () => {
  const header = [
    '/**',
    ' * one',
    ' * two',
    ' * three',
    ' * four',
    ' */',
  ].join('\n');
  // slice(0,3) of the comment-line set is ["/**", " * one", " * two"] —
  // opener strips to "", so only "one" and "two" survive into the snippet.
  assert.equal(extractHeaderSnippet(header), 'one two');
});
