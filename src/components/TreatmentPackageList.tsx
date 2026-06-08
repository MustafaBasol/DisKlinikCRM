import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Edit2, Loader2, Package, Plus, Trash2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { inventoryService, serviceService, treatmentPackageService } from '../services/api';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';

type PackageItemForm = {
  serviceId: string;
  quantity: number;
  sortOrder: number;
  overridePrice: string;
  overrideDurationMin: string;
};

type PackageMaterialForm = {
  inventoryItemId: string;
  quantity: string;
  unit: string;
  isOptional: boolean;
  note: string;
};

const emptyItem = (sortOrder: number): PackageItemForm => ({
  serviceId: '',
  quantity: 1,
  sortOrder,
  overridePrice: '',
  overrideDurationMin: '',
});

const emptyMaterial = (): PackageMaterialForm => ({
  inventoryItemId: '',
  quantity: '',
  unit: '',
  isOptional: false,
  note: '',
});

const TreatmentPackageList: React.FC = () => {
  const { t } = useTranslation(['services', 'settings', 'common', 'treatmentCases']);
  const { formatCurrency, defaultCurrency } = useClinicPreferences();
  const [packages, setPackages] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState<any | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [packageRes, serviceRes, inventoryRes] = await Promise.all([
        treatmentPackageService.getAll({ includeInactive: true }),
        serviceService.getAll({ includeInactive: false }),
        inventoryService.getAll({ isActive: 'true' }),
      ]);
      setPackages(packageRes.data);
      setServices(serviceRes.data);
      setInventoryItems(inventoryRes.data);
      setError(null);
    } catch {
      setError(t('services:packages.errors.loadFailed', { defaultValue: 'Tedavi paketleri yuklenemedi.' }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openModal = (pkg: any = null) => {
    setEditingPackage(pkg);
    setIsModalOpen(true);
  };

  const toggleActive = async (pkg: any) => {
    await treatmentPackageService.update(pkg.id, { isActive: !pkg.isActive });
    fetchData();
  };

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary-500" /></div>;
  }

  if (error) {
    return <div className="text-red-500 p-4 bg-red-50 rounded-lg">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-bold">{t('services:packages.title', { defaultValue: 'Tedavi Paketleri' })}</h2>
          <p className="text-sm text-gray-500">{t('services:packages.subtitle', { defaultValue: 'Birden fazla hizmeti paket olarak planlayin.' })}</p>
        </div>
        <button onClick={() => openModal()} className="btn-primary">
          <Plus size={18} />
          {t('services:packages.newPackage', { defaultValue: 'Yeni Paket' })}
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs uppercase text-gray-500">
                <th className="p-4 font-semibold">{t('services:fields.name')}</th>
                <th className="p-4 font-semibold">{t('services:fields.category')}</th>
                <th className="p-4 font-semibold">{t('services:packages.fields.services', { defaultValue: 'Hizmetler' })}</th>
                <th className="p-4 font-semibold">{t('services:packages.fields.price', { defaultValue: 'Paket Fiyati' })}</th>
                <th className="p-4 font-semibold">{t('services:fields.status')}</th>
                <th className="p-4 font-semibold text-right">{t('common:actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {packages.map((pkg) => (
                <tr key={pkg.id} onClick={() => openModal(pkg)} className={`hover:bg-gray-50/50 transition-colors cursor-pointer ${!pkg.isActive ? 'opacity-50' : ''}`}>
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center">
                        <Package size={16} />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{pkg.name}</p>
                        <p className="text-xs text-gray-400">{pkg.pricingMode === 'SERVICE_SUM' ? 'Hizmet toplam fiyatlari' : 'Sabit paket fiyati'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-4 text-sm text-gray-600">{pkg.category || '-'}</td>
                  <td className="p-4 text-sm text-gray-600">{pkg.items?.length || 0}</td>
                  <td className="p-4 text-sm font-medium text-primary-600">
                    {formatCurrency(Number(pkg.price ?? 0), pkg.currency || defaultCurrency)}
                  </td>
                  <td className="p-4">
                    <span className={`badge ${pkg.isActive ? 'badge-green' : 'badge-gray'}`}>
                      {pkg.isActive ? t('services:status.active') : t('services:status.inactive')}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={(e) => { e.stopPropagation(); openModal(pkg); }} className="p-1.5 text-gray-400 hover:text-primary-600 transition-colors" title={t('common:edit')}>
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleActive(pkg); }}
                        className={`p-1.5 transition-colors ${pkg.isActive ? 'text-red-400 hover:text-red-600' : 'text-green-400 hover:text-green-600'}`}
                        title={pkg.isActive ? t('services:actions.deactivate') : t('services:actions.reactivate')}
                      >
                        {pkg.isActive ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {packages.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500 italic">
                    {t('services:packages.empty', { defaultValue: 'Henuz tedavi paketi eklenmemis.' })}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <TreatmentPackageModal
          pkg={editingPackage}
          services={services}
          inventoryItems={inventoryItems}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => {
            setIsModalOpen(false);
            fetchData();
          }}
        />
      )}
    </div>
  );
};

const TreatmentPackageModal: React.FC<{
  pkg: any | null;
  services: any[];
  inventoryItems: any[];
  onClose: () => void;
  onSuccess: () => void;
}> = ({ pkg, services, inventoryItems, onClose, onSuccess }) => {
  const { t } = useTranslation(['services', 'common', 'treatmentCases']);
  const { defaultCurrency } = useClinicPreferences();
  const [formData, setFormData] = useState({
    name: pkg?.name || '',
    category: pkg?.category || '',
    description: pkg?.description || '',
    price: pkg?.price ?? '',
    currency: pkg?.currency || defaultCurrency,
    pricingMode: pkg?.pricingMode || 'PACKAGE_PRICE',
    color: pkg?.color || '#6366F1',
    isActive: pkg?.isActive ?? true,
  });
  const [items, setItems] = useState<PackageItemForm[]>(() => {
    if (!pkg?.items?.length) return [emptyItem(0)];
    return pkg.items.map((item: any, index: number) => ({
      serviceId: item.serviceId,
      quantity: item.quantity || 1,
      sortOrder: item.sortOrder ?? index,
      overridePrice: item.overridePrice != null ? String(item.overridePrice) : '',
      overrideDurationMin: item.overrideDurationMin != null ? String(item.overrideDurationMin) : '',
    }));
  });
  const [materials, setMaterials] = useState<PackageMaterialForm[]>(() => {
    if (!pkg?.materials?.length) return [];
    return pkg.materials.map((material: any) => ({
      inventoryItemId: material.inventoryItemId,
      quantity: String(material.quantity),
      unit: material.unit || material.inventoryItem?.unit || '',
      isOptional: Boolean(material.isOptional),
      note: material.note || '',
    }));
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const serviceById = useMemo(() => new Map(services.map(service => [service.id, service])), [services]);
  const inventoryById = useMemo(() => new Map(inventoryItems.map(item => [item.id, item])), [inventoryItems]);

  const updateItem = (index: number, updates: Partial<PackageItemForm>) => {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, ...updates } : item));
  };

  const updateMaterial = (index: number, updates: Partial<PackageMaterialForm>) => {
    setMaterials(prev => prev.map((material, i) => i === index ? { ...material, ...updates } : material));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    const validItems = items.filter(item => item.serviceId);
    if (validItems.length === 0) {
      setError(t('services:packages.errors.serviceRequired', { defaultValue: 'Paket icin en az bir hizmet secin.' }));
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...formData,
        price: formData.price !== '' ? Number(formData.price) : null,
        items: validItems.map((item, index) => ({
          serviceId: item.serviceId,
          quantity: Number(item.quantity) || 1,
          sortOrder: index,
          overridePrice: item.overridePrice !== '' ? Number(item.overridePrice) : null,
          overrideDurationMin: item.overrideDurationMin !== '' ? Number(item.overrideDurationMin) : null,
        })),
        materials: materials
          .filter(material => material.inventoryItemId && material.quantity)
          .map(material => ({
            inventoryItemId: material.inventoryItemId,
            quantity: Number(material.quantity),
            unit: material.unit || inventoryById.get(material.inventoryItemId)?.unit || null,
            isOptional: material.isOptional,
            note: material.note || null,
          })),
      };

      if (pkg) {
        await treatmentPackageService.update(pkg.id, payload);
      } else {
        await treatmentPackageService.create(payload);
      }
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || t('services:packages.errors.saveFailed', { defaultValue: 'Tedavi paketi kaydedilemedi.' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center text-primary-600">
              <Package size={20} />
            </div>
            <h2 className="text-xl font-bold">{pkg ? t('services:packages.edit', { defaultValue: 'Paketi Duzenle' }) : t('services:packages.newPackage', { defaultValue: 'Yeni Paket' })}</h2>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
            <XCircle size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm flex items-center gap-2"><AlertCircle size={16} />{error}</div>}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('services:fields.name')} *</label>
              <input required type="text" className="input-field w-full" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('services:fields.category')}</label>
              <input type="text" className="input-field w-full" value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('services:fields.color')}</label>
              <input type="color" className="w-full h-10 rounded-lg cursor-pointer" value={formData.color} onChange={e => setFormData({ ...formData, color: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('services:fields.description')}</label>
              <textarea className="input-field w-full min-h-[72px]" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('services:packages.fields.pricingMode', { defaultValue: 'Fiyatlama' })}</label>
              <select className="input-field w-full" value={formData.pricingMode} onChange={e => setFormData({ ...formData, pricingMode: e.target.value })}>
                <option value="PACKAGE_PRICE">{t('services:packages.pricing.packagePrice', { defaultValue: 'Sabit paket fiyati' })}</option>
                <option value="SERVICE_SUM">{t('services:packages.pricing.serviceSum', { defaultValue: 'Hizmet toplam fiyatlari' })}</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('services:packages.fields.price', { defaultValue: 'Fiyat' })}</label>
                <input type="number" min="0" step="0.01" className="input-field w-full" value={formData.price} onChange={e => setFormData({ ...formData, price: e.target.value })} />
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
          </div>

          <section className="border border-gray-100 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-700">{t('services:packages.sections.services', { defaultValue: 'Paket Hizmetleri' })}</h3>
              <button type="button" className="btn-secondary py-1.5 px-3 text-xs" onClick={() => setItems(prev => [...prev, emptyItem(prev.length)])}>
                <Plus size={14} />
                {t('common:add')}
              </button>
            </div>
            <div className="divide-y divide-gray-50">
              {items.map((item, index) => {
                const selectedService = serviceById.get(item.serviceId);
                return (
                  <div key={index} className="p-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                    <div className="md:col-span-5">
                      <label className="block text-xs font-semibold text-gray-500 mb-1">{t('services:fields.name')}</label>
                      <select className="input-field w-full" value={item.serviceId} onChange={e => updateItem(index, { serviceId: e.target.value })}>
                        <option value="">{t('treatmentCases:procedures.selectService', { defaultValue: 'Hizmet secin' })}</option>
                        {services.map(service => (
                          <option key={service.id} value={service.id}>{service.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-gray-500 mb-1">{t('services:packages.fields.quantity', { defaultValue: 'Adet' })}</label>
                      <input type="number" min="1" className="input-field w-full" value={item.quantity} onChange={e => updateItem(index, { quantity: Number(e.target.value) })} />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-gray-500 mb-1">{t('services:fields.basePrice')}</label>
                      <input type="number" min="0" step="0.01" className="input-field w-full" value={item.overridePrice} onChange={e => updateItem(index, { overridePrice: e.target.value })} placeholder={selectedService?.basePrice ?? ''} />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-gray-500 mb-1">{t('services:fields.durationMinutes')}</label>
                      <input type="number" min="1" className="input-field w-full" value={item.overrideDurationMin} onChange={e => updateItem(index, { overrideDurationMin: e.target.value })} placeholder={selectedService?.durationMinutes ?? ''} />
                    </div>
                    <button type="button" className="md:col-span-1 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" onClick={() => setItems(prev => prev.filter((_, i) => i !== index))}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="border border-gray-100 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-700">{t('services:materials.packageTitle', { defaultValue: 'Paket Ekstra Malzemeleri' })}</h3>
                <p className="text-xs text-gray-500">{t('services:materials.packageHint', { defaultValue: 'Bu malzemeler paketteki tum islemler tamamlaninca bir kez dusulur.' })}</p>
              </div>
              <button type="button" className="btn-secondary py-1.5 px-3 text-xs" onClick={() => setMaterials(prev => [...prev, emptyMaterial()])}>
                <Plus size={14} />
                {t('common:add')}
              </button>
            </div>
            <div className="divide-y divide-gray-50">
              {materials.length === 0 ? (
                <p className="p-4 text-sm text-gray-400 italic">{t('services:materials.empty', { defaultValue: 'Ekstra malzeme tanimlanmadi.' })}</p>
              ) : materials.map((material, index) => (
                <div key={index} className="p-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                  <div className="md:col-span-5">
                    <label className="block text-xs font-semibold text-gray-500 mb-1">{t('treatmentCases:materials.item', { defaultValue: 'Malzeme' })}</label>
                    <select
                      className="input-field w-full"
                      value={material.inventoryItemId}
                      onChange={e => {
                        const item = inventoryById.get(e.target.value);
                        updateMaterial(index, { inventoryItemId: e.target.value, unit: item?.unit || material.unit });
                      }}
                    >
                      <option value="">{t('common:select')}</option>
                      {inventoryItems.map(item => (
                        <option key={item.id} value={item.id}>{item.name} ({item.currentStock} {item.unit})</option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-500 mb-1">{t('treatmentCases:materials.quantity', { defaultValue: 'Miktar' })}</label>
                    <input type="number" min="0.01" step="0.01" className="input-field w-full" value={material.quantity} onChange={e => updateMaterial(index, { quantity: e.target.value })} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-500 mb-1">{t('services:materials.unit', { defaultValue: 'Birim' })}</label>
                    <input type="text" className="input-field w-full" value={material.unit} onChange={e => updateMaterial(index, { unit: e.target.value })} />
                  </div>
                  <label className="md:col-span-2 flex items-center gap-2 text-sm text-gray-600 pb-2">
                    <input type="checkbox" checked={material.isOptional} onChange={e => updateMaterial(index, { isOptional: e.target.checked })} />
                    {t('treatmentCases:procedures.optional', { defaultValue: 'opsiyonel' })}
                  </label>
                  <button type="button" className="md:col-span-1 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" onClick={() => setMaterials(prev => prev.filter((_, i) => i !== index))}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <div className="flex gap-3 pt-4 border-t border-gray-100">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">{t('common:cancel')}</button>
            <button type="submit" disabled={saving} className="flex-1 btn-primary">
              {saving ? <Loader2 size={18} className="animate-spin" /> : t('common:save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TreatmentPackageList;
