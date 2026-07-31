/**
 * externalCalendarMappingService.ts — persistent, id-based mappings between
 * NoraMedi practitioners/services and a provider's doctors/treatment types.
 *
 * Matching is NEVER done by name — resolveMapping() is the only function
 * synchronization code may call to translate a local id into a provider id,
 * and it throws ExternalCalendarMappingMissingError (a clear administrative
 * error) rather than guessing when no active mapping exists.
 */

import prisma from '../../db.js';
import { writeAuditLog } from '../../utils/auditLog.js';
import { ExternalCalendarMappingMissingError } from './externalCalendarErrors.js';

export type ExternalCalendarMappingType = 'practitioner' | 'service';

export type ExternalCalendarMappingDto = {
  id: string;
  mappingType: ExternalCalendarMappingType;
  localId: string;
  localLabel: string | null;
  externalId: string;
  externalLabel: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export class ExternalCalendarMappingLocalEntityInvalidError extends Error {
  constructor(mappingType: ExternalCalendarMappingType, localId: string) {
    super(`${mappingType} ${localId} does not belong to this clinic`);
    this.name = 'ExternalCalendarMappingLocalEntityInvalidError';
  }
}

async function verifyLocalEntityBelongsToClinic(
  mappingType: ExternalCalendarMappingType,
  localId: string,
  clinicId: string,
): Promise<string | null> {
  if (mappingType === 'practitioner') {
    const user = await prisma.user.findFirst({
      where: {
        id: localId,
        isActive: true,
        OR: [{ clinicId }, { userClinics: { some: { clinicId, isActive: true } } }],
      },
      select: { firstName: true, lastName: true },
    });
    if (!user) return null;
    return `${user.firstName} ${user.lastName}`.trim();
  }

  const appointmentType = await prisma.appointmentType.findFirst({
    where: { id: localId, clinicId },
    select: { name: true },
  });
  return appointmentType?.name ?? null;
}

function toDto(
  row: {
    id: string;
    mappingType: string;
    localId: string;
    externalId: string;
    externalLabel: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
  localLabel: string | null,
): ExternalCalendarMappingDto {
  return {
    id: row.id,
    mappingType: row.mappingType as ExternalCalendarMappingType,
    localId: row.localId,
    localLabel,
    externalId: row.externalId,
    externalLabel: row.externalLabel,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Lists all mappings for a clinic's connection, with best-effort local display labels. */
export async function listExternalCalendarMappings(
  connectionId: string,
  clinicId: string,
): Promise<ExternalCalendarMappingDto[]> {
  const rows = await prisma.externalCalendarMapping.findMany({
    where: { connectionId, clinicId },
    orderBy: [{ mappingType: 'asc' }, { createdAt: 'asc' }],
  });

  const results: ExternalCalendarMappingDto[] = [];
  for (const row of rows) {
    const localLabel = await verifyLocalEntityBelongsToClinic(
      row.mappingType as ExternalCalendarMappingType,
      row.localId,
      clinicId,
    );
    results.push(toDto(row, localLabel));
  }
  return results;
}

/** Creates or updates a mapping. Rejects if the local entity does not belong to this clinic. */
export async function upsertExternalCalendarMapping(
  connectionId: string,
  clinicId: string,
  organizationId: string,
  input: {
    mappingType: ExternalCalendarMappingType;
    localId: string;
    externalId: string;
    externalLabel?: string | null;
  },
  actor?: { actorUserId?: string | null; actorRole?: string | null },
): Promise<ExternalCalendarMappingDto> {
  const localLabel = await verifyLocalEntityBelongsToClinic(input.mappingType, input.localId, clinicId);
  if (localLabel === null) {
    throw new ExternalCalendarMappingLocalEntityInvalidError(input.mappingType, input.localId);
  }

  const row = await prisma.externalCalendarMapping.upsert({
    where: {
      connectionId_mappingType_localId: {
        connectionId,
        mappingType: input.mappingType,
        localId: input.localId,
      },
    },
    create: {
      connectionId,
      clinicId,
      organizationId,
      mappingType: input.mappingType,
      localId: input.localId,
      externalId: input.externalId,
      externalLabel: input.externalLabel ?? null,
    },
    update: {
      externalId: input.externalId,
      externalLabel: input.externalLabel ?? null,
      isActive: true,
    },
  });

  await writeAuditLog({
    organizationId,
    clinicId,
    actorUserId: actor?.actorUserId ?? null,
    actorRole: actor?.actorRole ?? 'PLATFORM_ADMIN',
    action: 'external_calendar_mapping_updated',
    entityType: 'external_calendar_mapping',
    entityId: row.id,
    description: `Platform Admin mapped ${input.mappingType} ${input.localId} to external id`,
    metadata: { mappingType: input.mappingType },
  });

  return toDto(row, localLabel);
}

/** Deactivates (soft-deletes) a mapping. Verifies clinic ownership before mutating. */
export async function deactivateExternalCalendarMapping(
  mappingId: string,
  clinicId: string,
  actor?: { actorUserId?: string | null; actorRole?: string | null },
): Promise<void> {
  const existing = await prisma.externalCalendarMapping.findFirst({ where: { id: mappingId, clinicId } });
  if (!existing) return;

  await prisma.externalCalendarMapping.update({ where: { id: mappingId }, data: { isActive: false } });

  await writeAuditLog({
    organizationId: existing.organizationId,
    clinicId,
    actorUserId: actor?.actorUserId ?? null,
    actorRole: actor?.actorRole ?? 'PLATFORM_ADMIN',
    action: 'external_calendar_mapping_deactivated',
    entityType: 'external_calendar_mapping',
    entityId: existing.id,
    description: `Platform Admin removed ${existing.mappingType} mapping`,
  });
}

/**
 * Resolves a local practitioner/service to its provider-side external id.
 * Throws ExternalCalendarMappingMissingError (a clear administrative error)
 * if no active mapping exists — synchronization must never guess by name.
 */
export async function resolveExternalCalendarMapping(
  connectionId: string,
  mappingType: ExternalCalendarMappingType,
  localId: string,
): Promise<string> {
  const mapping = await prisma.externalCalendarMapping.findFirst({
    where: { connectionId, mappingType, localId, isActive: true },
  });
  if (!mapping) {
    throw new ExternalCalendarMappingMissingError(mappingType, localId);
  }
  return mapping.externalId;
}
