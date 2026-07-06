import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { 
  ArrowLeft, 
  Briefcase, 
  User, 
  Stethoscope, 
  Calendar, 
  DollarSign, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Edit2, 
  Loader2,
  ClipboardList,
  Plus,
  TrendingUp,
  FileText,
  MessageSquare,
  Trash2,
  Circle,
  Link as LinkIcon,
  Unlink,
  Package
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { treatmentCaseService, paymentService, insuranceProvisionService, treatmentPlanProceduresService, appointmentService, inventoryService, serviceService, treatmentPackageService } from '../services/api';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import TreatmentCaseForm from '../components/TreatmentCaseForm';
import TaskForm from '../components/TaskForm';
import PaymentForm from '../components/PaymentForm';
import PrepareMessageModal from '../components/PrepareMessageModal';
import InsuranceProvisionForm from '../components/InsuranceProvisionForm';
import AppointmentForm from '../components/AppointmentForm';

const TreatmentCaseDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(['treatmentCases', 'common', 'tasks', 'appointments', 'messages', 'insurance', 'payments', 'patients']);
  const { defaultCurrency, formatCurrency, formatDate, formatTime, formatDateTime } = useClinicPreferences();
  
  const [tCase, setTCase] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [insuranceProvisions, setInsuranceProvisions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isTaskFormOpen, setIsTaskFormOpen] = useState(false);
  const [isPaymentFormOpen, setIsPaymentFormOpen] = useState(false);
  const [isInsuranceFormOpen, setIsInsuranceFormOpen] = useState(false);
  const [paymentInitialData, setPaymentInitialData] = useState<any>(null);
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  const [isAppointmentFormOpen, setIsAppointmentFormOpen] = useState(false);
  const [isLinkApptOpen, setIsLinkApptOpen] = useState(false);
  const [linkableAppts, setLinkableAppts] = useState<any[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [stageSaving, setStageSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proceduresError, setProceduresError] = useState<string | null>(null);

  // Treatment procedures
  const [procedures, setProcedures] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [isProcFormOpen, setIsProcFormOpen] = useState(false);
  const [editingProc, setEditingProc] = useState<any | null>(null);
  const [procSaving, setProcSaving] = useState(false);
  const [procForm, setProcForm] = useState({
    procedureName: '',
    serviceId: '',
    toothFdi: '',
    status: 'planned',
    estimatedCost: '',
    notes: '',
    scheduledDate: '',
  });
  const [isPackageModalOpen, setIsPackageModalOpen] = useState(false);
  const [packageLoading, setPackageLoading] = useState(false);
  const [packageSaving, setPackageSaving] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);
  const [treatmentPackages, setTreatmentPackages] = useState<any[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState('');

  // Treatment materials
  const [materials, setMaterials] = useState<any[]>([]);
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [matItemId, setMatItemId] = useState('');
  const [matQty, setMatQty] = useState('');
  const [matNotes, setMatNotes] = useState('');
  const [matSaving, setMatSaving] = useState(false);
  const [matError, setMatError] = useState<string | null>(null);

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setProceduresError(null);
    try {
      const res = await treatmentCaseService.getById(id);
      setTCase(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || t('treatmentCases:detail.errors.loadFailed'));
      setLoading(false);
      return;
    }

    try {
      const procRes = await treatmentPlanProceduresService.getByCaseId(id);
      setProcedures(procRes.data);
    } catch (err: any) {
      setProceduresError(err.response?.data?.error || t('treatmentCases:detail.errors.proceduresLoadFailed'));
    }

    try {
      const [payRes, insuranceRes, svcRes, matRes, invRes] = await Promise.all([
        paymentService.getAll({ treatmentCaseId: id }),
        insuranceProvisionService.getAll({ treatment_case_id: id }),
        serviceService.getAll({ onlyActive: true }),
        treatmentCaseService.getMaterials(id),
        inventoryService.getAll({ isActive: 'true' }),
      ]);
      setPayments(payRes.data);
      setInsuranceProvisions(insuranceRes.data);
      setServices(svcRes.data);
      setMaterials(matRes.data);
      setInventoryItems(invRes.data);
    } catch (err: any) {
      console.error('Failed to load treatment case secondary data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

  const handleStageUpdate = async (stage: string) => {
    if (!tCase) return;
    
    let lostReason = '';
    if (stage === 'lost') {
      const reason = window.prompt(t('treatmentCases:form.lostReason'));
      if (!reason) return;
      lostReason = reason;
    }

    setStageSaving(true);
    try {
      await treatmentCaseService.updateStage(tCase.id, stage, lostReason);
      setPendingStage(null);
      fetchDetail();
    } catch (err: any) {
      alert(err.response?.data?.error || t('common:errorGeneric'));
    } finally {
      setStageSaving(false);
    }
  };

  const openProcForm = (proc?: any) => {
    if (proc) {
      setEditingProc(proc);
      setProcForm({
        procedureName: proc.procedureName,
        serviceId: proc.serviceId ?? '',
        toothFdi: proc.toothFdi ? String(proc.toothFdi) : '',
        status: proc.status,
        estimatedCost: proc.estimatedCost ? String(proc.estimatedCost) : '',
        notes: proc.notes ?? '',
        scheduledDate: proc.scheduledDate ? new Date(proc.scheduledDate).toISOString().slice(0, 10) : '',
      });
    } else {
      setEditingProc(null);
      setProcForm({ procedureName: '', serviceId: '', toothFdi: '', status: 'planned', estimatedCost: '', notes: '', scheduledDate: '' });
    }
    setIsProcFormOpen(true);
  };

  const handleProcSave = async () => {
    if (!procForm.procedureName.trim() || !id) return;
    setProcSaving(true);
    const payload = {
      procedureName: procForm.procedureName.trim(),
      serviceId: procForm.serviceId || null,
      toothFdi: procForm.toothFdi ? parseInt(procForm.toothFdi) : null,
      status: procForm.status,
      estimatedCost: procForm.estimatedCost ? parseFloat(procForm.estimatedCost) : null,
      notes: procForm.notes.trim() || null,
      scheduledDate: procForm.scheduledDate || null,
    };
    try {
      if (editingProc) {
        await treatmentPlanProceduresService.update(id, editingProc.id, payload);
      } else {
        await treatmentPlanProceduresService.create(id, payload);
      }
      setIsProcFormOpen(false);
      const procRes = await treatmentPlanProceduresService.getByCaseId(id);
      setProcedures(procRes.data);
    } catch (err: any) {
      alert(err.response?.data?.error || t('treatmentCases:procedures.errors.saveFailed'));
    } finally {
      setProcSaving(false);
    }
  };

  const handleProcDelete = async (procId: string) => {
    if (!id || !window.confirm(t('treatmentCases:procedures.confirmDelete'))) return;
    try {
      await treatmentPlanProceduresService.remove(id, procId);
      setProcedures((prev) => prev.filter((p) => p.id !== procId));
    } catch (err: any) {
      alert(err.response?.data?.error || t('treatmentCases:procedures.errors.deleteFailed'));
    }
  };

  const openPackageModal = async () => {
    setIsPackageModalOpen(true);
    setPackageLoading(true);
    setPackageError(null);
    try {
      const res = await treatmentPackageService.getAll({ includeInactive: false });
      setTreatmentPackages(res.data);
      setSelectedPackageId(res.data[0]?.id || '');
    } catch (err: any) {
      setPackageError(err.response?.data?.error || t('treatmentCases:packages.errors.loadFailed'));
    } finally {
      setPackageLoading(false);
    }
  };

  const applySelectedPackage = async (allowDuplicate = false) => {
    if (!id || !selectedPackageId) return;
    setPackageSaving(true);
    setPackageError(null);
    try {
      await treatmentCaseService.applyPackage(id, { packageId: selectedPackageId, allowDuplicate });
      setIsPackageModalOpen(false);
      const procRes = await treatmentPlanProceduresService.getByCaseId(id);
      setProcedures(procRes.data);
    } catch (err: any) {
      const data = err.response?.data;
      if (data?.code === 'PACKAGE_ALREADY_APPLIED') {
        const shouldAddAgain = window.confirm(t('treatmentCases:packages.confirmDuplicate'));
        if (shouldAddAgain) {
          await applySelectedPackage(true);
          return;
        }
      }
      setPackageError(data?.error || t('treatmentCases:packages.errors.applyFailed'));
    } finally {
      setPackageSaving(false);
    }
  };

  const openLinkApptModal = async () => {
    if (!tCase) return;
    setLinkLoading(true);
    setIsLinkApptOpen(true);
    try {
      const res = await appointmentService.getAll({ patientId: tCase.patientId });
      // Show only appointments not yet linked to this treatment case
      const linked = new Set((tCase.appointments || []).map((a: any) => a.id));
      setLinkableAppts(res.data.filter((a: any) => !linked.has(a.id)));
    } catch {
      setLinkableAppts([]);
    } finally {
      setLinkLoading(false);
    }
  };

  const handleLinkAppt = async (apptId: string) => {
    try {
      await appointmentService.linkTreatmentCase(apptId, id!);
      setIsLinkApptOpen(false);
      fetchDetail();
    } catch (err: any) {
      alert(err.response?.data?.error || t('treatmentCases:appointments.linkFailed'));
    }
  };

  const handleUnlinkAppt = async (apptId: string) => {
    if (!window.confirm(t('treatmentCases:appointments.confirmUnlink'))) return;
    try {
      await appointmentService.linkTreatmentCase(apptId, null);
      fetchDetail();
    } catch (err: any) {
      alert(err.response?.data?.error || t('treatmentCases:appointments.unlinkFailed'));
    }
  };
  const PROC_STATUS = {
    planned:     { dot: 'bg-amber-400',   badge: 'bg-amber-50 text-amber-700 border-amber-100' },
    in_progress: { dot: 'bg-blue-500',    badge: 'bg-blue-50 text-blue-700 border-blue-100' },
    completed:   { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
    cancelled:   { dot: 'bg-gray-400',    badge: 'bg-gray-50 text-gray-500 border-gray-200' },
  } as const;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="animate-spin text-primary-600" size={48} />
      </div>
    );
  }

  if (error || !tCase) {
    return (
      <div className="card p-12 text-center text-red-600">
        <AlertCircle className="mx-auto mb-4" size={48} />
        <p className="text-xl font-bold">{error || t('treatmentCases:detail.errors.notFound')}</p>
        <button onClick={() => navigate('/treatment-cases')} className="mt-4 btn-secondary">
          {t('treatmentCases:detail.backToPipeline')}
        </button>
      </div>
    );
  }

  const stages = [
    'new', 'consultation_scheduled', 'consultation_done', 
    'quote_sent', 'waiting_patient_decision', 'accepted', 
    'in_progress', 'completed'
  ];

  const currentStageIndex = stages.indexOf(tCase.stage);
  const provisionTotals = insuranceProvisions.reduce((totals, provision) => ({
    requested: totals.requested + (provision.requestedAmount || 0),
    approved: totals.approved + (provision.approvedAmount || 0),
    patientResponsibility: totals.patientResponsibility + (provision.patientResponsibilityAmount || 0),
  }), { requested: 0, approved: 0, patientResponsibility: 0 });
  const caseCurrency = tCase.currency || defaultCurrency;
  const paidTotal = payments.filter(p => p.paymentStatus === 'paid').reduce((acc, curr) => acc + curr.amount, 0);
  const selectedPackage = treatmentPackages.find((pkg) => pkg.id === selectedPackageId);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/treatment-cases')}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"
          >
            <ArrowLeft size={24} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{tCase.title}</h1>
              <span className={`badge ${
                tCase.stage === 'completed' ? 'badge-green' : 
                tCase.stage === 'lost' ? 'badge-red' : 'badge-blue'
              }`}>
                {t(`treatmentCases:stages.${tCase.stage}`)}
              </span>
            </div>
            <p className="text-gray-500 mt-1 flex items-center gap-2 text-sm">
              <Briefcase size={14} />
              {t('treatmentCases:detailTitle')} • {tCase.patient.firstName} {tCase.patient.lastName}
              {tCase.appointmentType && (
                <>
                  <span className="text-gray-300">|</span>
                  <span className="text-primary-600 font-medium">{t('treatmentCases:service')}: {tCase.appointmentType.name}</span>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {tCase.stage !== 'completed' && tCase.stage !== 'lost' && (
            <>
              <button 
                onClick={() => handleStageUpdate('accepted')}
                className="btn-secondary text-green-600 border-green-200 hover:bg-green-50"
              >
                <CheckCircle2 size={18} />
                {t('treatmentCases:actions.markAccepted')}
              </button>
              <button 
                onClick={() => handleStageUpdate('lost')}
                className="btn-secondary text-red-600 border-red-200 hover:bg-red-50"
              >
                <XCircle size={18} />
                {t('treatmentCases:actions.markLost')}
              </button>
            </>
          )}
          <button 
            onClick={() => setIsMessageModalOpen(true)}
            className="btn-secondary"
          >
            <MessageSquare size={18} />
            {t('messages:prepare', { defaultValue: 'Prepare Follow-up' })}
          </button>
          <button onClick={() => setIsEditOpen(true)} className="btn-primary">
            <Edit2 size={18} />
            {t('common:edit')}
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      {tCase.stage !== 'lost' && (
        <div className="card p-6 bg-gray-50 border-none">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">{t('treatmentCases:form.stage')}</h3>
            {pendingStage && pendingStage !== tCase.stage ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-amber-600 font-semibold">
                  → {t(`treatmentCases:stages.${pendingStage}`)}
                </span>
                <button
                  onClick={() => handleStageUpdate(pendingStage)}
                  disabled={stageSaving}
                  className="px-3 py-1 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors flex items-center gap-1"
                >
                  {stageSaving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                  {t('common:save')}
                </button>
                <button
                  onClick={() => setPendingStage(null)}
                  className="px-2 py-1 text-xs font-bold text-gray-500 hover:text-gray-700 rounded-lg transition-colors"
                >
                  {t('common:cancel')}
                </button>
              </div>
            ) : (
              <span className="text-xs font-bold text-primary-600">
                {t('treatmentCases:progress.complete', { percent: Math.round(((currentStageIndex + 1) / stages.length) * 100) })}
              </span>
            )}
          </div>
          <div className="flex gap-2 h-2">
            {stages.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  if (tCase.stage === 'completed') return;
                  setPendingStage(s === pendingStage ? null : s);
                }}
                className={`flex-1 rounded-full transition-all duration-300 ${
                  tCase.stage === 'completed' ? 'cursor-default' : 'cursor-pointer hover:opacity-80'
                } ${
                  pendingStage
                    ? i <= stages.indexOf(pendingStage) ? 'bg-amber-400' : 'bg-gray-200'
                    : i <= currentStageIndex ? 'bg-primary-500' : 'bg-gray-200'
                }`}
                style={{ minHeight: 8 }}
                title={t(`treatmentCases:stages.${s}`)}
              />
            ))}
          </div>
          <div className="flex justify-between mt-4 overflow-x-auto gap-4 no-scrollbar">
            {stages.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  if (tCase.stage === 'completed') return;
                  setPendingStage(s === pendingStage ? null : s);
                }}
                className={`text-[10px] font-bold text-center min-w-[80px] transition-colors rounded py-1 ${
                  tCase.stage === 'completed' ? 'cursor-default' : 'cursor-pointer hover:text-amber-500'
                } ${
                  pendingStage === s ? 'text-amber-600 underline underline-offset-2' :
                  s === tCase.stage ? 'text-primary-600' :
                  i < currentStageIndex ? 'text-gray-400' : 'text-gray-300'
                }`}
              >
                {t(`treatmentCases:stages.${s}`)}
              </button>
            ))}
          </div>
          {!pendingStage && tCase.stage !== 'completed' && (
            <p className="text-center text-[10px] text-gray-400 mt-3 italic">{t('treatmentCases:progress.clickToChange')}</p>
          )}
        </div>
      )}

      {tCase.stage === 'lost' && (
        <div className="card p-6 bg-red-50 border-red-100 flex items-start gap-4">
          <div className="p-3 bg-red-100 rounded-2xl text-red-600">
            <XCircle size={24} />
          </div>
          <div>
            <h3 className="font-bold text-red-900">{t('treatmentCases:stages.lost')}</h3>
            <p className="text-red-700 mt-1">{t('treatmentCases:form.lostReason')}: {tCase.lostReason}</p>
            {tCase.closedAt && (
              <p className="text-xs text-red-500 mt-2">
                {t('treatmentCases:detail.closedOn', { date: formatDate(tCase.closedAt) })}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column - Financial & Summary */}
        <div className="lg:col-span-1 space-y-6">
          <div className="card p-6 space-y-6">
            <h3 className="font-bold text-gray-900 flex items-center gap-2">
              <DollarSign size={20} className="text-primary-500" />
              {t('treatmentCases:detail.financialSummary')}
            </h3>
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100">
                <p className="text-xs font-bold text-gray-400 uppercase">{t('treatmentCases:form.estimatedAmount')}</p>
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(tCase.estimatedAmount, caseCurrency)}</p>
              </div>
              <div className="p-4 rounded-2xl bg-primary-50 border border-primary-100">
                <p className="text-xs font-bold text-primary-400 uppercase">{t('treatmentCases:form.acceptedAmount')}</p>
                <p className="text-2xl font-bold text-primary-700">{formatCurrency(tCase.acceptedAmount, caseCurrency)}</p>
              </div>
              <div className="p-4 rounded-2xl bg-green-50 border border-green-100">
                <p className="text-xs font-bold text-green-400 uppercase">{t('payments:summary.totalPaid')}</p>
                <p className="text-xl font-bold text-green-700">
                  {formatCurrency(paidTotal, caseCurrency)}
                </p>
              </div>
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100">
                <p className="text-xs font-bold text-amber-400 uppercase">{t('payments:summary.remaining')}</p>
                <p className="text-xl font-bold text-amber-700">
                  {formatCurrency((tCase.acceptedAmount || tCase.estimatedAmount || 0) - paidTotal, caseCurrency)}
                </p>
              </div>
              <div className="p-4 rounded-2xl bg-blue-50 border border-blue-100">
                <p className="text-xs font-bold text-blue-400 uppercase">{t('insurance:summary.patientResponsibility')}</p>
                <p className="text-xl font-bold text-blue-700">{formatCurrency(provisionTotals.patientResponsibility, caseCurrency)}</p>
              </div>
            </div>
            <div className="pt-4 border-t border-gray-50 space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <Calendar size={16} className="text-gray-400" />
                <span className="text-gray-600">{t('treatmentCases:form.expectedStartDate')}:</span>
                <span className="font-bold">{tCase.expectedStartDate ? formatDate(tCase.expectedStartDate) : t('common:noData')}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Clock size={16} className="text-gray-400" />
                <span className="text-gray-600">{t('common:updated')}:</span>
                <span className="font-bold">{formatDate(tCase.updatedAt)}</span>
              </div>
            </div>
          </div>

          <div className="card p-6">
            <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
              <User size={20} className="text-primary-500" />
              {t('treatmentCases:detail.stakeholders')}
            </h3>
            <div className="space-y-6">
              <Link to={`/patients/${tCase.patientId}`} className="flex items-center gap-3 group">
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600 group-hover:bg-primary-50 group-hover:text-primary-600 transition-colors">
                  {tCase.patient.firstName[0]}{tCase.patient.lastName[0]}
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900 group-hover:text-primary-600 transition-colors">{tCase.patient.firstName} {tCase.patient.lastName}</p>
                  <p className="text-xs text-gray-500">{t('treatmentCases:form.patient')}</p>
                </div>
              </Link>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center text-primary-600">
                  <Stethoscope size={20} />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">
                    {tCase.practitioner ? `${tCase.practitioner.firstName} ${tCase.practitioner.lastName}` : t('common:unassigned')}
                  </p>
                  <p className="text-xs text-gray-500">{t('treatmentCases:form.practitioner')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Tabs & Activities */}
        <div className="lg:col-span-2 space-y-8">
          {/* Description */}
          <div className="card p-6">
            <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
              <FileText size={20} className="text-primary-500" />
              {t('treatmentCases:form.description')}
            </h3>
            <p className="text-gray-600 whitespace-pre-wrap">{tCase.description || t('treatmentCases:detail.noDescription')}</p>
          </div>

          {/* Related Items Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Appointments */}
            <div className="card overflow-hidden">
              <div className="p-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-sm flex items-center gap-2">
                  <Calendar size={16} className="text-gray-400" />
                  {t('common:appointments')}
                  {(tCase.appointments?.length ?? 0) > 0 && (
                    <span className="bg-primary-600 text-white text-[10px] rounded-full px-1.5 py-0.5 leading-none">
                      {tCase.appointments.length}
                    </span>
                  )}
                </h3>
                <div className="flex items-center gap-1">
                  <button
                    onClick={openLinkApptModal}
                    className="p-1 hover:bg-white rounded transition-colors text-gray-500"
                    title={t('treatmentCases:appointments.linkExisting')}
                  >
                    <LinkIcon size={15} />
                  </button>
                  <button
                    onClick={() => setIsAppointmentFormOpen(true)}
                    className="p-1 hover:bg-white rounded transition-colors text-primary-600"
                    title={t('treatmentCases:appointments.createNew')}
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
              <div className="divide-y divide-gray-50">
                {tCase.appointments?.length > 0 ? tCase.appointments.map((a: any) => (
                  <div key={a.id} className="p-3 text-sm flex justify-between items-center group">
                    <Link to={`/appointments/${a.id}`} className="flex-1 hover:text-primary-600">
                      <p className="font-bold">{a.appointmentType?.name}</p>
                      <p className="text-xs text-gray-500">
                        {formatDateTime(a.startTime)}
                        {a.practitioner && <> &bull; {a.practitioner.lastName}</>}
                      </p>
                    </Link>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`badge h-fit text-[10px] ${
                        a.status === 'completed' ? 'badge-green' :
                        a.status === 'cancelled' ? 'badge-red' :
                        a.status === 'confirmed' ? 'badge-blue' : 'bg-amber-50 text-amber-700 border border-amber-100'
                      }`}>{t(`appointments:status.${a.status}`, { defaultValue: a.status })}</span>
                      <button
                        onClick={() => handleUnlinkAppt(a.id)}
                        className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity rounded"
                        title={t('treatmentCases:appointments.unlink')}
                      >
                        <Unlink size={13} />
                      </button>
                    </div>
                  </div>
                )) : (
                  <div className="p-6 text-center text-gray-400 text-xs">
                    <p className="italic mb-2">{t('treatmentCases:appointments.empty')}</p>
                    <button onClick={() => setIsAppointmentFormOpen(true)} className="text-primary-600 font-semibold hover:underline">
                      {t('treatmentCases:appointments.createNew')} →
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Tasks */}
            <div className="card overflow-hidden">
              <div className="p-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-sm flex items-center gap-2">
                  <ClipboardList size={16} className="text-gray-400" />
                  {t('common:tasks')}
                </h3>
                <button onClick={() => setIsTaskFormOpen(true)} className="p-1 hover:bg-white rounded transition-colors text-primary-600">
                  <Plus size={16} />
                </button>
              </div>
              <div className="divide-y divide-gray-50">
                {tCase.tasks?.length > 0 ? tCase.tasks.map((tk: any) => (
                  <div key={tk.id} className="p-3 text-sm flex justify-between items-center">
                    <div>
                      <p className={`font-bold ${tk.status === 'completed' ? 'line-through text-gray-400' : ''}`}>{tk.title}</p>
                      <p className="text-xs text-gray-500">{formatDate(tk.dueDate)}</p>
                    </div>
                    <div className={`w-2 h-2 rounded-full ${tk.status === 'completed' ? 'bg-green-400' : 'bg-blue-400'}`}></div>
                  </div>
                )) : (
                  <p className="p-6 text-center text-gray-400 text-xs italic">{t('tasks:noRelatedTasks')}</p>
                )}
              </div>
            </div>

            {/* Payments List */}
            <div className="card overflow-hidden">
              <div className="p-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-sm flex items-center gap-2">
                  <DollarSign size={16} className="text-gray-400" />
                  {t('payments:title')}
                </h3>
                <button onClick={() => setIsPaymentFormOpen(true)} className="p-1 hover:bg-white rounded transition-colors text-primary-600">
                  <Plus size={16} />
                </button>
              </div>
              <div className="divide-y divide-gray-50">
                {payments.length > 0 ? payments.map((p: any) => (
                  <div key={p.id} className="p-3 text-sm flex justify-between items-center">
                    <div>
                      <p className="font-bold">{formatCurrency(p.amount, p.currency || caseCurrency)}</p>
                      <p className="text-[10px] text-gray-500 capitalize">
                        {t(`payments:methods.${p.paymentMethod}`, { defaultValue: p.paymentMethod.replace('_', ' ') })} &bull; {formatDate(p.paidAt)}
                      </p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${
                      p.paymentStatus === 'paid' ? 'bg-green-50 text-green-700 border-green-100' : 'bg-amber-50 text-amber-700'
                    }`}>
                      {t(`payments:status.${p.paymentStatus}`)}
                    </span>
                  </div>
                )) : (
                  <p className="p-6 text-center text-gray-400 text-xs italic">{t('payments:noRelatedPayments')}</p>
                )}
              </div>
            </div>

            {/* Insurance Provisions */}
            <div className="card overflow-hidden md:col-span-2">
              <div className="p-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-sm flex items-center gap-2">
                  <FileText size={16} className="text-gray-400" />
                  {t('insurance:title')}
                </h3>
                <button onClick={() => setIsInsuranceFormOpen(true)} className="p-1 hover:bg-white rounded transition-colors text-primary-600">
                  <Plus size={16} />
                </button>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 border-b border-gray-50">
                <div>
                  <p className="text-[10px] uppercase font-bold text-gray-400">{t('insurance:fields.requestedAmount')}</p>
                  <p className="font-bold">{formatCurrency(provisionTotals.requested, caseCurrency)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-gray-400">{t('insurance:fields.approvedAmount')}</p>
                  <p className="font-bold">{formatCurrency(provisionTotals.approved, caseCurrency)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-gray-400">{t('insurance:fields.patientResponsibility')}</p>
                  <p className="font-bold">{formatCurrency(provisionTotals.patientResponsibility, caseCurrency)}</p>
                </div>
              </div>
              <div className="divide-y divide-gray-50">
                {insuranceProvisions.length > 0 ? insuranceProvisions.map((provision: any) => (
                  <div key={provision.id} className="p-3 text-sm flex justify-between items-center">
                    <div>
                      <Link to={`/insurance-provisions/${provision.id}`} className="font-bold hover:text-primary-600">{provision.insuranceProviderName}</Link>
                      <p className="text-xs text-gray-500">{t(`insurance:types.${provision.insuranceType}`)} &bull; {formatCurrency(provision.requestedAmount, provision.currency || caseCurrency)}</p>
                    </div>
                    <div className="text-right">
                      <span className="badge badge-blue text-[10px]">{t(`insurance:statuses.${provision.status}`)}</span>
                      {provision.patientResponsibilityAmount > 0 && (
                        <button
                          onClick={() => {
                            setPaymentInitialData({
                              patientId: tCase.patientId,
                              treatmentCaseId: tCase.id,
                              amount: provision.patientResponsibilityAmount,
                              currency: provision.currency,
                              notes: t('insurance:notes.patientResponsibilityFor', { provider: provision.insuranceProviderName }),
                            });
                            setIsPaymentFormOpen(true);
                          }}
                          className="block text-[10px] text-primary-600 font-bold mt-2 hover:underline"
                        >
                          {t('insurance:actions.createPatientPayment')}
                        </button>
                      )}
                    </div>
                  </div>
                )) : (
                  <p className="p-6 text-center text-gray-400 text-xs italic">{t('common:noData')}</p>
                )}
              </div>
            </div>

            {/* Treatment Plan Procedures */}
            <div className="card overflow-hidden md:col-span-2">
              <div className="p-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-sm flex items-center gap-2">
                  <ClipboardList size={16} className="text-gray-400" />
                  {t('treatmentCases:procedures.title')}
                  {procedures.filter((p) => p.status !== 'cancelled').length > 0 && (
                    <span className="bg-blue-600 text-white text-[10px] rounded-full px-1.5 py-0.5 leading-none">
                      {procedures.filter((p) => p.status !== 'cancelled').length}
                    </span>
                  )}
                </h3>
                <div className="flex items-center gap-1">
                  <button
                    onClick={openPackageModal}
                    className="p-1 hover:bg-white rounded transition-colors text-indigo-600"
                    title={t('treatmentCases:packages.add')}
                  >
                    <Package size={16} />
                  </button>
                  <button
                    onClick={() => openProcForm()}
                    className="p-1 hover:bg-white rounded transition-colors text-primary-600"
                    title={t('treatmentCases:procedures.add')}
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
              {proceduresError ? (
                <div className="p-6 text-center text-red-500 text-xs">
                  <AlertCircle className="mx-auto mb-2" size={20} />
                  {proceduresError}
                </div>
              ) : procedures.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-xs italic">
                  {t('treatmentCases:procedures.empty')}{' '}
                  <button onClick={() => openProcForm()} className="text-primary-600 font-semibold hover:underline">
                    {t('treatmentCases:procedures.add')} →
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {procedures.map((proc: any) => {
                    const cfg = PROC_STATUS[proc.status as keyof typeof PROC_STATUS] ?? PROC_STATUS.planned;
                    return (
                      <div key={proc.id} className="p-3 flex items-start gap-3 group">
                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${cfg.dot}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-gray-900">{proc.procedureName}</span>
                            {proc.toothFdi && (
                              <span className="text-xs bg-white border border-gray-200 px-1.5 py-0.5 rounded font-mono">
                                {t('patients:dentalChart.toothWithNumber', { number: proc.toothFdi })}
                              </span>
                            )}
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.badge}`}>
                              {t(`patients:dentalChart.procedureStatus.${proc.status}`, { defaultValue: proc.status })}
                            </span>
                            {proc.packageApplication?.treatmentPackage && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-indigo-50 text-indigo-700 border-indigo-100 flex items-center gap-1">
                                <Package size={11} />
                                {proc.packageApplication.treatmentPackage.name}
                              </span>
                            )}
                          </div>
                          {proc.notes && <p className="text-xs text-gray-500 mt-0.5">{proc.notes}</p>}
                          {proc.stockDeductionStatus === 'failed' && proc.stockDeductionError && (
                            <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                              <AlertCircle size={12} />
                              {proc.stockDeductionError}
                            </p>
                          )}
                          {proc.estimatedCost && (
                            <p className="text-xs text-gray-400 mt-0.5">{t('patients:dentalChart.estimated')}: {formatCurrency(Number(proc.estimatedCost), caseCurrency)}</p>
                          )}
                          {proc.scheduledDate && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              📅 {formatDate(proc.scheduledDate)}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <button
                            onClick={() => openProcForm(proc)}
                            className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-700"
                            title={t('common:edit')}
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => handleProcDelete(proc.id)}
                            className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"
                            title={t('common:delete')}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Treatment Materials */}
          <div className="card overflow-hidden">
            <div className="p-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <Package size={16} className="text-gray-400" />
                {t('treatmentCases:materials.title')}
                {materials.length > 0 && (
                  <span className="bg-indigo-600 text-white text-[10px] rounded-full px-1.5 py-0.5 leading-none">{materials.length}</span>
                )}
              </h3>
            </div>
            {/* Add material form */}
            <div className="p-4 border-b border-gray-100 bg-white">
              {matError && <p className="text-xs text-red-600 mb-2">{matError}</p>}
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-36">
                  <label className="block text-xs font-semibold text-gray-500 mb-1">{t('treatmentCases:materials.item')}</label>
                  <select
                    className="input-field text-sm py-1.5"
                    value={matItemId}
                    onChange={e => setMatItemId(e.target.value)}
                  >
                    <option value="">— {t('common:select')} —</option>
                    {inventoryItems.map((item: any) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({t('treatmentCases:materials.stock')}: {item.currentStock} {item.unit})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-24">
                  <label className="block text-xs font-semibold text-gray-500 mb-1">{t('treatmentCases:materials.quantity')}</label>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    className="input-field text-sm py-1.5"
                    placeholder="0"
                    value={matQty}
                    onChange={e => setMatQty(e.target.value)}
                  />
                </div>
                <div className="flex-1 min-w-24">
                  <label className="block text-xs font-semibold text-gray-500 mb-1">{t('treatmentCases:materials.noteOptional')}</label>
                  <input
                    type="text"
                    className="input-field text-sm py-1.5"
                    placeholder={t('treatmentCases:materials.notePlaceholder')}
                    value={matNotes}
                    onChange={e => setMatNotes(e.target.value)}
                  />
                </div>
                <button
                  disabled={!matItemId || !matQty || matSaving}
                  onClick={async () => {
                    if (!id || !matItemId || !matQty) return;
                    setMatSaving(true);
                    setMatError(null);
                    try {
                      await treatmentCaseService.addMaterial(id, {
                        itemId: matItemId,
                        quantity: Number(matQty),
                        notes: matNotes || undefined,
                      });
                      setMatItemId('');
                      setMatQty('');
                      setMatNotes('');
                      const matRes = await treatmentCaseService.getMaterials(id);
                      setMaterials(matRes.data);
                      const invRes = await inventoryService.getAll({ isActive: 'true' });
                      setInventoryItems(invRes.data);
                    } catch (err: any) {
                      setMatError(err.response?.data?.error || t('treatmentCases:materials.errors.addFailed'));
                    } finally {
                      setMatSaving(false);
                    }
                  }}
                  className="btn-primary py-1.5 text-sm flex-shrink-0"
                >
                  {matSaving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  {t('common:add')}
                </button>
              </div>
            </div>
            {/* Materials list */}
            {materials.length === 0 ? (
              <p className="p-4 text-xs text-gray-400 italic text-center">{t('treatmentCases:materials.empty')}</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {materials.map((m: any) => (
                  <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 group">
                    <Package size={14} className="text-indigo-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-gray-900">{m.item?.name}</span>
                      <span className="text-xs text-gray-400 ml-2">{m.quantity} {m.item?.unit}</span>
                      {m.notes && <span className="text-xs text-gray-400 ml-2">— {m.notes}</span>}
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">
                      {formatDate(m.createdAt)}
                    </span>
                    <button
                      onClick={async () => {
                        if (!id || !window.confirm(t('treatmentCases:materials.confirmDelete'))) return;
                        try {
                          await treatmentCaseService.removeMaterial(id, m.id);
                          const matRes = await treatmentCaseService.getMaterials(id);
                          setMaterials(matRes.data);
                          const invRes = await inventoryService.getAll({ isActive: 'true' });
                          setInventoryItems(invRes.data);
                        } catch {
                          alert(t('treatmentCases:materials.errors.deleteFailed'));
                        }
                      }}
                      className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-50 rounded text-gray-400 hover:text-red-600 transition-all"
                      title={t('common:delete')}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Activity Timeline */}
          <div className="card p-6">
            <h3 className="font-bold mb-6 flex items-center gap-2">
              <Clock size={20} className="text-primary-500" />
              {t('treatmentCases:activity.title')}
            </h3>
            <div className="space-y-8 relative before:absolute before:left-4 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-100">
              {tCase.activityLogs?.length > 0 ? tCase.activityLogs.map((log: any) => (
                <div key={log.id} className="relative pl-10">
                  <div className={`absolute left-0 top-1 w-8 h-8 rounded-full border-4 border-white flex items-center justify-center ${
                    log.action === 'created' ? 'bg-green-500 text-white' : 
                    log.action.startsWith('stage_') ? 'bg-blue-500 text-white' : 
                    log.action === 'amount_updated' ? 'bg-amber-500 text-white' : 'bg-gray-400 text-white'
                  }`}>
                    {log.action === 'created' ? <Plus size={14} /> : 
                     log.action === 'amount_updated' ? <DollarSign size={14} /> : <TrendingUp size={14} />}
                  </div>
                  <div>
                    <p className="text-sm text-gray-900 font-medium">{log.description}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {t('treatmentCases:activity.byUser', {
                        user: `${log.user.firstName} ${log.user.lastName}`,
                        date: formatDateTime(log.createdAt),
                      })}
                    </p>
                  </div>
                </div>
              )) : (
                <div className="text-center text-gray-400 italic">{t('treatmentCases:activity.empty')}</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {isEditOpen && (
        <TreatmentCaseForm 
          onClose={() => setIsEditOpen(false)} 
          onSuccess={() => {
            setIsEditOpen(false);
            fetchDetail();
          }}
          initialData={tCase}
        />
      )}

      {isTaskFormOpen && (
        <TaskForm 
          patientId={tCase.patientId}
          onClose={() => setIsTaskFormOpen(false)}
          onSuccess={() => {
            setIsTaskFormOpen(false);
            fetchDetail();
          }}
        />
      )}

      {isPaymentFormOpen && (
        <PaymentForm 
          patientId={tCase.patientId}
          treatmentCaseId={tCase.id}
          initialData={paymentInitialData}
          onClose={() => {
            setIsPaymentFormOpen(false);
            setPaymentInitialData(null);
          }}
          onSuccess={() => {
            setIsPaymentFormOpen(false);
            setPaymentInitialData(null);
            fetchDetail();
          }}
        />
      )}

      {isInsuranceFormOpen && (
        <InsuranceProvisionForm
          patientId={tCase.patientId}
          treatmentCaseId={tCase.id}
          requestedAmount={tCase.estimatedAmount || tCase.acceptedAmount || 0}
          currency={caseCurrency}
          onClose={() => setIsInsuranceFormOpen(false)}
          onSuccess={() => {
            setIsInsuranceFormOpen(false);
            fetchDetail();
          }}
        />
      )}

      {isMessageModalOpen && (
        <PrepareMessageModal 
          patientId={tCase.patientId}
          treatmentCaseId={tCase.id}
          onClose={() => setIsMessageModalOpen(false)}
          onSuccess={() => {
            setIsMessageModalOpen(false);
            fetchDetail();
          }}
        />
      )}

      {/* Package treatment modal */}
      {isPackageModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4">
          <div className="card p-0 w-full max-w-4xl shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <Package size={18} className="text-indigo-500" />
                  {t('treatmentCases:packages.add')}
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  {t('treatmentCases:packages.description')}
                </p>
              </div>
              <button onClick={() => setIsPackageModalOpen(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                <XCircle size={18} className="text-gray-400" />
              </button>
            </div>

            <div className="p-5 max-h-[75vh] overflow-y-auto">
              {packageError && (
                <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm flex items-center gap-2 mb-4">
                  <AlertCircle size={16} />
                  {packageError}
                </div>
              )}

              {packageLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="animate-spin text-primary-600" size={32} />
                </div>
              ) : treatmentPackages.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm italic">
                  {t('treatmentCases:packages.empty')}
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                  <div className="lg:col-span-2 space-y-2">
                    {treatmentPackages.map((pkg) => (
                      <button
                        key={pkg.id}
                        type="button"
                        onClick={() => setSelectedPackageId(pkg.id)}
                        className={`w-full text-left p-4 rounded-xl border transition-colors ${
                          selectedPackageId === pkg.id
                            ? 'border-indigo-200 bg-indigo-50'
                            : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-bold text-gray-900">{pkg.name}</p>
                          <span className="text-xs font-bold text-primary-600">
                            {formatCurrency(Number(pkg.price ?? 0), pkg.currency || caseCurrency)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {pkg.items?.length || 0} {t('services:tabs.services')}
                          {pkg.materials?.length ? ` / ${t('services:materials.extraMaterialsCount', { count: pkg.materials.length })}` : ''}
                        </p>
                      </button>
                    ))}
                  </div>

                  <div className="lg:col-span-3 border border-gray-100 rounded-xl overflow-hidden">
                    {selectedPackage ? (
                      <>
                        <div className="p-4 bg-gray-50 border-b border-gray-100">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <h4 className="font-bold text-gray-900">{selectedPackage.name}</h4>
                              {selectedPackage.description && <p className="text-sm text-gray-500 mt-1">{selectedPackage.description}</p>}
                            </div>
                            <span className="badge badge-blue">
                              {selectedPackage.pricingMode === 'SERVICE_SUM'
                                ? t('services:packages.pricing.serviceSum')
                                : t('services:packages.pricing.packagePrice')}
                            </span>
                          </div>
                        </div>

                        <div className="p-4 space-y-4">
                          <div>
                            <h5 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">
                              {t('treatmentCases:packages.includedServices')}
                            </h5>
                            <div className="space-y-2">
                              {selectedPackage.items?.map((item: any) => (
                                <div key={item.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-white border border-gray-100">
                                  <div>
                                    <p className="text-sm font-semibold text-gray-900">{item.service?.name}</p>
                                    <p className="text-xs text-gray-500">
                                      {item.quantity} adet
                                      {item.overrideDurationMin || item.service?.durationMinutes ? ` / ${item.overrideDurationMin || item.service?.durationMinutes} dk` : ''}
                                    </p>
                                  </div>
                                  <span className="text-sm font-semibold text-primary-600">
                                    {formatCurrency(Number(item.overridePrice ?? item.service?.basePrice ?? 0), selectedPackage.currency || caseCurrency)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div>
                            <h5 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">
                              {t('services:materials.packageTitle')}
                            </h5>
                            {selectedPackage.materials?.length ? (
                              <div className="space-y-2">
                                {selectedPackage.materials.map((material: any) => (
                                  <div key={material.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-gray-50">
                                    <span className="text-sm text-gray-700">{material.inventoryItem?.name}</span>
                                    <span className="text-xs font-semibold text-gray-500">{material.quantity} {material.unit || material.inventoryItem?.unit}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-gray-400 italic">{t('services:materials.empty')}</p>
                            )}
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="p-6 text-center text-gray-400 text-sm italic">
                        {t('common:select')}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="p-5 border-t border-gray-100 flex gap-3">
              <button onClick={() => setIsPackageModalOpen(false)} className="btn-secondary flex-1">
                {t('common:cancel')}
              </button>
              <button
                onClick={() => applySelectedPackage(false)}
                disabled={packageSaving || !selectedPackageId}
                className="btn-primary flex-1"
              >
                {packageSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {t('treatmentCases:packages.apply')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Procedure add/edit modal */}
      {isProcFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4">
          <div className="card p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <ClipboardList size={18} className="text-primary-500" />
                {editingProc ? t('treatmentCases:procedures.edit') : t('treatmentCases:procedures.add')}
              </h3>
              <button onClick={() => setIsProcFormOpen(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                <XCircle size={18} className="text-gray-400" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="label">{t('treatmentCases:procedures.fields.name')} *</label>
                <input
                  type="text"
                  value={procForm.procedureName}
                  onChange={(e) => setProcForm((f) => ({ ...f, procedureName: e.target.value }))}
                  placeholder={t('treatmentCases:procedures.placeholders.name')}
                  className="input-field"
                  autoFocus
                />
              </div>

              {services.length > 0 && (
                <div>
                  <label className="label">{t('treatmentCases:procedures.fields.service')} <span className="text-gray-400 font-normal">- {t('treatmentCases:procedures.optional')}</span></label>
                  <select
                    className="input-field"
                    value={procForm.serviceId}
                    onChange={(e) => {
                      const svcId = e.target.value;
                      const svc = services.find((s: any) => s.id === svcId);
                      setProcForm((f) => ({
                        ...f,
                        serviceId: svcId,
                        estimatedCost: svcId && svc?.basePrice != null && f.estimatedCost === ''
                          ? String(svc.basePrice)
                          : f.estimatedCost,
                      }));
                    }}
                  >
                    <option value="">— {t('treatmentCases:procedures.selectService')} —</option>
                    {services.map((svc: any) => (
                      <option key={svc.id} value={svc.id}>
                        {svc.name}{svc.basePrice != null ? ` - ${formatCurrency(svc.basePrice, svc.currency || caseCurrency)}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('treatmentCases:procedures.fields.toothFdi')} <span className="text-gray-400 font-normal">- {t('treatmentCases:procedures.optional')}</span></label>
                  <input
                    type="number"
                    value={procForm.toothFdi}
                    onChange={(e) => setProcForm((f) => ({ ...f, toothFdi: e.target.value }))}
                    placeholder={t('treatmentCases:procedures.placeholders.toothFdi')}
                    min={11}
                    max={48}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="label">{t('treatmentCases:procedures.fields.estimatedCost')} <span className="text-gray-400 font-normal">- {t('treatmentCases:procedures.optional')}</span></label>
                  <input
                    type="number"
                    value={procForm.estimatedCost}
                    onChange={(e) => setProcForm((f) => ({ ...f, estimatedCost: e.target.value }))}
                    placeholder="0"
                    min={0}
                    className="input-field"
                  />
                </div>
              </div>

              <div>
                <label className="label">{t('treatmentCases:procedures.fields.scheduledDate')} <span className="text-gray-400 font-normal">- {t('treatmentCases:procedures.optional')}</span></label>
                <input
                  type="date"
                  value={procForm.scheduledDate}
                  onChange={(e) => setProcForm((f) => ({ ...f, scheduledDate: e.target.value }))}
                  className="input-field"
                />
              </div>

              <div>
                <label className="label">{t('treatmentCases:procedures.fields.status')}</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(Object.entries(PROC_STATUS) as [string, typeof PROC_STATUS[keyof typeof PROC_STATUS]][]).map(([s, cfg]) => (
                    <button
                      key={s}
                      onClick={() => setProcForm((f) => ({ ...f, status: s }))}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-xs font-medium transition-all ${
                        procForm.status === s
                          ? `${cfg.badge} border-current`
                          : 'bg-gray-50 dark:bg-gray-700 text-gray-500 border-gray-200 dark:border-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                      {t(`patients:dentalChart.procedureStatus.${s}`, { defaultValue: s })}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">{t('treatmentCases:procedures.fields.notes')} <span className="text-gray-400 font-normal">- {t('treatmentCases:procedures.optional')}</span></label>
                <textarea
                  value={procForm.notes}
                  onChange={(e) => setProcForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  maxLength={500}
                  placeholder={t('treatmentCases:procedures.placeholders.notes')}
                  className="input-field resize-none"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={handleProcSave}
                disabled={procSaving || !procForm.procedureName.trim()}
                className="btn-primary flex-1"
              >
                {procSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {editingProc ? t('common:save') : t('common:add')}
              </button>
              <button onClick={() => setIsProcFormOpen(false)} className="btn-secondary">
                {t('common:cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Appointment Form Modal */}
      {isAppointmentFormOpen && (
        <AppointmentForm
          onClose={() => setIsAppointmentFormOpen(false)}
          onSuccess={() => {
            setIsAppointmentFormOpen(false);
            fetchDetail();
          }}
          initialData={{
            patientId: tCase.patientId,
            treatmentCaseId: tCase.id,
          }}
        />
      )}

      {/* Link Existing Appointment Modal */}
      {isLinkApptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4">
          <div className="card p-6 w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <LinkIcon size={18} className="text-primary-500" />
                {t('treatmentCases:appointments.linkExisting')}
              </h3>
              <button onClick={() => setIsLinkApptOpen(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                <XCircle size={18} className="text-gray-400" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              {t('treatmentCases:appointments.linkModalDescription', {
                patient: `${tCase.patient.firstName} ${tCase.patient.lastName}`,
              })}
            </p>
            <div className="overflow-y-auto flex-1 divide-y divide-gray-100">
              {linkLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="animate-spin text-primary-600" size={28} />
                </div>
              ) : linkableAppts.length === 0 ? (
                <p className="text-center text-gray-400 text-sm italic py-8">
                  {t('treatmentCases:appointments.noLinkable')}<br />
                  <button onClick={() => { setIsLinkApptOpen(false); setIsAppointmentFormOpen(true); }} className="text-primary-600 font-semibold hover:underline mt-2">
                    {t('treatmentCases:appointments.createNew')} →
                  </button>
                </p>
              ) : (
                linkableAppts.map((a: any) => (
                  <button
                    key={a.id}
                    onClick={() => handleLinkAppt(a.id)}
                    className="w-full p-3 text-left hover:bg-primary-50 transition-colors flex justify-between items-center"
                  >
                    <div>
                      <p className="font-semibold text-sm">{a.appointmentType?.name}</p>
                      <p className="text-xs text-gray-500">
                        {formatDateTime(a.startTime)}
                        {a.practitioner && <> &bull; {a.practitioner.lastName}</>}
                        {a.treatmentCase && <span className="text-amber-600"> &bull; {a.treatmentCase.title}</span>}
                      </p>
                    </div>
                    <span className={`badge text-[10px] flex-shrink-0 ${
                      a.status === 'completed' ? 'badge-green' :
                      a.status === 'cancelled' ? 'badge-red' :
                      a.status === 'confirmed' ? 'badge-blue' : 'bg-amber-50 text-amber-700 border border-amber-100'
                    }`}>{t(`appointments:status.${a.status}`, { defaultValue: a.status })}</span>
                  </button>
                ))
              )}
            </div>
            <div className="mt-4 pt-4 border-t border-gray-100">
              <button onClick={() => setIsLinkApptOpen(false)} className="btn-secondary w-full">
                {t('common:close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TreatmentCaseDetail;
