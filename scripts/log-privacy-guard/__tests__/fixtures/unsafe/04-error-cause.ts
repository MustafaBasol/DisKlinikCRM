// Fixture: error.cause logged directly via console.warn.
// Expected: exactly one ERROR_DANGEROUS_PROPERTY finding.
declare function doSomething(): void;

export function unsafeErrorCause() {
  try {
    doSomething();
  } catch (err) {
    console.warn('operation degraded', err.cause);
  }
}
