/**
 * F2-GUARDRAIL-IMPL-001 — baseline comparison.
 *
 * Per F2-SEC-003 section 6: "Consume the existing evidence inventories
 * (PR #313's 71-edge JSON...) as its input baseline — do not re-derive them
 * from scratch." This module reads
 * docs/program/evidence/F2-GUARDRAIL-PREP-010-A_cross_domain_access_inventory.json
 * (the frozen 71-edge baseline) read-only, at scan time. This task does NOT
 * commit a new, separate baseline snapshot of the guardrail's own findings —
 * see docs/program/evidence/F2-GUARDRAIL-IMPL-001_* for why (F2-SEC-003 did
 * not authorize freezing a self-referential baseline in this first task;
 * §5.2 requires a false-positive validation pass first).
 *
 * MATCH-KEY LIMITATION (deliberate, documented — not a silent
 * reinterpretation of the frozen tuple): the baseline JSON's own
 * `proposedEnforcementKey.callerSymbol` values are, for the large majority
 * of the 71 edges, free-text/descriptive ("logActivity / writeAuditLog
 * callers") rather than a single machine-comparable identifier — only the
 * 6 edges corrected in the F2-GUARDRAIL-PREP-010-A-R1 pass (CDA-067..072)
 * carry an exact symbol. Matching strictly on all 5 tuple fields would
 * therefore classify ~92% of the baseline as "no longer present" on every
 * run, which is not useful drift signal. Baseline matching in this V1 uses
 * (ownerDomain, targetModelOrSymbol, accessKind, callerPath) —
 * callerSymbol is still reported on both sides of the comparison for a
 * human reviewer, just not used to decide EXISTING vs NEW. A future task
 * may re-key this once every baseline entry carries an exact callerSymbol.
 */
import { readFileSync } from 'node:fs';
import type { BaselineComparison, BaselineEntry, ExactEdgeTuple } from './types.js';
import { globMatch } from './globMatch.js';

export class BaselineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BaselineError';
  }
}

interface BaselineJsonEdge {
  id: string;
  classification?: string;
  risk?: string;
  proposedEnforcementKey?: {
    callerPath?: string;
    callerPathGlob?: string;
    callerSymbol?: string;
    ownerDomain?: string;
    targetModelOrSymbol?: string;
    accessKind?: string;
  };
}

export const MATCH_KEY_FIELDS = ['callerPath', 'ownerDomain', 'targetModelOrSymbol', 'accessKind'];
export const MATCH_KEY_LIMITATION =
  'callerSymbol is excluded from the baseline match key because most F2-GUARDRAIL-PREP-010-A baseline entries store it as descriptive prose rather than an exact identifier (see lib/baseline.ts header comment). callerSymbol is still reported on findings for human review.';

export function loadBaselineEntries(filePath: string): BaselineEntry[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new BaselineError(
      `Cannot read baseline file "${filePath}" (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`,
    );
  }

  let parsed: { edges?: BaselineJsonEdge[] };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new BaselineError(`Baseline file "${filePath}" is not valid JSON: ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed.edges)) {
    throw new BaselineError(`Baseline file "${filePath}" is missing a top-level "edges" array`);
  }

  const entries: BaselineEntry[] = [];
  for (const edge of parsed.edges) {
    const key = edge.proposedEnforcementKey;
    if (!key || !key.ownerDomain || !key.targetModelOrSymbol || !key.accessKind) {
      // Edges without a fully-specified proposedEnforcementKey (e.g. a
      // future edge intentionally left un-enforceable) are skipped from
      // comparison, not treated as a malformed file.
      continue;
    }
    entries.push({
      baselineEdgeId: edge.id,
      classification: edge.classification ?? 'UNKNOWN',
      risk: edge.risk ?? 'UNKNOWN',
      callerPathExact: key.callerPath ?? null,
      callerPathGlob: key.callerPathGlob ?? null,
      callerSymbol: key.callerSymbol ?? null,
      ownerDomain: key.ownerDomain,
      targetModelOrSymbol: key.targetModelOrSymbol,
      accessKind: key.accessKind,
    });
  }

  return entries.sort((a, b) => a.baselineEdgeId.localeCompare(b.baselineEdgeId));
}

function callerPathMatches(entry: BaselineEntry, callerPath: string): boolean {
  if (entry.callerPathExact) return entry.callerPathExact === callerPath;
  if (entry.callerPathGlob) return globMatch(entry.callerPathGlob, callerPath);
  return false;
}

export function findMatchingBaselineEntry(entries: BaselineEntry[], tuple: ExactEdgeTuple): BaselineEntry | null {
  for (const entry of entries) {
    if (entry.ownerDomain !== tuple.ownerDomain) continue;
    if (entry.targetModelOrSymbol !== tuple.targetModelOrSymbol) continue;
    if (entry.accessKind !== tuple.accessKind) continue;
    if (!callerPathMatches(entry, tuple.callerPath)) continue;
    return entry;
  }
  return null;
}

export function computeResolvedBaselineEdgeIds(
  entries: BaselineEntry[],
  currentTuples: ExactEdgeTuple[],
): string[] {
  const resolved: string[] = [];
  for (const entry of entries) {
    if (!entry.callerPathExact) continue; // glob entries: "resolved" is not well-defined, skip
    const stillPresent = currentTuples.some(
      (tuple) =>
        tuple.callerPath === entry.callerPathExact &&
        tuple.ownerDomain === entry.ownerDomain &&
        tuple.targetModelOrSymbol === entry.targetModelOrSymbol &&
        tuple.accessKind === entry.accessKind,
    );
    if (!stillPresent) resolved.push(entry.baselineEdgeId);
  }
  return resolved.sort((a, b) => a.localeCompare(b));
}

export function buildBaselineComparisonSummary(
  baselineSource: string,
  entries: BaselineEntry[],
  newCount: number,
  existingCount: number,
  resolvedBaselineEdgeIds: string[],
): BaselineComparison {
  return {
    baselineSource,
    baselineEdgeCount: entries.length,
    matchKeyFields: MATCH_KEY_FIELDS,
    matchKeyLimitation: MATCH_KEY_LIMITATION,
    newCount,
    existingCount,
    resolvedCount: resolvedBaselineEdgeIds.length,
    resolvedBaselineEdgeIds,
  };
}
