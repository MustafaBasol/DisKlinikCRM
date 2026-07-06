// server/src/schemas/index.ts IMAGING_MODALITIES ile senkron tutulmalıdır.
export const IMAGING_MODALITIES = ['IO', 'PX', 'CT', 'CEPH', 'IO_CAMERA', 'SCANNER', 'OTHER'] as const;

// server/src/schemas/index.ts IMAGING_DEVICE_CONNECTION_TYPES ile senkron.
export const IMAGING_DEVICE_CONNECTION_TYPES = ['manual', 'bridge', 'dicomweb'] as const;

// Backend varsayılanı (IMAGING_MAX_FILE_MB env, default 50) — yalnızca ipucu
// metni içindir; gerçek sınır sunucuda uygulanır.
export const IMAGING_MAX_FILE_MB = 50;

// Köprü ajanı bu süreden daha eski heartbeat attıysa çevrimdışı sayılır
// (backend 'offline' durumunu otomatik işaretlemez; tazelik istemcide türetilir).
export const BRIDGE_ONLINE_THRESHOLD_MS = 5 * 60 * 1000;
