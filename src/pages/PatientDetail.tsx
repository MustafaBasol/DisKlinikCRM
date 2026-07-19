import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link, Navigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Mail, 
  Phone, 
  Calendar, 
  Edit2,
  Archive,
  ArchiveRestore,
  Clock,
  MapPin, 
  User as UserIcon,
  CheckCircle2,
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
  AlertTriangle,
  Eye,
  ExternalLink,
  Lock,
  LockOpen
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import { patientService, taskService, treatmentCaseService, paymentService, paymentPlanService, insuranceProvisionService, attachmentService } from '../services/api';
import api from '../services/api';
import DentalChart from '../components/DentalChart';
import PatientPrivacyPanel from '../components/PatientPrivacyPanel';
import CommunicationPreferencesPanel from '../components/CommunicationPreferencesPanel';
import PatientForm from '../components/PatientForm';
import TaskForm from '../components/TaskForm';
import TreatmentCaseForm from '../components/TreatmentCaseForm';
import PaymentForm from '../components/PaymentForm';
import PrepareMessageModal from '../components/PrepareMessageModal';
import InsuranceProvisionForm from '../components/InsuranceProvisionForm';
import FilePreviewModal, { isInlinePreviewable } from '../components/FilePreviewModal';
import PatientImagingTab from '../components/imaging/PatientImagingTab';
import PatientDetailTabs, { type PatientDetailTabItem } from '../components/PatientDetailTabs';
import {
  computeVisiblePatientDetailTabs,
  resolvePatientDetailActiveTab,
  requiresUrlNormalization,
  DEFAULT_PATIENT_DETAIL_TAB,
  type PatientDetailTab,
} from './patientDetailTabsHelpers';
import { normalizeRole, canViewPatients, canViewImaging, canManageLegalHold } from '../utils/permissions';

const PatientDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(['patients', 'tasks', 'common', 'messages', 'insurance', 'payments', 'treatmentCases', 'appointments', 'postTreatment', 'imaging']);
  const { user } = useAuth();
  const { defaultCurrency, locale, timezone, formatCurrency, formatNumber, formatDate, formatTime, formatDateTime } = useClinicPreferences();
  const userCanonicalRole = normalizeRole(user?.role ?? '', user?.canAccessAllClinics ?? false);
  const [patient, setPatient] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isTaskFormOpen, setIsTaskFormOpen] = useState(false);
  const [isTreatmentFormOpen, setIsTreatmentFormOpen] = useState(false);
  const [isPaymentFormOpen, setIsPaymentFormOpen] = useState(false);
  const [isInsuranceFormOpen, setIsInsuranceFormOpen] = useState(false);
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  // Klinik görüntüler tıbbi kayıttır: BILLING ve ASSISTANT sekmeyi hiç görmez
  // (server/src/routes/imaging.ts IMAGING_CLINICAL_ROLES ile senkron).
  const canSeeImaging = canViewImaging(user);

  // KVKK-HIGH-008 F-2: the URL is the single source of truth for the active
  // tab — there is no separate `activeTab` state. This is what lets a direct
  // link/refresh land on a right-side tab (e.g. "communication") instead of
  // always resetting to Overview, while still requiring exactly one writer
  // (goToTab below) to avoid a state/URL sync race.
  const visibleTabKeys = computeVisiblePatientDetailTabs(canSeeImaging);
  const requestedTab = searchParams.get('tab');
  const activeTab: PatientDetailTab = resolvePatientDetailActiveTab(requestedTab, visibleTabKeys);

  // User-initiated tab change — the ONLY place that writes `?tab=`, using a
  // normal (history-pushing) navigation so back/forward moves between tabs.
  const goToTab = (tab: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next);
  };

  // Normalization — the ONLY other place that writes `?tab=`, and only when
  // the param is PRESENT but invalid/unauthorized/feature-disabled (never
  // when it's simply absent, so an old bookmarked URL with no `?tab=` keeps
  // defaulting to Overview without ever being rewritten). Uses `replace` so
  // this correction never pollutes browser history.
  useEffect(() => {
    if (requiresUrlNormalization(requestedTab, visibleTabKeys)) {
      const next = new URLSearchParams(searchParams);
      next.set('tab', DEFAULT_PATIENT_DETAIL_TAB);
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTab, canSeeImaging]);

  const tabLabel = (tab: PatientDetailTab): string =>
    tab === 'messages' ? t('patients:detail.messagesTab', { defaultValue: 'Mesajlar' })
    : tab === 'files' ? t('patients:detail.filesTab')
    : tab === 'imaging' ? t('imaging:tab')
    : tab === 'dental' ? t('patients:dentalChart.title')
    : tab === 'privacy' ? 'Gizlilik'
    : tab === 'communication' ? t('communicationConsent:tab')
    : t(`common:${tab}`, { defaultValue: tab.charAt(0).toUpperCase() + tab.slice(1) });

  const tabItems: PatientDetailTabItem[] = visibleTabKeys.map((tab) => ({ key: tab, label: tabLabel(tab) }));
  const [attachments, setAttachments] = useState<any[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<any | null>(null);
  const [attachmentLegalHoldModal, setAttachmentLegalHoldModal] = useState<{ attachment: any; nextHold: boolean } | null>(null);
  const [attachmentLegalHoldReasonInput, setAttachmentLegalHoldReasonInput] = useState('');
  const [attachmentLegalHoldSubmitting, setAttachmentLegalHoldSubmitting] = useState(false);
  const [attachmentLegalHoldError, setAttachmentLegalHoldError] = useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [whatsappSearch, setWhatsappSearch] = useState('');
  const [whatsappDirection, setWhatsappDirection] = useState<'all' | 'incoming' | 'outgoing'>('all');
  const [messageChannel, setMessageChannel] = useState<'all' | 'whatsapp' | 'instagram' | 'post-treatment'>('all');
  const [postTreatmentQueue, setPostTreatmentQueue] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [treatmentCases, setTreatmentCases] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [paymentPlans, setPaymentPlans] = useState<any[]>([]);
  const [insuranceProvisions, setInsuranceProvisions] = useState<any[]>([]);
  const paymentCurrency = payments[0]?.currency || treatmentCases[0]?.currency || defaultCurrency;
  const patientFullName = patient
    ? String(
        patient.fullName ||
        patient.name ||
        patient.displayName ||
        [patient.firstName, patient.lastName].filter(Boolean).join(' '),
      ).trim()
    : '';

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

      try {
        const ptRes = await (api as any).get('/post-treatment-queue', { params: { patientId: id, limit: 100 } });
        setPostTreatmentQueue(ptRes.data ?? []);
      } catch {
        setPostTreatmentQueue([]);
      }
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
      alert(t('patients:detail.archiveFailed'));
    }
  };

  const handleUnarchive = async () => {
    if (!window.confirm(t('common:confirmAction'))) return;
    try {
      await patientService.unarchive(id!);
      fetchPatient();
    } catch (error) {
      alert(t('patients:detail.unarchiveFailed'));
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

  // BILLING klinik hasta detayını göremez (tedavi, randevu, dental, dosya, mesaj) —
  // ödeme işlemleri için hasta arama/seçimi Payments sayfasındaki form üzerinden yapılır.
  if (!canViewPatients(user)) {
    return <Navigate to="/payments" replace />;
  }

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
    const normalizedSearch = whatsappSearch.trim().toLocaleLowerCase(locale);
    const matchesSearch = !normalizedSearch || message.text.toLocaleLowerCase(locale).includes(normalizedSearch);
    return matchesDirection && matchesSearch;
  });

  const filteredInstagramMessages = (patient.instagramConversationMessages || []).filter((msg: any) => {
    const normalizedSearch = whatsappSearch.trim().toLocaleLowerCase(locale);
    const text = String(msg.text || '').toLocaleLowerCase(locale);
    const matchesSearch = !normalizedSearch || text.includes(normalizedSearch);
    const matchesDirection = whatsappDirection === 'all' || msg.direction === whatsappDirection;
    return matchesSearch && matchesDirection;
  });

  const filteredPostTreatmentMessages = postTreatmentQueue.filter((entry: any) => {
    const normalizedSearch = whatsappSearch.trim().toLocaleLowerCase(locale);
    const text = String(entry.messageBodyRendered || '').toLocaleLowerCase(locale);
    return !normalizedSearch || text.includes(normalizedSearch);
  });

  const unifiedMessages = [
    ...filteredWhatsappMessages.map((message: any) => ({
      id: `wa-${message.id}`,
      channel: 'whatsapp' as const,
      direction: message.direction,
      text: message.text,
      createdAt: message.createdAt,
    })),
    ...filteredInstagramMessages.map((msg: any) => ({
      id: `ig-${msg.id}`,
      channel: 'instagram' as const,
      direction: msg.direction as 'incoming' | 'outgoing',
      text: msg.text,
      createdAt: msg.createdAt,
      senderUsername: msg.senderUsername,
      externalSenderId: msg.externalSenderId,
    })),
    ...filteredPostTreatmentMessages.map((entry: any) => ({
      id: `pt-${entry.id}`,
      channel: 'post-treatment' as const,
      direction: 'outgoing' as const,
      text: entry.messageBodyRendered,
      createdAt: entry.scheduledAt,
      status: entry.status,
      templateTitle: entry.template?.title,
    })),
  ]
    .filter(message => messageChannel === 'all' || message.channel === messageChannel)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

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
    <div className="space-y-4 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button 
          onClick={() => navigate('/patients')}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft size={20} />
          <span className="hidden sm:inline">{t('patients:detail.backToList')}</span>
        </button>
        <div className="flex gap-2">
          {patient.patientStatus === 'archived' ? (
            <button onClick={handleUnarchive} className="btn-secondary text-green-600 hover:bg-green-50 hover:border-green-200 !px-2 sm:!px-4">
              <ArchiveRestore size={18} />
              <span className="hidden sm:inline">{t('common:unarchive')}</span>
            </button>
          ) : (
            <button onClick={handleArchive} className="btn-secondary text-red-600 hover:bg-red-50 hover:border-red-200 !px-2 sm:!px-4">
              <Archive size={18} />
              <span className="hidden sm:inline">{t('common:archive')}</span>
            </button>
          )}
          <button 
            onClick={() => setIsMessageModalOpen(true)}
            className="btn-secondary !px-2 sm:!px-4"
          >
            <MessageSquare size={18} />
            <span className="hidden sm:inline">{t('messages:prepare', { defaultValue: 'Prepare Message' })}</span>
          </button>
          <button onClick={() => setIsEditOpen(true)} className="btn-primary !px-2 sm:!px-4">
            <Edit2 size={18} />
            <span className="hidden sm:inline">{t('patients:editPatient')}</span>
          </button>
        </div>
      </div>

      {/* Mobile-only compact patient header */}
      <div className="flex items-center gap-3 lg:hidden">
        <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center text-sm font-bold border border-primary-100 flex-shrink-0">
          {patient.firstName[0]}{patient.lastName[0]}
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-gray-900 truncate">{patient.firstName} {patient.lastName}</h2>
          <span className={`badge text-xs ${patient.patientStatus === 'active' ? 'badge-green' : patient.patientStatus === 'new' ? 'badge-blue' : 'badge-gray'}`}>
            {t(`patients:status.${patient.patientStatus}`)}
          </span>
        </div>
      </div>

      <PatientDetailTabs tabs={tabItems} activeTab={activeTab} onSelect={goToTab} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column - Profile Summary (desktop only) */}
        <div className="hidden lg:block lg:col-span-1 space-y-6">
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
                <span className="text-sm">{t('patients:form.dob')}: {patient.dateOfBirth ? formatDate(patient.dateOfBirth) : t('common:noData')}</span>
              </div>
              <div className="flex items-center gap-3 text-gray-600">
                <MapPin size={18} className="text-gray-400" />
                <span className="text-sm">{patient.address ? `${patient.address}, ${patient.city}` : t('common:noData')}</span>
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
                const fmt = (n: number) => formatCurrency(n, currency, { maximumFractionDigits: 0 });
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
                      <p className="text-xs text-gray-400 pt-1">{t('patients:detail.overview.lastPayment')}: {formatDate(lastPmt.paidAt || lastPmt.createdAt)}</p>
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
              {/* Mobile-only: profile details, consents, clinical alerts, financial summary */}
              <div className="lg:hidden space-y-4">
                <div className="card p-4 space-y-3">
                  <div className="flex items-center gap-3 text-gray-600">
                    <Mail size={16} className="text-gray-400 flex-shrink-0" />
                    <span className="text-sm truncate">{patient.email || t('common:noData')}</span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-600">
                    <Phone size={16} className="text-gray-400 flex-shrink-0" />
                    <span className="text-sm">{patient.phone || t('common:noData')}</span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-600">
                    <Calendar size={16} className="text-gray-400 flex-shrink-0" />
                    <span className="text-sm">{t('patients:form.dob')}: {patient.dateOfBirth ? formatDate(patient.dateOfBirth) : t('common:noData')}</span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-600">
                    <MapPin size={16} className="text-gray-400 flex-shrink-0" />
                    <span className="text-sm">{patient.address ? `${patient.address}, ${patient.city}` : t('common:noData')}</span>
                  </div>
                </div>
                <div className={`card p-4 ${patient.notes ? 'border-amber-200 bg-amber-50' : ''}`}>
                  <h3 className="font-bold flex items-center gap-2 mb-2 text-sm">
                    <AlertTriangle size={15} className={patient.notes ? 'text-amber-500' : 'text-gray-400'} />
                    {t('patients:detail.overview.clinicalAlerts')}
                  </h3>
                  {patient.notes ? (
                    <p className="text-sm text-amber-800 bg-white rounded-lg border border-amber-200 p-2 whitespace-pre-line">{patient.notes}</p>
                  ) : (
                    <p className="text-sm text-gray-400 italic">{t('patients:detail.overview.noClinicalAlerts')}</p>
                  )}
                </div>
                <div className="card p-4">
                  <h3 className="font-bold flex items-center gap-2 mb-2 text-sm">
                    <TrendingUp size={15} className="text-primary-500" />
                    {t('patients:detail.overview.financialSummary')}
                  </h3>
                  {(() => {
                    const totalTreatment = treatmentCases.reduce((sum: number, tc: any) => sum + (tc.acceptedAmount ?? tc.estimatedAmount ?? 0), 0);
                    const totalPaid = payments.filter((p: any) => p.paymentStatus === 'paid').reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
                    const remaining = Math.max(0, totalTreatment - totalPaid);
                    const lastPmt = payments.find((p: any) => p.paymentStatus === 'paid');
                    const currency = paymentCurrency;
                    const fmt = (n: number) => formatCurrency(n, currency, { maximumFractionDigits: 0 });
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
                          <p className="text-xs text-gray-400 pt-1">{t('patients:detail.overview.lastPayment')}: {formatDate(lastPmt.paidAt || lastPmt.createdAt)}</p>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Upcoming Appointments */}
              <div className="card overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-gray-100">
                  <h3 className="font-bold flex items-center gap-2">
                    <Calendar size={17} className="text-primary-500" />
                    {t('patients:detail.overview.upcomingAppointments')}
                  </h3>
                  <button onClick={() => goToTab('appointments')} className="text-xs text-primary-600 hover:underline">
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
                              {new Intl.DateTimeFormat(locale, { month: 'short', timeZone: timezone }).format(new Date(appt.startTime))}
                            </span>
                            <span className="text-lg leading-none font-extrabold">
                              {new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: timezone }).format(new Date(appt.startTime))}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate">{appt.appointmentType?.name}</p>
                            <p className="text-xs text-gray-500">
                              {formatTime(appt.startTime)} &middot; {appt.practitioner ? `${appt.practitioner.firstName} ${appt.practitioner.lastName}` : t('patients:detail.overview.unassigned')}
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
                  <button onClick={() => goToTab('treatments')} className="text-xs text-primary-600 hover:underline">
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
                    <ClipboardList size={17} className="text-primary-500" />
                    {t('patients:detail.overview.dentalSummary')}
                  </h3>
                  <button onClick={() => goToTab('dental')} className="text-xs text-primary-600 hover:underline">
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
                  <button onClick={() => goToTab('activity')} className="text-xs text-primary-600 hover:underline">
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
                              ? t('patients:detail.whatsappSessionSummary', {
                                  count: item.payload.count,
                                  incoming: item.payload.incomingCount,
                                  outgoing: item.payload.outgoingCount,
                                })
                              : item.payload?.description}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {formatDateTime(item.createdAt)}
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
                        <p className="text-xs text-gray-500">{t('patients:detail.appointmentWith', { practitioner: `${appt.practitioner.firstName} ${appt.practitioner.lastName}` })}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-700">{formatDateTime(appt.startTime)}</p>
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
                       <p className="text-xs text-gray-500">{t('tasks:form.dueDate')}: {formatDate(task.dueDate)}</p>
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
                          {t('patients:detail.treatmentProcedureLinkHint')}
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
                    <p className="text-xs mt-1">{t('patients:detail.createTreatmentCaseHint')}</p>
                  </div>
                )}
              </div>
              {treatmentCases.length > 0 && (
                <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
                  <strong>{t('patients:detail.addProcedureInstructionTitle')}</strong> {t('patients:detail.addProcedureInstructionBody')}
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
                      <p className="text-xl font-bold text-green-700">{formatCurrency(paidTotal, paymentCurrency)}</p>
                    </div>
                    <div className="card p-4 bg-amber-50 border-amber-100">
                      <p className="text-[10px] font-bold text-amber-600 uppercase mb-1">{t('payments:summary.totalPending')}</p>
                      <p className="text-xl font-bold text-amber-700">{formatCurrency(totalPending, paymentCurrency)}</p>
                      {unpaidInstallments > 0 && (
                        <p className="text-[10px] text-amber-500 mt-1">
                          {t('payments:summary.pendingBreakdown', {
                            installments: formatCurrency(unpaidInstallments, paymentCurrency),
                            payments: formatCurrency(pendingPayments, paymentCurrency),
                          })}
                        </p>
                      )}
                    </div>
                    <div className="card p-4 bg-red-50 border-red-100">
                      <p className="text-[10px] font-bold text-red-600 uppercase mb-1">{t('payments:summary.totalRefunded')}</p>
                      <p className="text-xl font-bold text-red-700">{formatCurrency(refundedTotal, paymentCurrency)}</p>
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
                          <td className="p-3 font-bold">{formatCurrency(p.amount, p.currency || paymentCurrency)}</td>
                          <td className="p-3 text-gray-600 capitalize">{t(`payments:methods.${p.paymentMethod}`, { defaultValue: p.paymentMethod.replace('_', ' ') })}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${
                              p.paymentStatus === 'paid' ? 'bg-green-50 text-green-700 border-green-100' :
                              p.paymentStatus === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-gray-50 text-gray-700'
                            }`}>
                              {t(`payments:status.${p.paymentStatus}`)}
                            </span>
                          </td>
                          <td className="p-3 text-gray-500">{formatDate(p.paidAt)}</td>
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
                  <h3 className="font-bold text-lg">{t('payments:planForm.paymentPlansTitle')}</h3>
                  {paymentPlans.map((plan: any) => {
                    const unpaid = (plan.installments || []).filter((i: any) => i.status !== 'paid' && i.status !== 'cancelled');
                    const paidAmount = (plan.installments || []).filter((i: any) => i.status === 'paid').reduce((a: number, i: any) => a + i.amount, 0);
                    const progress = plan.totalAmount > 0 ? Math.round((paidAmount / plan.totalAmount) * 100) : 0;
                    return (
                      <div key={plan.id} className="card p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="font-semibold text-gray-900 dark:text-white">{plan.description || t('payments:planForm.paymentPlan')}</p>
                            <p className="text-xs text-gray-500">{t('payments:planForm.installmentSummary', { count: plan.installments?.length || 0, amount: formatNumber(plan.totalAmount), currency: plan.currency || paymentCurrency })}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-green-600 font-bold">{t('payments:planForm.paid')}: {formatCurrency(paidAmount, plan.currency || paymentCurrency)}</p>
                            <p className="text-xs text-amber-600 font-bold">{t('payments:summary.remaining')}: {formatCurrency(plan.totalAmount - paidAmount, plan.currency || paymentCurrency)}</p>
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
                                <th className="text-left py-1 pr-3">{t('payments:planForm.installmentNo')}</th>
                                <th className="text-left py-1 pr-3">{t('payments:planForm.dueDate')}</th>
                                <th className="text-right py-1 pr-3">{t('payments:list.amount')}</th>
                                <th className="text-right py-1">{t('payments:list.status')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(plan.installments || []).map((inst: any) => {
                                const isOverdue = inst.status !== 'paid' && inst.status !== 'cancelled' && new Date(inst.dueDate) < new Date();
                                return (
                                  <tr key={inst.id} className="border-t border-gray-50">
                                    <td className="py-1.5 pr-3 text-gray-500 text-xs">{t('payments:planForm.installmentLabel', { number: inst.installmentNo })}</td>
                                    <td className="py-1.5 pr-3 text-gray-700">{formatDate(inst.dueDate)}</td>
                                    <td className="py-1.5 pr-3 text-right font-medium">{formatCurrency(inst.amount, plan.currency || paymentCurrency)}</td>
                                    <td className="py-1.5 text-right">
                                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                        inst.status === 'paid' ? 'bg-green-50 text-green-700' :
                                        inst.status === 'cancelled' ? 'bg-gray-100 text-gray-500' :
                                        isOverdue ? 'bg-red-50 text-red-700' :
                                        'bg-amber-50 text-amber-700'
                                      }`}>
                                        {inst.status === 'paid' ? t('payments:status.paid') :
                                         inst.status === 'cancelled' ? t('payments:status.cancelled') :
                                         isOverdue ? t('payments:planForm.installmentStatus.overdue') : t('payments:status.pending')}
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
                        <p className="text-xs text-gray-500">{t(`insurance:types.${provision.insuranceType}`, { defaultValue: provision.insuranceType })} &bull; {provision.treatmentCase?.title || '-'}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="badge badge-blue">{t(`insurance:statuses.${provision.status}`, { defaultValue: provision.status })}</span>
                      <p className="text-xs text-gray-500 mt-2">{formatCurrency(provision.requestedAmount, provision.currency || paymentCurrency)}</p>
                    </div>
                  </Link>
                )) : (
                  <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-xl border-2 border-dashed">{t('common:noData')}</div>
                )}
              </div>
            </div>
          )}
          {activeTab === 'messages' && (
            <div className="space-y-4">
              <div className="card p-6 space-y-4">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="font-bold text-lg">{t('patients:detail.messagesTab', { defaultValue: 'Mesajlar' })}</h3>
                    <p className="text-sm text-gray-500">
                      {t('patients:detail.messagesCount', { count: unifiedMessages.length, defaultValue: '{{count}} mesaj bulundu' })}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(['all', 'whatsapp', 'instagram', 'post-treatment'] as const).map(channel => (
                      <button
                        key={channel}
                        onClick={() => setMessageChannel(channel)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${messageChannel === channel ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
                      >
                        {channel === 'all'
                          ? t('patients:detail.messagesFilterAllChannels', { defaultValue: 'Tüm Kanallar' })
                          : channel === 'whatsapp'
                            ? 'WhatsApp'
                            : channel === 'instagram'
                              ? 'Instagram'
                              : t('postTreatment:nav', { defaultValue: 'Tedavi Sonrası' })}
                      </button>
                    ))}
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
                    placeholder={t('patients:detail.messagesSearchPlaceholder', { defaultValue: 'Mesajlarda ara...' })}
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm outline-none transition focus:border-primary-400"
                  />
                </div>
              </div>

              <div className="space-y-3">
                {unifiedMessages.length > 0 ? unifiedMessages.map((message: any) => (
                  <div key={message.id} className={`card p-5 border ${message.channel === 'post-treatment' ? 'border-violet-100 bg-violet-50/60' : message.direction === 'incoming' ? 'border-emerald-100 bg-emerald-50/60' : 'border-sky-100 bg-sky-50/60'}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${message.channel === 'instagram' ? 'border-purple-200 text-purple-700 bg-purple-50' : message.channel === 'post-treatment' ? 'border-violet-200 text-violet-700 bg-violet-50' : 'border-green-200 text-green-700 bg-green-50'}`}>
                            {message.channel === 'instagram' ? 'Instagram' : message.channel === 'post-treatment' ? t('postTreatment:nav', { defaultValue: 'Tedavi Sonrası' }) : 'WhatsApp'}
                          </span>
                          {message.channel === 'post-treatment' && message.status && (
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${message.status === 'sent' ? 'bg-green-100 text-green-700' : message.status === 'waiting_approval' ? 'bg-blue-100 text-blue-700' : message.status === 'failed' ? 'bg-red-100 text-red-700' : message.status === 'cancelled' ? 'bg-gray-100 text-gray-500' : 'bg-yellow-100 text-yellow-700'}`}>
                              {t(`postTreatment:queue.status.${message.status}`, { defaultValue: message.status })}
                            </span>
                          )}
                          {message.channel !== 'post-treatment' && (
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              {message.channel === 'instagram'
                                ? message.direction === 'outgoing'
                                  ? t('patients:detail.instagramOutgoing', { defaultValue: 'Instagram Giden' })
                                  : t('patients:detail.instagramIncoming', { defaultValue: 'Instagram Gelen' })
                                : message.direction === 'incoming'
                                  ? t('patients:detail.whatsappIncoming', { defaultValue: 'WhatsApp Gelen' })
                                  : t('patients:detail.whatsappOutgoing', { defaultValue: 'WhatsApp Giden' })}
                            </p>
                          )}
                          {message.channel === 'post-treatment' && message.templateTitle && (
                            <p className="text-xs text-gray-500">{message.templateTitle}</p>
                          )}
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-900">{message.text}</p>
                        {message.channel === 'instagram' && message.direction === 'incoming' && (message.senderUsername || message.externalSenderId) && (
                          <p className="mt-1 text-xs text-gray-500">
                            {message.senderUsername ? `@${message.senderUsername}` : `ID • ...${String(message.externalSenderId).slice(-4)}`}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-gray-500 whitespace-nowrap">{formatDateTime(message.createdAt)}</span>
                    </div>
                  </div>
                )) : (
                  <div className="card p-8 text-center text-gray-400 italic">{t('patients:detail.messagesEmpty', { defaultValue: 'Bu filtre için mesaj bulunamadı.' })}</div>
                )}
              </div>
            </div>
          )}
        {/* Activity Tab */}
        {activeTab === 'files' && (
          <div className="card p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold flex items-center gap-2"><Paperclip size={18} /> {t('patients:detail.filesTab')}</h3>
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
                        alert(t('patients:detail.files.uploadFailed'));
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
                    {uploadingFile ? t('common:loading') : t('patients:detail.files.addFile')}
                  </button>
                </>
              )}
            </div>
            {attachmentsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary-500" /></div>
            ) : attachments.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <Paperclip size={36} className="mx-auto mb-2 opacity-30" />
                <p>{t('patients:detail.files.empty')}</p>
              </div>
            ) : (
              <div className="divide-y">
                {attachments.map((att: any) => (
                  <div key={att.id} className="flex items-center gap-4 py-3">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500">
                      {att.mimeType.startsWith('image/') ? <Image size={20} /> : <FileText size={20} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => setPreviewAttachment(att)}
                        className="text-sm font-medium truncate text-left hover:text-primary-600 hover:underline inline-flex items-center gap-2"
                      >
                        {att.originalName}
                        {att.legalHold && (
                          <span className="badge bg-red-50 text-red-700 border border-red-200 shrink-0 flex items-center gap-1">
                            <Lock size={11} /> {t('patients:detail.files.legalHoldBadge')}
                          </span>
                        )}
                      </button>
                      <p className="text-xs text-gray-400">
                        {(att.fileSize / 1024).toFixed(1)} KB &bull; {formatDate(att.createdAt)} &bull; {att.uploadedBy?.firstName} {att.uploadedBy?.lastName}
                      </p>
                    </div>
                    <button
                      onClick={() => setPreviewAttachment(att)}
                      className="p-2 text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded-lg"
                      title={t('patients:detail.files.view') as string}
                    >
                      <Eye size={16} />
                    </button>
                    <button
                      onClick={() => attachmentService.download(id!, att.id, att.originalName)}
                      className="p-2 text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded-lg"
                      title={t('patients:detail.files.download')}
                    >
                      <Download size={16} />
                    </button>
                    {canManageLegalHold(user) && (
                      <button
                        onClick={() => {
                          setAttachmentLegalHoldReasonInput('');
                          setAttachmentLegalHoldError('');
                          setAttachmentLegalHoldModal({ attachment: att, nextHold: !att.legalHold });
                        }}
                        className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title={att.legalHold ? t('patients:detail.files.releaseLegalHold') as string : t('patients:detail.files.setLegalHold') as string}
                      >
                        {att.legalHold ? <LockOpen size={16} /> : <Lock size={16} />}
                      </button>
                    )}
                    {!att.legalHold && (['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST'] as const).includes(userCanonicalRole as any) && (
                      <button
                        onClick={async () => {
                          if (!id || !confirm(t('patients:detail.files.deleteConfirm'))) return;
                          try {
                            await attachmentService.delete(id, att.id);
                            setAttachments(prev => prev.filter(a => a.id !== att.id));
                          } catch (err: any) {
                            if (err?.response?.data?.error === 'ATTACHMENT_LEGAL_HOLD') {
                              alert(t('patients:detail.files.deleteBlockedLegalHold'));
                              const attachRes = await attachmentService.getAll(id);
                              setAttachments(attachRes.data);
                            } else {
                              alert(t('patients:detail.files.deleteFailed'));
                            }
                          }
                        }}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title={t('common:delete')}
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
        {/* Imaging Tab — BILLING/ASSISTANT için render edilmez */}
        {activeTab === 'imaging' && canSeeImaging && (
          <PatientImagingTab patientId={id!} canManageLegalHold={canManageLegalHold(user)} />
        )}
        {/* Dental Chart Tab */}
        {activeTab === 'dental' && (
          <DentalChart patientId={id!} patientName={patientFullName} />
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
                      {t('patients:detail.activityByUser', {
                        user: getActivityActorLabel(item.payload),
                        date: formatDateTime(item.payload.createdAt),
                      })}
                    </p>
                  </div>
                </div>
              ) : (
                <div key={item.id} className="relative pl-10">
                  <div className="absolute left-0 top-1 w-8 h-8 rounded-full border-4 border-white flex items-center justify-center bg-emerald-500 text-white">
                    <MessageSquare size={14} />
                  </div>
                  <div className="rounded-xl border px-4 py-3 bg-emerald-50 border-emerald-100">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('patients:detail.whatsappSessionTitle')}</p>
                    <p className="text-sm text-gray-700 mt-1">
                      {t('patients:detail.whatsappSessionCounts', {
                        incoming: item.payload.incomingCount,
                        outgoing: item.payload.outgoingCount,
                        count: item.payload.count,
                      })}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {formatDateTime(item.payload.startTime)}
                      {item.payload.startTime !== item.payload.endTime
                        ? ` — ${formatTime(item.payload.endTime)}`
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
        {activeTab === 'privacy' && (
          <div className="card p-6">
            <PatientPrivacyPanel
              patientId={id!}
              isAnonymized={!!patient.isAnonymized}
              canManage={userCanonicalRole === 'OWNER' || userCanonicalRole === 'ORG_ADMIN' || userCanonicalRole === 'CLINIC_MANAGER'}
              onAnonymized={() => fetchPatient()}
            />
          </div>
        )}
        {activeTab === 'communication' && (
          <div className="card p-6">
            <CommunicationPreferencesPanel
              patientId={id!}
              canManage={(['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST', 'DENTIST'] as const).includes(userCanonicalRole as any)}
              // KVKK-HIGH-008: the legacy-correction workflow is management-only
              // (OWNER/ORG_ADMIN/CLINIC_MANAGER) — deliberately narrower than
              // canManage above, which also includes RECEPTIONIST/DENTIST for
              // the general matrix. Mirrors the PatientPrivacyPanel canManage
              // check just above.
              canCorrectLegacyConsent={userCanonicalRole === 'OWNER' || userCanonicalRole === 'ORG_ADMIN' || userCanonicalRole === 'CLINIC_MANAGER'}
              legacySignals={{
                communicationConsent: !!patient.communicationConsent,
                marketingConsent: !!patient.marketingConsent,
                smsOptOut: !!patient.smsOptOut,
              }}
              onLegacySignalsChanged={() => fetchPatient()}
            />
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
          clinicId={patient.clinicId}
          onClose={() => setIsMessageModalOpen(false)}
          onSuccess={() => {
            setIsMessageModalOpen(false);
            fetchPatient();
          }}
        />
      )}

      {previewAttachment && (
        <FilePreviewModal
          fileName={previewAttachment.originalName}
          mimeType={previewAttachment.mimeType}
          loadPreviewUrl={() => attachmentService.loadPreviewObjectUrl(id!, previewAttachment.id)}
          onDownload={() => attachmentService.download(id!, previewAttachment.id, previewAttachment.originalName)}
          onOpenInNewTab={async () => {
            const url = isInlinePreviewable(previewAttachment.mimeType)
              ? await attachmentService.loadPreviewObjectUrl(id!, previewAttachment.id)
              : await attachmentService.loadDownloadObjectUrl(id!, previewAttachment.id);
            window.open(url, '_blank');
          }}
          onClose={() => setPreviewAttachment(null)}
        />
      )}

      {/* Attachment legal-hold place/release modal (docs/compliance/53) — OWNER/ORG_ADMIN
          only, reason required (min 3 chars) both ways, extra confirm on release. */}
      {attachmentLegalHoldModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !attachmentLegalHoldSubmitting && setAttachmentLegalHoldModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h3 className="font-semibold text-gray-900">
                {attachmentLegalHoldModal.nextHold
                  ? t('patients:detail.files.setLegalHoldTitle')
                  : t('patients:detail.files.releaseLegalHoldTitle')}
              </h3>
              <button onClick={() => !attachmentLegalHoldSubmitting && setAttachmentLegalHoldModal(null)} className="text-gray-400 hover:text-gray-600">
                <span aria-hidden>×</span>
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('patients:detail.files.legalHoldReason')} <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={attachmentLegalHoldReasonInput}
                  onChange={(e) => setAttachmentLegalHoldReasonInput(e.target.value)}
                  rows={3}
                  maxLength={500}
                  className="input-field resize-none"
                  placeholder={t('patients:detail.files.legalHoldReasonPlaceholder') as string}
                />
                <p className="text-xs text-gray-400 mt-1">{attachmentLegalHoldReasonInput.length}/500</p>
              </div>
              {attachmentLegalHoldError && (
                <p className="text-sm text-red-600 flex items-center gap-1">
                  <AlertTriangle size={13} />
                  {attachmentLegalHoldError}
                </p>
              )}
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-3">
              <button
                onClick={() => setAttachmentLegalHoldModal(null)}
                disabled={attachmentLegalHoldSubmitting}
                className="btn-secondary"
              >
                {t('common:cancel')}
              </button>
              <button
                onClick={async () => {
                  const reason = attachmentLegalHoldReasonInput.trim();
                  if (reason.length < 3) {
                    setAttachmentLegalHoldError(t('patients:detail.files.legalHoldReasonTooShort'));
                    return;
                  }
                  if (!attachmentLegalHoldModal.nextHold && !confirm(t('patients:detail.files.releaseLegalHoldConfirm') as string)) return;
                  setAttachmentLegalHoldSubmitting(true);
                  setAttachmentLegalHoldError('');
                  try {
                    await attachmentService.setLegalHold(id!, attachmentLegalHoldModal.attachment.id, attachmentLegalHoldModal.nextHold, reason);
                    setAttachmentLegalHoldModal(null);
                    const attachRes = await attachmentService.getAll(id!);
                    setAttachments(attachRes.data);
                  } catch {
                    setAttachmentLegalHoldError(t('patients:detail.files.legalHoldFailed'));
                  } finally {
                    setAttachmentLegalHoldSubmitting(false);
                  }
                }}
                disabled={attachmentLegalHoldSubmitting || attachmentLegalHoldReasonInput.trim().length < 3}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium text-sm disabled:opacity-50 transition-colors"
              >
                {attachmentLegalHoldSubmitting ? <Loader2 size={15} className="animate-spin" /> : (attachmentLegalHoldModal.nextHold ? <Lock size={15} /> : <LockOpen size={15} />)}
                {attachmentLegalHoldModal.nextHold ? t('patients:detail.files.setLegalHoldSubmit') : t('patients:detail.files.releaseLegalHoldSubmit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PatientDetail;
