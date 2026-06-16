import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Inbox,
  Instagram,
  Loader2,
  MessageCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import { contactRequestService } from '../services/api';
import { useClinic } from '../context/ClinicContext';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContactRequest {
  id: string;
  clinicId: string;
  channel: string;
  type: string;
  status: string;
  priority: string;
  name: string | null;
  phone: string | null;
  note: string | null;
  lastMessage: string | null;
  createdAt: string;
  updatedAt: string;
  patient: { id: string; firstName: string; lastName: string; phone: string | null } | null;
  resolvedAt: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function channelBadgeClass(channel: string) {
  switch (channel) {
    case 'instagram': return 'bg-purple-50 text-purple-700 border-purple-100';
    case 'meta_whatsapp': return 'bg-green-50 text-green-700 border-green-100';
    case 'manual': return 'bg-gray-50 text-gray-700 border-gray-100';
    default: return 'bg-green-50 text-green-700 border-green-100'; // whatsapp
  }
}

function channelIcon(channel: string) {
  if (channel === 'instagram') return <Instagram size={12} />;
  return <MessageCircle size={12} />;
}

function statusCardBorder(status: string) {
  switch (status) {
    case 'pending': return 'border-amber-400';
    case 'in_progress': return 'border-blue-400';
    case 'resolved': return 'border-green-400';
    case 'closed': return 'border-gray-300';
    default: return 'border-gray-200';
  }
}

function statusBadgeClass(status: string) {
  switch (status) {
    case 'pending': return 'bg-amber-50 text-amber-700 border-amber-100';
    case 'in_progress': return 'bg-blue-50 text-blue-700 border-blue-100';
    case 'resolved': return 'bg-green-50 text-green-700 border-green-100';
    case 'closed': return 'bg-gray-50 text-gray-500 border-gray-100';
    default: return 'bg-gray-50 text-gray-500 border-gray-100';
  }
}

function typeBadgeClass(type: string) {
  switch (type) {
    case 'callback_request': return 'bg-orange-50 text-orange-700 border-orange-100';
    case 'staff_handoff': return 'bg-indigo-50 text-indigo-700 border-indigo-100';
    case 'information_request': return 'bg-sky-50 text-sky-700 border-sky-100';
    case 'complaint': return 'bg-red-50 text-red-700 border-red-100';
    default: return 'bg-gray-50 text-gray-600 border-gray-100';
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

// ── Component ─────────────────────────────────────────────────────────────────

const ContactRequests: React.FC = () => {
  const { t } = useTranslation(['contactRequests', 'common']);
  const { selectedClinicId } = useClinic();

  const [items, setItems] = useState<ContactRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workingId, setWorkingId] = useState('');

  const [statusFilter, setStatusFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const stats = {
    total: items.length,
    pending: items.filter(r => r.status === 'pending').length,
    inProgress: items.filter(r => r.status === 'in_progress').length,
    resolved: items.filter(r => r.status === 'resolved').length,
  };

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      if (channelFilter) params.channel = channelFilter;
      if (typeFilter) params.type = typeFilter;
      if (selectedClinicId && selectedClinicId !== 'all') params.clinicId = selectedClinicId;
      const res = await contactRequestService.getAll(params);
      setItems(res.data.items ?? []);
      setTotal(res.data.total ?? 0);
    } catch {
      setError(t('contactRequests:errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, channelFilter, typeFilter, selectedClinicId, t]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleStatus = async (id: string, status: string) => {
    setWorkingId(id);
    setError('');
    try {
      await contactRequestService.updateStatus(id, status);
      fetchItems();
    } catch {
      setError(t('contactRequests:errors.updateFailed'));
    } finally {
      setWorkingId('');
    }
  };

  const displayedItems = statusFilter
    ? items
    : items; // filtering already done server-side

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('contactRequests:title')}</h1>
          <p className="text-gray-500 mt-1">{t('contactRequests:subtitle')}</p>
        </div>
        <button onClick={fetchItems} className="btn-secondary">
          <RefreshCw size={18} />
          {t('contactRequests:actions.refresh')}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-sm text-gray-500">{t('contactRequests:summary.total')}</p>
          <p className="text-2xl font-bold text-gray-900">{total}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-gray-500">{t('contactRequests:summary.pending')}</p>
          <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-gray-500">{t('contactRequests:summary.inProgress')}</p>
          <p className="text-2xl font-bold text-blue-600">{stats.inProgress}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-gray-500">{t('contactRequests:summary.resolved')}</p>
          <p className="text-2xl font-bold text-green-600">{stats.resolved}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-600 shrink-0">
          <Inbox size={18} className="text-primary-600" />
        </div>
        <div className="flex flex-col sm:flex-row gap-3 flex-1">
          <select
            className="input-field sm:max-w-xs"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="">{t('contactRequests:filters.allStatus')}</option>
            {(['pending', 'in_progress', 'resolved', 'closed'] as const).map(s => (
              <option key={s} value={s}>{t(`contactRequests:status.${s}`)}</option>
            ))}
          </select>
          <select
            className="input-field sm:max-w-xs"
            value={channelFilter}
            onChange={e => setChannelFilter(e.target.value)}
          >
            <option value="">{t('contactRequests:filters.allChannels')}</option>
            {(['whatsapp', 'meta_whatsapp', 'instagram', 'manual'] as const).map(c => (
              <option key={c} value={c}>{t(`contactRequests:channels.${c}`)}</option>
            ))}
          </select>
          <select
            className="input-field sm:max-w-xs"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
          >
            <option value="">{t('contactRequests:filters.allTypes')}</option>
            {(['callback_request', 'staff_handoff', 'information_request', 'complaint', 'other'] as const).map(tp => (
              <option key={tp} value={tp}>{t(`contactRequests:type.${tp}`)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* List */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-primary-600" size={32} />
          </div>
        ) : displayedItems.length === 0 ? (
          <div className="card p-10 text-center text-gray-500">
            {t('contactRequests:empty')}
          </div>
        ) : (
          displayedItems.map(item => (
            <div
              key={item.id}
              className={`card p-4 space-y-3 border-l-4 ${statusCardBorder(item.status)}`}
            >
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="space-y-2 min-w-0">
                  {/* Identity + badges */}
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-gray-900">
                      {item.patient
                        ? `${item.patient.firstName} ${item.patient.lastName}`.trim()
                        : item.name || item.phone || '—'}
                    </h3>

                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold border ${channelBadgeClass(item.channel)}`}>
                      {channelIcon(item.channel)}
                      {t(`contactRequests:channels.${item.channel}`, { defaultValue: item.channel })}
                    </span>

                    <span className={`px-2 py-1 rounded text-xs font-bold border ${typeBadgeClass(item.type)}`}>
                      {t(`contactRequests:type.${item.type}`, { defaultValue: item.type })}
                    </span>

                    <span className={`px-2 py-1 rounded text-xs font-bold border ${statusBadgeClass(item.status)}`}>
                      {t(`contactRequests:status.${item.status}`, { defaultValue: item.status })}
                    </span>
                  </div>

                  {/* Phone */}
                  {item.phone && (
                    <p className="text-sm text-gray-500">{item.phone}</p>
                  )}

                  {/* Last message / note */}
                  {item.lastMessage && (
                    <p className="text-sm text-gray-600 bg-gray-50 p-2 rounded-lg line-clamp-2">
                      {item.lastMessage}
                    </p>
                  )}
                  {item.note && item.note !== item.lastMessage && (
                    <p className="text-sm text-gray-500 italic line-clamp-2">{item.note}</p>
                  )}

                  {/* Dates */}
                  <div className="flex flex-wrap gap-x-4 text-xs text-gray-400">
                    <span>{t('contactRequests:fields.createdAt')}: {formatDate(item.createdAt)}</span>
                    {item.resolvedAt && (
                      <span>{t('common:resolved')}: {formatDate(item.resolvedAt)}</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap lg:justify-end gap-2 shrink-0">
                  {item.status === 'pending' && (
                    <button
                      onClick={() => handleStatus(item.id, 'in_progress')}
                      disabled={workingId === item.id}
                      className="btn-secondary"
                    >
                      {workingId === item.id ? <Loader2 size={16} className="animate-spin" /> : <Clock size={16} />}
                      {t('contactRequests:actions.takeAction')}
                    </button>
                  )}

                  {(item.status === 'pending' || item.status === 'in_progress') && (
                    <button
                      onClick={() => handleStatus(item.id, 'resolved')}
                      disabled={workingId === item.id}
                      className="btn-primary"
                    >
                      {workingId === item.id ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                      {t('contactRequests:actions.resolve')}
                    </button>
                  )}

                  {item.status !== 'closed' && item.status !== 'resolved' && (
                    <button
                      onClick={() => handleStatus(item.id, 'closed')}
                      disabled={workingId === item.id}
                      className="btn-secondary"
                    >
                      <X size={16} />
                      {t('contactRequests:actions.close')}
                    </button>
                  )}

                  {(item.status === 'resolved' || item.status === 'closed') && (
                    <button
                      onClick={() => handleStatus(item.id, 'pending')}
                      disabled={workingId === item.id}
                      className="btn-secondary"
                    >
                      {t('contactRequests:actions.reopen')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ContactRequests;
