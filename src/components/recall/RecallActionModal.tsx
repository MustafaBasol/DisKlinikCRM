import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { RecallCandidate } from './RecallCandidateTable';

type RecallActionMode = 'snooze' | 'contact';

interface RecallActionModalProps {
  candidate: RecallCandidate | null;
  mode: RecallActionMode;
  loading: boolean;
  onClose: () => void;
  onSubmit: (data: { note?: string; nextActionAt?: string }) => void;
}

function defaultSnoozeValue() {
  const next = new Date();
  next.setDate(next.getDate() + 7);
  next.setMinutes(0, 0, 0);
  return next.toISOString().slice(0, 16);
}

const RecallActionModal: React.FC<RecallActionModalProps> = ({
  candidate,
  mode,
  loading,
  onClose,
  onSubmit,
}) => {
  const { t } = useTranslation(['recall', 'common']);
  const [note, setNote] = useState('');
  const [nextActionAt, setNextActionAt] = useState(defaultSnoozeValue);
  const patientName = useMemo(
    () => candidate ? `${candidate.patient.firstName} ${candidate.patient.lastName}`.trim() : '',
    [candidate],
  );

  if (!candidate) return null;

  const handleSubmit = () => {
    onSubmit({
      note: note || undefined,
      nextActionAt: mode === 'snooze' ? new Date(nextActionAt).toISOString() : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="font-bold text-gray-900">{t(`actionModal.${mode}.title`)}</h2>
            <p className="mt-1 text-sm text-gray-500">{patientName}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-50">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {mode === 'snooze' && (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">{t('actionModal.snooze.nextActionAt')}</span>
              <input
                type="datetime-local"
                value={nextActionAt}
                onChange={(event) => setNextActionAt(event.target.value)}
                className="input-field w-full"
              />
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">{t('actionModal.note')}</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
              className="input-field w-full"
              placeholder={t(`actionModal.${mode}.notePlaceholder`)}
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            {t('common:cancel')}
          </button>
          <button type="button" disabled={loading} onClick={handleSubmit} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:bg-gray-300">
            {loading ? t('common:saving') : t(`actionModal.${mode}.submit`)}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RecallActionModal;
