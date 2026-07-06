import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Edit2, CheckCircle2, XCircle, Tag, Loader2, AlertCircle, Package, Trash2 } from 'lucide-react';
import { inventoryService, serviceService } from '../services/api';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import { useAuth } from '../context/AuthContext';
import { canManageServices, canManageTreatmentPackages } from '../utils/permissions';
import TreatmentPackageList from './TreatmentPackageList';

const ServiceList: React.FC = () => {
  const { t } = useTranslation(['services', 'settings', 'common', 'treatmentCases']);
  const { formatNumber } = useClinicPreferences();
  const { user } = useAuth();
  const canManage = canManageServices(user);
  const canManagePackages = canManageTreatmentPackages(user);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<any>(null);
  const [activeView, setActiveView] = useState<'services' | 'packages'>('services');
  const [packageCreateRequest, setPackageCreateRequest] = useState(0);

  const fetchServices = async () => {
    try {
      setLoading(true);
      const res = await serviceService.getAll({ includeInactive: true });
      setServices(res.data);
    } catch (err) {
      setError(t('services:errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServices();
  }, []);

  const handleOpenModal = (service: any = null) => {
    setEditingService(service);
    setIsModalOpen(true);
  };

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    await serviceService.update(id, { isActive: !currentStatus });
    fetchServices();
  };

  const handlePrimaryCreate = () => {
    if (activeView === 'services') {
      if (!canManage) return;
      handleOpenModal();
      return;
    }
    if (!canManagePackages) return;
    setPackageCreateRequest((value) => value + 1);
  };

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary-500" /></div>;
  }

  if (error) {
    return <div className="text-red-500 p-4 bg-red-50 rounded-lg">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold">{t('settings:services.title')}</h2>
          <p className="text-sm text-gray-500">{t('settings:services.subtitle')}</p>
        </div>
        {((activeView === 'services' && canManage) || (activeView === 'packages' && canManagePackages)) && (
          <button onClick={handlePrimaryCreate} className="btn-primary w-full sm:w-auto justify-center">
            <Plus size={18} />
            {activeView === 'services'
              ? t('settings:services.newService')
              : t('services:packages.newPackage')}
          </button>
        )}
      </div>

      <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1">
        <button
          type="button"
          onClick={() => setActiveView('services')}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${activeView === 'services' ? 'bg-primary-50 text-primary-700' : 'text-gray-500 hover:text-gray-700'}`}
        >
          {t('services:tabs.services')}
        </button>
        <button
          type="button"
          onClick={() => setActiveView('packages')}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center gap-2 ${activeView === 'packages' ? 'bg-primary-50 text-primary-700' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Package size={16} />
          {t('services:tabs.packages')}
        </button>
      </div>

      {activeView === 'packages' ? (
        <TreatmentPackageList createRequest={packageCreateRequest} />
      ) : (
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs uppercase text-gray-500">
                <th className="p-4 font-semibold">{t('services:fields.name')}</th>
                <th className="p-4 font-semibold">{t('services:fields.category')}</th>
                <th className="p-4 font-semibold">{t('services:fields.duration')}</th>
                <th className="p-4 font-semibold">{t('services:fields.basePrice')}</th>
                <th className="p-4 font-semibold">{t('services:fields.currency')}</th>
                <th className="p-4 font-semibold">{t('services:fields.status')}</th>
                <th className="p-4 font-semibold text-right">{t('common:actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {services.map((service) => (
                <tr
                  key={service.id}
                  onClick={canManage ? () => handleOpenModal(service) : undefined}
                  className={`hover:bg-gray-50/50 transition-colors ${canManage ? 'cursor-pointer' : ''} ${!service.isActive ? 'opacity-50' : ''}`}
                >
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded-full border border-gray-200" style={{ backgroundColor: service.color || '#e5e7eb' }} />
                      <span className="font-medium text-gray-900">{service.name}</span>
                    </div>
                  </td>
                  <td className="p-4 text-sm text-gray-600">{service.category || '-'}</td>
                  <td className="p-4 text-sm text-gray-600">{service.durationMinutes} min</td>
                  <td className="p-4 text-sm font-medium text-primary-600">
                    {service.basePrice != null ? formatNumber(service.basePrice) : <span className="text-gray-400 italic text-xs">{t('services:fields.noBasePrice')}</span>}
                  </td>
                  <td className="p-4 text-sm text-gray-600">{service.currency || <span className="text-gray-300">—</span>}</td>
                  <td className="p-4">
                    <span className={`badge ${service.isActive ? 'badge-green' : 'badge-gray'}`}>
                      {service.isActive ? t('services:status.active') : t('services:status.inactive')}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    {canManage ? (
                      <div className="flex justify-end gap-2">
                        <button onClick={(e) => { e.stopPropagation(); handleOpenModal(service); }} className="p-1.5 text-gray-400 hover:text-primary-600 transition-colors" title={t('services:actions.edit')}>
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleActive(service.id, service.isActive); }}
                          className={`p-1.5 transition-colors ${service.isActive ? 'text-red-400 hover:text-red-600' : 'text-green-400 hover:text-green-600'}`}
                          title={service.isActive ? t('services:actions.deactivate') : t('services:actions.reactivate')}
                        >
                          {service.isActive ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {services.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-500 italic">{t('settings:services.empty')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {isModalOpen && (
        <ServiceModal
          service={editingService}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => {
            setIsModalOpen(false);
            fetchServices();
          }}
        />
      )}
    </div>
  );
};

const ServiceModal: React.FC<{ service: any, onClose: () => void, onSuccess: () => void }> = ({ service, onClose, onSuccess }) => {
  const { t } = useTranslation(['services', 'settings', 'common', 'treatmentCases']);
  const { defaultCurrency } = useClinicPreferences();
  const [formData, setFormData] = useState({
    name: service?.name || '',
    category: service?.category || '',
    description: service?.description || '',
    durationMinutes: service?.durationMinutes || 30,
    basePrice: service?.basePrice ?? '',
    currency: service?.currency || defaultCurrency,
    color: service?.color || '#3B82F6',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const fetchMaterials = async () => {
      if (!service?.id) return;
      setMaterialsLoading(true);
      try {
        const [materialRes, inventoryRes] = await Promise.all([
          serviceService.getMaterials(service.id),
          inventoryService.getAll({ isActive: 'true' }),
        ]);
        if (!isMounted) return;
        setInventoryItems(inventoryRes.data);
        setMaterials(materialRes.data.map((material: any) => ({
          inventoryItemId: material.inventoryItemId,
          quantity: String(material.quantity),
          unit: material.unit || material.inventoryItem?.unit || '',
          isOptional: Boolean(material.isOptional),
          note: material.note || '',
        })));
      } catch {
        if (isMounted) setError(t('services:materials.errors.loadFailed'));
      } finally {
        if (isMounted) setMaterialsLoading(false);
      }
    };

    fetchMaterials();
    return () => {
      isMounted = false;
    };
  }, [service?.id, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const payload = {
        ...formData,
        durationMinutes: parseInt(String(formData.durationMinutes), 10),
        basePrice: formData.basePrice !== '' ? parseFloat(String(formData.basePrice)) : null,
      };

      if (service) {
        await serviceService.update(service.id, payload);
        await serviceService.replaceMaterials(
          service.id,
          materials
            .filter(material => material.inventoryItemId && material.quantity)
            .map(material => ({
              inventoryItemId: material.inventoryItemId,
              quantity: Number(material.quantity),
              unit: material.unit || inventoryItems.find(item => item.id === material.inventoryItemId)?.unit || null,
              isOptional: Boolean(material.isOptional),
              note: material.note || null,
            })),
        );
      } else {
        await serviceService.create(payload);
      }
      onSuccess();
    } catch (err: any) {
      const apiError = err.response?.data?.error;
      setError(typeof apiError === 'string' ? apiError : apiError?.message || t('services:errors.validationFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center text-primary-600">
              <Tag size={20} />
            </div>
            <h2 className="text-xl font-bold">{service ? t('services:actions.edit') : t('settings:services.newService')}</h2>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
            <XCircle size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm flex items-center gap-2"><AlertCircle size={16} />{error}</div>}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('services:fields.name')} *</label>
            <input required type="text" className="input-field w-full" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder={t('services:placeholders.name')} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('services:fields.category')}</label>
            <input type="text" className="input-field w-full" value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })} placeholder={t('services:placeholders.category')} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('services:fields.description')}</label>
            <textarea className="input-field w-full min-h-[72px]" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder={t('services:placeholders.description')} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('services:fields.durationMinutes')} *</label>
              <input required type="number" min="5" step="5" className="input-field w-full" value={formData.durationMinutes} onChange={e => setFormData({ ...formData, durationMinutes: Number(e.target.value) })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('services:fields.color')}</label>
              <input type="color" className="w-full h-10 rounded-lg cursor-pointer" value={formData.color} onChange={e => setFormData({ ...formData, color: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('services:fields.basePrice')}</label>
              <input type="number" min="0" step="0.01" className="input-field w-full" value={formData.basePrice} onChange={e => setFormData({ ...formData, basePrice: e.target.value })} placeholder="0.00" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('services:fields.currency')}</label>
              <select className="input-field w-full" value={formData.currency} onChange={e => setFormData({ ...formData, currency: e.target.value })}>
                <option value="TRY">TRY</option>
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="GBP">GBP</option>
                <option value="CAD">CAD</option>
                <option value="CHF">CHF</option>
              </select>
            </div>
          </div>

          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-700">{t('services:materials.title')}</h3>
                <p className="text-xs text-gray-500">{t('services:materials.hint')}</p>
              </div>
              {service && (
                <button
                  type="button"
                  className="btn-secondary py-1.5 px-3 text-xs"
                  onClick={() => setMaterials(prev => [...prev, { inventoryItemId: '', quantity: '', unit: '', isOptional: false, note: '' }])}
                >
                  <Plus size={14} />
                  {t('common:add')}
                </button>
              )}
            </div>

            {!service ? (
              <p className="p-4 text-sm text-gray-400 italic">
                {t('services:materials.saveServiceFirst')}
              </p>
            ) : materialsLoading ? (
              <div className="p-4 flex items-center gap-2 text-sm text-gray-500">
                <Loader2 size={16} className="animate-spin" />
                {t('common:loading')}
              </div>
            ) : materials.length === 0 ? (
              <p className="p-4 text-sm text-gray-400 italic">{t('services:materials.empty')}</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {materials.map((material, index) => (
                  <div key={index} className="p-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                    <div className="md:col-span-5">
                      <label className="block text-xs font-semibold text-gray-500 mb-1">{t('treatmentCases:materials.item')}</label>
                      <select
                        className="input-field w-full"
                        value={material.inventoryItemId}
                        onChange={e => {
                          const item = inventoryItems.find(inv => inv.id === e.target.value);
                          setMaterials(prev => prev.map((row, i) => i === index ? { ...row, inventoryItemId: e.target.value, unit: item?.unit || row.unit } : row));
                        }}
                      >
                        <option value="">{t('common:select')}</option>
                        {inventoryItems.map(item => (
                          <option key={item.id} value={item.id}>{item.name} ({item.currentStock} {item.unit})</option>
                        ))}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-gray-500 mb-1">{t('treatmentCases:materials.quantity')}</label>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        className="input-field w-full"
                        value={material.quantity}
                        onChange={e => setMaterials(prev => prev.map((row, i) => i === index ? { ...row, quantity: e.target.value } : row))}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-gray-500 mb-1">{t('services:materials.unit')}</label>
                      <input
                        type="text"
                        className="input-field w-full"
                        value={material.unit}
                        onChange={e => setMaterials(prev => prev.map((row, i) => i === index ? { ...row, unit: e.target.value } : row))}
                      />
                    </div>
                    <label className="md:col-span-2 flex items-center gap-2 text-sm text-gray-600 pb-2">
                      <input
                        type="checkbox"
                        checked={material.isOptional}
                        onChange={e => setMaterials(prev => prev.map((row, i) => i === index ? { ...row, isOptional: e.target.checked } : row))}
                      />
                      {t('treatmentCases:procedures.optional')}
                    </label>
                    <button
                      type="button"
                      className="md:col-span-1 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                      onClick={() => setMaterials(prev => prev.filter((_, i) => i !== index))}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-4 mt-6 border-t border-gray-100">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">{t('common:cancel')}</button>
            <button type="submit" disabled={loading} className="flex-1 btn-primary">
              {loading ? <Loader2 size={18} className="animate-spin" /> : t('services:actions.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ServiceList;
