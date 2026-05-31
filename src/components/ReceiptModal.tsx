import React, { useEffect, useState } from 'react';
import { X, Loader2, Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { paymentService } from '../services/api';

interface ReceiptModalProps {
  paymentId: string;
  onClose: () => void;
}

function formatDate(d: string | null, locale: string) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatCurrency(amount: number, currency = 'TRY') {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(amount);
}

const ReceiptModal: React.FC<ReceiptModalProps> = ({ paymentId, onClose }) => {
  const { t } = useTranslation(['payments', 'common']);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchReceipt = async () => {
      try {
        const res = await paymentService.getReceipt(paymentId);
        setData(res.data);
      } catch {
        setError(t('payments:receipt.loadFailed'));
      } finally {
        setLoading(false);
      }
    };
    fetchReceipt();
  }, [paymentId]);

  const handlePrint = () => window.print();

  return (
    <>
      {/* Print overlay styles: visibility trick works regardless of nesting depth */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .receipt-print-portal, .receipt-print-portal * { visibility: visible !important; }
          .receipt-print-portal {
            position: fixed !important;
            top: 0 !important; left: 0 !important;
            width: 100% !important;
            background: white !important;
            padding: 40px !important;
            z-index: 99999 !important;
          }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* Modal backdrop */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 no-print" onClick={onClose}>
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          {/* Modal Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 no-print">
            <h2 className="font-bold text-gray-900 dark:text-gray-100">{t('payments:receipt.title')}</h2>
            <div className="flex items-center gap-2">
              {!loading && data && (
                <button onClick={handlePrint} className="btn-primary flex items-center gap-2 text-sm py-2">
                  <Printer size={16} />
                  {t('payments:receipt.print')}
                </button>
              )}
              <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-gray-500">
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-6">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={32} className="animate-spin text-primary-500" />
              </div>
            )}
            {error && <p className="text-red-500 text-center py-8">{error}</p>}
            {!loading && data && (
              <div className="receipt-print-portal">
                <ReceiptContent data={data} />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

const ReceiptContent: React.FC<{ data: any }> = ({ data }) => {
  const { t, i18n } = useTranslation(['payments', 'common']);
  const receiptNo = data.id.replace(/-/g, '').slice(0, 10).toUpperCase();
  return (
    <div className="receipt-area space-y-6 font-sans text-gray-900">
      {/* Clinic Header */}
      <div className="text-center border-b-2 border-primary-600 pb-4">
        <h1 className="text-2xl font-bold text-primary-700">{data.clinic?.name || t('common:clinic')}</h1>
        {data.clinic?.legalName && <p className="text-sm text-gray-500">{data.clinic.legalName}</p>}
        {data.clinic?.address && <p className="text-sm text-gray-500 mt-1">{data.clinic.address}</p>}
        <div className="flex items-center justify-center gap-4 mt-1 text-sm text-gray-500">
          {data.clinic?.phone && <span>📞 {data.clinic.phone}</span>}
          {data.clinic?.email && <span>✉ {data.clinic.email}</span>}
        </div>
      </div>

      {/* Receipt Title */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold uppercase tracking-wide text-gray-700">{t('payments:receipt.paymentReceipt')}</h2>
          <p className="text-sm text-gray-400">No: {receiptNo}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-400">{t('common:date')}</p>
          <p className="font-semibold text-gray-700">{formatDate(data.paidAt || data.createdAt, i18n.language)}</p>
        </div>
      </div>

      {/* Patient Info */}
      <div className="bg-gray-50 rounded-xl p-4">
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">{t('payments:receipt.patientInfo')}</h3>
        <p className="font-semibold text-gray-900 text-lg">{data.patient?.firstName} {data.patient?.lastName}</p>
        {data.patient?.phone && <p className="text-sm text-gray-500">📞 {data.patient.phone}</p>}
        {data.patient?.email && <p className="text-sm text-gray-500">✉ {data.patient.email}</p>}
      </div>

      {/* Payment Details */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-3">{t('payments:receipt.paymentDetails')}</h3>
        <table className="w-full text-sm border-collapse">
          <tbody>
            {data.treatmentCase?.title && (
              <tr className="border-b border-gray-100">
                <td className="py-2 text-gray-500">{t('payments:receipt.serviceTreatment')}</td>
                <td className="py-2 font-medium text-gray-900 text-right">{data.treatmentCase.title}</td>
              </tr>
            )}
            <tr className="border-b border-gray-100">
              <td className="py-2 text-gray-500">{t('payments:form.method')}</td>
              <td className="py-2 font-medium text-gray-900 text-right">{t(`payments:methods.${data.paymentMethod}`, { defaultValue: data.paymentMethod })}</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-2 text-gray-500">{t('payments:form.status')}</td>
              <td className="py-2 font-medium text-gray-900 text-right">{t(`payments:status.${data.paymentStatus}`, { defaultValue: data.paymentStatus })}</td>
            </tr>
            {data.notes && (
              <tr className="border-b border-gray-100">
                <td className="py-2 text-gray-500">{t('payments:form.notes')}</td>
                <td className="py-2 text-gray-700 text-right">{data.notes}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-4 bg-primary-50 border border-primary-100 rounded-xl p-4 flex items-center justify-between">
          <span className="text-lg font-bold text-gray-700">{t('payments:planForm.totalAmount')}</span>
          <span className="text-2xl font-bold text-primary-700">
            {new Intl.NumberFormat(i18n.language, { style: 'currency', currency: data.currency || 'TRY' }).format(data.amount)}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-xs text-gray-400 border-t border-gray-100 pt-4">
        <p>{t('payments:receipt.generatedElectronically')}</p>
        <p className="mt-1">{t('payments:receipt.documentNo')}: {receiptNo} - {formatDate(new Date().toISOString(), i18n.language)}</p>
      </div>
    </div>
  );
};

export default ReceiptModal;
