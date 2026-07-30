import { listLabeledContainers, listLabeledNetworks, dockerRemoveContainer, dockerRemoveNetwork } from './docker.js';
import { labelFilterArgs, LABEL_RUNTIME, LABEL_CREATED_AT, LABEL_RUN_ID, LABEL_PROFILE } from './labels.js';
import { isStale, resolveStaleTtlHours } from './outcome.js';

export interface StaleCandidate {
  kind: 'container' | 'network';
  id: string;
  name: string;
  runId: string;
  profile: string;
  createdAt: string;
}

export interface SweepReport {
  ttlHours: number;
  dryRun: boolean;
  candidates: StaleCandidate[];
  removed: StaleCandidate[];
  errors: string[];
}

/** Narrowly-scoped: only resources labeled com.noramedi.test-runtime=true, older than TTL. */
export function findStaleResources(ttlHours: number, nowMs: number): StaleCandidate[] {
  const filter = labelFilterArgs({ [LABEL_RUNTIME]: 'true' });
  const containers = listLabeledContainers(filter);
  const networks = listLabeledNetworks(filter);

  const candidates: StaleCandidate[] = [];
  for (const c of containers) {
    const createdAt = c.labels[LABEL_CREATED_AT];
    if (createdAt && isStale(createdAt, ttlHours, nowMs)) {
      candidates.push({
        kind: 'container',
        id: c.id,
        name: c.name,
        runId: c.labels[LABEL_RUN_ID] ?? '(unlabeled)',
        profile: c.labels[LABEL_PROFILE] ?? '(unlabeled)',
        createdAt,
      });
    }
  }
  for (const n of networks) {
    const createdAt = n.labels[LABEL_CREATED_AT];
    if (createdAt && isStale(createdAt, ttlHours, nowMs)) {
      candidates.push({
        kind: 'network',
        id: n.id,
        name: n.name,
        runId: n.labels[LABEL_RUN_ID] ?? '(unlabeled)',
        profile: n.labels[LABEL_PROFILE] ?? '(unlabeled)',
        createdAt,
      });
    }
  }
  return candidates;
}

export function runSweep(opts: { dryRun: boolean; ttlHoursOverride?: string; nowMs?: number }): SweepReport {
  const ttlHours = resolveStaleTtlHours(opts.ttlHoursOverride);
  const nowMs = opts.nowMs ?? Date.now();
  const candidates = findStaleResources(ttlHours, nowMs);
  const removed: StaleCandidate[] = [];
  const errors: string[] = [];

  if (!opts.dryRun) {
    for (const candidate of candidates) {
      const result = candidate.kind === 'container' ? dockerRemoveContainer(candidate.name) : dockerRemoveNetwork(candidate.name);
      if (result.code === 0) {
        removed.push(candidate);
      } else {
        errors.push(`${candidate.kind} "${candidate.name}": ${result.stderr.trim() || result.stdout.trim()}`);
      }
    }
  }

  return { ttlHours, dryRun: opts.dryRun, candidates, removed, errors };
}
