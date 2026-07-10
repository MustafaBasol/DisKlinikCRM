// Saf yardımcılar: köprü self-servis kurulum sihirbazı (PR 5/7) için cihaz
// uygunluğu, eşleştirme durumu ve geri sayım hesaplaması. Test edilebilir
// olmaları için bileşenden ayrıştırıldı — hiçbiri DOM/zamanlayıcıya dokunmaz.

export interface OnboardingDeviceLike {
  id: string;
  isActive: boolean;
  connectionType: string;
}

export const MAX_PAIRING_DEVICES = 50;

/** Sihirbazın 1. adımında seçilebilecek cihazlar: aktif ve bridge bağlantı türünde olanlar. */
export function filterEligibleDevices<T extends OnboardingDeviceLike>(devices: T[]): T[] {
  return devices.filter(d => d.isActive && d.connectionType === 'bridge');
}

/** En az 1, en fazla MAX_PAIRING_DEVICES cihaz seçilmiş olmalı (backend ile senkron). */
export function isValidDeviceSelection(selectedIds: string[]): boolean {
  return selectedIds.length >= 1 && selectedIds.length <= MAX_PAIRING_DEVICES;
}

// Backend contract (server/src/routes/imaging.ts) sets a successfully
// consumed pairing to 'redeemed'. 'used' is kept here only as a legacy/test
// compatibility alias — it is not sent by the current backend — so both map
// to the same UI success state without ever changing the backend contract.
export type PairingApiStatus = 'pending' | 'redeemed' | 'used' | 'expired' | 'cancelled' | 'locked';

export type PairingUiStatus = 'pending' | 'success' | 'expired' | 'cancelled' | 'locked';

export interface PairingStatusLike {
  status: string;
  expiresAt: string;
}

/**
 * Sunucudan gelen 'pending' durumu, expiresAt geçmişse yerel olarak 'expired'
 * gösterilir — backend durumu heartbeat/poll olmadan otomatik güncellemez,
 * bu yüzden istemci saatine göre bir gösterim düzeltmesi gerekir. Diğer
 * terminal durumlar (redeemed/used/cancelled/locked) olduğu gibi geçer.
 */
export function derivePairingDisplayStatus(pairing: PairingStatusLike, now: number = Date.now()): PairingApiStatus {
  if (pairing.status === 'pending' && new Date(pairing.expiresAt).getTime() <= now) {
    return 'expired';
  }
  return pairing.status as PairingApiStatus;
}

/** True for the backend's terminal success status and its legacy/test alias. */
export function isPairingSuccessStatus(status: string): boolean {
  return status === 'redeemed' || status === 'used';
}

/** Normalizes the raw API status into the small set of states the wizard UI renders. */
export function toPairingUiStatus(pairing: PairingStatusLike, now: number = Date.now()): PairingUiStatus {
  const status = derivePairingDisplayStatus(pairing, now);
  if (status === 'pending') return 'pending';
  if (isPairingSuccessStatus(status)) return 'success';
  return status as Exclude<PairingApiStatus, 'pending' | 'redeemed' | 'used'>;
}

/** Yalnızca 'pending' (ve süresi henüz dolmamış) oturumlar için polling sürer. */
export function shouldPollPairing(pairing: PairingStatusLike, now: number = Date.now()): boolean {
  return derivePairingDisplayStatus(pairing, now) === 'pending';
}

export interface Countdown {
  totalSeconds: number;
  minutes: number;
  seconds: number;
  expired: boolean;
}

/** expiresAt'e kalan süre — asla negatif döndürmez, sıfırlanınca expired=true. */
export function computeCountdown(expiresAt: string, now: number = Date.now()): Countdown {
  const remainingMs = new Date(expiresAt).getTime() - now;
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return {
    totalSeconds,
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60,
    expired: totalSeconds <= 0,
  };
}

/** "M:SS" gösterim biçimi, örn. 9:05. */
export function formatCountdown(countdown: Countdown): string {
  return `${countdown.minutes}:${String(countdown.seconds).padStart(2, '0')}`;
}

/**
 * Onboarding (pairing oluşturma/polling) yalnızca tek, açık bir klinik
 * seçiliyken çalışabilir — "Tüm klinikler" (undefined veya 'all') iken
 * ambiguous clinic context'te pairing oluşturmak/polling yapmak yasak.
 */
export function canStartOnboarding(clinicId: string | undefined | null): clinicId is string {
  return typeof clinicId === 'string' && clinicId.length > 0 && clinicId !== 'all';
}
