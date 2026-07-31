/**
 * externalCalendarConnectionService.ts — tenant-safe CRUD for
 * ExternalCalendarIntegration rows.
 *
 * Every function is scoped by clinicId (the row's own unique key) and
 * always re-derives organizationId from the Clinic row itself rather than
 * trusting a caller-supplied value — the same defensive pattern used
 * throughout clinicScope.ts. Secrets are encrypted on write
 * (utils/encryption.ts encryptSecret) and are NEVER included in any
 * returned DTO — see toSummaryDto() below, which is the only shape this
 * module ever hands back to a route handler.
 */

import { randomBytes } from 'crypto';
import prisma from '../../db.js';
import { encryptSecret } from '../../utils/encryption.js';
import { writeAuditLog } from '../../utils/auditLog.js';
import type { ExternalCalendarConnectionRecord } from './ExternalCalendarProvider.js';
import { listSupportedExternalCalendarProviders } from './externalCalendarProviderFactory.js';

/** 32 random bytes (256 bits), URL-safe — opaque and unguessable, and never
 *  reused as a database identifier for anything else. */
function generateWebhookReceiverKey(): string {
  return randomBytes(32).toString('base64url');
}

export type ExternalCalendarIntegrationSummary = {
  id: string;
  clinicId: string;
  provider: string;
  enabled: boolean;
  status: string;
  clientIdConfigured: boolean;
  /** Last 4 characters only — never the full client id in bulk exports/logs. */
  clientIdHint: string | null;
  clientSecretConfigured: boolean;
  webhookSecretConfigured: boolean;
  /** Opaque public webhook URL token — not a secret (the webhook secret is
   *  what authenticates deliveries), but never the row's own database id. */
  webhookReceiverKey: string;
  externalCompanyId: string | null;
  externalClinicId: string | null;
  apiBaseUrl: string | null;
  lastSuccessfulCheckAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpsertExternalCalendarIntegrationInput = {
  provider?: string;
  clientId?: string | null;
  /** undefined = leave unchanged; null = clear; string = re-encrypt and store. */
  clientSecret?: string | null;
  webhookSecret?: string | null;
  externalCompanyId?: string | null;
  externalClinicId?: string | null;
  apiBaseUrl?: string | null;
};

function toSummaryDto(row: {
  id: string;
  clinicId: string;
  provider: string;
  enabled: boolean;
  status: string;
  clientId: string | null;
  clientSecretEncrypted: string | null;
  webhookSecretEncrypted: string | null;
  webhookReceiverKey: string;
  externalCompanyId: string | null;
  externalClinicId: string | null;
  apiBaseUrl: string | null;
  lastSuccessfulCheckAt: Date | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ExternalCalendarIntegrationSummary {
  return {
    id: row.id,
    clinicId: row.clinicId,
    provider: row.provider,
    enabled: row.enabled,
    status: row.status,
    clientIdConfigured: Boolean(row.clientId),
    clientIdHint: row.clientId ? row.clientId.slice(-4) : null,
    clientSecretConfigured: Boolean(row.clientSecretEncrypted),
    webhookSecretConfigured: Boolean(row.webhookSecretEncrypted),
    webhookReceiverKey: row.webhookReceiverKey,
    externalCompanyId: row.externalCompanyId,
    externalClinicId: row.externalClinicId,
    apiBaseUrl: row.apiBaseUrl,
    lastSuccessfulCheckAt: row.lastSuccessfulCheckAt?.toISOString() ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class ExternalCalendarClinicNotFoundError extends Error {
  constructor(clinicId: string) {
    super(`Clinic ${clinicId} not found`);
    this.name = 'ExternalCalendarClinicNotFoundError';
  }
}

export class ExternalCalendarUnsupportedProviderError extends Error {
  constructor(provider: string) {
    super(`Unsupported external calendar provider: ${provider}`);
    this.name = 'ExternalCalendarUnsupportedProviderError';
  }
}

/** Fetches the sanitized summary for a clinic's integration, or null if none configured. */
export async function getExternalCalendarIntegrationSummary(
  clinicId: string,
): Promise<ExternalCalendarIntegrationSummary | null> {
  const row = await prisma.externalCalendarIntegration.findUnique({ where: { clinicId } });
  return row ? toSummaryDto(row) : null;
}

function toConnectionRecord(row: {
  id: string;
  clinicId: string;
  organizationId: string;
  provider: string;
  clientId: string | null;
  clientSecretEncrypted: string | null;
  webhookSecretEncrypted: string | null;
  externalCompanyId: string | null;
  externalClinicId: string | null;
  apiBaseUrl: string | null;
}): ExternalCalendarConnectionRecord {
  return {
    id: row.id,
    clinicId: row.clinicId,
    organizationId: row.organizationId,
    provider: row.provider,
    clientId: row.clientId,
    clientSecretEncrypted: row.clientSecretEncrypted,
    webhookSecretEncrypted: row.webhookSecretEncrypted,
    externalCompanyId: row.externalCompanyId,
    externalClinicId: row.externalClinicId,
    apiBaseUrl: row.apiBaseUrl,
  };
}

/**
 * Fetches the full record (including encrypted fields) for provider use.
 * Never return this shape from a route handler directly.
 */
export async function getExternalCalendarConnectionRecord(
  clinicId: string,
): Promise<ExternalCalendarConnectionRecord | null> {
  const row = await prisma.externalCalendarIntegration.findUnique({ where: { clinicId } });
  return row ? toConnectionRecord(row) : null;
}

/**
 * Fetches the full record by its opaque public webhookReceiverKey — used by
 * the webhook receiver, which only knows :receiverKey from the URL. This is
 * deliberately NOT a lookup by the row's own database id: the id is never
 * exposed in the public webhook URL (see webhookReceiverKey's schema
 * comment). Never return this shape from a route handler directly.
 */
export async function getExternalCalendarConnectionRecordByReceiverKey(
  receiverKey: string,
): Promise<ExternalCalendarConnectionRecord | null> {
  const row = await prisma.externalCalendarIntegration.findUnique({ where: { webhookReceiverKey: receiverKey } });
  return row ? toConnectionRecord(row) : null;
}

/** Creates or updates a clinic's integration config. Never enables it — see setExternalCalendarIntegrationEnabled(). */
export async function upsertExternalCalendarIntegration(
  clinicId: string,
  input: UpsertExternalCalendarIntegrationInput,
  actor?: { actorUserId?: string | null; actorRole?: string | null },
): Promise<ExternalCalendarIntegrationSummary> {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { id: true, organizationId: true } });
  if (!clinic) throw new ExternalCalendarClinicNotFoundError(clinicId);

  const provider = input.provider ?? 'digidentis';
  if (!listSupportedExternalCalendarProviders().includes(provider)) {
    throw new ExternalCalendarUnsupportedProviderError(provider);
  }

  const data: Record<string, unknown> = { provider };
  if (input.clientId !== undefined) data.clientId = input.clientId;
  if (input.clientSecret !== undefined) {
    data.clientSecretEncrypted = input.clientSecret === null ? null : encryptSecret(input.clientSecret);
  }
  if (input.webhookSecret !== undefined) {
    data.webhookSecretEncrypted = input.webhookSecret === null ? null : encryptSecret(input.webhookSecret);
  }
  if (input.externalCompanyId !== undefined) data.externalCompanyId = input.externalCompanyId;
  if (input.externalClinicId !== undefined) data.externalClinicId = input.externalClinicId;
  if (input.apiBaseUrl !== undefined) data.apiBaseUrl = input.apiBaseUrl;

  const existing = await prisma.externalCalendarIntegration.findUnique({ where: { clinicId } });
  const nextStatus = existing?.status === 'not_configured' || !existing ? 'configured' : existing.status;

  const row = await prisma.externalCalendarIntegration.upsert({
    where: { clinicId },
    create: {
      clinicId,
      organizationId: clinic.organizationId,
      provider,
      status: 'configured',
      // Generated once at row creation only — never touched by a config
      // update, so re-saving the clientId/secret never silently changes the
      // clinic's already-configured webhook URL. Use
      // rotateExternalCalendarWebhookReceiverKey() to change it on purpose.
      webhookReceiverKey: generateWebhookReceiverKey(),
      ...data,
    },
    update: { ...data, status: nextStatus },
  });

  await writeAuditLog({
    organizationId: clinic.organizationId,
    clinicId,
    actorUserId: actor?.actorUserId ?? null,
    actorRole: actor?.actorRole ?? 'PLATFORM_ADMIN',
    action: 'external_calendar_integration_updated',
    entityType: 'external_calendar_integration',
    entityId: row.id,
    description: 'Platform Admin updated external calendar integration configuration',
    metadata: {
      provider,
      fieldsUpdated: Object.keys(data).filter((k) => !k.toLowerCase().includes('secret')),
      clientSecretChanged: input.clientSecret !== undefined,
      webhookSecretChanged: input.webhookSecret !== undefined,
    },
  });

  return toSummaryDto(row);
}

/** Enables/disables the integration. Refuses to enable an unconfigured connection. */
export async function setExternalCalendarIntegrationEnabled(
  clinicId: string,
  enabled: boolean,
  actor?: { actorUserId?: string | null; actorRole?: string | null },
): Promise<ExternalCalendarIntegrationSummary> {
  const row = await prisma.externalCalendarIntegration.findUnique({ where: { clinicId } });
  if (!row) throw new ExternalCalendarClinicNotFoundError(clinicId);

  if (enabled && (!row.clientId || !row.clientSecretEncrypted || !row.externalClinicId)) {
    throw new Error(
      'Cannot enable external calendar integration: clientId, clientSecret and externalClinicId must be configured first.',
    );
  }

  const updated = await prisma.externalCalendarIntegration.update({
    where: { clinicId },
    data: { enabled },
  });

  await writeAuditLog({
    organizationId: row.organizationId,
    clinicId,
    actorUserId: actor?.actorUserId ?? null,
    actorRole: actor?.actorRole ?? 'PLATFORM_ADMIN',
    action: enabled ? 'external_calendar_integration_enabled' : 'external_calendar_integration_disabled',
    entityType: 'external_calendar_integration',
    entityId: row.id,
    description: `Platform Admin ${enabled ? 'enabled' : 'disabled'} external calendar integration`,
  });

  return toSummaryDto(updated);
}

/**
 * Regenerates the clinic's public webhook receiver key. The previous
 * webhook URL stops resolving immediately — DigiDentiS must be
 * reconfigured with the new URL. Use when a URL may have leaked (e.g.
 * appeared in a log, a screenshot, a support ticket).
 */
export async function rotateExternalCalendarWebhookReceiverKey(
  clinicId: string,
  actor?: { actorUserId?: string | null; actorRole?: string | null },
): Promise<ExternalCalendarIntegrationSummary> {
  const existing = await prisma.externalCalendarIntegration.findUnique({ where: { clinicId } });
  if (!existing) throw new ExternalCalendarClinicNotFoundError(clinicId);

  const row = await prisma.externalCalendarIntegration.update({
    where: { clinicId },
    data: { webhookReceiverKey: generateWebhookReceiverKey() },
  });

  await writeAuditLog({
    organizationId: existing.organizationId,
    clinicId,
    actorUserId: actor?.actorUserId ?? null,
    actorRole: actor?.actorRole ?? 'PLATFORM_ADMIN',
    action: 'external_calendar_webhook_key_rotated',
    entityType: 'external_calendar_integration',
    entityId: row.id,
    description: 'Platform Admin rotated the external calendar webhook receiver key; the previous webhook URL is now invalid',
  });

  return toSummaryDto(row);
}

/** Records the outcome of a manual/automatic connectivity check. */
export async function recordExternalCalendarConnectionCheck(
  clinicId: string,
  result: { success: boolean; message?: string | null },
): Promise<ExternalCalendarIntegrationSummary> {
  const now = new Date();
  const row = await prisma.externalCalendarIntegration.update({
    where: { clinicId },
    data: {
      lastCheckedAt: now,
      lastSuccessfulCheckAt: result.success ? now : undefined,
      status: result.success ? 'connected' : 'error',
      lastError: result.success ? null : result.message?.slice(0, 500) ?? 'Connection check failed',
    },
  });
  return toSummaryDto(row);
}
