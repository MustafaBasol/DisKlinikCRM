/** Covers requirements 9 and 20: no absolute paths, Windows/POSIX normalization. */
import type { Harness } from './testHarness.js';
import { isLikelyAbsolutePath, toPosix, toRepoRelativePosix } from '../lib/normalization.js';
import { globMatch } from '../lib/globMatch.js';

export function registerNormalizationTests(h: Harness): void {
  h.section('normalization: Windows/POSIX path handling, no absolute paths');

  h.test('toPosix converts backslashes to forward slashes', () => {
    h.assertEqual(toPosix('server\\src\\routes\\foo.ts'), 'server/src/routes/foo.ts', 'backslash -> slash');
  });

  h.test('toPosix leaves already-POSIX paths untouched', () => {
    h.assertEqual(toPosix('server/src/routes/foo.ts'), 'server/src/routes/foo.ts', 'no-op on POSIX input');
  });

  h.test('toRepoRelativePosix strips a POSIX-style repo root', () => {
    const rel = toRepoRelativePosix('/repo', '/repo/server/src/routes/foo.ts');
    h.assertEqual(rel, 'server/src/routes/foo.ts', 'POSIX absolute -> repo-relative');
  });

  h.test('toRepoRelativePosix strips a Windows-style repo root and normalizes separators', () => {
    const rel = toRepoRelativePosix('E:\\repo', 'E:\\repo\\server\\src\\routes\\foo.ts');
    h.assertEqual(rel, 'server/src/routes/foo.ts', 'Windows absolute -> repo-relative POSIX');
  });

  h.test('toRepoRelativePosix refuses to emit a path outside the repository root', () => {
    h.assertThrows(
      () => toRepoRelativePosix('/repo', '/somewhere/else/foo.ts'),
      'a path escaping the repo root must throw, never be silently emitted',
    );
  });

  h.test('isLikelyAbsolutePath detects POSIX absolute paths', () => {
    h.assert(isLikelyAbsolutePath('/etc/passwd'), 'POSIX absolute path must be detected');
  });

  h.test('isLikelyAbsolutePath detects Windows drive-letter absolute paths', () => {
    h.assert(isLikelyAbsolutePath('E:\\Ek Gelir\\Siteler\\DisKlinikCRM-git\\foo.ts'), 'Windows backslash path');
    h.assert(isLikelyAbsolutePath('E:/Ek Gelir/Siteler/DisKlinikCRM-git/foo.ts'), 'Windows forward-slash path');
  });

  h.test('isLikelyAbsolutePath does not flag a repo-relative path', () => {
    h.assert(!isLikelyAbsolutePath('server/src/routes/foo.ts'), 'relative path must not be flagged');
  });

  h.test('globMatch handles ** across path segments (used by scan-roots excludePatterns)', () => {
    h.assert(globMatch('**/__tests__/**', 'server/src/routes/__tests__/foo.test.ts'), '** must match nested __tests__');
    h.assert(!globMatch('**/__tests__/**', 'server/src/routes/foo.ts'), 'non-matching path must not match');
  });

  h.test('globMatch handles brace alternation (used by baseline callerPathGlob entries)', () => {
    h.assert(
      globMatch('server/src/services/{a,b,c}.ts', 'server/src/services/b.ts'),
      'brace alternation must match one of its options',
    );
    h.assert(
      !globMatch('server/src/services/{a,b,c}.ts', 'server/src/services/d.ts'),
      'brace alternation must not match outside its options',
    );
  });
}
