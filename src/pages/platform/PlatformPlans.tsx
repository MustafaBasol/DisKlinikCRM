import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Plus, Pencil, X, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlatformApi } from '../../context/PlatformAuthContext';

interface Plan {
  id: string;
  name: string;
  displayName: string;
  maxUsers: number;
  maxPatients: number;
  features: Record<string, boolean>;
  monthlyPrice: string | number;
  isActive: boolean;
  createdAt: string;
  _count: { clinics: number; organizations: number };
}

const DEFAULT_FEATURES = { whatsapp: false, reports: false, compensation: false, inventory: false };
const FEATURE_KEYS = Object.keys(DEFAULT_FEATURES);

const PlatformPlans: React.FC = () => {
  const { t } = useTranslation(['platform']);
  const api = usePlatformApi();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    displayName: '',
    maxUsers: 10,
    maxPatients: 500,
    monthlyPrice: 0,
    isActive: true,
    features: { ...DEFAULT_FEATURES },
  });

  const fetchPlans = () => {
    setLoading(true);
    api.get('/platform/plans')
      .then((res) => setPlans(res.data))
      .catch(() => setError(t('platform:errors.plansLoadFailed')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchPlans(); }, []);

  const openEdit = (plan: Plan) => {
    setEditPlan(plan);
    setForm({
      name: plan.name,
      displayName: plan.displayName,
      maxUsers: plan.maxUsers,
      maxPatients: plan.maxPatients,
      monthlyPrice: Number(plan.monthlyPrice),
      isActive: plan.isActive,
      features: { ...DEFAULT_FEATURES, ...(plan.features as any) },
    });
    setShowForm(true);
  };

  const openCreate = () => {
    setEditPlan(null);
    setForm({ name: '', displayName: '', maxUsers: 10, maxPatients: 500, monthlyPrice: 0, isActive: true, features: { ...DEFAULT_FEATURES } });
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editPlan) {
        await api.put(`/platform/plans/${editPlan.id}`, form);
      } else {
        await api.post('/platform/plans', form);
      }
      setShowForm(false);
      fetchPlans();
    } catch (err: any) {
      alert(err.response?.data?.error ?? t('platform:errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('platform:plans.title')}</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={16} />
          {t('platform:plans.newPlan')}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={28} className="animate-spin text-blue-500" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-red-600 p-4">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => (
            <div key={plan.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-white">{plan.displayName}</h3>
                  <p className="text-xs text-gray-400 font-mono">{plan.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${plan.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-gray-100 text-gray-500'}`}>
                    {plan.isActive ? t('platform:statuses.active') : t('platform:statuses.inactive')}
                  </span>
                  <button onClick={() => openEdit(plan)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
                    <Pencil size={14} />
                  </button>
                </div>
              </div>

              <div className="space-y-1 text-sm mb-3">
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>{t('platform:plans.maxUsers')}</span>
                  <span className="font-medium">{plan.maxUsers}</span>
                </div>
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>{t('platform:plans.maxPatients')}</span>
                  <span className="font-medium">{plan.maxPatients}</span>
                </div>
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>{t('platform:plans.monthlyPrice')}</span>
                  <span className="font-medium">₺{Number(plan.monthlyPrice).toFixed(0)}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1 mb-3">
                {FEATURE_KEYS.map((key) => (
                  <span
                    key={key}
                    className={`text-xs px-1.5 py-0.5 rounded ${
                      (plan.features as any)[key]
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'
                        : 'bg-gray-100 text-gray-400 dark:bg-gray-800 line-through'
                    }`}
                  >
                    {t(`platform:plans.featuresList.${key}`)}
                  </span>
                ))}
              </div>

              <p className="text-xs text-gray-400">
                {t('platform:counts.organizationsClinics', { organizations: plan._count.organizations, clinics: plan._count.clinics })}
              </p>
            </div>
          ))}
          {plans.length === 0 && (
            <p className="text-gray-400 text-sm col-span-3 text-center py-12">{t('platform:plans.empty')}</p>
          )}
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 dark:text-white">
                {editPlan ? t('platform:plans.editPlan') : t('platform:plans.newPlan')}
              </h3>
              <button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:plans.code')}</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  disabled={!!editPlan}
                  placeholder="starter"
                  className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:plans.displayName')}</label>
                <input
                  type="text"
                  value={form.displayName}
                  onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                  placeholder={t('platform:plans.displayNamePlaceholder')}
                  className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:plans.maxUsers')}</label>
                  <input type="number" value={form.maxUsers} onChange={(e) => setForm((f) => ({ ...f, maxUsers: Number(e.target.value) }))} className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:plans.maxPatients')}</label>
                  <input type="number" value={form.maxPatients} onChange={(e) => setForm((f) => ({ ...f, maxPatients: Number(e.target.value) }))} className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:plans.price')} (₺)</label>
                  <input type="number" value={form.monthlyPrice} onChange={(e) => setForm((f) => ({ ...f, monthlyPrice: Number(e.target.value) }))} className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-2">{t('platform:plans.features')}</label>
                <div className="flex flex-wrap gap-3">
                  {FEATURE_KEYS.map((key) => (
                    <label key={key} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!(form.features as any)[key]}
                        onChange={(e) => setForm((f) => ({ ...f, features: { ...f.features, [key]: e.target.checked } }))}
                        className="rounded text-blue-600"
                      />
                      {t(`platform:plans.featuresList.${key}`)}
                    </label>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  className="rounded text-blue-600"
                />
                {t('platform:statuses.active')}
              </label>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">{t('platform:actions.cancel')}</button>
              <button onClick={handleSave} disabled={saving || !form.name || !form.displayName} className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {t('platform:actions.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlatformPlans;
