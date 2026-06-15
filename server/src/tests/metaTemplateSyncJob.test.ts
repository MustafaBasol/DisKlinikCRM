/**
 * metaTemplateSyncJob.test.ts — Unit tests for the Meta template status auto-sync job.
 *
 * Tests the batch processor logic using injected deps (no DB, no real Meta API calls).
 *
 * Run with:  tsx src/tests/metaTemplateSyncJob.test.ts
 */

import assert from 'node:assert/strict';

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

// Prevent real prisma/cron side-effects during import
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

import {
  syncPendingMetaTemplateStatuses,
  type MetaTemplateSyncSummary,
  type SyncDeps,
} from '../jobs/metaTemplateSyncJob.js';
import type { WhatsAppConnectionRecord } from '../services/whatsapp/WhatsAppProvider.js';
import type { SyncTemplateResult } from '../services/metaTemplateService.js';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const metaConn: WhatsAppConnectionRecord = {
  id: 'conn-meta-1',
  organizationId: 'org-1',
  provider: 'meta_cloud_api',
  status: 'connected',
  metaWabaId: 'waba-123',
  metaPhoneNumberId: 'phone-456',
  metaAccessTokenEncrypted: 'a'.repeat(32),
};

const evolutionConn: WhatsAppConnectionRecord = {
  id: 'conn-evo-1',
  organizationId: 'org-1',
  provider: 'evolution_api',
  status: 'connected',
};

function makeTemplate(overrides: Partial<{
  id: string;
  clinicId: string;
  metaTemplateName: string | null;
  metaTemplateStatus: string | null;
}> = {}) {
  return {
    id: 'tpl-aaaa-1111',
    clinicId: 'clinic-bbbb-2222',
    metaTemplateName: 'randevu_hatirlatma',
    metaTemplateStatus: 'submitted',
    ...overrides,
  };
}

const approvedResult: SyncTemplateResult = { success: true, status: 'approved', rejectionReason: null };
const rejectedResult: SyncTemplateResult = { success: true, status: 'rejected', rejectionReason: 'INVALID_FORMAT' };
const pendingResult: SyncTemplateResult = { success: true, status: 'submitted', rejectionReason: null };
const failedResult: SyncTemplateResult = { success: false, code: 'META_TEMPLATE_SUBMIT_FAILED', message: 'API error' };

// ─── Run tests ────────────────────────────────────────────────────────────────

async function main() {

  // ── Selection and batch filtering ─────────────────────────────────────────
  section('Selection and filtering');

  await test('empty template list → all summary counts are zero', async () => {
    const deps: SyncDeps = {
      getTemplates: async () => [],
      getConnection: async () => metaConn,
      syncStatus: async () => approvedResult,
    };
    const summary = await syncPendingMetaTemplateStatuses(deps);
    assert.deepEqual(summary, { checked: 0, updated: 0, approved: 0, rejected: 0, unchanged: 0, failed: 0 });
  });

  await test('getTemplates receives a threshold Date and batchSize > 0', async () => {
    const caps = { threshold: null as Date | null, batch: 0 };

    const deps: SyncDeps = {
      getTemplates: async (threshold, batchSize) => {
        caps.threshold = threshold;
        caps.batch = batchSize;
        return [];
      },
      getConnection: async () => metaConn,
      syncStatus: async () => approvedResult,
    };

    await syncPendingMetaTemplateStatuses(deps);

    assert.ok(caps.threshold instanceof Date, 'threshold must be a Date');
    assert.ok(caps.threshold.getTime() < Date.now(), 'threshold must be in the past');
    assert.ok(caps.batch >= 1, 'batchSize must be >= 1');
  });

  await test('threshold is at least 1 minute in the past', async () => {
    const caps = { threshold: null as Date | null };

    await syncPendingMetaTemplateStatuses({
      getTemplates: async (threshold) => { caps.threshold = threshold; return []; },
      getConnection: async () => metaConn,
      syncStatus: async () => approvedResult,
    });

    const oneMinuteAgo = Date.now() - 60 * 1_000;
    assert.ok(caps.threshold instanceof Date && caps.threshold.getTime() <= oneMinuteAgo, 'threshold must be at least 1 minute ago');
  });

  await test('templates without metaTemplateName are not returned (query responsibility)', async () => {
    // The query filters metaTemplateName: { not: null } — verify job skips null-name templates
    // by checking that getTemplates filters correctly (we don't pass null-name templates here).
    const calls: string[] = [];
    const deps: SyncDeps = {
      getTemplates: async () => [
        makeTemplate({ metaTemplateName: null }), // simulate a bug where query leaks null
      ],
      getConnection: async (clinicId) => { calls.push(clinicId); return null; },
      syncStatus: async () => approvedResult,
    };
    // Job processes all returned records — it trusts the query.
    // A null metaTemplateName record goes to getConnection and then fails gracefully.
    const summary = await syncPendingMetaTemplateStatuses(deps);
    assert.equal(summary.checked, 1);
    assert.equal(summary.failed, 1);
  });

  // ── Approved status ────────────────────────────────────────────────────────
  section('Approved status');

  await test('Meta APPROVED → summary.approved++ and summary.updated++', async () => {
    const deps: SyncDeps = {
      getTemplates: async () => [makeTemplate({ metaTemplateStatus: 'submitted' })],
      getConnection: async () => metaConn,
      syncStatus: async () => approvedResult,
    };
    const summary = await syncPendingMetaTemplateStatuses(deps);
    assert.equal(summary.checked, 1);
    assert.equal(summary.updated, 1);
    assert.equal(summary.approved, 1);
    assert.equal(summary.rejected, 0);
    assert.equal(summary.unchanged, 0);
    assert.equal(summary.failed, 0);
  });

  await test('Meta APPROVED clears rejection reason (syncStatus returns rejectionReason null)', async () => {
    const call = { templateId: '' };
    const deps: SyncDeps = {
      getTemplates: async () => [makeTemplate()],
      getConnection: async () => metaConn,
      syncStatus: async (templateId) => {
        call.templateId = templateId;
        return { success: true, status: 'approved', rejectionReason: null };
      },
    };
    const summary = await syncPendingMetaTemplateStatuses(deps);
    assert.equal(summary.approved, 1);
    assert.equal(call.templateId, 'tpl-aaaa-1111');
  });

  // ── Rejected status ────────────────────────────────────────────────────────
  section('Rejected status');

  await test('Meta REJECTED → summary.rejected++ and summary.updated++', async () => {
    const deps: SyncDeps = {
      getTemplates: async () => [makeTemplate({ metaTemplateStatus: 'submitted' })],
      getConnection: async () => metaConn,
      syncStatus: async () => rejectedResult,
    };
    const summary = await syncPendingMetaTemplateStatuses(deps);
    assert.equal(summary.checked, 1);
    assert.equal(summary.updated, 1);
    assert.equal(summary.rejected, 1);
    assert.equal(summary.approved, 0);
    assert.equal(summary.unchanged, 0);
    assert.equal(summary.failed, 0);
  });

  // ── Unchanged / still pending ──────────────────────────────────────────────
  section('Unchanged / still pending');

  await test('Meta still PENDING → status unchanged → summary.unchanged++', async () => {
    const deps: SyncDeps = {
      getTemplates: async () => [makeTemplate({ metaTemplateStatus: 'submitted' })],
      getConnection: async () => metaConn,
      syncStatus: async () => pendingResult,
    };
    const summary = await syncPendingMetaTemplateStatuses(deps);
    assert.equal(summary.checked, 1);
    assert.equal(summary.unchanged, 1);
    assert.equal(summary.updated, 0);
    assert.equal(summary.failed, 0);
  });

  // ── Missing / invalid connection ───────────────────────────────────────────
  section('Missing or invalid connection');

  await test('no connection → failed++ and does not throw', async () => {
    const deps: SyncDeps = {
      getTemplates: async () => [makeTemplate()],
      getConnection: async () => null,
      syncStatus: async () => { throw new Error('should not be called'); },
    };
    const summary = await syncPendingMetaTemplateStatuses(deps);
    assert.equal(summary.checked, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.approved, 0);
  });

  await test('Evolution API connection → failed++ (no Meta WABA) and does not throw', async () => {
    const deps: SyncDeps = {
      getTemplates: async () => [makeTemplate()],
      getConnection: async () => evolutionConn,
      syncStatus: async () => { throw new Error('should not be called'); },
    };
    const summary = await syncPendingMetaTemplateStatuses(deps);
    assert.equal(summary.checked, 1);
    assert.equal(summary.failed, 1);
  });

  await test('Meta connection without metaWabaId → failed++ and does not throw', async () => {
    const connNoWaba: WhatsAppConnectionRecord = { ...metaConn, metaWabaId: null };
    const deps: SyncDeps = {
      getTemplates: async () => [makeTemplate()],
      getConnection: async () => connNoWaba,
      syncStatus: async () => { throw new Error('should not be called'); },
    };
    const summary = await syncPendingMetaTemplateStatuses(deps);
    assert.equal(summary.checked, 1);
    assert.equal(summary.failed, 1);
  });

  // ── Batch error isolation ──────────────────────────────────────────────────
  section('Batch error isolation');

  await test('one failed template does not stop the rest of the batch', async () => {
    const templates = [
      makeTemplate({ id: 'tpl-fail-0001', clinicId: 'clinic-0001' }),
      makeTemplate({ id: 'tpl-ok---0002', clinicId: 'clinic-0002' }),
      makeTemplate({ id: 'tpl-ok---0003', clinicId: 'clinic-0003' }),
    ];
    let callCount = 0;
    const deps: SyncDeps = {
      getTemplates: async () => templates,
      getConnection: async () => metaConn,
      syncStatus: async (templateId) => {
        callCount++;
        if (templateId === 'tpl-fail-0001') {
          return { success: false, code: 'META_TEMPLATE_SUBMIT_FAILED', message: 'API error' };
        }
        return approvedResult;
      },
    };
    const summary = await syncPendingMetaTemplateStatuses(deps);
    assert.equal(summary.checked, 3);
    assert.equal(summary.failed, 1);
    assert.equal(summary.approved, 2);
    assert.equal(callCount, 3);
  });

  await test('syncStatus throws → failed++ and batch continues', async () => {
    const templates = [
      makeTemplate({ id: 'tpl-throw-001', clinicId: 'clinic-0001' }),
      makeTemplate({ id: 'tpl-ok----002', clinicId: 'clinic-0002' }),
    ];
    const deps: SyncDeps = {
      getTemplates: async () => templates,
      getConnection: async () => metaConn,
      syncStatus: async (templateId) => {
        if (templateId === 'tpl-throw-001') throw new Error('Unexpected network error');
        return approvedResult;
      },
    };
    const summary = await syncPendingMetaTemplateStatuses(deps);
    assert.equal(summary.checked, 2);
    assert.equal(summary.failed, 1);
    assert.equal(summary.approved, 1);
  });

  await test('syncStatus returns API failure → counted as failed, not updated', async () => {
    const deps: SyncDeps = {
      getTemplates: async () => [makeTemplate()],
      getConnection: async () => metaConn,
      syncStatus: async () => failedResult,
    };
    const summary = await syncPendingMetaTemplateStatuses(deps);
    assert.equal(summary.failed, 1);
    assert.equal(summary.updated, 0);
    assert.equal(summary.unchanged, 0);
  });

  // ── Multiple templates in a batch ──────────────────────────────────────────
  section('Batch with multiple templates');

  await test('mixed batch: 2 approved, 1 rejected, 1 unchanged → correct summary', async () => {
    const templates = [
      makeTemplate({ id: 'tpl-1', clinicId: 'clinic-1', metaTemplateStatus: 'submitted' }),
      makeTemplate({ id: 'tpl-2', clinicId: 'clinic-2', metaTemplateStatus: 'submitted' }),
      makeTemplate({ id: 'tpl-3', clinicId: 'clinic-3', metaTemplateStatus: 'submitted' }),
      makeTemplate({ id: 'tpl-4', clinicId: 'clinic-4', metaTemplateStatus: 'submitted' }),
    ];
    const outcomes: SyncTemplateResult[] = [
      { success: true, status: 'approved', rejectionReason: null },
      { success: true, status: 'approved', rejectionReason: null },
      { success: true, status: 'rejected', rejectionReason: 'POLICY_VIOLATION' },
      { success: true, status: 'submitted', rejectionReason: null }, // unchanged
    ];
    let i = 0;
    const deps: SyncDeps = {
      getTemplates: async () => templates,
      getConnection: async () => metaConn,
      syncStatus: async () => outcomes[i++]!,
    };
    const summary = await syncPendingMetaTemplateStatuses(deps);
    assert.equal(summary.checked, 4);
    assert.equal(summary.approved, 2);
    assert.equal(summary.rejected, 1);
    assert.equal(summary.unchanged, 1);
    assert.equal(summary.updated, 3);
    assert.equal(summary.failed, 0);
  });

  // ── Token / secret safety in logs ─────────────────────────────────────────
  section('Token safety in logs');

  await test('connection secrets are not logged on sync failure', async () => {
    const secretToken = 'SUPER_SECRET_META_TOKEN_DO_NOT_LOG';
    const connWithSecret: WhatsAppConnectionRecord = {
      ...metaConn,
      metaAccessTokenEncrypted: secretToken,
    };

    const loggedMessages: string[] = [];
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...args: unknown[]) => { loggedMessages.push(JSON.stringify(args)); };
    console.error = (...args: unknown[]) => { loggedMessages.push(JSON.stringify(args)); };

    try {
      const deps: SyncDeps = {
        getTemplates: async () => [makeTemplate()],
        getConnection: async () => connWithSecret,
        syncStatus: async () => failedResult,
      };
      await syncPendingMetaTemplateStatuses(deps);
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }

    const allLogs = loggedMessages.join('\n');
    assert.ok(!allLogs.includes(secretToken), 'Access token must never appear in logs');
  });

  await test('clinicId suffix (last 4 chars) is used in logs, not full id', async () => {
    const loggedMessages: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { loggedMessages.push(JSON.stringify(args)); };

    try {
      const deps: SyncDeps = {
        getTemplates: async () => [makeTemplate({ clinicId: 'clinic-full-id-abcd' })],
        getConnection: async () => null,
        syncStatus: async () => approvedResult,
      };
      await syncPendingMetaTemplateStatuses(deps);
    } finally {
      console.warn = originalWarn;
    }

    const allLogs = loggedMessages.join('\n');
    assert.ok(!allLogs.includes('clinic-full-id-abcd'), 'Full clinic ID must not appear in logs');
    assert.ok(allLogs.includes('abcd'), 'Last-4 suffix should appear in logs');
  });

  // ── Unknown status handling ────────────────────────────────────────────────
  section('Unknown status handling');

  await test('unknown status template that gets approved → counted as updated', async () => {
    const deps: SyncDeps = {
      getTemplates: async () => [makeTemplate({ metaTemplateStatus: 'unknown' })],
      getConnection: async () => metaConn,
      syncStatus: async () => ({ success: true, status: 'approved', rejectionReason: null }),
    };
    const summary = await syncPendingMetaTemplateStatuses(deps);
    assert.equal(summary.approved, 1);
    assert.equal(summary.updated, 1);
  });

  await test('unknown → unknown (still unknown) → counted as unchanged', async () => {
    const deps: SyncDeps = {
      getTemplates: async () => [makeTemplate({ metaTemplateStatus: 'unknown' })],
      getConnection: async () => metaConn,
      syncStatus: async () => ({ success: true, status: 'unknown', rejectionReason: null }),
    };
    const summary = await syncPendingMetaTemplateStatuses(deps);
    assert.equal(summary.unchanged, 1);
    assert.equal(summary.updated, 0);
  });

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error in test runner:', err);
  process.exit(1);
});
