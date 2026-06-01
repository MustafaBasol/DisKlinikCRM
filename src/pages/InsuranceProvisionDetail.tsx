import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Edit2, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { insuranceProvisionService } from '../services/api';
import InsuranceProvisionForm from '../components/InsuranceProvisionForm';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';

const statusClass = (status: string) => {
  if (status === 'approved') return 'badge-green';
  if (status === 'partially_approved') return 'badge-blue';
  if (status === 'rejected' || status === 'cancelled') return 'badge-red';
  if (status === 'waiting_response' || status === 'submitted') return 'badge-yellow';
  return 'badge-gray';
};

const InsuranceProvisionDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(['insurance', 'common']);
  const { formatCurrency, formatDate, formatDateTime } = useClinicPreferences();
  const [provision, setProvision] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isEditOpen, setIsEditOpen] = useState(false);

  const fetchProvision = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await insuranceProvisionService.getById(id);
      setProvision(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProvision();
  }, [id]);

  const cancelProvision = async () => {
    if (!provision || !window.confirm(t('insurance:confirmCancel'))) return;
    await insuranceProvisionService.cancel(provision.id);
    fetchProvision();
  };

  if (loading) return <div className="h-96 flex items-center justify-center"><Loader2 className="animate-spin text-primary-600" size={48} /></div>;
  if (!provision) return null;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate('/insurance-provisions')} className="flex items-center gap-2 text-gray-500 hover:text-gray-900">
          <ArrowLeft size={20} />
          {t('insurance:backToList')}
        </button>
        <div className="flex gap-2">
          {provision.status !== 'cancelled' && (
            <button onClick={cancelProvision} className="btn-secondary text-red-600">
              <XCircle size={18} />
              {t('insurance:actions.cancel')}
            </button>
          )}
          <button onClick={() => setIsEditOpen(true)} className="btn-primary">
            <Edit2 size={18} />
            {t('common:edit')}
          </button>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <ShieldCheck size={28} className="text-primary-600" />
              <h1 className="text-2xl font-bold text-gray-900">{provision.insuranceProviderName}</h1>
              <span className={`badge ${statusClass(provision.status)}`}>{t(`insurance:statuses.${provision.status}`)}</span>
            </div>
            <p className="text-sm text-gray-500 mt-2">
              {t(`insurance:types.${provision.insuranceType}`)} • {provision.patient.firstName} {provision.patient.lastName}
              {provision.treatmentCase && <> • <Link className="text-primary-600 font-medium" to={`/treatment-cases/${provision.treatmentCase.id}`}>{provision.treatmentCase.title}</Link></>}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-5">
          <p className="text-xs font-bold text-gray-400 uppercase">{t('insurance:fields.requestedAmount')}</p>
          <p className="text-2xl font-bold">{formatCurrency(provision.requestedAmount, provision.currency)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-bold text-gray-400 uppercase">{t('insurance:fields.approvedAmount')}</p>
          <p className="text-2xl font-bold">{provision.approvedAmount != null ? formatCurrency(provision.approvedAmount, provision.currency) : '-'}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-bold text-gray-400 uppercase">{t('insurance:fields.patientResponsibility')}</p>
          <p className="text-2xl font-bold">{provision.patientResponsibilityAmount != null ? formatCurrency(provision.patientResponsibilityAmount, provision.currency) : '-'}</p>
        </div>
      </div>

      <div className="card p-6 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div><span className="text-gray-500">{t('insurance:fields.policyNumber')}:</span> <span className="font-medium">{provision.policyNumber || '-'}</span></div>
        <div><span className="text-gray-500">{t('insurance:fields.provisionNumber')}:</span> <span className="font-medium">{provision.provisionNumber || '-'}</span></div>
        <div><span className="text-gray-500">{t('insurance:fields.submittedAt')}:</span> <span className="font-medium">{formatDate(provision.submittedAt)}</span></div>
        <div><span className="text-gray-500">{t('insurance:fields.respondedAt')}:</span> <span className="font-medium">{formatDate(provision.respondedAt)}</span></div>
        <div><span className="text-gray-500">{t('insurance:fields.assignedTo')}:</span> <span className="font-medium">{provision.assignedTo ? `${provision.assignedTo.firstName} ${provision.assignedTo.lastName}` : '-'}</span></div>
        <div><span className="text-gray-500">{t('insurance:fields.createdBy')}:</span> <span className="font-medium">{provision.createdBy.firstName} {provision.createdBy.lastName}</span></div>
        {provision.rejectionReason && <div className="md:col-span-2 text-red-600"><span className="font-bold">{t('insurance:fields.rejectionReason')}:</span> {provision.rejectionReason}</div>}
        {provision.notes && <div className="md:col-span-2"><span className="text-gray-500">{t('insurance:fields.notes')}:</span> {provision.notes}</div>}
      </div>

      <div className="card p-6">
        <h3 className="font-bold mb-4">{t('insurance:activity')}</h3>
        <div className="space-y-4">
          {provision.activityLogs?.length > 0 ? provision.activityLogs.map((log: any) => (
            <div key={log.id} className="border-l-2 border-primary-100 pl-4">
              <p className="text-sm font-medium">{log.description}</p>
              <p className="text-xs text-gray-500">{log.user.firstName} {log.user.lastName} • {formatDateTime(log.createdAt)}</p>
            </div>
          )) : <p className="text-sm text-gray-400 italic">{t('common:noData')}</p>}
        </div>
      </div>

      {isEditOpen && (
        <InsuranceProvisionForm
          initialData={provision}
          onClose={() => setIsEditOpen(false)}
          onSuccess={() => {
            setIsEditOpen(false);
            fetchProvision();
          }}
        />
      )}
    </div>
  );
};

export default InsuranceProvisionDetail;
