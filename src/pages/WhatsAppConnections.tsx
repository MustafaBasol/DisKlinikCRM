import { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
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
} from 'lucide-react';
import { whatsappConnectionService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { canManageWhatsAppConnections, canViewWhatsAppStatus } from '../utils/permissions';

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
  createdAt: string;
  clinics?: Array<{
    id: string;
    clinicId: string;
    clinic: { id: string; name: string };
    isDefault: boolean;
  }>;
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
  const [connections, setConnections] = useState<WhatsAppConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const canManage = canManageWhatsAppConnections(user);
  const canView = canViewWhatsAppStatus(user);

  if (!canView) return <Navigate to="/" replace />;

  const fetchConnections = useCallback(async () => {
    try {
      setLoading(true);
      const res = await whatsappConnectionService.list();
      setConnections(res.data);
    } catch {
      setError('WhatsApp bağlantıları yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
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
      metaWabaId: '',
      metaPhoneNumberId: conn.metaPhoneNumberId ?? '',
      metaAppId: '',
      metaAccessTokenEncrypted: '', // Don't pre-fill secrets
      metaWebhookVerifyToken: '',
    });
    setFormError(null);
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setFormError('Bağlantı adı zorunludur.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      // Build clean payload — omit empty strings for optional fields
      const payload: Record<string, unknown> = { name: form.name.trim(), provider: form.provider };
      if (form.phoneNumber) payload.phoneNumber = form.phoneNumber;
      if (form.displayName) payload.displayName = form.displayName;

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
      }

      if (editingId) {
        await whatsappConnectionService.update(editingId, payload);
      } else {
        await whatsappConnectionService.create(payload);
      }
      setShowModal(false);
      fetchConnections();
    } catch (err: any) {
      setFormError(err?.response?.data?.error ?? 'Kayıt başarısız.');
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
      setTestResults((prev) => ({ ...prev, [id]: { success: false, message: 'Test isteği başarısız.' } }));
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
    if (!confirm(`"${name}" bağlantısını kesmek istediğinizden emin misiniz?`)) return;
    setDisconnectingId(id);
    try {
      await whatsappConnectionService.disconnect(id);
      fetchConnections();
    } catch {
      alert('Bağlantı kesilemedi.');
    } finally {
      setDisconnectingId(null);
    }
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
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">WhatsApp Bağlantıları</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Organizasyon genelinde WhatsApp bağlantılarını yönetin
            </p>
          </div>
        </div>
        {canManage && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            Yeni Bağlantı
          </button>
        )}
      </div>

      {/* Provider info banner */}
      <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-700 dark:text-blue-300">
        <strong>Evolution API</strong> aktif olarak kullanılmaktadır.{' '}
        <strong>Meta Cloud API</strong> desteği gelecek sürümde eklenecektir.
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-gray-400" size={32} />
        </div>
      ) : connections.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <MessageCircle size={40} className="mx-auto mb-3 opacity-40" />
          <p>Henüz WhatsApp bağlantısı eklenmemiş.</p>
          {canManage && (
            <button onClick={openCreate} className="mt-3 text-green-600 dark:text-green-400 hover:underline text-sm">
              İlk bağlantıyı ekle
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {connections.map((conn) => (
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
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <WifiOff size={12} />
                        inactive
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
                      Şubeler: {conn.clinics.map((c) => c.clinic.name).join(', ')}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {canManage && (
                    <>
                      <button
                        onClick={() => handleTest(conn.id)}
                        disabled={testingId === conn.id}
                        title="Bağlantıyı Test Et"
                        className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                      >
                        {testingId === conn.id ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <CheckCircle2 size={16} />
                        )}
                      </button>
                      {conn.provider === 'evolution_api' && (
                        <button
                          onClick={() => handleGetQr(conn.id)}
                          title="QR Kodu Al"
                          className="p-2 text-gray-400 hover:text-green-600 dark:hover:text-green-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        >
                          <QrCode size={16} />
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(conn)}
                        title="Düzenle"
                        className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => handleDisconnect(conn.id, conn.name)}
                        disabled={disconnectingId === conn.id}
                        title="Bağlantıyı Kes"
                        className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                      >
                        {disconnectingId === conn.id ? (
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
                  {qrData[conn.id] ? (
                    <div className="flex flex-col items-start gap-2">
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        WhatsApp'ı QR kod ile bağlayın:
                      </p>
                      <img
                        src={`data:image/png;base64,${qrData[conn.id]}`}
                        alt="QR Code"
                        className="w-48 h-48 border border-gray-200 dark:border-gray-600 rounded-lg"
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      QR kodu mevcut değil — bağlantı zaten aktif olabilir.
                    </p>
                  )}
                  <button
                    onClick={() => setShowQrFor(null)}
                    className="mt-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    Kapat
                  </button>
                </div>
              )}

              {/* Expanded details */}
              {expandedId === conn.id && (
                <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                    {conn.evolutionApiUrl && (
                      <>
                        <dt>API URL</dt>
                        <dd className="truncate text-gray-700 dark:text-gray-300">{conn.evolutionApiUrl}</dd>
                      </>
                    )}
                    {conn.evolutionInstanceName && (
                      <>
                        <dt>Instance</dt>
                        <dd className="text-gray-700 dark:text-gray-300">{conn.evolutionInstanceName}</dd>
                      </>
                    )}
                    {conn.metaPhoneNumberId && (
                      <>
                        <dt>Phone Number ID</dt>
                        <dd className="text-gray-700 dark:text-gray-300">{conn.metaPhoneNumberId}</dd>
                      </>
                    )}
                    {conn.metaBusinessId && (
                      <>
                        <dt>Business ID</dt>
                        <dd className="text-gray-700 dark:text-gray-300">{conn.metaBusinessId}</dd>
                      </>
                    )}
                    <dt>Oluşturuldu</dt>
                    <dd>{new Date(conn.createdAt).toLocaleDateString('tr-TR')}</dd>
                  </dl>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Create / Edit Modal ──────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                {editingId ? 'Bağlantıyı Düzenle' : 'Yeni WhatsApp Bağlantısı'}
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
                  Bağlantı Adı <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="örn: Ana Şube WhatsApp"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Sağlayıcı
                </label>
                <select
                  value={form.provider}
                  onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as Provider }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 outline-none"
                >
                  <option value="evolution_api">Evolution API (Aktif)</option>
                  <option value="meta_cloud_api">Meta Cloud API (Yakında)</option>
                </select>
                {form.provider === 'meta_cloud_api' && (
                  <p className="mt-1 text-xs text-yellow-600 dark:text-yellow-400">
                    Meta Cloud API mesaj gönderimi henüz aktif değil. Bilgiler kaydedilebilir.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Telefon Numarası
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
                    Görünen Ad
                  </label>
                  <input
                    value={form.displayName}
                    onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                    placeholder="Klinik WhatsApp"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 outline-none"
                  />
                </div>
              </div>

              {/* Evolution API fields */}
              {form.provider === 'evolution_api' && (
                <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Evolution API Ayarları
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      API URL
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
                      Instance Adı
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
                      API Key {editingId && <span className="text-gray-400">(boş bırakılırsa değişmez)</span>}
                    </label>
                    <input
                      type="password"
                      value={form.evolutionApiKeyEncrypted}
                      onChange={(e) => setForm((f) => ({ ...f, evolutionApiKeyEncrypted: e.target.value }))}
                      placeholder={editingId ? '••••••••' : 'Evolution API anahtarı'}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Meta Cloud API fields */}
              {form.provider === 'meta_cloud_api' && (
                <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Meta Cloud API Ayarları
                  </p>
                  {[
                    { key: 'metaBusinessId', label: 'Business ID' },
                    { key: 'metaWabaId', label: 'WhatsApp Business Account ID' },
                    { key: 'metaPhoneNumberId', label: 'Phone Number ID' },
                    { key: 'metaAppId', label: 'App ID' },
                    { key: 'metaWebhookVerifyToken', label: 'Webhook Verify Token' },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {label}
                      </label>
                      <input
                        value={form[key as keyof ConnectionFormData]}
                        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 outline-none"
                      />
                    </div>
                  ))}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Access Token {editingId && <span className="text-gray-400">(boş bırakılırsa değişmez)</span>}
                    </label>
                    <input
                      type="password"
                      value={form.metaAccessTokenEncrypted}
                      onChange={(e) => setForm((f) => ({ ...f, metaAccessTokenEncrypted: e.target.value }))}
                      placeholder={editingId ? '••••••••' : 'Meta Access Token'}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 outline-none"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                İptal
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {editingId ? 'Kaydet' : 'Oluştur'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
