/**
 * fatalErrorHandlers.ts — F3-OBS-001: process-level uncaughtException /
 * unhandledRejection handling.
 *
 * Before this, neither server/src/index.ts nor server/src/worker.ts
 * registered `process.on('uncaughtException' | 'unhandledRejection', ...)`
 * — an uncaught error crashed the process with Node's default handler
 * (bare stack trace on stderr, no structured log line, no correlation with
 * the rest of this codebase's pino-based logging). PM2 would restart the
 * process either way, but an operator grepping structured logs for an
 * incident would find nothing for the actual crash cause.
 *
 * `installFatalErrorHandlers` logs through the same redaction policy as
 * every other production error path in this codebase (`safeErrorLog`,
 * utils/logger.ts — production gets `error.name` + a fixed message, full
 * message/stack outside production), then exits. Per Node's own guidance,
 * a process must not keep handling requests after an uncaughtException —
 * its in-memory state is no longer trustworthy — so this always exits(1)
 * rather than trying to keep serving traffic; PM2 (ecosystem.config.cjs)
 * restarts it.
 *
 * `exit` and `onFatal` are injectable so tests can assert the safe-logging
 * and exit-code contract without a real process crashing the test runner.
 */

import type pino from 'pino';
import { safeErrorLog } from './logger.js';

export interface FatalErrorHandlerOptions {
  /** 'api' | 'worker' — surfaced in the log line so an operator can tell which process crashed. */
  processLabel: string;
  logger: pino.Logger;
  /** Defaults to process.exit; overridable so tests don't kill the test runner. */
  exit?: (code: number) => void;
}

export function handleFatalError(
  kind: 'uncaughtException' | 'unhandledRejection',
  err: unknown,
  options: FatalErrorHandlerOptions,
): void {
  const safeErr = safeErrorLog(err);
  options.logger.fatal(
    {
      processLabel: options.processLabel,
      kind,
      errType: safeErr.type,
      errMessage: safeErr.message,
      ...('stack' in safeErr ? { errStack: safeErr.stack } : {}),
    },
    `fatal: ${kind}`,
  );
  (options.exit ?? process.exit)(1);
}

/** Registers both process-level handlers. Call once per entrypoint (index.ts, worker.ts). */
export function installFatalErrorHandlers(options: FatalErrorHandlerOptions): void {
  process.on('uncaughtException', (err) => handleFatalError('uncaughtException', err, options));
  process.on('unhandledRejection', (reason) => handleFatalError('unhandledRejection', reason, options));
}
