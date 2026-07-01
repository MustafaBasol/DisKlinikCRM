/**
 * metaTemplateService.ts — Meta WhatsApp Business API template management.
 *
 * Handles submission, status sync, and name/body conversion for WhatsApp message
 * templates. Credentials are never logged or returned to callers.
 *
 * Meta Graph API endpoints used:
 *   POST /{wabaId}/message_templates   — create template
 *   GET  /{wabaId}/message_templates?name={name} — fetch status
 *
 * Required on WhatsAppConnection:
 *   metaWabaId               — WhatsApp Business Account ID
 *   metaAccessTokenEncrypted — AES-256-GCM encrypted permanent access token
 */

import prisma from '../db.js';
import { decryptSecret } from '../utils/encryption.js';
import type { WhatsAppConnectionRecord } from './whatsapp/WhatsAppProvider.js';

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v23.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// ── Error codes ───────────────────────────────────────────────────────────────

export const META_ERRORS = {
  CONNECTION_NOT_FOUND: 'META_WA_CONNECTION_NOT_FOUND',
  WABA_ID_MISSING: 'META_WABA_ID_MISSING',
  ACCESS_TOKEN_MISSING: 'META_ACCESS_TOKEN_MISSING',
  SUBMIT_FAILED: 'META_TEMPLATE_SUBMIT_FAILED',
  WABA_MISMATCH: 'META_WABA_MISMATCH',
} as const;

// ── Statuses ──────────────────────────────────────────────────────────────────

export type MetaTemplateStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'paused'
  | 'disabled'
  | 'unknown';

/** Normalise Meta API status strings (uppercased) → our lowercase status. */
function normaliseMetaStatus(raw: string): MetaTemplateStatus {
  switch (raw.toUpperCase()) {
    case 'APPROVED': return 'approved';
    case 'REJECTED': return 'rejected';
    case 'PENDING':
    case 'IN_APPEAL':
    case 'PENDING_DELETION': return 'submitted';
    case 'PAUSED': return 'paused';
    case 'DISABLED': return 'disabled';
    default: return 'unknown';
  }
}

// ── Name sanitisation ─────────────────────────────────────────────────────────

/**
 * Convert a CRM template name to a Meta-safe name:
 * lowercase, underscores, no leading/trailing underscores, max 512 chars.
 *
 * "24 Saat Randevu Hatırlatma" → "24_saat_randevu_hatirlatma"
 */
export function sanitizeMetaTemplateName(name: string): string {
  // Transliterate common Turkish characters
  const tr: Record<string, string> = {
    ğ: 'g', ü: 'u', ş: 's', ı: 'i', ö: 'o', ç: 'c',
    Ğ: 'g', Ü: 'u', Ş: 's', İ: 'i', Ö: 'o', Ç: 'c',
  };
  const transliterated = name.replace(/[ğüşıöçĞÜŞİÖÇ]/g, (ch) => tr[ch] ?? ch);
  return transliterated
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 512) || 'template';
}

// ── Variable conversion ───────────────────────────────────────────────────────

export type BodyConversionResult = {
  metaBody: string;
  variableMap: Record<string, string>; // { "1": "patient_name", "2": "clinic_name", ... }
};

/**
 * Convert CRM body with named placeholders to Meta numbered placeholders.
 *
 * CRM:  "Merhaba {{patient_name}}, {{clinic_name}} randevunuz {{appointment_date}}."
 * Meta: "Merhaba {{1}}, {{2}} randevunuz {{3}}."
 * Map:  { "1": "patient_name", "2": "clinic_name", "3": "appointment_date" }
 *
 * A variable that appears more than once reuses the same number.
 */
export function convertBodyToMeta(body: string): BodyConversionResult {
  const variableMap: Record<string, string> = {};
  const nameToNumber: Record<string, string> = {};
  let counter = 0;

  const metaBody = body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, varName: string) => {
    if (nameToNumber[varName] !== undefined) {
      return `{{${nameToNumber[varName]}}}`;
    }
    counter++;
    const num = String(counter);
    nameToNumber[varName] = num;
    variableMap[num] = varName;
    return `{{${num}}}`;
  });

  return { metaBody, variableMap };
}

// ── Token resolution ──────────────────────────────────────────────────────────

function resolveAccessToken(connection: WhatsAppConnectionRecord): string | null {
  const raw = connection.metaAccessTokenEncrypted?.trim();
  if (!raw) return null;
  try {
    return decryptSecret(raw);
  } catch {
    // Legacy / test records stored unencrypted — accept as-is
    return raw;
  }
}

// ── Result types ──────────────────────────────────────────────────────────────

export type CreateTemplateArgs = {
  templateName: string;
  languageCode: string;
  category: string; // utility | marketing | authentication
  metaBody: string;
  variableMap: Record<string, string>;
};

export type CreateTemplateResult =
  | { success: true; metaTemplateId: string | null }
  | { success: false; code: string; message: string };

export type SyncTemplateResult =
  | { success: true; status: MetaTemplateStatus; rejectionReason: string | null }
  | { success: false; code: string; message: string };

// ── Meta API helpers ──────────────────────────────────────────────────────────

/**
 * POST /{wabaId}/message_templates
 * Returns the template ID assigned by Meta (if present in response).
 */
export async function createMetaTemplate(
  connection: WhatsAppConnectionRecord,
  args: CreateTemplateArgs,
): Promise<CreateTemplateResult> {
  const wabaId = connection.metaWabaId?.trim();
  const accessToken = resolveAccessToken(connection);

  if (!wabaId) {
    return { success: false, code: META_ERRORS.WABA_ID_MISSING, message: 'WhatsApp Business Account ID is missing from the connection configuration.' };
  }
  if (!accessToken) {
    return { success: false, code: META_ERRORS.ACCESS_TOKEN_MISSING, message: 'Access token is missing from the connection configuration.' };
  }

  const variableCount = Object.keys(args.variableMap).length;
  const components: unknown[] = [
    {
      type: 'BODY',
      text: args.metaBody,
      ...(variableCount > 0
        ? {
            example: {
              body_text: [
                Object.keys(args.variableMap)
                  .sort((a, b) => Number(a) - Number(b))
                  .map((k) => args.variableMap[k]),
              ],
            },
          }
        : {}),
    },
  ];

  const payload = {
    name: args.templateName,
    language: args.languageCode,
    category: args.category.toUpperCase(),
    components,
  };

  const url = `${GRAPH_BASE}/${encodeURIComponent(wabaId)}/message_templates`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      const errObj = data.error as Record<string, unknown> | undefined;
      const detail = errObj?.message ?? String(data);
      return {
        success: false,
        code: META_ERRORS.SUBMIT_FAILED,
        message: `Meta rejected the template submission: ${detail}`,
      };
    }

    const metaTemplateId = (data.id as string | undefined) ?? null;
    return { success: true, metaTemplateId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, code: META_ERRORS.SUBMIT_FAILED, message: `Network error submitting template: ${msg}` };
  }
}

/**
 * GET /{wabaId}/message_templates?name={name}&fields=name,status,rejected_reason,id
 * Returns the current approval status from Meta.
 */
export async function fetchMetaTemplateStatus(
  connection: WhatsAppConnectionRecord,
  templateName: string,
): Promise<SyncTemplateResult> {
  const wabaId = connection.metaWabaId?.trim();
  const accessToken = resolveAccessToken(connection);

  if (!wabaId) {
    return { success: false, code: META_ERRORS.WABA_ID_MISSING, message: 'WhatsApp Business Account ID is missing.' };
  }
  if (!accessToken) {
    return { success: false, code: META_ERRORS.ACCESS_TOKEN_MISSING, message: 'Access token is missing.' };
  }

  const params = new URLSearchParams({
    name: templateName,
    fields: 'name,status,rejected_reason,id',
  });
  const url = `${GRAPH_BASE}/${encodeURIComponent(wabaId)}/message_templates?${params}`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      const errObj = data.error as Record<string, unknown> | undefined;
      const detail = errObj?.message ?? String(data);
      return { success: false, code: META_ERRORS.SUBMIT_FAILED, message: `Meta API error fetching status: ${detail}` };
    }

    const items = (data.data as Array<Record<string, unknown>> | undefined) ?? [];
    if (items.length === 0) {
      return { success: true, status: 'unknown', rejectionReason: null };
    }

    const item = items[0];
    const status = normaliseMetaStatus((item.status as string | undefined) ?? '');
    const rejectionReason = (item.rejected_reason as string | undefined) ?? null;
    return { success: true, status, rejectionReason };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, code: META_ERRORS.SUBMIT_FAILED, message: `Network error fetching template status: ${msg}` };
  }
}

/**
 * Fetch current status from Meta and persist to DB.
 * Returns the updated status or an error.
 */
export async function syncMetaTemplateStatus(
  templateId: string,
  connection: WhatsAppConnectionRecord,
): Promise<SyncTemplateResult> {
  const template = await prisma.messageTemplate.findUnique({ where: { id: templateId } });
  if (!template || !template.metaTemplateName) {
    return { success: false, code: META_ERRORS.SUBMIT_FAILED, message: 'Template has not been submitted for WhatsApp approval yet.' };
  }

  const result = await fetchMetaTemplateStatus(connection, template.metaTemplateName);
  if (!result.success) return result;

  await prisma.messageTemplate.update({
    where: { id: templateId },
    data: {
      metaTemplateStatus: result.status,
      metaTemplateRejectionReason: result.rejectionReason,
      metaTemplateLastSyncedAt: new Date(),
    },
  });

  return result;
}
