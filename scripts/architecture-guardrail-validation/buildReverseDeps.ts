// F2-GUARDRAIL-VAL-002 scratch tool (not part of the guardrail itself) —
// builds a reverse-dependency map (target file -> caller files + their
// domain-map status) across ALL server/src/**/*.ts (not just the 5 scan
// roots), to give evidence for domain-map completeness corrections.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';
import { isRelativeSpecifier, resolveRelativeImport } from '../architecture-guardrail/lib/moduleResolution.js';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const domainMap = JSON.parse(readFileSync(join(repoRoot, 'scripts/architecture-guardrail/config/domain-map.json'), 'utf8'));

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) continue;
      out.push(full);
    }
  }
}

const allFiles: string[] = [];
walk(join(repoRoot, 'server/src'), allFiles);

function toRel(p: string) {
  return relative(repoRoot, p).split('\\').join('/');
}

const reverse: Record<string, string[]> = {};

for (const abs of allFiles) {
  const callerPath = toRel(abs);
  const content = readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(callerPath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const spec = stmt.moduleSpecifier.text;
    if (!isRelativeSpecifier(spec)) continue;
    const resolved = resolveRelativeImport(abs, spec);
    if (!resolved) continue;
    const targetPath = toRel(resolved);
    if (!targetPath.startsWith('server/src/')) continue;
    if (targetPath === callerPath) continue;
    (reverse[targetPath] ??= []).push(callerPath);
  }
}

const targetArg = process.argv[2];
const targets = targetArg ? targetArg.split(',') : Object.keys(reverse).sort();

for (const t of targets) {
  const callers = reverse[t] ?? [];
  const domainCounts: Record<string, number> = {};
  for (const c of callers) {
    const d = domainMap.files[c] ?? 'UNRESOLVED';
    domainCounts[d] = (domainCounts[d] ?? 0) + 1;
  }
  console.log(`\n=== ${t} (own map entry: ${domainMap.files[t] ?? 'ABSENT'}) ===`);
  console.log(`callers (${callers.length}):`);
  for (const c of callers) {
    console.log(`  ${c}  [${domainMap.files[c] ?? 'UNRESOLVED'}]`);
  }
  console.log('caller domain distribution:', JSON.stringify(domainCounts));
}
