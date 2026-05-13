import React, { useEffect, useState } from 'react';
import { Search, Filter, Plus, MoreHorizontal, Mail, Phone, Loader2, User } from 'lucide-react';
import { patientService } from '../services/api';
import PatientForm from '../components/PatientForm';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const Patients: React.FC = () => {
  const { t } = useTranslation(['patients', 'common']);
  const [patients, setPatients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  const fetchPatients = async () => {
    setLoading(true);
    try {
      const response = await patientService.getAll({ 
        search: search || undefined, 
        status: status || undefined,
        includeArchived
      });
      setPatients(response.data);
    } catch (error) {
      console.error('Failed to fetch patients:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchPatients();
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, status, includeArchived]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('patients:title')}</h1>
          <p className="text-gray-500 mt-1">{t('patients:subtitle')}</p>
        </div>
        <button onClick={() => setIsFormOpen(true)} className="btn-primary">
          <Plus size={20} />
          {t('patients:addPatient')}
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text" 
            placeholder={t('patients:searchPlaceholder')} 
            className="input-field pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <select 
            className="input-field min-w-[150px]"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{t('patients:status.all', { defaultValue: 'All Statuses' })}</option>
            <option value="new">{t('patients:status.new')}</option>
            <option value="active">{t('patients:status.active')}</option>
            <option value="inactive">{t('patients:status.inactive')}</option>
            <option value="archived">{t('patients:status.archived')}</option>
          </select>
          <label className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm cursor-pointer hover:bg-gray-50 transition-colors">
            <input 
              type="checkbox" 
              className="w-4 h-4 rounded text-primary-600" 
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            {t('patients:includeArchived')}
          </label>
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-primary-600" size={32} />
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-4">{t('patients:list.name')}</th>
                <th className="px-6 py-4">{t('patients:list.contact')}</th>
                <th className="px-6 py-4">{t('patients:list.status')}</th>
                <th className="px-6 py-4">{t('patients:list.createdAt')}</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {patients.length > 0 ? patients.map((patient) => (
                <tr key={patient.id} className="hover:bg-gray-50 transition-colors group">
                  <td className="px-6 py-4">
                    <Link to={`/patients/${patient.id}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                      <div className="w-10 h-10 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center font-bold">
                        {patient.firstName[0]}{patient.lastName[0]}
                      </div>
                      <span className="font-semibold text-gray-900">{patient.firstName} {patient.lastName}</span>
                    </Link>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      {patient.email && (
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Mail size={14} className="text-gray-400" />
                          {patient.email}
                        </div>
                      )}
                      {patient.phone && (
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Phone size={14} className="text-gray-400" />
                          {patient.phone}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`badge ${
                      patient.patientStatus === 'active' ? 'badge-green' : 
                      patient.patientStatus === 'new' ? 'badge-blue' : 
                      patient.patientStatus === 'archived' ? 'badge-red' : 'badge-gray'
                    }`}>
                      {t(`patients:status.${patient.patientStatus}`)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{new Date(patient.createdAt).toLocaleDateString()}</td>
                  <td className="px-6 py-4 text-right">
                    <Link to={`/patients/${patient.id}`} className="text-gray-400 hover:text-primary-600 p-2 inline-block">
                      <User size={18} />
                    </Link>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    {t('patients:noPatientsFound')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {isFormOpen && (
        <PatientForm 
          onClose={() => setIsFormOpen(false)} 
          onSuccess={() => {
            setIsFormOpen(false);
            fetchPatients();
          }} 
        />
      )}
    </div>
  );
};

export default Patients;
