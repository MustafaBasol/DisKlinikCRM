/**
 * metaTemplateSyncJob.ts — Background sync for pending Meta WhatsApp templates.
 *
 * Polls Meta's Graph API for templates whose status is still pending
 * (stored as 'submitted' or 'unknown') and updates the DB when Meta
 * approves or rejects them.
 *
 * Env vars (all optional):
 *   META_TEMPLATE_STATUS_SYNC_ENABLED          — set to "false" to disable (default: enabled)
 *   META_TEMPLATE_STATUS_SYNC_INTERVAL_MINUTES — min minutes between per-template checks (default: 15)
 *   META_TEMPLATE_STATUS_SYNC_BATCH_SIZE       — max templates per run (default: 50)
 */

import cron from 'node-cron';
import prisma from '../db.js';
import {
  syncMetaTemplateStatus,
  type SyncTemplateResult,
} from '../services/metaTemplateService.js';
import { resolveConnectionForClinic } from '../services/whatsapp/whatsappService.js';
import { evaluateTemplateBinding } from '../services/whatsapp/templateBinding.js';
import type { WhatsAppConnectionRecord } from '../services/whatsapp/WhatsAppProvider.js';
import { withJobLock } from '../utils/jobLock.js';

// ── Config ────────────────────────────────────────────────────────────────────

const SYNC_ENABLED = process.env.META_TEMPLATE_STATUS_SYNC_ENABLED !== 'false';
const SYNC_INTERVAL_MINUTES = Math.max(
  1,
  parseInt(process.env.META_TEMPLATE_STATUS_SYNC_INTERVAL_MINUTES ?? '15', 10),
);
const SYNC_BATCH_SIZE = Math.max(
  1,
  Math.min(100, parseInt(process.env.META_TEMPLATE_STATUS_SYNC_BATCH_SIZE ?? '50', 10)),
);

// Statuses that indicate a template is still awaiting Meta review.
// 'submitted' is our normalised form of PENDING / IN_APPEAL / PENDING_DELETION.
// 'unknown' covers any unrecognised status string returned by Meta.
const PENDING_STATUSES = ['submitted', 'unknown'];

// ── Types ─────────────────────────────────────────────────────────────────────

export type MetaTemplateSyncSummary = {
  checked: number;
  updated: number;
  approved: number;
  rejected: number;
  unchanged: number;
  failed: number;
};

type TemplateSyncRecord = {
  id: string;
  clinicId: string;
  metaTemplateName: string | null;
  metaTemplateStatus: string | null;
  metaTemplateConnectionId?: string | null;
  metaWabaIdSnapshot?: string | null;
};

export type SyncDeps = {
  getTemplates: (threshold: Date, batchSize: number) => Promise<TemplateSyncRecord[]>;
  getConnection: (clinicId: string) => Promise<WhatsAppConnectionRecord | null>;
  syncStatus: (templateId: string, connection: WhatsAppConnectionRecord) => Promise<SyncTemplateResult>;
};

// ── Default production deps ───────────────────────────────────────────────────

function defaultDeps(): SyncDeps {
  return {
    getTemplates: (threshold, batchSize) =>
      prisma.messageTemplate.findMany({
        where: {
          channel: 'whatsapp',
          metaTemplateName: { not: null },
          metaTemplateLanguage: { not: null },
          metaTemplateStatus: { in: PENDING_STATUSES },
          OR: [
            { metaTemplateLastSyncedAt: null },
            { metaTemplateLastSyncedAt: { lt: threshold } },
          ],
        },
        select: {
          id: true,
          clinicId: true,
          metaTemplateName: true,
          metaTemplateStatus: true,
          metaTemplateConnectionId: true,
          metaWabaIdSnapshot: true,
        },
        take: batchSize,
        orderBy: { metaTemplateLastSyncedAt: 'asc' },
      }),
    getConnection: resolveConnectionForClinic,
    syncStatus: syncMetaTemplateStatus,
  };
}

// ── Core batch processor ──────────────────────────────────────────────────────

/**
 * Find all pending WhatsApp templates and sync their status from Meta.
 * Safe to call from a cron job: catches per-template errors and continues.
 *
 * Accepts optional `deps` for test injection (getTemplates / getConnection / syncStatus).
 */
export async function syncPendingMetaTemplateStatuses(
  deps?: Partial<SyncDeps>,
): Promise<MetaTemplateSyncSummary> {
  const summary: MetaTemplateSyncSummary = {
    checked: 0,
    updated: 0,
    approved: 0,
    rejected: 0,
    unchanged: 0,
    failed: 0,
  };

  const resolved: SyncDeps = { ...defaultDeps(), ...deps };
  const threshold = new Date(Date.now() - SYNC_INTERVAL_MINUTES * 60 * 1_000);

  const templates = await resolved.getTemplates(threshold, SYNC_BATCH_SIZE);

  for (const template of templates) {
    summary.checked++;
    try {
      const connection = await resolved.getConnection(template.clinicId);

      if (!connection) {
        console.warn('[meta-template-sync] no-connection', {
          clinicIdSuffix: template.clinicId.slice(-4),
        });
        summary.failed++;
        continue;
      }

      if (connection.provider !== 'meta_cloud_api') {
        // Not a Meta Cloud connection — template management API unavailable.
        summary.failed++;
        continue;
      }

      if (!connection.metaWabaId) {
        console.warn('[meta-template-sync] missing-waba-id', {
          clinicIdSuffix: template.clinicId.slice(-4),
        });
        summary.failed++;
        continue;
      }

      if (
        template.metaTemplateConnectionId &&
        template.metaWabaIdSnapshot &&
        evaluateTemplateBinding(template, connection) === 'mismatched'
      ) {
        // The clinic's active connection/WABA no longer matches what this template
        // was submitted against. Don't sync against the wrong WABA — a human needs
        // to resubmit via the manual sync endpoint, which resolves the stored binding.
        console.warn('[meta-template-sync] waba-mismatch', {
          templateIdSuffix: template.id.slice(-4),
          clinicIdSuffix: template.clinicId.slice(-4),
        });
        summary.failed++;
        continue;
      }

      const oldStatus = template.metaTemplateStatus;
      const result = await resolved.syncStatus(template.id, connection);

      if (!result.success) {
        console.warn('[meta-template-sync] sync-failed', {
          templateIdSuffix: template.id.slice(-4),
          clinicIdSuffix: template.clinicId.slice(-4),
          code: result.code,
        });
        summary.failed++;
        continue;
      }

      const newStatus = result.status;
      if (newStatus !== oldStatus) {
        summary.updated++;
        if (newStatus === 'approved') summary.approved++;
        if (newStatus === 'rejected') summary.rejected++;
        console.log('[meta-template-sync] status-changed', {
          templateIdSuffix: template.id.slice(-4),
          clinicIdSuffix: template.clinicId.slice(-4),
          oldStatus,
          newStatus,
        });
      } else {
        summary.unchanged++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[meta-template-sync] unexpected-error', {
        templateIdSuffix: template.id.slice(-4),
        clinicIdSuffix: template.clinicId.slice(-4),
        error: msg.slice(0, 200),
      });
      summary.failed++;
    }
  }

  return summary;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function startMetaTemplateSyncJob(): void {
  if (!SYNC_ENABLED) {
    console.log('[meta-template-sync] Disabled via META_TEMPLATE_STATUS_SYNC_ENABLED=false');
    return;
  }

  cron.schedule('*/15 * * * *', () => {
    // Paylaşımlı kilit: birden fazla replika/worker Meta API'sine aynı
    // template'ler için mükerrer sorgu atmasın (docs/45 Faz 3 #9-10).
    withJobLock('meta-template-sync', 15 * 60 * 1000, async () => {
      const summary = await syncPendingMetaTemplateStatuses();
      if (summary.checked > 0) {
        console.log('[meta-template-sync] run-complete', summary);
      }
    }).catch((err: unknown) => {
      console.error('[meta-template-sync] unhandled-error', {
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    });
  });

  console.log(
    `[meta-template-sync] Scheduled every 15 minutes ` +
    `(batch=${SYNC_BATCH_SIZE}, interval=${SYNC_INTERVAL_MINUTES}m).`,
  );
}
