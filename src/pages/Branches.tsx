import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Building2,
  Plus,
  Pencil,
  MoreVertical,
  CheckCircle,
  XCircle,
  PauseCircle,
  MapPin,
  Phone,
  Mail,
  Calendar,
  Clock,
  Users,
  LayoutDashboard,
  ChevronRight,
  MessageCircle,
} from 'lucide-react';
import { organizationBranchService, clinicWhatsAppService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useClinic } from '../context/ClinicContext';
import { canManageBranches, canViewBranches, canManageClinicSchedule, canAssignWhatsAppToClinic } from '../utils/permissions';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ClinicBranch {
  id: string;
  name: string;
  slug: string;
  city?: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    userClinics: number;
    appointments: number;
  };
}

interface BranchFormData {
  name: string;
  slug: string;
  city: string;
  address: string;
  phone: string;
  email: string;
  status: 'trial' | 'active' | 'inactive' | 'suspended';
}

const EMPTY_FORM: BranchFormData = {
  name: '',
  slug: '',
  city: '',
  address: '',
  phone: '',
  email: '',
  status: 'active',
};

const STATUS_CONFIG: Record<string, { labelKey: string; color: string; icon: JSX.Element }> = {
  active: {
    labelKey: 'branches:statuses.active',
    color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    icon: <CheckCircle size={14} />,
  },
  trial: {
    labelKey: 'branches:statuses.trial',
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    icon: <CheckCircle size={14} />,
  },
  inactive: {
    labelKey: 'branches:statuses.inactive',
    color: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    icon: <XCircle size={14} />,
  },
  suspended: {
    labelKey: 'branches:statuses.suspended',
    color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    icon: <PauseCircle size={14} />,
  },
};

// ── Slug auto-generator ────────────────────────────────────────────────────────

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ğ]/g, 'g')
    .replace(/[ü]/g, 'u')
    .replace(/[ş]/g, 's')
    .replace(/[ı]/g, 'i')
    .replace(/[ö]/g, 'o')
    .replace(/[ç]/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ── Branch form modal ──────────────────────────────────────────────────────────

interface BranchModalProps {
  branch: ClinicBranch | null;
  onClose: () => void;
  onSaved: () => void;
}

function BranchModal({ branch, onClose, onSaved }: BranchModalProps) {
  const { t } = useTranslation(['branches', 'common']);
  const isEdit = Boolean(branch);
  const [form, setForm] = useState<BranchFormData>(
    branch
      ? {
          name: branch.name,
          slug: branch.slug,
          city: branch.city ?? '',
          address: branch.address ?? '',
          phone: branch.phone ?? '',
          email: branch.email ?? '',
          status: branch.status as BranchFormData['status'],
        }
      : { ...EMPTY_FORM }
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(isEdit);

  const handleChange = (field: keyof BranchFormData, value: string) => {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      // Auto-generate slug from name unless manually edited
      if (field === 'name' && !slugManuallyEdited) {
        next.slug = toSlug(value);
      }
      return next;
    });
  };

  const handleSlugChange = (value: string) => {
    setSlugManuallyEdited(true);
    setForm(prev => ({ ...prev, slug: value.toLowerCase().replace(/[^a-z0-9-]/g, '') }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const payload = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        city: form.city.trim(),
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        status: form.status,
      };
      if (isEdit && branch) {
        await organizationBranchService.update(branch.id, payload);
      } else {
        await organizationBranchService.create(payload);
      }
      onSaved();
      onClose();
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ?? t('branches:errors.actionFailed');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {isEdit ? t('branches:form.editTitle') : t('branches:form.createTitle')}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded"
          >
            <XCircle size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 text-sm px-3 py-2 rounded-lg border border-red-200 dark:border-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('branches:form.fields.name')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={e => handleChange('name', e.target.value)}
                required
                placeholder={t('branches:form.placeholders.name')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Slug <span className="text-red-500">*</span>
                <span className="ml-2 text-xs font-normal text-gray-500">
                  {t('branches:form.slugHelp')}
                </span>
              </label>
              <input
                type="text"
                value={form.slug}
                onChange={e => handleSlugChange(e.target.value)}
                required
                placeholder="merkez-sube"
                pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('branches:form.fields.city')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.city}
                onChange={e => handleChange('city', e.target.value)}
                required
                placeholder={t('branches:form.placeholders.city')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('branches:form.fields.status')}
              </label>
              <select
                value={form.status}
                onChange={e => handleChange('status', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="active">{t('branches:statuses.active')}</option>
                <option value="trial">{t('branches:statuses.trial')}</option>
                <option value="inactive">{t('branches:statuses.inactive')}</option>
                <option value="suspended">{t('branches:statuses.suspended')}</option>
              </select>
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('branches:form.fields.address')}
              </label>
              <input
                type="text"
                value={form.address}
                onChange={e => handleChange('address', e.target.value)}
                placeholder={t('branches:form.placeholders.address')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('branches:form.fields.phone')}
              </label>
              <input
                type="tel"
                value={form.phone}
                onChange={e => handleChange('phone', e.target.value)}
                placeholder="+90 212 000 00 00"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('branches:form.fields.email')}
              </label>
              <input
                type="email"
                value={form.email}
                onChange={e => handleChange('email', e.target.value)}
                placeholder="sube@klinik.com"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              {t('common:cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? t('common:saving') : isEdit ? t('branches:form.update') : t('branches:form.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Status change modal ────────────────────────────────────────────────────────

interface StatusModalProps {
  branch: ClinicBranch;
  onClose: () => void;
  onSaved: () => void;
}

function StatusModal({ branch, onClose, onSaved }: StatusModalProps) {
  const { t } = useTranslation(['branches', 'common']);
  const [status, setStatus] = useState<'active' | 'inactive' | 'suspended'>(
    branch.status === 'trial' ? 'active' : (branch.status as 'active' | 'inactive' | 'suspended')
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await organizationBranchService.updateStatus(branch.id, status);
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? t('branches:errors.statusUpdateFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {t('branches:statusModal.title')}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded"
          >
            <XCircle size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 text-sm px-3 py-2 rounded-lg">
              {error}
            </div>
          )}
          <p className="text-sm text-gray-600 dark:text-gray-400">
            <span className="font-medium text-gray-900 dark:text-white">{branch.name}</span>{' '}
            {t('branches:statusModal.description')}
          </p>
          <select
            value={status}
            onChange={e => setStatus(e.target.value as 'active' | 'inactive' | 'suspended')}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500"
          >
            <option value="active">{t('branches:statuses.active')}</option>
            <option value="inactive">{t('branches:statuses.inactive')}</option>
            <option value="suspended">{t('branches:statuses.suspended')}</option>
          </select>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              {t('common:cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {loading ? t('common:saving') : t('common:save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Branches() {
  const { user } = useAuth();
  const { setSelectedClinicId } = useClinic();
  const { t } = useTranslation(['branches', 'common']);
  const navigate = useNavigate();

  const [branches, setBranches] = useState<ClinicBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState<ClinicBranch | null>(null);
  const [whatsappStatuses, setWhatsappStatuses] = useState<Record<string, string>>({});
  const [statusBranch, setStatusBranch] = useState<ClinicBranch | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const canManage = canManageBranches(user);
  const canView = canViewBranches(user);

  // Access guard
  if (!canView) {
    return <Navigate to="/" replace />;
  }

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await organizationBranchService.getAll();
      const list: ClinicBranch[] = Array.isArray(data) ? data : [];
      setBranches(list);

      // Fetch WhatsApp connection status for each branch in parallel
      const statusMap: Record<string, string> = {};
      await Promise.allSettled(
        list.map(async (b) => {
          try {
            const res = await clinicWhatsAppService.getAssignments(b.id);
            const assignments = Array.isArray(res.data) ? res.data : [];
            const def = assignments.find((a: any) => a.isDefault);
            statusMap[b.id] = def
              ? (def.whatsappConnection?.status ?? 'unknown')
              : 'none';
          } catch {
            statusMap[b.id] = 'unknown';
          }
        })
      );
      setWhatsappStatuses(statusMap);
    } catch {
      setError(t('branches:errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!openMenuId) return;
    const handler = () => setOpenMenuId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openMenuId]);

  const handleOpenDashboard = (clinicId: string) => {
    setSelectedClinicId(clinicId);
    navigate('/dashboard');
  };

  const handleViewAppointments = (clinicId: string) => {
    setSelectedClinicId(clinicId);
    navigate('/appointments');
  };

  const statusCfg = (status: string) =>
    STATUS_CONFIG[status] ?? STATUS_CONFIG['inactive'];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Building2 size={26} className="text-primary-600" />
            {t('branches:title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('branches:subtitle', { organization: user?.organization?.name ?? t('branches:organizationFallback') })}
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
          >
            <Plus size={16} />
            {t('branches:newBranch')}
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 px-4 py-3 rounded-lg border border-red-200 dark:border-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex justify-center items-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : branches.length === 0 ? (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <Building2 size={40} className="mx-auto mb-3 opacity-40" />
          <p className="font-medium">{t('branches:empty.title')}</p>
          {canManage && (
            <p className="text-sm mt-1">
              {t('branches:empty.description')}
            </p>
          )}
        </div>
      ) : (
        /* Branch cards grid */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {branches.map(branch => {
            const sc = statusCfg(branch.status);
            return (
              <div
                key={branch.id}
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow"
              >
                {/* Card header */}
                <div className="flex items-start justify-between p-5 pb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900 dark:text-white truncate text-base">
                        {branch.name}
                      </h3>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${sc.color}`}
                      >
                        {sc.icon}
                        {t(sc.labelKey)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 font-mono">
                      /{branch.slug}
                    </p>
                  </div>

                  {/* Actions menu */}
                  <div className="relative ml-2 flex-shrink-0">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setOpenMenuId(openMenuId === branch.id ? null : branch.id);
                      }}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <MoreVertical size={16} />
                    </button>
                    {openMenuId === branch.id && (
                      <div className="absolute right-0 top-8 z-20 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg py-1 min-w-[180px]">
                        <button
                          onClick={() => {
                            setOpenMenuId(null);
                            handleOpenDashboard(branch.id);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
                        >
                          <LayoutDashboard size={14} />
                          {t('branches:actions.goToDashboard')}
                        </button>
                        <button
                          onClick={() => {
                            setOpenMenuId(null);
                            handleViewAppointments(branch.id);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
                        >
                          <Calendar size={14} />
                          {t('branches:actions.viewAppointments')}
                        </button>
                        {canManageClinicSchedule(user) && (
                          <button
                            onClick={() => {
                              setOpenMenuId(null);
                              navigate(`/branches/${branch.id}/schedule`);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
                          >
                            <Clock size={14} />
                            {t('branches:actions.manageSchedule')}
                          </button>
                        )}
                        {canAssignWhatsAppToClinic(user) && (
                          <button
                            onClick={() => {
                              setOpenMenuId(null);
                              navigate('/organization/whatsapp');
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
                          >
                            <MessageCircle size={14} />
                            {t('branches:actions.whatsappSettings')}
                          </button>
                        )}
                        {canManage && (
                          <>
                            <div className="border-t border-gray-100 dark:border-gray-600 my-1" />
                            <button
                              onClick={() => {
                                setOpenMenuId(null);
                                setEditingBranch(branch);
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
                            >
                              <Pencil size={14} />
                              {t('common:edit')}
                            </button>
                            <button
                              onClick={() => {
                                setOpenMenuId(null);
                                setStatusBranch(branch);
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
                            >
                              <PauseCircle size={14} />
                              {t('branches:actions.changeStatus')}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Card body */}
                <div className="px-5 pb-4 space-y-1.5">
                  {branch.city && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <MapPin size={13} className="flex-shrink-0" />
                      <span className="truncate">
                        {branch.city}
                        {branch.address ? ` — ${branch.address}` : ''}
                      </span>
                    </div>
                  )}
                  {branch.phone && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <Phone size={13} className="flex-shrink-0" />
                      <span>{branch.phone}</span>
                    </div>
                  )}
                  {branch.email && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <Mail size={13} className="flex-shrink-0" />
                      <span className="truncate">{branch.email}</span>
                    </div>
                  )}

                  {/* WhatsApp connection status */}
                  {whatsappStatuses[branch.id] !== undefined && (
                    <div className="flex items-center justify-between pt-1.5 mt-0.5 border-t border-gray-100 dark:border-gray-700/50">
                      {(() => {
                        const st = whatsappStatuses[branch.id];
                        const cls =
                          st === 'connected'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                            : st === 'none'
                            ? 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                            : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300';
                        const label =
                          st === 'connected'
                            ? t('branches:whatsapp.connected')
                            : st === 'none'
                            ? t('branches:whatsapp.none')
                            : t('branches:whatsapp.disconnected');
                        return (
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${cls}`}>
                            <MessageCircle size={11} />
                            {label}
                          </span>
                        );
                      })()}
                      {canAssignWhatsAppToClinic(user) && (
                        <button
                          onClick={() => navigate('/organization/whatsapp')}
                          className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 flex items-center gap-1 ml-2"
                        >
                          <MessageCircle size={11} /> {t('common:settings')}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Card footer stats */}
                {branch._count && (
                  <div className="flex items-center gap-4 px-5 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 rounded-b-xl">
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                      <Users size={13} />
                      <span>{t('branches:stats.staffCount', { count: branch._count.userClinics })}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                      <Calendar size={13} />
                      <span>{t('branches:stats.appointmentsToday', { count: branch._count.appointments })}</span>
                    </div>
                    <div className="ml-auto">
                      <button
                        onClick={() => handleOpenDashboard(branch.id)}
                        className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                      >
                        {t('branches:actions.go')} <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit modal */}
      {showAddModal && (
        <BranchModal
          branch={null}
          onClose={() => setShowAddModal(false)}
          onSaved={fetchBranches}
        />
      )}
      {editingBranch && (
        <BranchModal
          branch={editingBranch}
          onClose={() => setEditingBranch(null)}
          onSaved={fetchBranches}
        />
      )}
      {statusBranch && (
        <StatusModal
          branch={statusBranch}
          onClose={() => setStatusBranch(null)}
          onSaved={fetchBranches}
        />
      )}
    </div>
  );
}
