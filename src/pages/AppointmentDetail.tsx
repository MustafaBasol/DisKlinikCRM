import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { 
  ArrowLeft, 
  Calendar, 
  Clock, 
  User, 
  Stethoscope, 
  Tag, 
  History, 
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  MessageSquare,
  ClipboardList,
  Plus,
  Briefcase
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { appointmentService, taskService, treatmentCaseService } from '../services/api';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import TaskForm from '../components/TaskForm';
import TreatmentCaseForm from '../components/TreatmentCaseForm';
import PrepareMessageModal from '../components/PrepareMessageModal';

const AppointmentDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(['appointments', 'common']);
  const { formatCurrency, formatDate, formatTime, formatDateTime } = useClinicPreferences();
  
  const [appointment, setAppointment] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [treatmentCases, setTreatmentCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isTaskFormOpen, setIsTaskFormOpen] = useState(false);
  const [isTreatmentFormOpen, setIsTreatmentFormOpen] = useState(false);
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = async () => {
    if (!id) return;
    try {
      const res = await appointmentService.getById(id);
      setAppointment(res.data);
      
      const tasksRes = await taskService.getAll({ appointmentId: id });
      setTasks(tasksRes.data);

      const treatmentsRes = await treatmentCaseService.getAll({ patientId: res.data.patientId });
      setTreatmentCases(treatmentsRes.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

  const handleStatusUpdate = async (newStatus: string) => {
    if (!id) return;
    try {
      await appointmentService.updateStatus(id, newStatus);
      fetchDetail();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  if (error || !appointment) {
    return (
      <div className="card p-12 text-center text-red-500">
        <AlertCircle className="mx-auto mb-4" size={48} />
        <p className="text-xl font-bold">{error || 'Appointment not found'}</p>
        <button onClick={() => navigate('/appointments')} className="btn-primary mt-6">
          {t('appointments:actions.backToList', { defaultValue: 'Back to Appointments' })}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <button 
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-white rounded-lg transition-colors text-gray-500 shadow-sm border border-gray-100"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('appointments:appointmentDetails')}</h1>
          <p className="text-gray-500 text-sm">#{appointment.id.slice(0, 8)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-8">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-primary-50 text-primary-600 flex items-center justify-center font-bold text-2xl shadow-inner">
                  {appointment.patient.firstName[0]}{appointment.patient.lastName[0]}
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    <Link to={`/patients/${appointment.patientId}`} className="hover:text-primary-600 transition-colors">
                      {appointment.patient.firstName} {appointment.patient.lastName}
                    </Link>
                  </h2>
                  <span className={`badge mt-1 ${
                    appointment.status === 'completed' ? 'badge-green' : 
                    appointment.status === 'confirmed' ? 'badge-blue' : 'badge-yellow'
                  }`}>
                    {t(`appointments:status.${appointment.status}`)}
                  </span>
                </div>
              </div>
              
              <div className="flex gap-2">
                {appointment.status === 'scheduled' && (
                  <button onClick={() => handleStatusUpdate('confirmed')} className="btn-primary">
                    <CheckCircle2 size={18} />
                    {t('appointments:actions.confirm')}
                  </button>
                )}
                {(appointment.status === 'scheduled' || appointment.status === 'confirmed') && (
                  <button onClick={() => handleStatusUpdate('completed')} className="btn-secondary text-green-600 hover:bg-green-50 border-green-100">
                    <CheckCircle2 size={18} />
                    {t('appointments:actions.complete')}
                  </button>
                )}
                {(appointment.status !== 'cancelled' && appointment.status !== 'completed') && (
                  <button onClick={() => handleStatusUpdate('cancelled')} className="btn-secondary text-red-600 hover:bg-red-50 border-red-100">
                    <XCircle size={18} />
                    {t('appointments:actions.cancel')}
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-gray-600">
                  <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center text-primary-500">
                    <Calendar size={20} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase">{t('common:date')}</p>
                    <p className="font-medium">{formatDate(appointment.startTime)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-gray-600">
                  <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center text-primary-500">
                    <Clock size={20} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase">{t('appointments:form.startTime')}</p>
                    <p className="font-medium">
                      {formatTime(appointment.startTime)} - {formatTime(appointment.endTime)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-3 text-gray-600">
                  <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center text-primary-500">
                    <Stethoscope size={20} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase">{t('common:practitioner')}</p>
                    <p className="font-medium">{appointment.practitioner.firstName} {appointment.practitioner.lastName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-gray-600">
                  <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center text-primary-500">
                    <Tag size={20} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase">{t('common:service')}</p>
                    <p className="font-medium">{appointment.appointmentType.name}</p>
                  </div>
                </div>
              </div>
            </div>

            {appointment.notes && (
              <div className="mt-8 p-4 bg-gray-50 rounded-xl">
                <p className="text-xs font-semibold text-gray-400 uppercase mb-2">{t('appointments:form.notes')}</p>
                <p className="text-gray-700 whitespace-pre-wrap">{appointment.notes}</p>
              </div>
            )}
          </div>

          {/* Related Tasks */}
          <div className="card overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardList size={20} className="text-gray-400" />
                <h3 className="font-bold">{t('tasks:title')}</h3>
              </div>
              <button 
                onClick={() => setIsTaskFormOpen(true)}
                className="btn-primary py-1.5 text-xs"
              >
                <Plus size={16} />
                {t('tasks:newTask')}
              </button>
            </div>
            <div className="divide-y divide-gray-50">
              {tasks.length > 0 ? tasks.map(task => (
                <div key={task.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                       task.priority === 'urgent' ? 'bg-red-500' : 
                       task.priority === 'high' ? 'bg-orange-500' : 'bg-blue-500'
                    }`}></div>
                    <p className={`text-sm font-medium ${task.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                      {task.title}
                    </p>
                  </div>
                  <span className={`badge ${task.status === 'completed' ? 'badge-green' : 'badge-yellow'}`}>
                    {t(`tasks:status.${task.status}`)}
                  </span>
                </div>
              )) : (
                <div className="p-8 text-center text-gray-400 italic">
                  {t('common:noData')}
                </div>
              )}
            </div>
          </div>

          {/* Related Treatment Cases */}
          <div className="card overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Briefcase size={20} className="text-gray-400" />
                <h3 className="font-bold">{t('treatmentCases:title')}</h3>
              </div>
              <button 
                onClick={() => setIsTreatmentFormOpen(true)}
                className="btn-primary py-1.5 text-xs"
              >
                <Plus size={16} />
                {t('treatmentCases:newCase')}
              </button>
            </div>
            <div className="divide-y divide-gray-50">
              {treatmentCases.length > 0 ? treatmentCases.map(tc => (
                <Link key={tc.id} to={`/treatment-cases/${tc.id}`} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                  <div>
                    <p className="text-sm font-bold text-gray-900">{tc.title}</p>
                    <p className="text-xs text-gray-500">{t(`treatmentCases:stages.${tc.stage}`)}</p>
                  </div>
                  <p className="text-sm font-bold text-primary-600">{formatCurrency(tc.acceptedAmount || tc.estimatedAmount, tc.currency)}</p>
                </Link>
              )) : (
                <div className="p-8 text-center text-gray-400 italic">
                  {t('common:noData')}
                </div>
              )}
            </div>
          </div>

          {/* Activity Logs */}
          <div className="card overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex items-center gap-2">
              <History size={20} className="text-gray-400" />
              <h3 className="font-bold">{t('patients:detail.activityTimeline')}</h3>
            </div>
            <div className="p-6">
              <div className="space-y-6 relative before:absolute before:left-[15px] before:top-2 before:bottom-2 before:w-[2px] before:bg-gray-100">
                {appointment.activityLogs?.map((log: any, idx: number) => (
                  <div key={idx} className="relative pl-10">
                    <div className="absolute left-0 top-1 w-8 h-8 rounded-full bg-white border-2 border-gray-100 flex items-center justify-center z-10">
                      <div className="w-2 h-2 rounded-full bg-primary-500"></div>
                    </div>
                    <div>
                      <p className="text-sm text-gray-900">
                        <span className="font-bold">{log.user.firstName}</span> {log.description}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {formatDateTime(log.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar / Quick Actions */}
        <div className="space-y-6">
          <div className="card p-6">
            <h3 className="font-bold mb-4">{t('common:actions')}</h3>
            <div className="space-y-3">
              <button 
                onClick={() => handleStatusUpdate('no_show')}
                className="w-full btn-secondary text-gray-600 hover:bg-gray-50"
              >
                {t('appointments:actions.noShow')}
              </button>
              <button 
                onClick={() => handleStatusUpdate('rescheduled')}
                className="w-full btn-secondary text-gray-600 hover:bg-gray-50"
              >
                {t('appointments:actions.reschedule')}
              </button>
              <button 
                onClick={() => setIsMessageModalOpen(true)}
                className="w-full btn-secondary text-primary-600 border-primary-100 hover:bg-primary-50"
              >
                <MessageSquare size={18} />
                {t('messages:prepare', { defaultValue: 'Prepare Reminder' })}
              </button>
            </div>
          </div>
        </div>
      </div>

      {isTaskFormOpen && (
        <TaskForm 
          patientId={appointment.patientId}
          appointmentId={appointment.id}
          onClose={() => setIsTaskFormOpen(false)}
          onSuccess={() => {
            setIsTaskFormOpen(false);
            fetchDetail();
          }}
        />
      )}

      {isTreatmentFormOpen && (
        <TreatmentCaseForm 
          patientId={appointment.patientId}
          practitionerId={appointment.practitionerId}
          onClose={() => setIsTreatmentFormOpen(false)}
          onSuccess={() => {
            setIsTreatmentFormOpen(false);
            fetchDetail();
          }}
        />
      )}

      {isMessageModalOpen && (
        <PrepareMessageModal 
          patientId={appointment.patientId}
          clinicId={appointment.clinicId}
          appointmentId={appointment.id}
          onClose={() => setIsMessageModalOpen(false)}
          onSuccess={() => {
            setIsMessageModalOpen(false);
            fetchDetail();
          }}
        />
      )}
    </div>
  );
};

export default AppointmentDetail;
