import React, { useEffect, useState, useCallback } from 'react';
import {
  ShieldAlert,
  RefreshCw,
  Loader2,
  AlertCircle,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlatformApi } from '../../context/PlatformAuthContext';

// ── Types ─────────────────────────────────────────────────────────────────────

type IncidentStatus = 'open' | 'acknowledged' | 'investigating' | 'contained' | 'resolved' | 'closed' | 'false_positive';
type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

interface SecurityIncidentDTO {
  id: string;
  incidentKey: string;
  organizationId: string | null;
  clinicId: string | null;
  category: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  summary: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  occurrenceCount: number;
  sourceType: string;
  sourceRule: string;
  affectedResourceType: string | null;
  affectedResourceId: string | null;
  assignedToPlatformAdminId: string | null;
  containmentSummary: string | null;
  resolutionSummary: string | null;
  legalReviewRequired: boolean;
  legalReviewStatus: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface ActivityEntry {
  id: string;
  action: string;
  previousStatus: string | null;
  newStatus: string | null;
  actorPlatformAdminId: string | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface SummaryDTO {
  openCritical: number;
  openHigh: number;
  unacknowledged: number;
  investigating: number;
  last24h: number;
}

const SEVERITY_COLORS: Record<IncidentSeverity, string> = {
  low: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const STATUS_COLORS: Record<IncidentStatus, string> = {
  open: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  acknowledged: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  investigating: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  contained: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  resolved: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  closed: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  false_positive: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500',
};

const PAGE_LIMIT = 25;

// ── Small components ──────────────────────────────────────────────────────────

const Badge: React.FC<{ className: string; children: React.ReactNode }> = ({ className, children }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}>{children}</span>
);

// ── Component ─────────────────────────────────────────────────────────────────

const PlatformSecurityIncidents: React.FC = () => {
  const { t, i18n } = useTranslation(['securityIncidents']);
  const api = usePlatformApi();

  const [summary, setSummary] = useState<SummaryDTO | null>(null);

  const [filters, setFilters] = useState({
    status: '',
    severity: '',
    category: '',
    organizationId: '',
    clinicId: '',
    assignedTo: '',
    from: '',
    to: '',
  });
  const [page, setPage] = useState(1);

  const [incidents, setIncidents] = useState<SecurityIncidentDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<SecurityIncidentDTO | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState('');
  const [pendingActionForm, setPendingActionForm] = useState<null | 'contain' | 'resolve' | 'falsePositive' | 'reopen' | 'note'>(null);
  const [formText, setFormText] = useState('');
  const [assigneeInput, setAssigneeInput] = useState('');

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  const fetchSummary = useCallback(() => {
    api.get('/platform/security/summary').then((res) => setSummary(res.data)).catch(() => {});
  }, [api]);

  const fetchList = useCallback(() => {
    setListLoading(true);
    setListError('');
    const params: Record<string, string> = { page: String(page), limit: String(PAGE_LIMIT) };
    for (const [key, value] of Object.entries(filters)) {
      if (value) params[key] = value;
    }
    api
      .get('/platform/security/incidents', { params })
      .then((res) => {
        setIncidents(res.data.data ?? []);
        setTotal(res.data.total ?? 0);
      })
      .catch(() => setListError(t('list.error')))
      .finally(() => setListLoading(false));
  }, [api, filters, page, t]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchList(); }, [fetchList]);

  const fetchDetail = useCallback((id: string) => {
    setDetailLoading(true);
    Promise.all([
      api.get(`/platform/security/incidents/${id}`),
      api.get(`/platform/security/incidents/${id}/activity`),
    ])
      .then(([incidentRes, activityRes]) => {
        setSelectedIncident(incidentRes.data);
        setActivity(activityRes.data.data ?? []);
      })
      .catch(() => setActionError(t('list.error')))
      .finally(() => setDetailLoading(false));
  }, [api, t]);

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  const closeDetail = () => {
    setSelectedId(null);
    setSelectedIncident(null);
    setActivity([]);
    setPendingActionForm(null);
    setFormText('');
    setActionError('');
  };

  const applyFilters = (patch: Partial<typeof filters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilters({ status: '', severity: '', category: '', organizationId: '', clinicId: '', assignedTo: '', from: '', to: '' });
    setPage(1);
  };

  const runAction = async (path: string, body: Record<string, unknown> = {}) => {
    if (!selectedId) return;
    setActionPending(true);
    setActionError('');
    try {
      await api.post(`/platform/security/incidents/${selectedId}/${path}`, body);
      await fetchDetail(selectedId);
      fetchList();
      fetchSummary();
      setPendingActionForm(null);
      setFormText('');
    } catch (err: any) {
      setActionError(err.response?.data?.error ?? t('actions.error'));
    } finally {
      setActionPending(false);
    }
  };

  const submitForm = () => {
    if (!pendingActionForm) return;
    const trimmed = formText.trim();
    if (!trimmed) {
      setActionError(t('actions.reasonRequired'));
      return;
    }
    const bodyKey =
      pendingActionForm === 'contain' ? 'containmentSummary' :
      pendingActionForm === 'resolve' ? 'resolutionSummary' :
      'note';
    const action =
      pendingActionForm === 'contain' ? 'contain' :
      pendingActionForm === 'resolve' ? 'resolve' :
      pendingActionForm === 'falsePositive' ? 'false-positive' :
      pendingActionForm === 'reopen' ? 'reopen' :
      'notes';
    runAction(action, { [bodyKey]: trimmed });
  };

  const dt = (iso: string) => new Date(iso).toLocaleString(i18n.language || 'tr');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <ShieldAlert size={24} className="text-red-500" />
          {t('title')}
        </h1>
        <button
          onClick={() => { fetchList(); fetchSummary(); }}
          disabled={listLoading}
          className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
        >
          {listLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      {/* Legal disclaimer — always visible */}
      <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300">
        <AlertCircle size={14} className="mt-0.5 shrink-0" />
        <span>{t('legalDisclaimer')}</span>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {([
            ['openCritical', summary.openCritical, 'text-red-600 dark:text-red-400'],
            ['openHigh', summary.openHigh, 'text-orange-600 dark:text-orange-400'],
            ['unacknowledged', summary.unacknowledged, 'text-blue-600 dark:text-blue-400'],
            ['investigating', summary.investigating, 'text-purple-600 dark:text-purple-400'],
            ['last24h', summary.last24h, 'text-gray-700 dark:text-gray-300'],
          ] as const).map(([key, value, colorClass]) => (
            <div key={key} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t(`summary.${key}`)}</p>
              <p className={`text-2xl font-bold ${colorClass}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">{t('filters.status')}</label>
          <select
            value={filters.status}
            onChange={(e) => applyFilters({ status: e.target.value })}
            className="text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-lg px-2 py-1.5"
          >
            <option value="">{t('filters.all')}</option>
            {(['open', 'acknowledged', 'investigating', 'contained', 'resolved', 'closed', 'false_positive'] as const).map((s) => (
              <option key={s} value={s}>{t(`status.${s}`)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">{t('filters.severity')}</label>
          <select
            value={filters.severity}
            onChange={(e) => applyFilters({ severity: e.target.value })}
            className="text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-lg px-2 py-1.5"
          >
            <option value="">{t('filters.all')}</option>
            {(['low', 'medium', 'high', 'critical'] as const).map((s) => (
              <option key={s} value={s}>{t(`severity.${s}`)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">{t('filters.organizationId')}</label>
          <input
            value={filters.organizationId}
            onChange={(e) => applyFilters({ organizationId: e.target.value })}
            className="text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-lg px-2 py-1.5 w-40"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">{t('filters.clinicId')}</label>
          <input
            value={filters.clinicId}
            onChange={(e) => applyFilters({ clinicId: e.target.value })}
            className="text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-lg px-2 py-1.5 w-40"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">{t('filters.assignedTo')}</label>
          <input
            value={filters.assignedTo}
            onChange={(e) => applyFilters({ assignedTo: e.target.value })}
            className="text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-lg px-2 py-1.5 w-40"
          />
        </div>
        <button
          onClick={clearFilters}
          className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 px-3 py-1.5"
        >
          {t('filters.clear')}
        </button>
      </div>

      {/* List */}
      {listLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={28} className="animate-spin text-blue-500" />
        </div>
      ) : listError ? (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl p-4">
          <AlertCircle size={18} />
          <span>{listError}</span>
        </div>
      ) : incidents.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-10 text-center text-gray-500 text-sm">
          {t('list.empty')}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase text-gray-400 border-b border-gray-100 dark:border-gray-800">
                <th className="text-left px-4 py-3">{t('table.severity')}</th>
                <th className="text-left px-4 py-3">{t('table.status')}</th>
                <th className="text-left px-4 py-3">{t('table.title')}</th>
                <th className="text-left px-4 py-3">{t('table.category')}</th>
                <th className="text-left px-4 py-3">{t('table.lastDetected')}</th>
                <th className="text-right px-4 py-3">{t('table.occurrences')}</th>
                <th className="text-left px-4 py-3">{t('table.assignee')}</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((incident) => (
                <tr
                  key={incident.id}
                  onClick={() => setSelectedId(incident.id)}
                  className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3"><Badge className={SEVERITY_COLORS[incident.severity]}>{t(`severity.${incident.severity}`)}</Badge></td>
                  <td className="px-4 py-3"><Badge className={STATUS_COLORS[incident.status]}>{t(`status.${incident.status}`)}</Badge></td>
                  <td className="px-4 py-3 text-gray-800 dark:text-gray-200 max-w-xs truncate">{incident.title}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{t(`category.${incident.category}`, incident.category)}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{dt(incident.lastDetectedAt)}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">{incident.occurrenceCount}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                    {incident.assignedToPlatformAdminId ?? t('table.unassigned')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800 text-sm text-gray-500">
            <span>{t('list.pageInfo', { page, totalPages, total })}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-40"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1.5 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-40"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {selectedId && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={closeDetail}>
          <div
            className="w-full max-w-xl h-full bg-white dark:bg-gray-900 shadow-2xl overflow-y-auto p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('detail.title')}</h2>
              <button onClick={closeDetail} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                <X size={20} />
              </button>
            </div>

            <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{t('legalDisclaimer')}</span>
            </div>

            {detailLoading && !selectedIncident ? (
              <div className="flex items-center justify-center h-32"><Loader2 size={24} className="animate-spin text-blue-500" /></div>
            ) : selectedIncident ? (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={SEVERITY_COLORS[selectedIncident.severity]}>{t(`severity.${selectedIncident.severity}`)}</Badge>
                  <Badge className={STATUS_COLORS[selectedIncident.status]}>{t(`status.${selectedIncident.status}`)}</Badge>
                  <span className="text-xs text-gray-500">{t(`category.${selectedIncident.category}`, selectedIncident.category)}</span>
                </div>

                <h3 className="text-base font-semibold text-gray-900 dark:text-white">{selectedIncident.title}</h3>

                <div>
                  <p className="text-xs text-gray-500 mb-1">{t('detail.summary')}</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{selectedIncident.summary}</p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs text-gray-500">{t('table.firstDetected')}</p><p>{dt(selectedIncident.firstDetectedAt)}</p></div>
                  <div><p className="text-xs text-gray-500">{t('table.lastDetected')}</p><p>{dt(selectedIncident.lastDetectedAt)}</p></div>
                  <div><p className="text-xs text-gray-500">{t('detail.occurrenceCount')}</p><p>{selectedIncident.occurrenceCount}</p></div>
                  <div><p className="text-xs text-gray-500">{t('detail.sourceRule')}</p><p className="font-mono text-xs">{selectedIncident.sourceRule}</p></div>
                  {selectedIncident.affectedResourceType && (
                    <div className="col-span-2">
                      <p className="text-xs text-gray-500">{t('detail.affectedResource')}</p>
                      <p className="font-mono text-xs break-all">{selectedIncident.affectedResourceType}: {selectedIncident.affectedResourceId}</p>
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-xs text-gray-500 mb-1">{t('detail.legalReview')}</p>
                  <p className="text-sm">
                    {selectedIncident.legalReviewRequired ? t('detail.legalReviewRequired') : ''}{' '}
                    — {t(`detail.legalReviewStatus.${selectedIncident.legalReviewStatus}`, selectedIncident.legalReviewStatus)}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500 mb-1">{t('detail.metadata')}</p>
                  {selectedIncident.metadata && Object.keys(selectedIncident.metadata).length > 0 ? (
                    <pre className="text-xs bg-gray-50 dark:bg-gray-800 rounded-lg p-3 overflow-x-auto">
                      {JSON.stringify(selectedIncident.metadata, null, 2)}
                    </pre>
                  ) : (
                    <p className="text-xs text-gray-400">{t('detail.noMetadata')}</p>
                  )}
                </div>

                {selectedIncident.containmentSummary && (
                  <div><p className="text-xs text-gray-500 mb-1">{t('actions.containmentSummary')}</p><p className="text-sm">{selectedIncident.containmentSummary}</p></div>
                )}
                {selectedIncident.resolutionSummary && (
                  <div><p className="text-xs text-gray-500 mb-1">{t('actions.resolutionSummary')}</p><p className="text-sm">{selectedIncident.resolutionSummary}</p></div>
                )}

                {actionError && (
                  <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-sm">
                    <AlertCircle size={14} /><span>{actionError}</span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  {selectedIncident.status === 'open' && (
                    <button disabled={actionPending} onClick={() => runAction('acknowledge')} className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50">{t('actions.acknowledge')}</button>
                  )}
                  {['open', 'acknowledged', 'contained', 'resolved'].includes(selectedIncident.status) && (
                    <button disabled={actionPending} onClick={() => runAction('investigate')} className="px-3 py-1.5 text-sm rounded-lg bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50">{t('actions.investigate')}</button>
                  )}
                  {['acknowledged', 'investigating'].includes(selectedIncident.status) && (
                    <button disabled={actionPending} onClick={() => setPendingActionForm('contain')} className="px-3 py-1.5 text-sm rounded-lg bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50">{t('actions.contain')}</button>
                  )}
                  {['investigating', 'contained'].includes(selectedIncident.status) && (
                    <button disabled={actionPending} onClick={() => setPendingActionForm('resolve')} className="px-3 py-1.5 text-sm rounded-lg bg-green-600 hover:bg-green-700 text-white disabled:opacity-50">{t('actions.resolve')}</button>
                  )}
                  {selectedIncident.status === 'resolved' && (
                    <button disabled={actionPending} onClick={() => runAction('close')} className="px-3 py-1.5 text-sm rounded-lg bg-gray-600 hover:bg-gray-700 text-white disabled:opacity-50">{t('actions.close')}</button>
                  )}
                  {['open', 'acknowledged', 'investigating'].includes(selectedIncident.status) && (
                    <button disabled={actionPending} onClick={() => setPendingActionForm('falsePositive')} className="px-3 py-1.5 text-sm rounded-lg bg-gray-400 hover:bg-gray-500 text-white disabled:opacity-50">{t('actions.falsePositive')}</button>
                  )}
                  {['closed', 'false_positive'].includes(selectedIncident.status) && (
                    <button disabled={actionPending} onClick={() => setPendingActionForm('reopen')} className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">{t('actions.reopen')}</button>
                  )}
                  <button disabled={actionPending} onClick={() => setPendingActionForm('note')} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50">{t('actions.addNote')}</button>
                </div>

                {/* Inline form for actions requiring text */}
                {pendingActionForm && (
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 space-y-2">
                    <label className="block text-xs text-gray-500">
                      {pendingActionForm === 'contain' ? t('actions.containmentSummary')
                        : pendingActionForm === 'resolve' ? t('actions.resolutionSummary')
                        : t('actions.note')}
                    </label>
                    <p className="text-xs text-amber-700 dark:text-amber-400">{t('actions.sanitizationWarning')}</p>
                    <textarea
                      value={formText}
                      onChange={(e) => setFormText(e.target.value)}
                      rows={3}
                      className="w-full text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-900 rounded-lg p-2"
                    />
                    <div className="flex gap-2">
                      <button disabled={actionPending} onClick={submitForm} className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                        {actionPending ? <Loader2 size={14} className="animate-spin" /> : t('actions.submit')}
                      </button>
                      <button onClick={() => { setPendingActionForm(null); setFormText(''); }} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700">
                        {t('actions.cancel')}
                      </button>
                    </div>
                  </div>
                )}

                {/* Assignment */}
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 space-y-2">
                  <label className="block text-xs text-gray-500">{t('actions.assign')}</label>
                  <div className="flex gap-2">
                    <input
                      value={assigneeInput}
                      onChange={(e) => setAssigneeInput(e.target.value)}
                      placeholder={t('actions.assigneeIdPlaceholder')}
                      className="flex-1 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-900 rounded-lg px-2 py-1.5"
                    />
                    <button
                      disabled={actionPending || !assigneeInput.trim()}
                      onClick={() => runAction('assign', { assigneePlatformAdminId: assigneeInput.trim() })}
                      className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                    >
                      {t('actions.assign')}
                    </button>
                    {selectedIncident.assignedToPlatformAdminId && (
                      <button
                        disabled={actionPending}
                        onClick={() => runAction('assign', { assigneePlatformAdminId: null })}
                        className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700"
                      >
                        {t('actions.unassign')}
                      </button>
                    )}
                  </div>
                </div>

                {/* Activity timeline */}
                <div>
                  <p className="text-xs text-gray-500 mb-2">{t('detail.activityTitle')}</p>
                  {activity.length === 0 ? (
                    <p className="text-xs text-gray-400">{t('detail.activityEmpty')}</p>
                  ) : (
                    <ul className="space-y-2">
                      {activity.map((entry) => (
                        <li key={entry.id} className="text-xs border-l-2 border-gray-200 dark:border-gray-700 pl-3">
                          <span className="font-medium text-gray-700 dark:text-gray-300">{entry.action}</span>
                          {entry.previousStatus && entry.newStatus && (
                            <span className="text-gray-400"> ({entry.previousStatus} → {entry.newStatus})</span>
                          )}
                          <span className="text-gray-400 ml-2">{dt(entry.createdAt)}</span>
                          {entry.note && <p className="text-gray-600 dark:text-gray-400 mt-0.5">{entry.note}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

export default PlatformSecurityIncidents;
