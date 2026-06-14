/**
 * whatsappOutboundMessaging.ts — Proactive outbound WhatsApp message dispatcher
 *
 * Automated/scheduled messages (reminders, payment notices) must use Meta-approved
 * templates when the clinic uses Meta Cloud API. This module handles the routing.
 *
 * Key rule:
 *   - provider === 'meta_cloud_api' → sendTemplateMessage with approved MessageTemplate
 *   - any other provider (Evolution, legacy)  → sendMessage with rendered plain text
 *
 * NOT used for:
 *   - Inbound AI replies (whatsapp.ts, whatsappService.sendWhatsAppMessage)
 *   - Manual staff inbox replies
 *   - Internal staff notifications (task assignment, practitioner schedule)
 *   - Post-treatment queue (PostTreatmentMessageTemplate has no Meta fields)
 */

import prisma from '../../db.js';
import { resolveConnectionForClinic } from './whatsappService.js';
import { getWhatsAppProvider } from './whatsappProviderFactory.js';
import type { WhatsAppConnectionRecord } from './WhatsAppProvider.js';

// ─── Error codes ──────────────────────────────────────────────────────────────

export const OUTBOUND_ERRORS = {
  NO_CONNECTION: 'WA_NO_CONNECTION',
  META_APPROVED_TEMPLATE_REQUIRED: 'META_APPROVED_TEMPLATE_REQUIRED',
  META_TEMPLATE_VARIABLE_MISSING: 'META_TEMPLATE_VARIABLE_MISSING',
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProactiveMessageResult = {
  success: boolean;
  externalMessageId?: string | null;
  error?: string;
  code?: string;
};

type MetaTemplateSnapshot = {
  metaTemplateName: string | null;
  metaTemplateStatus: string | null;
  metaTemplateLanguage: string | null;
  metaTemplateVariableMap: unknown;
};

// ─── Parameter builder ────────────────────────────────────────────────────────

/**
 * Build the `components` array for sendTemplateMessage from a MetaTemplateVariableMap
 * and a dict of runtime CRM variable values.
 *
 * variableMap format: { "1": "patient_name", "2": "clinic_name", ... }
 * variables format:   { patient_name: "Mustafa", clinic_name: "Aile Diş", ... }
 *
 * Keys are sorted numerically so 1,2,3,10 stays 1,2,3,10 (not 1,10,2,3).
 */
export function buildTemplateComponents(
  variableMap: Record<string, string> | null | undefined,
  variables: Record<string, string>,
): { components: unknown[] } | { code: string; error: string } {
  if (!variableMap || Object.keys(variableMap).length === 0) {
    return { components: [] };
  }

  // Numeric sort: "10" > "9", not "10" < "9" (lexicographic)
  const keys = Object.keys(variableMap).sort((a, b) => Number(a) - Number(b));
  const parameters: Array<{ type: string; text: string }> = [];

  for (const k of keys) {
    const crmVarName = variableMap[k];
    if (!(crmVarName in variables)) {
      return {
        code: OUTBOUND_ERRORS.META_TEMPLATE_VARIABLE_MISSING,
        error: `Template variable "${crmVarName}" (position ${k}) is missing from variables.`,
      };
    }
    parameters.push({ type: 'text', text: variables[crmVarName] ?? '' });
  }

  return {
    components: parameters.length > 0 ? [{ type: 'body', parameters }] : [],
  };
}

// ─── Core dispatcher (exported for testing) ──────────────────────────────────

/**
 * Send a proactive WhatsApp message given a pre-resolved connection.
 * Exported for unit testing without Prisma dependency.
 */
export async function sendProactiveWhatsAppMessageWithConnection(
  connection: WhatsAppConnectionRecord,
  template: MetaTemplateSnapshot | null,
  args: {
    phone: string;
    text: string;
    variables: Record<string, string>;
  },
): Promise<ProactiveMessageResult> {
  const provider = getWhatsAppProvider(connection.provider);

  if (connection.provider === 'meta_cloud_api') {
    const isApproved =
      template?.metaTemplateStatus === 'approved' && Boolean(template.metaTemplateName);

    if (!isApproved) {
      return {
        success: false,
        code: OUTBOUND_ERRORS.META_APPROVED_TEMPLATE_REQUIRED,
        error:
          'Bu mesaj için onaylanmış bir WhatsApp şablonu bulunamadı. Lütfen şablonu Meta\'ya gönderin ve onay bekleyin.',
      };
    }

    const variableMap = template!.metaTemplateVariableMap as Record<string, string> | null;
    const componentsResult = buildTemplateComponents(variableMap, args.variables);

    if ('code' in componentsResult) {
      return { success: false, code: componentsResult.code, error: componentsResult.error };
    }

    const result = await provider.sendTemplateMessage(connection, {
      phone: args.phone,
      templateName: template!.metaTemplateName!,
      languageCode: template!.metaTemplateLanguage ?? 'tr',
      components: componentsResult.components,
    });

    if (!result.supported) {
      return {
        success: false,
        error: result.error ?? 'Template messages are not supported by this provider.',
        code: 'META_TEMPLATE_SEND_NOT_SUPPORTED',
      };
    }

    return {
      success: result.success ?? false,
      externalMessageId: result.externalMessageId,
      error: result.error,
    };
  }

  // Evolution / demo / legacy: plain text sendMessage
  const result = await provider.sendMessage(connection, { phone: args.phone, text: args.text });
  return {
    success: result.success,
    externalMessageId: result.externalMessageId,
    error: result.error,
  };
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Send a proactive (automated/scheduled) WhatsApp message for a clinic.
 *
 * For Meta Cloud API clinics, requires an approved MessageTemplate record.
 * For other providers, sends plain text via sendMessage.
 *
 * @param clinicId    - Clinic whose WhatsApp connection should be used
 * @param phone       - Recipient phone number
 * @param text        - Rendered body (used for Evolution; fallback display for errors)
 * @param templateId  - MessageTemplate.id — used to look up Meta approval status
 * @param variables   - CRM variable values, e.g. { patient_name: "Mustafa" }
 */
export async function sendProactiveWhatsAppMessage(args: {
  clinicId: string;
  phone: string;
  text: string;
  templateId?: string | null;
  variables?: Record<string, string>;
}): Promise<ProactiveMessageResult> {
  const { clinicId, phone, text, templateId, variables = {} } = args;

  if (!clinicId || clinicId === 'all') {
    return {
      success: false,
      error: 'Mesaj göndermek için bir klinik seçilmelidir.',
      code: OUTBOUND_ERRORS.NO_CONNECTION,
    };
  }

  const connection = await resolveConnectionForClinic(clinicId);
  if (!connection) {
    return {
      success: false,
      error: 'Bu klinik için aktif bir WhatsApp bağlantısı bulunamadı.',
      code: OUTBOUND_ERRORS.NO_CONNECTION,
    };
  }

  let template: MetaTemplateSnapshot | null = null;
  if (connection.provider === 'meta_cloud_api' && templateId) {
    template = await prisma.messageTemplate.findFirst({
      where: { id: templateId, clinicId, channel: 'whatsapp' },
      select: {
        metaTemplateName: true,
        metaTemplateStatus: true,
        metaTemplateLanguage: true,
        metaTemplateVariableMap: true,
      },
    });
  }

  return sendProactiveWhatsAppMessageWithConnection(connection, template, { phone, text, variables });
}
