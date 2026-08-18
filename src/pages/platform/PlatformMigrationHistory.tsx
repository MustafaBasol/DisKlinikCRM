import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, ChevronLeft, ChevronRight, Copy, Check, DatabaseZap, Plus, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlatformApi } from '../../context/PlatformAuthContext';
import {
  createMigrationApi,
  MIGRATION_RUN_STATUSES,
  type MigrationRunDto,
  type MigrationTargetOrganization,
} from '../../services/platformMigrationApi';
import { getApiErrorMessage, getErrorMessage } from '../../utils/errors';
import { formatByteSize, statusBadgeClass } from '../platformMigrationHelpers';

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const CopyableId: React.FC<{ id: string }> = ({ id }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={id}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(id).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => undefined);
      }}
      className="inline-flex items-center gap-1 font-mono text-xs text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400"
    >
      {id.slice(0, 8)}
      {copied ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
    </button>
  );
};

const PlatformMigrationHistory: React.FC = () => {
  const { t, i18n } = useTranslation(['platform']);
  const rawApi = usePlatformApi();
  const api = useMemo(() => createMigrationApi(rawApi), [rawApi]);
  const navigate = useNavigate();

  const [runs, setRuns] = useState<MigrationRunDto[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [organizations, setOrganizations] = useState<MigrationTargetOrganization[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [status, setStatus] = useState('');

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState('');

  useEffect(() => {
    api.listTargets().then((res) => setOrganizations(res.organizations)).catch(() => undefined);
  }, [api]);

  const fetchRuns = useCallback(() => {
    setLoading(true);
    setError('');
    api.listRuns({ page, limit: 25, organizationId: organizationId || undefined, status: status || undefined })
      .then((res) => {
        setRuns(res.data);
        setTotal(res.total);
        setPages(res.pages);
      })
      .catch((err) => setError(getErrorMessage(err, t('platform:migration.history.errors.loadFailed'))))
      .finally(() => setLoading(false));
  }, [api, page, organizationId, status, t]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  const localDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(i18n.language || 'tr') : '—');

  const handleRowClick = (run: MigrationRunDto) => {
    navigate('/platform/migration', { state: { runId: run.id } });
  };

  const handleDownload = async (e: React.MouseEvent, run: MigrationRunDto, kind: 'success' | 'failure') => {
    e.stopPropagation();
    setDownloadingId(`${run.id}-${kind}`);
    setDownloadError('');
    try {
      const blob = await api.downloadReport(run.id, kind);
      triggerBlobDownload(blob, `migration-${run.id}-${kind}.xlsx`);
    } catch (err) {
      setDownloadError(await getApiErrorMessage(err, t('platform:migration.history.errors.downloadFailed')));
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <DatabaseZap size={24} className="text-primary-500" />
          {t('platform:migration.history.title')}
        </h1>
        <button
          type="button"
          onClick={() => navigate('/platform/migration')}
          className="btn-primary text-sm"
        >
          <Plus size={14} />
          {t('platform:migration.newRun')}
        </button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <select
          value={organizationId}
          onChange={(e) => { setOrganizationId(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none"
        >
          <option value="">{t('platform:migration.history.allOrganizations')}</option>
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>{org.name}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none"
        >
          <option value="">{t('platform:filters.allStatuses')}</option>
          {MIGRATION_RUN_STATUSES.map((s) => (
            <option key={s} value={s}>{t(`platform:migration.statuses.${s}`)}</option>
          ))}
        </select>
      </div>

      {downloadError && (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
          <AlertCircle size={16} />
          <span className="text-sm">{downloadError}</span>
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 size={28} className="animate-spin text-primary-500" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-red-600 p-6">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">{t('platform:migration.history.columns.id')}</th>
                    <th className="px-4 py-3 text-left">{t('platform:migration.history.columns.organization')}</th>
                    <th className="px-4 py-3 text-left">{t('platform:migration.history.columns.clinic')}</th>
                    <th className="px-4 py-3 text-left">{t('platform:migration.history.columns.file')}</th>
                    <th className="px-4 py-3 text-left">{t('platform:migration.history.columns.initiator')}</th>
                    <th className="px-4 py-3 text-center">{t('platform:migration.history.columns.status')}</th>
                    <th className="px-4 py-3 text-right">{t('platform:migration.history.columns.rows')}</th>
                    <th className="px-4 py-3 text-right">{t('platform:migration.history.columns.batches')}</th>
                    <th className="px-4 py-3 text-left">{t('platform:migration.history.columns.created')}</th>
                    <th className="px-4 py-3 text-left">{t('platform:migration.history.columns.completed')}</th>
                    <th className="px-4 py-3 text-right">{t('platform:migration.history.columns.reports')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {runs.map((run) => (
                    <tr
                      key={run.id}
                      onClick={() => handleRowClick(run)}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3"><CopyableId id={run.id} /></td>
                      <td className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300">{run.organizationName ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-700 dark:text-gray-300">{run.clinicName ?? '—'}</td>
                      <td className="px-4 py-3">
                        <p className="text-xs font-mono text-gray-600 dark:text-gray-300 max-w-[160px] truncate" title={run.safeFileName ?? ''}>
                          {run.safeFileName ?? '—'}
                        </p>
                        <p className="text-[11px] text-gray-400">
                          {run.format ? run.format.toUpperCase() : '—'}{run.fileSizeBytes ? ` · ${formatByteSize(run.fileSizeBytes)}` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">{run.initiatedByEmail ?? '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={statusBadgeClass(run.status)}>{t(`platform:migration.statuses.${run.status}`)}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-gray-600 dark:text-gray-400">
                        <span className="text-green-600 dark:text-green-400">{run.createdRows ?? 0}</span>
                        {' / '}
                        <span className="text-blue-600 dark:text-blue-400">{run.matchedRows ?? 0}</span>
                        {' / '}
                        <span className="text-red-600 dark:text-red-400">{run.failedRows ?? 0}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-gray-600 dark:text-gray-400">{run.batchCount ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{localDate(run.createdAt)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{localDate(run.completedAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            title={t('platform:migration.results.downloadSuccess')}
                            disabled={downloadingId === `${run.id}-success`}
                            onClick={(e) => handleDownload(e, run, 'success')}
                            className="p-1.5 rounded border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
                          >
                            {downloadingId === `${run.id}-success` ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                          </button>
                          <button
                            type="button"
                            title={t('platform:migration.results.downloadFailure')}
                            disabled={downloadingId === `${run.id}-failure`}
                            onClick={(e) => handleDownload(e, run, 'failure')}
                            className="p-1.5 rounded border border-gray-200 dark:border-gray-700 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40"
                          >
                            {downloadingId === `${run.id}-failure` ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {runs.length === 0 && (
                    <tr>
                      <td colSpan={11} className="text-center text-gray-400 py-12">{t('platform:migration.history.empty')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {pages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-800 text-sm text-gray-500">
                <span>{t('platform:users.pageInfo', { total, page, pages })}</span>
                <div className="flex gap-2">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors">
                    <ChevronLeft size={16} />
                  </button>
                  <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors">
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default PlatformMigrationHistory;
