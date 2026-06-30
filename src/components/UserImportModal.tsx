/**
 * UserImportModal.tsx — Kullanıcı/Personel Excel İçe Aktarma Modal (Sprint 22)
 */

import React, { useState, useRef } from 'react';
import { X, Download, Upload, CheckCircle2, AlertCircle, Loader2, FileSpreadsheet, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { userService } from '../services/api';

type Step = 'upload' | 'preview' | 'confirm' | 'result';

interface PreviewRow {
  rowNumber: number;
  status: 'valid' | 'invalid';
  data?: Record<string, any>;
  errors?: string[];
}

interface PreviewResult {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: PreviewRow[];
}

interface CreatedUser {
  rowNumber: number;
  id: string;
  email: string;
  name: string;
  temporaryPassword?: string;
  invitationEmailSent?: boolean;
}

interface ConfirmResult {
  imported: number;
  skipped: number;
  createdUsers: CreatedUser[];
  skippedRows: { rowNumber: number; status: string; errors: string[] }[];
  hasTemporaryPasswords: boolean;
  hasFailedInvitations?: boolean;
  warning?: string;
}

interface Props {
  onClose: () => void;
  onSuccess: () => void;
  selectedClinicId?: string;
  availableClinics?: { id: string; name: string }[];
}

const UserImportModal: React.FC<Props> = ({ onClose, onSuccess, selectedClinicId, availableClinics = [] }) => {
  const { t } = useTranslation(['users', 'common']);
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [targetClinicId, setTargetClinicId] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAllClinics = !selectedClinicId || selectedClinicId === 'all';
  const effectiveClinicId = isAllClinics ? targetClinicId : selectedClinicId;

  const selectFile = (f: File) => {
    if (!f.name.endsWith('.xlsx')) {
      setError(t('users:importModal.errors.fileType'));
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError(t('users:importModal.errors.fileSize'));
      return;
    }
    setError('');
    setFile(f);
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await userService.downloadImportTemplate(effectiveClinicId || undefined);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'kullanici-import-sablonu.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(t('users:importModal.errors.templateDownload'));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) selectFile(f);
  };

  const handlePreview = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const res = await userService.importPreview(file, effectiveClinicId || undefined);
      setPreview(res.data);
      setStep('preview');
    } catch (err: any) {
      setError(err.response?.data?.error ?? t('users:importModal.errors.previewFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const res = await userService.importConfirm(file, effectiveClinicId || undefined);
      setResult(res.data);
      setStep('result');
    } catch (err: any) {
      setError(err.response?.data?.error ?? t('users:importModal.errors.importFailed'));
    } finally {
      setLoading(false);
    }
  };

  const copyPasswords = () => {
    if (!result) return;
    const lines = result.createdUsers
      .filter((u) => u.temporaryPassword)
      .map((u) => `${u.email}: ${u.temporaryPassword}`)
      .join('\n');
    navigator.clipboard.writeText(lines).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleFinish = () => {
    onSuccess();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Başlık */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={20} className="text-violet-600" />
            <h2 className="text-lg font-bold text-gray-900">{t('users:importModal.title')}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* İçerik */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* ─── Adım: Yükleme ─────────────────────────────────────────────── */}
          {step === 'upload' && (
            <div className="space-y-4">
              {/* Klinik bağlamı */}
              {isAllClinics ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">{t('users:importModal.allClinicsHint')}</p>
                  <select
                    value={targetClinicId}
                    onChange={(e) => setTargetClinicId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  >
                    <option value="">{t('users:importModal.selectTargetClinic')}</option>
                    {availableClinics.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2 text-sm text-violet-700">
                  <CheckCircle2 size={14} className="shrink-0" />
                  {t('users:importModal.clinicContext')}
                </div>
              )}

              <div className="bg-violet-50 border border-violet-100 rounded-lg p-4 text-sm text-violet-800 space-y-1">
                <p className="font-semibold">{t('users:importModal.howItWorks.title')}</p>
                <ol className="list-decimal list-inside space-y-1 text-violet-700">
                  <li>{t('users:importModal.howItWorks.downloadTemplate')}</li>
                  <li>{t('users:importModal.howItWorks.fillData')}</li>
                  <li>{t('users:importModal.howItWorks.temporaryPassword')}</li>
                  <li>{t('users:importModal.howItWorks.skipExisting')}</li>
                </ol>
              </div>

              <button
                onClick={handleDownloadTemplate}
                className="flex items-center gap-2 px-4 py-2 bg-green-50 hover:bg-green-100 text-green-700 font-medium rounded-lg border border-green-200 transition-colors text-sm"
              >
                <Download size={16} />
                {t('users:importModal.downloadTemplate')}
              </button>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('users:importModal.selectFile')}
                </label>
                <div
                  className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                    isDragging
                      ? 'border-violet-500 bg-violet-50'
                      : 'border-gray-300 hover:border-violet-400'
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) selectFile(f);
                  }}
                >
                  <Upload size={32} className="mx-auto text-gray-400 mb-2" />
                  <p className="text-sm text-gray-600">
                    {file ? file.name : t('users:importModal.dropzonePlaceholder')}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">{t('users:importModal.fileRules')}</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* ─── Adım: Önizleme ────────────────────────────────────────────── */}
          {step === 'preview' && preview && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-2xl font-bold text-gray-800">{preview.totalRows}</div>
                  <div className="text-xs text-gray-500 mt-1">{t('users:importModal.preview.totalRows')}</div>
                </div>
                <div className="bg-green-50 rounded-lg p-3">
                  <div className="text-2xl font-bold text-green-700">{preview.validRows}</div>
                  <div className="text-xs text-green-600 mt-1">{t('users:importModal.preview.validRows')}</div>
                </div>
                <div className="bg-red-50 rounded-lg p-3">
                  <div className="text-2xl font-bold text-red-600">{preview.invalidRows}</div>
                  <div className="text-xs text-red-500 mt-1">{t('users:importModal.preview.invalidRows')}</div>
                </div>
              </div>

              {preview.invalidRows > 0 && (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  <p className="text-sm font-medium text-gray-700">{t('users:importModal.preview.invalidRowsTitle')}</p>
                  {preview.rows
                    .filter((r) => r.status === 'invalid')
                    .map((r) => (
                      <div key={r.rowNumber} className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-sm">
                        <span className="font-medium text-red-700">{t('users:importModal.rowLabel', { row: r.rowNumber })}:</span>{' '}
                        <span className="text-red-600">{r.errors?.join(' • ')}</span>
                      </div>
                    ))}
                </div>
              )}

              {preview.validRows === 0 && (
                <div className="flex items-center gap-2 text-amber-700 bg-amber-50 px-3 py-2 rounded-lg text-sm">
                  <AlertCircle size={16} />
                  {t('users:importModal.preview.noValidRows')}
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* ─── Adım: Sonuç ───────────────────────────────────────────────── */}
          {step === 'result' && result && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <CheckCircle2 className="text-green-600 shrink-0" size={24} />
                <p className="text-green-800 font-medium">
                  {t('users:importModal.result.success', { count: result.imported })}
                  {result.skipped > 0 && ` ${t('users:importModal.result.skipped', { count: result.skipped })}`}
                </p>
              </div>

              {result.hasFailedInvitations && (
                <div className="flex items-center gap-2 text-amber-700 bg-amber-50 px-3 py-2 rounded-lg text-sm">
                  <AlertCircle size={16} className="shrink-0" />
                  {t('users:importModal.result.invitationFailedWarning')}
                </div>
              )}

              {result.hasTemporaryPasswords && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-amber-800">
                      {t('users:importModal.result.temporaryPasswordWarning')}
                    </p>
                    <button
                      onClick={copyPasswords}
                      className="flex items-center gap-1 px-2 py-1 text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 rounded transition-colors"
                    >
                      <Copy size={12} />
                      {copied ? t('users:importModal.result.copied') : t('users:importModal.result.copy')}
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {result.createdUsers
                      .filter((u) => u.temporaryPassword)
                      .map((u, i) => (
                        <div key={i} className="flex justify-between text-xs font-mono bg-white px-2 py-1 rounded border border-amber-100">
                          <span className="text-gray-600 truncate mr-2">{u.email}</span>
                          <span className="text-amber-900 font-bold shrink-0">{u.temporaryPassword}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {result.skippedRows.length > 0 && (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  <p className="text-sm font-medium text-gray-700">{t('users:importModal.result.skippedRowsTitle')}</p>
                  {result.skippedRows.map((r, i) => (
                    <div key={i} className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-sm">
                      <span className="font-medium text-amber-700">{t('users:importModal.rowLabel', { row: r.rowNumber })}:</span>{' '}
                      <span className="text-amber-600">{r.errors?.join(' • ')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Butonlar */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          {step === 'upload' && (
            <>
              <button onClick={onClose} className="btn-secondary">
                {t('common:cancel')}
              </button>
              <button
                onClick={handlePreview}
                disabled={!file || loading || (isAllClinics && !targetClinicId)}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {t('users:importModal.previewButton')}
              </button>
            </>
          )}

          {step === 'preview' && (
            <>
              <button onClick={() => { setStep('upload'); setError(''); }} className="btn-secondary">
                {t('common:back')}
              </button>
              <button
                onClick={handleConfirm}
                disabled={!preview || preview.validRows === 0 || loading}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {t('users:importModal.importButton', { count: preview?.validRows ?? 0 })}
              </button>
            </>
          )}

          {step === 'result' && (
            <button onClick={handleFinish} className="btn-primary">
              {t('common:ok')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserImportModal;
