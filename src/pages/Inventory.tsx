import { useState, useEffect, useCallback } from 'react';
import { Package, Plus, AlertTriangle, ArrowUpCircle, ArrowDownCircle, SlidersHorizontal, Search, X, Pencil } from 'lucide-react';
import { inventoryService } from '../services/api';
import { useAuth } from '../context/AuthContext';

// ── Label maps ────────────────────────────────────────────────────────────────
const CATEGORY_LABELS: Record<string, string> = {
  implant: 'İmplant',
  prosthetic: 'Protez',
  consumable: 'Sarf Malzeme',
  medication: 'İlaç',
  equipment: 'Ekipman',
  other: 'Diğer',
};

const UNIT_LABELS: Record<string, string> = {
  piece: 'Adet',
  box: 'Kutu',
  ml: 'ml',
  gram: 'gr',
  vial: 'Flakon',
  set: 'Set',
};

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  in: 'Giriş',
  out: 'Çıkış',
  adjustment: 'Düzeltme',
};

const REASON_LABELS: Record<string, string> = {
  purchase: 'Satın Alma',
  usage: 'Kullanım',
  treatment_use: 'Tedavide Kullanıldı',
  adjustment: 'Stok Düzeltme',
  wastage: 'Fire / Bozulma',
  return: 'İade',
};

const CATEGORY_COLORS: Record<string, string> = {
  implant: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  prosthetic: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  consumable: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  medication: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  equipment: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  other: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
};

const TX_COLORS: Record<string, string> = {
  in: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  out: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  adjustment: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface InventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  currentStock: number;
  minimumStock: number;
  unitCost?: number | null;
  supplier?: string | null;
  barcode?: string | null;
  notes?: string | null;
  isActive: boolean;
  isLowStock: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Transaction {
  id: string;
  type: string;
  quantity: number;
  unitCost?: number | null;
  reason?: string | null;
  notes?: string | null;
  createdAt: string;
  performedBy?: { id: string; firstName: string; lastName: string } | null;
  treatmentCase?: { id: string; title: string } | null;
}

// ── Item Form ─────────────────────────────────────────────────────────────────
const EMPTY_ITEM = {
  name: '',
  category: 'consumable',
  unit: 'piece',
  currentStock: 0,
  minimumStock: 0,
  unitCost: '',
  supplier: '',
  barcode: '',
  notes: '',
};

function ItemFormModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: InventoryItem | null;
  onSave: (data: any) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<any>(
    initial
      ? {
          name: initial.name,
          category: initial.category,
          unit: initial.unit,
          currentStock: initial.currentStock,
          minimumStock: initial.minimumStock,
          unitCost: initial.unitCost ?? '',
          supplier: initial.supplier ?? '',
          barcode: initial.barcode ?? '',
          notes: initial.notes ?? '',
        }
      : { ...EMPTY_ITEM }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setError('Malzeme adı zorunludur.');
    setSaving(true);
    setError('');
    try {
      await onSave({
        ...form,
        currentStock: Number(form.currentStock) || 0,
        minimumStock: Number(form.minimumStock) || 0,
        unitCost: form.unitCost !== '' ? Number(form.unitCost) : null,
        supplier: form.supplier || null,
        barcode: form.barcode || null,
        notes: form.notes || null,
      });
      onClose();
    } catch {
      setError('Kayıt sırasında hata oluştu.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {initial ? 'Malzeme Düzenle' : 'Yeni Malzeme'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
        </div>

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Malzeme Adı *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="ör. Bio-Oss 0.25g"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Kategori</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Birim</label>
              <select
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                {Object.entries(UNIT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>

            {!initial && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Açılış Stoğu</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.currentStock}
                  onChange={(e) => setForm({ ...form, currentStock: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Minimum Stok (Uyarı)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.minimumStock}
                onChange={(e) => setForm({ ...form, minimumStock: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Birim Maliyet (₺)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.unitCost}
                onChange={(e) => setForm({ ...form, unitCost: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="İsteğe bağlı"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tedarikçi</label>
              <input
                type="text"
                value={form.supplier}
                onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Barkod</label>
              <input
                type="text"
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notlar</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300">
              İptal
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Transaction Modal ─────────────────────────────────────────────────────────
function TransactionModal({
  item,
  onSave,
  onClose,
}: {
  item: InventoryItem;
  onSave: (itemId: string, data: any) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({ type: 'in', quantity: '', reason: 'purchase', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(form.quantity);
    if (!qty || qty <= 0) return setError('Miktar 0\'dan büyük olmalıdır.');
    if (form.type === 'out' && qty > item.currentStock) {
      return setError(`Yetersiz stok. Mevcut: ${item.currentStock} ${UNIT_LABELS[item.unit] || item.unit}`);
    }
    setSaving(true);
    setError('');
    try {
      await onSave(item.id, {
        type: form.type,
        quantity: qty,
        reason: form.reason || null,
        notes: form.notes || null,
      });
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'İşlem sırasında hata oluştu.');
    } finally {
      setSaving(false);
    }
  };

  const reasonOptions =
    form.type === 'in'
      ? ['purchase', 'return']
      : form.type === 'out'
      ? ['usage', 'treatment_use', 'wastage']
      : ['adjustment'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Stok Hareketi — {item.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={18} /></button>
        </div>

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">İşlem Tipi</label>
            <div className="flex gap-2">
              {['in', 'out', 'adjustment'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setForm({ ...form, type: t, reason: t === 'in' ? 'purchase' : t === 'out' ? 'usage' : 'adjustment' }); }}
                  className={`flex-1 py-2 text-sm rounded-lg border font-medium transition-colors ${
                    form.type === t
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {TRANSACTION_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Miktar ({UNIT_LABELS[item.unit] || item.unit}) — Mevcut: {item.currentStock}
            </label>
            <input
              type="number"
              min={0.01}
              step="0.01"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Neden</label>
            <select
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              {reasonOptions.map((r) => <option key={r} value={r}>{REASON_LABELS[r]}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notlar</label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              placeholder="İsteğe bağlı"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
              İptal
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
type Tab = 'list' | 'alerts' | 'history';

export default function Inventory() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [activeTab, setActiveTab] = useState<Tab>('list');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [alertItems, setAlertItems] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const [showItemForm, setShowItemForm] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [txItem, setTxItem] = useState<InventoryItem | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (search) params.search = search;
      if (categoryFilter) params.category = categoryFilter;
      const res = await inventoryService.getAll(params);
      setItems(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter]);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await inventoryService.getAlerts();
      setAlertItems(res.data.items || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAllTransactions = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch transactions across all items by using all items then their transactions
      const res = await inventoryService.getAll({});
      const allItems: InventoryItem[] = res.data;
      // Get transactions for each item in parallel (limit to 20 items for performance)
      const top = allItems.slice(0, 20);
      const results = await Promise.all(top.map((i) => inventoryService.getTransactions(i.id, { limit: 20 })));
      const all: Transaction[] = results.flatMap((r) => r.data);
      all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setTransactions(all.slice(0, 100));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'list') loadItems();
    else if (activeTab === 'alerts') loadAlerts();
    else if (activeTab === 'history') loadAllTransactions();
  }, [activeTab, loadItems, loadAlerts, loadAllTransactions]);

  const handleSaveItem = async (data: any) => {
    if (editItem) {
      await inventoryService.update(editItem.id, data);
    } else {
      await inventoryService.create(data);
    }
    setEditItem(null);
    setShowItemForm(false);
    loadItems();
  };

  const handleAddTransaction = async (itemId: string, data: any) => {
    await inventoryService.addTransaction(itemId, data);
    loadItems();
    if (activeTab === 'alerts') loadAlerts();
  };

  const tabs = [
    { id: 'list' as Tab, label: 'Stok Listesi', icon: <Package size={16} /> },
    { id: 'alerts' as Tab, label: `Düşük Stok${alertItems.length > 0 ? ` (${alertItems.length})` : ''}`, icon: <AlertTriangle size={16} /> },
    { id: 'history' as Tab, label: 'İşlem Geçmişi', icon: <SlidersHorizontal size={16} /> },
  ];

  // Pre-fetch alert count on mount
  useEffect(() => {
    inventoryService.getAlerts().then((r) => setAlertItems(r.data.items || [])).catch(() => {});
  }, []);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-xl flex items-center justify-center">
            <Package size={20} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Stok Takibi</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">İmplant, protez ve sarf malzeme yönetimi</p>
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={() => { setEditItem(null); setShowItemForm(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} /> Yeni Malzeme
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              } ${tab.id === 'alerts' && alertItems.length > 0 && activeTab !== 'alerts' ? 'text-orange-500 dark:text-orange-400' : ''}`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Stok Listesi ── */}
      {activeTab === 'list' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Malzeme veya tedarikçi ara..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">Tüm Kategoriler</option>
              {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">Yükleniyor...</div>
          ) : items.length === 0 ? (
            <div className="card p-6 text-center text-gray-500 dark:text-gray-400">
              <Package size={40} className="mx-auto mb-3 opacity-40" />
              <p>Stok kaydı bulunamadı.</p>
              {isAdmin && <p className="text-sm mt-1">"Yeni Malzeme" butonuyla ekleyebilirsiniz.</p>}
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-3 text-left">Malzeme</th>
                      <th className="px-4 py-3 text-left">Kategori</th>
                      <th className="px-4 py-3 text-center">Mevcut Stok</th>
                      <th className="px-4 py-3 text-center">Min. Stok</th>
                      <th className="px-4 py-3 text-right hidden md:table-cell">Birim Maliyet</th>
                      <th className="px-4 py-3 text-left hidden lg:table-cell">Tedarikçi</th>
                      <th className="px-4 py-3 text-center">İşlem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {items.map((item) => (
                      <tr key={item.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors ${item.isLowStock ? 'bg-orange-50/40 dark:bg-orange-900/10' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {item.isLowStock && <AlertTriangle size={14} className="text-orange-500 shrink-0" />}
                            <span className="font-medium text-gray-900 dark:text-white">{item.name}</span>
                          </div>
                          {item.barcode && <span className="text-xs text-gray-400">{item.barcode}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[item.category] || CATEGORY_COLORS.other}`}>
                            {CATEGORY_LABELS[item.category] || item.category}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`font-semibold ${item.isLowStock ? 'text-orange-600 dark:text-orange-400' : 'text-gray-900 dark:text-white'}`}>
                            {item.currentStock}
                          </span>
                          <span className="text-xs text-gray-400 ml-1">{UNIT_LABELS[item.unit] || item.unit}</span>
                        </td>
                        <td className="px-4 py-3 text-center text-gray-500 dark:text-gray-400">
                          {item.minimumStock} <span className="text-xs">{UNIT_LABELS[item.unit] || item.unit}</span>
                        </td>
                        <td className="px-4 py-3 text-right hidden md:table-cell text-gray-700 dark:text-gray-300">
                          {item.unitCost != null ? `₺${item.unitCost.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell text-gray-500 dark:text-gray-400 text-xs">
                          {item.supplier || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => setTxItem(item)}
                              title="Stok hareketi ekle"
                              className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
                            >
                              <ArrowUpCircle size={16} />
                            </button>
                            {isAdmin && (
                              <button
                                onClick={() => { setEditItem(item); setShowItemForm(true); }}
                                title="Düzenle"
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                              >
                                <Pencil size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Düşük Stok Uyarıları ── */}
      {activeTab === 'alerts' && (
        <div className="space-y-4">
          {loading ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">Yükleniyor...</div>
          ) : alertItems.length === 0 ? (
            <div className="card p-6 text-center">
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-3">
                <Package size={24} className="text-green-600 dark:text-green-400" />
              </div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">Düşük stok uyarısı yok!</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Tüm malzemeler minimum stok seviyesinin üzerinde.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm text-orange-600 dark:text-orange-400 font-medium">
                <AlertTriangle size={16} />
                <span>{alertItems.length} malzeme minimum stok seviyesinin altında veya eşit.</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {alertItems.map((item) => (
                  <div key={item.id} className="card p-4 border-l-4 border-orange-400">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white text-sm">{item.name}</p>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium mt-1 ${CATEGORY_COLORS[item.category] || CATEGORY_COLORS.other}`}>
                          {CATEGORY_LABELS[item.category] || item.category}
                        </span>
                      </div>
                      <button
                        onClick={() => setTxItem(item)}
                        className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100"
                        title="Stok girişi ekle"
                      >
                        <ArrowUpCircle size={16} />
                      </button>
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-sm">
                      <span className="text-orange-600 dark:text-orange-400 font-bold">{item.currentStock}</span>
                      <span className="text-gray-400">/ min {item.minimumStock}</span>
                      <span className="text-xs text-gray-400">{UNIT_LABELS[item.unit] || item.unit}</span>
                    </div>
                    {item.supplier && <p className="text-xs text-gray-400 mt-1">Tedarikçi: {item.supplier}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── İşlem Geçmişi ── */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {loading ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">Yükleniyor...</div>
          ) : transactions.length === 0 ? (
            <div className="card p-6 text-center text-gray-500 dark:text-gray-400">
              <SlidersHorizontal size={36} className="mx-auto mb-3 opacity-40" />
              <p>Henüz stok hareketi kaydı yok.</p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-3 text-left">Tarih</th>
                      <th className="px-4 py-3 text-left">İşlem</th>
                      <th className="px-4 py-3 text-left">Neden</th>
                      <th className="px-4 py-3 text-center">Miktar</th>
                      <th className="px-4 py-3 text-left hidden md:table-cell">Yapan</th>
                      <th className="px-4 py-3 text-left hidden lg:table-cell">Notlar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {transactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {new Date(tx.createdAt).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })}
                          <br />
                          <span className="text-xs">{new Date(tx.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${TX_COLORS[tx.type] || ''}`}>
                            {tx.type === 'in' ? <ArrowUpCircle size={11} /> : tx.type === 'out' ? <ArrowDownCircle size={11} /> : <SlidersHorizontal size={11} />}
                            {TRANSACTION_TYPE_LABELS[tx.type] || tx.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                          {tx.reason ? REASON_LABELS[tx.reason] || tx.reason : '—'}
                          {tx.treatmentCase && <span className="text-xs text-gray-400 block">{tx.treatmentCase.title}</span>}
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-gray-900 dark:text-white">{tx.quantity}</td>
                        <td className="px-4 py-3 hidden md:table-cell text-gray-500 dark:text-gray-400 text-xs">
                          {tx.performedBy ? `${tx.performedBy.firstName} ${tx.performedBy.lastName}` : '—'}
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell text-gray-400 text-xs">{tx.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showItemForm && (
        <ItemFormModal
          initial={editItem}
          onSave={handleSaveItem}
          onClose={() => { setShowItemForm(false); setEditItem(null); }}
        />
      )}
      {txItem && (
        <TransactionModal
          item={txItem}
          onSave={handleAddTransaction}
          onClose={() => setTxItem(null)}
        />
      )}
    </div>
  );
}
