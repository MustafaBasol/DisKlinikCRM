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
  Unlink
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { treatmentCaseService, paymentService, insuranceProvisionService, treatmentPlanProceduresService, appointmentService } from '../services/api';
import TreatmentCaseForm from '../components/TreatmentCaseForm';
import TaskForm from '../components/TaskForm';
import PaymentForm from '../components/PaymentForm';
import PrepareMessageModal from '../components/PrepareMessageModal';
import InsuranceProvisionForm from '../components/InsuranceProvisionForm';
import AppointmentForm from '../components/AppointmentForm';

const TreatmentCaseDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(['treatmentCases', 'common', 'tasks', 'appointments', 'messages', 'insurance', 'payments']);
  
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

  // Treatment procedures
  const [procedures, setProcedures] = useState<any[]>([]);
  const [isProcFormOpen, setIsProcFormOpen] = useState(false);
  const [editingProc, setEditingProc] = useState<any | null>(null);
  const [procSaving, setProcSaving] = useState(false);
  const [procForm, setProcForm] = useState({
    procedureName: '',
    toothFdi: '',
    status: 'planned',
    estimatedCost: '',
    notes: '',
  });

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await treatmentCaseService.getById(id);
      setTCase(res.data);
      
      const payRes = await paymentService.getAll({ treatmentCaseId: id });
      setPayments(payRes.data);

      const insuranceRes = await insuranceProvisionService.getAll({ treatment_case_id: id });
      setInsuranceProvisions(insuranceRes.data);

      const procRes = await treatmentPlanProceduresService.getByCaseId(id);
      setProcedures(procRes.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch details');
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
      alert(err.response?.data?.error || 'Update failed');
    } finally {
      setStageSaving(false);
    }
  };

  const openProcForm = (proc?: any) => {
    if (proc) {
      setEditingProc(proc);
      setProcForm({
        procedureName: proc.procedureName,
        toothFdi: proc.toothFdi ? String(proc.toothFdi) : '',
        status: proc.status,
        estimatedCost: proc.estimatedCost ? String(proc.estimatedCost) : '',
        notes: proc.notes ?? '',
      });
    } else {
      setEditingProc(null);
      setProcForm({ procedureName: '', toothFdi: '', status: 'planned', estimatedCost: '', notes: '' });
    }
    setIsProcFormOpen(true);
  };

  const handleProcSave = async () => {
    if (!procForm.procedureName.trim() || !id) return;
    setProcSaving(true);
    const payload = {
      procedureName: procForm.procedureName.trim(),
      toothFdi: procForm.toothFdi ? parseInt(procForm.toothFdi) : null,
      status: procForm.status,
      estimatedCost: procForm.estimatedCost ? parseFloat(procForm.estimatedCost) : null,
      notes: procForm.notes.trim() || null,
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
      alert(err.response?.data?.error || 'Failed to save procedure');
    } finally {
      setProcSaving(false);
    }
  };

  const handleProcDelete = async (procId: string) => {
    if (!id || !window.confirm('Prosedür silinsin mi?')) return;
    try {
      await treatmentPlanProceduresService.remove(id, procId);
      setProcedures((prev) => prev.filter((p) => p.id !== procId));
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete');
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
      alert(err.response?.data?.error || 'Bağlantı kurulamadı');
    }
  };

  const handleUnlinkAppt = async (apptId: string) => {
    if (!window.confirm('Bu randevunun tedavi dosyası bağlantısı kaldırılsın mı?')) return;
    try {
      await appointmentService.linkTreatmentCase(apptId, null);
      fetchDetail();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Bağlantı kaldırılamadı');
    }
  };
  const PROC_STATUS = {
    planned:     { label: 'Planlandı',    dot: 'bg-amber-400',   badge: 'bg-amber-50 text-amber-700 border-amber-100' },
    in_progress: { label: 'Devam Ediyor', dot: 'bg-blue-500',    badge: 'bg-blue-50 text-blue-700 border-blue-100' },
    completed:   { label: 'Tamamlandı',   dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
    cancelled:   { label: 'İptal',        dot: 'bg-gray-400',    badge: 'bg-gray-50 text-gray-500 border-gray-200' },
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
        <p className="text-xl font-bold">{error || 'Treatment Case not found'}</p>
        <button onClick={() => navigate('/treatment-cases')} className="mt-4 btn-secondary">
          Back to Pipeline
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
                  Kaydet
                </button>
                <button
                  onClick={() => setPendingStage(null)}
                  className="px-2 py-1 text-xs font-bold text-gray-500 hover:text-gray-700 rounded-lg transition-colors"
                >
                  İptal
                </button>
              </div>
            ) : (
              <span className="text-xs font-bold text-primary-600">
                {Math.round(((currentStageIndex + 1) / stages.length) * 100)}% Complete
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
            <p className="text-center text-[10px] text-gray-400 mt-3 italic">Aşamaya tıklayarak değiştirebilirsiniz</p>
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
              <p className="text-xs text-red-500 mt-2">Closed on {new Date(tCase.closedAt).toLocaleDateString()}</p>
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
              Financial Summary
            </h3>
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100">
                <p className="text-xs font-bold text-gray-400 uppercase">{t('treatmentCases:form.estimatedAmount')}</p>
                <p className="text-2xl font-bold text-gray-900">{tCase.estimatedAmount?.toLocaleString()} <span className="text-sm font-normal text-gray-500">{tCase.currency}</span></p>
              </div>
              <div className="p-4 rounded-2xl bg-primary-50 border border-primary-100">
                <p className="text-xs font-bold text-primary-400 uppercase">{t('treatmentCases:form.acceptedAmount')}</p>
                <p className="text-2xl font-bold text-primary-700">{tCase.acceptedAmount?.toLocaleString()} <span className="text-sm font-normal text-primary-500">{tCase.currency}</span></p>
              </div>
              <div className="p-4 rounded-2xl bg-green-50 border border-green-100">
                <p className="text-xs font-bold text-green-400 uppercase">{t('payments:summary.totalPaid')}</p>
                <p className="text-xl font-bold text-green-700">
                  {payments.filter(p => p.paymentStatus === 'paid').reduce((acc, curr) => acc + curr.amount, 0).toLocaleString()} <span className="text-sm font-normal text-green-500">{tCase.currency}</span>
                </p>
              </div>
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100">
                <p className="text-xs font-bold text-amber-400 uppercase">{t('payments:summary.remaining')}</p>
                <p className="text-xl font-bold text-amber-700">
                  {( (tCase.acceptedAmount || tCase.estimatedAmount || 0) - payments.filter(p => p.paymentStatus === 'paid').reduce((acc, curr) => acc + curr.amount, 0) ).toLocaleString()} <span className="text-sm font-normal text-amber-500">{tCase.currency}</span>
                </p>
              </div>
              <div className="p-4 rounded-2xl bg-blue-50 border border-blue-100">
                <p className="text-xs font-bold text-blue-400 uppercase">{t('insurance:summary.patientResponsibility')}</p>
                <p className="text-xl font-bold text-blue-700">{provisionTotals.patientResponsibility.toLocaleString()} <span className="text-sm font-normal text-blue-500">{tCase.currency || 'TRY'}</span></p>
              </div>
            </div>
            <div className="pt-4 border-t border-gray-50 space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <Calendar size={16} className="text-gray-400" />
                <span className="text-gray-600">{t('treatmentCases:form.expectedStartDate')}:</span>
                <span className="font-bold">{tCase.expectedStartDate ? new Date(tCase.expectedStartDate).toLocaleDateString() : t('common:noData')}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Clock size={16} className="text-gray-400" />
                <span className="text-gray-600">{t('common:updated')}:</span>
                <span className="font-bold">{new Date(tCase.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          <div className="card p-6">
            <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
              <User size={20} className="text-primary-500" />
              Stakeholders
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
                    {tCase.practitioner ? `Dt. ${tCase.practitioner.firstName} ${tCase.practitioner.lastName}` : t('common:unassigned')}
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
            <p className="text-gray-600 whitespace-pre-wrap">{tCase.description || 'No description provided.'}</p>
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
                    title="Mevcut randevu bağla"
                  >
                    <LinkIcon size={15} />
                  </button>
                  <button
                    onClick={() => setIsAppointmentFormOpen(true)}
                    className="p-1 hover:bg-white rounded transition-colors text-primary-600"
                    title="Yeni randevu oluştur"
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
                        {new Date(a.startTime).toLocaleDateString('tr-TR')} {new Date(a.startTime).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                        {a.practitioner && <> &bull; Dt. {a.practitioner.lastName}</>}
                      </p>
                    </Link>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`badge h-fit text-[10px] ${
                        a.status === 'completed' ? 'badge-green' :
                        a.status === 'cancelled' ? 'badge-red' :
                        a.status === 'confirmed' ? 'badge-blue' : 'bg-amber-50 text-amber-700 border border-amber-100'
                      }`}>{a.status}</span>
                      <button
                        onClick={() => handleUnlinkAppt(a.id)}
                        className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity rounded"
                        title="Bağlantıyı kaldır"
                      >
                        <Unlink size={13} />
                      </button>
                    </div>
                  </div>
                )) : (
                  <div className="p-6 text-center text-gray-400 text-xs">
                    <p className="italic mb-2">Bu tedaviyle ilişkili randevu yok.</p>
                    <button onClick={() => setIsAppointmentFormOpen(true)} className="text-primary-600 font-semibold hover:underline">
                      Randevu oluştur →
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
                      <p className="text-xs text-gray-500">{new Date(tk.dueDate).toLocaleDateString()}</p>
                    </div>
                    <div className={`w-2 h-2 rounded-full ${tk.status === 'completed' ? 'bg-green-400' : 'bg-blue-400'}`}></div>
                  </div>
                )) : (
                  <p className="p-6 text-center text-gray-400 text-xs italic">No related tasks.</p>
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
                      <p className="font-bold">{p.amount.toLocaleString()} {p.currency}</p>
                      <p className="text-[10px] text-gray-500 capitalize">{p.paymentMethod.replace('_', ' ')} • {new Date(p.paidAt).toLocaleDateString()}</p>
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
                  <p className="font-bold">{provisionTotals.requested.toLocaleString()} {tCase.currency || 'TRY'}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-gray-400">{t('insurance:fields.approvedAmount')}</p>
                  <p className="font-bold">{provisionTotals.approved.toLocaleString()} {tCase.currency || 'TRY'}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-gray-400">{t('insurance:fields.patientResponsibility')}</p>
                  <p className="font-bold">{provisionTotals.patientResponsibility.toLocaleString()} {tCase.currency || 'TRY'}</p>
                </div>
              </div>
              <div className="divide-y divide-gray-50">
                {insuranceProvisions.length > 0 ? insuranceProvisions.map((provision: any) => (
                  <div key={provision.id} className="p-3 text-sm flex justify-between items-center">
                    <div>
                      <Link to={`/insurance-provisions/${provision.id}`} className="font-bold hover:text-primary-600">{provision.insuranceProviderName}</Link>
                      <p className="text-xs text-gray-500">{t(`insurance:types.${provision.insuranceType}`)} • {provision.requestedAmount?.toLocaleString()} {provision.currency}</p>
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
                              notes: `${provision.insuranceProviderName} için hasta katılım tutarı`,
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
                  Tedavi Planı Prosedürleri
                  {procedures.filter((p) => p.status !== 'cancelled').length > 0 && (
                    <span className="bg-blue-600 text-white text-[10px] rounded-full px-1.5 py-0.5 leading-none">
                      {procedures.filter((p) => p.status !== 'cancelled').length}
                    </span>
                  )}
                </h3>
                <button
                  onClick={() => openProcForm()}
                  className="p-1 hover:bg-white rounded transition-colors text-primary-600"
                  title="Prosedür Ekle"
                >
                  <Plus size={16} />
                </button>
              </div>
              {procedures.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-xs italic">
                  Henüz prosedür eklenmemiş.{' '}
                  <button onClick={() => openProcForm()} className="text-primary-600 font-semibold hover:underline">
                    Ekle →
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
                                Diş {proc.toothFdi}
                              </span>
                            )}
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.badge}`}>
                              {cfg.label}
                            </span>
                          </div>
                          {proc.notes && <p className="text-xs text-gray-500 mt-0.5">{proc.notes}</p>}
                          {proc.estimatedCost && (
                            <p className="text-xs text-gray-400 mt-0.5">Tahmini: {Number(proc.estimatedCost).toLocaleString('tr-TR')} ₺</p>
                          )}
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <button
                            onClick={() => openProcForm(proc)}
                            className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-700"
                            title="Düzenle"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => handleProcDelete(proc.id)}
                            className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600"
                            title="Sil"
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

          {/* Activity Timeline */}
          <div className="card p-6">
            <h3 className="font-bold mb-6 flex items-center gap-2">
              <Clock size={20} className="text-primary-500" />
              Activity History
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
                      by {log.user.firstName} {log.user.lastName} • {new Date(log.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              )) : (
                <div className="text-center text-gray-400 italic">No activity recorded.</div>
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
          currency={tCase.currency || 'TRY'}
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

      {/* Procedure add/edit modal */}
      {isProcFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4">
          <div className="card p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <ClipboardList size={18} className="text-primary-500" />
                {editingProc ? 'Prosedürü Düzenle' : 'Prosedür Ekle'}
              </h3>
              <button onClick={() => setIsProcFormOpen(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                <XCircle size={18} className="text-gray-400" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="label">İşlem Adı *</label>
                <input
                  type="text"
                  value={procForm.procedureName}
                  onChange={(e) => setProcForm((f) => ({ ...f, procedureName: e.target.value }))}
                  placeholder="ör. İmplant Yerleştirme, Kanal Tedavisi..."
                  className="input-field"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Diş No (FDI) <span className="text-gray-400 font-normal">- İsteğe bağlı</span></label>
                  <input
                    type="number"
                    value={procForm.toothFdi}
                    onChange={(e) => setProcForm((f) => ({ ...f, toothFdi: e.target.value }))}
                    placeholder="ör. 16, 36..."
                    min={11}
                    max={48}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="label">Tahmini Tutar (₺) <span className="text-gray-400 font-normal">- İsteğe bağlı</span></label>
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
                <label className="label">Durum</label>
                <div className="grid grid-cols-2 gap-2">
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
                      {cfg.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">Not <span className="text-gray-400 font-normal">- İsteğe bağlı</span></label>
                <textarea
                  value={procForm.notes}
                  onChange={(e) => setProcForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  maxLength={500}
                  placeholder="Klinik not, özel bilgi..."
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
                {editingProc ? 'Güncelle' : 'Ekle'}
              </button>
              <button onClick={() => setIsProcFormOpen(false)} className="btn-secondary">
                İptal
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
                Mevcut Randevu Bağla
              </h3>
              <button onClick={() => setIsLinkApptOpen(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                <XCircle size={18} className="text-gray-400" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              <span className="font-semibold">{tCase.patient.firstName} {tCase.patient.lastName}</span> hastasına ait randevulardan birini bu tedavi dosyasına bağlayın.
            </p>
            <div className="overflow-y-auto flex-1 divide-y divide-gray-100">
              {linkLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="animate-spin text-primary-600" size={28} />
                </div>
              ) : linkableAppts.length === 0 ? (
                <p className="text-center text-gray-400 text-sm italic py-8">
                  Bağlanabilecek randevu bulunamadı.<br />
                  <button onClick={() => { setIsLinkApptOpen(false); setIsAppointmentFormOpen(true); }} className="text-primary-600 font-semibold hover:underline mt-2">
                    Yeni randevu oluştur →
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
                        {new Date(a.startTime).toLocaleDateString('tr-TR')} {new Date(a.startTime).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                        {a.practitioner && <> &bull; Dt. {a.practitioner.lastName}</>}
                        {a.treatmentCase && <span className="text-amber-600"> &bull; {a.treatmentCase.title}</span>}
                      </p>
                    </div>
                    <span className={`badge text-[10px] flex-shrink-0 ${
                      a.status === 'completed' ? 'badge-green' :
                      a.status === 'cancelled' ? 'badge-red' :
                      a.status === 'confirmed' ? 'badge-blue' : 'bg-amber-50 text-amber-700 border border-amber-100'
                    }`}>{a.status}</span>
                  </button>
                ))
              )}
            </div>
            <div className="mt-4 pt-4 border-t border-gray-100">
              <button onClick={() => setIsLinkApptOpen(false)} className="btn-secondary w-full">
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TreatmentCaseDetail;
