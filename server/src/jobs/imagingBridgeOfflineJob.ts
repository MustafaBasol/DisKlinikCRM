/**
 * imagingBridgeOfflineJob.ts — Bayat köprü ajanlarını 'offline' işaretler.
 *
 * Heartbeat/upload akışı ajanı 'online'a çeker ama hiçbir yol onu geri
 * 'offline'a çekmez — ajan süreci durduğunda (PC kapandı, ağ kesildi) durum
 * sonsuza dek 'online' görünür kalırdı. Bu job periyodik olarak lastSeenAt'i
 * eşiğin ötesinde kalan, hâlâ 'online' ajanları 'offline'a çeker.
 *
 * Yalnızca status='online' satırları hedeflenir: 'revoked' ve 'pending'
 * durumları asla değiştirilmez (inboundEventRetryJob.ts şablonu — withJobLock
 * ile çoklu instance/replika güvenli, docs/45 Faz 3 #9-10).
 */

import cron from 'node-cron';
import prisma from '../db.js';
import { withJobLock } from '../utils/jobLock.js';

const OFFLINE_THRESHOLD_MINUTES = Math.max(1, Number(process.env.IMAGING_BRIDGE_OFFLINE_MINUTES) || 5);
export const OFFLINE_THRESHOLD_MS = OFFLINE_THRESHOLD_MINUTES * 60 * 1000;

export async function runImagingBridgeOfflineJob(): Promise<void> {
  const cutoff = new Date(Date.now() - OFFLINE_THRESHOLD_MS);

  const result = await prisma.imagingBridgeAgent.updateMany({
    where: {
      status: 'online',
      lastSeenAt: { lt: cutoff },
    },
    data: { status: 'offline' },
  });

  if (result.count > 0) {
    console.info(`[imaging-bridge-offline] Marked ${result.count} stale bridge agent(s) offline.`);
  }
}

let offlineJobRunning = false;

export function startImagingBridgeOfflineJob(): void {
  cron.schedule('*/2 * * * *', () => {
    if (offlineJobRunning) {
      console.warn('[imaging-bridge-offline] Previous run still in progress, skipping this tick.');
      return;
    }
    offlineJobRunning = true;
    withJobLock('imaging-bridge-offline', 2 * 60 * 1000, runImagingBridgeOfflineJob)
      .catch(error => console.error('[imaging-bridge-offline] Job run failed:', error))
      .finally(() => {
        offlineJobRunning = false;
      });
  });
  console.log(`[imaging-bridge-offline] Stale bridge agent offline job scheduled (every 2 min, threshold ${OFFLINE_THRESHOLD_MINUTES}min).`);
}
