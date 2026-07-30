/**
 * F1-003-P2-R2 — single-generation coordination for `prisma generate`.
 *
 * Root cause (see evidence doc): every disposable-profile invocation ran its
 * own `npx prisma generate`, writing to the shared, schema-derived default
 * output `server/node_modules/.prisma/client`. Under `verify-parallel`'s
 * concurrent children, two simultaneous `prisma generate` processes raced on
 * that shared directory, producing a real (not fabricated) Windows `EBUSY`.
 *
 * Fix (Option A): `prisma generate` output depends only on `schema.prisma` —
 * never on `DATABASE_URL` or any other per-run value — so one generation
 * safely covers every child spawned within the same orchestrator invocation.
 * `generatePrismaClientOnce()` runs it exactly once per invocation and mints
 * a single-use-per-process authorization token; children only skip their own
 * generate step by presenting that exact token (see
 * `isValidGenerationAuthorization`) — a fabricated/foreign token, or no
 * token at all, always falls back to the child doing its own generate
 * (fail-safe: an invalid authorization can only cost extra work, never skip
 * a needed step).
 */
import { randomBytes } from 'node:crypto';
import { spawnAsync } from './docker.js';
import { SERVER_DIR } from './paths.js';

export interface GenerationAuthorization {
  readonly token: string;
  readonly generatedAt: number;
}

export interface GenerationFailure {
  readonly failed: true;
  readonly code: number;
}

/** Tokens minted by a successful generatePrismaClientOnce() call in THIS process. */
const validTokens = new Set<string>();

/** Injectable so unit tests can exercise the coordination logic without a real subprocess. */
export type GenerateRunner = (env: NodeJS.ProcessEnv) => Promise<{ code: number }>;

const defaultGenerateRunner: GenerateRunner = (env) => {
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const useShell = process.platform === 'win32';
  return spawnAsync(npxCmd, ['prisma', 'generate'], { cwd: SERVER_DIR, env, shell: useShell });
};

export async function generatePrismaClientOnce(
  env: NodeJS.ProcessEnv,
  runner: GenerateRunner = defaultGenerateRunner,
): Promise<GenerationAuthorization | GenerationFailure> {
  // Test-only, explicit failure-injection hook (--inject-failure=parent-generate)
  // — a real, deterministic non-zero exit, not a fabricated success/failure.
  const result = env.NMTEST_INJECT_PARENT_GENERATE_FAILURE === '1' ? { code: 1 } : await runner(env);
  if (result.code !== 0) {
    return { failed: true, code: result.code };
  }
  const token = randomBytes(16).toString('hex');
  const authorization: GenerationAuthorization = { token, generatedAt: Date.now() };
  validTokens.add(token);
  return authorization;
}

export function isGenerationFailure(
  result: GenerationAuthorization | GenerationFailure,
): result is GenerationFailure {
  return (result as GenerationFailure).failed === true;
}

/**
 * True only for a token minted by a successful generatePrismaClientOnce()
 * call in this same process. A fabricated string, an object shape from an
 * unrelated run, or `undefined` all return false.
 */
export function isValidGenerationAuthorization(auth: unknown): auth is GenerationAuthorization {
  if (typeof auth !== 'object' || auth === null) return false;
  const token = (auth as Record<string, unknown>).token;
  return typeof token === 'string' && validTokens.has(token);
}

/** Test-only: reset coordinator state between unit-test cases. */
export function resetGenerationAuthorizationsForTest(): void {
  validTokens.clear();
}
