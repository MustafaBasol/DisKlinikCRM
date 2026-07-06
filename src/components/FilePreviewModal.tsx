import React, { useEffect, useState } from 'react';
import { X, Download, ExternalLink, Loader2, FileWarning } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const INLINE_PREVIEWABLE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
]);

export function isInlinePreviewable(mimeType: string): boolean {
  return INLINE_PREVIEWABLE_MIME_TYPES.has(mimeType);
}

interface FilePreviewModalProps {
  fileName: string;
  mimeType: string;
  /** Lazily resolves the object URL for the preview iframe/img (fetched on open). */
  loadPreviewUrl: () => Promise<string>;
  onDownload: () => void;
  onOpenInNewTab: () => void;
  onClose: () => void;
}

const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  fileName, mimeType, loadPreviewUrl, onDownload, onOpenInNewTab, onClose,
}) => {
  const { t } = useTranslation(['common']);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const previewable = isInlinePreviewable(mimeType);

  useEffect(() => {
    if (!previewable) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    loadPreviewUrl()
      .then(url => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setObjectUrl(url);
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewable]);

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-0 sm:p-4" onClick={onClose}>
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl dark:bg-gray-900 sm:h-[90vh] sm:max-w-4xl sm:rounded-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-700">
          <p className="min-w-0 truncate text-sm font-medium text-gray-900 dark:text-white">{fileName}</p>
          <div className="flex flex-shrink-0 items-center gap-1">
            <button
              onClick={onDownload}
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-primary-600 dark:text-gray-400 dark:hover:bg-gray-800"
              title={t('common:download', { defaultValue: 'İndir' }) as string}
            >
              <Download size={18} />
            </button>
            <button
              onClick={onOpenInNewTab}
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-primary-600 dark:text-gray-400 dark:hover:bg-gray-800"
              title={t('common:openInNewTab', { defaultValue: 'Yeni sekmede aç' }) as string}
            >
              <ExternalLink size={18} />
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-red-600 dark:text-gray-400 dark:hover:bg-gray-800"
              title={t('common:close') as string}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center overflow-auto bg-gray-50 dark:bg-gray-950">
          {!previewable ? (
            <div className="flex flex-col items-center gap-3 p-8 text-center text-gray-500 dark:text-gray-400">
              <FileWarning size={40} className="opacity-50" />
              <p className="max-w-sm text-sm">
                {t('common:previewUnsupported', { defaultValue: 'Bu dosya türü tarayıcıda önizlenemez. Dosyayı indirebilirsiniz.' })}
              </p>
              <button onClick={onDownload} className="btn-primary mt-1 flex items-center gap-2 text-sm">
                <Download size={16} /> {t('common:download', { defaultValue: 'İndir' })}
              </button>
            </div>
          ) : loading ? (
            <Loader2 className="animate-spin text-primary-500" size={32} />
          ) : error || !objectUrl ? (
            <div className="flex flex-col items-center gap-3 p-8 text-center text-gray-500 dark:text-gray-400">
              <FileWarning size={40} className="opacity-50" />
              <p className="text-sm">{t('common:previewUnsupported', { defaultValue: 'Bu dosya türü tarayıcıda önizlenemez. Dosyayı indirebilirsiniz.' })}</p>
            </div>
          ) : mimeType === 'application/pdf' ? (
            <iframe src={objectUrl} title={fileName} className="h-full w-full border-0" />
          ) : (
            <img src={objectUrl} alt={fileName} className="max-h-full max-w-full object-contain" />
          )}
        </div>
      </div>
    </div>
  );
};

export default FilePreviewModal;
