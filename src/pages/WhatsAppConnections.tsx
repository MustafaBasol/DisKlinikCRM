import { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  MessageCircle,
  Plus,
  Pencil,
  Wifi,
  WifiOff,
  QrCode,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Trash2,
  Download,
  AlertTriangle,
  ExternalLink,
  Power,
  PowerOff,
  Unplug,
} from 'lucide-react';
import { whatsappConnectionService, organizationBranchService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import { canManageWhatsAppConnections, canViewWhatsAppStatus } from '../utils/permissions';

// ── Meta Embedded Signup env config (frontend-safe vars only) ─────────────────
const META_APP_ID = import.meta.env.VITE_META_APP_ID?.trim() || '';
const META_CONFIG_ID = import.meta.env.VITE_META_EMBEDDED_SIGNUP_CONFIG_ID?.trim() || '';
const META_GRAPH_VERSION = import.meta.env.VITE_META_GRAPH_API_VERSION?.trim() || 'v23.0';
const META_REDIRECT_URI = import.meta.env.VITE_META_REDIRECT_URI?.trim() || '';
const META_ENV_READY = Boolean(META_APP_ID && META_CONFIG_ID);

// ── Types ─────────────────────────────────────────────────────────────────────

type Provider = 'evolution_api' | 'meta_cloud_api';

interface WhatsAppConnection {
  id: string;
  name: string;
  provider: Provider;
  status: string;
  phoneNumber?: string | null;
  displayName?: string | null;
  isActive: boolean;
  evolutionApiUrl?: string | null;
  evolutionInstanceName?: string | null;
  metaPhoneNumberId?: string | null;
  metaBusinessId?: string | null;
  metaWabaId?: string | null;
  metaAppId?: string | null;
  metaTokenStatus?: string | null;    // valid | expiring | expired | unknown
  metaTokenExpiresAt?: string | null; // ISO string from API
  createdAt: string;
  isLegacy?: boolean; // Virtual entry: not yet saved to DB
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

interface ConnectionFormData {
  name: string;
  provider: Provider;
  phoneNumber: string;
  displayName: string;
  // Evolution API
  evolutionApiUrl: string;
  evolutionInstanceName: string;
  evolutionApiKeyEncrypted: string;
  // Meta Cloud API
  metaBusinessId: string;
  metaWabaId: string;
  metaPhoneNumberId: string;
  metaAppId: string;
  metaAccessTokenEncrypted: string;
  metaWebhookVerifyToken: string;
  metaWebhookSecret: string;
  // Shared
  webhookSecret: string;
  // Clinic assignment
  linkedClinicIds: string[];
}

const EMPTY_FORM: ConnectionFormData = {
  name: '',
  provider: 'evolution_api',
  phoneNumber: '',
  displayName: '',
  evolutionApiUrl: '',
  evolutionInstanceName: '',
  evolutionApiKeyEncrypted: '',
  metaBusinessId: '',
  metaWabaId: '',
  metaPhoneNumberId: '',
  metaAppId: '',
  metaAccessTokenEncrypted: '',
  metaWebhookVerifyToken: '',
  metaWebhookSecret: '',
  webhookSecret: '',
  linkedClinicIds: [],
};

const PROVIDER_LABELS: Record<Provider, string> = {
  evolution_api: 'Evolution API',
  meta_cloud_api: 'Meta Cloud API',
};

const STATUS_COLOR: Record<string, string> = {
  connected: 'text-green-600 dark:text-green-400',
  connecting: 'text-yellow-600 dark:text-yellow-400',
  disconnected: 'text-gray-500 dark:text-gray-400',
  error: 'text-red-600 dark:text-red-400',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function WhatsAppConnections() {
  const { user } = useAuth();
  const { t } = useTranslation(['whatsapp', 'common']);
  const { formatDate } = useClinicPreferences();
  const [connections, setConnections] = useState<WhatsAppConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Available clinics for assignment
  const [clinicOptions, setClinicOptions] = useState<ClinicOption[]>([]);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ConnectionFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Per-connection action state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});
  const [qrData, setQrData] = useState<Record<string, string | null>>({});
  const [showQrFor, setShowQrFor] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [importingLegacy, setImportingLegacy] = useState(false);
  const [metaConnecting, setMetaConnecting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteConn, setConfirmDeleteConn] = useState<WhatsAppConnection | null>(null);
  const [showAdvancedMetaSetup, setShowAdvancedMetaSetup] = useState(false);

  const canManage = canManageWhatsAppConnections(user);
  const canView = canViewWhatsAppStatus(user);

  if (!canView) return <Navigate to="/" replace />;

  const fetchConnections = useCallback(async () => {
    try {
      setLoading(true);
      const res = await whatsappConnectionService.list();
      setConnections(res.data);
    } catch {
      setError(t('whatsapp:connections.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const fetchClinics = useCallback(async () => {
    try {
      const res = await organizationBranchService.getAll();
      setClinicOptions((res.data ?? []).map((c: any) => ({ id: c.id, name: c.name })));
    } catch {
      // Non-critical; clinic assignment still works via existing routes
    }
  }, []);

  useEffect(() => {
    fetchConnections();
    fetchClinics();
  }, [fetchConnections, fetchClinics]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowAdvancedMetaSetup(false);
    setShowModal(true);
  }

  function openEdit(conn: WhatsAppConnection) {
    setEditingId(conn.id);
    setForm({
      name: conn.name,
      provider: conn.provider,
      phoneNumber: conn.phoneNumber ?? '',
      displayName: conn.displayName ?? '',
      evolutionApiUrl: conn.evolutionApiUrl ?? '',
      evolutionInstanceName: conn.evolutionInstanceName ?? '',
      evolutionApiKeyEncrypted: '', // Don't pre-fill secrets
      metaBusinessId: conn.metaBusinessId ?? '',
      metaWabaId: conn.metaWabaId ?? '',
      metaPhoneNumberId: conn.metaPhoneNumberId ?? '',
      metaAppId: conn.metaAppId ?? '',
      metaAccessTokenEncrypted: '', // Don't pre-fill secrets
      metaWebhookVerifyToken: '',
      metaWebhookSecret: '',
      webhookSecret: '', // Don't pre-fill secrets
      linkedClinicIds: (conn.clinics ?? []).map((c) => c.clinicId),
    });
    setFormError(null);
    // Manual fields default to collapsed even when editing an existing manual connection.
    setShowAdvancedMetaSetup(false);
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setFormError(t('whatsapp:connections.errors.nameRequired'));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        provider: form.provider,
        linkedClinicIds: form.linkedClinicIds,
      };
      if (form.phoneNumber) payload.phoneNumber = form.phoneNumber;
      if (form.displayName) payload.displayName = form.displayName;
      if (form.webhookSecret) payload.webhookSecret = form.webhookSecret;

      if (form.provider === 'evolution_api') {
        if (form.evolutionApiUrl) payload.evolutionApiUrl = form.evolutionApiUrl;
        if (form.evolutionInstanceName) payload.evolutionInstanceName = form.evolutionInstanceName;
        if (form.evolutionApiKeyEncrypted) payload.evolutionApiKeyEncrypted = form.evolutionApiKeyEncrypted;
      } else {
        if (form.metaBusinessId) payload.metaBusinessId = form.metaBusinessId;
        if (form.metaWabaId) payload.metaWabaId = form.metaWabaId;
        if (form.metaPhoneNumberId) payload.metaPhoneNumberId = form.metaPhoneNumberId;
        if (form.metaAppId) payload.metaAppId = form.metaAppId;
        if (form.metaAccessTokenEncrypted) payload.metaAccessTokenEncrypted = form.metaAccessTokenEncrypted;
        if (form.metaWebhookVerifyToken) payload.metaWebhookVerifyToken = form.metaWebhookVerifyToken;
        if (form.metaWebhookSecret) payload.metaWebhookSecret = form.metaWebhookSecret;
      }

      if (editingId) {
        await whatsappConnectionService.update(editingId, payload);
      } else {
        await whatsappConnectionService.create(payload);
      }
      setShowModal(false);
      fetchConnections();
    } catch (err: any) {
      setFormError(err?.response?.data?.error ?? t('whatsapp:connections.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(id: string) {
    setTestingId(id);
    try {
      const res = await whatsappConnectionService.test(id);
      setTestResults((prev) => ({ ...prev, [id]: res.data }));
    } catch {
      setTestResults((prev) => ({ ...prev, [id]: { success: false, message: t('whatsapp:connections.errors.testFailed') } }));
    } finally {
      setTestingId(null);
    }
  }

  async function handleGetQr(id: string) {
    setShowQrFor(id);
    try {
      const res = await whatsappConnectionService.getQr(id);
      setQrData((prev) => ({ ...prev, [id]: res.data.qrCode ?? null }));
    } catch {
      setQrData((prev) => ({ ...prev, [id]: null }));
    }
  }

  async function handleDisconnect(id: string, name: string) {
    if (!confirm(t('whatsapp:connections.confirm.disconnect', { name }))) return;
    setDisconnectingId(id);
    try {
      await whatsappConnectionService.disconnect(id);
      setSuccessMessage(t('whatsapp:connections.success.disconnected', { name }));
      fetchConnections();
    } catch {
      setImportError(t('whatsapp:connections.errors.disconnectFailed'));
    } finally {
      setDisconnectingId(null);
    }
  }

  async function handleImportLegacy() {
    if (!confirm(t('whatsapp:connections.confirm.importLegacy'))) return;
    setImportingLegacy(true);
    setImportError(null);
    setSuccessMessage(null);
    try {
      const res = await whatsappConnectionService.importLegacy();
      if (res.data.alreadyImported) {
        setSuccessMessage(t('whatsapp:connections.success.alreadyImported'));
      } else {
        setSuccessMessage(t('whatsapp:connections.success.imported'));
      }
      fetchConnections();
    } catch (err: any) {
      setImportError(err?.response?.data?.error ?? t('whatsapp:connections.errors.importFailed'));
    } finally {
      setImportingLegacy(false);
    }
  }

  async function handleToggleActive(conn: WhatsAppConnection) {
    const newActive = !conn.isActive;
    setTogglingId(conn.id);
    setImportError(null);
    setSuccessMessage(null);
    try {
      await whatsappConnectionService.setStatus(conn.id, {
        isActive: newActive,
        status: newActive ? 'connected' : 'disconnected',
      });
      setSuccessMessage(
        t(newActive ? 'whatsapp:connections.success.activated' : 'whatsapp:connections.success.deactivated', { name: conn.name }),
      );
      fetchConnections();
    } catch {
      setImportError(t('whatsapp:connections.errors.statusUpdateFailed'));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleConfirmDelete() {
    if (!confirmDeleteConn) return;
    const conn = confirmDeleteConn;
    setDeletingId(conn.id);
    setConfirmDeleteConn(null);
    setImportError(null);
    setSuccessMessage(null);
    try {
      await whatsappConnectionService.deleteConnection(conn.id);
      setSuccessMessage(t('whatsapp:connections.success.deleted', { name: conn.name }));
      fetchConnections();
    } catch (err: any) {
      const errCode = err?.response?.data?.code;
      if (errCode === 'HAS_MESSAGE_HISTORY') {
        setImportError(
          t('whatsapp:connections.errors.deleteHasHistory', { name: conn.name }),
        );
      } else {
        setImportError(err?.response?.data?.error ?? t('whatsapp:connections.errors.deleteFailed'));
      }
    } finally {
      setDeletingId(null);
    }
  }

  /**
   * Launch Meta Embedded Signup using the Facebook JS SDK OAuth flow.
   * Opens a popup — the user logs in, selects/creates WABA and phone number,
   * then Meta redirects with a code or fields we can pass to our callback endpoint.
   */
  async function handleMetaEmbeddedSignup(linkedClinicIds: string[] = []) {
    if (!META_ENV_READY) return;
    setMetaConnecting(true);
    try {
      // Build the OAuth URL to open in a popup
      const redirectUri = META_REDIRECT_URI || `${window.location.origin}/auth/meta/callback`;
      const params = new URLSearchParams({
        client_id: META_APP_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'whatsapp_business_management,whatsapp_business_messaging',
      });
      if (META_CONFIG_ID) {
        params.set('extras', JSON.stringify({ setup: {}, featureType: '', sessionInfoVersion: '3' }));
        params.set('config_id', META_CONFIG_ID);
      }

      const authUrl = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${params.toString()}`;

      // Open popup — if popup is blocked, fall back to same-tab redirect
      const popup = window.open(authUrl, 'meta_signup', 'width=600,height=700,noopener=no');

      if (!popup) {
        // Popup blocked — open in same tab
        window.location.href = authUrl;
        return;
      }

      let settled = false;

      const handleMessage = async (event: MessageEvent) => {
        // Strict origin check — only accept from same origin (our callback page)
        if (event.origin !== window.location.origin) return;

        const data = event.data as {
          type?: string;
          code?: string;
          state?: string;
          error?: string;
          errorDescription?: string;
          wabaId?: string;
          phoneNumberId?: string;
          phoneNumber?: string;
          displayName?: string;
          businessId?: string;
        };

        if (data?.type !== 'meta_signup_callback') return;

        settled = true;
        window.removeEventListener('message', handleMessage);
        clearTimeout(timeoutId);
        popup?.close();

        // Handle errors reported by the callback page
        if (data.error) {
          const humanError = data.errorDescription ?? data.error;
          setFormError(t('whatsapp:connections.errors.metaRejected', { error: humanError }));
          setMetaConnecting(false);
          return;
        }

        if (!data.code) {
          setFormError(t('whatsapp:connections.errors.metaMissingCode'));
          setMetaConnecting(false);
          return;
        }

        try {
          await whatsappConnectionService.metaCallback({
            code: data.code,
            wabaId: data.wabaId,
            phoneNumberId: data.phoneNumberId,
            phoneNumber: data.phoneNumber,
            displayName: data.displayName,
            businessId: data.businessId,
            linkedClinicIds,
          });
          fetchConnections();
        } catch (err: unknown) {
          const apiErr = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
          setFormError(apiErr ?? t('whatsapp:connections.errors.metaCreateFailed'));
        } finally {
          setMetaConnecting(false);
        }
      };

      window.addEventListener('message', handleMessage);

      // Timeout after 5 minutes
      const timeoutId = setTimeout(() => {
        if (!settled) {
          window.removeEventListener('message', handleMessage);
          popup?.close();
          setMetaConnecting(false);
        }
      }, 5 * 60 * 1000);
    } catch {
      setMetaConnecting(false);
    }
  }

  function toggleClinicId(id: string) {
    setForm((f) => ({
      ...f,
      linkedClinicIds: f.linkedClinicIds.includes(id)
        ? f.linkedClinicIds.filter((x) => x !== id)
        : [...f.linkedClinicIds, id],
    }));
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <MessageCircle className="text-green-600 dark:text-green-400" size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('whatsapp:connections.title')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('whatsapp:connections.subtitle')}
            </p>
          </div>
        </div>
        {canManage && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            {t('whatsapp:connections.actions.newConnection')}
          </button>
        )}
      </div>

      {/* Provider info banner */}
      <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-700 dark:text-blue-300">
        {t('whatsapp:connections.providerInfo', {
          evolution: 'Evolution API',
          meta: 'Meta Cloud API',
        })}
      </div>

      {/* Meta Embedded Signup quick-connect panel */}
      {canManage && (
        <div className="mb-4 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="font-medium text-gray-900 dark:text-white text-sm">
                {t('whatsapp:connections.metaPanel.title')}
              </p>
              {META_ENV_READY ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {t('whatsapp:connections.metaPanel.ready')}
                </p>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                  {t('whatsapp:connections.metaPanel.notConfiguredPrefix')}{' '}
                  <span className="font-mono">VITE_META_APP_ID</span> ve{' '}
                  <span className="font-mono">VITE_META_EMBEDDED_SIGNUP_CONFIG_ID</span> {t('whatsapp:connections.metaPanel.notConfiguredSuffix')}
                  {t('whatsapp:connections.metaPanel.manualHint')}
                </p>
              )}
            </div>
            <button
              onClick={() => handleMetaEmbeddedSignup()}
              disabled={!META_ENV_READY || metaConnecting}
              title={META_ENV_READY ? t('whatsapp:connections.metaPanel.connectTitle') : t('whatsapp:connections.metaPanel.notConfiguredTitle')}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed shrink-0"
            >
              {metaConnecting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ExternalLink size={14} />
              )}
              {t('whatsapp:connections.actions.connectMeta')}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {importError && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 flex items-center justify-between">
          <span>{importError}</span>
          <button onClick={() => setImportError(null)} className="ml-3 text-red-400 hover:text-red-600 font-bold">✕</button>
        </div>
      )}

      {successMessage && (
        <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-300 flex items-center justify-between">
          <span className="flex items-center gap-2"><CheckCircle2 size={16} className="shrink-0" />{successMessage}</span>
          <button onClick={() => setSuccessMessage(null)} className="ml-3 text-green-400 hover:text-green-600 font-bold">✕</button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-gray-400" size={32} />
        </div>
      ) : connections.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <MessageCircle size={40} className="mx-auto mb-3 opacity-40" />
          <p>{t('whatsapp:connections.empty')}</p>
          {canManage && (
            <button
              onClick={openCreate}
              className="mt-4 flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors mx-auto"
            >
              <Plus size={16} />
              {t('whatsapp:connections.actions.newConnection')}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {connections.map((conn) => {
            // ── Legacy virtual entry ─────────────────────────────────────────
            if (conn.isLegacy) {
              return (
                <div
                  key="__legacy__"
                  className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl overflow-hidden"
                >
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-amber-900 dark:text-amber-100 text-sm">
                          {t('whatsapp:connections.legacy.title')}
                        </p>
                        <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                          {t('whatsapp:connections.legacy.description')}
                        </p>
                        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-amber-700 dark:text-amber-300">
                          {conn.evolutionApiUrl && (
                            <>
                              <span className="font-medium">{t('whatsapp:connections.modal.apiUrl')}</span>
                              <span className="truncate">{conn.evolutionApiUrl}</span>
                            </>
                          )}
                          {conn.evolutionInstanceName && (
                            <>
                              <span className="font-medium">{t('whatsapp:connections.modal.instanceName')}</span>
                              <span>{conn.evolutionInstanceName}</span>
                            </>
                          )}
                          <span className="font-medium">{t('whatsapp:connections.modal.apiKey')}</span>
                          <span>{t('whatsapp:connections.configuredSecret')}</span>
                        </div>
                        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 italic">
                          {t('whatsapp:connections.legacy.note')}
                        </p>
                        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400 italic">
                          {t('whatsapp:connections.legacy.afterImport')}
                        </p>
                      </div>
                      {canManage && (
                        <button
                          onClick={handleImportLegacy}
                          disabled={importingLegacy}
                          className="flex items-center gap-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50 shrink-0"
                        >
                          {importingLegacy ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Download size={13} />
                          )}
                          {t('whatsapp:connections.actions.importToPanel')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            // ── Regular connection card ──────────────────────────────────────
            return (
              <div
                key={conn.id}
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden"
              >
                {/* Main row */}
                <div className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 dark:text-white truncate">{conn.name}</span>
                      <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs rounded-full">
                        {PROVIDER_LABELS[conn.provider]}
                      </span>
                      {conn.isActive ? (
                        <span className="flex items-center gap-1 text-xs">
                          <Wifi size={12} className={STATUS_COLOR[conn.status] ?? 'text-gray-500'} />
                          <span className={STATUS_COLOR[conn.status] ?? 'text-gray-500 dark:text-gray-400'}>
                            {conn.status}
                          </span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                          <PowerOff size={12} />
                          {t('whatsapp:connections.status.inactive')}
                        </span>
                      )}
                    </div>
                    {(conn.phoneNumber || conn.displayName) && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                        {conn.displayName ?? ''} {conn.phoneNumber ? `(${conn.phoneNumber})` : ''}
                      </p>
                    )}
                    {conn.clinics && conn.clinics.length > 0 && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        {t('whatsapp:connections.assignedBranches', { branches: conn.clinics.map((c) => c.clinic.name).join(', ') })}
                      </p>
                    )}
                    {conn.clinics && conn.clinics.length === 0 && (
                      <p className="text-xs text-amber-500 dark:text-amber-400 mt-1">
                        {t('whatsapp:connections.noBranchesAssigned')}
                      </p>
                    )}
                    {/* Meta token expiry warning */}
                    {conn.provider === 'meta_cloud_api' && conn.metaTokenStatus === 'expired' && (
                      <p className="text-xs text-red-500 dark:text-red-400 mt-1">
                        {t('whatsapp:connections.token.expired')}
                      </p>
                    )}
                    {conn.provider === 'meta_cloud_api' && conn.metaTokenStatus === 'expiring' && (
                      <p className="text-xs text-amber-500 dark:text-amber-400 mt-1">
                        {t('whatsapp:connections.token.expiring')}
                      </p>
                    )}
                    {conn.provider === 'meta_cloud_api' && !conn.metaTokenExpiresAt && conn.status === 'connected' && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        {t('whatsapp:connections.token.securelySaved')}
                      </p>
                    )}
                    {conn.provider === 'meta_cloud_api' && !conn.metaTokenExpiresAt && conn.status !== 'connected' && (
                      <p className="text-xs text-amber-500 dark:text-amber-400 mt-1">
                        {t('whatsapp:connections.token.statusUnverified')}
                      </p>
                    )}
                    {/* Meta does not use QR */}
                    {conn.provider === 'meta_cloud_api' && (
                      <p className="text-xs text-blue-500 dark:text-blue-400 mt-1">
                        {t('whatsapp:connections.metaNoQr')}
                      </p>
                    )}
                    {/* Inactive warning */}
                    {!conn.isActive && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        {t('whatsapp:connections.inactiveWarning')}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                    {canManage && (
                      <>
                        {/* Test */}
                        <button
                          onClick={() => handleTest(conn.id)}
                          disabled={testingId === conn.id}
                          title={t('whatsapp:connections.actions.test')}
                          className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                        >
                          {testingId === conn.id ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <CheckCircle2 size={16} />
                          )}
                        </button>
                        {/* QR — Evolution only */}
                        {conn.provider === 'evolution_api' && (
                          <button
                            onClick={() => handleGetQr(conn.id)}
                            title={t('whatsapp:connections.actions.getQr')}
                            className="p-2 text-gray-400 hover:text-green-600 dark:hover:text-green-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                          >
                            <QrCode size={16} />
                          </button>
                        )}
                        {/* Edit */}
                        <button
                          onClick={() => openEdit(conn)}
                          title={t('common:edit')}
                          className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        >
                          <Pencil size={16} />
                        </button>
                        {/* Disconnect */}
                        <button
                          onClick={() => handleDisconnect(conn.id, conn.name)}
                          disabled={disconnectingId === conn.id}
                          title={t('whatsapp:connections.actions.disconnect')}
                          className="p-2 text-gray-400 hover:text-orange-600 dark:hover:text-orange-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                        >
                          {disconnectingId === conn.id ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Unplug size={16} />
                          )}
                        </button>
                        {/* Deactivate / Activate */}
                        <button
                          onClick={() => handleToggleActive(conn)}
                          disabled={togglingId === conn.id}
                          title={conn.isActive ? t('whatsapp:connections.actions.deactivate') : t('whatsapp:connections.actions.activate')}
                          className={`p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 ${
                            conn.isActive
                              ? 'text-gray-400 hover:text-amber-600 dark:hover:text-amber-400'
                              : 'text-gray-400 hover:text-green-600 dark:hover:text-green-400'
                          }`}
                        >
                          {togglingId === conn.id ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : conn.isActive ? (
                            <PowerOff size={16} />
                          ) : (
                            <Power size={16} />
                          )}
                        </button>
                        {/* Delete */}
                        <button
                          onClick={() => setConfirmDeleteConn(conn)}
                          disabled={deletingId === conn.id}
                          title={t('common:delete')}
                          className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                        >
                          {deletingId === conn.id ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Trash2 size={16} />
                          )}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setExpandedId(expandedId === conn.id ? null : conn.id)}
                      className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      {expandedId === conn.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>

                {/* Test result */}
                {testResults[conn.id] && (
                  <div
                    className={`px-4 pb-3 text-sm flex items-start gap-2 ${
                      testResults[conn.id].success
                        ? 'text-green-700 dark:text-green-400'
                        : 'text-red-700 dark:text-red-400'
                    }`}
                  >
                    {testResults[conn.id].success ? (
                      <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                    ) : (
                      <XCircle size={14} className="mt-0.5 shrink-0" />
                    )}
                    <span>{testResults[conn.id].message}</span>
                  </div>
                )}

                {/* QR Code display */}
                {showQrFor === conn.id && (
                  <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3">
                    {conn.provider === 'meta_cloud_api' ? (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {t('whatsapp:connections.qr.metaNotUsed')}
                      </p>
                    ) : qrData[conn.id] ? (
                      <div className="flex flex-col items-start gap-2">
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {t('whatsapp:connections.qr.connectWithQr')}
                        </p>
                        <img
                          src={`data:image/png;base64,${qrData[conn.id]}`}
                          alt={t('whatsapp:connections.qr.alt')}
                          className="w-48 h-48 border border-gray-200 dark:border-gray-600 rounded-lg"
                        />
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {t('whatsapp:connections.qr.empty')}
                      </p>
                    )}
                    <button
                      onClick={() => setShowQrFor(null)}
                      className="mt-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      {t('common:close')}
                    </button>
                  </div>
                )}

                {/* Expanded details */}
                {expandedId === conn.id && (
                  <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3">
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                      {conn.provider === 'evolution_api' && (
                        <>
                          {conn.evolutionApiUrl && (
                            <>
                              <dt>{t('whatsapp:connections.modal.apiUrl')}</dt>
                              <dd className="truncate text-gray-700 dark:text-gray-300">{conn.evolutionApiUrl}</dd>
                            </>
                          )}
                          {conn.evolutionInstanceName && (
                            <>
                              <dt>{t('whatsapp:connections.modal.instanceName')}</dt>
                              <dd className="text-gray-700 dark:text-gray-300">{conn.evolutionInstanceName}</dd>
                            </>
                          )}
                        </>
                      )}
                      {conn.provider === 'meta_cloud_api' && (
                        <>
                          {conn.metaPhoneNumberId && (
                            <>
                              <dt>Phone Number ID</dt>
                              <dd className="text-gray-700 dark:text-gray-300">{conn.metaPhoneNumberId}</dd>
                            </>
                          )}
                          {conn.metaWabaId && (
                            <>
                              <dt>WABA ID</dt>
                              <dd className="text-gray-700 dark:text-gray-300">{conn.metaWabaId}</dd>
                            </>
                          )}
                          {conn.metaBusinessId && (
                            <>
                              <dt>Business ID</dt>
                              <dd className="text-gray-700 dark:text-gray-300">{conn.metaBusinessId}</dd>
                            </>
                          )}
                          {conn.metaAppId && (
                            <>
                              <dt>App ID</dt>
                              <dd className="text-gray-700 dark:text-gray-300">{conn.metaAppId}</dd>
                            </>
                          )}
                          {conn.metaTokenExpiresAt && (
                            <>
                              <dt>{t('whatsapp:connections.token.validity')}</dt>
                              <dd className={
                                conn.metaTokenStatus === 'expired' ? 'text-red-500' :
                                conn.metaTokenStatus === 'expiring' ? 'text-amber-500' :
                                'text-gray-700 dark:text-gray-300'
                              }>
                                {formatDate(conn.metaTokenExpiresAt)}
                                {conn.metaTokenStatus === 'expired' && ` — ${t('whatsapp:connections.token.expiredShort')}`}
                                {conn.metaTokenStatus === 'expiring' && ` — ${t('whatsapp:connections.token.expiringShort')}`}
                              </dd>
                            </>
                          )}
                          {!conn.metaTokenExpiresAt && conn.provider === 'meta_cloud_api' && (
                            <>
                              <dt>{t('whatsapp:connections.token.validity')}</dt>
                              <dd className={conn.status === 'connected' ? 'text-gray-700 dark:text-gray-300' : 'text-amber-600 dark:text-amber-400'}>
                                {conn.status === 'connected'
                                  ? t('whatsapp:connections.token.storedSecurelyShort')
                                  : t('whatsapp:connections.token.unknownShort')}
                              </dd>
                            </>
                          )}
                        </>
                      )}
                      <dt>{t('whatsapp:connections.createdAt')}</dt>
                      <dd>{formatDate(conn.createdAt)}</dd>
                    </dl>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Delete Confirmation Modal ────────────────────────────────────────── */}
      {confirmDeleteConn && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Trash2 size={18} className="text-red-500" />
                {t('whatsapp:connections.deleteModal.title')}
              </h2>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {t('whatsapp:connections.deleteModal.confirm', { name: confirmDeleteConn.name })}
              </p>
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg text-xs text-amber-800 dark:text-amber-300 space-y-1">
                <p>{t('whatsapp:connections.deleteModal.branchWarning')}</p>
                <p>{t('whatsapp:connections.deleteModal.historyWarning')}</p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
              <button
                onClick={() => setConfirmDeleteConn(null)}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                {t('common:cancel')}
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Trash2 size={14} />
                {t('common:delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create / Edit Modal ──────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                {editingId ? t('whatsapp:connections.modal.editTitle') : t('whatsapp:connections.modal.createTitle')}
              </h2>
            </div>
            <div className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('whatsapp:connections.modal.name')} <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder={t('whatsapp:connections.modal.namePlaceholder')}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('whatsapp:connections.modal.provider')}
                </label>
                <select
                  value={form.provider}
                  onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as Provider }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 outline-none"
                >
                  <option value="evolution_api">Evolution API</option>
                  <option value="meta_cloud_api">Meta Cloud API</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('whatsapp:connections.modal.phoneNumber')}
                  </label>
                  <input
                    value={form.phoneNumber}
                    onChange={(e) => setForm((f) => ({ ...f, phoneNumber: e.target.value }))}
                    placeholder="+90xxxxxxxxxx"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('whatsapp:connections.modal.displayName')}
                  </label>
                  <input
                    value={form.displayName}
                    onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                    placeholder={t('whatsapp:connections.modal.displayNamePlaceholder')}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 outline-none"
                  />
                </div>
              </div>

              {/* Evolution API fields */}
              {form.provider === 'evolution_api' && (
                <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    {t('whatsapp:connections.modal.evolutionSettings')}
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('whatsapp:connections.modal.apiUrl')}
                    </label>
                    <input
                      value={form.evolutionApiUrl}
                      onChange={(e) => setForm((f) => ({ ...f, evolutionApiUrl: e.target.value }))}
                      placeholder="https://evolution.yourserver.com"
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('whatsapp:connections.modal.instanceName')}
                    </label>
                    <input
                      value={form.evolutionInstanceName}
                      onChange={(e) => setForm((f) => ({ ...f, evolutionInstanceName: e.target.value }))}
                      placeholder="my-instance"
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('whatsapp:connections.modal.apiKey')} {editingId && <span className="text-gray-400">({t('whatsapp:connections.modal.leaveBlankUnchanged')})</span>}
                    </label>
                    <input
                      type="password"
                      value={form.evolutionApiKeyEncrypted}
                      onChange={(e) => setForm((f) => ({ ...f, evolutionApiKeyEncrypted: e.target.value }))}
                      placeholder={editingId ? t('whatsapp:connections.modal.configuredPlaceholder') : t('whatsapp:connections.modal.evolutionApiKeyPlaceholder')}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 outline-none"
                    />
                    {editingId && (
                      <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                        {t('whatsapp:connections.modal.apiKeyEncryptedHint')}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('whatsapp:connections.modal.webhookSecret')} <span className="text-gray-400">({t('whatsapp:connections.modal.optional')})</span>
                    </label>
                    <input
                      type="password"
                      value={form.webhookSecret}
                      onChange={(e) => setForm((f) => ({ ...f, webhookSecret: e.target.value }))}
                      placeholder={editingId ? t('whatsapp:connections.modal.configuredIfPlaceholder') : t('whatsapp:connections.modal.webhookSecretPlaceholder')}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Meta Cloud API — Embedded Signup first */}
              {form.provider === 'meta_cloud_api' && (
                <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-gray-700">
                  {META_ENV_READY ? (
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg space-y-3">
                      <p className="text-sm text-gray-700 dark:text-gray-300">
                        {t('whatsapp:connections.modal.metaEmbeddedDescription')}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setShowModal(false);
                          handleMetaEmbeddedSignup(form.linkedClinicIds);
                        }}
                        disabled={metaConnecting}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        {metaConnecting ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                        {t('whatsapp:connections.actions.connectMetaAutomatic')}
                      </button>
                    </div>
                  ) : (
                    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg text-sm text-amber-700 dark:text-amber-300">
                      {t('whatsapp:connections.modal.metaEmbeddedNotReady')}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowAdvancedMetaSetup((v) => !v)}
                    className="w-full flex items-center gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide hover:text-gray-700 dark:hover:text-gray-200"
                  >
                    {showAdvancedMetaSetup ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {showAdvancedMetaSetup
                      ? t('whatsapp:connections.modal.advancedManualSetup.toggleHide')
                      : t('whatsapp:connections.modal.advancedManualSetup.toggleShow')}
                  </button>

                  {showAdvancedMetaSetup && (
                    <div className="space-y-3 pl-3 border-l-2 border-gray-100 dark:border-gray-700">
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {t('whatsapp:connections.modal.advancedManualSetup.hint')}
                      </p>
                      {[
                        { key: 'metaBusinessId', label: t('whatsapp:connections.modal.metaBusinessId') },
                        { key: 'metaWabaId', label: t('whatsapp:connections.modal.metaWabaId') },
                        { key: 'metaPhoneNumberId', label: t('whatsapp:connections.modal.metaPhoneNumberId') },
                        { key: 'metaAppId', label: t('whatsapp:connections.modal.metaAppId') },
                        { key: 'metaWebhookVerifyToken', label: t('whatsapp:connections.modal.metaWebhookVerifyToken') },
                      ].map(({ key, label }) => (
                        <div key={key}>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            {label}
                          </label>
                          <input
                            value={form[key as keyof ConnectionFormData] as string}
                            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                          />
                        </div>
                      ))}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          {t('whatsapp:connections.modal.webhookSecret')} <span className="text-gray-400">({t('whatsapp:connections.modal.optionalSignature')})</span>
                        </label>
                        <input
                          type="password"
                          value={form.metaWebhookSecret}
                          onChange={(e) => setForm((f) => ({ ...f, metaWebhookSecret: e.target.value }))}
                          placeholder={editingId ? t('whatsapp:connections.modal.configuredIfPlaceholder') : t('whatsapp:connections.modal.metaWebhookSecretPlaceholder')}
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          {t('whatsapp:connections.modal.accessToken')} {editingId && <span className="text-gray-400">({t('whatsapp:connections.modal.leaveBlankUnchanged')})</span>}
                        </label>
                        <input
                          type="password"
                          value={form.metaAccessTokenEncrypted}
                          onChange={(e) => setForm((f) => ({ ...f, metaAccessTokenEncrypted: e.target.value }))}
                          placeholder={editingId ? t('whatsapp:connections.modal.configuredPlaceholder') : t('whatsapp:connections.modal.accessTokenPlaceholder')}
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                        {editingId && (
                          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                            {t('whatsapp:connections.modal.accessTokenEncryptedHint')}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Clinic assignment */}
              {clinicOptions.length > 0 && (
                <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                    {t('whatsapp:connections.modal.branchAssignment')}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
                    {t('whatsapp:connections.modal.branchAssignmentHint')}
                  </p>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {clinicOptions.map((clinic) => (
                      <label
                        key={clinic.id}
                        className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 px-2 py-1 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={form.linkedClinicIds.includes(clinic.id)}
                          onChange={() => toggleClinicId(clinic.id)}
                          className="accent-green-600"
                        />
                        {clinic.name}
                      </label>
                    ))}
                  </div>
                  {form.linkedClinicIds.length === 0 && (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                      {t('whatsapp:connections.modal.noBranchSelected')}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                {t('common:cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {editingId ? t('common:save') : t('common:add')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
