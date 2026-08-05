/**
 * F2-GUARDRAIL-IMPL-001 — tiny hand-rolled test harness, matching the
 * existing repository convention in scripts/test-runtime/__tests__/
 * orchestratorUnit.test.ts (no new test-framework dependency).
 */
export interface Harness {
  section(name: string): void;
  test(name: string, fn: () => void): void;
  testAsync(name: string, fn: () => Promise<void>): Promise<void>;
  assert(cond: unknown, msg: string): asserts cond;
  assertEqual<T>(actual: T, expected: T, msg: string): void;
  assertDeepEqual(actual: unknown, expected: unknown, msg: string): void;
  assertThrows(fn: () => void, msg: string): void;
  summary(): { passed: number; failed: number };
}

export function createHarness(label: string): Harness {
  let passed = 0;
  let failed = 0;

  function section(name: string): void {
    console.log(`\n[${label}] ${name}`);
  }

  function test(name: string, fn: () => void): void {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      failed++;
    }
  }

  async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      failed++;
    }
  }

  function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
  }

  function assertEqual<T>(actual: T, expected: T, msg: string): void {
    if (actual !== expected) {
      throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }

  function assertDeepEqual(actual: unknown, expected: unknown, msg: string): void {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
      throw new Error(`${msg}: expected ${e}, got ${a}`);
    }
  }

  function assertThrows(fn: () => void, msg: string): void {
    let threw = false;
    try {
      fn();
    } catch {
      threw = true;
    }
    if (!threw) throw new Error(`${msg}: expected to throw`);
  }

  return {
    section,
    test,
    testAsync,
    assert,
    assertEqual,
    assertDeepEqual,
    assertThrows,
    summary: () => ({ passed, failed }),
  };
}
