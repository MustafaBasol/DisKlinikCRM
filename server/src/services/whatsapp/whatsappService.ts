/**
 * whatsappService.ts — Unified messaging service
 *
 * All application code (routes, jobs, reminders) calls this service.
 * Provider resolution happens here — callers never reference a specific provider.
 *
 * Resolution order for a given clinicId:
 *   1. Look up ClinicWhatsAppConnection WHERE clinicId = ? AND isDefault = true
 *   2. From there follow to WhatsAppConnection.provider
 *   3. Use getWhatsAppProvider(provider) to get the right implementation
 *
 * If no DB connection record exists, fall back to env-var Evolution API config
 * (backwards compatibility with pre-Sprint-10 single-clinic deployments).
 */

import prisma from '../../db.js';
import { getWhatsAppProvider } from './whatsappProviderFactory.js';
import type {
  SendMessagePayload,
  SendMessageResult,
  TestConnectionResult,
  QrCodeResult,
  WhatsAppConnectionRecord,
} from './WhatsAppProvider.js';

// Fallback legacy connection record built from env vars (no DB record needed).
function buildLegacyConnectionRecord(): WhatsAppConnectionRecord {
  return {
    id: 'legacy',
    organizationId: '',
    provider: 'evolution_api',
    status: 'connected',
    evolutionApiUrl: process.env.EVOLUTION_API_BASE_URL ?? null,
    evolutionInstanceName: process.env.EVOLUTION_INSTANCE_NAME ?? null,
    // apiKey is not stored encrypted in legacy mode — stored raw in env var
    evolutionApiKeyEncrypted: process.env.EVOLUTION_API_KEY ?? null,
  };
}

/**
 * Resolve the WhatsApp connection record for a clinic.
 * Returns the DB record if found; falls back to legacy env-var config.
 */
export async function resolveConnectionForClinic(
  clinicId: string,
): Promise<WhatsAppConnectionRecord | null> {
  const mapping = await prisma.clinicWhatsAppConnection.findFirst({
    where: { clinicId, isDefault: true },
    include: { whatsappConnection: true },
  });

  if (mapping) {
    return mapping.whatsappConnection as WhatsAppConnectionRecord;
  }

  // Fallback: legacy single-clinic env-var config
  const hasLegacyConfig =
    process.env.EVOLUTION_API_BASE_URL && process.env.EVOLUTION_API_KEY;

  return hasLegacyConfig ? buildLegacyConnectionRecord() : null;
}

/**
 * Send a text message for a given clinic.
 *
 * @param clinicId     - The clinic to resolve a WhatsApp connection for
 * @param phone        - Recipient phone (digits only or E.164)
 * @param text         - Message body
 * @param connectionId - Optional: use a specific WhatsApp connection instead of resolving from clinic
 */
export async function sendWhatsAppMessage(
  clinicId: string,
  payload: SendMessagePayload,
  connectionId?: string,
): Promise<SendMessageResult> {
  let connection: WhatsAppConnectionRecord | null = null;

  if (connectionId) {
    connection = (await prisma.whatsAppConnection.findFirst({
      where: { id: connectionId, isActive: true },
    })) as WhatsAppConnectionRecord | null;
  } else {
    connection = await resolveConnectionForClinic(clinicId);
  }

  if (!connection) {
    return {
      success: false,
      error:
        'No active WhatsApp connection found for this clinic. Please configure one in Organization Settings.',
    };
  }

  const provider = getWhatsAppProvider(connection.provider);
  return provider.sendMessage(connection, payload);
}

export async function testWhatsAppConnection(
  connectionId: string,
): Promise<TestConnectionResult> {
  const record = await prisma.whatsAppConnection.findFirst({
    where: { id: connectionId },
  });

  if (!record) {
    return { success: false, message: 'WhatsApp connection not found' };
  }

  const provider = getWhatsAppProvider(record.provider);
  return provider.testConnection(record as WhatsAppConnectionRecord);
}

export async function getWhatsAppQrCode(connectionId: string): Promise<QrCodeResult> {
  const record = await prisma.whatsAppConnection.findFirst({
    where: { id: connectionId },
  });

  if (!record) {
    return { available: false, message: 'WhatsApp connection not found' };
  }

  const provider = getWhatsAppProvider(record.provider);
  if (!provider.getQrCode) {
    return {
      available: false,
      message: `Provider "${record.provider}" does not support QR code pairing`,
    };
  }

  return provider.getQrCode(record as WhatsAppConnectionRecord);
}

export async function disconnectWhatsAppConnection(connectionId: string): Promise<void> {
  const record = await prisma.whatsAppConnection.findFirst({
    where: { id: connectionId },
  });

  if (!record) return;

  const provider = getWhatsAppProvider(record.provider);
  if (provider.disconnect) {
    await provider.disconnect(record as WhatsAppConnectionRecord);
  }

  await prisma.whatsAppConnection.update({
    where: { id: connectionId },
    data: { status: 'disconnected', isActive: false },
  });
}
