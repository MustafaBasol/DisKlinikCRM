import React, { useState } from 'react';
import { Download, Loader2, AlertCircle, FileSpreadsheet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MigrationApiClient } from '../../../services/platformMigrationApi';
import { getApiErrorMessage } from '../../../utils/errors';

/**
 * "İçe Aktarılamayan Kayıtları İndir" — F3-DATA-MIG-TODAY-001-R12.
 *
 * Shared by the Dry-run step and the Results step, because the operator needs
 * exactly the same thing at both moments and two copies of a download button
 * would eventually offer two different files.
 *
 * WHY THE FILE IS FETCHED THROUGH THE API CLIENT AND NOT `window.open`. This
 * download carries real patient values (deliberately — you cannot correct a row
 * you cannot see). Opening a URL in a new tab would take the request out of the
 * axios instance that carries the Platform Admin session and CSRF handling, and
 * would leave the run id sitting in browser history and in any URL-logging
 * proxy between here and the server. The blob is fetched authenticated,
 * released immediately after the click, and never becomes a shareable link.
 */
export const MigrationRejectedDownload: React.FC<{
  runId: string;
  api: MigrationApiClient;
  /** Rows the caller believes are rejected. Only used for the label. */
  rejectedRowCount?: number;
  className?: string;
}> = ({ runId, api, rejectedRowCount, className }) => {
  const { t } = useTranslation(['platform']);
  const [busy, setBusy] = useState<'xlsx' | 'csv' | null>(null);
  const [error, setError] = useState('');

  const download = async (format: 'xlsx' | 'csv') => {
    setBusy(format);
    setError('');
    try {
      const { blob, filename } = await api.downloadRejectedRows(runId, format);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Revoked in the same turn: the object URL is a live handle to patient
      // data held in this tab, and it must not outlive the click that used it.
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(await getApiErrorMessage(err, t('platform:migration.rejected.errors.downloadFailed')));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={className}>
      <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10 p-4">
        <div className="flex items-start gap-2">
          <FileSpreadsheet size={16} className="shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              {typeof rejectedRowCount === 'number'
                ? t('platform:migration.rejected.titleWithCount', { n: rejectedRowCount })
                : t('platform:migration.rejected.title')}
            </p>
            <p className="text-xs text-amber-800/90 dark:text-amber-300/90 mt-1">
              {t('platform:migration.rejected.help')}
            </p>
            <ol className="text-xs text-amber-800/90 dark:text-amber-300/90 mt-2 list-decimal ml-4 space-y-0.5">
              <li>{t('platform:migration.rejected.step1')}</li>
              <li>{t('platform:migration.rejected.step2')}</li>
              <li>{t('platform:migration.rejected.step3')}</li>
            </ol>
            <div className="flex gap-2 mt-3 flex-wrap">
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={busy !== null}
                onClick={() => download('xlsx')}
              >
                {busy === 'xlsx' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                {t('platform:migration.rejected.downloadXlsx')}
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={busy !== null}
                onClick={() => download('csv')}
              >
                {busy === 'csv' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                {t('platform:migration.rejected.downloadCsv')}
              </button>
            </div>
            <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 mt-2">
              {t('platform:migration.rejected.privacyNote')}
            </p>
          </div>
        </div>
      </div>
      {error && (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-2.5 mt-2 text-sm">
          <AlertCircle size={14} />
          {error}
        </div>
      )}
    </div>
  );
};

export default MigrationRejectedDownload;
