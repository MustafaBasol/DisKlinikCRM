/**
 * worker.ts — Cron job'ları API sürecinden ayrı çalıştıran worker girişi
 * (docs/45 Faz 3 #10).
 *
 * Reminder job'un yüzlerce klinikte dakikalar süren koşusu API ile aynı event
 * loop'ta olduğunda tüm HTTP yanıtlarını geciktirir. Ayrı worker ile:
 *
 *   API   : RUN_BACKGROUND_JOBS=false  npm run start
 *   Worker: npm run start:worker
 *
 * RUN_BACKGROUND_JOBS ayarlanmazsa API job'ları kendi içinde koşturmaya devam
 * eder (tek süreçli kurulumda davranış değişmez). Worker ve API yanlışlıkla
 * birlikte job koşturursa JobLock lease kilidi mükerrer koşuyu engeller.
 */

import dotenv from 'dotenv';
import prisma from './db.js';
import { startBackgroundJobs } from './jobs/startBackgroundJobs.js';
import { closeRedis } from './utils/redis.js';
import { resolveWorkerBackgroundJobsOwnership } from './utils/backgroundJobsOwnership.js';
import { assertProcessRole } from './utils/processRole.js';

dotenv.config();

// F3-IMPL-002: fails closed (throws) if NORAMEDI_PROCESS_ROLE is explicitly
// set to something other than "worker" — see utils/processRole.ts. Unset is
// fine (pre-existing single-process/dev/test shape, unchanged).
const processRole = assertProcessRole('worker');

const jobsOwnership = resolveWorkerBackgroundJobsOwnership();
console.log(
  `[worker] Background job worker starting... role=worker (declared=${processRole.declared}) ` +
    `ownsJobs=${jobsOwnership.ownsJobs} (${jobsOwnership.reason})`,
);
startBackgroundJobs();
console.log('[worker] All background jobs scheduled.');

// Graceful shutdown: DB havuzu ve Redis bağlantısı düzgün kapanır
// (bkz. index.ts'teki eşdeğeri).
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${signal} received, shutting down...`);
  Promise.allSettled([prisma.$disconnect(), closeRedis()]).finally(() => {
    console.log('[worker] Clean exit.');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('[worker] Forced exit after 10s timeout.');
    process.exit(1);
  }, 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
