import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileText, Printer, Loader2, AlertCircle } from 'lucide-react';
import { downloadReportExport, getReportExportError, type ReportExportFilters } from '../../services/reportExportApi';

const SUPPORTED_LOCALES = ['tr', 'en', 'fr', 'de'] as const;

function toExportLocale(language: string | undefined): 'tr' | 'en' | 'fr' | 'de' {
  const short = (language ?? 'en').slice(0, 2);
  return (SUPPORTED_LOCALES as readonly string[]).includes(short) ? (short as 'tr' | 'en' | 'fr' | 'de') : 'en';
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}

export interface ReportExportControlsProps {
  /** Server-owned, allow-listed report key (server/src/services/reportExport/registry.ts). */
  reportKey: string;
  /**
   * The report's currently active, already-validated filters (date range,
   * groupBy, clinicId, etc). The server re-validates and re-resolves these
   * itself — this is a convenience mirror of state already on screen, never
   * treated as authoritative by the server.
   */
  filters: ReportExportFilters;
  /** True when there is no report data currently loaded (nothing to export/print yet). */
  disabled?: boolean;
  /** Enables the "Export to PDF" button in addition to Excel. */
  enablePdf?: boolean;
  /** Class applied to the printable DOM region; only it (and its children) remain visible on print. */
  printTargetClassName?: string;
}

const ReportExportControls: React.FC<ReportExportControlsProps> = ({
  reportKey,
  filters,
  disabled = false,
  enablePdf = false,
  printTargetClassName = 'report-export-print-target',
}) => {
  const { t, i18n } = useTranslation('reports');
  const [pendingFormat, setPendingFormat] = useState<'xlsx' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loading = pendingFormat !== null;

  const handleExport = async (format: 'xlsx' | 'pdf') => {
    if (loading || disabled) return;
    setError(null);
    setPendingFormat(format);
    try {
      const locale = toExportLocale(i18n.language);
      const { blob, filename } = await downloadReportExport(reportKey, format, filters, locale);
      triggerBlobDownload(blob, filename);
    } catch (err) {
      const { code, message } = await getReportExportError(err, t('exportControls.errors.generic'));
      const localized = code ? t(`exportControls.errors.${code}`, { defaultValue: message }) : message;
      setError(localized);
    } finally {
      setPendingFormat(null);
    }
  };

  const handlePrint = () => {
    if (disabled) return;
    window.print();
  };

  return (
    <div className="flex flex-col gap-2 no-print">
      {/* Print styles: only printTargetClassName (and its descendants) stay visible —
          hides navigation/sidebar/dashboard chrome regardless of DOM nesting depth,
          same visibility-trick convention as ReceiptModal.tsx. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .${printTargetClassName}, .${printTargetClassName} * { visibility: visible !important; }
          .${printTargetClassName} {
            position: absolute !important;
            top: 0 !important; left: 0 !important;
            width: 100% !important;
          }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => handleExport('xlsx')}
          disabled={disabled || loading}
          className="btn-secondary flex items-center gap-2 shrink-0"
        >
          {pendingFormat === 'xlsx' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          {pendingFormat === 'xlsx' ? t('exportControls.preparing') : t('exportControls.exportExcel')}
        </button>

        {enablePdf && (
          <button
            type="button"
            onClick={() => handleExport('pdf')}
            disabled={disabled || loading}
            className="btn-secondary flex items-center gap-2 shrink-0"
          >
            {pendingFormat === 'pdf' ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
            {pendingFormat === 'pdf' ? t('exportControls.preparing') : t('exportControls.exportPdf')}
          </button>
        )}

        <button
          type="button"
          onClick={handlePrint}
          disabled={disabled}
          className="btn-secondary flex items-center gap-2 shrink-0"
        >
          <Printer size={16} />
          {t('exportControls.print')}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg p-3">
          <AlertCircle size={16} /> {error}
        </div>
      )}
    </div>
  );
};

export default ReportExportControls;
