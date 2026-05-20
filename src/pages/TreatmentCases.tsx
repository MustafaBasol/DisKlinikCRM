import React, { useEffect, useState } from 'react';
import { 
  Briefcase, 
  Plus, 
  Search, 
  Filter, 
  Eye, 
  Edit2, 
  MoreVertical, 
  Loader2,
  DollarSign,
  TrendingUp,
  User,
  Stethoscope,
  Calendar,
  ArrowRight
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { treatmentCaseService, userService } from '../services/api';
import TreatmentCaseForm from '../components/TreatmentCaseForm';
import { useClinic } from '../context/ClinicContext';

const TreatmentCases: React.FC = () => {
  const { t } = useTranslation(['treatmentCases', 'common']);
  const navigate = useNavigate();
  const { selectedClinicId } = useClinic();
  
  const [cases, setCases] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<any>(null);
  
  // Filters
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [practitionerId, setPractitionerId] = useState('');
  const [openOnly, setOpenOnly] = useState(true);

  const fetchCases = async () => {
    setLoading(true);
    try {
      const response = await treatmentCaseService.getAll({
        stage: stage || undefined,
        practitionerId: practitionerId || undefined,
        openOnly: openOnly || undefined,
        search: search || undefined
      });
      setCases(response.data);
    } catch (error) {
      console.error('Failed to fetch cases:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCases();
  }, [stage, practitionerId, openOnly, selectedClinicId]);

  useEffect(() => {
    const timeout = setTimeout(fetchCases, 500);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    const fetchDoctors = async () => {
      try {
        const res = await userService.getDoctors();
        setDoctors(res.data);
      } catch (err) {
        console.error(err);
      }
    };
    fetchDoctors();
  }, []);

  const getStageColor = (s: string) => {
    switch (s) {
      case 'new': return 'bg-blue-50 text-blue-700 border-blue-100';
      case 'accepted': return 'bg-green-50 text-green-700 border-green-100';
      case 'in_progress': return 'bg-indigo-50 text-indigo-700 border-indigo-100';
      case 'completed': return 'bg-emerald-50 text-emerald-700 border-emerald-100';
      case 'lost': return 'bg-red-50 text-red-700 border-red-100';
      default: return 'bg-gray-50 text-gray-700 border-gray-100';
    }
  };

  const totalValue = cases.reduce((acc, curr) => acc + (curr.acceptedAmount || curr.estimatedAmount || 0), 0);
  const summaryCurrency = cases[0]?.currency || 'TRY';

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('treatmentCases:title')}</h1>
          <p className="text-gray-500 mt-1">{t('treatmentCases:subtitle')}</p>
        </div>
        <button 
          onClick={() => {
            setEditingCase(null);
            setIsFormOpen(true);
          }} 
          className="btn-primary"
        >
          <Plus size={20} />
          {t('treatmentCases:newCase')}
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card p-6 bg-gradient-to-br from-primary-600 to-primary-700 text-white border-none">
          <div className="flex items-center justify-between mb-4">
            <TrendingUp size={24} className="opacity-80" />
            <span className="text-xs font-bold uppercase tracking-wider opacity-80">{t('treatmentCases:summary.pipelineValue')}</span>
          </div>
          <p className="text-3xl font-bold">{totalValue.toLocaleString()} <span className="text-lg font-normal opacity-80">{summaryCurrency}</span></p>
          <p className="text-sm mt-2 opacity-80">{t('treatmentCases:summary.activeOpportunities', { count: cases.length })}</p>
        </div>
        <div className="card p-6 bg-white flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <Briefcase className="text-primary-500" size={20} />
            <span className="badge badge-blue">{t('treatmentCases:summary.active')}</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{cases.filter(c => !['completed', 'lost'].includes(c.stage)).length}</p>
          <p className="text-xs text-gray-500 mt-1">{t('treatmentCases:summary.casesInProgress')}</p>
        </div>
        <div className="card p-6 bg-white flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <TrendingUp className="text-green-500" size={20} />
            <span className="badge badge-green">{t('treatmentCases:summary.closed')}</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{cases.filter(c => c.stage === 'completed').length}</p>
          <p className="text-xs text-gray-500 mt-1">{t('treatmentCases:summary.successfullyCompleted')}</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text" 
            placeholder={t('common:search')}
            className="input-field pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select className="input-field" value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">{t('treatmentCases:filters.allStages')}</option>
          {[
            'new', 'consultation_scheduled', 'consultation_done', 
            'quote_sent', 'waiting_patient_decision', 'accepted', 
            'in_progress', 'completed', 'lost'
          ].map(s => (
            <option key={s} value={s}>{t(`treatmentCases:stages.${s}`)}</option>
          ))}
        </select>

        <select className="input-field" value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)}>
          <option value="">{t('treatmentCases:filters.allPractitioners')}</option>
          {doctors.map(d => (
            <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>
          ))}
        </select>

        <div className="flex gap-2">
          <button 
            onClick={() => setOpenOnly(!openOnly)}
            className={`flex-1 px-4 py-2 rounded-xl text-sm font-semibold transition-all border ${
              openOnly ? 'bg-primary-50 border-primary-200 text-primary-700' : 'bg-white border-gray-200 text-gray-600'
            }`}
          >
            {t('treatmentCases:filters.openOnly')}
          </button>
        </div>
      </div>

      {/* Table View */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('treatmentCases:list.title')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('treatmentCases:list.patient')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider hidden md:table-cell">{t('treatmentCases:list.practitioner')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('treatmentCases:list.stage')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">{t('treatmentCases:list.accepted')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">{t('common:actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-12 text-center">
                    <Loader2 className="animate-spin text-primary-600 mx-auto" size={32} />
                  </td>
                </tr>
              ) : cases.length > 0 ? (
                cases.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50/50 transition-colors group cursor-pointer" onClick={() => navigate(`/treatment-cases/${c.id}`)}>
                    <td className="p-4">
                      <p className="font-bold text-gray-900">{c.title}</p>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600">
                          {c.patient.firstName[0]}{c.patient.lastName[0]}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{c.patient.firstName} {c.patient.lastName}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 hidden md:table-cell">
                      <p className="text-sm text-gray-700">
                        {c.practitioner ? `${c.practitioner.firstName} ${c.practitioner.lastName}` : <span className="text-gray-400 italic">{t('common:unassigned')}</span>}
                      </p>
                    </td>
                    <td className="p-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold border ${getStageColor(c.stage)}`}>
                        {t(`treatmentCases:stages.${c.stage}`)}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <p className="text-sm font-bold text-gray-900">
                        {c.acceptedAmount?.toLocaleString() || c.estimatedAmount?.toLocaleString() || 0} {c.currency}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {c.acceptedAmount ? t('treatmentCases:list.accepted') : t('treatmentCases:list.estimated')}
                      </p>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={(e) => { e.stopPropagation(); navigate(`/treatment-cases/${c.id}`); }}
                          className="p-2 text-gray-400 hover:bg-white hover:text-primary-600 rounded-lg transition-all shadow-sm"
                        >
                          <Eye size={18} />
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); setEditingCase(c); setIsFormOpen(true); }}
                          className="p-2 text-gray-400 hover:bg-white hover:text-blue-600 rounded-lg transition-all shadow-sm"
                        >
                          <Edit2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-gray-400">
                    <Briefcase size={48} className="mx-auto mb-3 opacity-20" />
                    <p>{t('common:noData')}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isFormOpen && (
        <TreatmentCaseForm 
          onClose={() => setIsFormOpen(false)} 
          onSuccess={() => {
            setIsFormOpen(false);
            fetchCases();
          }}
          initialData={editingCase}
        />
      )}
    </div>
  );
};

export default TreatmentCases;
