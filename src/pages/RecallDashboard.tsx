import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { recallService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useClinic } from '../context/ClinicContext';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import { canViewRecallDashboard } from '../utils/permissions';
import RecallSummaryCards from '../components/recall/RecallSummaryCards';
import RecallCandidateTable, { RecallCandidate } from '../components/recall/RecallCandidateTable';
import RecallActionModal from '../components/recall/RecallActionModal';
import RecallMessageDraftModal from '../components/recall/RecallMessageDraftModal';

type RecallSummary = {
  todayCount: number;
  routineCheckups: number;
  incompleteTreatments: number;
  pendingTreatmentPlans: number;
  noShowFollowups: number;
  estimatedPendingRevenue: number;
};

type ActionModalState = {
  mode: 'snooze' | 'contact';
  candidate: RecallCandidate;
} | null;

const recallTypes = [
  'ROUTINE_CHECKUP',
  'TREATMENT_PLAN_NOT_STARTED',
  'INCOMPLETE_TREATMENT',
  'NO_SHOW_FOLLOW_UP',
  'PAYMENT_FOLLOW_UP',
  'MANUAL',
];

const recallStatuses = [
  'PENDING',
  'TASK_CREATED',
  'MESSAGE_DRAFTED',
  'CONTACTED',
  'APPOINTMENT_BOOKED',
  'DECLINED',
  'SNOOZED',
  'COMPLETED',
  'CANCELLED',
];

const priorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const RecallDashboard: React.FC = () => {
  const { t } = useTranslation(['recall', 'common']);
  const { user } = useAuth();
  const { selectedClinicId } = useClinic();
  const { formatCurrency, formatDate } = useClinicPreferences();
  const navigate = useNavigate();

  const [candidates, setCandidates] = useState<RecallCandidate[]>([]);
  const [summary, setSummary] = useState<RecallSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [actionModal, setActionModal] = useState<ActionModalState>(null);
  const [messageModal, setMessageModal] = useState<{ candidate: RecallCandidate; body: string } | null>(null);

  const [search, setSearch] = useState('');
  const [recallType, setRecallType] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (selectedClinicId && selectedClinicId !== 'all') params.clinicId = selectedClinicId;
      if (search) params.search = search;
      if (recallType) params.recallType = recallType;
      if (status) params.status = status;
      if (priority) params.priority = priority;

      const res = await recallService.getCandidates(params);
      setCandidates(res.data.candidates || []);
      setSummary(res.data.summary || null);
    } catch {
      showToast(t('recall:errors.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [priority, recallType, search, selectedClinicId, showToast, status, t]);

  useEffect(() => {
    if (!canViewRecallDashboard(user)) {
      navigate('/dashboard');
      return;
    }
    const timeout = setTimeout(fetchCandidates, search ? 300 : 0);
    return () => clearTimeout(timeout);
  }, [fetchCandidates, navigate, search, user]);

  const setCandidateBusy = (candidateId: string, busy: boolean) => {
    setActionLoading((prev) => ({ ...prev, [candidateId]: busy }));
  };

  const handleGenerate = async () => {
    setGenerateLoading(true);
    try {
      const clinicId = selectedClinicId && selectedClinicId !== 'all' ? selectedClinicId : undefined;
      const res = await recallService.generate(clinicId);
      if (!res.data.settingsEnabled) {
        showToast(t('recall:errors.settingsDisabled'), 'error');
      } else {
        showToast(t('recall:success.generated', { count: res.data.generated ?? 0 }));
      }
      fetchCandidates();
    } catch {
      showToast(t('recall:errors.generateFailed'), 'error');
    } finally {
      setGenerateLoading(false);
    }
  };

  const handlePrepareMessage = async (candidate: RecallCandidate) => {
    setCandidateBusy(candidate.id, true);
    try {
      const res = await recallService.prepareMessage(candidate.id);
      const nextCandidate = res.data.candidate || candidate;
      setMessageModal({ candidate: nextCandidate, body: res.data.message?.body || nextCandidate.lastMessageDraft || '' });
      fetchCandidates();
    } catch (error: any) {
      showToast(error?.response?.data?.error || t('recall:errors.messageFailed'), 'error');
    } finally {
      setCandidateBusy(candidate.id, false);
    }
  };

  const handleCreateTask = async (candidate: RecallCandidate) => {
    setCandidateBusy(candidate.id, true);
    try {
      await recallService.createTask(candidate.id);
      showToast(t('recall:success.taskCreated'));
      fetchCandidates();
    } catch (error: any) {
      showToast(error?.response?.data?.error || t('recall:errors.taskFailed'), 'error');
    } finally {
      setCandidateBusy(candidate.id, false);
    }
  };

  const handleStatusChange = async (candidate: RecallCandidate, nextStatus: string) => {
    setCandidateBusy(candidate.id, true);
    try {
      await recallService.updateStatus(candidate.id, { status: nextStatus });
      showToast(t('recall:success.statusUpdated'));
      fetchCandidates();
    } catch {
      showToast(t('recall:errors.statusFailed'), 'error');
    } finally {
      setCandidateBusy(candidate.id, false);
    }
  };

  const handleActionModalSubmit = async (data: { note?: string; nextActionAt?: string }) => {
    if (!actionModal) return;
    const { candidate, mode } = actionModal;
    setCandidateBusy(candidate.id, true);
    try {
      if (mode === 'snooze') {
        await recallService.snooze(candidate.id, { nextActionAt: data.nextActionAt!, note: data.note });
        showToast(t('recall:success.snoozed'));
      } else {
        await recallService.logContact(candidate.id, { note: data.note });
        showToast(t('recall:success.contactLogged'));
      }
      setActionModal(null);
      fetchCandidates();
    } catch {
      showToast(t('recall:errors.actionFailed'), 'error');
    } finally {
      setCandidateBusy(candidate.id, false);
    }
  };

  if (!canViewRecallDashboard(user)) return null;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {toast && (
        <div className={`fixed right-4 top-4 z-50 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg ${
          toast.type === 'success'
            ? 'border-green-200 bg-green-50 text-green-700'
            : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          {toast.type === 'error' && <AlertTriangle size={16} />}
          {toast.text}
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <RotateCcw size={24} className="text-primary-600" />
            {t('recall:title')}
          </h1>
          <p className="mt-1 text-gray-500">{t('recall:subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={fetchCandidates}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            {t('common:refresh')}
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generateLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:bg-gray-300"
          >
            <RotateCcw size={16} className={generateLoading ? 'animate-spin' : ''} />
            {t('recall:actions.generate')}
          </button>
        </div>
      </div>

      <RecallSummaryCards summary={summary} formatCurrency={(value) => formatCurrency(value)} />

      <div className="card p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="relative md:col-span-1">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('recall:filters.search')}
              className="input-field w-full pl-10"
            />
          </div>
          <select value={recallType} onChange={(event) => setRecallType(event.target.value)} className="input-field w-full">
            <option value="">{t('recall:filters.allTypes')}</option>
            {recallTypes.map((type) => (
              <option key={type} value={type}>{t(`recall:types.${type}`)}</option>
            ))}
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="input-field w-full">
            <option value="">{t('recall:filters.allStatuses')}</option>
            {recallStatuses.map((item) => (
              <option key={item} value={item}>{t(`recall:statuses.${item}`)}</option>
            ))}
          </select>
          <select value={priority} onChange={(event) => setPriority(event.target.value)} className="input-field w-full">
            <option value="">{t('recall:filters.allPriorities')}</option>
            {priorities.map((item) => (
              <option key={item} value={item}>{t(`recall:priorities.${item}`)}</option>
            ))}
          </select>
        </div>
      </div>

      <RecallCandidateTable
        candidates={candidates}
        loading={loading}
        actionLoading={actionLoading}
        formatCurrency={(value) => value == null ? '-' : formatCurrency(value)}
        formatDate={(value) => value ? formatDate(value) : '-'}
        onPrepareMessage={handlePrepareMessage}
        onCreateTask={handleCreateTask}
        onBookAppointment={(candidate) => navigate(`/appointments?patientId=${candidate.patientId}`)}
        onSnooze={(candidate) => setActionModal({ mode: 'snooze', candidate })}
        onLogContact={(candidate) => setActionModal({ mode: 'contact', candidate })}
        onStatusChange={handleStatusChange}
        onGoPatient={(candidate) => navigate(`/patients/${candidate.patientId}`)}
        onGoTreatment={(candidate) => candidate.treatmentCase && navigate(`/treatment-cases/${candidate.treatmentCase.id}`)}
      />

      <RecallActionModal
        candidate={actionModal?.candidate ?? null}
        mode={actionModal?.mode ?? 'contact'}
        loading={actionModal ? !!actionLoading[actionModal.candidate.id] : false}
        onClose={() => setActionModal(null)}
        onSubmit={handleActionModalSubmit}
      />

      <RecallMessageDraftModal
        candidate={messageModal?.candidate ?? null}
        body={messageModal?.body ?? ''}
        onClose={() => setMessageModal(null)}
      />
    </div>
  );
};

export default RecallDashboard;
