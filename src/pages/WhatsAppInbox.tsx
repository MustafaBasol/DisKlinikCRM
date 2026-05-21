import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Inbox, AlertCircle, CheckCircle2, RefreshCw, User, Building2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { whatsappInboxService, patientService } from '../services/api';
import {
  canViewWhatsAppInbox,
  canResolveWhatsAppConversation,
  canLinkWhatsAppPatient,
} from '../utils/permissions';

interface PossiblePatient {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
}

interface InboxEntry {
  id: string;
  phone: string;
  displayName?: string;
  lastMessageText?: string;
  messageCount: number;
  needsClinicResolution: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
  clinicId?: string;
  patientId?: string;
  whatsappConnectionId?: string;
  possiblePatients?: PossiblePatient[];
  clinic?: { id: string; name: string };
  patient?: { id: string; firstName: string; lastName: string };
  resolvedByUser?: { id: string; name: string };
}

interface ResolveModal {
  entry: InboxEntry;
  clinicId: string;
  patientId: string;
  patientSearch: string;
  patients: PossiblePatient[];
}

export default function WhatsAppInbox() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'unassigned' | 'all'>('unassigned');
  const [unassigned, setUnassigned] = useState<InboxEntry[]>([]);
  const [conversations, setConversations] = useState<InboxEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterClinic, setFilterClinic] = useState('');
  const [resolveModal, setResolveModal] = useState<ResolveModal | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!canViewWhatsAppInbox(user)) {
      navigate('/');
    }
  }, [user, navigate]);

  useEffect(() => {
    if (activeTab === 'unassigned') {
      loadUnassigned();
    } else {
      loadConversations();
    }
  }, [activeTab, filterStatus, filterClinic]);

  async function loadUnassigned() {
    setLoading(true);
    setError('');
    try {
      const res = await whatsappInboxService.getUnassigned();
      setUnassigned(res.data.entries || []);
    } catch {
      setError('Atanmamış konuşmalar yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }

  async function loadConversations() {
    setLoading(true);
    setError('');
    try {
      const params: { status?: string; clinicId?: string } = {};
      if (filterStatus) params.status = filterStatus;
      if (filterClinic) params.clinicId = filterClinic;
      const res = await whatsappInboxService.getConversations(params);
      setConversations(res.data.entries || []);
    } catch {
      setError('Konuşmalar yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }

  async function openResolveModal(entry: InboxEntry) {
    let patients: PossiblePatient[] = entry.possiblePatients || [];
    setResolveModal({ entry, clinicId: '', patientId: entry.patientId || '', patientSearch: '', patients });
  }

  async function searchPatients(q: string) {
    if (!resolveModal) return;
    setResolveModal({ ...resolveModal, patientSearch: q });
    if (q.length < 2) return;
    try {
      const res = await patientService.getAll({ search: q, limit: 10 });
      setResolveModal(prev => prev ? { ...prev, patients: res.data.patients || [] } : prev);
    } catch {
      // ignore search errors
    }
  }

  async function handleResolve() {
    if (!resolveModal || !resolveModal.clinicId) return;
    setResolving(true);
    try {
      await whatsappInboxService.resolve(resolveModal.entry.id, {
        clinicId: resolveModal.clinicId,
        ...(resolveModal.patientId ? { patientId: resolveModal.patientId } : {}),
      });
      setResolveModal(null);
      loadUnassigned();
      if (activeTab === 'all') loadConversations();
    } catch {
      setError('Çözümleme başarısız oldu.');
    } finally {
      setResolving(false);
    }
  }

  async function handleLinkPatient(entryId: string, patientId: string) {
    if (!canLinkWhatsAppPatient(user)) return;
    try {
      await whatsappInboxService.linkPatient(entryId, patientId);
      loadUnassigned();
    } catch {
      setError('Hasta bağlama başarısız oldu.');
    }
  }

  const canResolve = canResolveWhatsAppConversation(user);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Inbox className="text-green-600" size={28} />
        <h1 className="text-2xl font-bold text-gray-800">WhatsApp Gelen Kutusu</h1>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('unassigned')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
            activeTab === 'unassigned'
              ? 'bg-white border border-b-white border-gray-200 text-green-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Atanmamış
          {unassigned.length > 0 && (
            <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
              {unassigned.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('all')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
            activeTab === 'all'
              ? 'bg-white border border-b-white border-gray-200 text-green-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Tüm Konuşmalar
        </button>
      </div>

      {/* Filters for All tab */}
      {activeTab === 'all' && (
        <div className="flex gap-3 mb-4">
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Tüm Durumlar</option>
            <option value="unassigned">Atanmamış</option>
            <option value="assigned">Atanmış</option>
          </select>
          <input
            type="text"
            placeholder="Klinik ID filtrele..."
            value={filterClinic}
            onChange={e => setFilterClinic(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-56"
          />
          <button
            onClick={loadConversations}
            className="flex items-center gap-1 px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            <RefreshCw size={14} />
            Yenile
          </button>
        </div>
      )}

      {activeTab === 'unassigned' && (
        <div className="flex justify-end mb-4">
          <button
            onClick={loadUnassigned}
            className="flex items-center gap-1 px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            <RefreshCw size={14} />
            Yenile
          </button>
        </div>
      )}

      {loading && (
        <div className="text-center py-12 text-gray-500">Yükleniyor...</div>
      )}

      {!loading && activeTab === 'unassigned' && (
        <>
          {unassigned.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <CheckCircle2 size={40} className="mx-auto mb-2 text-green-400" />
              <p>Atanmamış konuşma yok.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {unassigned.map(entry => (
                <div key={entry.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-800">{entry.phone}</span>
                        {entry.displayName && (
                          <span className="text-sm text-gray-500">({entry.displayName})</span>
                        )}
                        <span className="text-xs bg-yellow-100 text-yellow-700 rounded-full px-2 py-0.5">
                          {entry.messageCount} mesaj
                        </span>
                      </div>
                      {entry.lastMessageText && (
                        <p className="text-sm text-gray-600 truncate mb-2">{entry.lastMessageText}</p>
                      )}
                      {entry.possiblePatients && entry.possiblePatients.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-1">
                          <span className="text-xs text-gray-400">Olası hastalar:</span>
                          {entry.possiblePatients.map(p => (
                            <button
                              key={p.id}
                              onClick={() => canLinkWhatsAppPatient(user) && handleLinkPatient(entry.id, p.id)}
                              disabled={!canLinkWhatsAppPatient(user)}
                              className="flex items-center gap-1 text-xs bg-blue-50 text-blue-700 rounded-full px-2 py-0.5 hover:bg-blue-100 disabled:opacity-50"
                            >
                              <User size={10} />
                              {p.firstName} {p.lastName}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-gray-400">
                        {new Date(entry.createdAt).toLocaleDateString('tr-TR')}
                      </span>
                      {canResolve && (
                        <button
                          onClick={() => openResolveModal(entry)}
                          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
                        >
                          <Building2 size={14} />
                          Kliniğe Ata
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!loading && activeTab === 'all' && (
        <>
          {conversations.length === 0 ? (
            <div className="text-center py-12 text-gray-400">Konuşma bulunamadı.</div>
          ) : (
            <div className="space-y-3">
              {conversations.map(entry => (
                <div key={entry.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-800">{entry.phone}</span>
                        {entry.displayName && (
                          <span className="text-sm text-gray-500">({entry.displayName})</span>
                        )}
                        <span className={`text-xs rounded-full px-2 py-0.5 ${
                          entry.status === 'resolved'
                            ? 'bg-green-100 text-green-700'
                            : entry.needsClinicResolution
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {entry.status === 'resolved' ? 'Çözüldü' : entry.needsClinicResolution ? 'Atanmamış' : 'Açık'}
                        </span>
                      </div>
                      {entry.clinic && (
                        <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                          <Building2 size={12} />
                          {entry.clinic.name}
                        </div>
                      )}
                      {entry.patient && (
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <User size={12} />
                          {entry.patient.firstName} {entry.patient.lastName}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 shrink-0">
                      {new Date(entry.updatedAt).toLocaleDateString('tr-TR')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Resolve Modal */}
      {resolveModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">Kliniğe Ata</h2>
            <p className="text-sm text-gray-600 mb-4">
              <span className="font-medium">{resolveModal.entry.phone}</span> numaralı konuşmayı bir kliniğe atayın.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Klinik ID *</label>
              <input
                type="text"
                value={resolveModal.clinicId}
                onChange={e => setResolveModal({ ...resolveModal, clinicId: e.target.value })}
                placeholder="Klinik ID girin..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">Hasta (opsiyonel)</label>
              {resolveModal.patients.length > 0 && !resolveModal.patientId && (
                <div className="mb-2 space-y-1">
                  <p className="text-xs text-gray-500">Eşleşen hastalar:</p>
                  {resolveModal.patients.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setResolveModal({ ...resolveModal, patientId: p.id })}
                      className="w-full text-left text-sm px-3 py-1.5 bg-blue-50 hover:bg-blue-100 rounded-lg"
                    >
                      {p.firstName} {p.lastName} — {p.phone}
                    </button>
                  ))}
                </div>
              )}
              {resolveModal.patientId ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-green-700 bg-green-50 px-3 py-1.5 rounded-lg flex-1">
                    Hasta seçildi (ID: {resolveModal.patientId})
                  </span>
                  <button
                    onClick={() => setResolveModal({ ...resolveModal, patientId: '' })}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Kaldır
                  </button>
                </div>
              ) : (
                <input
                  type="text"
                  value={resolveModal.patientSearch}
                  onChange={e => searchPatients(e.target.value)}
                  placeholder="Hasta ara..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              )}
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setResolveModal(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                İptal
              </button>
              <button
                onClick={handleResolve}
                disabled={!resolveModal.clinicId || resolving}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {resolving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
