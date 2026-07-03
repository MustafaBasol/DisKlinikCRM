/**
 * conversationMessageStore.ts — Single write-path for WhatsAppConversationMessage.
 *
 * Every inbound and outbound WhatsApp message (Evolution and Meta Cloud) must be
 * persisted here so the patient detail "Messages" tab and the inbox history stay
 * complete. patientId is nullable: when the sender cannot be uniquely resolved
 * (unknown number, shared family phone), the row is stored unlinked and later
 * backfilled when staff links the conversation to a patient.
 *
 * Dedupe: relies on the @@unique([clinicId, providerMessageId]) constraint —
 * a repeated providerMessageId is silently skipped, never an error.
 */

import { Prisma } from '@prisma/client';

import prisma from '../../db.js';

const normalizePhoneDigits = (value: string) => value.replace(/@.+$/, '').replace(/\D/g, '');

export type PersistConversationMessageArgs = {
  clinicId: string;
  /** null when no unique patient could be resolved for the phone */
  patientId: string | null;
  phone: string;
  direction: 'incoming' | 'outgoing';
  text: string;
  providerMessageId?: string | null;
  rawPayload?: Record<string, unknown> | null;
};

export type PersistConversationMessageResult =
  | { created: true; id: string }
  | { created: false; reason: 'duplicate' };

/** Minimal structural view of the prisma client used here — injectable for unit tests. */
export type ConversationMessageDb = {
  whatsAppConversationMessage: {
    create(args: {
      data: {
        clinicId: string;
        patientId: string | null;
        phone: string;
        providerMessageId: string | null;
        direction: string;
        text: string;
        rawPayload?: unknown;
      };
    }): Promise<{ id: string }>;
    updateMany(args: {
      where: { clinicId: string; phone: string; patientId: null };
      data: { patientId: string };
    }): Promise<{ count: number }>;
  };
};

export const isUniqueConstraintError = (error: unknown): boolean =>
  Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002',
  );

export const persistWhatsAppConversationMessage = async (
  args: PersistConversationMessageArgs,
  db: ConversationMessageDb = prisma as unknown as ConversationMessageDb,
): Promise<PersistConversationMessageResult> => {
  try {
    const row = await db.whatsAppConversationMessage.create({
      data: {
        clinicId: args.clinicId,
        patientId: args.patientId,
        phone: normalizePhoneDigits(args.phone),
        providerMessageId: args.providerMessageId?.trim() ? args.providerMessageId : null,
        direction: args.direction,
        text: args.text,
        rawPayload: args.rawPayload ? (args.rawPayload as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
    return { created: true, id: row.id };
  } catch (error) {
    if (args.providerMessageId && isUniqueConstraintError(error)) {
      return { created: false, reason: 'duplicate' };
    }
    throw error;
  }
};

/**
 * Link previously-unlinked conversation messages (patientId = null) for a
 * clinic + phone to a patient. Called when a patient is created from the
 * conversation, or when staff resolves/links an inbox entry to a patient.
 * Never overwrites rows already linked to a (possibly different) patient —
 * shared-phone safety.
 */
export const backfillConversationMessagePatient = async (
  args: { clinicId: string; phone: string; patientId: string },
  db: ConversationMessageDb = prisma as unknown as ConversationMessageDb,
): Promise<number> => {
  const { count } = await db.whatsAppConversationMessage.updateMany({
    where: { clinicId: args.clinicId, phone: normalizePhoneDigits(args.phone), patientId: null },
    data: { patientId: args.patientId },
  });
  return count;
};
