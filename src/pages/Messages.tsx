import React, { useEffect, useState } from 'react';
import { 
  MessageSquare, 
  Search, 
  Copy, 
  ExternalLink,
  Loader2,
  Smartphone,
  Mail,
  CheckCircle2,
  Clock,
  AlertCircle,
  User,
  Send,
  XCircle
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { messageService, clinicWhatsAppService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useClinic } from '../context/ClinicContext';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import { canCreateAppointment } from '../utils/permissions';

const Messages: React.FC = () => {
  const { t } = useTranslation(['messages', 'common']);
  const { formatDateTime } = useClinicPreferences();
  const { user } = useAuth();
  const { selectedClinicId } = useClinic();
  const canSend = canCreateAppointment(user); // OWNER/ORG_ADMIN/CLINIC_MANAGER/RECEPTIONIST

  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');

  // WhatsApp connection awareness
  const [waConnection, setWaConnection] = useState<{ status: string; provider: string; phoneNumber?: string | null } | null>(null);
  const [waLoading, setWaLoading] = useState(true);

  useEffect(() => {
    if (!selectedClinicId || selectedClinicId === 'all') {
      setWaLoading(false);
      return;
    }
    setWaLoading(true);
    clinicWhatsAppService
      .getAssignments(selectedClinicId)
      .then((res: any) => {
        const assignments = Array.isArray(res.data) ? res.data : [];
        const active = assignments.find((a: any) => a.isDefault && a.whatsappConnection?.isActive);
        setWaConnection(active?.whatsappConnection ?? null);
      })
      .catch(() => setWaConnection(null))
      .finally(() => setWaLoading(false));
  }, [selectedClinicId]);

  // Can send only if permission + active connected WhatsApp (non-Meta stub)
  const canSendNow =
    canSend &&
    !waLoading &&
    waConnection !== null &&
    waConnection.status === 'connected' &&
    waConnection.provider !== 'meta_cloud_api';

  const fetchMessages = async () => {
    setLoading(true);
    try {
      const response = await messageService.getAll({
        channel: channel || undefined,
        status: status || undefined,
      });
      setMessages(response.data);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();
  }, [channel, status]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    alert(t('messages:copiedToClipboard'));
  };

  const handleSend = async (id: string) => {
    setSending(id);
    setSendError(null);
    try {
      await messageService.send(id);
      await fetchMessages();
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.response?.data?.error || t('common:error');
      setSendError(detail);
    } finally {
      setSending(null);
    }
  };

  const getStatusBadge = (s: string) => {
    switch (s) {
      case 'prepared': return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-100 uppercase flex items-center gap-1"><Clock size={10} /> {t(`messages:status.${s}`)}</span>;
      case 'sent': return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100 uppercase flex items-center gap-1"><CheckCircle2 size={10} /> {t(`messages:status.${s}`)}</span>;
      case 'delivered': return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-700 border border-green-100 uppercase flex items-center gap-1"><CheckCircle2 size={10} /> {t(`messages:status.${s}`)}</span>;
      case 'failed': return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 border border-red-100 uppercase flex items-center gap-1"><AlertCircle size={10} /> {t(`messages:status.${s}`)}</span>;
      default: return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-50 text-gray-500 border border-gray-100 uppercase">{s}</span>;
    }
  };

  const getChannelIcon = (c: string) => {
    switch (c) {
      case 'sms': return <Smartphone size={16} className="text-gray-400" />;
      case 'whatsapp': return <MessageSquare size={16} className="text-green-500" />;
      case 'email': return <Mail size={16} className="text-blue-500" />;
      default: return <MessageSquare size={16} />;
    }
  };

  const openWhatsApp = (phone: string, body: string) => {
    const cleanPhone = phone.replace(/\D/g, '');
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(body)}`;
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('messages:title')}</h1>
        <p className="text-gray-500 mt-1">{t('messages:subtitle')}</p>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text" 
            placeholder={t('common:search')}
            className="input-field pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="input-field w-full md:w-48" value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">{t('messages:filters.channel')}</option>
          <option value="sms">SMS</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
        </select>
        <select className="input-field w-full md:w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('messages:filters.status')}</option>
          <option value="prepared">{t('messages:status.prepared')}</option>
          <option value="sent">{t('messages:status.sent')}</option>
          <option value="delivered">{t('messages:status.delivered')}</option>
          <option value="failed">{t('messages:status.failed')}</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        {/* WhatsApp connection status banner */}
        {!waLoading && channel !== 'email' && channel !== 'sms' && (
          <div className={`flex items-center gap-2 px-4 py-2.5 text-xs border-b ${
            waConnection?.status === 'connected'
              ? 'bg-green-50 border-green-100 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300'
              : waConnection?.provider === 'meta_cloud_api'
              ? 'bg-amber-50 border-amber-100 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300'
              : 'bg-gray-50 border-gray-100 text-gray-500 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400'
          }`}>
            <MessageSquare size={13} className="flex-shrink-0" />
            {waConnection?.status === 'connected' && waConnection.provider !== 'meta_cloud_api'
              ? t('messages:whatsappStatus.connected', { phone: waConnection.phoneNumber ? ` — ${waConnection.phoneNumber}` : '' })
              : waConnection?.provider === 'meta_cloud_api'
              ? t('messages:whatsappStatus.metaInactive')
              : selectedClinicId === 'all'
              ? t('messages:whatsappStatus.selectClinic')
              : t('messages:whatsappStatus.notConfigured')}
          </div>
        )}

        {sendError && (
          <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border-b border-red-100 text-sm text-red-700">
            <XCircle size={16} className="flex-shrink-0" />
            <span>{sendError}</span>
            <button onClick={() => setSendError(null)} className="ml-auto text-red-400 hover:text-red-600">
              <XCircle size={14} />
            </button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('messages:list.patient')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('messages:list.channel')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('messages:list.body')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('messages:list.status')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('messages:list.date')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">{t('common:actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-12 text-center">
                    <Loader2 className="animate-spin text-primary-600 mx-auto" size={32} />
                  </td>
                </tr>
              ) : messages.length > 0 ? (
                messages.filter(m => 
                  m.patient.firstName.toLowerCase().includes(search.toLowerCase()) || 
                  m.patient.lastName.toLowerCase().includes(search.toLowerCase())
                ).map((message) => (
                  <tr key={message.id} className="hover:bg-gray-50/50 transition-colors group">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600">
                          {message.patient.firstName[0]}{message.patient.lastName[0]}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-900">{message.patient.firstName} {message.patient.lastName}</p>
                          <p className="text-[10px] text-gray-500">{message.recipient}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {getChannelIcon(message.channel)}
                        <span className="text-xs text-gray-600 capitalize">{message.channel}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="max-w-xs">
                        {message.subject && <p className="text-xs font-bold text-gray-900 truncate">{message.subject}</p>}
                        <p className="text-xs text-gray-500 truncate">{message.body}</p>
                      </div>
                    </td>
                    <td className="p-4">
                      {getStatusBadge(message.status)}
                    </td>
                    <td className="p-4">
                      <p className="text-xs text-gray-600">{formatDateTime(message.createdAt)}</p>
                      <p className="text-[10px] text-gray-400 flex items-center gap-1">
                        <User size={10} />
                        {message.createdBy.firstName}
                      </p>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {canSend && message.status === 'prepared' && (
                          <button
                            onClick={() => handleSend(message.id)}
                            disabled={sending === message.id || !canSendNow}
                            className="p-2 text-gray-400 hover:bg-white hover:text-green-600 rounded-lg transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                            title={canSendNow ? t('messages:actions.sendNow') : t('messages:actions.sendUnavailable')}
                          >
                            {sending === message.id
                              ? <Loader2 size={18} className="animate-spin" />
                              : <Send size={18} />
                            }
                          </button>
                        )}
                        <button 
                          onClick={() => handleCopy(message.body)}
                          className="p-2 text-gray-400 hover:bg-white hover:text-primary-600 rounded-lg transition-all shadow-sm"
                          title={t('messages:actions.copy')}
                        >
                          <Copy size={18} />
                        </button>
                        {message.channel === 'whatsapp' && (
                          <button 
                            onClick={() => openWhatsApp(message.recipient, message.body)}
                            className="p-2 text-gray-400 hover:bg-white hover:text-green-600 rounded-lg transition-all shadow-sm"
                            title={t('messages:actions.whatsapp')}
                          >
                            <ExternalLink size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-gray-400">
                    <MessageSquare size={48} className="mx-auto mb-3 opacity-20" />
                    <p>{t('common:noData')}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Messages;
