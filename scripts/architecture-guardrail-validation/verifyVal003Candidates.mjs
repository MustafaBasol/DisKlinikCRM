// F2-GUARDRAIL-VAL-003 — re-verifies each candidate edge against CURRENT
// source (not just VAL-001's prior sample) per the assigning brief's
// constraint 5. For each candidate: confirms the caller file still contains
// an import of callerSymbol from a specifier resolving to targetModelOrSymbol,
// and captures the target file's own header/doc comment (first 20 lines) as
// direct platform-shared-dependency evidence.
import { readFileSync, writeFileSync } from 'node:fs';

const data = JSON.parse(
  readFileSync('docs/program/evidence/tooling/F2-GUARDRAIL-VAL-003_candidate_analysis.json', 'utf8'),
);

function callerStillImportsSymbol(callerPath, callerSymbol, targetModelOrSymbol) {
  const content = readFileSync(callerPath, 'utf8');
  // targetModelOrSymbol is "services/fileStorage.ts" etc (relative to server/src/).
  const targetBase = targetModelOrSymbol.replace(/\.ts$/, '').split('/').pop();
  const importLineRegex = new RegExp(
    `import[^;]*\\b${callerSymbol.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b[^;]*from\\s*['"][^'"]*${targetBase}(\\.js)?['"]`,
  );
  const found = importLineRegex.test(content);
  return found;
}

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
