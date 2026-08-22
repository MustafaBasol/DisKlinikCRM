/**
 * platformWhatsAppConnectionService.ts — F3-WA-META-COEX-002B
 *
 * CRUD + provider operations for the platform's own (NoraMedi-owned) Meta
 * Cloud API WhatsApp connection, stored in the dedicated
 * PlatformWhatsAppConnection table (see schema.prisma doc-comment for why a
 * dedicated table rather than reusing WhatsAppConnection).
 *
 * Reuses, rather than duplicates, the exact same provider-dispatch and
 * validation logic the tenant route (organizationWhatsApp.ts) uses:
 *   - runConnectionTest / testResultToPersistData / runProviderDisconnect
 *     (whatsappService.ts) — the same functions the tenant path calls
 *   - isMetaManualConfigComplete / META_MANUAL_SETUP_ERROR (whatsappService.ts)
 *   - encryptSecret / encryptSecretTagged (utils/encryption.ts)
 *   - MetaCloudWhatsAppProvider via getWhatsAppProvider('meta_cloud_api')
 *     (whatsappProviderFactory.ts) — reached through runConnectionTest/
 *     runProviderDisconnect exactly like the tenant path
 *
 * Never returns a decrypted secret. Route layer is responsible for stripping
 * encrypted fields from responses (sanitizePlatformConnection in
 * routes/platformWhatsApp.ts), mirroring organizationWhatsApp.ts's own
 * sanitizeConnection().
 */

import type { PlatformWhatsAppConnection, Prisma, PrismaClient } from '@prisma/client';
import prisma from '../db.js';
import { encryptSecret, encryptSecretTagged } from '../utils/encryption.js';
import {
  isMetaManualConfigComplete,
  META_MANUAL_SETUP_ERROR,
  runConnectionTest,
  runProviderDisconnect,
  testResultToPersistData,
} from './whatsapp/whatsappService.js';
import type { TestConnectionResult, WhatsAppConnectionRecord } from './whatsapp/WhatsAppProvider.js';

export class PlatformWhatsAppConnectionNotFoundError extends Error {
  constructor() {
    super('Platform WhatsApp connection not found');
    this.name = 'PlatformWhatsAppConnectionNotFoundError';
  }
}

export class PlatformWhatsAppConnectionAlreadyExistsError extends Error {
  constructor() {
    super(
      'A platform WhatsApp connection already exists. Update or delete it before creating a new one.',
    );
    this.name = 'PlatformWhatsAppConnectionAlreadyExistsError';
  }
}

export class PlatformWhatsAppMetaConfigIncompleteError extends Error {
  constructor() {
    super(META_MANUAL_SETUP_ERROR);
    this.name = 'PlatformWhatsAppMetaConfigIncompleteError';
  }
}

export interface PlatformWhatsAppConnectionInput {
  name: string;
  phoneNumber?: string | null;
  displayName?: string | null;
  metaBusinessId?: string | null;
  metaWabaId?: string | null;
  metaPhoneNumberId?: string | null;
  metaAppId?: string | null;
  /** Plaintext — encrypted before persistence. Omit/undefined on update to leave unchanged. */
  metaAccessTokenEncrypted?: string | null;
  metaWebhookVerifyToken?: string | null;
  /** Plaintext — encrypted (tagged) before persistence. Omit/undefined on update to leave unchanged. */
  metaWebhookSecret?: string | null;
  /** Plaintext — encrypted (tagged) before persistence. Omit/undefined on update to leave unchanged. */
  webhookSecret?: string | null;
}

/** Converts a PlatformWhatsAppConnection row into the shared provider contract. organizationId is the fixed empty-string sentinel already used by the legacy env-var fallback record (whatsappService.ts buildLegacyConnectionRecord) — providers never read it. */
function toConnectionRecord(row: PlatformWhatsAppConnection): WhatsAppConnectionRecord {
  return {
    id: row.id,
    organizationId: '',
    provider: row.provider,
    status: row.status,
    phoneNumber: row.phoneNumber,
    metaBusinessId: row.metaBusinessId,
    metaWabaId: row.metaWabaId,
    metaPhoneNumberId: row.metaPhoneNumberId,
    metaAppId: row.metaAppId,
    metaAccessTokenEncrypted: row.metaAccessTokenEncrypted,
    metaWebhookVerifyToken: row.metaWebhookVerifyToken,
    metaWebhookSecret: row.metaWebhookSecret,
    webhookSecret: row.webhookSecret,
    metaTokenStatus: row.metaTokenStatus,
    metaTokenExpiresAt: row.metaTokenExpiresAt,
    metaTokenLastCheckedAt: row.metaTokenLastCheckedAt,
  };
}

type DbClient = Pick<PrismaClient, 'platformWhatsAppConnection'> | Prisma.TransactionClient;

/** The single platform Meta connection, or null if none has been created yet. */
export async function getPlatformWhatsAppConnection(
  client: DbClient = prisma,
): Promise<PlatformWhatsAppConnection | null> {
  return client.platformWhatsAppConnection.findFirst();
}

function encryptedFields(input: Partial<PlatformWhatsAppConnectionInput>) {
  const data: Record<string, unknown> = {};
  if (typeof input.metaAccessTokenEncrypted === 'string' && input.metaAccessTokenEncrypted) {
    data.metaAccessTokenEncrypted = encryptSecret(input.metaAccessTokenEncrypted);
  }
  if (typeof input.metaWebhookSecret === 'string' && input.metaWebhookSecret) {
    data.metaWebhookSecret = encryptSecretTagged(input.metaWebhookSecret);
  }
  if (typeof input.webhookSecret === 'string' && input.webhookSecret) {
    data.webhookSecret = encryptSecretTagged(input.webhookSecret);
  }
  return data;
}

export async function createPlatformWhatsAppConnection(
  input: PlatformWhatsAppConnectionInput,
  client: DbClient = prisma,
): Promise<PlatformWhatsAppConnection> {
  if (
    !isMetaManualConfigComplete(
      input.metaPhoneNumberId,
      Boolean(input.metaAccessTokenEncrypted?.trim()),
    )
  ) {
    throw new PlatformWhatsAppMetaConfigIncompleteError();
  }

  const existing = await client.platformWhatsAppConnection.findFirst({ select: { id: true } });
  if (existing) throw new PlatformWhatsAppConnectionAlreadyExistsError();

  try {
    return await client.platformWhatsAppConnection.create({
      data: {
        name: input.name,
        phoneNumber: input.phoneNumber ?? null,
        displayName: input.displayName ?? null,
        metaBusinessId: input.metaBusinessId ?? null,
        metaWabaId: input.metaWabaId ?? null,
        metaPhoneNumberId: input.metaPhoneNumberId ?? null,
        metaAppId: input.metaAppId ?? null,
        metaWebhookVerifyToken: input.metaWebhookVerifyToken ?? null,
        ...encryptedFields(input),
      },
    });
  } catch (err: unknown) {
    // Concurrent create race — the `singleton` unique column is the real
    // (DB-level) guarantee; the findFirst check above is just the fast path.
    if ((err as { code?: string })?.code === 'P2002') {
      throw new PlatformWhatsAppConnectionAlreadyExistsError();
    }
    throw err;
  }
}

export async function updatePlatformWhatsAppConnection(
  id: string,
  input: Partial<PlatformWhatsAppConnectionInput>,
  client: DbClient = prisma,
): Promise<PlatformWhatsAppConnection> {
  const existing = await client.platformWhatsAppConnection.findUnique({ where: { id } });
  if (!existing) throw new PlatformWhatsAppConnectionNotFoundError();

  const effectivePhoneId =
    input.metaPhoneNumberId !== undefined ? input.metaPhoneNumberId : existing.metaPhoneNumberId;
  const effectiveTokenPresent = input.metaAccessTokenEncrypted
    ? Boolean(input.metaAccessTokenEncrypted.trim())
    : Boolean(existing.metaAccessTokenEncrypted);
  if (!isMetaManualConfigComplete(effectivePhoneId, effectiveTokenPresent)) {
    throw new PlatformWhatsAppMetaConfigIncompleteError();
  }

  const data: Record<string, unknown> = { ...encryptedFields(input) };
  for (const key of [
    'name',
    'phoneNumber',
    'displayName',
    'metaBusinessId',
    'metaWabaId',
    'metaPhoneNumberId',
    'metaAppId',
    'metaWebhookVerifyToken',
  ] as const) {
    if (input[key] !== undefined) data[key] = input[key];
  }

  return client.platformWhatsAppConnection.update({ where: { id }, data });
}

export async function deletePlatformWhatsAppConnection(
  id: string,
  client: DbClient = prisma,
): Promise<void> {
  const existing = await client.platformWhatsAppConnection.findUnique({ where: { id } });
  if (!existing) throw new PlatformWhatsAppConnectionNotFoundError();
  await client.platformWhatsAppConnection.delete({ where: { id } });
}

/** Reuses whatsappService.ts's runConnectionTest — the SAME provider-dispatch code the tenant path (testWhatsAppConnection) calls. */
export async function testPlatformWhatsAppConnection(
  id: string,
  client: DbClient = prisma,
): Promise<TestConnectionResult> {
  const record = await client.platformWhatsAppConnection.findUnique({ where: { id } });
  if (!record) throw new PlatformWhatsAppConnectionNotFoundError();

  const result = await runConnectionTest(toConnectionRecord(record));
  await client.platformWhatsAppConnection.update({
    where: { id },
    data: testResultToPersistData(result),
  });
  return result;
}

/** Reuses whatsappService.ts's runProviderDisconnect — the SAME provider-dispatch code the tenant path (disconnectWhatsAppConnection) calls. */
export async function disconnectPlatformWhatsAppConnection(
  id: string,
  client: DbClient = prisma,
): Promise<void> {
  const record = await client.platformWhatsAppConnection.findUnique({ where: { id } });
  if (!record) throw new PlatformWhatsAppConnectionNotFoundError();

  await runProviderDisconnect(toConnectionRecord(record));
  await client.platformWhatsAppConnection.update({
    where: { id },
    data: { status: 'disconnected', isActive: false },
  });
}
