/**
 * filenameSafety.ts — sanitized export filename builder (US-07.3-P1).
 *
 * Mirrors treatmentProposalPdf.ts's buildProposalPdfFilename: derived only
 * from a server-controlled prefix (the report definition's `filenamePrefix`,
 * never a raw client value) and the generation timestamp — never from a
 * free-text field — so a hostile filter/label value can never influence the
 * Content-Disposition header the browser receives.
 */

import type { ReportExportFormat } from './types.js';

export function buildReportExportFilename(
  filenamePrefix: string,
  generatedAt: Date,
  format: ReportExportFormat,
): string {
  const safePrefix = filenamePrefix.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 60) || 'report';
  const yyyy = generatedAt.getUTCFullYear();
  const mm = String(generatedAt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(generatedAt.getUTCDate()).padStart(2, '0');
  const hh = String(generatedAt.getUTCHours()).padStart(2, '0');
  const min = String(generatedAt.getUTCMinutes()).padStart(2, '0');
  return `${safePrefix}-${yyyy}${mm}${dd}-${hh}${min}.${format}`;
}
