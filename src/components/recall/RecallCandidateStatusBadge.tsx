import React from 'react';
import { useTranslation } from 'react-i18next';

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-100',
  TASK_CREATED: 'bg-blue-50 text-blue-700 border-blue-100',
  MESSAGE_DRAFTED: 'bg-green-50 text-green-700 border-green-100',
  CONTACTED: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  APPOINTMENT_BOOKED: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  DECLINED: 'bg-red-50 text-red-700 border-red-100',
  SNOOZED: 'bg-purple-50 text-purple-700 border-purple-100',
  COMPLETED: 'bg-gray-100 text-gray-700 border-gray-200',
  CANCELLED: 'bg-gray-50 text-gray-500 border-gray-200',
};

interface RecallCandidateStatusBadgeProps {
  status: string;
}

const RecallCandidateStatusBadge: React.FC<RecallCandidateStatusBadgeProps> = ({ status }) => {
  const { t } = useTranslation('recall');

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.PENDING}`}>
      {t(`statuses.${status}`, { defaultValue: status })}
    </span>
  );
};

export default RecallCandidateStatusBadge;
