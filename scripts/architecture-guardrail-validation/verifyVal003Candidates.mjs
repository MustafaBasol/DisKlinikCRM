// F2-GUARDRAIL-VAL-003 — re-verifies each candidate edge against CURRENT
// source (not just VAL-001's prior sample) per the assigning brief's
// constraint 5. For each candidate: confirms the caller file still contains
// an import of callerSymbol from a specifier that RESOLVES to the exact
// targetModelOrSymbol file (full normalized path match, not a basename
// substring match — see F2-GUARDRAIL-VAL-003-R1: a basename-only matcher
// would conflate e.g. services/storage.ts with services/fileStorage.ts),
// and captures the target file's own header/doc comment (first 20 lines) as
// direct platform-shared-dependency evidence.
//
// Run: node --test scripts/architecture-guardrail-validation/__tests__/
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const JS_TS_EXTENSIONS_RE = /\.(mts|cts|tsx|ts|mjs|cjs|jsx|js)$/i;
const IMPORT_STATEMENT_RE = /import\s+([^;]*?)\s*from\s*['"]([^'"]+)['"]/g;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Repo-root-relative, POSIX-separator, extensionless form so ".js"-suffixed
// NodeNext specifiers (`../services/fileStorage.js`) and ".ts" source paths
// (`services/fileStorage.ts`) normalize to the same comparable key.
export function normalizeModulePath(rawPath) {
  const posixPath = rawPath.split(path.sep).join('/');
  const normalized = path.posix.normalize(posixPath);
  return normalized.replace(JS_TS_EXTENSIONS_RE, '').replace(/\/$/, '');
}

// Resolves a relative import specifier against the caller file's own
// location. Returns null for bare/package specifiers (e.g. "express",
// "@prisma/client") — those can never resolve to a server/src/ target.
export function resolveRelativeSpecifier(callerPath, specifier) {
  if (!specifier.startsWith('.')) return null;
  const callerDirPosix = path.posix.dirname(callerPath.split(path.sep).join('/'));
  return normalizeModulePath(path.posix.join(callerDirPosix, specifier));
}

// Extracts the module specifier of every import statement whose clause
// (the part between "import" and "from") references `symbol` as a whole
// token — covers default, named (incl. aliased), and namespace imports —
// without requiring the symbol to be the exported name.
export function findImportSpecifiersForSymbol(content, symbol) {
  const importStatementRe = new RegExp(IMPORT_STATEMENT_RE.source, 'g');
  const symbolRe = new RegExp(`(^|[^\\w$])${escapeRegExp(symbol)}([^\\w$]|$)`);
  const specifiers = [];
  let match;
  while ((match = importStatementRe.exec(content)) !== null) {
    const [, importClause, specifier] = match;
    if (symbolRe.test(importClause)) specifiers.push(specifier);
  }
  return specifiers;
}

// Pure core: given file content (not a path), does it still import
// callerSymbol from a specifier that resolves to targetModelOrSymbol?
// Full normalized path equality — never a basename or substring check.
export function callerImportsTargetSymbol(callerPath, content, callerSymbol, targetModelOrSymbol) {
  const targetNormalized = normalizeModulePath(`server/src/${targetModelOrSymbol}`);
  const specifiers = findImportSpecifiersForSymbol(content, callerSymbol);
  return specifiers.some((specifier) => resolveRelativeSpecifier(callerPath, specifier) === targetNormalized);
}

function callerStillImportsSymbol(callerPath, callerSymbol, targetModelOrSymbol) {
  const content = readFileSync(callerPath, 'utf8');
  return callerImportsTargetSymbol(callerPath, content, callerSymbol, targetModelOrSymbol);
}

export function main() {
  const data = JSON.parse(
    readFileSync('docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_candidate_analysis.json', 'utf8'),
  );

  const results = [];
  for (const c of data.candidates) {
    let stillImports = false;
    let error = null;
    try {
      stillImports = callerStillImportsSymbol(c.callerPath, c.callerSymbol, c.targetModelOrSymbol);
    } catch (err) {
      error = String(err.message || err);
    }
    results.push({ ...c, stillImports, error });
  }

  const confirmed = results.filter((r) => r.stillImports);
  const notConfirmed = results.filter((r) => !r.stillImports);
  console.log('Confirmed still-present imports:', confirmed.length);
  console.log('NOT confirmed (needs manual check):', notConfirmed.length);
  if (notConfirmed.length) {
    console.log(JSON.stringify(notConfirmed.map((r) => ({ callerPath: r.callerPath, callerSymbol: r.callerSymbol, targetModelOrSymbol: r.targetModelOrSymbol, error: r.error })), null, 2));
  }

  // Collect unique target files and their header (first 20 lines).
  const targets = [...new Set(data.candidates.map((c) => c.targetModelOrSymbol))];
  const headers = {};
  for (const t of targets) {
    const p = `server/src/${t}`;
    try {
      const content = readFileSync(p, 'utf8');
      headers[t] = content.split('\n').slice(0, 20).join('\n');
    } catch (err) {
      headers[t] = `ERROR: ${err.message}`;
    }
  }

  writeFileSync(
    'docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_verified_candidates.json',
    JSON.stringify({ results, targetHeaders: headers }, null, 2),
  );
  console.log('Wrote verified_candidates.json');

  return { confirmedCount: confirmed.length, notConfirmedCount: notConfirmed.length };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
