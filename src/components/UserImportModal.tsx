/**
 * UserImportModal.tsx — Kullanıcı/Personel Excel İçe Aktarma Modal (Sprint 22)
 */

import React, { useState, useRef } from 'react';
import { X, Download, Upload, CheckCircle2, AlertCircle, Loader2, FileSpreadsheet, Copy } from 'lucide-react';
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
}

interface ConfirmResult {
  imported: number;
  skipped: number;
  createdUsers: CreatedUser[];
  skippedRows: { rowNumber: number; status: string; errors: string[] }[];
  hasTemporaryPasswords: boolean;
  warning?: string;
}

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

const UserImportModal: React.FC<Props> = ({ onClose, onSuccess }) => {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectFile = (f: File) => {
    if (!f.name.endsWith('.xlsx')) {
      setError('Yalnızca .xlsx dosyaları kabul edilir');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError('Dosya 5 MB sınırını aşıyor');
      return;
    }
    setError('');
    setFile(f);
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await userService.downloadImportTemplate();
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'kullanici-import-sablonu.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Şablon indirilemedi');
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
      const res = await userService.importPreview(file);
      setPreview(res.data);
      setStep('preview');
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Önizleme başarısız');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const res = await userService.importConfirm(file);
      setResult(res.data);
      setStep('result');
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'İçe aktarma başarısız');
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
            <h2 className="text-lg font-bold text-gray-900">Excel ile Personel Ekle</h2>
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
              <div className="bg-violet-50 border border-violet-100 rounded-lg p-4 text-sm text-violet-800 space-y-1">
                <p className="font-semibold">Nasıl çalışır?</p>
                <ol className="list-decimal list-inside space-y-1 text-violet-700">
                  <li>Şablonu indirin ve Şubeler sayfasındaki UUID'leri referans alın.</li>
                  <li>Personel verilerini doldurun (zorunlu: Ad, Soyad, E-posta, Rol, Şube ID).</li>
                  <li>Şifre boşsa sistem geçici şifre üretir — yalnızca bir kez görüntülenir.</li>
                  <li>Mevcut e-postalar atlanır, üzerine yazılmaz.</li>
                </ol>
              </div>

              <button
                onClick={handleDownloadTemplate}
                className="flex items-center gap-2 px-4 py-2 bg-green-50 hover:bg-green-100 text-green-700 font-medium rounded-lg border border-green-200 transition-colors text-sm"
              >
                <Download size={16} />
                Şablonu İndir (.xlsx)
              </button>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Excel Dosyası Seç
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
                    {file ? file.name : 'Tıklayarak dosya seçin veya sürükleyin'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Yalnızca .xlsx, maks. 5 MB, maks. 500 satır</p>
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
                  <div className="text-xs text-gray-500 mt-1">Toplam Satır</div>
                </div>
                <div className="bg-green-50 rounded-lg p-3">
                  <div className="text-2xl font-bold text-green-700">{preview.validRows}</div>
                  <div className="text-xs text-green-600 mt-1">Geçerli</div>
                </div>
                <div className="bg-red-50 rounded-lg p-3">
                  <div className="text-2xl font-bold text-red-600">{preview.invalidRows}</div>
                  <div className="text-xs text-red-500 mt-1">Hatalı</div>
                </div>
              </div>

              {preview.invalidRows > 0 && (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  <p className="text-sm font-medium text-gray-700">Hatalı Satırlar:</p>
                  {preview.rows
                    .filter((r) => r.status === 'invalid')
                    .map((r) => (
                      <div key={r.rowNumber} className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-sm">
                        <span className="font-medium text-red-700">Satır {r.rowNumber}:</span>{' '}
                        <span className="text-red-600">{r.errors?.join(' • ')}</span>
                      </div>
                    ))}
                </div>
              )}

              {preview.validRows === 0 && (
                <div className="flex items-center gap-2 text-amber-700 bg-amber-50 px-3 py-2 rounded-lg text-sm">
                  <AlertCircle size={16} />
                  İçe aktarılacak geçerli satır yok.
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
                  {result.imported} kullanıcı başarıyla eklendi.
                  {result.skipped > 0 && ` ${result.skipped} satır atlandı.`}
                </p>
              </div>

              {result.hasTemporaryPasswords && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-amber-800">
                      ⚠ Geçici şifreler yalnızca bir kez gösterilir. Lütfen kaydedin!
                    </p>
                    <button
                      onClick={copyPasswords}
                      className="flex items-center gap-1 px-2 py-1 text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 rounded transition-colors"
                    >
                      <Copy size={12} />
                      {copied ? 'Kopyalandı!' : 'Kopyala'}
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
                  <p className="text-sm font-medium text-gray-700">Atlanan Satırlar:</p>
                  {result.skippedRows.map((r, i) => (
                    <div key={i} className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-sm">
                      <span className="font-medium text-amber-700">Satır {r.rowNumber}:</span>{' '}
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
                İptal
              </button>
              <button
                onClick={handlePreview}
                disabled={!file || loading}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                Önizle
              </button>
            </>
          )}

          {step === 'preview' && (
            <>
              <button onClick={() => { setStep('upload'); setError(''); }} className="btn-secondary">
                Geri
              </button>
              <button
                onClick={handleConfirm}
                disabled={!preview || preview.validRows === 0 || loading}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {preview?.validRows ?? 0} Kullanıcı Ekle
              </button>
            </>
          )}

          {step === 'result' && (
            <button onClick={handleFinish} className="btn-primary">
              Tamam
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserImportModal;
