/**
 * testHarness.ts — server/src/tests/*.test.ts ile aynı hafif test tarzı
 * (node:assert/strict üzerine test()/section(), harici çerçeve yok).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export let passed = 0;
export let failed = 0;

export function resetCounts(): void {
  passed = 0;
  failed = 0;
}

export function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

export function section(title: string): void {
  console.log(`\n${title}`);
}

export function summarizeAndExit(): void {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

export function src(relPath: string, fromDir: string): string {
  return fs.readFileSync(path.join(fromDir, relPath), 'utf8');
}

/** Her test için izole bir scratch dizini; test sonunda silinir. */
export function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `bridge-agent-${prefix}-`));
}

export function cleanupTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
