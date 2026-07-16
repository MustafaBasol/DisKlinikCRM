import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Download, AlertTriangle, CheckCircle2, Loader2, Plus, X, ChevronDown, PackageSearch, FileArchive } from 'lucide-react';
import { patientPrivacyService } from '../services/api';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';

// ── KVKK lifecycle types (docs/compliance/53) ──────────────────────────────────
// No lifecycle-category enum exists yet — every non-legal-hold attachment is
// reported as `unclassifiedRetained` (not eligible for automated deletion in
// this release). There is no live-delete endpoint in this PR.

interface DeletionReviewBlocker {
  code: 'DRY_RUN_ONLY' | 'ATTACHMENTS_LEGAL_HOLD' | 'IMAGING_RETENTION_NOT_APPROVED' | 'IMAGING_LEGAL_HOLD';
  count?: number;
}

interface DeletionReviewInventory {
  attachments: { total: number; legalHold: number; unclassifiedRetained: number; estimatedBytes: number };
  imaging: { total: number; legalHold: number; retainedClinical: number; estimatedBytes: number };
  blockers: DeletionReviewBlocker[];
  dryRun: true;
}

// System-generated PatientPrivacyRequest note/decision text is stored verbatim
// in English (immutable historical rows are never rewritten for translation —
// docs/compliance/53 P1). Known values are mapped to a localized string here,
// at render time only; anything unrecognized (a real user-entered note) is
// shown as-is.
const SYSTEM_NOTE_KEYS: Record<string, string> = {
  'Data export requested via API.': 'systemNotes.dataExportRequestedViaApi',
  'Export delivered.': 'systemNotes.exportDelivered',
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface PrivacyRequest {
  id: string;
  requestType: string;
  status: string;
  requestNote: string | null;
  decisionNote: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface Props {
  patientId: string;
  isAnonymized: boolean;
  canManage: boolean;
  onAnonymized?: () => void;
}

const REQUEST_TYPE_LABELS: Record<string, string> = {
  access_export: 'Veri Erişim / Dışa Aktarım',
  rectification: 'Düzeltme',
  anonymization: 'Anonimleştirme',
  deletion_review: 'Silme İncelemesi',
  restriction: 'İşlemeyi Kısıtlama',
  objection: 'İtiraz',
  other: 'Diğer',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Bekliyor',
  in_review: 'İncelemede',
  completed: 'Tamamlandı',
  rejected: 'Reddedildi',
  cancelled: 'İptal Edildi',
};

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  in_review: 'bg-blue-50 text-blue-700 border-blue-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
};

// ── Component ─────────────────────────────────────────────────────────────────

const PatientPrivacyPanel: React.FC<Props> = ({
  patientId,
  isAnonymized,
  canManage,
  onAnonymized,
}) => {
  const { t } = useTranslation('patientPrivacy');
  const { formatDate } = useClinicPreferences();
  const translateSystemNote = (note: string) => {
    const key = SYSTEM_NOTE_KEYS[note];
    return key ? t(key) : note;
  };
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [anonymizing, setAnonymizing] = useState(false);
  const [showAnonModal, setShowAnonModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [anonReason, setAnonReason] = useState('');
  const [newRequestType, setNewRequestType] = useState('access_export');
  const [newRequestNote, setNewRequestNote] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [partialFailureWarning, setPartialFailureWarning] = useState<{
    attachmentResults?: { total: number; redacted: number; skippedLegalHold: number; failed: number };
    imagingResults?: { total: number; redacted: number; skippedLegalHold: number; failed: number };
  } | null>(null);

  const [exportingPackage, setExportingPackage] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [deletionReview, setDeletionReview] = useState<DeletionReviewInventory | null>(null);
  const [showReviewPanel, setShowReviewPanel] = useState(false);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await patientPrivacyService.listRequests(patientId);
      setRequests(res.data.requests ?? []);
    } catch {
      // silently fail — non-critical panel
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const handleExport = async () => {
    setExporting(true);
    setError('');
    setSuccess('');
    try {
      const res = await patientPrivacyService.exportData(patientId);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `patient-export-${patientId}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess('Veriler indirildi.');
      loadRequests();
    } catch {
      setError('Dışa aktarım başarısız. Lütfen tekrar deneyin.');
    } finally {
      setExporting(false);
    }
  };

  const handleAnonymize = async () => {
    if (!anonReason.trim() || anonReason.trim().length < 3) {
      setError('Lütfen geçerli bir neden girin (en az 3 karakter).');
      return;
    }
    setAnonymizing(true);
    setError('');
    setSuccess('');
    setPartialFailureWarning(null);
    try {
      const res = await patientPrivacyService.anonymize(patientId, anonReason.trim());
      if (res.data?.partialFailure) {
        setPartialFailureWarning({
          attachmentResults: res.data.attachmentResults,
          imagingResults: res.data.imagingResults,
        });
        setSuccess(t('partialFailure.anonymizeSuccessWithWarning'));
      } else {
        setSuccess('Hasta başarıyla anonimleştirildi.');
      }
      setShowAnonModal(false);
      setAnonReason('');
      loadRequests();
      onAnonymized?.();
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? 'Anonimleştirme başarısız.';
      setError(msg);
    } finally {
      setAnonymizing(false);
    }
  };

  const handleExportPackage = async () => {
    setExportingPackage(true);
    setError('');
    setSuccess('');
    try {
      const created = await patientPrivacyService.createExportPackage(patientId);
      const { exportId, downloadToken } = created.data;
      const downloaded = await patientPrivacyService.downloadExportPackage(patientId, exportId, downloadToken);
      const blob = new Blob([downloaded.data], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `patient-export-${patientId}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess(t('actions.exportPackageSuccess'));
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = status === 409
        ? t('actions.exportPackageInProgress')
        : (err?.response?.data?.error ?? t('actions.exportPackageError'));
      setError(msg);
    } finally {
      setExportingPackage(false);
    }
  };

  const handleLoadDeletionReview = async () => {
    setReviewLoading(true);
    setError('');
    try {
      const res = await patientPrivacyService.getDeletionReview(patientId);
      setDeletionReview(res.data);
      setShowReviewPanel(true);
    } catch {
      setError(t('actions.deletionReviewError'));
    } finally {
      setReviewLoading(false);
    }
  };

  const handleCreateRequest = async () => {
    setError('');
    setSuccess('');
    try {
      await patientPrivacyService.createRequest(patientId, {
        requestType: newRequestType,
        requestNote: newRequestNote.trim() || undefined,
      });
      setSuccess('Gizlilik talebi oluşturuldu.');
      setShowRequestModal(false);
      setNewRequestNote('');
      loadRequests();
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? 'Talep oluşturulamadı.';
      setError(msg);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary-50 rounded-lg">
          <Shield size={20} className="text-primary-600" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-900">Gizlilik İşlemleri</h3>
          <p className="text-sm text-gray-500">KVKK / GDPR veri hakları yönetimi</p>
        </div>
        {isAnonymized && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
            <CheckCircle2 size={12} />
            Anonimleştirildi
          </span>
        )}
      </div>

      {/* Feedback */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm border border-red-100">
          <AlertTriangle size={15} />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 p-3 bg-green-50 text-green-700 rounded-lg text-sm border border-green-100">
          <CheckCircle2 size={15} />
          {success}
        </div>
      )}
      {partialFailureWarning && (
        <div className="p-3 bg-amber-50 text-amber-800 rounded-lg text-sm border border-amber-200 space-y-1">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle size={15} />
            {t('partialFailure.title')}
          </div>
          {partialFailureWarning.attachmentResults && (
            <p className="text-xs">
              {t('partialFailure.attachmentsSummary', {
                redacted: partialFailureWarning.attachmentResults.redacted,
                total: partialFailureWarning.attachmentResults.total,
                skippedLegalHold: partialFailureWarning.attachmentResults.skippedLegalHold,
                failed: partialFailureWarning.attachmentResults.failed,
              })}
            </p>
          )}
          {partialFailureWarning.imagingResults && (
            <p className="text-xs">
              {t('partialFailure.imagingSummary', {
                redacted: partialFailureWarning.imagingResults.redacted,
                total: partialFailureWarning.imagingResults.total,
                skippedLegalHold: partialFailureWarning.imagingResults.skippedLegalHold,
                failed: partialFailureWarning.imagingResults.failed,
              })}
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      {canManage && (
        <div className="card p-4 space-y-3">
          <h4 className="text-sm font-medium text-gray-700">İşlemler</h4>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleExport}
              disabled={exporting || isAnonymized}
              className="btn-secondary flex items-center gap-2 text-sm"
              title={isAnonymized ? 'Anonimleştirilmiş hasta dışa aktarılamaz' : undefined}
            >
              {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {t('actions.exportJson')}
            </button>

            <button
              onClick={handleExportPackage}
              disabled={exportingPackage || isAnonymized}
              className="btn-secondary flex items-center gap-2 text-sm"
              title={isAnonymized ? 'Anonimleştirilmiş hasta dışa aktarılamaz' : t('actions.exportPackageTooltip')}
            >
              {exportingPackage ? <Loader2 size={15} className="animate-spin" /> : <FileArchive size={15} />}
              {t('actions.exportPackage')}
            </button>

            <button
              onClick={handleLoadDeletionReview}
              disabled={reviewLoading}
              className="btn-secondary flex items-center gap-2 text-sm"
              title={t('actions.deletionReviewTooltip')}
            >
              {reviewLoading ? <Loader2 size={15} className="animate-spin" /> : <PackageSearch size={15} />}
              {t('actions.deletionReviewButton')}
            </button>

            <button
              onClick={() => { setShowRequestModal(true); setError(''); setSuccess(''); }}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              <Plus size={15} />
              Gizlilik talebi oluştur
            </button>

            <button
              onClick={() => { setShowAnonModal(true); setError(''); setSuccess(''); }}
              disabled={isAnonymized}
              className={`flex items-center gap-2 text-sm px-4 py-2 rounded-lg border font-medium transition-colors ${
                isAnonymized
                  ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                  : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
              }`}
              title={isAnonymized ? 'Hasta zaten anonimleştirildi' : undefined}
            >
              <Shield size={15} />
              Hastayı anonimleştir
            </button>
          </div>

          {isAnonymized && (
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <CheckCircle2 size={12} className="text-green-600" />
              Bu hasta anonimleştirildi. Kimlik bilgileri kaldırıldı.
            </p>
          )}
        </div>
      )}

      {/* Deletion-review dry-run summary (docs/compliance/53) */}
      {showReviewPanel && deletionReview && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <PackageSearch size={15} />
              {t('deletionReview.panelTitle')}
            </h4>
            <button onClick={() => setShowReviewPanel(false)} className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
              <p className="font-medium text-gray-700">{t('deletionReview.attachmentsLabel')}</p>
              <p className="text-gray-500">
                {t('deletionReview.attachmentsSummary', {
                  total: deletionReview.attachments.total,
                  legalHold: deletionReview.attachments.legalHold,
                  unclassifiedRetained: deletionReview.attachments.unclassifiedRetained,
                })}
              </p>
              <p className="text-xs text-gray-400">≈{Math.round(deletionReview.attachments.estimatedBytes / 1024)} KB</p>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
              <p className="font-medium text-gray-700">{t('deletionReview.imagingLabel')}</p>
              <p className="text-gray-500">
                {t('deletionReview.imagingSummary', {
                  total: deletionReview.imaging.total,
                  legalHold: deletionReview.imaging.legalHold,
                  retainedClinical: deletionReview.imaging.retainedClinical,
                })}
              </p>
              <p className="text-xs text-gray-400">≈{Math.round(deletionReview.imaging.estimatedBytes / 1024)} KB</p>
            </div>
          </div>

          {deletionReview.blockers.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
              {deletionReview.blockers.map((b, i) => (
                <p key={i}>• {t(`deletionReview.blockers.${b.code}`, { count: b.count })}</p>
              ))}
            </div>
          )}

          <p className="text-xs text-gray-400">
            {t('deletionReview.footnote')}
          </p>
        </div>
      )}

      {/* Privacy Requests List */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-gray-700">Gizlilik Talepleri</h4>
        {loading ? (
          <div className="flex items-center justify-center h-24">
            <Loader2 size={24} className="animate-spin text-primary-600" />
          </div>
        ) : requests.length === 0 ? (
          <div className="card p-6 text-center text-sm text-gray-500">
            Henüz gizlilik talebi yok.
          </div>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => (
              <div key={r.id} className="card p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-800">
                    {REQUEST_TYPE_LABELS[r.requestType] ?? r.requestType}
                  </span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_BADGE[r.status] ?? 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                    {STATUS_LABELS[r.status] ?? r.status}
                  </span>
                </div>
                {r.requestNote && (
                  <p className="text-xs text-gray-500 line-clamp-2">{translateSystemNote(r.requestNote)}</p>
                )}
                {r.decisionNote && (
                  <p className="text-xs text-gray-600 bg-gray-50 rounded p-1.5 line-clamp-3">{translateSystemNote(r.decisionNote)}</p>
                )}
                <p className="text-xs text-gray-400">
                  {formatDate(r.createdAt)}
                  {r.completedAt && ` → Tamamlandı: ${formatDate(r.completedAt)}`}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Anonymize Modal */}
      {showAnonModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div className="flex items-center gap-2">
                <Shield size={18} className="text-amber-600" />
                <h3 className="font-semibold text-gray-900">Hastayı Anonimleştir</h3>
              </div>
              <button onClick={() => setShowAnonModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                <strong>Uyarı:</strong> Bu işlem hastanın kimlik ve iletişim bilgilerini anonimleştirir. Randevu, ödeme ve yasal kayıtlar silinmez. Bu işlem geri alınamaz.
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Neden <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={anonReason}
                  onChange={(e) => setAnonReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                  className="input-field resize-none"
                  placeholder="Anonimleştirme gerekçesini açıklayın..."
                />
                <p className="text-xs text-gray-400 mt-1">{anonReason.length}/500</p>
              </div>

              {error && (
                <p className="text-sm text-red-600 flex items-center gap-1">
                  <AlertTriangle size={13} />
                  {error}
                </p>
              )}
            </div>

            <div className="px-5 py-4 border-t flex justify-end gap-3">
              <button
                onClick={() => { setShowAnonModal(false); setError(''); }}
                className="btn-secondary"
              >
                İptal
              </button>
              <button
                onClick={handleAnonymize}
                disabled={anonymizing || !anonReason.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium text-sm disabled:opacity-50 transition-colors"
              >
                {anonymizing ? <Loader2 size={15} className="animate-spin" /> : <Shield size={15} />}
                Anonimleştir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Request Modal */}
      {showRequestModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h3 className="font-semibold text-gray-900">Gizlilik Talebi Oluştur</h3>
              <button onClick={() => setShowRequestModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Talep Türü</label>
                <div className="relative">
                  <select
                    value={newRequestType}
                    onChange={(e) => setNewRequestType(e.target.value)}
                    className="input-field appearance-none pr-8"
                  >
                    {Object.entries(REQUEST_TYPE_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
                {newRequestType === 'deletion_review' && (
                  <p className="text-xs text-amber-700 mt-1 bg-amber-50 rounded p-2 border border-amber-100">
                    Silme talebi yasal inceleme gerektirir. Hasta kaydı otomatik olarak silinmez.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Not (isteğe bağlı)</label>
                <textarea
                  value={newRequestNote}
                  onChange={(e) => setNewRequestNote(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  className="input-field resize-none"
                  placeholder="Talep hakkında ek bilgi..."
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 flex items-center gap-1">
                  <AlertTriangle size={13} />
                  {error}
                </p>
              )}
            </div>

            <div className="px-5 py-4 border-t flex justify-end gap-3">
              <button
                onClick={() => { setShowRequestModal(false); setError(''); }}
                className="btn-secondary"
              >
                İptal
              </button>
              <button
                onClick={handleCreateRequest}
                className="btn-primary"
              >
                Talebi Kaydet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PatientPrivacyPanel;
