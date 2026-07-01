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
 * If no DB connection record exists AND ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK=true
 * (the default), fall back to env-var Evolution API config for backwards
 * compatibility with pre-Sprint-10 single-clinic deployments.
 *
 * Set ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK=false in production once all
 * connections have been imported via the panel. See legacyWhatsApp.ts.
 */

import prisma from '../../db.js';
import { getWhatsAppProvider } from './whatsappProviderFactory.js';
import { getLegacyEvolutionConfig } from '../../utils/legacyWhatsApp.js';
import type {
  SendMessagePayload,
  SendMessageResult,
  TestConnectionResult,
  QrCodeResult,
  WhatsAppConnectionRecord,
} from './WhatsAppProvider.js';

// Build a legacy connection record from env vars (never exposes key in logs).
function buildLegacyConnectionRecord(): WhatsAppConnectionRecord {
  const cfg = getLegacyEvolutionConfig();
  // cfg is guaranteed non-null here — caller must check getLegacyEvolutionConfig() first
  return {
    id: 'legacy',
    organizationId: '',
    provider: 'evolution_api',
    status: 'connected',
    evolutionApiUrl: cfg?.url ?? null,
    evolutionInstanceName: cfg?.instanceName ?? null,
    // apiKey stored raw in env var (legacy mode — no DB encryption round-trip)
    evolutionApiKeyEncrypted: cfg?.key ?? null,
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
    orderBy: { createdAt: 'desc' },
  });

  if (mapping) {
    const conn = mapping.whatsappConnection as WhatsAppConnectionRecord & { isActive?: boolean };
    if (!conn.isActive) {
      return null; // Connection exists but was disconnected/deactivated
    }
    return conn;
  }

  // No DB record — check if legacy env-var fallback is permitted.
  const legacyCfg = getLegacyEvolutionConfig();
  if (!legacyCfg) {
    // Fallback disabled (ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK=false) or env vars missing.
    return null;
  }

  // Legacy fallback active — build a transient connection record from env vars.
  // This path is only reached when no DB-backed connection is assigned to the clinic.
  return buildLegacyConnectionRecord();
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
  // Guard: 'all' is a UI sentinel value, not a valid clinic for sending
  if (!clinicId || clinicId === 'all') {
    return {
      success: false,
      error: 'Please select a clinic before sending a WhatsApp message.',
    };
  }

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

  // Guard: reject if connection has been deactivated/disconnected
  const activeCheck = connection as Record<string, unknown>;
  if (activeCheck.isActive === false) {
    return {
      success: false,
      error: 'WhatsApp connection is inactive or disconnected. Please reconnect in Organization Settings.',
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
  const result = await provider.testConnection(record as WhatsAppConnectionRecord);

  // Persist the outcome so status/lastConnectedAt/lastError reflect the real
  // last-known reachability of this connection, not just the ephemeral response.
  await prisma.whatsAppConnection.update({
    where: { id: connectionId },
    data: result.success
      ? { status: 'connected', lastConnectedAt: new Date(), lastError: null }
      : { status: 'error', lastError: result.message },
  });

  return result;
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
