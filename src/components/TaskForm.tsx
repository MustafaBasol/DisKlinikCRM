import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Calendar, User, ClipboardList, AlertCircle, Loader2, Tag, Search, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { patientService, userService, appointmentService, taskService } from '../services/api';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';

interface TaskFormProps {
  onClose: () => void;
  onSuccess: () => void;
  initialData?: any;
  patientId?: string;
  appointmentId?: string;
}

const TaskForm: React.FC<TaskFormProps> = ({ onClose, onSuccess, initialData, patientId, appointmentId }) => {
  const { t } = useTranslation(['tasks', 'common']);
  const { formatDate } = useClinicPreferences();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [users, setUsers] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);

  // Patient autocomplete state
  const [patientSearch, setPatientSearch] = useState('');
  const [patientResults, setPatientResults] = useState<any[]>([]);
  const [patientDropdownOpen, setPatientDropdownOpen] = useState(false);
  const [patientSearchLoading, setPatientSearchLoading] = useState(false);
  const [selectedPatientLabel, setSelectedPatientLabel] = useState('');
  const patientSearchRef = useRef<HTMLDivElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [formData, setFormData] = useState({
    title: initialData?.title || '',
    description: initialData?.description || '',
    patientId: patientId || initialData?.patientId || '',
    appointmentId: appointmentId || initialData?.appointmentId || '',
    assignedToId: initialData?.assignedToId || '',
    dueDate: initialData?.dueDate ? new Date(initialData.dueDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    priority: initialData?.priority || 'normal',
    status: initialData?.status || 'open',
  });

  // Load initial patient name when editing or patientId is pre-set
  useEffect(() => {
    const presetId = patientId || initialData?.patientId;
    if (!presetId) return;
    patientService.getById(presetId)
      .then(r => {
        const p = r.data;
        setSelectedPatientLabel(`${p.firstName} ${p.lastName}`);
      })
      .catch(() => {});
  }, []);

  // Load users once
  useEffect(() => {
    userService.getAll()
      .then(res => setUsers(res.data))
      .catch(err => console.error(err));
  }, []);

  // Load appointments when patient changes
  useEffect(() => {
    if (formData.patientId) {
      appointmentService.getAll({ patientId: formData.patientId })
        .then(res => setAppointments(res.data))
        .catch(() => setAppointments([]));
    } else {
      setAppointments([]);
    }
  }, [formData.patientId]);

  // Close patient dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (patientSearchRef.current && !patientSearchRef.current.contains(e.target as Node)) {
        setPatientDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const searchPatients = useCallback((q: string) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!q.trim()) {
      setPatientResults([]);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      setPatientSearchLoading(true);
      try {
        const res = await patientService.getAll({ search: q, limit: 20 });
        setPatientResults(res.data || []);
      } catch {
        setPatientResults([]);
      } finally {
        setPatientSearchLoading(false);
      }
    }, 300);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (initialData?.id) {
        await taskService.update(initialData.id, formData);
      } else {
        await taskService.create(formData);
      }
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || t('common:errorGeneric'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-primary-600 text-white">
          <h2 className="text-xl font-bold">
            {initialData ? t('tasks:editTask') : t('tasks:newTask')}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm">
              <AlertCircle size={18} />
              {error}
            </div>
          )}

          <div className="space-y-4">
            {/* Title */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">{t('tasks:form.title')}</label>
              <input
                required
                className="input-field"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder={t('tasks:form.title')}
              />
            </div>

            {/* Description */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">{t('tasks:form.description')}</label>
              <textarea
                className="input-field min-h-[80px]"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="..."
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Assignee */}
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <User size={16} className="text-gray-400" />
                  {t('tasks:form.assignedTo')}
                </label>
                <select
                  required
                  className="input-field"
                  value={formData.assignedToId}
                  onChange={(e) => setFormData({ ...formData, assignedToId: e.target.value })}
                >
                  <option value="">{t('common:selectPlaceholder')}</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({t(`common:roles.${u.role}`)})</option>
                  ))}
                </select>
              </div>

              {/* Priority */}
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Tag size={16} className="text-gray-400" />
                  {t('tasks:form.priority')}
                </label>
                <select
                  className="input-field"
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                >
                  {['low', 'normal', 'high', 'urgent'].map(p => (
                    <option key={p} value={p}>{t(`tasks:priority.${p}`)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Due Date */}
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Calendar size={16} className="text-gray-400" />
                  {t('tasks:form.dueDate')}
                </label>
                <input
                  type="date"
                  required
                  className="input-field"
                  value={formData.dueDate}
                  onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                />
              </div>

              {/* Status */}
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700">{t('tasks:form.status')}</label>
                <select
                  className="input-field"
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                >
                  {['open', 'in_progress', 'completed', 'cancelled'].map(s => (
                    <option key={s} value={s}>{t(`tasks:status.${s}`)}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Patient Autocomplete */}
            <div className="space-y-1" ref={patientSearchRef}>
              <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <User size={16} className="text-gray-400" />
                {t('tasks:form.patient')}
              </label>
              {patientId ? (
                <div className="input-field text-gray-700">{selectedPatientLabel}</div>
              ) : (
                <div className="relative">
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    <input
                      type="text"
                      className="input-field pl-9 pr-16"
                      placeholder={t('common:typeToSearch')}
                      value={patientDropdownOpen ? patientSearch : selectedPatientLabel}
                      onFocus={() => {
                        setPatientDropdownOpen(true);
                        setPatientSearch('');
                        setPatientResults([]);
                      }}
                      onChange={(e) => {
                        setPatientSearch(e.target.value);
                        searchPatients(e.target.value);
                      }}
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      {formData.patientId && !patientDropdownOpen && (
                        <button
                          type="button"
                          onClick={() => {
                            setFormData({ ...formData, patientId: '', appointmentId: '' });
                            setSelectedPatientLabel('');
                          }}
                          className="text-gray-400 hover:text-gray-600 p-0.5"
                          title={t('common:clear')}
                        >
                          <X size={14} />
                        </button>
                      )}
                      <ChevronDown size={16} className="text-gray-400" />
                    </div>
                  </div>
                  {patientDropdownOpen && (
                    <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
                      {patientSearchLoading && (
                        <div className="flex items-center justify-center py-3 text-gray-400">
                          <Loader2 size={16} className="animate-spin" />
                        </div>
                      )}
                      {!patientSearchLoading && patientSearch && patientResults.length === 0 && (
                        <div className="px-4 py-3 text-sm text-gray-400">{t('common:noResultsFound')}</div>
                      )}
                      {!patientSearchLoading && !patientSearch && (
                        <div className="px-4 py-3 text-sm text-gray-400">{t('common:typeToSearch')}</div>
                      )}
                      {patientResults.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          className="w-full text-left px-4 py-2.5 text-sm hover:bg-primary-50 hover:text-primary-700 transition-colors"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setFormData({ ...formData, patientId: p.id, appointmentId: '' });
                            setSelectedPatientLabel(`${p.firstName} ${p.lastName}`);
                            setPatientDropdownOpen(false);
                            setPatientSearch('');
                          }}
                        >
                          <span className="font-medium">{p.firstName} {p.lastName}</span>
                          {p.phone && <span className="ml-2 text-gray-400">{p.phone}</span>}
                          {p.email && <span className="ml-2 text-gray-400 text-xs">{p.email}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Appointment Selector */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">{t('tasks:form.appointment')}</label>
              <select
                className="input-field"
                value={formData.appointmentId}
                onChange={(e) => setFormData({ ...formData, appointmentId: e.target.value })}
                disabled={!formData.patientId || !!appointmentId}
              >
                <option value="">{t('common:selectPlaceholder')}</option>
                {appointments.map(a => (
                  <option key={a.id} value={a.id}>
                    {formatDate(a.startTime)} - {a.appointmentType.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">{t('common:cancel')}</button>
            <button type="submit" disabled={loading} className="flex-1 btn-primary">
              {loading ? <Loader2 className="animate-spin" size={20} /> : t('common:save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TaskForm;
