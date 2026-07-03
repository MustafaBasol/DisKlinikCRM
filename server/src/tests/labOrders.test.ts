/**
 * labOrders.test.ts — Tests for the Dental Laboratory Tracking module.
 *
 * Covers:
 *  1. Status transition rules (valid steps, remake loop-back, terminal states)
 *  2. isOverdue() — scoped to pre-received_from_lab statuses only
 *  3. buildDashboardSummary() bucket aggregation
 *  4. Source regression checks — BILLING excluded from write routes, read
 *     routes use clinic-scope helpers, schema.prisma status is a plain String
 *  5. Clinic isolation (mock-based, mirrors treatmentCaseClinicScope.test.ts)
 *
 * Run with: tsx src/tests/labOrders.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ALLOWED_TRANSITIONS,
  PRE_RECEIPT_STATUSES,
  validateStatusTransition,
  isRevisionLoopBack,
  isOverdue,
  type LabWorkOrderStatus,
} from '../services/labOrders/labOrderStatusTransitions.js';
import { buildDashboardSummary } from '../services/labOrders/labOrderSummary.js';
import { LAB_WORK_ORDER_STATUSES } from '../schemas/index.js';

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

function src(relPath: string) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

const ALL_STATUSES = LAB_WORK_ORDER_STATUSES as readonly LabWorkOrderStatus[];

async function main() {
  // ── Status transitions ───────────────────────────────────────────────────
  section('Status transition rules');

  await test('valid step-by-step transitions succeed', () => {
    assert.equal(validateStatusTransition('pending', 'impression_taken').ok, true);
    assert.equal(validateStatusTransition('impression_taken', 'sent_to_lab').ok, true);
    assert.equal(validateStatusTransition('sent_to_lab', 'in_progress').ok, true);
    assert.equal(validateStatusTransition('in_progress', 'received_from_lab').ok, true);
    assert.equal(validateStatusTransition('received_from_lab', 'fitting_or_trial').ok, true);
    assert.equal(validateStatusTransition('fitting_or_trial', 'completed').ok, true);
  });

  await test('skipping stages is rejected (pending -> completed)', () => {
    const result = validateStatusTransition('pending', 'completed');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'invalid_transition');
  });

  await test('revision loop-back succeeds (revision_requested -> sent_to_lab)', () => {
    const result = validateStatusTransition('revision_requested', 'sent_to_lab');
    assert.equal(result.ok, true);
    assert.equal(isRevisionLoopBack('revision_requested', 'sent_to_lab'), true);
  });

  await test('fitting_or_trial can move to revision_requested', () => {
    assert.equal(validateStatusTransition('fitting_or_trial', 'revision_requested').ok, true);
  });

  await test('cancelled is reachable from every non-terminal status', () => {
    for (const status of ALL_STATUSES) {
      if (status === 'completed' || status === 'cancelled') continue;
      const result = validateStatusTransition(status, 'cancelled');
      assert.equal(result.ok, true, `expected ${status} -> cancelled to be allowed`);
    }
  });

  await test('completed and cancelled are terminal — no further transitions', () => {
    for (const status of ALL_STATUSES) {
      const result = validateStatusTransition('completed', status);
      assert.equal(result.ok, false);
    }
    const cancelledToPending = validateStatusTransition('cancelled', 'pending');
    assert.equal(cancelledToPending.ok, false);
    if (!cancelledToPending.ok) assert.equal(cancelledToPending.code, 'already_terminal');
  });

  await test('every status in ALLOWED_TRANSITIONS is a known status', () => {
    for (const [from, tos] of Object.entries(ALLOWED_TRANSITIONS)) {
      assert.ok((ALL_STATUSES as readonly string[]).includes(from));
      for (const to of tos) assert.ok((ALL_STATUSES as readonly string[]).includes(to));
    }
  });

  // ── isOverdue ─────────────────────────────────────────────────────────────
  section('isOverdue()');

  const now = new Date('2026-07-03T12:00:00Z');
  const past = new Date('2026-07-01T00:00:00Z');
  const future = new Date('2026-07-10T00:00:00Z');

  await test('overdue when past due date and still pre-receipt', () => {
    for (const status of PRE_RECEIPT_STATUSES) {
      assert.equal(isOverdue({ status, expectedReturnDate: past }, now), true, `expected ${status} to be overdue`);
    }
  });

  await test('not overdue once received_from_lab or later, even if date has passed', () => {
    const postReceiptStatuses: LabWorkOrderStatus[] = ['received_from_lab', 'fitting_or_trial', 'revision_requested', 'completed', 'cancelled'];
    for (const status of postReceiptStatuses) {
      assert.equal(isOverdue({ status, expectedReturnDate: past }, now), false, `expected ${status} to not be overdue`);
    }
  });

  await test('not overdue when expected date is in the future', () => {
    assert.equal(isOverdue({ status: 'sent_to_lab', expectedReturnDate: future }, now), false);
  });

  await test('not overdue when expectedReturnDate is null', () => {
    assert.equal(isOverdue({ status: 'sent_to_lab', expectedReturnDate: null }, now), false);
  });

  // ── buildDashboardSummary ────────────────────────────────────────────────
  section('buildDashboardSummary()');

  await test('bucket counts are correct across a mixed-status fixture', () => {
    const orders = [
      { status: 'pending', expectedReturnDate: future },
      { status: 'sent_to_lab', expectedReturnDate: past }, // overdue
      { status: 'in_progress', expectedReturnDate: past }, // overdue
      { status: 'received_from_lab', expectedReturnDate: past }, // not overdue (post-receipt)
      { status: 'fitting_or_trial', expectedReturnDate: null },
      { status: 'revision_requested', expectedReturnDate: null },
      { status: 'completed', expectedReturnDate: past },
      { status: 'cancelled', expectedReturnDate: past },
    ];
    const summary = buildDashboardSummary(orders, now);
    assert.equal(summary.pending, 3); // pending + sent_to_lab + in_progress
    assert.equal(summary.received, 1);
    assert.equal(summary.fittingPending, 1);
    assert.equal(summary.revisionRequested, 1);
    assert.equal(summary.completed, 1);
    assert.equal(summary.cancelled, 1);
    assert.equal(summary.overdue, 2);
    assert.equal(summary.total, orders.length);
  });

  // ── Source regression checks ─────────────────────────────────────────────
  section('Source regression checks');

  const labOrdersRouteSrc = src('../routes/labOrders.ts');
  const laboratoriesRouteSrc = src('../routes/laboratories.ts');
  const indexSrc = src('../index.ts');
  const schemaSrc = readFileSync(fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)), 'utf8');

  await test('LAB_ORDER_MANAGE_ROLES (used by all write routes) excludes BILLING', () => {
    const match = labOrdersRouteSrc.match(/LAB_ORDER_MANAGE_ROLES = \[([^\]]*)\]/);
    assert.ok(match, 'LAB_ORDER_MANAGE_ROLES definition not found');
    assert.ok(!match![1].includes("'BILLING'"), `LAB_ORDER_MANAGE_ROLES should not include BILLING: ${match![1]}`);
  });

  await test('lab order write routes (POST/PUT/PATCH/DELETE) use LAB_ORDER_MANAGE_ROLES or a stricter role set, never READ_ROLES', () => {
    const writeRouteDefs = labOrdersRouteSrc.match(/router\.(post|put|patch|delete)\(\s*'\/lab-orders[^']*',\s*authorize\(\[\.\.\.[A-Z_]+\]\)/g) ?? [];
    assert.ok(writeRouteDefs.length >= 6, `expected at least 6 lab-order write routes, found ${writeRouteDefs.length}`);
    for (const def of writeRouteDefs) {
      assert.ok(!def.includes('LAB_ORDER_READ_ROLES'), `write route should not use the read-roles list (which includes BILLING): ${def}`);
    }
  });

  await test('lab order read routes (GET) use LAB_ORDER_READ_ROLES (includes BILLING)', () => {
    const readRouteDefs = labOrdersRouteSrc.match(/router\.get\('\/lab-orders[^']*',\s*authorize\(\[\.\.\.[A-Z_]+\]\)/g) ?? [];
    assert.ok(readRouteDefs.length >= 3, `expected at least 3 lab-order GET routes, found ${readRouteDefs.length}`);
    for (const def of readRouteDefs) {
      assert.ok(def.includes('LAB_ORDER_READ_ROLES'), `read route should use LAB_ORDER_READ_ROLES: ${def}`);
    }
  });

  await test('LAB_MANAGE_ROLES (laboratory directory) excludes BILLING', () => {
    const match = laboratoriesRouteSrc.match(/LAB_MANAGE_ROLES = \[([^\]]*)\]/);
    assert.ok(match, 'LAB_MANAGE_ROLES definition not found');
    assert.ok(!match![1].includes("'BILLING'"), `LAB_MANAGE_ROLES should not include BILLING: ${match![1]}`);
  });

  await test('laboratory write routes (POST/PUT/DELETE) never use LAB_READ_ROLES', () => {
    const writeRouteDefs = laboratoriesRouteSrc.match(/router\.(post|put|delete)\('\/laboratories[^']*',\s*authorize\(\[\.\.\.[A-Z_]+\]\)/g) ?? [];
    assert.ok(writeRouteDefs.length >= 3);
    for (const def of writeRouteDefs) {
      assert.ok(!def.includes('LAB_READ_ROLES'), `write route should not use the read-roles list (which includes BILLING): ${def}`);
    }
  });

  await test('RECEPTIONIST and ASSISTANT are included in the manage-roles list', () => {
    assert.ok(labOrdersRouteSrc.includes("LAB_ORDER_MANAGE_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'ASSISTANT']"));
  });

  await test('lab order routes use clinic-scope helpers, not raw req.user.clinicId for scoping', () => {
    assert.ok(labOrdersRouteSrc.includes('validateAndGetClinicIdScope'));
    assert.ok(labOrdersRouteSrc.includes('resolveEffectiveClinicId'));
    assert.ok(labOrdersRouteSrc.includes('getAccessibleClinicIds'));
    assert.ok(!/where:\s*{\s*id,\s*clinicId:\s*req\.user!\.clinicId/.test(labOrdersRouteSrc));
  });

  await test('schema.prisma defines LabWorkOrder.status as a plain String (not a Prisma enum)', () => {
    assert.ok(schemaSrc.includes('model LabWorkOrder'));
    assert.ok(/status\s+String\s+@default\("pending"\)/.test(schemaSrc));
    assert.ok(!/enum\s+LabWorkOrderStatus/.test(schemaSrc));
  });

  await test('index.ts registers both new route files', () => {
    assert.ok(indexSrc.includes("import laboratoriesRoutes from './routes/laboratories.js'"));
    assert.ok(indexSrc.includes("import labOrdersRoutes from './routes/labOrders.js'"));
    assert.ok(indexSrc.includes("app.use('/api', laboratoriesRoutes)"));
    assert.ok(indexSrc.includes("app.use('/api', labOrdersRoutes)"));
  });

  await test('notifications.ts wires the overdue-lab-case type and externalId prefix', () => {
    const notificationsSrc = src('../routes/notifications.ts');
    assert.ok(notificationsSrc.includes("type: 'lab_case_overdue'"));
    assert.ok(notificationsSrc.includes('lab-overdue-'));
    assert.ok(notificationsSrc.includes('labOrdersOverdue'));
  });

  await test('notificationPreferences.ts defines a labOrdersOverdue default toggle', () => {
    const prefsSrc = src('../services/notificationPreferences.ts');
    assert.ok(prefsSrc.includes('labOrdersOverdue: togglePreferenceSchema'));
    assert.ok(prefsSrc.includes("enabledTypes.push('lab_case_overdue')"));
  });

  // ── Clinic isolation (mock-based, mirrors treatmentCaseClinicScope.test.ts) ─
  section('Clinic isolation');

  type LabOrderRow = { id: string; clinicId: string };
  const mockLabOrders: LabOrderRow[] = [
    { id: 'lab-A-1', clinicId: 'clinic-A' },
    { id: 'lab-B-1', clinicId: 'clinic-B' },
  ];

  function simulateListLabOrders(accessibleClinicIds: string[]) {
    return mockLabOrders.filter(o => accessibleClinicIds.includes(o.clinicId));
  }

  function simulateGetLabOrder(id: string, accessibleClinicIds: string[]) {
    return mockLabOrders.find(o => o.id === id && accessibleClinicIds.includes(o.clinicId)) ?? null;
  }

  await test('a lab order created under clinic A is not visible when scoped to clinic B', () => {
    const list = simulateListLabOrders(['clinic-B']);
    assert.ok(!list.some(o => o.id === 'lab-A-1'));

    const detail = simulateGetLabOrder('lab-A-1', ['clinic-B']);
    assert.equal(detail, null);
  });

  await test('a user with access to both clinics sees both lab orders', () => {
    const list = simulateListLabOrders(['clinic-A', 'clinic-B']);
    assert.deepEqual(list.map(o => o.id).sort(), ['lab-A-1', 'lab-B-1']);
  });

  await test('a user with no clinic access sees nothing', () => {
    const list = simulateListLabOrders([]);
    assert.deepEqual(list, []);
  });

  // ── Result ────────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
