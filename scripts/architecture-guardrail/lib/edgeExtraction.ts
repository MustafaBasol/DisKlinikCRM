/**
 * F2-GUARDRAIL-IMPL-001 — exact-edge extraction.
 *
 * Uses the TypeScript compiler API (already an installed devDependency —
 * see docs/program/evidence/F2-GUARDRAIL-IMPL-001_* for the tool-choice
 * rationale over adding a new dependency-graph package) to parse each
 * discovered source file's syntax tree and extract cross-domain relative
 * imports. Deliberately syntactic only (no type-checker/Program is
 * constructed) — this guardrail's V1 scope is limited to statically
 * detectable symbol imports, not semantic Prisma-model access
 * classification (see the report's documented limitations).
 */
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import type { DomainMapConfig, ExactEdgeTuple, ReportError, ReportWarning } from './types.js';
import { classifyDomain } from './classification.js';
import { computeFindingId } from './findingId.js';
import { isRelativeSpecifier, resolveRelativeImport } from './moduleResolution.js';
import { toRepoRelativePosix } from './normalization.js';

export interface RawFinding extends ExactEdgeTuple {
  id: string;
  callerDomain: string;
}

export interface ExtractionResult {
  findings: RawFinding[];
  errors: ReportError[];
  warnings: ReportWarning[];
  filesParsed: number;
  filesSkipped: number;
}

const SERVER_SRC_PREFIX = 'server/src/';

function importedSymbolNames(importClause: ts.ImportClause | undefined): string[] {
  if (!importClause) return ['module'];

  const names: string[] = [];
  if (importClause.name) names.push('default');

  const bindings = importClause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) {
    names.push('*');
  } else if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      names.push((element.propertyName ?? element.name).text);
    }
  }

  return names.length > 0 ? names : ['module'];
}

export function extractEdges(repoRoot: string, callerPaths: string[], domainMap: DomainMapConfig): ExtractionResult {
  const findings: RawFinding[] = [];
  const errors: ReportError[] = [];
  const warnings: ReportWarning[] = [];
  let filesParsed = 0;
  let filesSkipped = 0;

  for (const callerPath of callerPaths) {
    const absolutePath = `${repoRoot}/${callerPath}`;
    let content: string;
    try {
      content = readFileSync(absolutePath, 'utf8');
    } catch (err) {
      errors.push({
        code: 'SOURCE_FILE_UNREADABLE',
        // Node's fs error message/err.path echo the absolute filesystem
        // path — only the OS error code is safe to include; callerPath
        // (already repo-relative) carries the location instead.
        message: `Cannot read source file (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`,
        filePath: callerPath,
      });
      filesSkipped += 1;
      continue;
    }

    try {
      const sourceFile = ts.createSourceFile(callerPath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const callerDomain = classifyDomain(domainMap, callerPath);

      for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

        const specifier = statement.moduleSpecifier.text;
        if (!isRelativeSpecifier(specifier)) continue;

        const resolvedAbsolute = resolveRelativeImport(absolutePath, specifier);
        if (!resolvedAbsolute) {
          warnings.push({
            code: 'IMPORT_UNRESOLVED',
            message: `Relative import "${specifier}" could not be resolved to a file on disk`,
            filePath: callerPath,
          });
          continue;
        }

        const targetPath = toRepoRelativePosix(repoRoot, resolvedAbsolute);
        if (!targetPath.startsWith(SERVER_SRC_PREFIX)) continue; // out of authorized scope

        const targetDomain = classifyDomain(domainMap, targetPath);
        if (targetDomain === callerDomain) continue; // same-domain, not a cross-domain edge

        const targetModelOrSymbol = targetPath.slice(SERVER_SRC_PREFIX.length);

        for (const callerSymbol of importedSymbolNames(statement.importClause)) {
          const tuple: ExactEdgeTuple = {
            callerPath,
            callerSymbol,
            ownerDomain: targetDomain,
            targetModelOrSymbol,
            accessKind: 'import',
          };
          findings.push({ ...tuple, id: computeFindingId(tuple), callerDomain });
        }
      }
      filesParsed += 1;
    } catch (err) {
      errors.push({
        code: 'SOURCE_PARSE_FAILED',
        message: `Failed to parse source file: ${(err as Error).message}`,
        filePath: callerPath,
      });
      filesSkipped += 1;
    }
  }

  return { findings, errors, warnings, filesParsed, filesSkipped };
}
