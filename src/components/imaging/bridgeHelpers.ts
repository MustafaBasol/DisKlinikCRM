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
