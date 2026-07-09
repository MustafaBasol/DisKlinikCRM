import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Loader2,
  Monitor,
  RefreshCw,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { imagingService } from '../../services/api';
import { getErrorMessage } from '../../utils/errors';
import {
  filterEligibleDevices,
  isValidDeviceSelection,
  derivePairingDisplayStatus,
  shouldPollPairing,
  computeCountdown,
  formatCountdown,
  type OnboardingDeviceLike,
} from './onboardingHelpers';

const POLL_INTERVAL_MS = 4000;

interface WizardDevice extends OnboardingDeviceLike {
  name: string;
  modality: string;
}

interface PairingBinding {
  id: string;
  deviceId: string;
  modality: string;
  displayName: string | null;
  status: string;
}

interface PairingState {
  id: string;
  code: string | null; // düz metin kod — YALNIZCA bu state'te, oluşturma anında bir kez gelir
  expiresAt: string;
  status: string;
  bridgeName: string;
  createdAgent: { id: string; status: string; bindings: PairingBinding[] } | null;
}

interface InstallerInfo {
  downloadUrl: string;
  version: string;
  signed: boolean;
}

interface BridgeSetupWizardProps {
  open: boolean;
  onClose: () => void;
  devices: WizardDevice[];
  clinicId?: string;
  installer: InstallerInfo | null;
  onPaired: () => void;
  onRequestCreateDevice: () => void;
}

type Step = 'devices' | 'install' | 'pairing' | 'success';

const BridgeSetupWizard: React.FC<BridgeSetupWizardProps> = ({
  open,
  onClose,
  devices,
  clinicId,
  installer,
  onPaired,
  onRequestCreateDevice,
}) => {
  const { t } = useTranslation(['imaging', 'common']);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const [step, setStep] = useState<Step>('devices');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bridgeName, setBridgeName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [cancelling, setCancelling] = useState(false);
  const [copied, setCopied] = useState(false);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollInFlightRef = useRef(false);
  const pairingRef = useRef<PairingState | null>(null);
  pairingRef.current = pairing;

  const eligibleDevices = filterEligibleDevices(devices);

  // ── Reset when (re)opened ──────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setStep('devices');
    setSelectedIds([]);
    setBridgeName('');
    setCreateError(null);
    setPairing(null);
  }, [open]);

  // ── Focus management (mirrors ConfirmDialog) ────────────────────────────
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Countdown ticking (1s) ──────────────────────────────────────────────
  useEffect(() => {
    if (!pairing || derivePairingDisplayStatus(pairing) !== 'pending') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pairing]);

  // ── Polling: single interval, guarded against overlap, paused when hidden ──
  const pollOnce = useCallback(async () => {
    const current = pairingRef.current;
    if (!current || pollInFlightRef.current) return;
    if (!shouldPollPairing(current)) return;
    if (document.hidden) return;
    pollInFlightRef.current = true;
    try {
      const res = await imagingService.getPairing(current.id);
      setPairing(prev => (prev ? { ...prev, ...res.data } : prev));
    } catch {
      // Ağ hatası: mevcut kodu/durumu ekranda tutmaya devam et, bir sonraki
      // periyotta yeniden dene — kullanıcıya kodu kaybettirme.
    } finally {
      pollInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!open || !pairing) return;
    if (!shouldPollPairing(pairing, now)) return;

    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(pollOnce, POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [open, pairing, now, pollOnce]);

  // Resume promptly when tab becomes visible again instead of waiting a full interval.
  useEffect(() => {
    const handler = () => { if (!document.hidden) pollOnce(); };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [pollOnce]);

  // Success transition
  useEffect(() => {
    if (pairing && derivePairingDisplayStatus(pairing, now) === 'used') {
      setStep('success');
      onPaired();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing, now]);

  // Clinic switched away mid-flow: cancel best-effort and close.
  const clinicIdRef = useRef(clinicId);
  useEffect(() => {
    if (open && clinicIdRef.current !== undefined && clinicIdRef.current !== clinicId && pairingRef.current) {
      const p = pairingRef.current;
      if (derivePairingDisplayStatus(p) === 'pending') {
        imagingService.cancelPairing(p.id).catch(() => {});
      }
      onClose();
    }
    clinicIdRef.current = clinicId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId]);

  // Best-effort cancel of an orphaned pending session when the wizard is closed/unmounted.
  useEffect(() => {
    if (open) return;
    const p = pairingRef.current;
    if (p && derivePairingDisplayStatus(p) === 'pending') {
      imagingService.cancelPairing(p.id).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const toggleDevice = (id: string) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const generateCode = async () => {
    if (!isValidDeviceSelection(selectedIds) || !bridgeName.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await imagingService.createPairing({
        bridgeName: bridgeName.trim(),
        deviceIds: selectedIds,
        clinicId,
      });
      setPairing({
        id: res.data.pairingId,
        code: res.data.code,
        expiresAt: res.data.expiresAt,
        status: 'pending',
        bridgeName: bridgeName.trim(),
        createdAgent: null,
      });
      setNow(Date.now());
      setStep('pairing');
    } catch (err) {
      setCreateError(getErrorMessage(err, t('imaging:onboarding.wizard.pairing.createFailed') as string));
    } finally {
      setCreating(false);
    }
  };

  const cancelCurrentPairing = async () => {
    if (!pairing || cancelling) return;
    setCancelling(true);
    try {
      await imagingService.cancelPairing(pairing.id);
    } catch {
      // Sunucu tarafında zaten süresi dolmuş/kullanılmış olabilir — yine de yerelde iptal say.
    } finally {
      setPairing(prev => (prev ? { ...prev, status: 'cancelled' } : prev));
      setCancelling(false);
    }
  };

  const copyCode = async () => {
    if (!pairing?.code) return;
    try {
      await navigator.clipboard.writeText(pairing.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // pano erişimi engellenirse kullanıcı kodu elle seçip kopyalayabilir
    }
  };

  const displayStatus = pairing ? derivePairingDisplayStatus(pairing, now) : null;
  const countdown = pairing ? computeCountdown(pairing.expiresAt, now) : null;

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 p-2 sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[95vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl outline-none dark:bg-gray-800"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-6 sm:py-4 dark:border-gray-700">
          <h2 id={titleId} className="flex items-center gap-2 font-bold text-gray-900 dark:text-white">
            <Monitor size={20} className="text-primary-500" />
            {t('imaging:onboarding.wizard.title')}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('common:cancel') as string}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {step === 'devices' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('imaging:onboarding.wizard.devices.description')}</p>
              {eligibleDevices.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center dark:border-gray-600">
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{t('imaging:onboarding.wizard.devices.empty')}</p>
                  <button onClick={onRequestCreateDevice} className="btn-primary mt-3 text-sm">
                    {t('imaging:settings.devices.add')}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {eligibleDevices.map(device => (
                    <label
                      key={device.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/40"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(device.id)}
                        onChange={() => toggleDevice(device.id)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{device.name}</span>
                      <span className="badge badge-blue">
                        {t(`imaging:modalities.${device.modality}`, { defaultValue: device.modality })}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 'install' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('imaging:onboarding.wizard.install.description')}</p>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-700 dark:text-gray-300">
                <li>{t('imaging:onboarding.wizard.install.step1')}</li>
                <li>{t('imaging:onboarding.wizard.install.step2')}</li>
                <li>{t('imaging:onboarding.wizard.install.step3')}</li>
                <li>{t('imaging:onboarding.wizard.install.step4')}</li>
              </ol>
              {installer && !installer.signed && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                  <span>{t('imaging:onboarding.wizard.install.unsignedWarning')}</span>
                </div>
              )}
              {installer && (
                <p className="text-xs text-gray-400">
                  {t('imaging:onboarding.card.version', { version: installer.version })}
                </p>
              )}
            </div>
          )}

          {step === 'pairing' && pairing && (
            <div className="space-y-4">
              {displayStatus === 'pending' && countdown && (
                <>
                  <div className="text-center">
                    <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">{t('imaging:onboarding.wizard.pairing.enterInManager')}</p>
                    <div
                      aria-live="polite"
                      className="mx-auto inline-block rounded-xl border border-primary-200 bg-primary-50 px-6 py-4 font-mono text-3xl font-bold tracking-widest text-primary-700 dark:border-primary-700 dark:bg-primary-900/20 dark:text-primary-300"
                    >
                      {pairing.code}
                    </div>
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                      {t('imaging:onboarding.wizard.pairing.expiresIn', { time: formatCountdown(countdown) })}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <button onClick={copyCode} className="btn-secondary flex items-center gap-1.5 text-sm">
                      {copied ? <Check size={15} className="text-green-600" /> : <Copy size={15} />}
                      {copied ? t('common:copied', { defaultValue: 'Kopyalandı' }) : t('imaging:onboarding.wizard.pairing.copyCode')}
                    </button>
                    <button
                      onClick={cancelCurrentPairing}
                      disabled={cancelling}
                      className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-900/20"
                    >
                      {cancelling && <Loader2 size={14} className="mr-1 inline animate-spin" />}
                      {t('imaging:onboarding.wizard.pairing.cancel')}
                    </button>
                  </div>
                  <div aria-live="polite" className="flex items-center justify-center gap-2 text-xs text-gray-400">
                    <Loader2 size={13} className="animate-spin" />
                    {t('imaging:onboarding.wizard.pairing.waiting')}
                  </div>
                </>
              )}

              {displayStatus !== 'pending' && (
                <div aria-live="polite" className="space-y-3 text-center">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t(`imaging:onboarding.wizard.pairing.status.${displayStatus}`)}
                  </p>
                  <button
                    onClick={() => { setPairing(null); setStep('devices'); setSelectedIds([]); }}
                    className="btn-primary inline-flex items-center gap-2 text-sm"
                  >
                    <RefreshCw size={15} />
                    {t('imaging:onboarding.wizard.pairing.generateNew')}
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 'success' && pairing && (
            <div aria-live="polite" className="space-y-4 text-center">
              <CheckCircle2 size={40} className="mx-auto text-green-500" />
              <p className="font-semibold text-gray-900 dark:text-white">
                {t('imaging:onboarding.wizard.success.title', { name: pairing.bridgeName })}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('imaging:onboarding.wizard.success.description')}</p>
              {pairing.createdAgent && pairing.createdAgent.bindings.length > 0 && (
                <div className="space-y-1.5 rounded-lg border border-gray-200 p-3 text-left text-sm dark:border-gray-700">
                  {pairing.createdAgent.bindings.map(b => (
                    <div key={b.id} className="flex items-center gap-2">
                      <span className="badge badge-blue">
                        {t(`imaging:modalities.${b.modality}`, { defaultValue: b.modality })}
                      </span>
                      <span className="text-gray-700 dark:text-gray-300">{b.displayName ?? b.deviceId}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-400">
                {t('imaging:onboarding.wizard.success.nextSteps')}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-between gap-2 border-t border-gray-200 px-4 py-3 sm:px-6 sm:py-4 dark:border-gray-700">
          {step === 'devices' && (
            <>
              <button onClick={onClose} className="btn-secondary text-sm">{t('common:cancel')}</button>
              <button
                onClick={() => setStep('install')}
                disabled={!isValidDeviceSelection(selectedIds)}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {t('common:continue', { defaultValue: 'Devam Et' })}
              </button>
            </>
          )}
          {step === 'install' && (
            <>
              <button onClick={() => setStep('devices')} className="btn-secondary text-sm">{t('common:back', { defaultValue: 'Geri' })}</button>
              <div className="flex items-center gap-2">
                {installer && (
                  <a
                    href={installer.downloadUrl}
                    className="btn-secondary flex items-center gap-1.5 text-sm"
                  >
                    <Download size={15} />
                    {t('imaging:onboarding.card.download')}
                  </a>
                )}
                <button onClick={() => { setBridgeName(''); setStep('pairing'); }} className="btn-primary text-sm">
                  {t('common:continue', { defaultValue: 'Devam Et' })}
                </button>
              </div>
            </>
          )}
          {step === 'pairing' && !pairing && (
            <>
              <button onClick={() => setStep('install')} className="btn-secondary text-sm">{t('common:back', { defaultValue: 'Geri' })}</button>
              <div className="flex flex-1 items-center gap-2 justify-end">
                <input
                  type="text"
                  value={bridgeName}
                  onChange={e => setBridgeName(e.target.value)}
                  placeholder={t('imaging:onboarding.wizard.pairing.namePlaceholder') as string}
                  maxLength={200}
                  className="input-field flex-1 max-w-xs text-sm"
                />
                <button
                  onClick={generateCode}
                  disabled={!bridgeName.trim() || creating}
                  className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
                >
                  {creating && <Loader2 size={15} className="animate-spin" />}
                  {t('imaging:onboarding.wizard.pairing.generateCode')}
                </button>
              </div>
            </>
          )}
          {step === 'pairing' && pairing && (
            <div className="flex-1" />
          )}
          {step === 'success' && (
            <button onClick={onClose} className="btn-primary ml-auto text-sm">{t('common:close', { defaultValue: 'Kapat' })}</button>
          )}
        </div>

        {createError && (
          <div role="alert" className="mx-4 mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 sm:mx-6 dark:bg-red-900/20 dark:text-red-300">
            {createError}
          </div>
        )}
      </div>
    </div>
  );
};

export default BridgeSetupWizard;
