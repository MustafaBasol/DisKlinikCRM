import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Inbox,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  User,
  Building2,
  Send,
  Loader2,
  XCircle,
  CalendarPlus,
  Calendar,
  MessageSquare,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import { whatsappInboxService, patientService, userService, serviceService } from '../services/api';
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

interface ConversationMessage {
  id: string;
  direction: string;
  text: string;
  createdAt: string;
}

interface AppointmentModal {
  entry: InboxEntry;
  patientId: string;
  clinicId: string;
  practitionerId: string;
  appointmentTypeId: string;
  date: string;
  time: string;
  notes: string;
  doctors: Array<{ id: string; firstName: string; lastName: string }>;
  services: Array<{ id: string; name: string; durationMinutes: number }>;
  loadingData: boolean;
}

export default function WhatsAppInbox() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation(['whatsapp', 'common']);
  const { formatDate, formatDateTime } = useClinicPreferences();
  const [activeTab, setActiveTab] = useState<'unassigned' | 'all'>('unassigned');
  const [unassigned, setUnassigned] = useState<InboxEntry[]>([]);
  const [conversations, setConversations] = useState<InboxEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterClinic, setFilterClinic] = useState('');
  const [resolveModal, setResolveModal] = useState<ResolveModal | null>(null);
  const [resolving, setResolving] = useState(false);
  const [detailEntry, setDetailEntry] = useState<InboxEntry | null>(null);
  const [detailMessages, setDetailMessages] = useState<ConversationMessage[]>([]);
  const [detailPartial, setDetailPartial] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [apptModal, setApptModal] = useState<AppointmentModal | null>(null);
  const [savingAppt, setSavingAppt] = useState(false);
  const [toast, setToast] = useState<{ success: boolean; message: string } | null>(null);
  const role = normalizeRole(user?.role ?? '', user?.canAccessAllClinics ?? false);
  const canSeeUnassigned = role === 'OWNER' || role === 'ORG_ADMIN';
  const canReply = canViewWhatsAppInbox(user);

  useEffect(() => {
    if (!canViewWhatsAppInbox(user)) {
      navigate('/dashboard');
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

  function reload() {
    if (activeTab === 'unassigned') loadUnassigned();
    else loadConversations();
  }

  // ── Conversation detail ──────────────────────────────────────────────────

  async function openDetail(entry: InboxEntry) {
    setDetailEntry(entry);
    setDetailError('');
    setReplyText('');
    setLoadingMessages(true);
    try {
      const res = await whatsappInboxService.getMessages(entry.id);
      setDetailMessages(res.data.messages || []);
      setDetailPartial(Boolean(res.data.partial));
    } catch {
      setDetailMessages([]);
      setDetailPartial(true);
    } finally {
      setLoadingMessages(false);
    }
  }

  function closeDetail() {
    setDetailEntry(null);
    setDetailMessages([]);
    setReplyText('');
    setDetailError('');
  }

  async function handleReply() {
    if (!detailEntry || !replyText.trim()) return;
    setReplying(true);
    setDetailError('');
    try {
      await whatsappInboxService.reply(detailEntry.id, replyText.trim());
      setReplyText('');
      const res = await whatsappInboxService.getMessages(detailEntry.id);
      setDetailMessages(res.data.messages || []);
      setDetailPartial(Boolean(res.data.partial));
      reload();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setDetailError(msg ?? t('whatsapp:inbox.errors.messageSendFailed'));
    } finally {
      setReplying(false);
    }
  }

  async function handleConvertToRequest(entry: InboxEntry) {
    if (!entry.clinicId) {
      setDetailError(t('whatsapp:inbox.errors.assignClinicFirst'));
      return;
    }
    if (!window.confirm(t('whatsapp:inbox.confirm.convertToRequest'))) return;
    setConvertingId(entry.id);
    try {
      await whatsappInboxService.createAppointmentRequest(entry.id);
      setToast({ success: true, message: t('whatsapp:inbox.success.requestCreated') });
      closeDetail();
      reload();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setDetailError(msg ?? t('whatsapp:inbox.errors.requestCreateFailed'));
    } finally {
      setConvertingId(null);
      setTimeout(() => setToast(null), 3000);
    }
  }

  async function openAppointmentModal(entry: InboxEntry) {
    if (!entry.clinicId || !entry.patientId) {
      setDetailError(t('whatsapp:inbox.errors.assignClinicAndPatientFirst'));
      return;
    }
    const modal: AppointmentModal = {
      entry,
      patientId: entry.patientId,
      clinicId: entry.clinicId,
      practitionerId: '',
      appointmentTypeId: '',
      date: new Date().toISOString().split('T')[0],
      time: '09:00',
      notes: t('whatsapp:inbox.appointment.defaultNotes', { phone: entry.phone }),
      doctors: [],
      services: [],
      loadingData: true,
    };
    setApptModal(modal);
    try {
      const [docRes, svcRes] = await Promise.all([
        userService.getDoctors(),
        serviceService.getAll({ onlyActive: true }),
      ]);
      setApptModal(prev => prev ? { ...prev, doctors: docRes.data ?? [], services: svcRes.data ?? [], loadingData: false } : null);
    } catch {
      setApptModal(prev => prev ? { ...prev, loadingData: false } : null);
    }
  }

  async function handleCreateAppointment() {
    if (!apptModal) return;
    const { entry, patientId, clinicId, practitionerId, appointmentTypeId, date, time, notes } = apptModal;
    if (!practitionerId || !appointmentTypeId || !date || !time) {
      setError(t('whatsapp:inbox.errors.appointmentRequiredFields'));
      return;
    }
    setSavingAppt(true);
    try {
      await whatsappInboxService.createAppointment(entry.id, {
        patientId, clinicId, practitionerId, appointmentTypeId, date, time, notes,
      });
      setApptModal(null);
      setToast({ success: true, message: t('whatsapp:inbox.success.appointmentCreated') });
      closeDetail();
      reload();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? t('whatsapp:inbox.errors.appointmentCreateFailed'));
    } finally {
      setSavingAppt(false);
      setTimeout(() => setToast(null), 3000);
    }
  }

  function goToAppointmentForm(entry: InboxEntry) {
    const params = new URLSearchParams({ source: 'whatsapp', whatsappInboxEntryId: entry.id });
    if (entry.patientId) params.set('patientId', entry.patientId);
    if (entry.clinicId) params.set('clinicId', entry.clinicId);
    navigate(`/appointments?${params.toString()}`);
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
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
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openDetail(entry)}>
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
                              onClick={(e) => { e.stopPropagation(); canLinkWhatsAppPatient(user) && handleLinkPatient(entry.id, p.id); }}
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
                          onClick={(e) => { e.stopPropagation(); openResolveModal(entry); }}
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
                <div
                  key={entry.id}
                  className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm cursor-pointer hover:border-green-300 transition-colors"
                  onClick={() => openDetail(entry)}
                >
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

      {/* Conversation Detail Modal */}
      {detailEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
              <div>
                <h2 className="font-semibold text-gray-900">{detailEntry.phone}</h2>
                {detailEntry.displayName && (
                  <p className="text-xs text-gray-500">{detailEntry.displayName}</p>
                )}
              </div>
              <button onClick={closeDetail} className="text-gray-400 hover:text-gray-600">
                <XCircle size={20} />
              </button>
            </div>

            {detailError && (
              <div className="mx-6 mt-3 p-2.5 bg-red-50 text-red-600 rounded-lg text-sm flex items-center gap-2 shrink-0">
                <AlertCircle size={14} />
                {detailError}
              </div>
            )}

            {!detailEntry.clinicId && (
              <div className="mx-6 mt-3 p-2.5 bg-yellow-50 text-yellow-700 rounded-lg text-sm flex items-center gap-2 shrink-0">
                <AlertCircle size={14} />
                {t('whatsapp:inbox.errors.assignClinicFirst')}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
              {loadingMessages ? (
                <div className="flex justify-center py-8"><Loader2 className="animate-spin text-green-600" size={24} /></div>
              ) : detailMessages.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">{t('whatsapp:inbox.detail.noMessages')}</p>
              ) : (
                <>
                  {detailPartial && (
                    <p className="text-xs text-gray-400 text-center mb-2">{t('whatsapp:inbox.detail.partialHistory')}</p>
                  )}
                  {detailMessages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                        msg.direction === 'outgoing'
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                        <p className={`text-[10px] mt-1 ${msg.direction === 'outgoing' ? 'text-green-100' : 'text-gray-400'}`}>
                          {formatDateTime(msg.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>

            <div className="px-6 py-3 border-t border-gray-200 flex flex-wrap gap-2 shrink-0">
              {canViewWhatsAppInbox(user) && detailEntry.status !== 'resolved' && (
                <button
                  onClick={() => handleConvertToRequest(detailEntry)}
                  disabled={convertingId === detailEntry.id || !detailEntry.clinicId}
                  title={!detailEntry.clinicId ? t('whatsapp:inbox.errors.assignClinicFirst') : t('whatsapp:inbox.actions.createRequest')}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-purple-50 text-purple-700 rounded-lg text-xs font-medium hover:bg-purple-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {convertingId === detailEntry.id ? <Loader2 size={12} className="animate-spin" /> : <CalendarPlus size={12} />}
                  {t('whatsapp:inbox.actions.createRequest')}
                </button>
              )}
              {canViewWhatsAppInbox(user) && (
                <button
                  onClick={() => detailEntry.clinicId && detailEntry.patientId ? openAppointmentModal(detailEntry) : goToAppointmentForm(detailEntry)}
                  title={!detailEntry.clinicId || !detailEntry.patientId ? t('whatsapp:inbox.actions.appointmentDisabledHint') : t('whatsapp:inbox.actions.createAppointment')}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100 transition-colors"
                >
                  <Calendar size={12} />
                  {t('whatsapp:inbox.actions.appointment')}
                </button>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 shrink-0">
              <div className="flex items-end gap-2">
                <textarea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder={t('whatsapp:inbox.detail.replyPlaceholder')}
                  rows={2}
                  maxLength={1000}
                  disabled={!canReply || !detailEntry.clinicId}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-50 disabled:text-gray-400"
                />
                <button
                  onClick={handleReply}
                  disabled={!canReply || !detailEntry.clinicId || replying || !replyText.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium disabled:opacity-50 shrink-0"
                >
                  {replying ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {t('whatsapp:inbox.detail.send')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Direct Appointment Modal */}
      {apptModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <Calendar size={18} className="text-green-600" />
                {t('whatsapp:inbox.appointment.title')}
              </h2>
              <button onClick={() => setApptModal(null)} className="text-gray-400 hover:text-gray-600">
                <XCircle size={20} />
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-4 flex-1 space-y-4">
              <div className="p-3 bg-green-50 rounded-lg text-xs text-green-700 flex items-start gap-2">
                <MessageSquare size={14} className="mt-0.5 shrink-0" />
                <span>
                  {t('whatsapp:inbox.appointment.sourceNotice')}
                  {' '}
                  {t('whatsapp:inbox.appointment.sender', { phone: apptModal.entry.phone })}
                </span>
              </div>

              {apptModal.loadingData ? (
                <div className="flex justify-center py-8"><Loader2 className="animate-spin text-green-600" size={24} /></div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('whatsapp:inbox.appointment.practitioner')} <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={apptModal.practitionerId}
                      onChange={e => setApptModal(prev => prev ? { ...prev, practitionerId: e.target.value } : null)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      <option value="">{t('whatsapp:inbox.appointment.selectPractitioner')}</option>
                      {apptModal.doctors.map(d => (
                        <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('whatsapp:inbox.appointment.service')} <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={apptModal.appointmentTypeId}
                      onChange={e => setApptModal(prev => prev ? { ...prev, appointmentTypeId: e.target.value } : null)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    >
                      <option value="">{t('whatsapp:inbox.appointment.selectService')}</option>
                      {apptModal.services.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('common:date')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={apptModal.date}
                      onChange={e => setApptModal(prev => prev ? { ...prev, date: e.target.value } : null)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('common:time')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="time"
                      value={apptModal.time}
                      onChange={e => setApptModal(prev => prev ? { ...prev, time: e.target.value } : null)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('whatsapp:inbox.appointment.notes')}</label>
                    <textarea
                      rows={2}
                      value={apptModal.notes}
                      onChange={e => setApptModal(prev => prev ? { ...prev, notes: e.target.value } : null)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 shrink-0">
              <button onClick={() => setApptModal(null)} className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm">
                {t('common:cancel')}
              </button>
              <button
                onClick={handleCreateAppointment}
                disabled={savingAppt || apptModal.loadingData || !apptModal.practitionerId || !apptModal.appointmentTypeId}
                className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {savingAppt ? <Loader2 size={14} className="animate-spin" /> : <Calendar size={14} />}
                {t('whatsapp:inbox.actions.createAppointment')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[70] flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.success ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.success ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          {toast.message}
        </div>
      )}
    </div>
  );
}
