/**
 * platformExternalCalendar.ts — Platform Admin API for configuring a
 * clinic's external dental-software calendar integration (DigiDentiS first).
 *
 * Mounted under the existing platform namespace (/api/platform/...), kept in
 * its own file rather than growing platformAdmin.ts further — same
 * separation already used for platformSecurityIncidents.ts. Every route
 * requires authenticatePlatformAdmin. Credentials are always written via
 * externalCalendarConnectionService.ts (which encrypts secrets and never
 * returns them) — no route here ever reads or echoes back a decrypted
 * secret.
 *
 * Tenant safety: every route is scoped by the :clinicId path param, which
 * is also the row's own unique key on ExternalCalendarIntegration — there
 * is no code path that can return one clinic's configuration in response to
 * a request for another clinic's id.
 */

import express, { Response } from 'express';
import { z } from 'zod';
import { authenticatePlatformAdmin, PlatformAdminRequest } from '../middleware/platformAuth.js';
import { csrfProtection } from '../middleware/csrf.js';
import prisma from '../db.js';
import {
  ExternalCalendarClinicNotFoundError,
  ExternalCalendarUnsupportedProviderError,
  getExternalCalendarConnectionRecord,
  getExternalCalendarIntegrationSummary,
  recordExternalCalendarConnectionCheck,
  rotateExternalCalendarWebhookReceiverKey,
  setExternalCalendarIntegrationEnabled,
  upsertExternalCalendarIntegration,
} from '../services/externalCalendar/externalCalendarConnectionService.js';
import {
  ExternalCalendarMappingLocalEntityInvalidError,
  deactivateExternalCalendarMapping,
  listExternalCalendarMappings,
  upsertExternalCalendarMapping,
} from '../services/externalCalendar/externalCalendarMappingService.js';
import {
  getExternalCalendarProvider,
  listSupportedExternalCalendarProviders,
} from '../services/externalCalendar/externalCalendarProviderFactory.js';
import { ExternalCalendarError } from '../services/externalCalendar/externalCalendarErrors.js';

const router = express.Router();

router.use(authenticatePlatformAdmin as express.RequestHandler, csrfProtection('platform'));

function getClinicIdParam(req: PlatformAdminRequest): string {
  const value = req.params.clinicId;
  return Array.isArray(value) ? value[0] : value;
}

function webhookUrlForConnection(receiverKey: string): string {
  const base = process.env.PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, '') || '';
  return `${base}/api/public/external-calendar/digidentis/${receiverKey}/webhook`;
}

// GET /api/platform/external-calendar/providers — supported provider keys, for the admin UI's dropdown.
router.get('/external-calendar/providers', (_req, res: Response) => {
  res.json({ providers: listSupportedExternalCalendarProviders() });
});

// GET /api/platform/clinics/:clinicId/external-calendar
router.get('/clinics/:clinicId/external-calendar', async (req: PlatformAdminRequest, res: Response) => {
  const clinicId = getClinicIdParam(req);
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { id: true, name: true } });
  if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

  const summary = await getExternalCalendarIntegrationSummary(clinicId);
  res.json({
    clinic: { id: clinic.id, name: clinic.name },
    integration: summary,
    webhookUrl: summary ? webhookUrlForConnection(summary.webhookReceiverKey) : null,
  });
});

const upsertConfigSchema = z.object({
  provider: z.string().min(1).optional(),
  clientId: z.string().trim().min(1).nullable().optional(),
  clientSecret: z.string().min(1).nullable().optional(),
  webhookSecret: z.string().min(1).nullable().optional(),
  externalCompanyId: z.string().trim().min(1).nullable().optional(),
  externalClinicId: z.string().trim().min(1).nullable().optional(),
  apiBaseUrl: z.string().trim().url().nullable().optional(),
});

// PUT /api/platform/clinics/:clinicId/external-calendar
router.put('/clinics/:clinicId/external-calendar', async (req: PlatformAdminRequest, res: Response) => {
  const clinicId = getClinicIdParam(req);
  const parsed = upsertConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }

  try {
    const summary = await upsertExternalCalendarIntegration(clinicId, parsed.data, {
      actorUserId: req.platformAdmin?.id ?? null,
      actorRole: 'PLATFORM_ADMIN',
    });
    res.json({ integration: summary, webhookUrl: webhookUrlForConnection(summary.webhookReceiverKey) });
  } catch (err) {
    if (err instanceof ExternalCalendarClinicNotFoundError) return res.status(404).json({ error: err.message });
    if (err instanceof ExternalCalendarUnsupportedProviderError) return res.status(400).json({ error: err.message });
    console.error('[platform-external-calendar] upsert config failed:', err);
    res.status(500).json({ error: 'Failed to update external calendar integration' });
  }
});

const setEnabledSchema = z.object({ enabled: z.boolean() });

// PATCH /api/platform/clinics/:clinicId/external-calendar/enabled
router.patch('/clinics/:clinicId/external-calendar/enabled', async (req: PlatformAdminRequest, res: Response) => {
  const clinicId = getClinicIdParam(req);
  const parsed = setEnabledSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'enabled must be a boolean' });

  try {
    const summary = await setExternalCalendarIntegrationEnabled(clinicId, parsed.data.enabled, {
      actorUserId: req.platformAdmin?.id ?? null,
      actorRole: 'PLATFORM_ADMIN',
    });
    res.json({ integration: summary });
  } catch (err) {
    if (err instanceof ExternalCalendarClinicNotFoundError) return res.status(404).json({ error: err.message });
    if (err instanceof Error) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'Failed to update external calendar integration' });
  }
});

// POST /api/platform/clinics/:clinicId/external-calendar/rotate-webhook-key — regenerates the
// opaque public webhook URL token. The previous webhook URL stops resolving immediately.
router.post('/clinics/:clinicId/external-calendar/rotate-webhook-key', async (req: PlatformAdminRequest, res: Response) => {
  const clinicId = getClinicIdParam(req);

  try {
    const summary = await rotateExternalCalendarWebhookReceiverKey(clinicId, {
      actorUserId: req.platformAdmin?.id ?? null,
      actorRole: 'PLATFORM_ADMIN',
    });
    res.json({ integration: summary, webhookUrl: webhookUrlForConnection(summary.webhookReceiverKey) });
  } catch (err) {
    if (err instanceof ExternalCalendarClinicNotFoundError) return res.status(404).json({ error: err.message });
    console.error('[platform-external-calendar] rotate webhook key failed:', err);
    res.status(500).json({ error: 'Failed to rotate the webhook key' });
  }
});

// POST /api/platform/clinics/:clinicId/external-calendar/test-connection
router.post('/clinics/:clinicId/external-calendar/test-connection', async (req: PlatformAdminRequest, res: Response) => {
  const clinicId = getClinicIdParam(req);
  const connection = await getExternalCalendarConnectionRecord(clinicId);
  if (!connection) return res.status(404).json({ error: 'No external calendar integration configured for this clinic' });

  try {
    const provider = getExternalCalendarProvider(connection.provider);
    const result = await provider.testConnection(connection);
    const summary = await recordExternalCalendarConnectionCheck(clinicId, result);
    res.json({ result, integration: summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection test failed';
    const summary = await recordExternalCalendarConnectionCheck(clinicId, { success: false, message });
    res.status(200).json({ result: { success: false, message }, integration: summary });
  }
});

// GET /api/platform/clinics/:clinicId/external-calendar/mappings
router.get('/clinics/:clinicId/external-calendar/mappings', async (req: PlatformAdminRequest, res: Response) => {
  const clinicId = getClinicIdParam(req);
  const connection = await getExternalCalendarConnectionRecord(clinicId);
  if (!connection) return res.status(404).json({ error: 'No external calendar integration configured for this clinic' });

  const mappings = await listExternalCalendarMappings(connection.id, clinicId);
  res.json({ mappings });
});

const upsertMappingSchema = z.object({
  mappingType: z.enum(['practitioner', 'service']),
  localId: z.string().min(1),
  externalId: z.string().min(1),
  externalLabel: z.string().trim().min(1).nullable().optional(),
});

// PUT /api/platform/clinics/:clinicId/external-calendar/mappings
router.put('/clinics/:clinicId/external-calendar/mappings', async (req: PlatformAdminRequest, res: Response) => {
  const clinicId = getClinicIdParam(req);
  const parsed = upsertMappingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const connection = await getExternalCalendarConnectionRecord(clinicId);
  if (!connection) return res.status(404).json({ error: 'No external calendar integration configured for this clinic' });

  try {
    const mapping = await upsertExternalCalendarMapping(connection.id, clinicId, connection.organizationId, parsed.data, {
      actorUserId: req.platformAdmin?.id ?? null,
      actorRole: 'PLATFORM_ADMIN',
    });
    res.json({ mapping });
  } catch (err) {
    if (err instanceof ExternalCalendarMappingLocalEntityInvalidError) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[platform-external-calendar] upsert mapping failed:', err);
    res.status(500).json({ error: 'Failed to save mapping' });
  }
});

// DELETE /api/platform/clinics/:clinicId/external-calendar/mappings/:mappingId
router.delete(
  '/clinics/:clinicId/external-calendar/mappings/:mappingId',
  async (req: PlatformAdminRequest, res: Response) => {
    const clinicId = getClinicIdParam(req);
    const mappingId = Array.isArray(req.params.mappingId) ? req.params.mappingId[0] : req.params.mappingId;

    await deactivateExternalCalendarMapping(mappingId, clinicId, {
      actorUserId: req.platformAdmin?.id ?? null,
      actorRole: 'PLATFORM_ADMIN',
    });
    res.status(204).end();
  },
);

// GET /api/platform/clinics/:clinicId/external-calendar/local-options — practitioners/services
// available in THIS clinic, for the mapping UI's local-side dropdowns.
router.get('/clinics/:clinicId/external-calendar/local-options', async (req: PlatformAdminRequest, res: Response) => {
  const clinicId = getClinicIdParam(req);
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { id: true } });
  if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

  const [practitioners, services] = await Promise.all([
    prisma.user.findMany({
      where: {
        isActive: true,
        role: 'DENTIST',
        OR: [{ clinicId }, { userClinics: { some: { clinicId, isActive: true } } }],
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    }),
    prisma.appointmentType.findMany({
      where: { clinicId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  res.json({
    practitioners: practitioners.map((p) => ({ id: p.id, label: `${p.firstName} ${p.lastName}`.trim() })),
    services: services.map((s) => ({ id: s.id, label: s.name })),
  });
});

// GET /api/platform/clinics/:clinicId/external-calendar/remote-options — provider-side
// doctors/treatment types, for the mapping UI's external-side dropdowns.
router.get('/clinics/:clinicId/external-calendar/remote-options', async (req: PlatformAdminRequest, res: Response) => {
  const clinicId = getClinicIdParam(req);
  const connection = await getExternalCalendarConnectionRecord(clinicId);
  if (!connection) return res.status(404).json({ error: 'No external calendar integration configured for this clinic' });

  try {
    const provider = getExternalCalendarProvider(connection.provider);
    const [doctors, treatmentTypes] = await Promise.all([
      provider.listDoctors(connection),
      provider.listTreatmentTypes(connection),
    ]);
    res.json({ doctors, treatmentTypes });
  } catch (err) {
    if (err instanceof ExternalCalendarError) return res.status(502).json({ error: err.message });
    console.error('[platform-external-calendar] remote-options failed:', err);
    res.status(500).json({ error: 'Failed to fetch provider doctors/treatment types' });
  }
});

export default router;
