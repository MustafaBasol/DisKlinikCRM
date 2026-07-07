// Saf yardımcılar: köprü ajanı görünüm durumu ve güvenli watch config üretimi.
// Test edilebilir olmaları için ImagingSettingsPanel'den ayrıştırıldı.
import { BRIDGE_ONLINE_THRESHOLD_MS } from './constants';

export interface BridgeStatusInput {
  status: string;
  lastSeenAt?: string | null;
}

export type BridgeDisplayStatus = 'pending' | 'online' | 'offline' | 'revoked';

/**
 * Köprü durumu: revoked kalıcıdır (heartbeat tazeliğinden bağımsız); aksi
 * halde tazelik lastSeenAt'ten türetilir (backend 'offline' durumunu
 * otomatik işaretlemez — docs/47). Hiç heartbeat almamış bir ajan asla
 * 'online' gösterilmez.
 */
export function deriveBridgeStatus(bridge: BridgeStatusInput): BridgeDisplayStatus {
  if (bridge.status === 'revoked') return 'revoked';
  if (!bridge.lastSeenAt) return 'pending';
  const fresh = Date.now() - new Date(bridge.lastSeenAt).getTime() < BRIDGE_ONLINE_THRESHOLD_MS;
  return fresh ? 'online' : 'offline';
}

export interface BridgeWatchConfigDevice {
  id: string;
  name: string;
  modality: string;
}

export interface BridgeWatchConfig {
  id: string;
  path: string;
  deviceId: string;
  modality: string;
  patterns: string[];
}

const WATCH_FILE_PATTERNS = ['.jpg', '.jpeg', '.png', '.webp', '.dcm', '.dicom'];

/** Cihaz adından güvenli bir watch id üretir (küçük harf, yalnızca [a-z0-9-]). */
export function slugifyWatchId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'xray-room-1';
}

/**
 * bridge-agent config.json → watches[] için tek bir güvenli girdi üretir.
 * Yol her zaman bariz bir yer tutucudur; klinik makinesinin gerçek klasörü
 * hiçbir zaman bilinemez/varsayılamaz. Token/tokenFile/gizli bilgi ASLA
 * eklenmez.
 */
export function generateBridgeWatchConfig(device: BridgeWatchConfigDevice): BridgeWatchConfig {
  return {
    id: slugifyWatchId(device.name),
    path: 'C:\\DentalSoftware\\Export',
    deviceId: device.id,
    modality: device.modality,
    patterns: [...WATCH_FILE_PATTERNS],
  };
}

export function generateBridgeWatchConfigJson(device: BridgeWatchConfigDevice): string {
  return JSON.stringify(generateBridgeWatchConfig(device), null, 2);
}
