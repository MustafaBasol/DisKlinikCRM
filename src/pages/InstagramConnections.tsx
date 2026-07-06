import { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Instagram,
  Plus,
  Pencil,
  Wifi,
  WifiOff,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Trash2,
  Power,
  PowerOff,
  Copy,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { instagramConnectionService, organizationBranchService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useClinic } from '../context/ClinicContext';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import {
  canManageInstagramConnections,
  canViewInstagramStatus,
} from '../utils/permissions';

// ── Types ─────────────────────────────────────────────────────────────────────

interface InstagramConnection {
  id: string;
  name: string;
  status: string;
  instagramAccountId?: string | null;
  instagramUsername?: string | null;
  facebookPageId?: string | null;
  metaAppId?: string | null;
  metaBusinessId?: string | null;
  webhookVerifyToken?: string | null;
  tokenStatus?: string | null;
  tokenExpiresAt?: string | null;
  isActive: boolean;
  lastConnectedAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  clinics?: Array<{
    id: string;
    clinicId: string;
    clinic: { id: string; name: string };
    isDefault: boolean;
  }>;
}

interface ClinicOption {
  id: string;
  name: string;
}

function extractClinics(data: unknown): ClinicOption[] {
  if (Array.isArray(data)) return data as ClinicOption[];
  if (!data || typeof data !== 'object') return [];
  const record = data as { clinics?: ClinicOption[]; branches?: ClinicOption[] };
  return record.clinics ?? record.branches ?? [];
}

interface ConnectionFormData {
  name: string;
  instagramAccountId: string;
  instagramUsername: string;
  facebookPageId: string;
  accessTokenEncrypted: string;
  webhookVerifyToken: string;
  webhookSecret: string;
  metaAppId: string;
  metaBusinessId: string;
  linkedClinicIds: string[];
}

const EMPTY_FORM: ConnectionFormData = {
  name: '',
  instagramAccountId: '',
  instagramUsername: '',
  facebookPageId: '',
  accessTokenEncrypted: '',
  webhookVerifyToken: '',
  webhookSecret: '',
  metaAppId: '',
  metaBusinessId: '',
  linkedClinicIds: [],
};

const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/api\/?$/, '');
const WEBHOOK_BASE = `${API_BASE_URL}/api/public/instagram`;
const GLOBAL_WEBHOOK_URL = `${WEBHOOK_BASE}/webhook`;

// ── Helper: copy to clipboard ─────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation(['instagram']);
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="ml-1 text-gray-400 hover:text-primary-600 transition-colors"
      title={t('instagram:actions.copy')}
      type="button"
    >
      {copied ? <CheckCircle2 size={14} className="text-green-500" /> : <Copy size={14} />}
    </button>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function InstagramConnections() {
  const { user } = useAuth();
  const { selectedClinicId } = useClinic();
  const { t } = useTranslation(['instagram', 'common']);
  const { formatDateTime } = useClinicPreferences();
  const [connections, setConnections] = useState<InstagramConnection[]>([]);
  const [clinics, setClinics] = useState<ClinicOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<InstagramConnection | null>(null);
  const [form, setForm] = useState<ConnectionFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { success: boolean; message: string }>>({});
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const canManage = canManageInstagramConnections(user);
  const canView = canViewInstagramStatus(user);

  if (!canView) return <Navigate to="/" replace />;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [connRes, branchRes] = await Promise.all([
        instagramConnectionService.list(),
        organizationBranchService.getAll(),
      ]);
      setConnections(connRes.data.connections ?? []);
      setClinics(extractClinics(branchRes.data));
    } catch {
      setError(t('instagram:connections.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditingConnection(null);
    const selectedClinicIds = selectedClinicId !== 'all' ? [selectedClinicId] : [];
    setForm({
      ...EMPTY_FORM,
      linkedClinicIds: selectedClinicIds,
    });
    setFormError('');
    setModalOpen(true);
  }

  function openEdit(conn: InstagramConnection) {
    setEditingConnection(conn);
    setForm({
      name: conn.name,
      instagramAccountId: conn.instagramAccountId ?? '',
      instagramUsername: conn.instagramUsername ?? '',
      facebookPageId: conn.facebookPageId ?? '',
      accessTokenEncrypted: '',   // Never pre-filled — user must re-enter to change
      webhookVerifyToken: conn.webhookVerifyToken ?? '',
      webhookSecret: '',           // Same: empty = keep existing
      metaAppId: conn.metaAppId ?? '',
      metaBusinessId: conn.metaBusinessId ?? '',
      linkedClinicIds: conn.clinics?.map(c => c.clinicId) ?? [],
    });
    setFormError('');
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setFormError(t('instagram:connections.errors.nameRequired'));
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        instagramAccountId: form.instagramAccountId.trim() || null,
        instagramUsername: form.instagramUsername.trim() || null,
        facebookPageId: form.facebookPageId.trim() || null,
        metaAppId: form.metaAppId.trim() || null,
        metaBusinessId: form.metaBusinessId.trim() || null,
        selectedClinicId: selectedClinicId !== 'all' ? selectedClinicId : null,
        linkedClinicIds: form.linkedClinicIds,
      };
      if (form.accessTokenEncrypted.trim()) {
        payload.accessTokenEncrypted = form.accessTokenEncrypted.trim();
      }
      if (form.webhookVerifyToken.trim()) {
        payload.webhookVerifyToken = form.webhookVerifyToken.trim();
      }
      if (form.webhookSecret.trim()) {
        payload.webhookSecret = form.webhookSecret.trim();
      }

      if (editingConnection) {
        await instagramConnectionService.update(editingConnection.id, payload);
      } else {
        await instagramConnectionService.create(payload);
      }
      setModalOpen(false);
      await load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setFormError(msg ?? t('instagram:connections.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(id: string) {
    setTesting(id);
    try {
      const res = await instagramConnectionService.test(id);
      setTestResult(prev => ({ ...prev, [id]: res.data }));
      await load();
    } catch {
      setTestResult(prev => ({ ...prev, [id]: { success: false, message: t('instagram:connections.errors.testFailed') } }));
    } finally {
      setTesting(null);
    }
  }

  async function handleDisconnect(id: string) {
    if (!window.confirm(t('instagram:connections.confirm.disconnect'))) return;
    setDisconnecting(id);
    try {
      await instagramConnectionService.disconnect(id);
      await load();
    } catch {
      setError(t('instagram:connections.errors.disconnectFailed'));
    } finally {
      setDisconnecting(null);
    }
  }

  async function handleToggleActive(conn: InstagramConnection) {
    try {
      await instagramConnectionService.setStatus(conn.id, { isActive: !conn.isActive });
      await load();
    } catch {
      setError(t('instagram:connections.errors.statusUpdateFailed'));
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t('instagram:connections.confirm.delete'))) return;
    setDeleting(id);
    try {
      await instagramConnectionService.deleteConnection(id);
      await load();
    } catch {
      setError(t('instagram:connections.errors.deleteFailed'));
    } finally {
      setDeleting(null);
    }
  }

  // ── Status badge ──────────────────────────────────────────────────────────────

  function StatusBadge({ status }: { status: string }) {
    const map: Record<string, { cls: string; label: string }> = {
      connected: { cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300', label: t('instagram:connections.status.connected') },
      connecting: { cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300', label: t('instagram:connections.status.connecting') },
      error: { cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300', label: t('instagram:connections.status.error') },
      disconnected: { cls: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300', label: t('instagram:connections.status.disconnected') },
    };
    const { cls, label } = map[status] ?? map.disconnected;
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>;
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <Instagram size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('instagram:connections.title')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('instagram:connections.subtitle')}</p>
          </div>
        </div>
        {canManage && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
          >
            <Plus size={16} />
            {t('instagram:connections.actions.newConnection')}
          </button>
        )}
      </div>

      {/* Meta Setup Info Banner */}
      <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-800">
        <div className="flex items-start gap-3">
          <Info size={18} className="text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
          <div className="text-sm text-blue-800 dark:text-blue-200">
            <p className="font-semibold mb-1">{t('instagram:connections.setup.title')}</p>
            <ul className="list-disc list-inside space-y-1 text-blue-700 dark:text-blue-300">
              <li>
                {t('instagram:connections.setup.professionalPrefix')}{' '}
                <strong>{t('instagram:connections.setup.professionalAccount')}</strong>{' '}
                {t('instagram:connections.setup.professionalSuffix')}
              </li>
              <li>{t('instagram:connections.setup.facebookPage')}</li>
              <li>
                {t('instagram:connections.setup.permissionPrefix')}{' '}
                <strong>instagram_manage_messages</strong>{' '}
                {t('instagram:connections.setup.permissionSuffix')}
              </li>
              <li>
                {t('instagram:connections.setup.webhookCallbackUrl')}:
                <span className="inline-flex items-center gap-1 ml-1">
                  <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">{GLOBAL_WEBHOOK_URL}</code>
                  <CopyButton value={GLOBAL_WEBHOOK_URL} />
                </span>
              </li>
              <li>
                {t('instagram:connections.setup.webhookFieldPrefix')}{' '}
                <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">messages</code>{' '}
                {t('instagram:connections.setup.webhookFieldSuffix')}
              </li>
              <li>{t('instagram:connections.setup.verifyToken')}</li>
            </ul>
            <div className="mt-3 p-2.5 bg-blue-100/60 dark:bg-blue-800/40 rounded-lg text-xs text-blue-700 dark:text-blue-300">
              <span className="font-semibold">{t('instagram:connections.setup.globalWebhookNote')}</span>{' '}
              {t('instagram:connections.setup.routingNote')}
            </div>
            <a
              href="https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              Meta Instagram Messaging Docs
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 rounded-lg text-sm flex items-center gap-2">
          <XCircle size={16} />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-primary-600" size={32} />
        </div>
      )}

      {/* Empty state */}
      {!loading && connections.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <Instagram size={48} className="mx-auto mb-4 opacity-30" />
          <p className="font-medium">{t('instagram:connections.empty')}</p>
          {canManage && (
            <button
              onClick={openCreate}
              className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium transition-colors"
            >
              {t('instagram:connections.actions.addFirst')}
            </button>
          )}
        </div>
      )}

      {/* Connection Cards */}
      <div className="space-y-3">
        {connections.map(conn => {
          const isExpanded = expandedId === conn.id;
          const tr = testResult[conn.id];

          return (
            <div
              key={conn.id}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm"
            >
              {/* Card header */}
              <div className="px-5 py-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center">
                  {conn.status === 'connected' ? (
                    <Wifi size={18} className="text-white" />
                  ) : (
                    <WifiOff size={18} className="text-white opacity-70" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 dark:text-white truncate">{conn.name}</span>
                    <StatusBadge status={conn.status} />
                    {!conn.isActive && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                        {t('instagram:connections.status.inactive')}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {conn.instagramUsername && <span>@{conn.instagramUsername} · </span>}
                    {conn.clinics && conn.clinics.length > 0 && (
                      <span>{conn.clinics.map(c => c.clinic.name).join(', ')}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {canManage && (
                    <>
                      <button
                        onClick={() => handleTest(conn.id)}
                        disabled={testing === conn.id}
                        className="p-2 text-gray-400 hover:text-primary-600 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                        title={t('instagram:connections.actions.test')}
                      >
                        {testing === conn.id ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                      </button>
                      <button
                        onClick={() => openEdit(conn)}
                        className="p-2 text-gray-400 hover:text-blue-600 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                        title={t('common:edit')}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => handleToggleActive(conn)}
                        className="p-2 text-gray-400 hover:text-yellow-600 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                        title={conn.isActive ? t('instagram:connections.actions.deactivate') : t('instagram:connections.actions.activate')}
                      >
                        {conn.isActive ? <PowerOff size={16} /> : <Power size={16} />}
                      </button>
                      {conn.status === 'connected' && (
                        <button
                          onClick={() => handleDisconnect(conn.id)}
                          disabled={disconnecting === conn.id}
                          className="p-2 text-gray-400 hover:text-red-600 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                          title={t('instagram:connections.actions.disconnect')}
                        >
                          {disconnecting === conn.id ? <Loader2 size={16} className="animate-spin" /> : <WifiOff size={16} />}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(conn.id)}
                        disabled={deleting === conn.id}
                        className="p-2 text-gray-400 hover:text-red-600 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                        title={t('common:delete')}
                      >
                        {deleting === conn.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : conn.id)}
                    className="p-2 text-gray-400 hover:text-gray-600 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>
              </div>

              {/* Test result */}
              {tr && (
                <div className={`mx-5 mb-3 px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${tr.success ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300'}`}>
                  {tr.success ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                  {tr.message}
                </div>
              )}

              {/* Expanded details */}
              {isExpanded && (
                <div className="px-5 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3 space-y-3">
                  {/* Webhook info */}
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('instagram:connections.details.webhookConfig')}</p>
                    <div className="space-y-1.5">
                      {/* Global webhook URL (primary — use this in Meta Developer Console) */}
                      <div className="space-y-0.5">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          {t('instagram:connections.details.globalCallbackUrl')}{' '}
                          <span className="text-green-600 dark:text-green-400 font-semibold">({t('instagram:connections.details.recommended')})</span>:
                        </span>
                        <div className="flex items-center gap-1">
                          <code className="bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs border border-gray-200 dark:border-gray-600 truncate max-w-md flex-1">
                            {GLOBAL_WEBHOOK_URL}
                          </code>
                          <CopyButton value={GLOBAL_WEBHOOK_URL} />
                        </div>
                      </div>
                      {conn.webhookVerifyToken && (
                        <div className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                          <span className="font-medium">{t('instagram:connections.fields.webhookVerifyToken')}:</span>
                          <code className="bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs border border-gray-200 dark:border-gray-600">
                            {conn.webhookVerifyToken}
                          </code>
                          <CopyButton value={conn.webhookVerifyToken} />
                        </div>
                      )}
                      {/* Per-connection URL — advanced/optional */}
                      <details className="text-xs">
                        <summary className="cursor-pointer text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 select-none">
                          {t('instagram:connections.details.connectionSpecificUrl')} ▾
                        </summary>
                        <div className="mt-1 flex items-center gap-1">
                          <code className="bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs border border-gray-200 dark:border-gray-600 truncate max-w-md">
                            {`${WEBHOOK_BASE}/${conn.id}/webhook`}
                          </code>
                          <CopyButton value={`${WEBHOOK_BASE}/${conn.id}/webhook`} />
                        </div>
                        <p className="mt-0.5 text-gray-400 dark:text-gray-500">{t('instagram:connections.details.connectionSpecificHint')}</p>
                      </details>
                    </div>
                  </div>

                  {/* Connection details */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300">
                    {conn.instagramAccountId && (
                      <div>
                        <span className="font-medium text-gray-500 dark:text-gray-400">{t('instagram:connections.fields.instagramAccountId')}:</span>
                        <span className="ml-1">{conn.instagramAccountId}</span>
                      </div>
                    )}
                    {conn.facebookPageId && (
                      <div>
                        <span className="font-medium text-gray-500 dark:text-gray-400">{t('instagram:connections.fields.facebookPageId')}:</span>
                        <span className="ml-1">{conn.facebookPageId}</span>
                      </div>
                    )}
                    {conn.metaAppId && (
                      <div>
                        <span className="font-medium text-gray-500 dark:text-gray-400">{t('instagram:connections.fields.metaAppId')}:</span>
                        <span className="ml-1">{conn.metaAppId}</span>
                      </div>
                    )}
                    {conn.lastConnectedAt && (
                      <div>
                        <span className="font-medium text-gray-500 dark:text-gray-400">{t('instagram:connections.details.lastConnection')}:</span>
                        <span className="ml-1">{formatDateTime(conn.lastConnectedAt)}</span>
                      </div>
                    )}
                  </div>

                  {conn.lastError && (
                    <div className="flex items-start gap-2 p-2 bg-red-50 dark:bg-red-900/20 rounded-lg text-xs text-red-600 dark:text-red-300">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <span>{conn.lastError}</span>
                    </div>
                  )}

                  {/* Assigned clinics */}
                  {conn.clinics && conn.clinics.length > 0 && (
                    <div className="text-xs">
                      <span className="font-medium text-gray-500 dark:text-gray-400">{t('instagram:connections.details.linkedBranches')}: </span>
                      {conn.clinics.map(c => c.clinic.name).join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between shrink-0">
              <h2 className="font-semibold text-gray-900 dark:text-white">
                {editingConnection ? t('instagram:connections.modal.editTitle') : t('instagram:connections.modal.createTitle')}
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <XCircle size={20} />
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-4 flex-1 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 rounded-lg text-sm">
                  {formError}
                </div>
              )}

              {/* Connection Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('instagram:connections.fields.connectionName')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={t('instagram:connections.placeholders.connectionName')}
                />
              </div>

              {/* Instagram Account ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('instagram:connections.fields.instagramAccountId')}
                </label>
                <input
                  type="text"
                  value={form.instagramAccountId}
                  onChange={e => setForm(f => ({ ...f, instagramAccountId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={t('instagram:connections.placeholders.instagramAccountId')}
                />
              </div>

              {/* Instagram Username */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('instagram:connections.fields.instagramUsername')}
                </label>
                <input
                  type="text"
                  value={form.instagramUsername}
                  onChange={e => setForm(f => ({ ...f, instagramUsername: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={t('instagram:connections.placeholders.instagramUsername')}
                />
              </div>

              {/* Facebook Page ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('instagram:connections.fields.facebookPageId')}
                </label>
                <input
                  type="text"
                  value={form.facebookPageId}
                  onChange={e => setForm(f => ({ ...f, facebookPageId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={t('instagram:connections.placeholders.facebookPageId')}
                />
              </div>

              {/* Access Token */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('instagram:connections.fields.accessToken')}
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.accessTokenEncrypted}
                  onChange={e => setForm(f => ({ ...f, accessTokenEncrypted: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={editingConnection ? t('instagram:connections.placeholders.keepToken') : t('instagram:connections.placeholders.accessToken')}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('instagram:connections.hints.accessTokenEncrypted')}
                </p>
              </div>

              {/* Webhook Verify Token */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('instagram:connections.fields.webhookVerifyToken')}
                </label>
                <input
                  type="text"
                  value={form.webhookVerifyToken}
                  onChange={e => setForm(f => ({ ...f, webhookVerifyToken: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={t('instagram:connections.placeholders.autoGenerated')}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('instagram:connections.hints.webhookVerifyToken')}
                </p>
              </div>

              {/* Webhook Secret */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('instagram:connections.fields.webhookSecret')}
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.webhookSecret}
                  onChange={e => setForm(f => ({ ...f, webhookSecret: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={editingConnection ? t('instagram:connections.placeholders.keepSecret') : t('instagram:connections.placeholders.webhookSecret')}
                />
              </div>

              {/* Meta App ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Meta App ID
                </label>
                <input
                  type="text"
                  value={form.metaAppId}
                  onChange={e => setForm(f => ({ ...f, metaAppId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={t('instagram:connections.placeholders.metaAppId')}
                />
              </div>

              {/* Clinic assignments */}
              {clinics.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('instagram:connections.fields.linkedBranches')}
                  </label>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {clinics.map(c => (
                      <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.linkedClinicIds.includes(c.id)}
                          onChange={e => {
                            if (e.target.checked) {
                              setForm(f => ({ ...f, linkedClinicIds: [...f.linkedClinicIds, c.id] }));
                            } else {
                              setForm(f => ({ ...f, linkedClinicIds: f.linkedClinicIds.filter(id => id !== c.id) }));
                            }
                          }}
                          className="rounded text-primary-600"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">{c.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3 shrink-0">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white text-sm"
              >
                {t('common:cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {editingConnection ? t('common:save') : t('common:add')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
