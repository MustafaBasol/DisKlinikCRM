import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  HardDrive,
  Loader2,
  Plus,
  Radio,
  ShieldOff,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useClinic } from '../../context/ClinicContext';
import { useClinicPreferences } from '../../context/ClinicPreferencesContext';
import { imagingService } from '../../services/api';
import { getErrorMessage } from '../../utils/errors';
import ConfirmDialog from '../common/ConfirmDialog';
import { IMAGING_MODALITIES, IMAGING_DEVICE_CONNECTION_TYPES } from './constants';
import { deriveBridgeStatus } from './bridgeHelpers';
import { canStartOnboarding } from './onboardingHelpers';
import BridgeOnboardingCard, { type BridgeOnboardingConfig } from './BridgeOnboardingCard';
import BridgeSetupWizard from './BridgeSetupWizard';

interface DeviceRow {
  id: string;
  name: string;
  modality: string;
  manufacturer?: string | null;
  modelName?: string | null;
  connectionType: string;
  isActive: boolean;
  notes?: string | null;
  _count?: { imagingStudies: number; imagingRequests: number };
  canDelete?: boolean;
}

interface BridgeRow {
  id: string;
  name: string;
  status: string;
  lastSeenAt?: string | null;
  agentVersion?: string | null;
  createdAt: string;
  createdBy?: { id: string; firstName: string; lastName: string } | null;
  canDelete?: boolean;
  hasConnected?: boolean;
}

const emptyDeviceForm = {
  name: '',
  modality: 'IO',
  manufacturer: '',
  modelName: '',
  connectionType: 'manual',
  notes: '',
};

const BRIDGE_STATUS_STYLES: Record<string, string> = {
  pending: 'badge-yellow',
  online: 'badge-green',
  offline: 'badge-gray',
  revoked: 'badge-red',
};

const ImagingSettingsPanel: React.FC = () => {
  const { t } = useTranslation(['imaging', 'common']);
  const { formatDateTime } = useClinicPreferences();
  const { selectedClinicId } = useClinic();
  const effectiveClinicId = selectedClinicId === 'all' ? undefined : selectedClinicId;

  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [bridges, setBridges] = useState<BridgeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Device form modal
  const [deviceFormOpen, setDeviceFormOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<DeviceRow | null>(null);
  const [deviceForm, setDeviceForm] = useState({ ...emptyDeviceForm });
  const [deviceSaving, setDeviceSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Self-servis kurulum (onboarding) — bkz. BridgeOnboardingCard / BridgeSetupWizard
  const [onboardingConfig, setOnboardingConfig] = useState<BridgeOnboardingConfig | null>(null);
  const [onboardingLoading, setOnboardingLoading] = useState(true);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Onay diyalogları (silme + iptal/pasifleştirme — window.confirm() kullanılmaz)
  const [deviceToDelete, setDeviceToDelete] = useState<DeviceRow | null>(null);
  const [bridgeToDelete, setBridgeToDelete] = useState<BridgeRow | null>(null);
  const [bridgeToRevoke, setBridgeToRevoke] = useState<BridgeRow | null>(null);
  const [deviceToDeactivate, setDeviceToDeactivate] = useState<DeviceRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Klinik değişiminde eski istemin yanıtı yeni klinik state'ini asla
  // ezmemeli — her fetch bir sıra numarası taşır, yalnızca en güncel istek
  // sonucu uygulanır (stale-response guard).
  const fetchRequestIdRef = useRef(0);

  const fetchAll = useCallback(async (clinicId: string | undefined) => {
    const requestId = ++fetchRequestIdRef.current;
    setLoading(true);
    setLoadError(false);
    try {
      const [devicesRes, bridgesRes] = await Promise.all([
        imagingService.getDevices(clinicId ? { clinicId } : undefined),
        imagingService.getBridges(clinicId ? { clinicId } : undefined),
      ]);
      if (fetchRequestIdRef.current !== requestId) return; // stale response — a newer clinic switch already superseded this
      setDevices(devicesRes.data ?? []);
      setBridges(bridgesRes.data ?? []);
    } catch {
      if (fetchRequestIdRef.current !== requestId) return;
      setLoadError(true);
    } finally {
      if (fetchRequestIdRef.current === requestId) setLoading(false);
    }
  }, []);

  // Klinik değişince önce eski veriyi hemen temizle (bayat cihaz/köprü
  // listesi asla görünmesin), sonra yeni klinik için yeniden getir.
  useEffect(() => {
    setDevices([]);
    setBridges([]);
    fetchAll(effectiveClinicId);
  }, [effectiveClinicId, fetchAll]);

  // Onboarding durumunu öğrenmek için yalnızca bu config GET'i yapılır; devre
  // dışı olduğunda pairing, polling veya installer istekleri başlatılmaz.
  useEffect(() => {
    let cancelled = false;
    setOnboardingLoading(true);
    setOnboardingError(null);
    imagingService.getBridgeOnboardingConfig()
      .then(res => { if (!cancelled) setOnboardingConfig(res.data); })
      .catch(err => { if (!cancelled) setOnboardingError(getErrorMessage(err, t('imaging:onboarding.card.loadFailed') as string)); })
      .finally(() => { if (!cancelled) setOnboardingLoading(false); });
    return () => { cancelled = true; };
  }, [t]);

  // Klinik değişimi: sihirbaz kendi bekleyen eşleştirmesini bu değişimle
  // algılayıp iptal eder; burada yalnızca sihirbazı kapatıyoruz.
  const prevClinicRef = useRef(effectiveClinicId);
  useEffect(() => {
    if (prevClinicRef.current !== effectiveClinicId) {
      setWizardOpen(false);
    }
    prevClinicRef.current = effectiveClinicId;
  }, [effectiveClinicId]);

  const openDeviceForm = (device?: DeviceRow) => {
    setEditingDevice(device ?? null);
    setDeviceForm(device ? {
      name: device.name,
      modality: device.modality,
      manufacturer: device.manufacturer ?? '',
      modelName: device.modelName ?? '',
      connectionType: device.connectionType,
      notes: device.notes ?? '',
    } : { ...emptyDeviceForm });
    setDeviceFormOpen(true);
  };

  const saveDevice = async () => {
    if (!deviceForm.name.trim() || deviceSaving) return;
    setDeviceSaving(true);
    try {
      const payload = {
        name: deviceForm.name.trim(),
        modality: deviceForm.modality,
        manufacturer: deviceForm.manufacturer.trim() || null,
        modelName: deviceForm.modelName.trim() || null,
        connectionType: deviceForm.connectionType,
        notes: deviceForm.notes.trim() || null,
      };
      if (editingDevice) {
        await imagingService.updateDevice(editingDevice.id, payload);
      } else {
        await imagingService.createDevice(payload);
      }
      setDeviceFormOpen(false);
      await fetchAll(effectiveClinicId);
    } catch {
      showToast(t('imaging:settings.devices.saveFailed'), 'error');
    } finally {
      setDeviceSaving(false);
    }
  };

  const toggleDeviceActive = async (device: DeviceRow) => {
    if (device.isActive) {
      setDeviceToDeactivate(device);
      return;
    }
    setBusyId(device.id);
    try {
      await imagingService.setDeviceActive(device.id, true);
      await fetchAll(effectiveClinicId);
    } catch {
      showToast(t('imaging:errors.actionFailed'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const confirmDeactivateDevice = async () => {
    if (!deviceToDeactivate || deleting) return;
    setDeleting(true);
    try {
      await imagingService.setDeviceActive(deviceToDeactivate.id, false);
      setDeviceToDeactivate(null);
      await fetchAll(effectiveClinicId);
    } catch {
      showToast(t('imaging:errors.actionFailed'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const confirmDeleteDevice = async () => {
    if (!deviceToDelete || deleting) return;
    setDeleting(true);
    try {
      await imagingService.deleteDevice(deviceToDelete.id);
      setDeviceToDelete(null);
      showToast(t('imaging:settings.devices.deleteSuccess'), 'success');
      await fetchAll(effectiveClinicId);
    } catch (err: any) {
      const code = err?.response?.data?.code;
      if (code === 'IMAGING_DEVICE_IN_USE') {
        showToast(t('imaging:settings.devices.deleteBlockedInUse'), 'error');
      } else {
        showToast(getErrorMessage(err, t('imaging:settings.devices.deleteFailed') as string), 'error');
      }
      await fetchAll(effectiveClinicId);
    } finally {
      setDeleting(false);
    }
  };

  const confirmRevokeBridge = async () => {
    if (!bridgeToRevoke || deleting) return;
    setDeleting(true);
    try {
      await imagingService.revokeBridge(bridgeToRevoke.id);
      setBridgeToRevoke(null);
      await fetchAll(effectiveClinicId);
    } catch {
      showToast(t('imaging:settings.bridges.revokeFailed'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const confirmDeleteBridge = async () => {
    if (!bridgeToDelete || deleting) return;
    setDeleting(true);
    try {
      await imagingService.deleteBridge(bridgeToDelete.id);
      setBridgeToDelete(null);
      showToast(t('imaging:settings.bridges.deleteSuccess'), 'success');
      await fetchAll(effectiveClinicId);
    } catch (err: any) {
      const code = err?.response?.data?.code;
      if (code === 'IMAGING_BRIDGE_IN_USE') {
        showToast(t('imaging:settings.bridges.deleteBlockedInUse'), 'error');
      } else {
        showToast(getErrorMessage(err, t('imaging:settings.bridges.deleteFailed') as string), 'error');
      }
      await fetchAll(effectiveClinicId);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="card p-10 flex justify-center">
        <Loader2 className="animate-spin text-primary-500" size={28} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="card p-10 text-center text-red-500 text-sm">{t('imaging:errors.loadFailed')}</div>
    );
  }

  // Bridge Agent henüz cihazlara kalıcı olarak bağlanmıyor (yalnızca upload
  // başına deviceId gönderiliyor) — bu yüzden "bağlı" değil "kullanılabilir"
  // cihazları listeliyoruz.
  const bridgeCapableDevices = devices.filter(d => d.isActive && d.connectionType === 'bridge');

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`rounded-lg px-4 py-3 text-sm font-medium ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {toast.message}
        </div>
      )}

      {/* ── Cihazlar ── */}
      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <HardDrive size={20} className="text-gray-400" /> {t('imaging:settings.devices.title')}
          </h2>
          <button onClick={() => openDeviceForm()} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={16} /> {t('imaging:settings.devices.add')}
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">{t('imaging:settings.devices.description')}</p>

        {devices.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <HardDrive size={32} className="mx-auto mb-2 opacity-30" />
            <p className="font-medium">{t('imaging:settings.devices.empty')}</p>
            <p className="text-sm mt-1">{t('imaging:settings.devices.emptyDescription')}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {devices.map(device => (
              <div key={device.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm text-gray-900">{device.name}</span>
                    <span className="badge badge-blue">
                      {t(`imaging:modalities.${device.modality}`, { defaultValue: device.modality })}
                    </span>
                    <span className={`badge ${device.isActive ? 'badge-green' : 'badge-gray'}`}>
                      {device.isActive ? t('imaging:settings.devices.active') : t('imaging:settings.devices.inactive')}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {[device.manufacturer, device.modelName].filter(Boolean).join(' · ')}
                    {(device.manufacturer || device.modelName) && ' · '}
                    {t(`imaging:settings.devices.connections.${device.connectionType}`, { defaultValue: device.connectionType })}
                    {device._count && (
                      <> · {t('imaging:settings.devices.usage', {
                        studies: device._count.imagingStudies,
                        requests: device._count.imagingRequests,
                      })}</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openDeviceForm(device)}
                    className="btn-secondary text-xs"
                  >
                    {t('common:edit', { defaultValue: 'Düzenle' })}
                  </button>
                  <button
                    onClick={() => toggleDeviceActive(device)}
                    disabled={busyId === device.id}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {device.isActive ? t('imaging:settings.devices.deactivate') : t('imaging:settings.devices.activate')}
                  </button>
                  <button
                    onClick={() => setDeviceToDelete(device)}
                    disabled={device.canDelete === false || busyId === device.id}
                    title={device.canDelete === false ? t('imaging:settings.devices.deleteBlockedInUse') as string : undefined}
                    className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={13} />
                    {t('imaging:settings.devices.deletePermanently')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Self-servis kurulum (Windows Bridge onboarding, PR 5/7) ── */}
      <BridgeOnboardingCard
        loading={onboardingLoading}
        error={onboardingError}
        config={onboardingConfig}
        clinicRequired={!canStartOnboarding(effectiveClinicId)}
        onStartSetup={() => { if (canStartOnboarding(effectiveClinicId)) setWizardOpen(true); }}
      />

      {/* ── Köprü ajanları ── */}
      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Radio size={20} className="text-gray-400" /> {t('imaging:settings.bridges.title')}
          </h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">{t('imaging:settings.bridges.description')}</p>

        {bridges.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <Radio size={32} className="mx-auto mb-2 opacity-30" />
            <p className="font-medium">{t('imaging:settings.bridges.empty')}</p>
            <p className="text-sm mt-1">{t('imaging:settings.bridges.emptyDescription')}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {bridges.map(bridge => {
              const status = deriveBridgeStatus(bridge);
              return (
                <div key={bridge.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    status === 'online' ? 'bg-green-500' : status === 'pending' ? 'bg-yellow-400' : status === 'revoked' ? 'bg-red-400' : 'bg-gray-300'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm text-gray-900">{bridge.name}</span>
                      <span className={`badge ${BRIDGE_STATUS_STYLES[status]}`}>
                        {t(`imaging:settings.bridges.status.${status}`)}
                      </span>
                      {bridge.agentVersion && (
                        <span className="text-xs text-gray-400">{t('imaging:settings.bridges.version')} {bridge.agentVersion}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {t('imaging:settings.bridges.createdAt')}: {formatDateTime(bridge.createdAt)}
                      {' · '}
                      {t('imaging:settings.bridges.lastSeen')}: {bridge.lastSeenAt ? formatDateTime(bridge.lastSeenAt) : t('imaging:settings.bridges.never')}
                    </p>
                  </div>
                  {bridge.status !== 'revoked' && (
                    <button
                      onClick={() => setBridgeToRevoke(bridge)}
                      disabled={busyId === bridge.id}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      <ShieldOff size={14} /> {t('imaging:settings.bridges.revoke')}
                    </button>
                  )}
                  <button
                    onClick={() => setBridgeToDelete(bridge)}
                    disabled={bridge.canDelete === false || busyId === bridge.id}
                    title={bridge.canDelete === false ? t('imaging:settings.bridges.deleteBlockedInUse') as string : undefined}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={14} /> {t('imaging:settings.bridges.deletePermanently')}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Cihaz formu ── */}
      {deviceFormOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => !deviceSaving && setDeviceFormOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">{editingDevice ? t('imaging:settings.devices.edit') : t('imaging:settings.devices.add')}</h3>
              <button onClick={() => !deviceSaving && setDeviceFormOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('imaging:settings.devices.name')}</label>
                <input
                  type="text"
                  value={deviceForm.name}
                  onChange={e => setDeviceForm(f => ({ ...f, name: e.target.value }))}
                  maxLength={200}
                  className="input-field w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('imaging:settings.devices.modality')}</label>
                <select
                  value={deviceForm.modality}
                  onChange={e => setDeviceForm(f => ({ ...f, modality: e.target.value }))}
                  className="input-field w-full"
                >
                  {IMAGING_MODALITIES.map(m => (
                    <option key={m} value={m}>{t(`imaging:modalities.${m}`)}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('imaging:settings.devices.manufacturer')}</label>
                  <input
                    type="text"
                    value={deviceForm.manufacturer}
                    onChange={e => setDeviceForm(f => ({ ...f, manufacturer: e.target.value }))}
                    maxLength={200}
                    className="input-field w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('imaging:settings.devices.modelName')}</label>
                  <input
                    type="text"
                    value={deviceForm.modelName}
                    onChange={e => setDeviceForm(f => ({ ...f, modelName: e.target.value }))}
                    maxLength={200}
                    className="input-field w-full"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('imaging:settings.devices.connectionType')}</label>
                <select
                  value={deviceForm.connectionType}
                  onChange={e => setDeviceForm(f => ({ ...f, connectionType: e.target.value }))}
                  className="input-field w-full"
                >
                  {IMAGING_DEVICE_CONNECTION_TYPES.map(c => (
                    <option key={c} value={c}>{t(`imaging:settings.devices.connections.${c}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('imaging:settings.devices.notes')}</label>
                <textarea
                  value={deviceForm.notes}
                  onChange={e => setDeviceForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  maxLength={2000}
                  className="input-field w-full"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setDeviceFormOpen(false)} disabled={deviceSaving} className="btn-secondary text-sm">
                {t('common:cancel')}
              </button>
              <button onClick={saveDevice} disabled={!deviceForm.name.trim() || deviceSaving} className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50">
                {deviceSaving && <Loader2 size={16} className="animate-spin" />}
                {t('common:save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Self-servis kurulum sihirbazı ── */}
      <BridgeSetupWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        devices={bridgeCapableDevices}
        clinicId={effectiveClinicId}
        installer={onboardingConfig?.installer ?? null}
        onPaired={() => fetchAll(effectiveClinicId)}
        onRequestCreateDevice={() => { setWizardOpen(false); openDeviceForm(); }}
      />

      {/* ── Cihaz kalıcı silme onayı ── */}
      <ConfirmDialog
        open={!!deviceToDelete}
        title={t('imaging:settings.devices.deletePermanentlyTitle')}
        body={deviceToDelete ? t('imaging:settings.devices.deletePermanentlyBody', { name: deviceToDelete.name }) : ''}
        warnings={[t('imaging:settings.devices.deletePermanentlyWarningBridgeConfig') as string]}
        confirmLabel={t('imaging:settings.devices.deletePermanently') as string}
        cancelLabel={t('common:cancel') as string}
        loading={deleting}
        onConfirm={confirmDeleteDevice}
        onCancel={() => !deleting && setDeviceToDelete(null)}
      />

      {/* ── Cihaz pasifleştirme onayı ── */}
      <ConfirmDialog
        open={!!deviceToDeactivate}
        variant="default"
        title={t('imaging:settings.devices.deactivateTitle')}
        body={deviceToDeactivate ? t('imaging:settings.devices.deactivateBody', { name: deviceToDeactivate.name }) : ''}
        confirmLabel={t('imaging:settings.devices.deactivate') as string}
        cancelLabel={t('common:cancel') as string}
        loading={deleting}
        onConfirm={confirmDeactivateDevice}
        onCancel={() => !deleting && setDeviceToDeactivate(null)}
      />

      {/* ── Köprü ajanı kalıcı silme onayı ── */}
      <ConfirmDialog
        open={!!bridgeToDelete}
        title={t('imaging:settings.bridges.deletePermanentlyTitle')}
        body={bridgeToDelete ? t('imaging:settings.bridges.deletePermanentlyBody', { name: bridgeToDelete.name }) : ''}
        warnings={[t('imaging:settings.bridges.deletePermanentlyWarningToken') as string]}
        confirmLabel={t('imaging:settings.bridges.deletePermanently') as string}
        cancelLabel={t('common:cancel') as string}
        loading={deleting}
        onConfirm={confirmDeleteBridge}
        onCancel={() => !deleting && setBridgeToDelete(null)}
      />

      {/* ── Köprü ajanı iptal onayı ── */}
      <ConfirmDialog
        open={!!bridgeToRevoke}
        variant="default"
        title={t('imaging:settings.bridges.revokeTitle')}
        body={bridgeToRevoke ? t('imaging:settings.bridges.revokeBody', { name: bridgeToRevoke.name }) : ''}
        confirmLabel={t('imaging:settings.bridges.revoke') as string}
        cancelLabel={t('common:cancel') as string}
        loading={deleting}
        onConfirm={confirmRevokeBridge}
        onCancel={() => !deleting && setBridgeToRevoke(null)}
      />
    </div>
  );
};

export default ImagingSettingsPanel;
