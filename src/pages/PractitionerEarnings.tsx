import React, { useState, useEffect, useCallback } from 'react';
import {
  DollarSign, Users, CheckCircle, Clock, XCircle, Plus,
  ChevronDown, ChevronUp, AlertCircle, Loader2, Settings,
  Pencil, Trash2, CreditCard,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  compensationRuleService,
  practitionerEarningService,
  practitionerPayoutService,
  userService,
  serviceService,
} from '../services/api';

type Tab = 'summary' | 'earnings' | 'payouts' | 'settings';

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending:  { label: 'Bekliyor',   cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' },
  approved: { label: 'Onaylandı',  cls: 'bg-blue-100   text-blue-800   dark:bg-blue-900/30   dark:text-blue-300'   },
  paid:     { label: 'Ödendi',     cls: 'bg-green-100  text-green-800  dark:bg-green-900/30  dark:text-green-300'  },
  cancelled:{ label: 'İptal',      cls: 'bg-gray-100   text-gray-600   dark:bg-gray-700      dark:text-gray-400'   },
};

const COMP_TYPE_LABELS: Record<string, string> = {
  fixed: 'Sabit Aylık',
  percentage: 'Yüzde Bazlı',
  fixed_plus_percentage: 'Sabit + Yüzde',
  per_service: 'Hizmet Bazlı',
};

const CALC_BASE_LABELS: Record<string, string> = {
  collected: 'Tahsilat Bazlı',
  billed: 'Fatura Bazlı',
};

const METHOD_LABELS: Record<string, string> = {
  cash: 'Nakit', bank_transfer: 'Havale/EFT', card: 'Kart', other: 'Diğer',
};

function fmt(n: number) {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function currentPeriod() {
  const d = new Date();
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const SummaryTab: React.FC<{ periodMonth: number; periodYear: number; practitioners: any[] }> = ({
  periodMonth, periodYear, practitioners,
}) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterPractitioner, setFilterPractitioner] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { periodMonth, periodYear };
      if (filterPractitioner) params.practitionerId = filterPractitioner;
      const res = await practitionerEarningService.getSummary(params);
      setData(res.data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [periodMonth, periodYear, filterPractitioner]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <select
          value={filterPractitioner}
          onChange={e => setFilterPractitioner(e.target.value)}
          className="input-field w-52"
        >
          <option value="">Tüm Hekimler</option>
          {practitioners.map(p => (
            <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
          ))}
        </select>
        <button onClick={load} className="btn-secondary text-sm">Yenile</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-500" size={32} /></div>
      ) : data.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Bu dönemde kazanç verisi bulunamadı.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                <th className="text-left py-3 pl-4 pr-4">Hekim</th>
                <th className="text-right py-3 pr-4">Brüt Tutar</th>
                <th className="text-right py-3 pr-4">Tahsilat</th>
                <th className="text-right py-3 pr-4">Hesaplanan Kazanç</th>
                <th className="text-right py-3 pr-4">Onaylanan</th>
                <th className="text-right py-3 pr-4">Ödenen</th>
                <th className="text-right py-3 pr-4">Kalan</th>
              </tr>
            </thead>
            <tbody>
              {data.map(row => {
                const remaining = row.totalEarning - row.paidEarning;
                return (
                  <tr key={row.practitionerId} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="py-3 pl-4 pr-4 font-medium text-gray-900 dark:text-white">{row.practitionerName}</td>
                    <td className="py-3 pr-4 text-right text-gray-700 dark:text-gray-300">{fmt(row.totalGross)}</td>
                    <td className="py-3 pr-4 text-right text-gray-700 dark:text-gray-300">{fmt(row.totalCollected)}</td>
                    <td className="py-3 pr-4 text-right font-semibold text-gray-900 dark:text-white">{fmt(row.totalEarning)}</td>
                    <td className="py-3 pr-4 text-right text-blue-600 dark:text-blue-400">{fmt(row.approvedEarning)}</td>
                    <td className="py-3 pr-4 text-right text-green-600 dark:text-green-400">{fmt(row.paidEarning)}</td>
                    <td className="py-3 pr-4 text-right font-semibold text-orange-600 dark:text-orange-400">{fmt(remaining > 0 ? remaining : 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const EarningsTab: React.FC<{ practitioners: any[] }> = ({ practitioners }) => {
  const [earnings, setEarnings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterPractitioner, setFilterPractitioner] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterMonth, setFilterMonth] = useState(currentPeriod().month);
  const [filterYear, setFilterYear] = useState(currentPeriod().year);
  const [adjustTarget, setAdjustTarget] = useState<any>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params: any = { limit: 100, periodMonth: filterMonth, periodYear: filterYear };
      if (filterPractitioner) params.practitionerId = filterPractitioner;
      if (filterStatus) params.status = filterStatus;
      const res = await practitionerEarningService.getAll(params);
      setEarnings(res.data.earnings || res.data);
    } catch {
      setError('Kazanç listesi yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [filterPractitioner, filterStatus, filterMonth, filterYear]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (action: () => Promise<any>) => {
    try { await action(); load(); } catch { setError('İşlem başarısız.'); }
  };

  const doAdjust = async () => {
    if (!adjustTarget) return;
    await doAction(() => practitionerEarningService.adjust(adjustTarget.id, {
      adminAdjustmentAmount: parseFloat(adjustAmount),
      adminAdjustmentReason: adjustReason,
    }));
    setAdjustTarget(null); setAdjustAmount(''); setAdjustReason('');
  };

  const effectiveAmount = (e: any) => e.adminAdjustmentAmount ?? e.earningAmount;

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = [2024, 2025, 2026, 2027];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <select value={filterMonth} onChange={e => setFilterMonth(Number(e.target.value))} className="input-field w-32">
          {months.map(m => <option key={m} value={m}>{m}. Ay</option>)}
        </select>
        <select value={filterYear} onChange={e => setFilterYear(Number(e.target.value))} className="input-field w-24">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={filterPractitioner} onChange={e => setFilterPractitioner(e.target.value)} className="input-field w-48">
          <option value="">Tüm Hekimler</option>
          {practitioners.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input-field w-36">
          <option value="">Tüm Durumlar</option>
          {Object.entries(STATUS_BADGE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button onClick={load} className="btn-secondary text-sm">Yenile</button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
          <AlertCircle size={16} />{error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-500" size={32} /></div>
      ) : earnings.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Kazanç kaydı bulunamadı.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                <th className="text-left py-3 pl-4 pr-3">Hekim</th>
                <th className="text-left py-3 pr-3">Hasta</th>
                <th className="text-left py-3 pr-3">Hizmet</th>
                <th className="text-right py-3 pr-3">Tahsilat</th>
                <th className="text-right py-3 pr-3">Kazanç</th>
                <th className="text-right py-3 pr-3">Düz. Kazanç</th>
                <th className="text-center py-3 pr-3">Durum</th>
                <th className="text-center py-3 pr-4">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {earnings.map(e => (
                <tr key={e.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="py-3 pl-4 pr-3 font-medium text-gray-900 dark:text-white">
                    {e.practitioner?.firstName} {e.practitioner?.lastName}
                  </td>
                  <td className="py-3 pr-3 text-gray-600 dark:text-gray-400">
                    {e.patient ? `${e.patient.firstName} ${e.patient.lastName}` : '—'}
                  </td>
                  <td className="py-3 pr-3 text-gray-600 dark:text-gray-400">
                    {e.service?.name ?? (e.treatmentCase?.title ?? '—')}
                  </td>
                  <td className="py-3 pr-3 text-right">
                    <div className="flex flex-col items-end">
                      <span>{fmt(e.collectedAmount)}</span>
                      {e.grossAmount > 0 && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full mt-0.5 ${
                          e.collectedAmount >= e.grossAmount ? 'bg-green-100 text-green-700' :
                          e.collectedAmount > 0 ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-600'
                        }`}>
                          %{Math.round((e.collectedAmount / e.grossAmount) * 100)} tahsil
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 pr-3 text-right">{fmt(e.earningAmount)}</td>
                  <td className="py-3 pr-3 text-right font-semibold text-gray-900 dark:text-white">
                    {e.adminAdjustmentAmount != null ? fmt(e.adminAdjustmentAmount) : '—'}
                  </td>
                  <td className="py-3 pr-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[e.status]?.cls}`}>
                      {STATUS_BADGE[e.status]?.label}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {e.status === 'pending' && (
                        <button
                          onClick={() => doAction(() => practitionerEarningService.approve(e.id))}
                          className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 hover:bg-blue-200"
                          title="Onayla"
                        >Onayla</button>
                      )}
                      {(e.status === 'pending' || e.status === 'approved') && (
                        <button
                          onClick={() => { setAdjustTarget(e); setAdjustAmount(String(effectiveAmount(e))); setAdjustReason(''); }}
                          className="text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 hover:bg-yellow-200"
                          title="Düzenle"
                        ><Pencil size={12} /></button>
                      )}
                      {e.status === 'approved' && (
                        <button
                          onClick={() => doAction(() => practitionerEarningService.markPaid(e.id))}
                          className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 hover:bg-green-200"
                          title="Ödendi işaretle"
                        >Ödendi</button>
                      )}
                      {e.status !== 'paid' && e.status !== 'cancelled' && (
                        <button
                          onClick={() => { if (window.confirm('Bu kazancı iptal etmek istediğinize emin misiniz?')) doAction(() => practitionerEarningService.cancel(e.id)); }}
                          className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 hover:bg-red-200"
                          title="İptal"
                        ><XCircle size={12} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Adjust Modal */}
      {adjustTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Kazanç Düzenle</h3>
            <div className="space-y-4">
              <div>
                <label className="label">Düzeltilmiş Tutar</label>
                <input
                  type="number" min="0" step="0.01"
                  value={adjustAmount}
                  onChange={e => setAdjustAmount(e.target.value)}
                  className="input-field"
                />
              </div>
              <div>
                <label className="label">Düzeltme Gerekçesi <span className="text-red-500">*</span></label>
                <textarea
                  value={adjustReason}
                  onChange={e => setAdjustReason(e.target.value)}
                  rows={3}
                  className="input-field"
                  placeholder="Neden düzeltme yapıyorsunuz?"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6 justify-end">
              <button onClick={() => setAdjustTarget(null)} className="btn-secondary">İptal</button>
              <button
                onClick={doAdjust}
                disabled={!adjustAmount || !adjustReason}
                className="btn-primary disabled:opacity-50"
              >Kaydet</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const PayoutsTab: React.FC<{ practitioners: any[] }> = ({ practitioners }) => {
  const [payouts, setPayouts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [approvedEarnings, setApprovedEarnings] = useState<any[]>([]);
  const [selectedEarnings, setSelectedEarnings] = useState<string[]>([]);
  const [form, setForm] = useState({
    practitionerId: '', amount: '', paymentDate: new Date().toISOString().split('T')[0],
    periodMonth: String(currentPeriod().month), periodYear: String(currentPeriod().year),
    method: 'bank_transfer', note: '',
  });
  const [formError, setFormError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await practitionerPayoutService.getAll();
      setPayouts(res.data);
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  const loadApprovedEarnings = async (practitionerId: string, month: number, year: number) => {
    if (!practitionerId) { setApprovedEarnings([]); return; }
    try {
      const res = await practitionerEarningService.getAll({
        practitionerId, status: 'approved', periodMonth: month, periodYear: year, limit: 200,
      });
      setApprovedEarnings(res.data.earnings || res.data);
    } catch { /* ignore */ }
  };

  useEffect(() => { load(); }, []);

  const handlePractitionerChange = (pid: string) => {
    setForm(f => ({ ...f, practitionerId: pid }));
    setSelectedEarnings([]);
    loadApprovedEarnings(pid, Number(form.periodMonth), Number(form.periodYear));
  };

  const toggleEarning = (id: string) => {
    setSelectedEarnings(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  };

  const handleSubmit = async () => {
    setFormError('');
    if (!form.practitionerId || !form.amount || !form.paymentDate) {
      setFormError('Lütfen zorunlu alanları doldurun.');
      return;
    }
    try {
      await practitionerPayoutService.create({
        practitionerId: form.practitionerId,
        amount: parseFloat(form.amount),
        paymentDate: form.paymentDate,
        periodMonth: Number(form.periodMonth),
        periodYear: Number(form.periodYear),
        method: form.method,
        note: form.note || null,
        earningIds: selectedEarnings,
      });
      setShowForm(false);
      setSelectedEarnings([]);
      setApprovedEarnings([]);
      load();
    } catch {
      setFormError('Ödeme kaydedilemedi.');
    }
  };

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = [2024, 2025, 2026, 2027];
  const effectiveAmount = (e: any) => e.adminAdjustmentAmount ?? e.earningAmount;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} />Ödeme Kaydet
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-500" size={32} /></div>
      ) : payouts.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Henüz ödeme kaydı yok.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                <th className="text-left py-3 pl-4 pr-4">Hekim</th>
                <th className="text-left py-3 pr-4">Dönem</th>
                <th className="text-left py-3 pr-4">Ödeme Tarihi</th>
                <th className="text-right py-3 pr-4">Tutar</th>
                <th className="text-left py-3 pr-4">Yöntem</th>
                <th className="text-left py-3 pr-4">Not</th>
                <th className="text-left py-3 pr-4">Kaydeden</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map(p => (
                <tr key={p.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="py-3 pl-4 pr-4 font-medium text-gray-900 dark:text-white">
                    {p.practitioner?.firstName} {p.practitioner?.lastName}
                  </td>
                  <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">{p.periodMonth}/{p.periodYear}</td>
                  <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">
                    {new Date(p.paymentDate).toLocaleDateString('tr-TR')}
                  </td>
                  <td className="py-3 pr-4 text-right font-semibold text-green-600 dark:text-green-400">{fmt(p.amount)}</td>
                  <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">{METHOD_LABELS[p.method] ?? p.method}</td>
                  <td className="py-3 pr-4 text-gray-600 dark:text-gray-400 max-w-xs truncate">{p.note || '—'}</td>
                  <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">
                    {p.createdBy?.firstName} {p.createdBy?.lastName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Payout Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 w-full max-w-lg my-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Ödeme Kaydet</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Hekim <span className="text-red-500">*</span></label>
                  <select value={form.practitionerId} onChange={e => handlePractitionerChange(e.target.value)} className="input-field">
                    <option value="">Seçin</option>
                    {practitioners.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Tutar <span className="text-red-500">*</span></label>
                  <input type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="input-field" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Dönem Ay</label>
                  <select value={form.periodMonth} onChange={e => { setForm(f => ({ ...f, periodMonth: e.target.value })); loadApprovedEarnings(form.practitionerId, Number(e.target.value), Number(form.periodYear)); }} className="input-field">
                    {months.map(m => <option key={m} value={m}>{m}. Ay</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Dönem Yıl</label>
                  <select value={form.periodYear} onChange={e => { setForm(f => ({ ...f, periodYear: e.target.value })); loadApprovedEarnings(form.practitionerId, Number(form.periodMonth), Number(e.target.value)); }} className="input-field">
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Ödeme Tarihi <span className="text-red-500">*</span></label>
                  <input type="date" value={form.paymentDate} onChange={e => setForm(f => ({ ...f, paymentDate: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label className="label">Yöntem</label>
                  <select value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))} className="input-field">
                    {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Not</label>
                <input type="text" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} className="input-field" placeholder="İsteğe bağlı" />
              </div>

              {/* Approved earnings to mark as paid */}
              {approvedEarnings.length > 0 && (
                <div>
                  <label className="label">Onaylı Kazançları Ödendi İşaretle (isteğe bağlı)</label>
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg max-h-48 overflow-y-auto">
                    {approvedEarnings.map(e => (
                      <label key={e.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedEarnings.includes(e.id)}
                          onChange={() => toggleEarning(e.id)}
                          className="rounded"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">
                          {e.patient ? `${e.patient.firstName} ${e.patient.lastName}` : e.treatmentCase?.title || '—'}
                          {e.service ? ` — ${e.service.name}` : ''}
                        </span>
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{fmt(effectiveAmount(e))}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {formError && <p className="text-sm text-red-500">{formError}</p>}
            </div>
            <div className="flex gap-3 mt-6 justify-end">
              <button onClick={() => { setShowForm(false); setApprovedEarnings([]); setSelectedEarnings([]); }} className="btn-secondary">İptal</button>
              <button onClick={handleSubmit} className="btn-primary">Kaydet</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SettingsTab: React.FC<{ practitioners: any[]; services: any[] }> = ({ practitioners, services }) => {
  const [rules, setRules] = useState<any[]>([]);
  const [serviceRules, setServiceRules] = useState<any[]>([]);
  const [filterPractitioner, setFilterPractitioner] = useState('');
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [showServiceRuleForm, setShowServiceRuleForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState({
    practitionerId: '', compensationType: 'percentage', fixedMonthlyAmount: '',
    defaultPercentage: '', calculationBase: 'collected', isActive: true,
    startDate: '', endDate: '',
  });
  const [serviceRuleForm, setServiceRuleForm] = useState({
    practitionerId: '', serviceId: '', percentage: '', fixedAmount: '', isActive: true,
  });
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [r, sr] = await Promise.all([
        compensationRuleService.getAll(filterPractitioner ? { practitionerId: filterPractitioner } : undefined),
        compensationRuleService.getServiceRules(filterPractitioner ? { practitionerId: filterPractitioner } : undefined),
      ]);
      setRules(r.data);
      setServiceRules(sr.data);
    } catch { /* ignore */ }
  };

  useEffect(() => { load(); }, [filterPractitioner]); // eslint-disable-line

  const handleSaveRule = async () => {
    setError('');
    try {
      const data: any = {
        practitionerId: ruleForm.practitionerId,
        compensationType: ruleForm.compensationType,
        calculationBase: ruleForm.calculationBase,
        isActive: ruleForm.isActive,
      };
      if (ruleForm.fixedMonthlyAmount) data.fixedMonthlyAmount = parseFloat(ruleForm.fixedMonthlyAmount);
      if (ruleForm.defaultPercentage) data.defaultPercentage = parseFloat(ruleForm.defaultPercentage);
      if (ruleForm.startDate) data.startDate = ruleForm.startDate;
      if (ruleForm.endDate) data.endDate = ruleForm.endDate;
      if (editingRuleId) {
        await compensationRuleService.update(editingRuleId, data);
      } else {
        await compensationRuleService.create(data);
      }
      setShowRuleForm(false);
      setEditingRuleId(null);
      setRuleForm({ practitionerId: '', compensationType: 'percentage', fixedMonthlyAmount: '', defaultPercentage: '', calculationBase: 'collected', isActive: true, startDate: '', endDate: '' });
      load();
    } catch { setError('Kural kaydedilemedi.'); }
  };

  const handleSaveServiceRule = async () => {
    setError('');
    try {
      const data: any = {
        practitionerId: serviceRuleForm.practitionerId,
        serviceId: serviceRuleForm.serviceId,
        isActive: serviceRuleForm.isActive,
      };
      if (serviceRuleForm.percentage) data.percentage = parseFloat(serviceRuleForm.percentage);
      if (serviceRuleForm.fixedAmount) data.fixedAmount = parseFloat(serviceRuleForm.fixedAmount);
      await compensationRuleService.upsertServiceRule(data);
      setShowServiceRuleForm(false);
      setServiceRuleForm({ practitionerId: '', serviceId: '', percentage: '', fixedAmount: '', isActive: true });
      load();
    } catch { setError('Hizmet kuralı kaydedilemedi.'); }
  };

  return (
    <div className="space-y-8">
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Filter */}
      <div className="flex items-center gap-3">
        <select value={filterPractitioner} onChange={e => setFilterPractitioner(e.target.value)} className="input-field w-52">
          <option value="">Tüm Hekimler</option>
          {practitioners.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
        </select>
      </div>

      {/* Default Compensation Rules */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 dark:text-white">Hekim Komisyon Kuralları</h3>
          <button onClick={() => setShowRuleForm(true)} className="btn-primary text-sm flex items-center gap-1">
            <Plus size={14} />Kural Ekle
          </button>
        </div>
        {rules.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Henüz kural tanımlanmamış.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                  <th className="text-left py-2 pl-4 pr-4">Hekim</th>
                  <th className="text-left py-2 pr-4">Tür</th>
                  <th className="text-right py-2 pr-4">Sabit (Aylık)</th>
                  <th className="text-right py-2 pr-4">Yüzde %</th>
                  <th className="text-left py-2 pr-4">Hesap Bazı</th>
                  <th className="text-left py-2 pr-4">Durum</th>
                  <th className="text-center py-2 pr-4">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(r => (
                  <tr key={r.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 pl-4 pr-4 font-medium text-gray-900 dark:text-white">
                      {r.practitioner?.firstName} {r.practitioner?.lastName}
                    </td>
                    <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">{COMP_TYPE_LABELS[r.compensationType] ?? r.compensationType}</td>
                    <td className="py-2 pr-4 text-right">{r.fixedMonthlyAmount != null ? fmt(r.fixedMonthlyAmount) : '—'}</td>
                    <td className="py-2 pr-4 text-right">{r.defaultPercentage != null ? `${r.defaultPercentage}%` : '—'}</td>
                    <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">{CALC_BASE_LABELS[r.calculationBase] ?? r.calculationBase}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${r.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700'}`}>
                        {r.isActive ? 'Aktif' : 'Pasif'}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => {
                            setEditingRuleId(r.id);
                            setRuleForm({
                              practitionerId: r.practitionerId,
                              compensationType: r.compensationType,
                              fixedMonthlyAmount: r.fixedMonthlyAmount?.toString() ?? '',
                              defaultPercentage: r.defaultPercentage?.toString() ?? '',
                              calculationBase: r.calculationBase,
                              isActive: r.isActive,
                              startDate: r.startDate ? r.startDate.substring(0, 10) : '',
                              endDate: r.endDate ? r.endDate.substring(0, 10) : '',
                            });
                            setShowRuleForm(true);
                          }}
                          className="text-blue-500 hover:text-blue-700"
                          title="Düzenle"
                        ><Pencil size={14} /></button>
                        <button
                          onClick={() => { if (window.confirm('Bu kuralı silmek istediğinize emin misiniz?')) compensationRuleService.remove(r.id).then(load); }}
                          className="text-red-500 hover:text-red-700"
                          title="Sil"
                        ><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Service-Specific Rules */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 dark:text-white">Hizmet Bazlı Komisyon Kuralları</h3>
          <button onClick={() => setShowServiceRuleForm(true)} className="btn-primary text-sm flex items-center gap-1">
            <Plus size={14} />Hizmet Kuralı Ekle
          </button>
        </div>
        {serviceRules.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Henüz hizmet bazlı kural tanımlanmamış.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                  <th className="text-left py-2 pl-4 pr-4">Hekim</th>
                  <th className="text-left py-2 pr-4">Hizmet</th>
                  <th className="text-right py-2 pr-4">Yüzde %</th>
                  <th className="text-right py-2 pr-4">Sabit Tutar</th>
                  <th className="text-left py-2 pr-4">Durum</th>
                  <th className="text-center py-2 pr-4">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {serviceRules.map(r => (
                  <tr key={r.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 pl-4 pr-4 font-medium text-gray-900 dark:text-white">
                      {r.practitioner?.firstName} {r.practitioner?.lastName}
                    </td>
                    <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">{r.service?.name}</td>
                    <td className="py-2 pr-4 text-right">{r.percentage != null ? `${r.percentage}%` : '—'}</td>
                    <td className="py-2 pr-4 text-right">{r.fixedAmount != null ? fmt(r.fixedAmount) : '—'}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${r.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700'}`}>
                        {r.isActive ? 'Aktif' : 'Pasif'}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-center">
                      <button
                        onClick={() => { if (window.confirm('Bu kuralı silmek istediğinize emin misiniz?')) compensationRuleService.removeServiceRule(r.id).then(load); }}
                        className="text-red-500 hover:text-red-700"
                        title="Sil"
                      ><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Default Rule Modal */}
      {showRuleForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{editingRuleId ? 'Komisyon Kuralı Düzenle' : 'Komisyon Kuralı Ekle'}</h3>
            <div className="space-y-3">
              <div>
                <label className="label">Hekim <span className="text-red-500">*</span></label>
                <select value={ruleForm.practitionerId} onChange={e => setRuleForm(f => ({ ...f, practitionerId: e.target.value }))} className="input-field">
                  <option value="">Seçin</option>
                  {practitioners.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Komisyon Türü</label>
                  <select value={ruleForm.compensationType} onChange={e => setRuleForm(f => ({ ...f, compensationType: e.target.value }))} className="input-field">
                    {Object.entries(COMP_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Hesap Bazı</label>
                  <select value={ruleForm.calculationBase} onChange={e => setRuleForm(f => ({ ...f, calculationBase: e.target.value }))} className="input-field">
                    <option value="collected">Tahsilat Bazlı</option>
                    <option value="billed">Fatura Bazlı</option>
                  </select>
                </div>
              </div>
              {(ruleForm.compensationType === 'percentage' || ruleForm.compensationType === 'fixed_plus_percentage') && (
                <div>
                  <label className="label">Yüzde (%)</label>
                  <input type="number" min="0" max="100" step="0.01" value={ruleForm.defaultPercentage} onChange={e => setRuleForm(f => ({ ...f, defaultPercentage: e.target.value }))} className="input-field" />
                </div>
              )}
              {(ruleForm.compensationType === 'fixed' || ruleForm.compensationType === 'fixed_plus_percentage') && (
                <div>
                  <label className="label">Sabit Aylık Tutar</label>
                  <input type="number" min="0" step="0.01" value={ruleForm.fixedMonthlyAmount} onChange={e => setRuleForm(f => ({ ...f, fixedMonthlyAmount: e.target.value }))} className="input-field" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Başlangıç Tarihi</label>
                  <input type="date" value={ruleForm.startDate} onChange={e => setRuleForm(f => ({ ...f, startDate: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label className="label">Bitiş Tarihi</label>
                  <input type="date" value={ruleForm.endDate} onChange={e => setRuleForm(f => ({ ...f, endDate: e.target.value }))} className="input-field" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="ruleActive" checked={ruleForm.isActive} onChange={e => setRuleForm(f => ({ ...f, isActive: e.target.checked }))} className="rounded" />
                <label htmlFor="ruleActive" className="text-sm text-gray-700 dark:text-gray-300">Aktif</label>
              </div>
            </div>
            <div className="flex gap-3 mt-6 justify-end">
              <button onClick={() => { setShowRuleForm(false); setEditingRuleId(null); setRuleForm({ practitionerId: '', compensationType: 'percentage', fixedMonthlyAmount: '', defaultPercentage: '', calculationBase: 'collected', isActive: true, startDate: '', endDate: '' }); }} className="btn-secondary">İptal</button>
              <button onClick={handleSaveRule} disabled={!ruleForm.practitionerId} className="btn-primary disabled:opacity-50">Kaydet</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Service Rule Modal */}
      {showServiceRuleForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Hizmet Bazlı Kural Ekle</h3>
            <div className="space-y-3">
              <div>
                <label className="label">Hekim <span className="text-red-500">*</span></label>
                <select value={serviceRuleForm.practitionerId} onChange={e => setServiceRuleForm(f => ({ ...f, practitionerId: e.target.value }))} className="input-field">
                  <option value="">Seçin</option>
                  {practitioners.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Hizmet <span className="text-red-500">*</span></label>
                <select value={serviceRuleForm.serviceId} onChange={e => setServiceRuleForm(f => ({ ...f, serviceId: e.target.value }))} className="input-field">
                  <option value="">Seçin</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Yüzde (%)</label>
                  <input type="number" min="0" max="100" step="0.01" value={serviceRuleForm.percentage} onChange={e => setServiceRuleForm(f => ({ ...f, percentage: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label className="label">Sabit Tutar</label>
                  <input type="number" min="0" step="0.01" value={serviceRuleForm.fixedAmount} onChange={e => setServiceRuleForm(f => ({ ...f, fixedAmount: e.target.value }))} className="input-field" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="srActive" checked={serviceRuleForm.isActive} onChange={e => setServiceRuleForm(f => ({ ...f, isActive: e.target.checked }))} className="rounded" />
                <label htmlFor="srActive" className="text-sm text-gray-700 dark:text-gray-300">Aktif</label>
              </div>
            </div>
            <div className="flex gap-3 mt-6 justify-end">
              <button onClick={() => setShowServiceRuleForm(false)} className="btn-secondary">İptal</button>
              <button onClick={handleSaveServiceRule} disabled={!serviceRuleForm.practitionerId || !serviceRuleForm.serviceId} className="btn-primary disabled:opacity-50">Kaydet</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Main Page ───────────────────────────────────────────────────────────────

const PractitionerEarnings: React.FC = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('summary');
  const [practitioners, setPractitioners] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [periodMonth, setPeriodMonth] = useState(currentPeriod().month);
  const [periodYear, setPeriodYear] = useState(currentPeriod().year);

  useEffect(() => {
    userService.getDoctors().then(r => setPractitioners(r.data)).catch(() => {});
    serviceService.getAll({ onlyActive: true }).then(r => setServices(r.data)).catch(() => {});
  }, []);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'summary',  label: 'Dönem Özeti',     icon: <DollarSign size={16} /> },
    { key: 'earnings', label: 'Kazanç Listesi',   icon: <Clock size={16} /> },
    { key: 'payouts',  label: 'Ödemeler',         icon: <CreditCard size={16} /> },
    { key: 'settings', label: 'Komisyon Ayarları',icon: <Settings size={16} /> },
  ];

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = [2024, 2025, 2026, 2027];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Hekim Kazanç Yönetimi</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Hekim komisyon kuralları ve kazanç takibi</p>
        </div>
        {tab === 'summary' && (
          <div className="flex items-center gap-2">
            <select value={periodMonth} onChange={e => setPeriodMonth(Number(e.target.value))} className="input-field w-28">
              {months.map(m => <option key={m} value={m}>{m}. Ay</option>)}
            </select>
            <select value={periodYear} onChange={e => setPeriodYear(Number(e.target.value))} className="input-field w-20">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-6">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={[
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.key
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
            ].join(' ')}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="card p-4 sm:p-6">
        {tab === 'summary' && <SummaryTab periodMonth={periodMonth} periodYear={periodYear} practitioners={practitioners} />}
        {tab === 'earnings' && <EarningsTab practitioners={practitioners} />}
        {tab === 'payouts' && <PayoutsTab practitioners={practitioners} />}
        {tab === 'settings' && <SettingsTab practitioners={practitioners} services={services} />}
      </div>
    </div>
  );
};

export default PractitionerEarnings;
