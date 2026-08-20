/**
 * F3-CI-OPT-001 — deterministic, repository-owned changed-path classifier.
 *
 * Pure logic only (no filesystem/process I/O) so it is directly unit
 * testable; see cli.ts for the GitHub Actions-facing wrapper that reads the
 * changed-file list and writes $GITHUB_OUTPUT.
 *
 * Design contract (see docs/program/evidence/
 * F3-CI-OPT-001_RISK_BASED_PATH_AWARE_PR_CI.md for the full rationale):
 *   - Every changed file is classified into exactly one Category by the
 *     first matching rule in CATEGORY_RULES (most specific first).
 *   - A file that matches nothing becomes UNKNOWN.
 *   - DOCS_ONLY is a whole-PR aggregate: true only when every changed file
 *     is DOCS. Any single non-DOCS file (including UNKNOWN) makes it false.
 *   - Deep-gate execution flags are the union, across all changed files, of
 *     each matched category's flag set (see CATEGORY_GATES). CI_TOOLING and
 *     UNKNOWN both map to "run everything" — the required fail-safe
 *     fallback. An empty changed-file list (no detectable diff) is treated
 *     the same as UNKNOWN, never as docs-only.
 *   - Nothing here ever *removes* a flag another matched category set; the
 *     union is monotonic, so mixing a low-risk category with a high-risk
 *     one can only broaden the gate, never narrow it.
 */

export const CATEGORIES = [
  'DOCS',
  'FRONTEND',
  'BACKEND_GENERAL',
  'AUTH_SECURITY',
  'DATABASE_SCHEMA',
  'STORAGE_IMAGING',
  'ARCHITECTURE_BOUNDARY',
  'CI_TOOLING',
  'UNKNOWN',
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface DeepGateFlags {
  runBackendGeneral: boolean; // Layer 2: non-disposable-backend-tests
  runPostgres: boolean; // Layer 3: disposable-postgres-tests
  runStorage: boolean; // Layer 4: storage-integration-tests (Postgres + MinIO)
  runFrontendFullSuite: boolean; // Layer 5a: full-suite-compatibility-failsafe-frontend
  runLegacyBackend: boolean; // Layer 5b: full-suite-compatibility-failsafe-backend
}

const NO_FLAGS: DeepGateFlags = {
  runBackendGeneral: false,
  runPostgres: false,
  runStorage: false,
  runFrontendFullSuite: false,
  runLegacyBackend: false,
};

const FULL_DEEP_GATE: DeepGateFlags = {
  runBackendGeneral: true,
  runPostgres: true,
  runStorage: true,
  runFrontendFullSuite: true,
  runLegacyBackend: true,
};

// Per-category contribution to the deep-gate flag union. Layer 1 (frontend
// typecheck+build, server typecheck, tooling typecheck+unit, architecture
// guardrail, workflow/syntax lint) is NOT represented here: those five jobs
// always run for any non-docs-only PR regardless of category (they are
// cheap, ~15-55s each, run in parallel, and gating them per-category would
// require conditioning each other job's `needs:` on a job that may itself
// be skipped — a known GitHub Actions cascading-skip pitfall). Only Layers
// 2-5 (the expensive, minutes-long jobs) are path-conditional.
const CATEGORY_GATES: Record<Category, DeepGateFlags> = {
  DOCS: NO_FLAGS,
  FRONTEND: { ...NO_FLAGS, runFrontendFullSuite: true },
  BACKEND_GENERAL: { ...NO_FLAGS, runBackendGeneral: true },
  AUTH_SECURITY: {
    ...NO_FLAGS,
    runBackendGeneral: true,
    runPostgres: true,
    runLegacyBackend: true,
  },
  DATABASE_SCHEMA: {
    ...NO_FLAGS,
    runBackendGeneral: true,
    runPostgres: true,
    runStorage: true,
    runLegacyBackend: true,
  },
  STORAGE_IMAGING: {
    ...NO_FLAGS,
    runBackendGeneral: true,
    runPostgres: true,
    runStorage: true,
  },
  // scripts/architecture-guardrail/config/** only. The guardrail scan
  // itself is a Layer 1 job that already always runs; domain-map/scan-roots
  // config is guardrail-input-only and touches no application runtime path,
  // so no Layer 2-5 test is coupled to it.
  ARCHITECTURE_BOUNDARY: NO_FLAGS,
  // Workflow files, test-runtime/guardrail tooling, and package manifests
  // (including lockfiles) can change the behavior of every layer at once
  // and their blast radius cannot be determined from the path alone -
  // conservative full deep gate, same as UNKNOWN.
  CI_TOOLING: FULL_DEEP_GATE,
  UNKNOWN: FULL_DEEP_GATE,
};

interface CategoryRule {
  category: Category;
  test: (path: string) => boolean;
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function extname(path: string): string {
  const idx = path.lastIndexOf('.');
  return idx === -1 ? '' : path.slice(idx);
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

function underDir(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

const AUTH_UTIL_KEYWORDS = ['session', 'token', 'security', 'csrf', 'password', 'totp', 'auth'];
const STORAGE_TEST_KEYWORDS = ['imaging', 'filebackup'];

// Ordered most-specific -> most-general; the FIRST rule a file satisfies
// wins. Keep new rules ordered by specificity, not by category-list order.
const CATEGORY_RULES: CategoryRule[] = [
  // --- ARCHITECTURE_BOUNDARY (guardrail *config*, not guardrail code) ---
  {
    category: 'ARCHITECTURE_BOUNDARY',
    test: (p) => underDir(p, 'scripts/architecture-guardrail/config'),
  },

  // --- CI_TOOLING ---
  {
    category: 'CI_TOOLING',
    test: (p) =>
      underDir(p, '.github/workflows') ||
      underDir(p, 'scripts/test-runtime') ||
      underDir(p, 'scripts/architecture-guardrail') || // remaining guardrail code/tests, config already matched above
      underDir(p, 'scripts/ci-classify') ||
      // Operational shell scripts and their regression suites
      // (noramedi-deploy.sh, noramedi-frontend-deploy.sh, *.test.sh, ...).
      // These already reached the full deep gate via the UNKNOWN fall-through,
      // so this changes no job selection today. It is here so the mapping is a
      // stated rule with a test behind it rather than an accident of the
      // fall-through: the lane that runs `npm run test:shell` must stay
      // selected by the very files it tests.
      (underDir(p, 'scripts') && p.endsWith('.sh')) ||
      p === 'package.json' ||
      p === 'package-lock.json' ||
      p === 'server/package.json' ||
      p === 'server/package-lock.json',
  },

  // --- DATABASE_SCHEMA ---
  {
    category: 'DATABASE_SCHEMA',
    test: (p) =>
      p === 'server/prisma/schema.prisma' ||
      underDir(p, 'server/prisma/migrations') ||
      (underDir(p, 'server/prisma') && basename(p).toLowerCase().startsWith('seed')),
  },

  // --- AUTH_SECURITY ---
  {
    category: 'AUTH_SECURITY',
    test: (p) => {
      if (underDir(p, 'server/src/middleware')) return true;
      if (p === 'server/src/routes/auth.ts' || p === 'server/src/routes/platformAdmin.ts') return true;
      if (underDir(p, 'server/src/utils') || underDir(p, 'server/src/tests')) {
        const name = basename(p).toLowerCase();
        return AUTH_UTIL_KEYWORDS.some((kw) => name.includes(kw));
      }
      return false;
    },
  },

  // --- STORAGE_IMAGING (mirrors windows-bridge-pr.yml's own path filter) ---
  {
    category: 'STORAGE_IMAGING',
    test: (p) => {
      if (underDir(p, 'windows-bridge')) return true;
      if (underDir(p, 'server/src/services/imaging')) return true;
      if (underDir(p, 'src/components/imaging')) return true;
      if (p.startsWith('server/src/routes/imaging')) return true;
      const storageServiceFiles = [
        'server/src/services/fileStorage.ts',
        'server/src/services/fileBackupService.ts',
        'server/src/services/fileBackupDestination.ts',
        'server/src/services/backupService.ts',
        // F4-IMAGING-001-R6: imagingRemoteStorage.ts is the VPS2 imaging backend
        // itself. It sits directly under server/src/services (not under
        // server/src/services/imaging), so before this line a PR touching only
        // that file fell through to BACKEND_GENERAL and skipped the Postgres and
        // storage-integration layers that actually exercise it.
        'server/src/services/imagingRemoteStorage.ts',
      ];
      if (storageServiceFiles.includes(p)) return true;
      if (underDir(p, 'server/src/tests')) {
        const name = basename(p).toLowerCase();
        return STORAGE_TEST_KEYWORDS.some((kw) => name.includes(kw));
      }
      return false;
    },
  },

  // --- DOCS ---
  {
    category: 'DOCS',
    test: (p) => underDir(p, 'docs') || extname(p).toLowerCase() === '.md',
  },

  // --- FRONTEND ---
  {
    category: 'FRONTEND',
    test: (p) => {
      if (underDir(p, 'src')) return true;
      const frontendRootFiles = [
        'index.html',
        'vite.config.ts',
        'vite.config.d.ts',
        'tsconfig.json',
        'tsconfig.node.json',
        'tailwind.config.js',
        'postcss.config.js',
        'vitest.config.ts',
      ];
      return frontendRootFiles.includes(p);
    },
  },

  // --- BACKEND_GENERAL (anything else under server/src) ---
  {
    category: 'BACKEND_GENERAL',
    test: (p) => underDir(p, 'server/src'),
  },
];

export function classifyFile(rawPath: string): Category {
  const path = normalize(rawPath);
  for (const rule of CATEGORY_RULES) {
    if (rule.test(path)) return rule.category;
  }
  return 'UNKNOWN';
}

export interface ClassificationResult {
  files: string[];
  fileCategories: Record<string, Category>;
  categoriesPresent: Category[];
  docsOnly: boolean;
  flags: DeepGateFlags;
}

export function classify(rawFiles: string[]): ClassificationResult {
  const files = rawFiles.map(normalize).filter((f) => f.length > 0);

  if (files.length === 0) {
    // No detectable diff is never treated as docs-only; fail-safe to the
    // full deep gate (same posture as UNKNOWN).
    return {
      files: [],
      fileCategories: {},
      categoriesPresent: ['UNKNOWN'],
      docsOnly: false,
      flags: { ...FULL_DEEP_GATE },
    };
  }

  const fileCategories: Record<string, Category> = {};
  const presentSet = new Set<Category>();
  for (const file of files) {
    const category = classifyFile(file);
    fileCategories[file] = category;
    presentSet.add(category);
  }

  const categoriesPresent = CATEGORIES.filter((c) => presentSet.has(c));
  const docsOnly = presentSet.size === 1 && presentSet.has('DOCS');

  const flags: DeepGateFlags = { ...NO_FLAGS };
  for (const category of categoriesPresent) {
    const gate = CATEGORY_GATES[category];
    flags.runBackendGeneral ||= gate.runBackendGeneral;
    flags.runPostgres ||= gate.runPostgres;
    flags.runStorage ||= gate.runStorage;
    flags.runFrontendFullSuite ||= gate.runFrontendFullSuite;
    flags.runLegacyBackend ||= gate.runLegacyBackend;
  }

  return { files, fileCategories, categoriesPresent, docsOnly, flags };
}
