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
 * NOT executed in production as part of this PR — see rollout plan in
 * docs/compliance/56-kvkk-communication-preference-and-consent-management.md.
 */

import 'dotenv/config';
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

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
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
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
