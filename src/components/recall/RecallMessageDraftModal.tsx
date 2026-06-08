import React from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, X } from 'lucide-react';
import { RecallCandidate } from './RecallCandidateTable';

interface RecallMessageDraftModalProps {
  candidate: RecallCandidate | null;
  body: string;
  onClose: () => void;
}

const RecallMessageDraftModal: React.FC<RecallMessageDraftModalProps> = ({ candidate, body, onClose }) => {
  const { t } = useTranslation('recall');
  if (!candidate) return null;

  const patientName = `${candidate.patient.firstName} ${candidate.patient.lastName}`.trim();

  const copyBody = () => {
    navigator.clipboard?.writeText(body);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4">
      <div className="w-full max-w-xl rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="font-bold text-gray-900">{t('messageModal.title')}</h2>
            <p className="mt-1 text-sm text-gray-500">{patientName}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-50">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {t('messageModal.privacyNote')}
          </div>
          <textarea readOnly value={body} rows={8} className="input-field w-full bg-gray-50" />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
          <button type="button" onClick={copyBody} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            <Copy size={16} />
            {t('messageModal.copy')}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
            {t('messageModal.close')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RecallMessageDraftModal;
