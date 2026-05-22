import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { 
  ArrowLeft, 
  Mail, 
  Phone, 
  Calendar, 
  Edit2, 
  Archive, 
  Clock, 
  MapPin, 
  User as UserIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Plus,
  ClipboardList,
  MessageSquare,
  Briefcase,
  ShieldCheck,
  Paperclip,
  Download,
  Trash2,
  FileText,
  Image,
  TrendingUp,
  Activity,
  Layers,
  AlertTriangle
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { patientService, taskService, treatmentCaseService, paymentService, paymentPlanService, insuranceProvisionService, attachmentService } from '../services/api';
import DentalChart from '../components/DentalChart';
import PatientForm from '../components/PatientForm';
import TaskForm from '../components/TaskForm';
import TreatmentCaseForm from '../components/TreatmentCaseForm';
import PaymentForm from '../components/PaymentForm';
import PrepareMessageModal from '../components/PrepareMessageModal';
import InsuranceProvisionForm from '../components/InsuranceProvisionForm';
import { formatDateInTimeZone, formatTimeInTimeZone } from '../utils/dateTime';
import { normalizeRole } from '../utils/permissions';

const PatientDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(['patients', 'tasks', 'common', 'messages', 'insurance', 'payments', 'treatmentCases']);
  const { user } = useAuth();
  const userCanonicalRole = normalizeRole(user?.role ?? '', user?.canAccessAllClinics ?? false);
  const clinicTimeZone = user?.clinic?.timezone || 'Europe/Paris';
  const [patient, setPatient] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isTaskFormOpen, setIsTaskFormOpen] = useState(false);
  const [isTreatmentFormOpen, setIsTreatmentFormOpen] = useState(false);
  const [isPaymentFormOpen, setIsPaymentFormOpen] = useState(false);
  const [isInsuranceFormOpen, setIsInsuranceFormOpen] = useState(false);
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'appointments' | 'tasks' | 'treatments' | 'payments' | 'insurance' | 'whatsapp' | 'activity' | 'files' | 'dental'>('overview');
  const [attachments, setAttachments] = useState<any[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [whatsappSearch, setWhatsappSearch] = useState('');
  const [whatsappDirection, setWhatsappDirection] = useState<'all' | 'incoming' | 'outgoing'>('all');
  const [tasks, setTasks] = useState<any[]>([]);
  const [treatmentCases, setTreatmentCases] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [paymentPlans, setPaymentPlans] = useState<any[]>([]);
  const [insuranceProvisions, setInsuranceProvisions] = useState<any[]>([]);
  const paymentCurrency = payments[0]?.currency || treatmentCases[0]?.currency || 'TRY';

  const fetchPatient = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const response = await patientService.getById(id);
      setPatient(response.data);
      
      const tasksRes = await taskService.getAll({ patientId: id });
      setTasks(tasksRes.data);

      const treatmentsRes = await treatmentCaseService.getAll({ patientId: id });
      setTreatmentCases(treatmentsRes.data);

      const paymentsRes = await paymentService.getAll({ patientId: id });
      setPayments(paymentsRes.data);

      try {
        const plansRes = await paymentPlanService.getAll({ patientId: id });
        setPaymentPlans(plansRes.data || []);
      } catch {
        setPaymentPlans([]);
      }

      const insuranceRes = await insuranceProvisionService.getAll({ patient_id: id });
      setInsuranceProvisions(insuranceRes.data);

      const attachRes = await attachmentService.getAll(id);
      setAttachments(attachRes.data);
    } catch (error: any) {
      console.error('Failed to fetch patient:', error);
      if (error?.response?.status === 404) {
        navigate('/patients');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPatient();
  }, [id]);

  const handleArchive = async () => {
    if (!window.confirm(t('common:confirmAction'))) return;
    try {
      await patientService.archive(id!);
      fetchPatient();
    } catch (error) {
      alert('Failed to archive patient');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="animate-spin text-primary-600" size={48} />
      </div>
    );
  }

  if (!patient) return null;

  // Group WhatsApp messages into conversation sessions (>60 min gap = new session)
  const whatsappSessions: Array<{ startTime: string; endTime: string; count: number; incomingCount: number; outgoingCount: number }> = [];
  const sortedWaMsgs = [...(patient.whatsappConversationMessages || [])].sort(
    (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  let currentSession: { startTime: string; endTime: string; count: number; incomingCount: number; outgoingCount: number } | null = null;
  for (const msg of sortedWaMsgs) {
    const msgTime = new Date(msg.createdAt).getTime();
    if (!currentSession || msgTime - new Date(currentSession.endTime).getTime() > 60 * 60 * 1000) {
      if (currentSession) whatsappSessions.push(currentSession);
      currentSession = { startTime: msg.createdAt, endTime: msg.createdAt, count: 1, incomingCount: msg.direction === 'incoming' ? 1 : 0, outgoingCount: msg.direction === 'outgoing' ? 1 : 0 };
    } else {
      currentSession.endTime = msg.createdAt;
      currentSession.count++;
      if (msg.direction === 'incoming') currentSession.incomingCount++;
      else currentSession.outgoingCount++;
    }
  }
  if (currentSession) whatsappSessions.push(currentSession);

  const timelineItems = [
    ...(patient.activityLogs || []).map((log: any) => ({
      id: `activity-${log.id}`,
      type: 'activity' as const,
      createdAt: log.createdAt,
      payload: log,
    })),
    ...whatsappSessions.map((session, i) => ({
      id: `whatsapp-session-${i}`,
      type: 'whatsapp-session' as const,
      createdAt: session.startTime,
      payload: session,
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const filteredWhatsappMessages = (patient.whatsappConversationMessages || []).filter((message: any) => {
    const matchesDirection = whatsappDirection === 'all' || message.direction === whatsappDirection;
    const normalizedSearch = whatsappSearch.trim().toLocaleLowerCase('tr-TR');
    const matchesSearch = !normalizedSearch || message.text.toLocaleLowerCase('tr-TR').includes(normalizedSearch);
    return matchesDirection && matchesSearch;
  });

  const getActivityActorLabel = (log: any) => {
    try {
      const metadata = log.metadataJson ? JSON.parse(log.metadataJson) : null;
      if (metadata?.systemGenerated) {
        return t('patients:detail.systemActor', { defaultValue: 'System' });
      }
    } catch (error) {
      console.error('Failed to parse activity metadata:', error);
    }

    return `${log.user.firstName} ${log.user.lastName}`;
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <button 
          onClick={() => navigate('/patients')}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft size={20} />
          {t('patients:detail.backToList')}
        </button>
        <div className="flex gap-3">
          <button onClick={handleArchive} className="btn-secondary text-red-600 hover:bg-red-50 hover:border-red-200">
            <Archive size={18} />
            {t('common:archive')}
          </button>
          <button 
            onClick={() => setIsMessageModalOpen(true)}
            className="btn-secondary"
          >
            <MessageSquare size={18} />
            {t('messages:prepare', { defaultValue: 'Prepare Message' })}
          </button>
          <button onClick={() => setIsEditOpen(true)} className="btn-primary">
            <Edit2 size={18} />
            {t('patients:editPatient')}
          </button>
        </div>
      </div>

      <div className="flex gap-6 border-b border-gray-200">
        {(['overview', 'appointments', 'tasks', 'treatments', 'payments', 'insurance', 'whatsapp', 'files', 'dental', 'activity'] as const).map(tab => (
          <button 
            key={tab}
            data-tab={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === tab ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {tab === 'whatsapp' ? t('patients:detail.whatsappTab', { defaultValue: 'WhatsApp' }) : tab === 'files' ? t('patients:detail.filesTab', { defaultValue: 'Dosyalar' }) : tab === 'dental' ? 'Diş Haritası' : t(`common:${tab}`, { defaultValue: tab.charAt(0).toUpperCase() + tab.slice(1) })}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column - Profile Summary */}
        <div className="lg:col-span-1 space-y-6">
          <div className="card p-8 text-center">
            <div className="w-24 h-24 rounded-3xl bg-primary-50 text-primary-600 flex items-center justify-center text-3xl font-bold mx-auto mb-6 border-2 border-primary-100">
              {patient.firstName[0]}{patient.lastName[0]}
            </div>
            <h2 className="text-2xl font-bold text-gray-900">{patient.firstName} {patient.lastName}</h2>
            <div className="mt-2">
              <span className={`badge ${
                patient.patientStatus === 'active' ? 'badge-green' : 
                patient.patientStatus === 'new' ? 'badge-blue' : 'badge-gray'
              }`}>
                {t(`patients:status.${patient.patientStatus}`)}
              </span>
            </div>
            
            <div className="mt-8 space-y-4 text-left border-t border-gray-50 pt-8">
              <div className="flex items-center gap-3 text-gray-600">
                <Mail size={18} className="text-gray-400" />
                <span className="text-sm truncate">{patient.email || t('common:noData')}</span>
              </div>
              <div className="flex items-center gap-3 text-gray-600">
                <Phone size={18} className="text-gray-400" />
                <span className="text-sm">{patient.phone || t('common:noData')}</span>
              </div>
              <div className="flex items-center gap-3 text-gray-600">
                <Calendar size={18} className="text-gray-400" />
                <span className="text-sm">{t('patients:form.dob')}: {patient.dateOfBirth ? new Date(patient.dateOfBirth).toLocaleDateString() : t('common:noData')}</span>
              </div>
              <div className="flex items-center gap-3 text-gray-600">
                <MapPin size={18} className="text-gray-400" />
                <span className="text-sm">{patient.address ? `${patient.address}, ${patient.city}` : t('common:noData')}</span>
              </div>
            </div>
          </div>

          <div className="card p-6 space-y-4">
            <h3 className="font-bold text-gray-900">{t('patients:detail.consents')}</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100">
                <span className="text-xs font-semibold text-gray-500 uppercase">{t('patients:form.communicationConsent')}</span>
                {patient.communicationConsent ? (
                  <span className="flex items-center gap-1 text-green-600 text-xs font-bold">
                    <CheckCircle2 size={14} /> {t('common:yes')}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-gray-400 text-xs font-bold">
                    <AlertCircle size={14} /> {t('common:no')}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100">
                <span className="text-xs font-semibold text-gray-500 uppercase">{t('patients:form.marketingConsent')}</span>
                {patient.marketingConsent ? (
                  <span className="flex items-center gap-1 text-green-600 text-xs font-bold">
                    <CheckCircle2 size={14} /> {t('common:yes')}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-gray-400 text-xs font-bold">
                    <AlertCircle size={14} /> {t('common:no')}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Clinical Alerts — overview tab only */}
          {activeTab === 'overview' && (
            <div className={`card p-5 ${patient.notes ? 'border-amber-200 bg-amber-50' : ''}`}>
              <h3 className="font-bold flex items-center gap-2 mb-3">
                <AlertTriangle size={17} className={patient.notes ? 'text-amber-500' : 'text-gray-400'} />
                {t('patients:detail.overview.clinicalAlerts')}
              </h3>
              {patient.notes ? (
                <p className="text-sm text-amber-800 bg-white rounded-xl border border-amber-200 p-3 whitespace-pre-line">{patient.notes}</p>
              ) : (
                <p className="text-sm text-gray-400 italic">{t('patients:detail.overview.noClinicalAlerts')}</p>
              )}
            </div>
          )}

          {/* Financial Summary — overview tab only */}
          {activeTab === 'overview' && (
            <div className="card p-5">
              <h3 className="font-bold flex items-center gap-2 mb-3">
                <TrendingUp size={17} className="text-primary-500" />
                {t('patients:detail.overview.financialSummary')}
              </h3>
              {(() => {
                const totalTreatment = treatmentCases.reduce((sum: number, tc: any) => sum + (tc.acceptedAmount ?? tc.estimatedAmount ?? 0), 0);
                const totalPaid = payments.filter((p: any) => p.paymentStatus === 'paid').reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
                const remaining = Math.max(0, totalTreatment - totalPaid);
                const lastPmt = payments.find((p: any) => p.paymentStatus === 'paid');
                const currency = paymentCurrency;
                const fmt = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 0 }) + ' ' + currency;
                if (totalTreatment === 0 && payments.length === 0) {
                  return <p className="text-sm text-gray-400 italic">{t('patients:detail.overview.noPayments')}</p>;
                }
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">{t('patients:detail.overview.totalTreatment')}</span>
                      <span className="font-semibold">{fmt(totalTreatment)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">{t('patients:detail.overview.totalPaid')}</span>
                      <span className="font-semibold text-green-600">{fmt(totalPaid)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm border-t border-gray-100 pt-2">
                      <span className="text-gray-500 font-medium">{t('patients:detail.overview.remaining')}</span>
                      <span className={`font-bold ${remaining > 0 ? 'text-amber-600' : 'text-green-600'}`}>{fmt(remaining)}</span>
                    </div>
                    {lastPmt && (
                      <p className="text-xs text-gray-400 pt-1">{t('patients:detail.overview.lastPayment')}: {new Date(lastPmt.paidAt || lastPmt.createdAt).toLocaleDateString('tr-TR')}</p>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Right Column */}
        <div className="lg:col-span-2 space-y-8">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Upcoming Appointments */}
              <div className="card overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-gray-100">
                  <h3 className="font-bold flex items-center gap-2">
                    <Calendar size={17} className="text-primary-500" />
                    {t('patients:detail.overview.upcomingAppointments')}
                  </h3>
                  <button onClick={() => setActiveTab('appointments')} className="text-xs text-primary-600 hover:underline">
                    {t('patients:detail.overview.viewAllAppointments')}
                  </button>
                </div>
                {(() => {
                  const now = new Date();
                  const upcomingAppts = (patient.appointments ?? [])
                    .filter((a: any) => new Date(a.startTime) > now && a.status !== 'cancelled')
                    .sort((a: any, b: any) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                    .slice(0, 5);
                  if (upcomingAppts.length === 0) {
                    return <p className="p-4 text-sm text-gray-400 italic">{t('patients:detail.overview.noUpcomingAppointments')}</p>;
                  }
                  return (
                    <div className="divide-y divide-gray-50">
                      {upcomingAppts.map((appt: any, idx: number) => (
                        <div
                          key={appt.id}
                          onClick={() => navigate(`/appointments/${appt.id}`)}
                          className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 transition-colors ${idx === 0 ? 'bg-primary-50' : ''}`}
                        >
                          <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex flex-col items-center justify-center text-center ${idx === 0 ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                            <span className="text-[10px] leading-none font-bold uppercase">
                              {formatDateInTimeZone(appt.startTime, undefined, clinicTimeZone, { month: 'short' })}
                            </span>
                            <span className="text-lg leading-none font-extrabold">
                              {formatDateInTimeZone(appt.startTime, undefined, clinicTimeZone, { day: 'numeric' })}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate">{appt.appointmentType?.name}</p>
                            <p className="text-xs text-gray-500">
                              {formatTimeInTimeZone(appt.startTime, undefined, clinicTimeZone)} &middot; {appt.practitioner ? `${appt.practitioner.firstName} ${appt.practitioner.lastName}` : t('patients:detail.overview.unassigned')}
                            </p>
                          </div>
                          <span className={`badge text-xs flex-shrink-0 ${appt.status === 'completed' ? 'badge-green' : appt.status === 'confirmed' ? 'badge-blue' : 'badge-yellow'}`}>
                            {t(`appointments:status.${appt.status}`, { defaultValue: appt.status })}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Active Treatment Plans */}
              <div className="card overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-gray-100">
                  <h3 className="font-bold flex items-center gap-2">
                    <Layers size={17} className="text-purple-500" />
                    {t('patients:detail.overview.activeTreatments')}
                  </h3>
                  <button onClick={() => setActiveTab('treatments')} className="text-xs text-primary-600 hover:underline">
                    {t('patients:detail.overview.viewAllTreatments')}
                  </button>
                </div>
                {(() => {
                  const CLOSED_STAGES = ['completed', 'lost', 'cancelled'];
                  const active = treatmentCases.filter((tc: any) => !CLOSED_STAGES.includes(tc.stage));
                  if (active.length === 0) {
                    return <p className="p-4 text-sm text-gray-400 italic">{t('patients:detail.overview.noActiveTreatments')}</p>;
                  }
                  return (
                    <div className="divide-y divide-gray-50">
                      {active.slice(0, 4).map((tc: any) => {
                        const procs = tc.treatmentPlanProcedures || [];
                        const total = procs.length;
                        const completed = procs.filter((p: any) => p.status === 'completed').length;
                        const pct = total > 0 ? Math.round((completed / total) * 100) : null;
                        return (
                          <div key={tc.id} className="p-3 hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => navigate(`/treatment-cases/${tc.id}`)}>
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-sm font-semibold text-gray-900 truncate">{tc.title}</p>
                              <span className="badge badge-blue text-xs ml-2 flex-shrink-0">
                                {t(`treatmentCases:stages.${tc.stage}`, { defaultValue: tc.stage })}
                              </span>
                            </div>
                            <p className="text-xs text-gray-400">
                              {tc.practitioner ? `${tc.practitioner.firstName} ${tc.practitioner.lastName}` : t('patients:detail.overview.unassigned')}
                            </p>
                            {pct !== null && (
                              <div className="mt-2">
                                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                                  <span>{t('patients:detail.overview.procedures', { completed, total })}</span>
                                  <span>{pct}%</span>
                                </div>
                                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-primary-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* Dental Chart Summary */}
              <div className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold flex items-center gap-2">
                    <span className="text-base">🦷</span>
                    {t('patients:detail.overview.dentalSummary')}
                  </h3>
                  <button onClick={() => setActiveTab('dental')} className="text-xs text-primary-600 hover:underline">
                    {t('patients:detail.overview.openDentalChart')}
                  </button>
                </div>
                {(() => {
                  const records = patient.toothRecords || [];
                  if (records.length === 0) {
                    return <p className="text-sm text-gray-400 italic">{t('patients:detail.overview.noDentalData')}</p>;
                  }
                  const issues = records.filter((r: any) => r.status === 'issue').length;
                  const missing = records.filter((r: any) => r.status === 'missing').length;
                  const implants = records.filter((r: any) => r.status === 'implant').length;
                  const crowns = records.filter((r: any) => r.status === 'crown').length;
                  const stats = [
                    { key: 'issues', label: t('patients:detail.overview.problemTeeth'), value: issues, color: 'text-red-600 bg-red-50' },
                    { key: 'missing', label: t('patients:detail.overview.missingTeeth'), value: missing, color: 'text-gray-600 bg-gray-100' },
                    { key: 'implants', label: t('patients:detail.overview.implants'), value: implants, color: 'text-blue-600 bg-blue-50' },
                    { key: 'crowns', label: t('patients:detail.overview.crowns'), value: crowns, color: 'text-amber-600 bg-amber-50' },
                  ];
                  return (
                    <div className="grid grid-cols-4 gap-2">
                      {stats.map(s => (
                        <div key={s.key} className={`rounded-xl p-2 text-center ${s.color}`}>
                          <p className="text-2xl font-extrabold">{s.value}</p>
                          <p className="text-xs mt-0.5">{s.label}</p>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Recent Activity */}
              <div className="card overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-gray-100">
                  <h3 className="font-bold flex items-center gap-2">
                    <Activity size={17} className="text-gray-500" />
                    {t('patients:detail.overview.recentActivity')}
                  </h3>
                  <button onClick={() => setActiveTab('activity')} className="text-xs text-primary-600 hover:underline">
                    {t('patients:detail.overview.viewAllActivity')}
                  </button>
                </div>
                {timelineItems.length === 0 ? (
                  <p className="p-4 text-sm text-gray-400 italic">{t('patients:detail.overview.noRecentActivity')}</p>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {timelineItems.slice(0, 5).map((item: any) => (
                      <div key={item.id} className="flex items-start gap-3 p-3">
                        <div className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white ${item.type === 'whatsapp-session' ? 'bg-emerald-500' : item.payload?.action === 'created' ? 'bg-green-500' : item.payload?.action === 'completed' ? 'bg-green-600' : 'bg-blue-500'}`}>
                          {item.type === 'whatsapp-session' ? <MessageSquare size={11} /> : item.payload?.action === 'completed' ? <CheckCircle2 size={11} /> : <Edit2 size={11} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-700 line-clamp-2">
                            {item.type === 'whatsapp-session'
                              ? `WhatsApp: ${item.payload.count} mesaj (${item.payload.incomingCount} gelen · ${item.payload.outgoingCount} giden)`
                              : item.payload?.description}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {new Date(item.createdAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'appointments' && (
            <div className="card overflow-hidden">
              <div className="p-6 border-b border-gray-100">
                <h3 className="font-bold">{t('patients:detail.history')}</h3>
              </div>
              <div className="divide-y divide-gray-50">
                {patient.appointments?.length > 0 ? patient.appointments.map((appt: any) => (
                  <div key={appt.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => navigate(`/appointments/${appt.id}`)}>                  
                    <div className="flex items-center gap-4">
                      <div className="p-2 bg-gray-100 rounded-lg text-gray-500">
                        <Clock size={18} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">{appt.appointmentType.name}</p>
                        <p className="text-xs text-gray-500">with {appt.practitioner.firstName} {appt.practitioner.lastName}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-700">{formatDateInTimeZone(appt.startTime, undefined, clinicTimeZone)}</p>
                      <span className={`badge ${
                        appt.status === 'completed' ? 'badge-green' : 'badge-blue'
                      }`}>
                        {t(`appointments:status.${appt.status}`)}
                      </span>
                    </div>
                  </div>
                )) : (
                  <div className="p-8 text-center text-gray-400 italic">{t('common:noData')}</div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">{t('tasks:title')}</h3>
                <button 
                  onClick={() => setIsTaskFormOpen(true)}
                  className="btn-primary py-1.5 text-xs"
                >
                  <Plus size={16} />
                  {t('tasks:newTask')}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {tasks.length > 0 ? tasks.map(task => (
                  <div key={task.id} className={`card p-4 flex items-center gap-4 ${task.status === 'completed' ? 'opacity-60 bg-gray-50' : ''}`}>
                     <div className={`w-2 h-2 rounded-full ${
                       task.priority === 'urgent' ? 'bg-red-500' : 
                       task.priority === 'high' ? 'bg-orange-500' : 'bg-blue-500'
                     }`}></div>
                     <div className="flex-1">
                       <p className={`font-semibold ${task.status === 'completed' ? 'line-through' : ''}`}>{task.title}</p>
                       <p className="text-xs text-gray-500">{t('tasks:form.dueDate')}: {new Date(task.dueDate).toLocaleDateString()}</p>
                     </div>
                     <span className={`badge ${task.status === 'completed' ? 'badge-green' : 'badge-yellow'}`}>
                       {t(`tasks:status.${task.status}`)}
                     </span>
                  </div>
                )) : (
                  <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-xl border-2 border-dashed">
                    {t('common:noData')}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'treatments' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">{t('treatmentCases:title')}</h3>
                <button 
                  onClick={() => setIsTreatmentFormOpen(true)}
                  className="btn-primary py-1.5 text-xs"
                >
                  <Plus size={16} />
                  {t('treatmentCases:newCase')}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-4">
                {treatmentCases.length > 0 ? treatmentCases.map(tc => (
                  <Link 
                    key={tc.id} 
                    to={`/treatment-cases/${tc.id}`}
                    className="card p-4 flex items-center justify-between hover:border-primary-300 transition-all group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-primary-50 text-primary-600 rounded-2xl group-hover:bg-primary-600 group-hover:text-white transition-colors">
                        <Briefcase size={20} />
                      </div>
                      <div>
                        <p className="font-bold text-gray-900">{tc.title}</p>
                        <p className="text-xs text-gray-500">{t(`treatmentCases:stages.${tc.stage}`)}</p>
                        <p className="text-xs text-primary-600 font-medium mt-0.5">
                          Tedavi planı prosedürleri için tıkla → Vaka Detayı
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-gray-900">{tc.acceptedAmount || tc.estimatedAmount} {tc.currency}</p>
                      <p className="text-[10px] text-gray-400 uppercase font-bold">
                        {tc.acceptedAmount ? t('treatmentCases:list.accepted') : t('treatmentCases:list.estimated')}
                      </p>
                    </div>
                  </Link>
                )) : (
                  <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-xl border-2 border-dashed">
                    <p>{t('common:noData')}</p>
                    <p className="text-xs mt-1">Tedavi planı eklemek için önce "Yeni Vaka" oluşturun</p>
                  </div>
                )}
              </div>
              {treatmentCases.length > 0 && (
                <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
                  <strong>Tedavi Planı Prosedürü Eklemek İçin:</strong> Yukarıdaki vakalardan birine tıklayın → Açılan sayfada "Tedavi Planı Prosedürleri" bölümündeki <strong>+</strong> butonuna tıklayın.
                </div>
              )}
            </div>
          )}

          {activeTab === 'payments' && (
            <div className="space-y-6">
              {/* Summary cards */}
              {(() => {
                const paidTotal = payments.filter(p => p.paymentStatus === 'paid').reduce((a, p) => a + p.amount, 0);
                const pendingPayments = payments.filter(p => p.paymentStatus === 'pending').reduce((a, p) => a + p.amount, 0);
                const unpaidInstallments = paymentPlans
                  .flatMap((plan: any) => plan.installments || [])
                  .filter((inst: any) => inst.status !== 'paid' && inst.status !== 'cancelled')
                  .reduce((a: number, inst: any) => a + inst.amount, 0);
                const pendingTreatments = treatmentCases
                  .filter((tc: any) => tc.stage !== 'cancelled')
                  .reduce((a: number, tc: any) => {
                    const amount = tc.acceptedAmount ?? tc.estimatedAmount ?? 0;
                    const paid = payments.filter(p => p.treatmentCaseId === tc.id && p.paymentStatus === 'paid').reduce((s: number, p: any) => s + p.amount, 0);
                    return a + Math.max(0, amount - paid);
                  }, 0);
                const totalPending = pendingPayments + unpaidInstallments + pendingTreatments;
                const refundedTotal = payments.filter(p => p.paymentStatus === 'refunded').reduce((a, p) => a + p.amount, 0);
                return (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="card p-4 bg-green-50 border-green-100">
                      <p className="text-[10px] font-bold text-green-600 uppercase mb-1">{t('payments:summary.totalPaid')}</p>
                      <p className="text-xl font-bold text-green-700">{paidTotal.toLocaleString()} {paymentCurrency}</p>
                    </div>
                    <div className="card p-4 bg-amber-50 border-amber-100">
                      <p className="text-[10px] font-bold text-amber-600 uppercase mb-1">{t('payments:summary.totalPending')}</p>
                      <p className="text-xl font-bold text-amber-700">{totalPending.toLocaleString()} {paymentCurrency}</p>
                      {unpaidInstallments > 0 && (
                        <p className="text-[10px] text-amber-500 mt-1">• {unpaidInstallments.toLocaleString()} taksit + {pendingPayments.toLocaleString()} ödeme bekleyen</p>
                      )}
                    </div>
                    <div className="card p-4 bg-red-50 border-red-100">
                      <p className="text-[10px] font-bold text-red-600 uppercase mb-1">{t('payments:summary.totalRefunded')}</p>
                      <p className="text-xl font-bold text-red-700">{refundedTotal.toLocaleString()} {paymentCurrency}</p>
                    </div>
                  </div>
                );
              })()}

              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">{t('payments:title')}</h3>
                <button 
                  onClick={() => setIsPaymentFormOpen(true)}
                  className="btn-primary py-1.5 text-xs"
                >
                  <Plus size={16} />
                  {t('payments:addPayment')}
                </button>
              </div>

              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="p-3 font-bold text-gray-500">{t('payments:list.amount')}</th>
                        <th className="p-3 font-bold text-gray-500">{t('payments:list.method')}</th>
                        <th className="p-3 font-bold text-gray-500">{t('payments:list.status')}</th>
                        <th className="p-3 font-bold text-gray-500">{t('payments:list.date')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {payments.length > 0 ? payments.map(p => (
                        <tr key={p.id}>
                          <td className="p-3 font-bold">{p.amount.toLocaleString()} {p.currency}</td>
                          <td className="p-3 text-gray-600 capitalize">{p.paymentMethod.replace('_', ' ')}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${
                              p.paymentStatus === 'paid' ? 'bg-green-50 text-green-700 border-green-100' :
                              p.paymentStatus === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-gray-50 text-gray-700'
                            }`}>
                              {t(`payments:status.${p.paymentStatus}`)}
                            </span>
                          </td>
                          <td className="p-3 text-gray-500">{new Date(p.paidAt).toLocaleDateString()}</td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={4} className="p-8 text-center text-gray-400 italic">{t('payments:empty')}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Payment Plans / Installment Schedule */}
              {paymentPlans.length > 0 && (
                <div className="space-y-4">
                  <h3 className="font-bold text-lg">Taksit Planları &amp; Ödeme Takvimi</h3>
                  {paymentPlans.map((plan: any) => {
                    const unpaid = (plan.installments || []).filter((i: any) => i.status !== 'paid' && i.status !== 'cancelled');
                    const paidAmount = (plan.installments || []).filter((i: any) => i.status === 'paid').reduce((a: number, i: any) => a + i.amount, 0);
                    const progress = plan.totalAmount > 0 ? Math.round((paidAmount / plan.totalAmount) * 100) : 0;
                    return (
                      <div key={plan.id} className="card p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="font-semibold text-gray-900 dark:text-white">{plan.description || 'Taksit Planı'}</p>
                            <p className="text-xs text-gray-500">{plan.installments?.length || 0} taksit • Toplam: {plan.totalAmount?.toLocaleString()} {plan.currency || paymentCurrency}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-green-600 font-bold">Ödenen: {paidAmount.toLocaleString()}</p>
                            <p className="text-xs text-amber-600 font-bold">Kalan: {(plan.totalAmount - paidAmount).toLocaleString()}</p>
                          </div>
                        </div>
                        {/* Progress bar */}
                        <div className="w-full bg-gray-100 rounded-full h-1.5 mb-3">
                          <div className="bg-green-500 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
                        </div>
                        {unpaid.length > 0 && (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-gray-400 text-xs">
                                <th className="text-left py-1 pr-3">Taksit No</th>
                                <th className="text-left py-1 pr-3">Vade Tarihi</th>
                                <th className="text-right py-1 pr-3">Tutar</th>
                                <th className="text-right py-1">Durum</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(plan.installments || []).map((inst: any) => {
                                const isOverdue = inst.status !== 'paid' && inst.status !== 'cancelled' && new Date(inst.dueDate) < new Date();
                                return (
                                  <tr key={inst.id} className="border-t border-gray-50">
                                    <td className="py-1.5 pr-3 text-gray-500 text-xs">{inst.installmentNo}. Taksit</td>
                                    <td className="py-1.5 pr-3 text-gray-700">{new Date(inst.dueDate).toLocaleDateString('tr-TR')}</td>
                                    <td className="py-1.5 pr-3 text-right font-medium">{inst.amount.toLocaleString()} {plan.currency || paymentCurrency}</td>
                                    <td className="py-1.5 text-right">
                                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                        inst.status === 'paid' ? 'bg-green-50 text-green-700' :
                                        inst.status === 'cancelled' ? 'bg-gray-100 text-gray-500' :
                                        isOverdue ? 'bg-red-50 text-red-700' :
                                        'bg-amber-50 text-amber-700'
                                      }`}>
                                        {inst.status === 'paid' ? 'Ödendi' :
                                         inst.status === 'cancelled' ? 'İptal' :
                                         isOverdue ? 'Gecikmiş' : 'Bekliyor'}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {activeTab === 'insurance' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">{t('insurance:title', { defaultValue: 'Insurance / Provisions' })}</h3>
                <button onClick={() => setIsInsuranceFormOpen(true)} className="btn-primary py-1.5 text-xs">
                  <Plus size={16} />
                  {t('insurance:newProvision', { defaultValue: 'New Provision Request' })}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-4">
                {insuranceProvisions.length > 0 ? insuranceProvisions.map(provision => (
                  <Link key={provision.id} to={`/insurance-provisions/${provision.id}`} className="card p-4 flex items-center justify-between hover:border-primary-300 transition-all">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-primary-50 text-primary-600 rounded-2xl">
                        <ShieldCheck size={20} />
                      </div>
                      <div>
                        <p className="font-bold text-gray-900">{provision.insuranceProviderName}</p>
                        <p className="text-xs text-gray-500">{t(`insurance:types.${provision.insuranceType}`, { defaultValue: provision.insuranceType })} • {provision.treatmentCase?.title || '-'}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="badge badge-blue">{t(`insurance:statuses.${provision.status}`, { defaultValue: provision.status })}</span>
                      <p className="text-xs text-gray-500 mt-2">{provision.requestedAmount?.toLocaleString()} {provision.currency}</p>
                    </div>
                  </Link>
                )) : (
                  <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-xl border-2 border-dashed">{t('common:noData')}</div>
                )}
              </div>
            </div>
          )}
          {activeTab === 'whatsapp' && (
            <div className="space-y-4">
              <div className="card p-6 space-y-4">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="font-bold text-lg">{t('patients:detail.whatsappTab', { defaultValue: 'WhatsApp' })}</h3>
                    <p className="text-sm text-gray-500">{patient.whatsappConversationMessages?.length || 0} mesaj kaydı</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(['all', 'incoming', 'outgoing'] as const).map(direction => (
                      <button
                        key={direction}
                        onClick={() => setWhatsappDirection(direction)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${whatsappDirection === direction ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300'}`}
                      >
                        {direction === 'all'
                          ? t('patients:detail.whatsappFilterAll', { defaultValue: 'All' })
                          : direction === 'incoming'
                            ? t('patients:detail.whatsappFilterIncoming', { defaultValue: 'Incoming' })
                            : t('patients:detail.whatsappFilterOutgoing', { defaultValue: 'Outgoing' })}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <input
                    type="text"
                    value={whatsappSearch}
                    onChange={(event) => setWhatsappSearch(event.target.value)}
                    placeholder={t('patients:detail.whatsappSearchPlaceholder', { defaultValue: 'Search WhatsApp messages...' })}
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm outline-none transition focus:border-primary-400"
                  />
                </div>
              </div>

              <div className="space-y-3">
                {filteredWhatsappMessages.length > 0 ? filteredWhatsappMessages.map((message: any) => (
                  <div key={message.id} className={`card p-5 border ${message.direction === 'incoming' ? 'border-emerald-100 bg-emerald-50/60' : 'border-sky-100 bg-sky-50/60'}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          {message.direction === 'incoming' ? t('patients:detail.whatsappIncoming', { defaultValue: 'WhatsApp Incoming' }) : t('patients:detail.whatsappOutgoing', { defaultValue: 'WhatsApp Outgoing' })}
                        </p>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-900">{message.text}</p>
                      </div>
                      <span className="text-xs text-gray-500 whitespace-nowrap">{new Date(message.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                )) : (
                  <div className="card p-8 text-center text-gray-400 italic">{t('patients:detail.whatsappNoMessages', { defaultValue: 'No WhatsApp messages found for this filter.' })}</div>
                )}
              </div>
            </div>
          )}
        {/* Activity Tab */}
        {activeTab === 'files' && (
          <div className="card p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold flex items-center gap-2"><Paperclip size={18} /> Dosyalar</h3>
              {(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST', 'DENTIST'] as const).includes(userCanonicalRole as any) && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file || !id) return;
                      setUploadingFile(true);
                      try {
                        const fd = new FormData();
                        fd.append('file', file);
                        await attachmentService.upload(id, fd);
                        const res = await attachmentService.getAll(id);
                        setAttachments(res.data);
                      } catch {
                        alert('Dosya yüklenemedi');
                      } finally {
                        setUploadingFile(false);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }
                    }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingFile}
                    className="btn-primary flex items-center gap-2 text-sm"
                  >
                    {uploadingFile ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                    {uploadingFile ? 'Yükleniyor...' : 'Dosya Ekle'}
                  </button>
                </>
              )}
            </div>
            {attachmentsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary-500" /></div>
            ) : attachments.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <Paperclip size={36} className="mx-auto mb-2 opacity-30" />
                <p>Henüz dosya eklenmemiş</p>
              </div>
            ) : (
              <div className="divide-y">
                {attachments.map((att: any) => (
                  <div key={att.id} className="flex items-center gap-4 py-3">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500">
                      {att.mimeType.startsWith('image/') ? <Image size={20} /> : <FileText size={20} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{att.originalName}</p>
                      <p className="text-xs text-gray-400">
                        {(att.fileSize / 1024).toFixed(1)} KB • {new Date(att.createdAt).toLocaleDateString('tr-TR')} • {att.uploadedBy?.firstName} {att.uploadedBy?.lastName}
                      </p>
                    </div>
                    <button
                      onClick={() => attachmentService.download(id!, att.id, att.originalName)}
                      className="p-2 text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded-lg"
                      title="İndir"
                    >
                      <Download size={16} />
                    </button>
                    {(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST'] as const).includes(userCanonicalRole as any) && (
                      <button
                        onClick={async () => {
                          if (!id || !confirm('Bu dosyayı silmek istediğinizden emin misiniz?')) return;
                          await attachmentService.delete(id, att.id);
                          setAttachments(prev => prev.filter(a => a.id !== att.id));
                        }}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Sil"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {/* Dental Chart Tab */}
        {activeTab === 'dental' && (
          <div className="card p-6">
            <h3 className="font-bold flex items-center gap-2 mb-6">
              <span>🦷</span> Diş Haritası
            </h3>
            <DentalChart patientId={id!} />
          </div>
        )}
        {activeTab === 'activity' && (
          <div className="card p-6">
            <h3 className="font-bold mb-6">{t('patients:detail.activityTimeline')}</h3>
            <div className="space-y-8 relative before:absolute before:left-4 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-100">
              {timelineItems.length > 0 ? timelineItems.map((item: any) => item.type === 'activity' ? (
                <div key={item.id} className="relative pl-10">
                  <div className={`absolute left-0 top-1 w-8 h-8 rounded-full border-4 border-white flex items-center justify-center ${
                    item.payload.action === 'created' ? 'bg-green-500 text-white' : 
                    item.payload.action === 'updated' ? 'bg-blue-500 text-white' : 
                    item.payload.action === 'completed' ? 'bg-green-600 text-white' : 'bg-gray-400 text-white'
                  }`}>
                    {item.payload.action === 'created' ? <Plus size={14} /> : item.payload.action === 'completed' ? <CheckCircle2 size={14} /> : <Edit2 size={14} />}
                  </div>
                  <div>
                    <p className="text-sm text-gray-900 font-medium">{item.payload.description}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      by {getActivityActorLabel(item.payload)} • {new Date(item.payload.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              ) : (
                <div key={item.id} className="relative pl-10">
                  <div className="absolute left-0 top-1 w-8 h-8 rounded-full border-4 border-white flex items-center justify-center bg-emerald-500 text-white">
                    <MessageSquare size={14} />
                  </div>
                  <div className="rounded-xl border px-4 py-3 bg-emerald-50 border-emerald-100">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">WhatsApp Görüşmesi</p>
                    <p className="text-sm text-gray-700 mt-1">
                      {item.payload.incomingCount} gelen · {item.payload.outgoingCount} giden
                      <span className="text-gray-400"> ({item.payload.count} mesaj)</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(item.payload.startTime).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}
                      {item.payload.startTime !== item.payload.endTime
                        ? ` — ${new Date(item.payload.endTime).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`
                        : ''}
                    </p>
                  </div>
                </div>
              )) : (
                <div className="text-center text-gray-400 italic">{t('common:noData')}</div>
              )}
            </div>
          </div>
        )}
        </div>
      </div>

      {isEditOpen && (
        <PatientForm 
          patient={patient}
          onClose={() => setIsEditOpen(false)}
          onSuccess={() => {
            setIsEditOpen(false);
            fetchPatient();
          }}
        />
      )}
      {isTaskFormOpen && (
        <TaskForm 
          patientId={id}
          onClose={() => setIsTaskFormOpen(false)}
          onSuccess={() => {
            setIsTaskFormOpen(false);
            fetchPatient();
          }}
        />
      )}
      {isTreatmentFormOpen && (
        <TreatmentCaseForm 
          patientId={id}
          onClose={() => setIsTreatmentFormOpen(false)}
          onSuccess={() => {
            setIsTreatmentFormOpen(false);
            fetchPatient();
          }}
        />
      )}
      {isPaymentFormOpen && (
        <PaymentForm 
          patientId={id}
          onClose={() => setIsPaymentFormOpen(false)}
          onSuccess={() => {
            setIsPaymentFormOpen(false);
            fetchPatient();
          }}
        />
      )}
      {isInsuranceFormOpen && (
        <InsuranceProvisionForm
          patientId={id}
          onClose={() => setIsInsuranceFormOpen(false)}
          onSuccess={() => {
            setIsInsuranceFormOpen(false);
            fetchPatient();
          }}
        />
      )}

      {isMessageModalOpen && (
        <PrepareMessageModal 
          patientId={id!}
          onClose={() => setIsMessageModalOpen(false)}
          onSuccess={() => {
            setIsMessageModalOpen(false);
            fetchPatient();
          }}
        />
      )}
    </div>
  );
};

export default PatientDetail;
