import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Instagram,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  User,
  Building2,
  Send,
  Loader2,
  MessageSquare,
  XCircle,
  CalendarPlus,
  Calendar,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import { instagramInboxService, patientService, userService, serviceService } from '../services/api';
import {
  canViewInstagramInbox,
  canResolveInstagramConversation,
  canReplyInstagramMessages,
} from '../utils/permissions';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PossiblePatient {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
}

interface InboxEntry {
  id: string;
  externalSenderId: string;
  senderUsername?: string | null;
  lastMessageText?: string | null;
  messageCount: number;
  needsClinicResolution: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
  clinicId?: string | null;
  patientId?: string | null;
  instagramConnectionId?: string | null;
  instagramConnection?: { id: string; name: string; instagramUsername?: string | null } | null;
  clinic?: { id: string; name: string } | null;
  patient?: { id: string; firstName: string; lastName: string } | null;
  resolvedBy?: { id: string; firstName: string; lastName: string } | null;
}

interface ClinicOption {
  id: string;
  name: string;
}

interface ResolveModal {
  entry: InboxEntry;
  mode: 'assign_branch' | 'link_patient';
  clinicId: string;
  patientId: string;
  patientSearch: string;
  patients: PossiblePatient[];
}

function extractClinics(data: unknown): ClinicOption[] {
  if (Array.isArray(data)) return data as ClinicOption[];
  if (!data || typeof data !== 'object') return [];
  const record = data as { clinics?: ClinicOption[]; branches?: ClinicOption[] };
  return record.clinics ?? record.branches ?? [];
}

function isNumericPlatformId(value?: string | null): boolean {
  return Boolean(value?.trim()) && /^\d{8,}$/.test(value!.trim());
}

function getInstagramDisplayName(entry: InboxEntry): string {
  if (entry.patient) {
    const patientName = `${entry.patient.firstName} ${entry.patient.lastName}`.trim();
    if (patientName) return patientName;
  }
  if (entry.senderUsername?.trim() && !isNumericPlatformId(entry.senderUsername)) {
    return `@${entry.senderUsername.trim()}`;
  }
  return 'Instagram Kullanıcısı';
}

interface ReplyModal {
  entry: InboxEntry;
  message: string;
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

export default function InstagramInbox() {
  const { user } = useAuth();
  const { t } = useTranslation(['instagram', 'common', 'appointments']);
  const { formatDateTime } = useClinicPreferences();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'unassigned' | 'all'>('unassigned');
  const [unassigned, setUnassigned] = useState<InboxEntry[]>([]);
  const [conversations, setConversations] = useState<InboxEntry[]>([]);
  const [clinics, setClinics] = useState<ClinicOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterClinic, setFilterClinic] = useState('');
  const [resolveModal, setResolveModal] = useState<ResolveModal | null>(null);
  const [resolving, setResolving] = useState(false);
  const [replyModal, setReplyModal] = useState<ReplyModal | null>(null);
  const [replying, setReplying] = useState(false);
  const [replyResult, setReplyResult] = useState<{ success: boolean; message: string } | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [apptModal, setApptModal] = useState<AppointmentModal | null>(null);
  const [savingAppt, setSavingAppt] = useState(false);
  const [toast, setToast] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!canViewInstagramInbox(user)) {
      navigate('/');
    }
  }, [user, navigate]);

  async function loadClinics(): Promise<ClinicOption[]> {
    try {
      const res = await instagramInboxService.getClinics();
      const clinicList = extractClinics(res.data);
      setClinics(clinicList);
      return clinicList;
    } catch {
      setClinics([]);
      return [];
    }
  }

  useEffect(() => {
    loadClinics();
  }, []);

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
      const res = await instagramInboxService.getUnassigned();
      setUnassigned(res.data.entries ?? []);
    } catch {
      setError(t('instagram:inbox.errors.loadUnassigned'));
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
      const res = await instagramInboxService.getConversations(params);
      setConversations(res.data.entries ?? []);
    } catch {
      setError(t('instagram:inbox.errors.loadConversations'));
    } finally {
      setLoading(false);
    }
  }

  function reload() {
    if (activeTab === 'unassigned') loadUnassigned();
    else loadConversations();
  }

  async function openResolveModal(entry: InboxEntry) {
    const clinicList = clinics.length > 0 ? clinics : await loadClinics();
    const defaultClinicId =
      entry.clinicId ??
      (clinicList.length === 1 ? clinicList[0].id : '');

    setResolveModal({
      entry,
      mode: 'assign_branch',
      clinicId: defaultClinicId,
      patientId: '',
      patientSearch: '',
      patients: [],
    });
  }

  async function openLinkPatientModal(entry: InboxEntry) {
    setResolveModal({
      entry,
      mode: 'link_patient',
      clinicId: entry.clinicId ?? '',
      patientId: '',
      patientSearch: '',
      patients: [],
    });
  }

  // ── Resolve modal ──────────────────────────────────────────────────────────

  async function searchPatients(query: string) {
    if (!query.trim()) {
      setResolveModal(prev => prev ? { ...prev, patients: [] } : null);
      return;
    }
    try {
      const res = await patientService.getAll({ search: query, limit: 10 });
      setResolveModal(prev => prev ? { ...prev, patients: res.data.patients ?? [] } : null);
    } catch {
      // Ignore search errors
    }
  }

  async function handleLinkPatientFromModal() {
    if (!resolveModal || !resolveModal.patientId) return;
    setResolving(true);
    try {
      await instagramInboxService.linkPatient(resolveModal.entry.id, resolveModal.patientId);
      setResolveModal(null);
      reload();
    } catch {
      setError(t('instagram:inbox.errors.linkPatientFailed'));
    } finally {
      setResolving(false);
    }
  }

  async function handleResolve() {
    if (!resolveModal) return;
    if (!resolveModal.clinicId) {
      return;
    }
    setResolving(true);
    try {
      await instagramInboxService.resolve(resolveModal.entry.id, {
        clinicId: resolveModal.clinicId,
        patientId: resolveModal.patientId || undefined,
      });
      setResolveModal(null);
      reload();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? t('instagram:inbox.errors.resolveFailed'));
    } finally {
      setResolving(false);
    }
  }

  async function handleLinkPatient(entryId: string, patientId: string) {
    try {
      await instagramInboxService.linkPatient(entryId, patientId);
      reload();
    } catch {
      setError(t('instagram:inbox.errors.linkPatientFailed'));
    }
  }

  // ── Reply ──────────────────────────────────────────────────────────────────

  async function handleReply() {
    if (!replyModal || !replyModal.message.trim()) return;
    setReplying(true);
    setReplyResult(null);
    try {
      await instagramInboxService.reply(replyModal.entry.id, replyModal.message);
      setReplyResult({ success: true, message: t('instagram:inbox.success.messageSent') });
      setReplyModal(prev => prev ? { ...prev, message: '' } : null);
      reload();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setReplyResult({ success: false, message: msg ?? t('instagram:inbox.errors.messageSendFailed') });
    } finally {
      setReplying(false);
    }
  }

  // ── Convert to appointment request ────────────────────────────────────────

  async function handleConvertToRequest(entry: InboxEntry) {
    if (!entry.clinicId) {
      setError(t('instagram:inbox.errors.assignBranchFirst'));
      return;
    }
    if (!window.confirm(t('instagram:inbox.confirm.convertToRequest'))) return;
    setConvertingId(entry.id);
    try {
      await instagramInboxService.createAppointmentRequest(entry.id);
      setToast({ success: true, message: t('instagram:inbox.success.requestCreated') });
      reload();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? t('instagram:inbox.errors.requestCreateFailed'));
    } finally {
      setConvertingId(null);
      setTimeout(() => setToast(null), 3000);
    }
  }

  // ── Open direct appointment modal ──────────────────────────────────────────

  async function openAppointmentModal(entry: InboxEntry) {
    if (!entry.clinicId || !entry.patientId) {
      setError(t('instagram:inbox.errors.assignBranchAndPatientFirst'));
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
      notes: t('instagram:inbox.appointment.defaultNotes', {
        sender: getInstagramDisplayName(entry),
      }),
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
      setError(t('instagram:inbox.errors.appointmentRequiredFields'));
      return;
    }
    setSavingAppt(true);
    try {
      await instagramInboxService.createAppointment(entry.id, {
        patientId, clinicId, practitionerId, appointmentTypeId, date, time, notes,
      });
      setApptModal(null);
      setToast({ success: true, message: t('instagram:inbox.success.appointmentCreated') });
      reload();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? t('instagram:inbox.errors.appointmentCreateFailed'));
    } finally {
      setSavingAppt(false);
      setTimeout(() => setToast(null), 3000);
    }
  }

  // ── Navigate to appointment form with prefill ──────────────────────────────

  function goToAppointmentForm(entry: InboxEntry) {
    const params = new URLSearchParams({ source: 'instagram', instagramInboxEntryId: entry.id });
    if (entry.patientId) params.set('patientId', entry.patientId);
    if (entry.clinicId) params.set('clinicId', entry.clinicId);
    navigate(`/appointments?${params.toString()}`);
  }

  // ── Status badge ──────────────────────────────────────────────────────────


  function StatusBadge({ entry }: { entry: InboxEntry }) {
    if (entry.status === 'converted') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
          <CalendarPlus size={10} />
          {t('instagram:inbox.status.converted')}
        </span>
      );
    }
    if (entry.needsClinicResolution) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
          <AlertCircle size={10} />
          {t('instagram:inbox.status.needsBranch')}
        </span>
      );
    }
    if (entry.status === 'resolved') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
          <CheckCircle2 size={10} />
          {t('instagram:inbox.status.resolved')}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
        <MessageSquare size={10} />
        {t('instagram:inbox.status.open')}
      </span>
    );
  }

  const entries = activeTab === 'unassigned' ? unassigned : conversations;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <Instagram size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('instagram:inbox.title')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('instagram:inbox.subtitle')}</p>
          </div>
        </div>
        <button
          onClick={reload}
          className="p-2 text-gray-400 hover:text-primary-600 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          title={t('common:refresh')}
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200 dark:border-gray-700">
        {[
          { key: 'unassigned', label: t('instagram:inbox.tabs.unassigned'), count: unassigned.length },
          { key: 'all', label: t('instagram:inbox.tabs.all'), count: null },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as 'unassigned' | 'all')}
            className={`pb-3 px-4 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.key
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
            {tab.count !== null && tab.count > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filters (all tab) */}
      {activeTab === 'all' && (
        <div className="flex gap-3 mb-4 flex-wrap">
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value="">{t('instagram:inbox.filters.allStatuses')}</option>
            <option value="open">{t('instagram:inbox.status.open')}</option>
            <option value="resolved">{t('instagram:inbox.status.resolved')}</option>
            <option value="ignored">{t('instagram:inbox.status.ignored')}</option>
          </select>
          {clinics.length > 0 && (
            <select
              value={filterClinic}
              onChange={e => setFilterClinic(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              <option value="">{t('instagram:inbox.filters.allBranches')}</option>
              {clinics.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>
      )}

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
      {!loading && entries.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <Instagram size={48} className="mx-auto mb-4 opacity-30" />
          <p className="font-medium">
            {activeTab === 'unassigned' ? t('instagram:inbox.empty.unassigned') : t('instagram:inbox.empty.conversations')}
          </p>
        </div>
      )}

      {/* Entry list */}
      <div className="space-y-3">
        {entries.map(entry => (
          <div
            key={entry.id}
            className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4"
          >
            <div className="flex items-start gap-3">
              {/* Avatar */}
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center shrink-0">
                <User size={18} className="text-white" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-medium text-gray-900 dark:text-white text-sm">
                    {getInstagramDisplayName(entry)}
                  </span>
                  <StatusBadge entry={entry} />
                  {entry.instagramConnection && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {t('instagram:inbox.viaConnection', { name: entry.instagramConnection.name })}
                    </span>
                  )}
                </div>

                {/* Last message */}
                {entry.lastMessageText && (
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-2 line-clamp-2">
                    {entry.lastMessageText}
                  </p>
                )}

                {/* Meta info */}
                <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500 flex-wrap">
                  <span>{t('instagram:inbox.messageCount', { count: entry.messageCount })}</span>
                  <span>{formatDateTime(entry.updatedAt)}</span>
                  {entry.clinic && (
                    <span className="flex items-center gap-1">
                      <Building2 size={10} />
                      {entry.clinic.name}
                    </span>
                  )}
                  {entry.patient && (
                    <span className="flex items-center gap-1">
                      <User size={10} />
                      {entry.patient.firstName} {entry.patient.lastName}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                {/* Reply */}
                {canReplyInstagramMessages(user) && entry.status !== 'converted' && (
                  <button
                    onClick={() => setReplyModal({ entry, message: '' })}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 rounded-lg text-xs font-medium hover:bg-primary-100 dark:hover:bg-primary-900/50 transition-colors"
                  >
                    <Send size={12} />
                    {t('instagram:inbox.actions.reply')}
                  </button>
                )}

                {/* Resolve / assign clinic */}
                {canResolveInstagramConversation(user) && entry.needsClinicResolution && (
                  <button
                    onClick={() => openResolveModal(entry)}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 rounded-lg text-xs font-medium hover:bg-yellow-100 dark:hover:bg-yellow-900/50 transition-colors"
                  >
                    <Building2 size={12} />
                    {t('instagram:inbox.actions.assignBranch')}
                  </button>
                )}

                {/* Link patient */}
                {canResolveInstagramConversation(user) && !entry.patientId && entry.status !== 'converted' && (
                  <button
                    onClick={() => openLinkPatientModal(entry)}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded-lg text-xs font-medium hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                  >
                    <User size={12} />
                    {t('instagram:inbox.actions.linkPatient')}
                  </button>
                )}

                {/* Convert to appointment request */}
                {canViewInstagramInbox(user) && entry.status !== 'converted' && (
                  <button
                    onClick={() => handleConvertToRequest(entry)}
                    disabled={convertingId === entry.id || !entry.clinicId}
                    title={!entry.clinicId ? t('instagram:inbox.errors.assignBranchFirst') : t('instagram:inbox.actions.convertToRequest')}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 rounded-lg text-xs font-medium hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {convertingId === entry.id ? <Loader2 size={12} className="animate-spin" /> : <CalendarPlus size={12} />}
                    {t('instagram:inbox.actions.createRequest')}
                  </button>
                )}

                {/* Direct appointment creation (needs clinic + patient) */}
                {canViewInstagramInbox(user) && entry.status !== 'converted' && (
                  <button
                    onClick={() => entry.clinicId && entry.patientId ? openAppointmentModal(entry) : goToAppointmentForm(entry)}
                    title={!entry.clinicId || !entry.patientId ? t('instagram:inbox.actions.appointmentDisabledHint') : t('instagram:inbox.actions.createAppointment')}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300 rounded-lg text-xs font-medium hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors"
                  >
                    <Calendar size={12} />
                    {t('instagram:inbox.actions.appointment')}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Resolve Modal */}
      {resolveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 dark:text-white">
                {resolveModal.mode === 'link_patient'
                  ? t('instagram:inbox.linkPatientModal.title', { defaultValue: 'Hasta Bağla' })
                  : t('instagram:inbox.resolveModal.title')}
              </h2>
              <button
                onClick={() => setResolveModal(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <XCircle size={20} />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Clinic — only shown in assign_branch mode */}
              {resolveModal.mode === 'assign_branch' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('instagram:inbox.resolveModal.branch')} <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={resolveModal.clinicId}
                    onChange={e => setResolveModal({ ...resolveModal, clinicId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">{t('instagram:inbox.resolveModal.selectBranch')}</option>
                    {clinics.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Patient search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {resolveModal.mode === 'link_patient'
                    ? t('instagram:inbox.linkPatientModal.searchPatient', { defaultValue: 'Hasta Ara' })
                    : t('instagram:inbox.resolveModal.searchPatientOptional')}
                  {resolveModal.mode === 'link_patient' && <span className="text-red-500 ml-1">*</span>}
                </label>
                <input
                  type="text"
                  value={resolveModal.patientSearch}
                  onChange={e => {
                    const q = e.target.value;
                    setResolveModal(prev => prev ? { ...prev, patientSearch: q, patientId: q ? prev.patientId : '' } : null);
                    searchPatients(q);
                  }}
                  placeholder={t('instagram:inbox.resolveModal.patientSearchPlaceholder')}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                {resolveModal.patients.length > 0 && (
                  <div className="mt-1 border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                    {resolveModal.patients.map(p => (
                      <button
                        key={p.id}
                        onClick={() => setResolveModal(prev => prev ? { ...prev, patientId: p.id, patientSearch: `${p.firstName} ${p.lastName}`, patients: [] } : null)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 last:border-0"
                      >
                        <span className="font-medium">{p.firstName} {p.lastName}</span>
                        <span className="text-gray-500 dark:text-gray-400 ml-2 text-xs">{p.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
                {resolveModal.patientId && (
                  <p className="mt-1 text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                    <CheckCircle2 size={12} />
                    {t('instagram:inbox.linkPatientModal.patientSelected', { defaultValue: 'Hasta seçildi' })}
                  </p>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
              <button
                onClick={() => setResolveModal(null)}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white text-sm"
              >
                {t('common:cancel')}
              </button>
              <button
                onClick={resolveModal.mode === 'link_patient' ? handleLinkPatientFromModal : handleResolve}
                disabled={resolving || (resolveModal.mode === 'assign_branch' ? !resolveModal.clinicId : !resolveModal.patientId)}
                className="flex items-center gap-2 px-5 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {resolving && <Loader2 size={14} className="animate-spin" />}
                {resolveModal.mode === 'link_patient'
                  ? t('instagram:inbox.linkPatientModal.confirm', { defaultValue: 'Bağla' })
                  : t('instagram:inbox.resolveModal.resolve')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reply Modal */}
      {replyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 dark:text-white">{t('instagram:inbox.replyModal.title')}</h2>
              <button
                onClick={() => { setReplyModal(null); setReplyResult(null); }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <XCircle size={20} />
              </button>
            </div>

            <div className="px-6 py-4 space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {t('instagram:inbox.replyModal.recipient')}: <strong>{getInstagramDisplayName(replyModal.entry)}</strong>
              </p>

              {replyResult && (
                <div className={`p-2 rounded-lg text-sm flex items-center gap-2 ${replyResult.success ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300'}`}>
                  {replyResult.success ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                  {replyResult.message}
                </div>
              )}

              <textarea
                value={replyModal.message}
                onChange={e => setReplyModal({ ...replyModal, message: e.target.value })}
                placeholder={t('instagram:inbox.replyModal.placeholder')}
                rows={4}
                maxLength={1000}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 text-right">
                {replyModal.message.length}/1000
              </p>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
              <button
                onClick={() => { setReplyModal(null); setReplyResult(null); }}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white text-sm"
              >
                {t('common:close')}
              </button>
              <button
                onClick={handleReply}
                disabled={replying || !replyModal.message.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {replying ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {t('instagram:inbox.replyModal.send')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Direct Appointment Modal */}
      {apptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between shrink-0">
              <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Calendar size={18} className="text-green-600" />
                {t('instagram:inbox.appointment.title')}
              </h2>
              <button onClick={() => setApptModal(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <XCircle size={20} />
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-4 flex-1 space-y-4">
              {/* Instagram DM source banner */}
              <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg text-xs text-purple-700 dark:text-purple-300 flex items-start gap-2">
                <Instagram size={14} className="mt-0.5 shrink-0" />
                <span>
                  {t('instagram:inbox.appointment.sourceNotice')}
                  {' '}
                  {t('instagram:inbox.appointment.sender', { sender: getInstagramDisplayName(apptModal.entry) })}
                </span>
              </div>

              {apptModal.loadingData ? (
                <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary-600" size={24} /></div>
              ) : (
                <>
                  {/* Practitioner */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('instagram:inbox.appointment.practitioner')} <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={apptModal.practitionerId}
                      onChange={e => setApptModal(prev => prev ? { ...prev, practitionerId: e.target.value } : null)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="">{t('instagram:inbox.appointment.selectPractitioner')}</option>
                      {apptModal.doctors.map(d => (
                        <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>
                      ))}
                    </select>
                  </div>

                  {/* Service */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('instagram:inbox.appointment.service')} <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={apptModal.appointmentTypeId}
                      onChange={e => setApptModal(prev => prev ? { ...prev, appointmentTypeId: e.target.value } : null)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="">{t('instagram:inbox.appointment.selectService')}</option>
                      {apptModal.services.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Date */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('common:date')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={apptModal.date}
                      onChange={e => setApptModal(prev => prev ? { ...prev, date: e.target.value } : null)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  {/* Time */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('common:time')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="time"
                      value={apptModal.time}
                      onChange={e => setApptModal(prev => prev ? { ...prev, time: e.target.value } : null)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('instagram:inbox.appointment.notes')}</label>
                    <textarea
                      rows={2}
                      value={apptModal.notes}
                      onChange={e => setApptModal(prev => prev ? { ...prev, notes: e.target.value } : null)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3 shrink-0">
              <button onClick={() => setApptModal(null)} className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white text-sm">
                {t('common:cancel')}
              </button>
              <button
                onClick={handleCreateAppointment}
                disabled={savingAppt || apptModal.loadingData || !apptModal.practitionerId || !apptModal.appointmentTypeId}
                className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {savingAppt ? <Loader2 size={14} className="animate-spin" /> : <Calendar size={14} />}
                {t('instagram:inbox.actions.createAppointment')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[60] flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-in slide-in-from-bottom-2 ${toast.success ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.success ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          {toast.message}
        </div>
      )}
    </div>
  );
}
