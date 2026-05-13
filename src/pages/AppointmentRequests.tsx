import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Loader2,
  MessageCircle,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { appointmentRequestService } from '../services/api';

const AppointmentRequests: React.FC = () => {
  const { t, i18n } = useTranslation(['appointmentRequests', 'common']);
  const [requests, setRequests] = useState<any[]>([]);
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState('');
  const [error, setError] = useState('');

  const fetchRequests = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await appointmentRequestService.getAll({
        status: status || undefined,
        source: 'whatsapp',
      });
      setRequests(res.data);
    } catch {
      setError(t('appointmentRequests:errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, [status]);

  const updateStatus = async (request: any, nextStatus: string) => {
    const rejectionReason = nextStatus === 'rejected'
      ? window.prompt(t('appointmentRequests:actions.rejectionPrompt'))
      : undefined;

    if (nextStatus === 'rejected' && !rejectionReason) return;

    setWorkingId(request.id);
    setError('');
    try {
      await appointmentRequestService.updateStatus(request.id, {
        status: nextStatus,
        rejectionReason,
      });
      fetchRequests();
    } catch (err: any) {
      setError(err.response?.data?.error || t('common:errorGeneric'));
    } finally {
      setWorkingId('');
    }
  };

  const convertRequest = async (request: any) => {
    setWorkingId(request.id);
    setError('');
    try {
      await appointmentRequestService.convert(request.id);
      fetchRequests();
    } catch (err: any) {
      const code = err.response?.data?.code;
      if (code === 'APPOINTMENT_OUTSIDE_AVAILABILITY') {
        setError(t('appointmentRequests:errors.outsideAvailability'));
      } else if (code === 'APPOINTMENT_OVERLAP') {
        setError(t('appointmentRequests:errors.overlap'));
      } else {
        setError(err.response?.data?.error || t('appointmentRequests:errors.convertFailed'));
      }
    } finally {
      setWorkingId('');
    }
  };

  const stats = {
    pending: requests.filter(item => item.status === 'pending').length,
    visible: requests.length,
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('appointmentRequests:title')}</h1>
          <p className="text-gray-500 mt-1">{t('appointmentRequests:subtitle')}</p>
        </div>
        <button onClick={fetchRequests} className="btn-secondary">
          <RefreshCw size={18} />
          {t('appointmentRequests:actions.refresh')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-sm text-gray-500">{t('appointmentRequests:summary.visible')}</p>
          <p className="text-2xl font-bold text-gray-900">{stats.visible}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-gray-500">{t('appointmentRequests:summary.pending')}</p>
          <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-gray-500">{t('appointmentRequests:summary.source')}</p>
          <p className="text-2xl font-bold text-green-600">WhatsApp</p>
        </div>
      </div>

      <div className="card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <MessageCircle size={18} className="text-green-600" />
          {t('appointmentRequests:filters.sourceHint')}
        </div>
        <select className="input-field md:max-w-xs" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">{t('appointmentRequests:filters.allStatus')}</option>
          {['pending', 'approved', 'rejected', 'converted', 'closed'].map(item => (
            <option key={item} value={item}>{t(`appointmentRequests:status.${item}`)}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-primary-600" size={32} />
          </div>
        ) : requests.length === 0 ? (
          <div className="card p-10 text-center text-gray-500">
            {t('appointmentRequests:empty')}
          </div>
        ) : (
          requests.map(request => (
            <div key={request.id} className="card p-4 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="space-y-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-gray-900">{request.patientName}</h3>
                    <span className={`px-2 py-1 rounded text-xs font-bold border ${statusClass(request.status)}`}>
                      {t(`appointmentRequests:status.${request.status}`)}
                    </span>
                    <span className="px-2 py-1 rounded text-xs font-bold bg-green-50 text-green-700 border border-green-100">
                      WhatsApp
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-600">
                    <span>{request.phone}</span>
                    {request.email && <span>{request.email}</span>}
                    <span>{t(`appointmentRequests:requestType.${request.requestType}`)}</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 text-sm">
                    <InfoBlock label={t('appointmentRequests:fields.service')} value={request.appointmentType?.name || t('common:unassigned')} />
                    <InfoBlock label={t('appointmentRequests:fields.practitioner')} value={request.practitioner ? `Dt. ${request.practitioner.firstName} ${request.practitioner.lastName}` : t('common:unassigned')} />
                    <InfoBlock label={t('appointmentRequests:fields.preferredTime')} value={formatDateRange(request.preferredStartTime, request.preferredEndTime, i18n.language)} />
                  </div>

                  {request.rawMessage && (
                    <p className="text-sm text-gray-500 bg-gray-50 p-3 rounded-lg line-clamp-2">{request.rawMessage}</p>
                  )}
                </div>

                <div className="flex flex-wrap lg:justify-end gap-2">
                  {request.status !== 'converted' && request.requestType !== 'cancel' && (
                    <button
                      onClick={() => convertRequest(request)}
                      disabled={workingId === request.id}
                      className="btn-primary"
                    >
                      {workingId === request.id ? <Loader2 size={16} className="animate-spin" /> : <CalendarPlus size={16} />}
                      {t('appointmentRequests:actions.convert')}
                    </button>
                  )}
                  {request.status === 'pending' && (
                    <>
                      <button onClick={() => updateStatus(request, 'approved')} disabled={workingId === request.id} className="btn-secondary">
                        <CheckCircle2 size={16} />
                        {t('appointmentRequests:actions.approve')}
                      </button>
                      <button onClick={() => updateStatus(request, 'rejected')} disabled={workingId === request.id} className="btn-secondary text-red-600">
                        <XCircle size={16} />
                        {t('appointmentRequests:actions.reject')}
                      </button>
                    </>
                  )}
                  {request.status !== 'closed' && request.status !== 'converted' && (
                    <button onClick={() => updateStatus(request, 'closed')} disabled={workingId === request.id} className="btn-secondary">
                      <Clock size={16} />
                      {t('appointmentRequests:actions.close')}
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

const InfoBlock = ({ label, value }: { label: string; value: string }) => (
  <div className="bg-gray-50 rounded-lg p-3">
    <p className="text-xs text-gray-500 uppercase font-semibold">{label}</p>
    <p className="font-medium text-gray-900 mt-1">{value}</p>
  </div>
);

const formatDateRange = (start?: string, end?: string, locale = 'tr') => {
  if (!start) return '-';
  const startDate = new Date(start);
  const startLabel = startDate.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  if (!end) return startLabel;
  const endLabel = new Date(end).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return `${startLabel} - ${endLabel}`;
};

const statusClass = (status: string) => {
  switch (status) {
    case 'pending': return 'bg-amber-50 text-amber-700 border-amber-100';
    case 'approved': return 'bg-blue-50 text-blue-700 border-blue-100';
    case 'converted': return 'bg-green-50 text-green-700 border-green-100';
    case 'rejected': return 'bg-red-50 text-red-700 border-red-100';
    case 'closed': return 'bg-gray-50 text-gray-700 border-gray-100';
    default: return 'bg-gray-50 text-gray-700 border-gray-100';
  }
};

export default AppointmentRequests;
