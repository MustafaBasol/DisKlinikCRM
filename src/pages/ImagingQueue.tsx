import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Download,
  Eye,
  Link2,
  Loader2,
  ScanLine,
  Search,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useClinic } from '../context/ClinicContext';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import { imagingService, patientService } from '../services/api';
import { canViewImaging } from '../utils/permissions';
import FilePreviewModal from '../components/FilePreviewModal';
import type { ImagingImageRow, ImagingStudyRow } from '../components/imaging/PatientImagingTab';

interface PatientOption {
  id: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
}

interface LinkModalState {
  study: ImagingStudyRow;
  search: string;
  results: PatientOption[];
  selected: PatientOption | null;
  searching: boolean;
  linking: boolean;
}

const ImagingQueue: React.FC = () => {
  const { t } = useTranslation(['imaging', 'common']);
  const { user } = useAuth();
  const { selectedClinicId } = useClinic();
  const { formatDate } = useClinicPreferences();

  const [studies, setStudies] = useState<ImagingStudyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [linkModal, setLinkModal] = useState<LinkModalState | null>(null);
  const [previewImage, setPreviewImage] = useState<{ study: ImagingStudyRow; image: ImagingImageRow } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await imagingService.getUnlinked();
      setStudies(res.data ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [selectedClinicId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  // BILLING ve ASSISTANT bu sayfayı hiç görmez (backend zaten 403 döner).
  if (!canViewImaging(user)) {
    return <Navigate to="/dashboard" replace />;
  }

  const searchPatients = async (query: string) => {
    setLinkModal(prev => prev ? { ...prev, search: query, selected: null } : null);
    if (!query.trim()) {
      setLinkModal(prev => prev ? { ...prev, results: [], searching: false } : null);
      return;
    }
    setLinkModal(prev => prev ? { ...prev, searching: true } : null);
    try {
      const res = await patientService.getAll({ search: query.trim(), limit: 10 });
      const rows = Array.isArray(res.data) ? res.data : (res.data?.patients ?? []);
      setLinkModal(prev => prev ? { ...prev, results: rows, searching: false } : null);
    } catch {
      setLinkModal(prev => prev ? { ...prev, results: [], searching: false } : null);
    }
  };

  const confirmLink = async () => {
    if (!linkModal?.selected || linkModal.linking) return;
    const name = `${linkModal.selected.firstName} ${linkModal.selected.lastName}`.trim();
    if (!confirm(t('imaging:queue.linkModal.confirm', { name }) as string)) return;
    setLinkModal(prev => prev ? { ...prev, linking: true } : null);
    try {
      await imagingService.linkStudy(linkModal.study.id, { patientId: linkModal.selected.id });
      setLinkModal(null);
      showToast(t('imaging:queue.linkModal.success'));
      await fetchQueue();
    } catch {
      setLinkModal(prev => prev ? { ...prev, linking: false } : null);
      showToast(t('imaging:queue.linkModal.failed'), 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <ScanLine size={24} className="text-primary-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('imaging:queue.title')}</h1>
          <p className="text-sm text-gray-500">{t('imaging:queue.subtitle')}</p>
        </div>
      </div>

      {toast && (
        <div className={`rounded-lg px-4 py-3 text-sm font-medium ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {toast.message}
        </div>
      )}

      {loading ? (
        <div className="card p-10 flex justify-center">
          <Loader2 className="animate-spin text-primary-500" size={28} />
        </div>
      ) : loadError ? (
        <div className="card p-10 text-center text-red-500 text-sm">{t('imaging:errors.loadFailed')}</div>
      ) : studies.length === 0 ? (
        <div className="card border-dashed p-12 text-center text-gray-500">
          <ScanLine size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="font-medium">{t('imaging:queue.empty')}</p>
          <p className="mt-1 text-sm">{t('imaging:queue.emptyDescription')}</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">{t('imaging:study.modality')}</th>
                  <th className="px-4 py-3 text-left">{t('imaging:study.date')}</th>
                  <th className="px-4 py-3 text-left">{t('imaging:study.description')}</th>
                  <th className="px-4 py-3 text-left">{t('imaging:study.source')}</th>
                  <th className="px-4 py-3 text-left">{t('imaging:study.device')}</th>
                  <th className="px-4 py-3 text-right">{t('common:actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {studies.map(study => {
                  const firstImage = study.images[0];
                  return (
                    <tr key={study.id} className="hover:bg-gray-50/70">
                      <td className="px-4 py-3">
                        <span className="badge badge-blue">
                          {t(`imaging:modalities.${study.modality}`, { defaultValue: study.modality })}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatDate(study.studyDate)}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-[240px]">
                        <p className="truncate">
                          {study.description || <span className="italic text-gray-400">{t('imaging:study.noDescription')}</span>}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">{t('imaging:study.images', { count: study.images.length })}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {t(`imaging:sources.${study.source}`, { defaultValue: study.source })}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{study.device?.name || '-'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {firstImage && (
                            <>
                              <button
                                onClick={() => setPreviewImage({ study, image: firstImage })}
                                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-primary-600"
                                title={t('imaging:actions.preview') as string}
                              >
                                <Eye size={16} />
                              </button>
                              <button
                                onClick={() => imagingService.downloadImage(study.id, firstImage.id, firstImage.originalName)}
                                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-primary-600"
                                title={t('imaging:actions.download') as string}
                              >
                                <Download size={16} />
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => setLinkModal({ study, search: '', results: [], selected: null, searching: false, linking: false })}
                            className="flex items-center gap-1.5 rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-100"
                          >
                            <Link2 size={14} /> {t('imaging:actions.link')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Hastaya bağlama modalı ── */}
      {linkModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => !linkModal.linking && setLinkModal(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">{t('imaging:queue.linkModal.title')}</h3>
              <button onClick={() => !linkModal.linking && setLinkModal(null)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                <X size={18} />
              </button>
            </div>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={linkModal.search}
                onChange={e => searchPatients(e.target.value)}
                placeholder={t('imaging:queue.linkModal.searchPlaceholder') as string}
                className="input-field w-full !pl-9"
                autoFocus
              />
            </div>
            <div className="mt-3 max-h-56 overflow-y-auto">
              {linkModal.searching ? (
                <div className="flex justify-center py-4"><Loader2 size={18} className="animate-spin text-primary-500" /></div>
              ) : linkModal.results.length === 0 && linkModal.search.trim() ? (
                <p className="py-4 text-center text-sm text-gray-400">{t('imaging:queue.linkModal.noResults')}</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {linkModal.results.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setLinkModal(prev => prev ? { ...prev, selected: p } : null)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm rounded-lg ${
                        linkModal.selected?.id === p.id ? 'bg-primary-50 text-primary-700 font-medium' : 'hover:bg-gray-50'
                      }`}
                    >
                      <span>{p.firstName} {p.lastName}</span>
                      <span className="text-xs text-gray-400">{p.phone || ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setLinkModal(null)} disabled={linkModal.linking} className="btn-secondary text-sm">
                {t('common:cancel')}
              </button>
              <button
                onClick={confirmLink}
                disabled={!linkModal.selected || linkModal.linking}
                className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
              >
                {linkModal.linking ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
                {t('imaging:queue.linkModal.submit')}
              </button>
            </div>
          </div>
        </div>
      )}

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

export default ImagingQueue;
