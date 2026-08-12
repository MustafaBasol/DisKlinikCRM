// Fixture: error.stack logged directly via console.error.
// Expected: exactly one ERROR_DANGEROUS_PROPERTY finding.
declare function doSomething(): void;

export function unsafeErrorStack() {
  try {
    doSomething();
  } catch (error) {
    console.error('operation failed', error.stack);
  }
}
