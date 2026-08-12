// Fixture: error.message logged directly via console.error.
// Expected: exactly one ERROR_DANGEROUS_PROPERTY finding.
declare function doSomething(): void;

export function unsafeErrorMessage() {
  try {
    doSomething();
  } catch (error) {
    console.error('operation failed', error.message);
  }
}
