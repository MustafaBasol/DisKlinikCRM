import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Inbox, AlertCircle, CheckCircle2, RefreshCw, User, Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import { whatsappInboxService, patientService } from '../services/api';
import {
  canViewWhatsAppInbox,
  canResolveWhatsAppConversation,
  canLinkWhatsAppPatient,
  normalizeRole,
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
  const { t } = useTranslation(['whatsapp', 'common']);
  const { formatDate } = useClinicPreferences();
  const [activeTab, setActiveTab] = useState<'unassigned' | 'all'>('unassigned');
  const [unassigned, setUnassigned] = useState<InboxEntry[]>([]);
  const [conversations, setConversations] = useState<InboxEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterClinic, setFilterClinic] = useState('');
  const [resolveModal, setResolveModal] = useState<ResolveModal | null>(null);
  const [resolving, setResolving] = useState(false);
  const role = normalizeRole(user?.role ?? '', user?.canAccessAllClinics ?? false);
  const canSeeUnassigned = role === 'OWNER' || role === 'ORG_ADMIN';

  useEffect(() => {
    if (!canViewWhatsAppInbox(user)) {
      navigate('/');
    }
  }, [user, navigate]);

  useEffect(() => {
    if (user && !canSeeUnassigned && activeTab === 'unassigned') {
      setActiveTab('all');
    }
  }, [activeTab, canSeeUnassigned, user]);

  useEffect(() => {
    if (activeTab === 'unassigned') {
      if (canSeeUnassigned) loadUnassigned();
    } else {
      loadConversations();
    }
  }, [activeTab, filterStatus, filterClinic, canSeeUnassigned]);

  async function loadUnassigned() {
    setLoading(true);
    setError('');
    try {
      const res = await whatsappInboxService.getUnassigned();
      setUnassigned(res.data.unassigned || res.data.entries || []);
    } catch {
      setError(t('whatsapp:inbox.errors.loadUnassigned'));
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
      setConversations(res.data.conversations || res.data.entries || []);
    } catch {
      setError(t('whatsapp:inbox.errors.loadConversations'));
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
      setError(t('whatsapp:inbox.errors.resolveFailed'));
    } finally {
      setResolving(false);
    }
  }

  async function handleLinkPatient(entryId: string, patientId: string) {
    if (!canLinkWhatsAppPatient(user)) return;
    try {
      await whatsappInboxService.linkPatient(entryId, patientId);
      if (activeTab === 'unassigned') {
        loadUnassigned();
      } else {
        loadConversations();
      }
    } catch {
      setError(t('whatsapp:inbox.errors.linkPatientFailed'));
    }
  }

  const canResolve = canResolveWhatsAppConversation(user);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Inbox className="text-green-600" size={28} />
        <h1 className="text-2xl font-bold text-gray-800">{t('whatsapp:inbox.title')}</h1>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {canSeeUnassigned && (
          <button
            onClick={() => setActiveTab('unassigned')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === 'unassigned'
                ? 'bg-white border border-b-white border-gray-200 text-green-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('whatsapp:inbox.tabs.unassigned')}
            {unassigned.length > 0 && (
              <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
                {unassigned.length}
              </span>
            )}
          </button>
        )}
        <button
          onClick={() => setActiveTab('all')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
            activeTab === 'all'
              ? 'bg-white border border-b-white border-gray-200 text-green-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {t('whatsapp:inbox.tabs.all')}
        </button>
      </div>

      {/* Filters for All tab */}
      {activeTab === 'all' && (
        <div className="flex gap-2 mb-4 flex-wrap">
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">{t('whatsapp:inbox.filters.allStatuses')}</option>
            <option value="unassigned">{t('whatsapp:inbox.status.unassigned')}</option>
            <option value="assigned">{t('whatsapp:inbox.status.assigned')}</option>
          </select>
          <input
            type="text"
            placeholder={t('whatsapp:inbox.filters.clinicIdPlaceholder')}
            value={filterClinic}
            onChange={e => setFilterClinic(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[140px]"
          />
          <button
            onClick={loadConversations}
            className="flex items-center gap-1 px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            <RefreshCw size={14} />
            {t('common:refresh')}
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
            {t('common:refresh')}
          </button>
        </div>
      )}

      {loading && (
        <div className="text-center py-12 text-gray-500">{t('common:loading')}</div>
      )}

      {!loading && activeTab === 'unassigned' && (
        <>
          {unassigned.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <CheckCircle2 size={40} className="mx-auto mb-2 text-green-400" />
              <p>{t('whatsapp:inbox.empty.unassigned')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {unassigned.map(entry => (
                <div key={entry.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-semibold text-gray-800">{entry.phone}</span>
                        {entry.displayName && (
                          <span className="text-sm text-gray-500">({entry.displayName})</span>
                        )}
                        <span className="text-xs bg-yellow-100 text-yellow-700 rounded-full px-2 py-0.5">
                          {t('whatsapp:inbox.messageCount', { count: entry.messageCount })}
                        </span>
                      </div>
                      {entry.lastMessageText && (
                        <p className="text-sm text-gray-600 truncate mb-2">{entry.lastMessageText}</p>
                      )}
                      {entry.possiblePatients && entry.possiblePatients.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-1">
                          <span className="text-xs text-gray-400">{t('whatsapp:inbox.possiblePatients')}:</span>
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
                    <div className="flex items-center gap-2 sm:shrink-0">
                      <span className="text-xs text-gray-400">
                        {formatDate(entry.createdAt)}
                      </span>
                      {canResolve && (
                        <button
                          onClick={() => openResolveModal(entry)}
                          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
                        >
                          <Building2 size={14} />
                          {t('whatsapp:inbox.actions.assignClinic')}
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
            <div className="text-center py-12 text-gray-400">{t('whatsapp:inbox.empty.conversations')}</div>
          ) : (
            <div className="space-y-3">
              {conversations.map(entry => (
                <div key={entry.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
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
                          {entry.status === 'resolved'
                            ? t('whatsapp:inbox.status.resolved')
                            : entry.needsClinicResolution
                              ? t('whatsapp:inbox.status.unassigned')
                              : t('whatsapp:inbox.status.open')}
                        </span>
                        <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                          {t('whatsapp:inbox.messageCount', { count: entry.messageCount })}
                        </span>
                      </div>
                      {entry.lastMessageText && (
                        <p className="text-sm text-gray-600 truncate mb-2">{entry.lastMessageText}</p>
                      )}
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
                      {formatDate(entry.updatedAt)}
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
            <h2 className="text-lg font-semibold mb-4">{t('whatsapp:inbox.resolveModal.title')}</h2>
            <p className="text-sm text-gray-600 mb-4">
              {t('whatsapp:inbox.resolveModal.description', { phone: resolveModal.entry.phone })}
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('whatsapp:inbox.resolveModal.clinicId')} *</label>
              <input
                type="text"
                value={resolveModal.clinicId}
                onChange={e => setResolveModal({ ...resolveModal, clinicId: e.target.value })}
                placeholder={t('whatsapp:inbox.resolveModal.clinicIdPlaceholder')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('whatsapp:inbox.resolveModal.patientOptional')}</label>
              {resolveModal.patients.length > 0 && !resolveModal.patientId && (
                <div className="mb-2 space-y-1">
                  <p className="text-xs text-gray-500">{t('whatsapp:inbox.resolveModal.matchingPatients')}:</p>
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
                    {t('whatsapp:inbox.resolveModal.patientSelected', { id: resolveModal.patientId })}
                  </span>
                  <button
                    onClick={() => setResolveModal({ ...resolveModal, patientId: '' })}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    {t('common:remove')}
                  </button>
                </div>
              ) : (
                <input
                  type="text"
                  value={resolveModal.patientSearch}
                  onChange={e => searchPatients(e.target.value)}
                  placeholder={t('whatsapp:inbox.resolveModal.searchPatient')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              )}
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setResolveModal(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                {t('common:cancel')}
              </button>
              <button
                onClick={handleResolve}
                disabled={!resolveModal.clinicId || resolving}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {resolving ? t('common:saving') : t('common:save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
