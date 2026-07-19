/**
 * backfillCommunicationPreferences.ts — KVKK-HIGH-007 legacy-data backfill.
 *
 * Materializes the ONE safe signal already present in the legacy schema —
 * Patient.smsOptOut — into PatientCommunicationPreference rows. Nothing else
 * is inferred: Patient.communicationConsent / Patient.marketingConsent are
 * deliberately NOT used to auto-grant anything here, because the task
 * requires that unknown legacy consent never silently becomes "granted".
 * An explicit opt-out is the one direction that is always safe to encode
 * automatically (denying access is never a privacy risk; granting it can be).
 *
 * For every patient with smsOptOut = true, this writes a 'withdrawn'
 * PatientCommunicationPreference row (source='legacy',
 * evidenceType='legacy_sms_opt_out_field') for channel='sms' across every
 * non-policy-exception purpose (transactional/legal_notice/security_notice
 * are policy exceptions and never get preference rows — see taxonomy.ts).
 *
 * Everything else (marketing, campaign, recall, clinical_followup, ... for
 * patients without smsOptOut, and all email/whatsapp/phone_call/push
 * channels) is intentionally left with NO row, which the central decision
 * service treats as status = unknown → denied for consent-gated purposes.
 *
 * Properties:
 *  - dry-run by default; pass --execute to write.
 *  - idempotent: skips any patient+clinic+channel+purpose that already has a
 *    preference row (never overwrites existing state, legacy or otherwise).
 *  - bounded batches (BATCH_SIZE patients per page).
 *  - reports counts by clinic/channel/purpose/status only — no raw PII.
 *  - rollback: `DELETE FROM "PatientCommunicationPreference" WHERE source =
 *    'legacy' AND "evidenceType" = 'legacy_sms_opt_out_field'` removes only
 *    rows this script created (their PatientCommunicationConsentEvent rows
 *    are immutable history and are intentionally left in place).
 *
 * Usage:
 *   cd server && npx tsx src/scripts/backfillCommunicationPreferences.ts            (dry-run)
 *   cd server && npx tsx src/scripts/backfillCommunicationPreferences.ts --execute   (writes)
 *
 * A separate, always-read-only reconciliation report can be produced in the
 * same run (never gated by --execute — it never writes regardless of flags):
 *   cd server && npx tsx src/scripts/backfillCommunicationPreferences.ts --report=./communication-consent-reconciliation-report.json
 * or print to stdout only:
 *   cd server && npx tsx src/scripts/backfillCommunicationPreferences.ts --report
 *
 * The report scans ALL patients (not just smsOptOut=true) and classifies
 * legacy-vs-central signals into conflict categories — see
 * buildReconciliationReport() below and
 * docs/compliance/56-kvkk-communication-preference-and-consent-management.md.
 *
 * NOT executed in production as part of this PR — see rollout plan in
 * docs/compliance/56-kvkk-communication-preference-and-consent-management.md.
 */

import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { COMMUNICATION_PURPOSES, POLICY_EXCEPTION_PURPOSES } from '../services/communicationConsent/taxonomy.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const BATCH_SIZE = 500;
const BACKFILL_SOURCE = 'legacy';
const BACKFILL_EVIDENCE_TYPE = 'legacy_sms_opt_out_field';
const BACKFILL_CHANNEL = 'sms';
const TARGET_PURPOSES = COMMUNICATION_PURPOSES.filter(
  (p) => !(POLICY_EXCEPTION_PURPOSES as readonly string[]).includes(p),
);

type Counts = Record<string, Record<string, Record<string, Record<string, number>>>>;
// Counts[clinicId][channel][purpose][status] = count

function bump(counts: Counts, clinicId: string, channel: string, purpose: string, status: string): void {
  counts[clinicId] ??= {};
  counts[clinicId][channel] ??= {};
  counts[clinicId][channel][purpose] ??= {};
  counts[clinicId][channel][purpose][status] = (counts[clinicId][channel][purpose][status] ?? 0) + 1;
}

type ConflictCategory =
  | 'legacy_opt_out_vs_central_granted'
  | 'legacy_false_or_default_vs_central_unknown'
  | 'legacy_yes_without_evidence'
  | 'already_reconciled';

type ConflictCategoryCounts = Record<ConflictCategory, number>;

function emptyConflictCounts(): ConflictCategoryCounts {
  return {
    legacy_opt_out_vs_central_granted: 0,
    legacy_false_or_default_vs_central_unknown: 0,
    legacy_yes_without_evidence: 0,
    already_reconciled: 0,
  };
}

export type ReconciliationReport = {
  generatedAt: string;
  patientsInspected: number;
  invalidOrUnscopedRecords: number;
  conflictCategories: ConflictCategoryCounts;
  byClinic: Record<string, ConflictCategoryCounts>;
  channelConsentLogSummary: Array<{ clinicId: string; channel: string; consentStatus: string; count: number }>;
  notes: string[];
};

/**
 * Read-only reconciliation analysis across ALL patients (not just
 * smsOptOut=true — contrast with the narrow, already-tested backfill loop
 * above). Never writes to the database regardless of --execute/--report.
 *
 * Category definitions (see docs/compliance/56-... for the full rationale):
 *  - legacy_opt_out_vs_central_granted: smsOptOut=true but a central `sms`
 *    row for this patient is `granted` — a genuine conflict for human review,
 *    corresponding to the runtime resolver's `legacy_central_conflict`
 *    (legacyReconciliationResolver.ts). Never auto-resolved here.
 *  - legacy_false_or_default_vs_central_unknown: communicationConsent AND
 *    marketingConsent are both false, and no central preference row exists at
 *    all. Reported as ambiguous/non-affirmative — NEVER as an explicit denial
 *    or as agreement: the legacy booleans default to false and carry no
 *    "was this explicitly captured" flag, so false cannot be presented as a
 *    real denial without an evidenced trail proving it.
 *  - legacy_yes_without_evidence: communicationConsent or marketingConsent is
 *    true, but no central `granted` row exists for this patient at all —
 *    legacy "yes" carries no evidence trail and must never be trusted to
 *    auto-grant.
 *  - already_reconciled: smsOptOut=true and the standard backfill's own
 *    `withdrawn`/legacy/legacy_sms_opt_out_field row already exists for the
 *    sms channel — no further action needed.
 *
 * channelConsentLogSummary reports real aggregate counts (groupBy, no PII)
 * from ChannelConsentLog — a distinct, already-active WhatsApp/Instagram
 * inbound-reply consent gate, NOT the Meta 24-hour delivery window (which has
 * no backing data model anywhere in the codebase). It is keyed by raw
 * contactIdentifier, not patientId, so it is intentionally NOT joined against
 * Patient/PatientCommunicationPreference here — that join would require an
 * unreliable phone-normalization match, exactly the kind of silent/incorrect
 * linkage this task's principles rule out.
 */
async function buildReconciliationReport(): Promise<ReconciliationReport> {
  const conflictCategories = emptyConflictCounts();
  const byClinic: Record<string, ConflictCategoryCounts> = {};
  let patientsInspected = 0;
  let invalidOrUnscopedRecords = 0;
  let cursor: string | undefined;

  const bump = (clinicId: string, category: ConflictCategory) => {
    conflictCategories[category] += 1;
    byClinic[clinicId] ??= emptyConflictCounts();
    byClinic[clinicId][category] += 1;
  };

  for (;;) {
    const patients = await prisma.patient.findMany({
      where: { deletedAt: null },
      select: {
        id: true, clinicId: true, organizationId: true,
        smsOptOut: true, communicationConsent: true, marketingConsent: true,
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (patients.length === 0) break;

    const batchIds = patients.map((p) => p.id);
    const prefRows = await prisma.patientCommunicationPreference.findMany({
      where: { patientId: { in: batchIds } },
      select: { patientId: true, channel: true, status: true, source: true, evidenceType: true },
    });
    const byPatient = new Map<string, typeof prefRows>();
    for (const row of prefRows) {
      const list = byPatient.get(row.patientId);
      if (list) list.push(row);
      else byPatient.set(row.patientId, [row]);
    }

    for (const patient of patients) {
      patientsInspected += 1;
      if (!patient.clinicId || !patient.organizationId) {
        invalidOrUnscopedRecords += 1;
        continue;
      }

      const rows = byPatient.get(patient.id) ?? [];
      const hasAnyRow = rows.length > 0;
      const hasAnyGrantedRow = rows.some((r) => r.status === 'granted');
      const hasSmsGrantedRow = rows.some((r) => r.channel === BACKFILL_CHANNEL && r.status === 'granted');
      const hasAlreadyReconciledSmsWithdrawn = rows.some(
        (r) => r.channel === BACKFILL_CHANNEL && r.status === 'withdrawn'
          && r.source === BACKFILL_SOURCE && r.evidenceType === BACKFILL_EVIDENCE_TYPE,
      );

      if (patient.smsOptOut) {
        if (hasSmsGrantedRow) {
          bump(patient.clinicId, 'legacy_opt_out_vs_central_granted');
        } else if (hasAlreadyReconciledSmsWithdrawn) {
          bump(patient.clinicId, 'already_reconciled');
        }
      }

      if (patient.communicationConsent || patient.marketingConsent) {
        if (!hasAnyGrantedRow) {
          bump(patient.clinicId, 'legacy_yes_without_evidence');
        }
      } else if (!hasAnyRow) {
        bump(patient.clinicId, 'legacy_false_or_default_vs_central_unknown');
      }
    }

    cursor = patients[patients.length - 1]!.id;
    if (patients.length < BATCH_SIZE) break;
  }

  const channelConsentLogGroups = await prisma.channelConsentLog.groupBy({
    by: ['clinicId', 'channel', 'consentStatus'],
    _count: { _all: true },
  });

  return {
    generatedAt: new Date().toISOString(),
    patientsInspected,
    invalidOrUnscopedRecords,
    conflictCategories,
    byClinic,
    channelConsentLogSummary: channelConsentLogGroups.map((g) => ({
      clinicId: g.clinicId,
      channel: g.channel,
      consentStatus: g.consentStatus,
      count: g._count._all,
    })),
    notes: [
      'legacy_false_or_default_vs_central_unknown is ambiguous/non-affirmative — never an explicit denial or agreement.',
      'legacy_yes_without_evidence is flagged, never auto-granted.',
      'legacy_opt_out_vs_central_granted is a genuine conflict requiring human review — never auto-resolved by this report or by the runtime resolver (see legacy_central_conflict in legacyReconciliationResolver.ts).',
      'channelConsentLogSummary is a distinct, already-active WhatsApp/Instagram inbound-reply consent gate, not the Meta 24-hour delivery window (no backing data model exists for that anywhere in the codebase) — intentionally not joined against patient records here.',
      'No patient identifiers (id, name, phone, email) appear anywhere in this report — counts only.',
    ],
  };
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const reportArg = process.argv.find((a) => a === '--report' || a.startsWith('--report='));
  console.log(`=== Communication Preference Legacy Backfill (${execute ? 'EXECUTE' : 'DRY-RUN'}) ===`);
  console.log(`Target: channel=${BACKFILL_CHANNEL}, purposes=[${TARGET_PURPOSES.join(', ')}]`);

  const created: Counts = {};
  const skippedExisting: Counts = {};
  let patientsScanned = 0;
  let patientsWithOptOut = 0;
  let cursor: string | undefined;

  for (;;) {
    const patients = await prisma.patient.findMany({
      where: { smsOptOut: true, deletedAt: null },
      select: { id: true, clinicId: true, organizationId: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (patients.length === 0) break;

    for (const patient of patients) {
      patientsScanned++;
      patientsWithOptOut++;

      for (const purpose of TARGET_PURPOSES) {
        const existing = await prisma.patientCommunicationPreference.findUnique({
          where: {
            patientId_clinicId_channel_purpose: {
              patientId: patient.id,
              clinicId: patient.clinicId,
              channel: BACKFILL_CHANNEL,
              purpose,
            },
          },
          select: { id: true, status: true },
        });

        if (existing) {
          bump(skippedExisting, patient.clinicId, BACKFILL_CHANNEL, purpose, existing.status);
          continue;
        }

        bump(created, patient.clinicId, BACKFILL_CHANNEL, purpose, 'withdrawn');

        if (!execute) continue;

        await prisma.$transaction(async (tx) => {
          // Always a fresh row (the `existing` check above guarantees no
          // prior row for this key), so revision is always 1 — no advisory
          // lock needed here (this is a one-off batch migration, not a
          // concurrent request path).
          const preference = await tx.patientCommunicationPreference.create({
            data: {
              organizationId: patient.organizationId,
              clinicId: patient.clinicId,
              patientId: patient.id,
              channel: BACKFILL_CHANNEL,
              purpose,
              status: 'withdrawn',
              effectiveAt: new Date(),
              withdrawnAt: new Date(),
              revision: 1,
              source: BACKFILL_SOURCE,
              evidenceType: BACKFILL_EVIDENCE_TYPE,
              notes: 'Backfilled from legacy Patient.smsOptOut field.',
            },
          });
          await tx.patientCommunicationConsentEvent.create({
            data: {
              organizationId: patient.organizationId,
              clinicId: patient.clinicId,
              patientId: patient.id,
              preferenceId: preference.id,
              channel: BACKFILL_CHANNEL,
              purpose,
              previousStatus: null,
              newStatus: 'withdrawn',
              revision: 1,
              source: BACKFILL_SOURCE,
              evidenceType: BACKFILL_EVIDENCE_TYPE,
              notes: 'Backfilled from legacy Patient.smsOptOut field.',
            },
          });
        });
      }
    }

    cursor = patients[patients.length - 1].id;
    if (patients.length < BATCH_SIZE) break;
  }

  console.log(`\nPatients scanned (smsOptOut=true): ${patientsScanned}`);
  console.log(`Patients with opt-out signal:       ${patientsWithOptOut}`);

  console.log('\n--- Rows to create (by clinic/channel/purpose/status) ---');
  for (const [clinicId, byChannel] of Object.entries(created)) {
    for (const [channel, byPurpose] of Object.entries(byChannel)) {
      for (const [purpose, byStatus] of Object.entries(byPurpose)) {
        for (const [status, count] of Object.entries(byStatus)) {
          console.log(`  clinic=${clinicId} channel=${channel} purpose=${purpose} status=${status} count=${count}`);
        }
      }
    }
  }

  console.log('\n--- Skipped (preference already exists — never overwritten) ---');
  for (const [clinicId, byChannel] of Object.entries(skippedExisting)) {
    for (const [channel, byPurpose] of Object.entries(byChannel)) {
      for (const [purpose, byStatus] of Object.entries(byPurpose)) {
        for (const [status, count] of Object.entries(byStatus)) {
          console.log(`  clinic=${clinicId} channel=${channel} purpose=${purpose} existingStatus=${status} count=${count}`);
        }
      }
    }
  }

  if (!execute) {
    console.log('\nDry-run complete. Re-run with --execute to write these rows.');
  } else {
    console.log('\nBackfill complete.');
  }

  if (reportArg) {
    console.log('\n=== Legacy/Central Reconciliation Report (read-only — never writes) ===');
    const report = await buildReconciliationReport();
    console.log(JSON.stringify(report, null, 2));

    const eqIndex = reportArg.indexOf('=');
    const reportPath = eqIndex >= 0 ? reportArg.slice(eqIndex + 1) : undefined;
    if (reportPath) {
      writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
      console.log(`\nReport written to ${reportPath}`);
    }
  }
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
