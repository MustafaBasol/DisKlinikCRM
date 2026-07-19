/**
 * communicationConsentConflictTracker.ts — KVKK-HIGH-007 legacy/central
 * consent conflict aggregation.
 *
 * Database-backed and atomic, deliberately NOT process-local: NoraMedi runs
 * multiple API instances/workers with PM2 reloads and horizontal scaling, so
 * an in-memory Map/TTL cache would deduplicate differently per process, lose
 * counts on restart, and produce duplicate first-detection rows across
 * instances. Every detection is a single atomic Postgres upsert on
 * CommunicationConsentConflictBucket — safe under concurrency regardless of
 * how many processes are running.
 *
 * Deliberately excludes any patient-level identifier. This table answers
 * "how many conflicts occurred", never "which patients".
 */

import prisma from '../../db.js';

const HOUR_MS = 60 * 60 * 1000;

function hourBucketStart(date: Date): Date {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

export type ConflictDetectionInput = {
  organizationId: string;
  clinicId: string;
  channel: string;
  purpose: string;
  reasonCode: string;
};

/**
 * Records one legacy/central conflict detection. First detection in the
 * current hourly bucket creates the row with occurrenceCount=1; subsequent
 * detections in the same bucket increment it atomically. Swallows errors —
 * a tracking failure must never break the actual consent decision.
 */
export async function recordCommunicationConsentConflict(
  input: ConflictDetectionInput,
  now: Date = new Date(),
): Promise<void> {
  const bucketStartedAt = hourBucketStart(now);
  try {
    await prisma.communicationConsentConflictBucket.upsert({
      where: {
        organizationId_clinicId_channel_purpose_reasonCode_bucketStartedAt: {
          organizationId: input.organizationId,
          clinicId: input.clinicId,
          channel: input.channel,
          purpose: input.purpose,
          reasonCode: input.reasonCode,
          bucketStartedAt,
        },
      },
      create: {
        organizationId: input.organizationId,
        clinicId: input.clinicId,
        channel: input.channel,
        purpose: input.purpose,
        reasonCode: input.reasonCode,
        bucketStartedAt,
        firstDetectedAt: now,
        lastDetectedAt: now,
        occurrenceCount: 1,
      },
      update: {
        occurrenceCount: { increment: 1 },
        lastDetectedAt: now,
      },
    });
  } catch (err) {
    console.error('[communicationConsentConflictTracker] Failed to record conflict:', err);
  }
}
