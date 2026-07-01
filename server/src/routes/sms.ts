/**
 * sms.ts — SMS add-on module routes.
 *
 * All endpoints are clinic-scoped and role-protected:
 *  - Settings/provider management: OWNER, ORG_ADMIN, CLINIC_MANAGER
 *  - Usage summary: management roles + BILLING (read-only)
 *  - Manual sending: operational roles (no DENTIST/ASSISTANT)
 *  - History: management + RECEPTIONIST
 *
 * The add-on itself (activation + quota) is managed from the platform admin
 * panel — clinics cannot enable SMS or raise their own quota here.
 */

import express, { Response } from 'express';
import prisma from '../db.js';
import { Prisma } from '@prisma/client';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import { smsSettingsSchema, smsSendSchema } from '../schemas/index.js';
import { resolveEffectiveClinicId, validateAndGetClinicIdScope } from '../utils/clinicScope.js';
import { sendClinicSms } from '../services/sms/smsService.js';
import { getSmsEntitlement, getSmsMonthlyUsage, currentSmsPeriod } from '../services/sms/smsEntitlement.js';
import { AVAILABLE_SMS_PROVIDERS, getSmsProvider } from '../services/sms/smsProviders.js';
import { patientContactSelect, userNameSelect } from '../utils/prismaSelects.js';
import { encryptJson } from '../utils/encryption.js';

const router = express.Router();

const SETTINGS_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER'];
const USAGE_ROLES = [...SETTINGS_ROLES, 'BILLING'];
const SEND_ROLES = [...SETTINGS_ROLES, 'RECEPTIONIST'];
const HISTORY_ROLES = [...SETTINGS_ROLES, 'RECEPTIONIST'];

// Provider configs hold API credentials — encrypt at rest (AES-256-GCM),
// same as WhatsApp access tokens. Decrypted only inside smsService.
function toJsonInput(value: Record<string, unknown> | null | undefined) {
  if (value === null) return Prisma.DbNull;
  if (value === undefined) return undefined;
  return encryptJson(value) as unknown as Prisma.InputJsonValue;
}

async function buildStatusPayload(clinicId: string) {
  const entitlement = await getSmsEntitlement(clinicId);
  const period = currentSmsPeriod();
  const used = await getSmsMonthlyUsage(clinicId, period);
  return {
    addonActive: entitlement.enabled,
    addonSource: entitlement.source,
    period,
    monthlyQuota: entitlement.monthlyQuota,
    usedThisMonth: used,
    remaining: Math.max(0, entitlement.monthlyQuota - used),
    senderName: entitlement.settings?.senderName ?? null,
    turkeyProvider: entitlement.settings?.turkeyProvider ?? null,
    turkeyProviderConfigured: Boolean(getSmsProvider(entitlement.settings?.turkeyProvider)),
    europeProvider: entitlement.settings?.europeProvider ?? null,
    europeProviderConfigured: Boolean(getSmsProvider(entitlement.settings?.europeProvider)),
    availableProviders: AVAILABLE_SMS_PROVIDERS,
  };
}

// GET /api/sms/settings — add-on status, quota/usage, provider configuration
router.get('/sms/settings', authorize(SETTINGS_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
    if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

    res.json(await buildStatusPayload(clinicId));
  } catch {
    res.status(500).json({ error: 'Failed to fetch SMS settings' });
  }
});

// PUT /api/sms/settings — provider selection + sender name (NOT activation/quota)
router.put('/sms/settings', authorize(SETTINGS_ROLES), async (req: AuthRequest, res: Response) => {
  const validation = smsSettingsSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  try {
    const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
    if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

    const { senderName, turkeyProvider, turkeyProviderConfig, europeProvider, europeProviderConfig } = validation.data;

    // Only known provider keys may be selected (fail closed on typos)
    if (turkeyProvider && !getSmsProvider(turkeyProvider)) {
      return res.status(400).json({ error: `Unknown Turkey SMS provider: ${turkeyProvider}` });
    }
    if (europeProvider && !getSmsProvider(europeProvider)) {
      return res.status(400).json({ error: `Unknown Europe SMS provider: ${europeProvider}` });
    }

    const data = {
      senderName: senderName !== undefined ? senderName : undefined,
      turkeyProvider: turkeyProvider !== undefined ? turkeyProvider : undefined,
      turkeyProviderConfig: toJsonInput(turkeyProviderConfig),
      europeProvider: europeProvider !== undefined ? europeProvider : undefined,
      europeProviderConfig: toJsonInput(europeProviderConfig),
    };

    await prisma.clinicSmsSettings.upsert({
      where: { clinicId },
      update: data,
      create: {
        clinicId,
        organizationId: req.user!.organizationId,
        senderName: senderName ?? null,
        turkeyProvider: turkeyProvider ?? null,
        turkeyProviderConfig: toJsonInput(turkeyProviderConfig),
        europeProvider: europeProvider ?? null,
        europeProviderConfig: toJsonInput(europeProviderConfig),
      },
    });

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'sms_settings', entityId: clinicId,
      action: 'updated', description: 'SMS sağlayıcı ayarları güncellendi',
    });

    res.json(await buildStatusPayload(clinicId));
  } catch {
    res.status(500).json({ error: 'Failed to update SMS settings' });
  }
});

// GET /api/sms/usage — usage/quota summary (BILLING may read; no message content)
router.get('/sms/usage', authorize(USAGE_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const clinicId = await resolveEffectiveClinicId(req.user!, req.query.clinicId as string | undefined);
    if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

    const entitlement = await getSmsEntitlement(clinicId);
    const period = currentSmsPeriod();
    const used = await getSmsMonthlyUsage(clinicId, period);

    res.json({
      addonActive: entitlement.enabled,
      period,
      monthlyQuota: entitlement.monthlyQuota,
      usedThisMonth: used,
      remaining: Math.max(0, entitlement.monthlyQuota - used),
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch SMS usage' });
  }
});

// GET /api/sms/history — clinic-scoped send history (statuses incl. blocked reasons)
router.get('/sms/history', authorize(HISTORY_ROLES), async (req: AuthRequest, res: Response) => {
  const { patientId, status, purpose, clinicId: selectedClinicId } = req.query;

  const scope = await validateAndGetClinicIdScope(req.user!, selectedClinicId as string | undefined, res);
  if (scope === false) return;

  try {
    const where: Prisma.SmsMessageWhereInput = { ...scope };
    if (patientId) where.patientId = String(patientId);
    if (status) where.status = String(status);
    if (purpose) where.purpose = String(purpose);

    const take = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '100'), 10) || 100));
    const messages = await prisma.smsMessage.findMany({
      where,
      include: {
        patient: { select: patientContactSelect },
        createdBy: { select: userNameSelect },
        template: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
    res.json(messages);
  } catch {
    res.status(500).json({ error: 'Failed to fetch SMS history' });
  }
});

// POST /api/sms/send — manual patient SMS through the full safety pipeline
router.post('/sms/send', authorize(SEND_ROLES), async (req: AuthRequest, res: Response) => {
  const validation = smsSendSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ error: validation.error.format() });

  const { patientId, clinicId: bodyClinicId, appointmentId, templateId, purpose, body } = validation.data;

  try {
    const clinicId = await resolveEffectiveClinicId(req.user!, bodyClinicId ?? undefined);
    if (!clinicId) return res.status(403).json({ error: 'Access denied to requested clinic' });

    const result = await sendClinicSms({
      organizationId: req.user!.organizationId,
      clinicId,
      patientId,
      appointmentId: appointmentId ?? null,
      templateId: templateId ?? null,
      purpose,
      body: body ?? null,
      createdById: req.user!.id,
    });

    if (!result.ok) {
      const statusByCode: Record<string, number> = {
        addon_disabled: 402,
        quota_exceeded: 402,
        consent_blocked: 403,
        invalid_phone: 400,
        region_unsupported: 400,
        unresolved_variables: 400,
        template_invalid: 400,
        duplicate: 409,
        provider_not_configured: 422,
        send_failed: 502,
      };
      return res.status(statusByCode[result.code] ?? 400).json({
        error: result.error,
        code: result.code,
        smsMessageId: result.messageId ?? null,
      });
    }

    await logActivity({
      clinicId, userId: req.user!.id, entityType: 'sms_message', entityId: result.messageId,
      action: 'sent', description: `Hastaya SMS gönderildi (${purpose})`,
      patientId,
    });

    res.json({ id: result.messageId, status: 'sent', provider: result.provider, region: result.region });
  } catch (error: unknown) {
    console.error('[sms] send error:', error instanceof Error ? error.message : error);
    res.status(500).json({ error: 'Failed to send SMS' });
  }
});

export default router;
