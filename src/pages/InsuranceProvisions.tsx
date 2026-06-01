import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Filter, Loader2, Plus, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { insuranceProvisionService, patientService } from '../services/api';
import InsuranceProvisionForm from '../components/InsuranceProvisionForm';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';

const statuses = ['draft', 'pending_documents', 'submitted', 'waiting_response', 'approved', 'partially_approved', 'rejected', 'cancelled'];
const types = ['sgk', 'tss', 'oss', 'private', 'corporate', 'other'];

const statusClass = (status: string) => {
  if (status === 'approved') return 'badge-green';
  if (status === 'partially_approved') return 'badge-blue';
  if (status === 'rejected' || status === 'cancelled') return 'badge-red';
  if (status === 'waiting_response' || status === 'submitted') return 'badge-yellow';
  return 'badge-gray';
};

const InsuranceProvisions: React.FC = () => {
  const { t } = useTranslation(['insurance', 'common']);
  const { formatCurrency } = useClinicPreferences();
  const [provisions, setProvisions] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [filters, setFilters] = useState({ status: '', insurance_type: '', patient_id: '', provider_name: '' });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [provisionsRes, patientsRes] = await Promise.all([
        insuranceProvisionService.getAll(filters),
        patientService.getAll(),
      ]);
      setProvisions(provisionsRes.data);
      setPatients(patientsRes.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [filters.status, filters.insurance_type, filters.patient_id, filters.provider_name]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={24} className="text-primary-600" />
            <h1 className="text-2xl font-bold text-gray-900">{t('insurance:title')}</h1>
          </div>
          <p className="text-gray-500 mt-1">{t('insurance:subtitle')}</p>
        </div>
        <button onClick={() => setIsFormOpen(true)} className="btn-primary">
          <Plus size={18} />
          {t('insurance:newProvision')}
        </button>
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3 text-sm font-bold text-gray-500 uppercase">
          <Filter size={16} />
          {t('insurance:filters.title')}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <select className="input-field" value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
            <option value="">{t('insurance:filters.allStatuses')}</option>
            {statuses.map(s => <option key={s} value={s}>{t(`insurance:statuses.${s}`)}</option>)}
          </select>
          <select className="input-field" value={filters.insurance_type} onChange={e => setFilters({ ...filters, insurance_type: e.target.value })}>
            <option value="">{t('insurance:filters.allTypes')}</option>
            {types.map(type => <option key={type} value={type}>{t(`insurance:types.${type}`)}</option>)}
          </select>
          <select className="input-field" value={filters.patient_id} onChange={e => setFilters({ ...filters, patient_id: e.target.value })}>
            <option value="">{t('insurance:filters.allPatients')}</option>
            {patients.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
          </select>
          <input className="input-field" value={filters.provider_name} onChange={e => setFilters({ ...filters, provider_name: e.target.value })} placeholder={t('insurance:filters.provider')} />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('insurance:fields.provider')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('insurance:fields.patient')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('insurance:fields.type')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('insurance:fields.status')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase text-right">{t('insurance:fields.requestedAmount')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase text-right">{t('insurance:fields.approvedAmount')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan={6} className="p-10 text-center"><Loader2 className="animate-spin mx-auto text-primary-500" /></td></tr>
              ) : provisions.length > 0 ? provisions.map(p => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="p-4">
                    <Link to={`/insurance-provisions/${p.id}`} className="font-bold text-gray-900 hover:text-primary-600">{p.insuranceProviderName}</Link>
                    <p className="text-xs text-gray-500">{p.provisionNumber || p.policyNumber || '-'}</p>
                  </td>
                  <td className="p-4 text-sm">{p.patient?.firstName} {p.patient?.lastName}</td>
                  <td className="p-4 text-sm">{t(`insurance:types.${p.insuranceType}`)}</td>
                  <td className="p-4"><span className={`badge ${statusClass(p.status)}`}>{t(`insurance:statuses.${p.status}`)}</span></td>
                  <td className="p-4 text-sm text-right font-semibold">{formatCurrency(p.requestedAmount, p.currency)}</td>
                  <td className="p-4 text-sm text-right font-semibold">{p.approvedAmount != null ? formatCurrency(p.approvedAmount, p.currency) : '-'}</td>
                </tr>
              )) : (
                <tr><td colSpan={6} className="p-10 text-center text-gray-400 italic">{t('common:noData')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isFormOpen && (
        <InsuranceProvisionForm
          onClose={() => setIsFormOpen(false)}
          onSuccess={() => {
            setIsFormOpen(false);
            fetchData();
          }}
        />
      )}
    </div>
  );
};

export default InsuranceProvisions;
