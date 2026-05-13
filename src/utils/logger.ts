import { safeLocalStorage } from './localStorageSafe';

type ConsoleLike = Pick<Console, 'log' | 'info' | 'warn' | 'error' | 'debug'>;

const noop = () => {};

const resolveConsole = (): ConsoleLike => {
  if (typeof globalThis !== 'undefined' && globalThis.console) return globalThis.console;
  return { log: noop, info: noop, warn: noop, error: noop, debug: noop };
};

const consoleLike = resolveConsole();

const getDebugFlag = (): boolean => {
  if (!import.meta.env.DEV) return false;
  return safeLocalStorage.getItem('debug') === '1';
};

export const logger = {
  debug: (...args: unknown[]) => { if (getDebugFlag()) consoleLike.log?.(...args); },
  info:  (...args: unknown[]) => { if (getDebugFlag()) consoleLike.info?.(...args); },
  warn:  (...args: unknown[]) => { consoleLike.warn?.(...args); },
  error: (...args: unknown[]) => { consoleLike.error?.(...args); },
};

export type Logger = typeof logger;
