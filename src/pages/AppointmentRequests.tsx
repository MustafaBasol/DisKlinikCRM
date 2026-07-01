import React, { useEffect, useState, useCallback } from 'react';
import {
  AlertCircle,
  CalendarPlus,
  Clock,
  Instagram,
  Loader2,
  MessageCircle,
  Pencil,
  RefreshCw,
  X,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { appointmentRequestService, appointmentService, appointmentTypeService, userService } from '../services/api';
import { useClinic } from '../context/ClinicContext';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';

const APPOINTMENT_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'converted', 'closed'];

type EditForm = {
  appointmentTypeId: string;
  practitionerId: string;
  date: string;           // "YYYY-MM-DD"
  selectedSlot: { startTime: string; endTime: string; start: string; end: string } | null;
};

const today = () => {
  const d = new Date();
  return (
    d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0')
  );
};

const isoToDateStr = (iso?: string | null): string => {
  if (!iso) return '';
  return iso.slice(0, 10); // "YYYY-MM-DD"
};

const AppointmentRequests: React.FC = () => {
  const { t } = useTranslation(['appointmentRequests', 'common']);
  const { formatDateTime, formatTime } = useClinicPreferences();
  const { selectedClinicId } = useClinic();
  const [searchParams] = useSearchParams();
  const [allRequests, setAllRequests] = useState<any[]>([]);
  // Read from URL so links like /appointment-requests?status=pending apply immediately
  // and survive a refresh.
  const [status, setStatus] = useState(() => {
    const fromUrl = searchParams.get('status');
    return fromUrl && APPOINTMENT_REQUEST_STATUSES.includes(fromUrl) ? fromUrl : '';
  });
  const [channel, setChannel] = useState('');
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState('');
  const [error, setError] = useState('');

  // Edit modal state
  const [editModal, setEditModal] = useState<{ open: boolean; request: any | null; mode: 'edit' | 'convert' }>({
    open: false, request: null, mode: 'edit',
  });
  const [editForm, setEditForm] = useState<EditForm>({ appointmentTypeId: '', practitionerId: '', date: '', selectedSlot: null });
  const [modalServices, setModalServices] = useState<any[]>([]);
  const [modalDoctors, setModalDoctors] = useState<any[]>([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<Array<{ start: string; end: string; startTime: string; endTime: string }>>([]);
  const [slotsReason, setSlotsReason] = useState<string | null>(null);
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  const formatPreferredRange = (start?: string, end?: string) => {
    if (!start) return '-';
    if (!end) return formatDateTime(start);
    return `${formatDateTime(start)} - ${formatTime(end)}`;
  };

  const fetchRequests = async () => {
    setLoading(true);
    setError('');
    try {
      const params: { source?: string; clinicId?: string } = {};
      if (channel) params.source = channel;
      if (selectedClinicId && selectedClinicId !== 'all') params.clinicId = selectedClinicId;
      const res = await appointmentRequestService.getAll(params);
      setAllRequests(res.data);
    } catch {
      setError(t('appointmentRequests:errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRequests(); }, [channel, selectedClinicId]);

  const updateStatus = async (request: any, nextStatus: string) => {
    const rejectionReason = nextStatus === 'rejected'
      ? window.prompt(t('appointmentRequests:actions.rejectionPrompt'))
      : undefined;
    if (nextStatus === 'rejected' && !rejectionReason) return;

    setWorkingId(request.id);
    setError('');
    try {
      await appointmentRequestService.updateStatus(request.id, { status: nextStatus, rejectionReason });
      fetchRequests();
    } catch (err: any) {
      setError(err.response?.data?.error || t('common:errorGeneric'));
    } finally {
      setWorkingId('');
    }
  };

  const openEditModal = useCallback(async (request: any, mode: 'edit' | 'convert') => {
    setEditForm({
      appointmentTypeId: request.appointmentTypeId || '',
      practitionerId: request.practitionerId || '',
      date: isoToDateStr(request.preferredStartTime) || today(),
      selectedSlot: null,
    });
    setAvailableSlots([]);
    setSlotsReason(null);
    setEditModal({ open: true, request, mode });
    setModalError('');
    setModalLoading(true);
    try {
      const [svcsRes, docsRes] = await Promise.all([
        appointmentTypeService.getAll(true),
        userService.getDoctors(),
      ]);
      setModalServices(svcsRes.data);
      setModalDoctors(docsRes.data);
    } finally {
      setModalLoading(false);
    }
  }, []);

  // Fetch available slots when practitioner + service + date are all filled
  useEffect(() => {
    const { appointmentTypeId, practitionerId, date } = editForm;
    if (!editModal.open || !appointmentTypeId || !practitionerId || !date) {
      setAvailableSlots([]);
      setSlotsReason(null);
      return;
    }
    let cancelled = false;
    setSlotsLoading(true);
    setAvailableSlots([]);
    setSlotsReason(null);
    setEditForm(prev => ({ ...prev, selectedSlot: null }));
    appointmentService.getAvailableSlots({ doctorId: practitionerId, serviceId: appointmentTypeId, date })
      .then(res => {
        if (cancelled) return;
        setAvailableSlots(res.data.slots || []);
        setSlotsReason(res.data.reason || null);
      })
      .catch(() => { if (!cancelled) setSlotsReason('error'); })
      .finally(() => { if (!cancelled) setSlotsLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editForm.appointmentTypeId, editForm.practitionerId, editForm.date, editModal.open]);

  const convertRequest = async (request: any) => {
    // If any required field is missing, open the edit modal instead of calling convert
    if (!request.appointmentTypeId || !request.practitionerId || !request.preferredStartTime || !request.preferredEndTime) {
      await openEditModal(request, 'convert');
      return;
    }
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
      } else if (code === 'MISSING_REQUIRED_FIELDS') {
        await openEditModal(request, 'convert');
      } else {
        setError(err.response?.data?.error || t('appointmentRequests:errors.convertFailed'));
      }
    } finally {
      setWorkingId('');
    }
  };

  const handleModalSave = async () => {
    const req = editModal.request;
    if (!req) return;
    setModalSaving(true);
    setModalError('');
    try {
      await appointmentRequestService.update(req.id, {
        appointmentTypeId: editForm.appointmentTypeId || null,
        practitionerId: editForm.practitionerId || null,
        preferredStartTime: editForm.selectedSlot?.startTime ?? null,
        preferredEndTime: editForm.selectedSlot?.endTime ?? null,
      });
      setEditModal({ open: false, request: null, mode: 'edit' });
      fetchRequests();
    } catch (err: any) {
      setModalError(err.response?.data?.error || t('common:errorGeneric'));
    } finally {
      setModalSaving(false);
    }
  };

  const handleModalConvert = async () => {
    const req = editModal.request;
    if (!req) return;
    setModalSaving(true);
    setModalError('');
    try {
      await appointmentRequestService.convert(req.id, {
        appointmentTypeId: editForm.appointmentTypeId || undefined,
        practitionerId: editForm.practitionerId || undefined,
        startTime: editForm.selectedSlot?.startTime,
        endTime: editForm.selectedSlot?.endTime,
      });
      setEditModal({ open: false, request: null, mode: 'edit' });
      fetchRequests();
    } catch (err: any) {
      const code = err.response?.data?.code;
      if (code === 'APPOINTMENT_OUTSIDE_AVAILABILITY') {
        setModalError(t('appointmentRequests:errors.outsideAvailability'));
      } else if (code === 'APPOINTMENT_OVERLAP') {
        setModalError(t('appointmentRequests:errors.overlap'));
      } else if (code === 'MISSING_REQUIRED_FIELDS') {
        setModalError(t('appointmentRequests:errors.missingRequiredFields'));
      } else {
        setModalError(err.response?.data?.error || t('appointmentRequests:errors.convertFailed'));
      }
    } finally {
      setModalSaving(false);
    }
  };

  const requests = status ? allRequests.filter(item => item.status === status) : allRequests;

  const stats = {
    pending: allRequests.filter(item => item.status === 'pending').length,
    converted: allRequests.filter(item => item.status === 'converted').length,
    visible: requests.length,
  };

  const channelLabel = (source?: string | null) => {
    const normalized = String(source || 'whatsapp').toLowerCase();
    return t(`appointmentRequests:channels.${normalized}`, { defaultValue: normalized });
  };

  const channelBadgeClass = (source?: string | null) => {
    switch (String(source || 'whatsapp').toLowerCase()) {
      case 'instagram': return 'bg-purple-50 text-purple-700 border-purple-100';
      case 'manual': return 'bg-gray-50 text-gray-700 border-gray-100';
      case 'whatsapp':
      default: return 'bg-green-50 text-green-700 border-green-100';
    }
  };

  const channelIcon = (source?: string | null) => {
    if (String(source || '').toLowerCase() === 'instagram') return <Instagram size={12} />;
    return <MessageCircle size={12} />;
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
          <p className="text-sm text-gray-500">{t('appointmentRequests:summary.converted')}</p>
          <p className="text-2xl font-bold text-green-600">{stats.converted}</p>
        </div>
      </div>

      <div className="card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <MessageCircle size={18} className="text-green-600" />
          {t('appointmentRequests:filters.sourceHint')}
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          <select className="input-field md:max-w-xs" value={channel} onChange={e => setChannel(e.target.value)}>
            <option value="">{t('appointmentRequests:filters.allChannels')}</option>
            <option value="whatsapp">{t('appointmentRequests:channels.whatsapp')}</option>
            <option value="instagram">{t('appointmentRequests:channels.instagram')}</option>
            <option value="manual">{t('appointmentRequests:channels.manual')}</option>
          </select>
          <select className="input-field md:max-w-xs" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">{t('appointmentRequests:filters.allStatus')}</option>
            {['pending', 'approved', 'rejected', 'converted', 'closed'].map(item => (
              <option key={item} value={item}>{t(`appointmentRequests:status.${item}`)}</option>
            ))}
          </select>
        </div>
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
            <div key={request.id} className={`card p-4 space-y-4 border-l-4 ${statusCardClass(request.status)}`}>
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="space-y-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-gray-900">{request.patientName}</h3>
                    <span className={`px-3 py-1.5 rounded-md text-sm font-bold border ${statusClass(request.status)}`}>
                      {t('appointmentRequests:labels.status')}: {t(`appointmentRequests:status.${request.status}`)}
                    </span>
                    {request.status === 'converted' && (
                      <span className="px-2 py-1 rounded text-xs font-bold bg-blue-50 text-blue-700 border border-blue-100">
                        {t('appointmentRequests:badges.scheduled')}
                      </span>
                    )}
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold border ${channelBadgeClass(request.source)}`}>
                      {channelIcon(request.source)}
                      {channelLabel(request.source)}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-600">
                    <span>{request.phone}</span>
                    {request.email && <span>{request.email}</span>}
                    <span>{t(`appointmentRequests:requestType.${request.requestType}`)}</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2 text-sm">
                    <InfoBlock label={t('appointmentRequests:fields.clinic')} value={request.clinic?.name || t('common:unassigned')} />
                    <InfoBlock label={t('appointmentRequests:fields.service')} value={request.appointmentType?.name || t('common:unassigned')} />
                    <InfoBlock label={t('appointmentRequests:fields.practitioner')} value={request.practitioner ? `${request.practitioner.firstName} ${request.practitioner.lastName}` : t('common:unassigned')} />
                    <InfoBlock label={t('appointmentRequests:fields.preferredTime')} value={formatPreferredRange(request.preferredStartTime, request.preferredEndTime)} />
                  </div>

                  {request.rawMessage && (
                    <p className="text-sm text-gray-500 bg-gray-50 p-3 rounded-lg line-clamp-2">{request.rawMessage}</p>
                  )}
                </div>

                <div className="flex flex-wrap lg:justify-end gap-2">
                  {request.status !== 'converted' && !String(request.id).startsWith('legacy-') && (
                    <button
                      onClick={() => openEditModal(request, 'edit')}
                      disabled={workingId === request.id}
                      className="btn-secondary"
                      title={t('appointmentRequests:actions.edit')}
                    >
                      <Pencil size={16} />
                      {t('appointmentRequests:actions.edit')}
                    </button>
                  )}
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
                    <button onClick={() => updateStatus(request, 'rejected')} disabled={workingId === request.id} className="btn-secondary text-red-600">
                      <XCircle size={16} />
                      {t('appointmentRequests:actions.reject')}
                    </button>
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

      {/* Edit / Convert Modal */}
      {editModal.open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {editModal.mode === 'convert'
                    ? t('appointmentRequests:edit.titleConvert')
                    : t('appointmentRequests:edit.title')}
                </h2>
                {editModal.request?.patientName && (
                  <p className="text-sm text-gray-500 mt-0.5">{editModal.request.patientName}</p>
                )}
              </div>
              <button
                onClick={() => setEditModal({ open: false, request: null, mode: 'edit' })}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"
                disabled={modalSaving}
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {editModal.mode === 'convert' && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  {t('appointmentRequests:edit.convertHint')}
                </div>
              )}

              {modalLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="animate-spin text-primary-600" size={28} />
                </div>
              ) : (
                <>
                  {/* Step 1: Service */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('appointmentRequests:edit.service')}
                    </label>
                    <select
                      className="input-field w-full"
                      value={editForm.appointmentTypeId}
                      onChange={e => setEditForm(prev => ({ ...prev, appointmentTypeId: e.target.value, selectedSlot: null }))}
                    >
                      <option value="">{t('appointmentRequests:edit.selectService')}</option>
                      {modalServices.map((svc: any) => (
                        <option key={svc.id} value={svc.id}>{svc.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Step 2: Practitioner (shown after service selected) */}
                  {editForm.appointmentTypeId && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t('appointmentRequests:edit.practitioner')}
                      </label>
                      <select
                        className="input-field w-full"
                        value={editForm.practitionerId}
                        onChange={e => setEditForm(prev => ({ ...prev, practitionerId: e.target.value, selectedSlot: null }))}
                      >
                        <option value="">{t('appointmentRequests:edit.selectPractitioner')}</option>
                        {modalDoctors.map((doc: any) => (
                          <option key={doc.id} value={doc.id}>{doc.firstName} {doc.lastName}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Step 3: Date (shown after practitioner selected) */}
                  {editForm.appointmentTypeId && editForm.practitionerId && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t('appointmentRequests:edit.date')}
                      </label>
                      <input
                        type="date"
                        className="input-field w-full"
                        min={today()}
                        value={editForm.date}
                        onChange={e => setEditForm(prev => ({ ...prev, date: e.target.value, selectedSlot: null }))}
                      />
                    </div>
                  )}

                  {/* Step 4: Available slots (shown after date selected) */}
                  {editForm.appointmentTypeId && editForm.practitionerId && editForm.date && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('appointmentRequests:edit.availableSlots')}
                      </label>
                      {slotsLoading ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                          <Loader2 size={16} className="animate-spin" />
                          {t('appointmentRequests:edit.loadingSlots')}
                        </div>
                      ) : availableSlots.length === 0 ? (
                        <p className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
                          {slotsReason === 'clinic_closed'
                            ? t('appointmentRequests:edit.clinicClosed')
                            : slotsReason === 'off_day'
                            ? t('appointmentRequests:edit.offDay')
                            : t('appointmentRequests:edit.noSlots')}
                        </p>
                      ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                          {availableSlots.map(slot => {
                            const isSelected = editForm.selectedSlot?.startTime === slot.startTime;
                            return (
                              <button
                                key={slot.startTime}
                                type="button"
                                onClick={() => setEditForm(prev => ({ ...prev, selectedSlot: slot }))}
                                className={`text-sm py-2 px-3 rounded-lg border font-medium transition-colors ${
                                  isSelected
                                    ? 'bg-primary-600 text-white border-primary-600'
                                    : 'bg-white text-gray-700 border-gray-200 hover:border-primary-400 hover:bg-primary-50'
                                }`}
                              >
                                {slot.start}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {modalError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
                  <AlertCircle size={16} />
                  {modalError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button
                onClick={() => setEditModal({ open: false, request: null, mode: 'edit' })}
                disabled={modalSaving}
                className="btn-secondary"
              >
                {t('common:cancel')}
              </button>
              <button
                onClick={handleModalSave}
                disabled={modalSaving || modalLoading}
                className="btn-secondary"
              >
                {modalSaving ? <Loader2 size={16} className="animate-spin" /> : null}
                {t('appointmentRequests:edit.save')}
              </button>
              {editModal.request?.requestType !== 'cancel' && (
                <button
                  onClick={handleModalConvert}
                  disabled={modalSaving || modalLoading || !editForm.selectedSlot}
                  className="btn-primary"
                >
                  {modalSaving ? <Loader2 size={16} className="animate-spin" /> : <CalendarPlus size={16} />}
                  {t('appointmentRequests:actions.convert')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const InfoBlock = ({ label, value }: { label: string; value: string }) => (
  <div className="bg-gray-50 rounded-lg p-3">
    <p className="text-xs text-gray-500 uppercase font-semibold">{label}</p>
    <p className="font-medium text-gray-900 mt-1">{value}</p>
  </div>
);

const statusCardClass = (status: string) => {
  switch (status) {
    case 'pending': return 'border-l-amber-400';
    case 'approved': return 'border-l-blue-400';
    case 'converted': return 'border-l-green-500';
    case 'rejected': return 'border-l-red-400';
    case 'closed': return 'border-l-gray-300';
    default: return 'border-l-gray-200';
  }
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

