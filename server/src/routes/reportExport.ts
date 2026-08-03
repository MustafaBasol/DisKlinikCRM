/**
 * reportExport.ts — US-07.3-P1 central synchronous report-export route.
 *
 * GET /api/reports/export/:reportKey?format=xlsx|pdf&locale=..&...filters
 *
 * The client may only supply an allow-listed `reportKey` (server/src/services
 * /reportExport/registry.ts) plus validated filter query params — never a
 * SQL/Prisma query, data-source name, column selector, formatter, or report
 * definition. Every other decision (roles, PII classification, columns, data
 * loading, filename, row cap) comes from the looked-up ReportDefinition.
 *
 * Authorization/tenant-isolation reuses the exact same primitives as the
 * source JSON report (validateAndGetClinicIdScope) and the exact same data
 * loader (definition.loadRows, which for the pilot report delegates to
 * services/reports/revenueByPeriodQuery.ts) — so the export can never grant
 * broader access or diverge in results from the on-screen report.
 *
 * mounted after `app.use('/api', authenticate)` in server/src/index.ts, same
 * as every other authenticated route — req.user is always populated here.
 */

import express, { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { validateAndGetClinicIdScope } from '../utils/clinicScope.js';
import { extractRequestMeta } from '../utils/auditLog.js';
import { getClinicOperatingPreferences } from '../services/clinicOperatingPreferences.js';
import { getReportDefinition } from '../services/reportExport/registry.js';
import { isRoleAllowedForReport } from '../services/reportExport/roleCheck.js';
import { recordReportExportAudit } from '../services/reportExport/auditDecision.js';
import { buildReportExportWorkbookBuffer } from '../services/reportExport/xlsxBuilder.js';
import { buildReportExportPdfBuffer } from '../services/reportExport/pdfBuilder.js';
import { buildReportExportFilename } from '../services/reportExport/filenameSafety.js';
import { EXPORT_METADATA_STRINGS } from '../services/reportExport/exportStrings.js';
import { resolveExportLocale, SUPPORTED_EXPORT_FORMATS, type ReportExportFormat } from '../services/reportExport/types.js';
import { exceedsSyncRowLimit } from '../services/reportExport/rowLimit.js';

const router = express.Router();

const CONTENT_TYPES: Record<ReportExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

router.get('/reports/export/:reportKey', async (req: AuthRequest, res: Response) => {
  const reportKey = String(req.params.reportKey);
  const definition = getReportDefinition(reportKey);
  if (!definition) {
    return res.status(400).json({ error: 'UNSUPPORTED_REPORT', message: `Unknown report key: ${reportKey}` });
  }

  const formatRaw = typeof req.query.format === 'string' ? req.query.format : 'xlsx';
  if (!SUPPORTED_EXPORT_FORMATS.includes(formatRaw as ReportExportFormat)) {
    return res.status(400).json({ error: 'UNSUPPORTED_FORMAT', message: `Unsupported export format: ${formatRaw}` });
  }
  const format = formatRaw as ReportExportFormat;

  if (!req.user) {
    return res.status(403).json({ error: 'UNAUTHORIZED_ROLE', message: 'Authentication required' });
  }
  const user = req.user;

  if (!isRoleAllowedForReport(user, definition.allowedRoles)) {
    return res.status(403).json({ error: 'UNAUTHORIZED_ROLE', message: 'Your role is not permitted to export this report' });
  }

  const parsed = definition.parseFilters(req.query as Record<string, unknown>);
  if (!parsed.ok || !parsed.filters) {
    return res.status(400).json({ error: 'INVALID_FILTERS', message: parsed.error ?? 'Invalid filters' });
  }
  const filters = parsed.filters;

  // Same clinic-scope validation as the source JSON report — a denied scope
  // gets the identical 403 body validateAndGetClinicIdScope already sends
  // for /reports/revenue itself (never a broader or differently-shaped grant).
  const selectedClinicId = typeof req.query.clinicId === 'string' ? req.query.clinicId : undefined;
  const scope = await validateAndGetClinicIdScope(user, selectedClinicId, res);
  if (scope === false) return;

  const locale = resolveExportLocale(req.query.locale);
  const generatedAt = new Date();
  const filterSummary = definition.filterSummary(filters);
  const auditBase = {
    definition,
    organizationId: user.organizationId,
    clinicId: user.clinicId,
    actorUserId: user.id,
    actorRole: user.role,
    format,
    filterSummary,
    ...extractRequestMeta(req),
  };

  let rows;
  try {
    // limit = maxSyncRows + 1: the loader never returns more than this many
    // rows, so a report with an unbounded result set never gets fully loaded
    // into memory just to discover it exceeds the synchronous cap.
    rows = await definition.loadRows({ scope, filters, limit: definition.maxSyncRows + 1 });
  } catch (err) {
    console.error(`Report export data load error (${definition.key}):`, err);
    await recordReportExportAudit({ ...auditBase, rowCount: 0, success: false });
    return res.status(500).json({ error: 'GENERATION_FAILED', message: 'Failed to generate report export' });
  }

  if (exceedsSyncRowLimit(rows.length, definition.maxSyncRows)) {
    await recordReportExportAudit({ ...auditBase, rowCount: rows.length, success: false });
    return res.status(413).json({
      error: 'ROW_LIMIT_EXCEEDED',
      message: `This report exceeds the ${definition.maxSyncRows}-row synchronous export limit for the selected filters. Narrow the date range or filters — asynchronous export for larger result sets is not yet available.`,
      maxRows: definition.maxSyncRows,
    });
  }

  if (rows.length === 0) {
    await recordReportExportAudit({ ...auditBase, rowCount: 0, success: true });
    return res.status(404).json({ error: 'NO_DATA', message: 'No data to export for the selected filters.' });
  }

  try {
    const operatingPreferences = await getClinicOperatingPreferences(
      selectedClinicId && selectedClinicId !== 'all' ? selectedClinicId : user.clinicId,
    );
    const strings = EXPORT_METADATA_STRINGS[locale];
    const title = definition.title[locale];

    const buffer =
      format === 'xlsx'
        ? await buildReportExportWorkbookBuffer({
            locale,
            title,
            columns: definition.columns,
            rows,
            toColumnValues: definition.toColumnValues,
            currency: operatingPreferences.currency,
            generatedAt,
            clinicDateFormat: operatingPreferences.dateFormat,
            filterSummary,
            strings,
          })
        : await buildReportExportPdfBuffer({
            locale,
            title,
            columns: definition.columns,
            rows,
            toColumnValues: definition.toColumnValues,
            currency: operatingPreferences.currency,
            generatedAt,
            filterSummary,
            strings,
          });

    const filename = buildReportExportFilename(definition.filenamePrefix, generatedAt, format);

    await recordReportExportAudit({ ...auditBase, rowCount: rows.length, success: true });

    res.setHeader('Content-Type', CONTENT_TYPES[format]);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  } catch (err) {
    console.error(`Report export generation error (${definition.key}):`, err);
    await recordReportExportAudit({ ...auditBase, rowCount: rows.length, success: false });
    res.status(500).json({ error: 'GENERATION_FAILED', message: 'Failed to generate report export' });
  }
});

export default router;
