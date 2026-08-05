/**
 * F2-GUARDRAIL-IMPL-001 — domain ownership classification.
 *
 * A file's domain is looked up exactly in the checked-in domain-map config
 * (config/domain-map.json, mechanically derived from F0-003 — see
 * config/generateDomainMap.ts). A file absent from the map is classified
 * "UNRESOLVED", matching F2-GUARDRAIL-PREP-010-A's own UNRESOLVED_OWNERSHIP
 * convention — ownership is never guessed from a file's directory name or
 * any other heuristic.
 */
import type { DomainMapConfig } from './types.js';

export const UNRESOLVED_DOMAIN = 'UNRESOLVED';

export function classifyDomain(domainMap: DomainMapConfig, repoRelativePath: string): string {
  return domainMap.files[repoRelativePath] ?? UNRESOLVED_DOMAIN;
}
