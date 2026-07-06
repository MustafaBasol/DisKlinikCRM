import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Download,
  Eye,
  FileImage,
  Link2Off,
  Loader2,
  Plus,
  ScanLine,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useClinicPreferences } from '../../context/ClinicPreferencesContext';
import { imagingService } from '../../services/api';
import FilePreviewModal from '../FilePreviewModal';
import { IMAGING_MODALITIES, IMAGING_MAX_FILE_MB } from './constants';

export interface ImagingImageRow {
  id: string;
  originalName: string;
  fileSize: number;
  mimeType: string;
  createdAt: string;
}

export interface ImagingStudyRow {
  id: string;
  modality: string;
  studyDate: string;
  description?: string | null;
  source: string;
  status: string;
  images: ImagingImageRow[];
  device?: { id: string; name: string; modality: string } | null;
  createdBy?: { id: string; firstName: string; lastName: string } | null;
}

interface DeviceOption {
  id: string;
  name: string;
  modality: string;
}

interface PatientImagingTabProps {
  patientId: string;
}

const PatientImagingTab: React.FC<PatientImagingTabProps> = ({ patientId }) => {
  const { t } = useTranslation(['imaging', 'common']);
  const { formatDate } = useClinicPreferences();
  const [studies, setStudies] = useState<ImagingStudyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Upload modal
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadModality, setUploadModality] = useState('IO');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadDeviceId, setUploadDeviceId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Preview
  const [previewImage, setPreviewImage] = useState<{ study: ImagingStudyRow; image: ImagingImageRow } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchStudies = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await imagingService.getPatientStudies(patientId, includeArchived);
      setStudies(res.data ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [patientId, includeArchived]);

  useEffect(() => { fetchStudies(); }, [fetchStudies]);

  const openUpload = async () => {
    setUploadFile(null);
    setUploadModality('IO');
    setUploadDescription('');
    setUploadDeviceId('');
    setUploadOpen(true);
    try {
      const res = await imagingService.getDevices({ onlyActive: true });
      setDevices(res.data ?? []);
    } catch {
      // cihaz listesi opsiyoneldir; yukleme cihazsiz da calisir
      setDevices([]);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile || uploading) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      fd.append('modality', uploadModality);
      fd.append('patientId', patientId);
      if (uploadDescription.trim()) fd.append('description', uploadDescription.trim());
      if (uploadDeviceId) fd.append('deviceId', uploadDeviceId);
      await imagingService.uploadStudy(fd);
      setUploadOpen(false);
      showToast(t('imaging:upload.success'));
      await fetchStudies();
    } catch {
      showToast(t('imaging:upload.failed'), 'error');
    } finally {
      setUploading(false);
    }
  };

  const runStudyAction = async (studyId: string, action: () => Promise<unknown>, confirmMessage?: string) => {
    if (confirmMessage && !confirm(confirmMessage)) return;
    setActionBusy(studyId);
    try {
      await action();
      await fetchStudies();
    } catch {
      showToast(t('imaging:errors.actionFailed'), 'error');
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div className="card p-6">
      {toast && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {toast.message}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h3 className="font-bold flex items-center gap-2"><ScanLine size={18} /> {t('imaging:tab')}</h3>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={e => setIncludeArchived(e.target.checked)}
              className="rounded border-gray-300"
            />
            {t('imaging:patient.includeArchived')}
          </label>
          <button onClick={openUpload} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={16} /> {t('imaging:actions.upload')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary-500" /></div>
      ) : loadError ? (
        <div className="text-center py-10 text-red-500 text-sm">{t('imaging:errors.loadFailed')}</div>
      ) : studies.length === 0 ? (
        <div className="text-center py-10 text-gray-400">
          <ScanLine size={36} className="mx-auto mb-2 opacity-30" />
          <p className="font-medium">{t('imaging:patient.empty')}</p>
          <p className="text-sm mt-1">{t('imaging:patient.emptyDescription')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {studies.map(study => {
            const busy = actionBusy === study.id;
            const archived = study.status === 'archived';
            return (
              <div key={study.id} className={`rounded-xl border p-4 ${archived ? 'border-gray-100 bg-gray-50/60' : 'border-gray-200'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge badge-blue">
                        {t(`imaging:modalities.${study.modality}`, { defaultValue: study.modality })}
                      </span>
                      <span className="text-sm font-semibold text-gray-900">{formatDate(study.studyDate)}</span>
                      {archived && <span className="badge badge-gray">{t('imaging:study.archivedBadge')}</span>}
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      {study.description || <span className="italic text-gray-400">{t('imaging:study.noDescription')}</span>}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {t('imaging:study.images', { count: study.images.length })}
                      {study.device ? <> &bull; {study.device.name}</> : null}
                      {' '}&bull; {t(`imaging:sources.${study.source}`, { defaultValue: study.source })}
                      {study.createdBy ? <> &bull; {study.createdBy.firstName} {study.createdBy.lastName}</> : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => runStudyAction(
                        study.id,
                        () => (archived ? imagingService.unarchiveStudy(study.id) : imagingService.archiveStudy(study.id)),
                        archived ? undefined : (t('imaging:confirm.archive') as string),
                      )}
                      disabled={busy}
                      className="p-2 text-gray-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg disabled:opacity-50"
                      title={archived ? t('imaging:actions.unarchive') as string : t('imaging:actions.archive') as string}
                    >
                      {archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                    </button>
                    <button
                      onClick={() => runStudyAction(
                        study.id,
                        () => imagingService.unlinkStudy(study.id),
                        t('imaging:confirm.unlink') as string,
                      )}
                      disabled={busy}
                      className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
                      title={t('imaging:actions.unlink') as string}
                    >
                      <Link2Off size={16} />
                    </button>
                  </div>
                </div>

                {study.images.length > 0 && (
                  <div className="mt-3 divide-y divide-gray-100 border-t border-gray-100">
                    {study.images.map(image => (
                      <div key={image.id} className="flex items-center gap-3 py-2">
                        <FileImage size={16} className="flex-shrink-0 text-gray-400" />
                        <button
                          onClick={() => setPreviewImage({ study, image })}
                          className="flex-1 min-w-0 truncate text-left text-sm hover:text-primary-600 hover:underline"
                        >
                          {image.originalName}
                        </button>
                        <span className="text-xs text-gray-400 whitespace-nowrap">{(image.fileSize / 1024).toFixed(1)} KB</span>
                        <button
                          onClick={() => setPreviewImage({ study, image })}
                          className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded-lg"
                          title={t('imaging:actions.preview') as string}
                        >
                          <Eye size={15} />
                        </button>
                        <button
                          onClick={() => imagingService.downloadImage(study.id, image.id, image.originalName)}
                          className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded-lg"
                          title={t('imaging:actions.download') as string}
                        >
                          <Download size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Upload modal — dosya mevcut hastaya otomatik baglanir */}
      {uploadOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => !uploading && setUploadOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">{t('imaging:upload.title')}</h3>
              <button onClick={() => !uploading && setUploadOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('imaging:upload.file')}</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/dicom,.dcm,.dicom"
                  onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-600"
                />
                <p className="text-xs text-gray-400 mt-1">{t('imaging:upload.fileHint', { max: IMAGING_MAX_FILE_MB })}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('imaging:upload.modality')}</label>
                <select value={uploadModality} onChange={e => setUploadModality(e.target.value)} className="input-field w-full">
                  {IMAGING_MODALITIES.map(m => (
                    <option key={m} value={m}>{t(`imaging:modalities.${m}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('imaging:upload.device')}</label>
                <select value={uploadDeviceId} onChange={e => setUploadDeviceId(e.target.value)} className="input-field w-full">
                  <option value="">{t('imaging:upload.deviceNone')}</option>
                  {devices.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('imaging:upload.description')}</label>
                <textarea
                  value={uploadDescription}
                  onChange={e => setUploadDescription(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  className="input-field w-full"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setUploadOpen(false)} disabled={uploading} className="btn-secondary text-sm">
                {t('common:cancel')}
              </button>
              <button onClick={handleUpload} disabled={!uploadFile || uploading} className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50">
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                {uploading ? t('imaging:upload.uploading') : t('imaging:upload.submit')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Onizleme kimlik dogrulamali blob endpoint'inden gelir; DICOM gibi
          onizlenemeyen turlerde modal indirme secenegi gosterir (backend 415). */}
      {previewImage && (
        <FilePreviewModal
          fileName={previewImage.image.originalName}
          mimeType={previewImage.image.mimeType}
          loadPreviewUrl={() => imagingService.loadPreviewObjectUrl(previewImage.study.id, previewImage.image.id)}
          onDownload={() => imagingService.downloadImage(previewImage.study.id, previewImage.image.id, previewImage.image.originalName)}
          onOpenInNewTab={async () => {
            const url = await imagingService.loadDownloadObjectUrl(previewImage.study.id, previewImage.image.id);
            window.open(url, '_blank', 'noopener');
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
          }}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </div>
  );
};

export default PatientImagingTab;
