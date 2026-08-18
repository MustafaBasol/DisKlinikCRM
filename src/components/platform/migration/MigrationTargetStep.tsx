import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertCircle, Building2, Stethoscope, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MigrationApiClient, MigrationRunDto, MigrationTargetOrganization } from '../../../services/platformMigrationApi';
import { getErrorMessage } from '../../../utils/errors';

interface Props {
  api: MigrationApiClient;
  onRunCreated: (run: MigrationRunDto) => void;
}

const MigrationTargetStep: React.FC<Props> = ({ api, onRunCreated }) => {
  const { t } = useTranslation(['platform']);
  const [organizations, setOrganizations] = useState<MigrationTargetOrganization[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [clinicId, setClinicId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const fetchTargets = useCallback(() => {
    setLoading(true);
    setError('');
    const controller = new AbortController();
    api
      .listTargets(controller.signal)
      .then((res) => setOrganizations(res.organizations))
      .catch((err) => setError(getErrorMessage(err, t('platform:migration.errors.targetsLoadFailed'))))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [api, t]);

  useEffect(() => fetchTargets(), [fetchTargets]);

  const selectedOrg = organizations?.find((o) => o.id === organizationId) ?? null;
  const clinics = selectedOrg?.clinics ?? [];

  const handleOrgChange = (id: string) => {
    setOrganizationId(id);
    setClinicId('');
  };

  const handleCreate = async () => {
    if (!organizationId || !clinicId) return;
    setCreating(true);
    setCreateError('');
    try {
      const run = await api.createRun(organizationId, clinicId);
      onRunCreated(run);
    } catch (err) {
      setCreateError(getErrorMessage(err, t('platform:migration.errors.createRunFailed')));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="card p-6 max-w-2xl">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">{t('platform:migration.target.title')}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">{t('platform:migration.target.subtitle')}</p>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 size={24} className="animate-spin text-primary-500" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
          <AlertCircle size={16} />
          <span className="text-sm">{error}</span>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="label flex items-center gap-1.5">
              <Building2 size={14} />
              {t('platform:migration.target.organization')}
            </label>
            <select
              className="input-field"
              value={organizationId}
              onChange={(e) => handleOrgChange(e.target.value)}
            >
              <option value="">{t('platform:migration.target.selectOrganization')}</option>
              {organizations?.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
            {organizations?.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">{t('platform:migration.target.noOrganizations')}</p>
            )}
          </div>

          <div>
            <label className="label flex items-center gap-1.5">
              <Stethoscope size={14} />
              {t('platform:migration.target.clinic')}
            </label>
            <select
              className="input-field"
              value={clinicId}
              onChange={(e) => setClinicId(e.target.value)}
              disabled={!organizationId}
            >
              <option value="">{t('platform:migration.target.selectClinic')}</option>
              {clinics.map((clinic) => (
                <option key={clinic.id} value={clinic.id}>{clinic.name}</option>
              ))}
            </select>
            {organizationId && clinics.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">{t('platform:migration.target.noClinics')}</p>
            )}
          </div>

          {createError && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
              <AlertCircle size={16} />
              <span className="text-sm">{createError}</span>
            </div>
          )}

          <button
            type="button"
            className="btn-primary w-full justify-center"
            disabled={!organizationId || !clinicId || creating}
            onClick={handleCreate}
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
            {t('platform:migration.target.createRun')}
          </button>
        </div>
      )}
    </div>
  );
};

export default MigrationTargetStep;
