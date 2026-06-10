import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, Check, X, Send, History } from 'lucide-react';
import api from '../services/api';

interface PostTreatmentTemplate {
  id: string;
  title: string;
  targetType: 'service' | 'package';
  serviceId: string | null;
  treatmentPackageId: string | null;
  messageBody: string;
  channel: 'whatsapp' | 'instagram' | 'preferred';
  sendDelayMinutes: number;
  requireStaffApproval: boolean;
  isActive: boolean;
  service?: { id: string; name: string } | null;
  treatmentPackage?: { id: string; name: string } | null;
}

interface QueueEntry {
  id: string;
  patientId: string;
  templateId: string;
  channel: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  messageBodyRendered: string;
  errorMessage: string | null;
  patient?: { id: string; firstName: string; lastName: string } | null;
  template?: { id: string; title: string; channel: string } | null;
}

interface Service {
  id: string;
  name: string;
}

interface TreatmentPackage {
  id: string;
  name: string;
}

interface Props {
  clinicId?: string;
  canEdit?: boolean;
}

const EMPTY_FORM = {
  title: '',
  targetType: 'service' as 'service' | 'package',
  serviceId: '',
  treatmentPackageId: '',
  messageBody: '',
  channel: 'whatsapp' as 'whatsapp' | 'instagram' | 'preferred',
  sendDelayMinutes: 0,
  requireStaffApproval: false,
  isActive: true,
};

const TEMPLATE_VARIABLES = [
  'patientName',
  'clinicName',
  'doctorName',
  'treatmentName',
  'packageName',
  'appointmentDate',
  'clinicPhone',
];

export default function PostTreatmentMessages({ clinicId, canEdit }: Props) {
  const { t } = useTranslation('postTreatment');
  const [activeSubTab, setActiveSubTab] = useState<'templates' | 'queue'>('templates');

  // ── Template state ─────────────────────────────────────────────────────────
  const [templates, setTemplates] = useState<PostTreatmentTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Queue state ─────────────────────────────────────────────────────────────
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);

  // ── Services / packages for dropdown ───────────────────────────────────────
  const [services, setServices] = useState<Service[]>([]);
  const [packages, setPackages] = useState<TreatmentPackage[]>([]);

  // ── Fetch templates ─────────────────────────────────────────────────────────
  const fetchTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const res = await (api as any).get('/post-treatment-templates');
      setTemplates(res.data ?? []);
    } catch {
      /* noop */
    } finally {
      setTemplatesLoading(false);
    }
  };

  // ── Fetch queue ──────────────────────────────────────────────────────────────
  const fetchQueue = async () => {
    setQueueLoading(true);
    try {
      const res = await (api as any).get('/post-treatment-queue');
      setQueue(res.data ?? []);
    } catch {
      /* noop */
    } finally {
      setQueueLoading(false);
    }
  };

  // ── Fetch services & packages for dropdowns ─────────────────────────────────
  const fetchDropdowns = async () => {
    try {
      const [svcRes, pkgRes] = await Promise.all([
        (api as any).get('/services'),
        (api as any).get('/treatment-packages'),
      ]);
      setServices(svcRes.data ?? []);
      setPackages(pkgRes.data ?? []);
    } catch {
      /* noop */
    }
  };

  useEffect(() => {
    if (!clinicId) return;
    fetchTemplates();
    fetchDropdowns();
  }, [clinicId]);

  useEffect(() => {
    if (!clinicId || activeSubTab !== 'queue') return;
    fetchQueue();
  }, [clinicId, activeSubTab]);

  // ── Template form helpers ───────────────────────────────────────────────────
  const openNew = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (tpl: PostTreatmentTemplate) => {
    setEditingId(tpl.id);
    setForm({
      title: tpl.title,
      targetType: tpl.targetType,
      serviceId: tpl.serviceId ?? '',
      treatmentPackageId: tpl.treatmentPackageId ?? '',
      messageBody: tpl.messageBody,
      channel: tpl.channel,
      sendDelayMinutes: tpl.sendDelayMinutes,
      requireStaffApproval: tpl.requireStaffApproval,
      isActive: tpl.isActive,
    });
    setFormError(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.messageBody.trim()) {
      setFormError('Şablon adı ve mesaj içeriği zorunludur.');
      return;
    }
    setFormSaving(true);
    setFormError(null);
    const payload = {
      ...form,
      serviceId: form.targetType === 'service' ? (form.serviceId || null) : null,
      treatmentPackageId: form.targetType === 'package' ? (form.treatmentPackageId || null) : null,
    };
    try {
      if (editingId) {
        await (api as any).put(`/post-treatment-templates/${editingId}`, payload);
      } else {
        await (api as any).post('/post-treatment-templates', payload);
      }
      await fetchTemplates();
      closeForm();
    } catch (err: any) {
      setFormError(err?.response?.data?.error ?? t('saveError'));
    } finally {
      setFormSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('template.deleteConfirm'))) return;
    try {
      await (api as any).delete(`/post-treatment-templates/${id}`);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch {
      /* noop */
    }
  };

  const handleToggleActive = async (tpl: PostTreatmentTemplate) => {
    try {
      await (api as any).put(`/post-treatment-templates/${tpl.id}`, { isActive: !tpl.isActive });
      setTemplates((prev) => prev.map((t) => t.id === tpl.id ? { ...t, isActive: !t.isActive } : t));
    } catch {
      /* noop */
    }
  };

  // ── Queue actions ───────────────────────────────────────────────────────────
  const handleApprove = async (id: string) => {
    if (!window.confirm(t('queue.approveConfirm'))) return;
    try {
      await (api as any).post(`/post-treatment-queue/${id}/approve`);
      await fetchQueue();
    } catch {
      /* noop */
    }
  };

  const handleCancel = async (id: string) => {
    if (!window.confirm(t('queue.cancelConfirm'))) return;
    try {
      await (api as any).post(`/post-treatment-queue/${id}/cancel`);
      await fetchQueue();
    } catch {
      /* noop */
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-700',
      waiting_approval: 'bg-blue-100 text-blue-700',
      sent: 'bg-green-100 text-green-700',
      failed: 'bg-red-100 text-red-700',
      cancelled: 'bg-gray-100 text-gray-500',
      no_recipient: 'bg-orange-100 text-orange-700',
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
        {t(`queue.status.${status}` as any, { defaultValue: status })}
      </span>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold">{t('title')}</h2>
            <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>
          </div>
          {activeSubTab === 'templates' && canEdit && (
            <button
              onClick={openNew}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              <Plus size={16} />
              {t('template.new')}
            </button>
          )}
        </div>

        {/* Sub-tabs */}
        <div className="mt-4 flex gap-2 border-b border-gray-100">
          <button
            onClick={() => setActiveSubTab('templates')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeSubTab === 'templates'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Send size={14} />
            {t('tabs.templates')}
          </button>
          <button
            onClick={() => setActiveSubTab('queue')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeSubTab === 'queue'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <History size={14} />
            {t('tabs.queue')}
          </button>
        </div>
      </div>

      {/* ── Templates tab ─────────────────────────────────────────────────── */}
      {activeSubTab === 'templates' && (
        <>
          {/* New / Edit form */}
          {showForm && (
            <div className="card p-6">
              <h3 className="text-base font-semibold mb-4">
                {editingId ? t('template.edit') : t('template.new')}
              </h3>

              {formError && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Title */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('template.fields.title')} *
                  </label>
                  <input
                    className="input-field w-full"
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  />
                </div>

                {/* Target type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('template.fields.targetType')}
                  </label>
                  <select
                    className="input-field w-full"
                    value={form.targetType}
                    onChange={(e) => setForm((f) => ({ ...f, targetType: e.target.value as 'service' | 'package' }))}
                  >
                    <option value="service">{t('template.fields.targetType_service')}</option>
                    <option value="package">{t('template.fields.targetType_package')}</option>
                  </select>
                </div>

                {/* Service or package picker */}
                {form.targetType === 'service' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('template.fields.service')}
                    </label>
                    <select
                      className="input-field w-full"
                      value={form.serviceId}
                      onChange={(e) => setForm((f) => ({ ...f, serviceId: e.target.value }))}
                    >
                      <option value="">— {t('template.fields.service')} —</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('template.fields.package')}
                    </label>
                    <select
                      className="input-field w-full"
                      value={form.treatmentPackageId}
                      onChange={(e) => setForm((f) => ({ ...f, treatmentPackageId: e.target.value }))}
                    >
                      <option value="">— {t('template.fields.package')} —</option>
                      {packages.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Channel */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('template.fields.channel')}
                  </label>
                  <select
                    className="input-field w-full"
                    value={form.channel}
                    onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value as any }))}
                  >
                    <option value="whatsapp">{t('template.fields.channel_whatsapp')}</option>
                    <option value="instagram">{t('template.fields.channel_instagram')}</option>
                    <option value="preferred">{t('template.fields.channel_preferred')}</option>
                  </select>
                </div>

                {/* Delay */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('template.fields.sendDelayMinutes')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={20160}
                    className="input-field w-full"
                    value={form.sendDelayMinutes}
                    onChange={(e) => setForm((f) => ({ ...f, sendDelayMinutes: Number(e.target.value) }))}
                  />
                  <p className="text-xs text-gray-400 mt-1">{t('template.fields.sendDelayMinutes_help')}</p>
                </div>

                {/* Message body */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('template.fields.messageBody')} *
                  </label>
                  <textarea
                    rows={5}
                    className="input-field w-full font-mono text-sm"
                    value={form.messageBody}
                    onChange={(e) => setForm((f) => ({ ...f, messageBody: e.target.value }))}
                  />
                  {/* Variable hint */}
                  <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs font-medium text-gray-600 mb-1">{t('template.variables.title')}:</p>
                    <div className="flex flex-wrap gap-1">
                      {TEMPLATE_VARIABLES.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, messageBody: f.messageBody + `{{${v}}}` }))}
                          className="px-2 py-0.5 text-xs bg-white border border-gray-200 rounded hover:bg-gray-100 font-mono"
                          title={t(`template.variables.${v}` as any)}
                        >
                          {`{{${v}}}`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Toggles */}
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div
                      onClick={() => setForm((f) => ({ ...f, requireStaffApproval: !f.requireStaffApproval }))}
                      className={`relative w-10 h-5 rounded-full transition-colors ${form.requireStaffApproval ? 'bg-primary-600' : 'bg-gray-300'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.requireStaffApproval ? 'translate-x-5' : 'translate-x-0'}`} />
                    </div>
                    <span className="text-sm text-gray-700">{t('template.fields.requireStaffApproval')}</span>
                  </label>
                </div>

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div
                      onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
                      className={`relative w-10 h-5 rounded-full transition-colors ${form.isActive ? 'bg-primary-600' : 'bg-gray-300'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.isActive ? 'translate-x-5' : 'translate-x-0'}`} />
                    </div>
                    <span className="text-sm text-gray-700">{t('template.fields.isActive')}</span>
                  </label>
                </div>
              </div>

              {/* Form actions */}
              <div className="mt-4 flex gap-2 justify-end">
                <button
                  onClick={closeForm}
                  className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={formSaving}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:bg-gray-300"
                >
                  {formSaving ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <Check size={14} />
                  )}
                  {t('save')}
                </button>
              </div>
            </div>
          )}

          {/* Template list */}
          <div className="card">
            {templatesLoading ? (
              <div className="p-8 text-center text-gray-400 text-sm">...</div>
            ) : templates.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">{t('template.noTemplates')}</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {templates.map((tpl) => (
                  <div key={tpl.id} className="flex items-center gap-4 px-5 py-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate">{tpl.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {tpl.targetType === 'service'
                          ? `${t('template.fields.targetType_service')}: ${tpl.service?.name ?? '-'}`
                          : `${t('template.fields.targetType_package')}: ${tpl.treatmentPackage?.name ?? '-'}`}
                        {' · '}
                        {t(`template.fields.channel_${tpl.channel}` as any)}
                        {tpl.sendDelayMinutes > 0 && ` · +${tpl.sendDelayMinutes} dk`}
                        {tpl.requireStaffApproval && ' · onay gerekli'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Toggle active */}
                      {canEdit && (
                        <button
                          onClick={() => handleToggleActive(tpl)}
                          className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
                            tpl.isActive
                              ? 'bg-green-100 text-green-700 hover:bg-green-200'
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}
                        >
                          {tpl.isActive ? t('template.fields.isActive') : 'Pasif'}
                        </button>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => openEdit(tpl)}
                          className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => handleDelete(tpl.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Queue tab ─────────────────────────────────────────────────────── */}
      {activeSubTab === 'queue' && (
        <div className="card overflow-x-auto">
          {queueLoading ? (
            <div className="p-8 text-center text-gray-400 text-sm">...</div>
          ) : queue.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">{t('queue.noEntries')}</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['patient', 'template', 'channel', 'status', 'scheduledAt', 'sentAt', 'actions'].map((col) => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      {t(`queue.columns.${col}` as any)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {queue.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {entry.patient
                        ? `${entry.patient.firstName} ${entry.patient.lastName}`
                        : '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                      {entry.template?.title ?? '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                      {entry.channel}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {statusBadge(entry.status)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500 text-xs">
                      {new Date(entry.scheduledAt).toLocaleString('tr-TR')}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500 text-xs">
                      {entry.sentAt ? new Date(entry.sentAt).toLocaleString('tr-TR') : '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {entry.status === 'waiting_approval' && (
                        <button
                          onClick={() => handleApprove(entry.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700"
                        >
                          <Check size={12} />
                          {t('queue.approve')}
                        </button>
                      )}
                      {(entry.status === 'pending' || entry.status === 'waiting_approval') && (
                        <button
                          onClick={() => handleCancel(entry.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-gray-200 text-gray-600 rounded hover:bg-gray-50 ml-1"
                        >
                          <X size={12} />
                          {t('queue.cancel')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
