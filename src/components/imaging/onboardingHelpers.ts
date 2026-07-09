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

export type PairingApiStatus = 'pending' | 'used' | 'expired' | 'cancelled' | 'locked';

export interface PairingStatusLike {
  status: string;
  expiresAt: string;
}

/**
 * Sunucudan gelen 'pending' durumu, expiresAt geçmişse yerel olarak 'expired'
 * gösterilir — backend durumu heartbeat/poll olmadan otomatik güncellemez,
 * bu yüzden istemci saatine göre bir gösterim düzeltmesi gerekir. Diğer
 * terminal durumlar (used/cancelled/locked) olduğu gibi geçer.
 */
export function derivePairingDisplayStatus(pairing: PairingStatusLike, now: number = Date.now()): PairingApiStatus {
  if (pairing.status === 'pending' && new Date(pairing.expiresAt).getTime() <= now) {
    return 'expired';
  }
  return pairing.status as PairingApiStatus;
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
