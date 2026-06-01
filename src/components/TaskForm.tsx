import React, { useState, useEffect } from 'react';
import { X, Calendar, User, ClipboardList, AlertCircle, Loader2, Tag } from 'lucide-react';
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
  
  const [patients, setPatients] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  
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

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [patientsRes, usersRes] = await Promise.all([
          patientService.getAll(),
          userService.getAll()
        ]);
        setPatients(patientsRes.data);
        setUsers(usersRes.data);
        
        if (formData.patientId) {
          const apptsRes = await appointmentService.getAll({ patientId: formData.patientId });
          setAppointments(apptsRes.data);
        }
      } catch (err) {
        console.error('Failed to fetch form data:', err);
      }
    };
    fetchData();
  }, [formData.patientId]);

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

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
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

            <div className="grid grid-cols-2 gap-4">
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

            <div className="grid grid-cols-2 gap-4">
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

            <div className="grid grid-cols-2 gap-4">
              {/* Patient Selector */}
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700">{t('tasks:form.patient')}</label>
                <select
                  className="input-field"
                  value={formData.patientId}
                  onChange={(e) => setFormData({ ...formData, patientId: e.target.value, appointmentId: '' })}
                  disabled={!!patientId}
                >
                  <option value="">{t('common:selectPlaceholder')}</option>
                  {patients.map(p => (
                    <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
                  ))}
                </select>
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
