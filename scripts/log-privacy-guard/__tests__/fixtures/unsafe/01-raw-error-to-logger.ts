// Fixture: raw caught Error spread/shorthand directly into a pino `logger.*`
// call. Expected: exactly one RAW_ERROR_OBJECT finding.
import { logger } from '../../../../../server/src/utils/logger.js';

declare function doSomething(): void;

export function unsafeRawErrorToLogger() {
  try {
    doSomething();
  } catch (err) {
    logger.error({ err }, 'operation failed');
  }
}
