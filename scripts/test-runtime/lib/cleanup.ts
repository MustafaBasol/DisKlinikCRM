import fs from 'node:fs/promises';
import { dockerRemoveContainer, dockerRemoveNetwork } from './docker.js';
import type { CleanupResult } from './outcome.js';

export interface TeardownTargets {
  containerNames: string[];
  networkNames: string[];
  tempDirs: string[];
}

/** Always-attempt teardown. Runs every step even if an earlier step fails; aggregates errors. */
export async function teardown(targets: TeardownTargets): Promise<CleanupResult> {
  const errors: string[] = [];

  for (const name of targets.containerNames) {
    const result = dockerRemoveContainer(name);
    if (result.code !== 0) {
      errors.push(`container "${name}": ${result.stderr.trim() || result.stdout.trim()}`);
    }
  }

  for (const name of targets.networkNames) {
    const result = dockerRemoveNetwork(name);
    if (result.code !== 0) {
      errors.push(`network "${name}": ${result.stderr.trim() || result.stdout.trim()}`);
    }
  }

  for (const dir of targets.tempDirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err) {
      errors.push(`temp dir "${dir}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { success: errors.length === 0, errors };
}
