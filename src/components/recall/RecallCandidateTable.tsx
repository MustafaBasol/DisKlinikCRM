import React from 'react';
import { CalendarPlus, CheckCircle2, Clock, MessageCircle, PhoneCall, User, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import RecallCandidateStatusBadge from './RecallCandidateStatusBadge';

export type RecallCandidate = {
  id: string;
  patientId: string;
  recallType: string;
  priority: string;
  status: string;
  estimatedValue?: number | null;
  dueAt: string;
  nextActionAt?: string | null;
  lastContactedAt?: string | null;
  lastMessageDraft?: string | null;
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    phone?: string | null;
    communicationConsent?: boolean;
  };
  treatmentCase?: { id: string; title: string; stage?: string | null } | null;
  appointment?: {
    id: string;
    startTime: string;
    appointmentType?: { name?: string | null } | null;
  } | null;
  assignedTo?: { id: string; firstName: string; lastName: string } | null;
};

interface RecallCandidateTableProps {
  candidates: RecallCandidate[];
  loading: boolean;
  actionLoading: Record<string, boolean>;
  formatCurrency: (value: number | null | undefined) => string;
  formatDate: (value: string | null | undefined) => string;
  onPrepareMessage: (candidate: RecallCandidate) => void;
  onCreateTask: (candidate: RecallCandidate) => void;
  onBookAppointment: (candidate: RecallCandidate) => void;
  onSnooze: (candidate: RecallCandidate) => void;
  onLogContact: (candidate: RecallCandidate) => void;
  onStatusChange: (candidate: RecallCandidate, status: string) => void;
  onGoPatient: (candidate: RecallCandidate) => void;
  onGoTreatment: (candidate: RecallCandidate) => void;
}

const PRIORITY_STYLES: Record<string, string> = {
  LOW: 'bg-gray-50 text-gray-600 border-gray-100',
  MEDIUM: 'bg-blue-50 text-blue-700 border-blue-100',
  HIGH: 'bg-orange-50 text-orange-700 border-orange-100',
  URGENT: 'bg-red-50 text-red-700 border-red-100',
};

const RecallCandidateTable: React.FC<RecallCandidateTableProps> = ({
  candidates,
  loading,
  actionLoading,
  formatCurrency,
  formatDate,
  onPrepareMessage,
  onCreateTask,
  onBookAppointment,
  onSnooze,
  onLogContact,
  onStatusChange,
  onGoPatient,
  onGoTreatment,
}) => {
  const { t } = useTranslation(['recall', 'common']);

  if (loading) {
    return (
      <div className="card p-10 text-center text-gray-500">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
        {t('common:loading')}
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="card border-dashed p-12 text-center text-gray-500">
        <Clock size={40} className="mx-auto mb-3 text-gray-300" />
        <p className="font-medium">{t('recall:empty.title')}</p>
        <p className="mt-1 text-sm">{t('recall:empty.description')}</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">{t('recall:table.patient')}</th>
              <th className="px-4 py-3 text-left">{t('recall:table.phone')}</th>
              <th className="px-4 py-3 text-left">{t('recall:table.type')}</th>
              <th className="px-4 py-3 text-left">{t('recall:table.priority')}</th>
              <th className="px-4 py-3 text-left">{t('recall:table.lastContact')}</th>
              <th className="px-4 py-3 text-left">{t('recall:table.source')}</th>
              <th className="px-4 py-3 text-right">{t('recall:table.value')}</th>
              <th className="px-4 py-3 text-left">{t('recall:table.status')}</th>
              <th className="px-4 py-3 text-left">{t('recall:table.nextAction')}</th>
              <th className="px-4 py-3 text-right">{t('common:actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {candidates.map((candidate) => {
              const name = `${candidate.patient.firstName} ${candidate.patient.lastName}`.trim();
              const sourceLabel = candidate.treatmentCase?.title ||
                candidate.appointment?.appointmentType?.name ||
                t(`recall:types.${candidate.recallType}`, { defaultValue: candidate.recallType });
              const isBusy = !!actionLoading[candidate.id];

              return (
                <tr key={candidate.id} className="hover:bg-gray-50/70">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onGoPatient(candidate)}
                      className="flex items-center gap-2 font-medium text-primary-600 hover:underline"
                    >
                      <User size={14} />
                      {name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{candidate.patient.phone || '-'}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {t(`recall:types.${candidate.recallType}`, { defaultValue: candidate.recallType })}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLES[candidate.priority] ?? PRIORITY_STYLES.MEDIUM}`}>
                      {t(`recall:priorities.${candidate.priority}`, { defaultValue: candidate.priority })}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(candidate.lastContactedAt)}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {candidate.treatmentCase ? (
                      <button type="button" onClick={() => onGoTreatment(candidate)} className="hover:text-primary-600 hover:underline">
                        {sourceLabel}
                      </button>
                    ) : sourceLabel}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">
                    {formatCurrency(candidate.estimatedValue)}
                  </td>
                  <td className="px-4 py-3"><RecallCandidateStatusBadge status={candidate.status} /></td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(candidate.nextActionAt || candidate.dueAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" title={t('recall:actions.prepareMessage')} disabled={isBusy} onClick={() => onPrepareMessage(candidate)} className="rounded-lg p-1.5 text-green-600 hover:bg-green-50 disabled:opacity-50">
                        <MessageCircle size={16} />
                      </button>
                      <button type="button" title={t('recall:actions.createTask')} disabled={isBusy} onClick={() => onCreateTask(candidate)} className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-50 disabled:opacity-50">
                        <CheckCircle2 size={16} />
                      </button>
                      <button type="button" title={t('recall:actions.bookAppointment')} disabled={isBusy} onClick={() => onBookAppointment(candidate)} className="rounded-lg p-1.5 text-purple-600 hover:bg-purple-50 disabled:opacity-50">
                        <CalendarPlus size={16} />
                      </button>
                      <button type="button" title={t('recall:actions.logContact')} disabled={isBusy} onClick={() => onLogContact(candidate)} className="rounded-lg p-1.5 text-indigo-600 hover:bg-indigo-50 disabled:opacity-50">
                        <PhoneCall size={16} />
                      </button>
                      <button type="button" title={t('recall:actions.snooze')} disabled={isBusy} onClick={() => onSnooze(candidate)} className="rounded-lg p-1.5 text-amber-600 hover:bg-amber-50 disabled:opacity-50">
                        <Clock size={16} />
                      </button>
                      <button type="button" title={t('recall:actions.decline')} disabled={isBusy} onClick={() => onStatusChange(candidate, 'DECLINED')} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-50">
                        <XCircle size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default RecallCandidateTable;
