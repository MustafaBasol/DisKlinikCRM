import React from 'react';
import { CalendarClock, CreditCard, MessageSquare, Stethoscope, TrendingUp, UserX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type RecallSummary = {
  todayCount: number;
  routineCheckups: number;
  incompleteTreatments: number;
  pendingTreatmentPlans: number;
  noShowFollowups: number;
  estimatedPendingRevenue: number;
};

interface RecallSummaryCardsProps {
  summary?: RecallSummary | null;
  formatCurrency: (value: number) => string;
}

const RecallSummaryCards: React.FC<RecallSummaryCardsProps> = ({ summary, formatCurrency }) => {
  const { t } = useTranslation('recall');

  const cards = [
    { key: 'today', value: summary?.todayCount ?? 0, icon: CalendarClock, color: 'text-blue-600' },
    { key: 'checkups', value: summary?.routineCheckups ?? 0, icon: MessageSquare, color: 'text-green-600' },
    { key: 'incomplete', value: summary?.incompleteTreatments ?? 0, icon: Stethoscope, color: 'text-orange-600' },
    { key: 'plans', value: summary?.pendingTreatmentPlans ?? 0, icon: TrendingUp, color: 'text-purple-600' },
    { key: 'noShows', value: summary?.noShowFollowups ?? 0, icon: UserX, color: 'text-red-600' },
    { key: 'revenue', value: formatCurrency(summary?.estimatedPendingRevenue ?? 0), icon: CreditCard, color: 'text-emerald-600' },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
      {cards.map((card) => (
        <div key={card.key} className="card p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-gray-500">{t(`summary.${card.key}`)}</p>
            <card.icon size={18} className={card.color} />
          </div>
          <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
        </div>
      ))}
    </div>
  );
};

export default RecallSummaryCards;
