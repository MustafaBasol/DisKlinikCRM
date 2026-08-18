import React, { useRef, useState } from 'react';
import { Upload, FileSpreadsheet, AlertCircle, Loader2, ArrowRight, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MigrationStepProps } from './types';
import { getErrorMessage } from '../../../utils/errors';
import { MAX_UPLOAD_BYTES, formatByteSize } from '../../../pages/platformMigrationHelpers';

const ACCEPTED_EXTENSIONS = ['.xls', '.xlsx'];

function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

const MigrationUploadStep: React.FC<MigrationStepProps> = ({ run, api, onRunUpdated, onNext, nextStep }) => {
  const { t } = useTranslation(['platform']);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectFile = (f: File) => {
    setError('');
    if (!hasAcceptedExtension(f.name)) {
      setError(t('platform:migration.upload.errors.extension'));
      return;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      setError(t('platform:migration.upload.errors.tooLarge', { max: formatByteSize(MAX_UPLOAD_BYTES) }));
      return;
    }
    setFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const updated = await api.uploadFile(run.id, file);
      onRunUpdated(updated);
      onNext(nextStep);
    } catch (err) {
      setError(getErrorMessage(err, t('platform:migration.upload.errors.uploadFailed')));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="card p-6 max-w-2xl">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">{t('platform:migration.upload.title')}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">{t('platform:migration.upload.subtitle')}</p>

      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          isDragging ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/10' : 'border-gray-300 dark:border-gray-700 hover:border-primary-400'
        }`}
        onClick={() => inputRef.current?.click()}
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
        {file ? (
          <>
            <FileSpreadsheet size={36} className="mx-auto text-primary-500 mb-2" />
            <p className="text-sm font-medium text-gray-900 dark:text-white">{file.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{formatByteSize(file.size)}</p>
          </>
        ) : (
          <>
            <Upload size={36} className="mx-auto text-gray-400 mb-2" />
            <p className="text-sm text-gray-600 dark:text-gray-300">{t('platform:migration.upload.dropzone')}</p>
            <p className="text-xs text-gray-400 mt-1">{t('platform:migration.upload.acceptedFormats')}</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".xls,.xlsx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) selectFile(f);
          }}
        />
      </div>

      <div className="flex items-start gap-2 mt-4 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
        <ShieldCheck size={14} className="shrink-0 mt-0.5 text-primary-500" />
        <span>{t('platform:migration.upload.signatureNote')}</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3 mt-4">
          <AlertCircle size={16} />
          <span className="text-sm">{error}</span>
        </div>
      )}

      <button
        type="button"
        className="btn-primary w-full justify-center mt-5"
        disabled={!file || uploading}
        onClick={handleUpload}
      >
        {uploading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
        {t('platform:migration.upload.continue')}
      </button>
    </div>
  );
};

export default MigrationUploadStep;
