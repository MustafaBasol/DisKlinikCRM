// Fixture: caught error routed through safeErrorFields() before logging.
// Expected: zero findings.
function safeErrorFields(err: unknown) {
  return { errorName: 'Error', errorCode: 'UNKNOWN' };
}
declare function doSomething(): void;

export function safeUsesSafeErrorFields() {
  try {
    doSomething();
  } catch (err) {
    console.error('operation failed', safeErrorFields(err));
  }
}
