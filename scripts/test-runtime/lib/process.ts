import { spawnAsync } from './docker.js';
import { REPO_ROOT, SERVER_DIR } from './paths.js';
import { isValidGenerationAuthorization } from './prismaGeneration.js';

export { REPO_ROOT, SERVER_DIR };

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// Windows .cmd shims cannot be spawned without a shell (Node ENOENT/EINVAL);
// every argv element passed through it below is a fixed internal literal.
const useShell = process.platform === 'win32';

/**
 * Runs `npx prisma generate && npx prisma migrate deploy` from server/,
 * sequentially. If `opts.authorization` is a token minted by this same
 * process's `generatePrismaClientOnce()` (see prismaGeneration.ts), the
 * generate step is skipped — the caller has already generated a fresh
 * client and this invocation only needs to apply migrations to its own
 * disposable database. Any invalid/missing/foreign authorization falls back
 * to generating here, exactly as before (fail-safe, never fail-skip).
 */
export async function runMigrations(
  env: NodeJS.ProcessEnv,
  opts?: { authorization?: unknown },
): Promise<{ code: number; step: 'generate' | 'migrate-deploy' | 'ok' }> {
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const canSkipGenerate = isValidGenerationAuthorization(opts?.authorization);
  if (!canSkipGenerate) {
    const generate = await spawnAsync(npxCmd, ['prisma', 'generate'], { cwd: SERVER_DIR, env, shell: useShell });
    if (generate.code !== 0) return { code: generate.code, step: 'generate' };
  }
  const deploy = await spawnAsync(npxCmd, ['prisma', 'migrate', 'deploy'], { cwd: SERVER_DIR, env, shell: useShell });
  if (deploy.code !== 0) return { code: deploy.code, step: 'migrate-deploy' };
  return { code: 0, step: 'ok' };
}

/** Runs `npm run <scriptName>` from server/, with the given environment applied. */
export async function runNpmScript(scriptName: string, env: NodeJS.ProcessEnv): Promise<{ code: number }> {
  return spawnAsync(npmCmd, ['run', scriptName], { cwd: SERVER_DIR, env, shell: useShell });
}

/** Test-only: a harmless, deterministically-failing command for failure-injection verification. */
export async function runInjectedFailingCommand(env: NodeJS.ProcessEnv): Promise<{ code: number }> {
  const nodeCmd = process.execPath;
  return spawnAsync(nodeCmd, ['-e', 'process.exit(1)'], { cwd: SERVER_DIR, env });
}
