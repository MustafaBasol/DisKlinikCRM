// Fixture: caught error routed through boundedErrorType() before logging.
// Expected: zero findings.
function boundedErrorType(err: unknown): 'Error' | 'UnknownError' {
  return err instanceof Error ? 'Error' : 'UnknownError';
}
declare function doSomething(): void;

export function safeUsesBoundedErrorType() {
  try {
    doSomething();
  } catch (err) {
    console.error('operation failed', boundedErrorType(err));
  }
}
