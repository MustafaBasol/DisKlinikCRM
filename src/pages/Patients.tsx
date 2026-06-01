import React, { useEffect, useState } from 'react';
import { Search, Filter, Plus, MoreHorizontal, Mail, Phone, Loader2, User, Building2, FileUp } from 'lucide-react';
import { patientService } from '../services/api';
import PatientForm from '../components/PatientForm';
import PatientImportModal from '../components/PatientImportModal';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useClinic } from '../context/ClinicContext';
import { useAuth } from '../context/AuthContext';
import { canImportPatients } from '../utils/permissions';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';

const Patients: React.FC = () => {
  const { t } = useTranslation(['patients', 'common']);
  const { selectedClinicId, availableClinics, hasMultipleClinics } = useClinic();
  const { user: currentUser } = useAuth();
  const { formatDate } = useClinicPreferences();
  const [patients, setPatients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
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
  }, [search, status, includeArchived, selectedClinicId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('patients:title')}</h1>
          <p className="text-gray-500 mt-1">{t('patients:subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canImportPatients(currentUser) && (
            <button
              onClick={() => setIsImportOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-green-50 hover:bg-green-100 text-green-700 font-medium rounded-lg border border-green-200 transition-colors text-sm"
            >
              <FileUp size={16} />
              {t('patients:importWithExcel')}
            </button>
          )}
          <button onClick={() => setIsFormOpen(true)} className="btn-primary">
            <Plus size={20} />
            {t('patients:addPatient')}
          </button>
        </div>
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100">
                  <th className="px-4 sm:px-6 py-4">{t('patients:list.name')}</th>
                  <th className="px-4 sm:px-6 py-4 hidden sm:table-cell">{t('patients:list.contact')}</th>
                  {hasMultipleClinics && selectedClinicId === 'all' && (
                    <th className="px-4 sm:px-6 py-4 hidden md:table-cell">{t('patients:list.branch')}</th>
                  )}
                  <th className="px-4 sm:px-6 py-4">{t('patients:list.status')}</th>
                  <th className="px-4 sm:px-6 py-4 hidden md:table-cell">{t('patients:list.createdAt')}</th>
                  <th className="px-4 sm:px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {patients.length > 0 ? patients.map((patient) => (
                  <tr key={patient.id} className="hover:bg-gray-50 transition-colors group">
                    <td className="px-4 sm:px-6 py-4">
                      <Link to={`/patients/${patient.id}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                        <div className="w-9 h-9 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center font-bold shrink-0">
                          {patient.firstName[0]}{patient.lastName[0]}
                        </div>
                        <span className="font-semibold text-gray-900 truncate max-w-[140px] sm:max-w-none">{patient.firstName} {patient.lastName}</span>
                      </Link>
                    </td>
                    <td className="px-4 sm:px-6 py-4 hidden sm:table-cell">
                      <div className="flex flex-col gap-1">
                        {patient.email && (
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <Mail size={14} className="text-gray-400" />
                            <span className="truncate max-w-[180px]">{patient.email}</span>
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
                    {hasMultipleClinics && selectedClinicId === 'all' && (
                      <td className="px-4 sm:px-6 py-4 hidden md:table-cell">
                        <span className="inline-flex items-center gap-1 text-xs bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full px-2 py-0.5">
                          <Building2 size={10} />
                          {availableClinics.find(c => c.id === (patient.primaryClinicId ?? patient.clinicId))?.name ?? '—'}
                        </span>
                      </td>
                    )}
                    <td className="px-4 sm:px-6 py-4">
                      <span className={`badge ${
                        patient.patientStatus === 'active' ? 'badge-green' : 
                        patient.patientStatus === 'new' ? 'badge-blue' : 
                        patient.patientStatus === 'archived' ? 'badge-red' : 'badge-gray'
                      }`}>
                        {t(`patients:status.${patient.patientStatus}`)}
                      </span>
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-sm text-gray-600 hidden md:table-cell">{formatDate(patient.createdAt)}</td>
                    <td className="px-4 sm:px-6 py-4 text-right">
                      <Link to={`/patients/${patient.id}`} className="text-gray-400 hover:text-primary-600 p-2 inline-block">
                        <User size={18} />
                      </Link>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={hasMultipleClinics && selectedClinicId === 'all' ? 6 : 5} className="px-6 py-12 text-center text-gray-500">
                      {t('patients:noPatientsFound')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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

      {isImportOpen && (
        <PatientImportModal
          onClose={() => setIsImportOpen(false)}
          onSuccess={() => {
            setIsImportOpen(false);
            fetchPatients();
          }}
          selectedClinicId={selectedClinicId}
        />
      )}
    </div>
  );
};

export default Patients;
