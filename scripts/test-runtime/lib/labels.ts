/** Stable Docker resource labels for disposable-runtime resources and stale-sweep targeting. */

export const LABEL_RUNTIME = 'com.noramedi.test-runtime';
export const LABEL_RUN_ID = 'com.noramedi.test-run-id';
export const LABEL_PROFILE = 'com.noramedi.test-profile';
export const LABEL_CREATED_AT = 'com.noramedi.test-created-at';
export const LABEL_TASK = 'com.noramedi.test-task';

export type RuntimeLabels = Record<string, string>;

export function buildLabels(params: {
  runId: string;
  profile: string;
  createdAt: string;
  task?: string;
}): RuntimeLabels {
  return {
    [LABEL_RUNTIME]: 'true',
    [LABEL_RUN_ID]: params.runId,
    [LABEL_PROFILE]: params.profile,
    [LABEL_CREATED_AT]: params.createdAt,
    [LABEL_TASK]: params.task ?? 'F1-003-P2',
  };
}

export function labelArgs(labels: RuntimeLabels): string[] {
  return Object.entries(labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]);
}

export function labelFilterArgs(labels: Partial<RuntimeLabels>): string[] {
  return Object.entries(labels).flatMap(([key, value]) => ['--filter', `label=${key}=${value}`]);
}
