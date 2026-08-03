/**
 * reportExportApi.ts — US-07.3-P1 dedicated client for the central report-export
 * foundation (GET /api/reports/export/:reportKey).
 *
 * Deliberately NOT added to src/services/api.ts's reportService: this module
 * owns a single generic call usable by any future report's export button,
 * kept separate per the P1 task's parallel-development boundary so it never
 * collides with unrelated api.ts changes. It reuses api.ts's shared axios
 * instance (auth cookie/CSRF handling) rather than duplicating it.
 */

import api from './api';
import { getApiErrorMessage } from '../utils/errors';

export type ReportExportFormat = 'xlsx' | 'pdf';

export type ReportExportFilters = Record<string, string | undefined>;

export interface ReportExportResult {
  blob: Blob;
  filename: string;
}

/** Stable error codes the export route returns — see server/src/routes/reportExport.ts. */
export type ReportExportErrorCode =
  | 'UNSUPPORTED_REPORT'
  | 'UNSUPPORTED_FORMAT'
  | 'INVALID_FILTERS'
  | 'UNAUTHORIZED_ROLE'
  | 'INACCESSIBLE_CLINIC'
  | 'ROW_LIMIT_EXCEEDED'
  | 'NO_DATA'
  | 'GENERATION_FAILED';

export interface ReportExportErrorInfo {
  /** Known stable code for i18n mapping, or null when the failure is unclassified (network error, etc.). */
  code: ReportExportErrorCode | null;
  /** Human-readable fallback (server message, or a generic fallback) — always a safe string. */
  message: string;
}

function parseFilenameFromContentDisposition(headerValue: unknown, fallback: string): string {
  if (typeof headerValue !== 'string') return fallback;
  const quoted = /filename="([^"]+)"/.exec(headerValue);
  if (quoted) return quoted[1];
  const bare = /filename=([^;]+)/.exec(headerValue);
  return bare ? bare[1].trim() : fallback;
}

async function readBlobAsJson(blob: Blob): Promise<Record<string, unknown> | null> {
  try {
    const text = typeof blob.text === 'function'
      ? await blob.text()
      : await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ''));
          reader.onerror = () => reject(reader.error);
          reader.readAsText(blob);
        });
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Downloads a validated, server-regenerated export — the server re-runs the
 * report's own authorized data loader with these filters; nothing about the
 * export's row set comes from unvalidated client/browser state.
 */
export async function downloadReportExport(
  reportKey: string,
  format: ReportExportFormat,
  filters: ReportExportFilters,
  locale: string,
): Promise<ReportExportResult> {
  const params: Record<string, string> = { format, locale };
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params[key] = value;
  }

  const response = await api.get(`/reports/export/${encodeURIComponent(reportKey)}`, {
    params,
    responseType: 'blob',
  });

  const blob = response.data as Blob;
  const filename = parseFilenameFromContentDisposition(
    response.headers?.['content-disposition'],
    `${reportKey}.${format}`,
  );
  return { blob, filename };
}

/**
 * Like utils/errors.ts's getApiErrorMessage, but also extracts the stable
 * `error` code from a `responseType: 'blob'` error body so the caller can map
 * it to a localized message (UNSUPPORTED_REPORT/ROW_LIMIT_EXCEEDED/NO_DATA/...)
 * instead of displaying the server's English-only debug text.
 */
export async function getReportExportError(err: unknown, fallbackMessage: string): Promise<ReportExportErrorInfo> {
  const data = (err as { response?: { data?: unknown } } | undefined)?.response?.data;
  let parsed: Record<string, unknown> | null = null;

  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    parsed = await readBlobAsJson(data);
  } else if (data && typeof data === 'object') {
    parsed = data as Record<string, unknown>;
  }

  const code = typeof parsed?.error === 'string' ? (parsed.error as ReportExportErrorCode) : null;
  const message = await getApiErrorMessage(err, fallbackMessage);
  return { code, message };
}
