/**
 * Minimal ambient typing for the `archiver` package — no bundled/@types
 * package is available for the pinned version, and this project only uses
 * a small subset of the API (append + finalize + event handlers) to build
 * PatientPrivacyExportArchive ZIP packages (docs/compliance/53).
 */
declare module 'archiver' {
  import { Readable } from 'stream';

  interface ArchiverInstance extends NodeJS.ReadableStream {
    append(source: Buffer | Readable | string, options: { name: string }): ArchiverInstance;
    finalize(): Promise<void>;
    pointer(): number;
    on(event: 'error' | 'warning', listener: (err: Error) => void): ArchiverInstance;
    on(event: string, listener: (...args: any[]) => void): ArchiverInstance;
    pipe<T extends NodeJS.WritableStream>(destination: T): T;
  }

  function archiver(format: 'zip', options?: Record<string, unknown>): ArchiverInstance;
  export = archiver;
}
