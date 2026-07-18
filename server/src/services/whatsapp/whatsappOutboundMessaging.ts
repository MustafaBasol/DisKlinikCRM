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
 *
 * sendNoShowRecoveryWhatsApp — purpose-based no-show recovery send:
 *   Selects the first active, approved MessageTemplate with purpose = no_show_recovery
 *   for the clinic.  For Evolution it falls back to plain sendMessage.
 *
 * sendPostTreatmentWhatsApp — purpose-based post-treatment follow-up send:
 *   For Meta Cloud: selects the first active, approved MessageTemplate with
 *   purpose = post_treatment_followup. Rejects without fallback if none found.
 *   For Evolution: sends plain text via sendMessage (existing behavior).
 */

import prisma from '../../db.js';
import { resolveConnectionForClinic } from './whatsappService.js';
import { getWhatsAppProvider } from './whatsappProviderFactory.js';
import { evaluateTemplateBinding } from './templateBinding.js';
import type { WhatsAppConnectionRecord } from './WhatsAppProvider.js';
import { assertCommunicationPermission } from '../communicationConsent/communicationConsentPolicy.js';
import type { CommunicationPurpose } from '../communicationConsent/taxonomy.js';

// ─── Error codes ──────────────────────────────────────────────────────────────

export const OUTBOUND_ERRORS = {
  NO_CONNECTION: 'WA_NO_CONNECTION',
  META_APPROVED_TEMPLATE_REQUIRED: 'META_APPROVED_TEMPLATE_REQUIRED',
  META_TEMPLATE_VARIABLE_MISSING: 'META_TEMPLATE_VARIABLE_MISSING',
  BLOCKED_BY_CONSENT: 'BLOCKED_BY_CONSENT',
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProactiveMessageResult = {
  success: boolean;
  externalMessageId?: string | null;
  error?: string;
  code?: string;
};

/**
 * Optional KVKK-HIGH-007 consent-check inputs, accepted by every public
 * dispatcher below. When all three fields are provided, the central
 * decision service (communicationConsentPolicy.ts) is consulted before the
 * provider is called. When omitted, behavior is completely unchanged
 * (backwards compatible with callers not yet updated). Even when provided,
 * this is a no-op unless COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED=true.
 */
export type WhatsAppConsentCheckArgs = {
  organizationId?: string;
  patientId?: string;
  consentPurpose?: CommunicationPurpose;
};

/**
 * Returns a blocking ProactiveMessageResult when the central consent policy
 * denies the send in enforce mode; null when the send may proceed (either
 * allowed, or the consent args were not supplied by this caller yet).
 */
async function checkWhatsAppConsent(
  clinicId: string,
  args: WhatsAppConsentCheckArgs,
): Promise<ProactiveMessageResult | null> {
  if (!args.organizationId || !args.patientId || !args.consentPurpose) return null;

  const permission = await assertCommunicationPermission({
    organizationId: args.organizationId,
    clinicId,
    patientId: args.patientId,
    channel: 'whatsapp',
    purpose: args.consentPurpose,
  });

  if (!permission.blocked) return null;

  return {
    success: false,
    code: OUTBOUND_ERRORS.BLOCKED_BY_CONSENT,
    error: 'Central communication consent policy blocks this WhatsApp message.',
  };
}

export type MetaTemplateSnapshot = {
  metaTemplateName: string | null;
  metaTemplateStatus: string | null;
  metaTemplateLanguage: string | null;
  metaTemplateVariableMap: unknown;
  metaTemplateConnectionId?: string | null;
  metaWabaIdSnapshot?: string | null;
};

/**
 * Select the fields needed for evaluateTemplateBinding alongside the usual
 * MetaTemplateSnapshot select — kept in one place so every purpose-based lookup
 * checks the connection/WABA binding the same way.
 */
const META_TEMPLATE_SNAPSHOT_SELECT = {
  metaTemplateName: true,
  metaTemplateStatus: true,
  metaTemplateLanguage: true,
  metaTemplateVariableMap: true,
  metaTemplateConnectionId: true,
  metaWabaIdSnapshot: true,
} as const;

/**
 * A template only counts as usable for automations if its stored connection/WABA
 * binding matches the currently active connection. Templates with no stored
 * binding (submitted before this snapshot existed) are treated as NOT usable —
 * they must be resubmitted before automations will send them again.
 */
function isTemplateUsableForConnection(
  template: MetaTemplateSnapshot,
  connection: WhatsAppConnectionRecord,
): boolean {
  return evaluateTemplateBinding(template, connection) === 'matched';
}

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
} & WhatsAppConsentCheckArgs): Promise<ProactiveMessageResult> {
  const { clinicId, phone, text, templateId, variables = {} } = args;

  if (!clinicId || clinicId === 'all') {
    return {
      success: false,
      error: 'Mesaj göndermek için bir klinik seçilmelidir.',
      code: OUTBOUND_ERRORS.NO_CONNECTION,
    };
  }

  const consentBlock = await checkWhatsAppConsent(clinicId, args);
  if (consentBlock) return consentBlock;

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
    const candidate = await prisma.messageTemplate.findFirst({
      where: { id: templateId, clinicId, channel: 'whatsapp' },
      select: META_TEMPLATE_SNAPSHOT_SELECT,
    });
    if (candidate && isTemplateUsableForConnection(candidate, connection)) {
      template = candidate;
    }
  }

  return sendProactiveWhatsAppMessageWithConnection(connection, template, { phone, text, variables });
}

// ─── No-show recovery: purpose-based template selection ───────────────────────

export const NO_SHOW_RECOVERY_MISSING_TEMPLATE_ERROR =
  "Gelmeyen hasta takibi için onaylı WhatsApp şablonu bulunamadı. " +
  "Lütfen Mesaj Şablonları sayfasından 'Gelmeyen Hasta Takibi' kullanım amaçlı " +
  "bir WhatsApp şablonu oluşturup onaya gönderin.";

/**
 * Core no-show recovery dispatcher given a pre-resolved connection and template.
 * Exported for unit testing without Prisma dependency.
 *
 * For Meta Cloud: requires an approved template; rejects with META_APPROVED_TEMPLATE_REQUIRED
 * if template is null or not approved. Never falls back to plain sendMessage.
 *
 * For Evolution / legacy: sends plain text via sendMessage; template is ignored.
 */
export async function sendNoShowRecoveryWhatsAppWithConnection(
  connection: WhatsAppConnectionRecord,
  template: MetaTemplateSnapshot | null,
  args: {
    phone: string;
    evolutionPlainText: string;
    variables: Record<string, string>;
  },
): Promise<ProactiveMessageResult> {
  if (connection.provider !== 'meta_cloud_api') {
    const provider = getWhatsAppProvider(connection.provider);
    const result = await provider.sendMessage(connection, {
      phone: args.phone,
      text: args.evolutionPlainText,
    });
    return {
      success: result.success,
      externalMessageId: result.externalMessageId,
      error: result.error,
    };
  }

  if (!template || template.metaTemplateStatus !== 'approved' || !template.metaTemplateName) {
    return {
      success: false,
      code: OUTBOUND_ERRORS.META_APPROVED_TEMPLATE_REQUIRED,
      error: NO_SHOW_RECOVERY_MISSING_TEMPLATE_ERROR,
    };
  }

  return sendProactiveWhatsAppMessageWithConnection(connection, template, {
    phone: args.phone,
    text: args.evolutionPlainText,
    variables: args.variables,
  });
}

/**
 * Send a no-show recovery WhatsApp message for a clinic.
 *
 * For Meta Cloud API clinics:
 *   - Selects the first active MessageTemplate where purpose = 'no_show_recovery',
 *     channel = 'whatsapp', clinicId matches, isActive = true.
 *   - Ordered by createdAt ASC for deterministic selection when multiple exist.
 *   - Requires metaTemplateStatus = 'approved'.
 *   - Uses sendTemplateMessage; never falls back to plain sendMessage.
 *   - Returns META_APPROVED_TEMPLATE_REQUIRED if no approved template exists.
 *
 * For Evolution / legacy clinics: sends plain text via sendMessage.
 *
 * Privacy: phone is not logged; variables contain scheduling context only.
 */
export async function sendNoShowRecoveryWhatsApp(args: {
  clinicId: string;
  phone: string;
  evolutionPlainText: string;
  variables: Record<string, string>;
} & WhatsAppConsentCheckArgs): Promise<ProactiveMessageResult> {
  const { clinicId, phone, evolutionPlainText, variables } = args;

  if (!clinicId || clinicId === 'all') {
    return {
      success: false,
      error: 'Mesaj göndermek için bir klinik seçilmelidir.',
      code: OUTBOUND_ERRORS.NO_CONNECTION,
    };
  }

  const consentBlock = await checkWhatsAppConsent(clinicId, args);
  if (consentBlock) return consentBlock;

  const connection = await resolveConnectionForClinic(clinicId);
  if (!connection) {
    return {
      success: false,
      error: 'Bu klinik için aktif bir WhatsApp bağlantısı bulunamadı.',
      code: OUTBOUND_ERRORS.NO_CONNECTION,
    };
  }

  let template: MetaTemplateSnapshot | null = null;
  if (connection.provider === 'meta_cloud_api') {
    const candidate = await prisma.messageTemplate.findFirst({
      where: {
        clinicId,
        channel: 'whatsapp',
        purpose: 'no_show_recovery',
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
      select: META_TEMPLATE_SNAPSHOT_SELECT,
    });
    if (candidate && isTemplateUsableForConnection(candidate, connection)) {
      template = candidate;
    }
  }

  return sendNoShowRecoveryWhatsAppWithConnection(connection, template, {
    phone,
    evolutionPlainText,
    variables,
  });
}

// ─── Appointment confirmation: purpose-based template selection ───────────────

export const APPOINTMENT_CONFIRMATION_MISSING_TEMPLATE_ERROR =
  "Randevu onayı bildirimi için onaylı WhatsApp şablonu bulunamadı. " +
  "Lütfen Mesaj Şablonları sayfasından 'Randevu Onayı' kullanım amaçlı " +
  "bir WhatsApp şablonu oluşturup onaya gönderin.";

/**
 * Core appointment confirmation dispatcher given a pre-resolved connection and template.
 *
 * For Meta Cloud: requires an approved MessageTemplate (purpose = appointment_confirmation);
 * rejects with META_APPROVED_TEMPLATE_REQUIRED if template is null or not approved.
 *
 * For Evolution / legacy: sends plain text via sendMessage.
 */
export async function sendAppointmentConfirmationWhatsAppWithConnection(
  connection: WhatsAppConnectionRecord,
  template: MetaTemplateSnapshot | null,
  args: {
    phone: string;
    evolutionPlainText: string;
    variables: Record<string, string>;
  },
): Promise<ProactiveMessageResult> {
  if (connection.provider !== 'meta_cloud_api') {
    const provider = getWhatsAppProvider(connection.provider);
    const result = await provider.sendMessage(connection, {
      phone: args.phone,
      text: args.evolutionPlainText,
    });
    return {
      success: result.success,
      externalMessageId: result.externalMessageId,
      error: result.error,
    };
  }

  if (!template || template.metaTemplateStatus !== 'approved' || !template.metaTemplateName) {
    return {
      success: false,
      code: OUTBOUND_ERRORS.META_APPROVED_TEMPLATE_REQUIRED,
      error: APPOINTMENT_CONFIRMATION_MISSING_TEMPLATE_ERROR,
    };
  }

  return sendProactiveWhatsAppMessageWithConnection(connection, template, {
    phone: args.phone,
    text: args.evolutionPlainText,
    variables: args.variables,
  });
}

/**
 * Send an appointment confirmation WhatsApp message for a clinic.
 *
 * For Meta Cloud clinics: selects the first active approved MessageTemplate
 * with purpose = appointment_confirmation. Fails if none found.
 *
 * For Evolution / legacy clinics: sends plain text via sendMessage.
 *
 * connectionId: if provided, uses that specific WhatsApp connection (the original
 * source connection); otherwise resolves the clinic's default connection.
 */
export async function sendAppointmentConfirmationWhatsApp(args: {
  clinicId: string;
  phone: string;
  evolutionPlainText: string;
  variables: Record<string, string>;
  connectionId?: string | null;
} & WhatsAppConsentCheckArgs): Promise<ProactiveMessageResult> {
  const { clinicId, phone, evolutionPlainText, variables, connectionId } = args;

  if (!clinicId || clinicId === 'all') {
    return {
      success: false,
      error: 'Mesaj göndermek için bir klinik seçilmelidir.',
      code: OUTBOUND_ERRORS.NO_CONNECTION,
    };
  }

  const consentBlock = await checkWhatsAppConsent(clinicId, args);
  if (consentBlock) return consentBlock;

  let connection: WhatsAppConnectionRecord | null = null;
  if (connectionId) {
    const raw = await prisma.whatsAppConnection.findFirst({ where: { id: connectionId, isActive: true } });
    connection = raw as WhatsAppConnectionRecord | null;
  }
  if (!connection) {
    connection = await resolveConnectionForClinic(clinicId);
  }
  if (!connection) {
    return {
      success: false,
      error: 'Bu klinik için aktif bir WhatsApp bağlantısı bulunamadı.',
      code: OUTBOUND_ERRORS.NO_CONNECTION,
    };
  }

  let template: MetaTemplateSnapshot | null = null;
  if (connection.provider === 'meta_cloud_api') {
    const candidate = await prisma.messageTemplate.findFirst({
      where: { clinicId, channel: 'whatsapp', purpose: 'appointment_confirmation', isActive: true },
      orderBy: { createdAt: 'asc' },
      select: META_TEMPLATE_SNAPSHOT_SELECT,
    });
    if (candidate && isTemplateUsableForConnection(candidate, connection)) {
      template = candidate;
    }
  }

  return sendAppointmentConfirmationWhatsAppWithConnection(connection, template, {
    phone,
    evolutionPlainText,
    variables,
  });
}

// ─── Post-treatment follow-up: purpose-based template selection ───────────────

export const POST_TREATMENT_MISSING_TEMPLATE_ERROR =
  "Tedavi sonrası takip için onaylı WhatsApp şablonu bulunamadı. " +
  "Lütfen Mesaj Şablonları sayfasından 'Tedavi Sonrası Takip' kullanım amaçlı " +
  "bir WhatsApp şablonu oluşturup onaya gönderin.";

/**
 * Core post-treatment follow-up dispatcher given a pre-resolved connection and template.
 * Exported for unit testing without Prisma dependency.
 *
 * For Meta Cloud: requires an approved MessageTemplate (purpose = post_treatment_followup);
 * rejects with META_APPROVED_TEMPLATE_REQUIRED if template is null or not approved.
 * Never falls back to plain sendMessage for Meta Cloud.
 *
 * For Evolution / legacy: sends plain text via sendMessage; template is ignored.
 */
export async function sendPostTreatmentWhatsAppWithConnection(
  connection: WhatsAppConnectionRecord,
  template: MetaTemplateSnapshot | null,
  args: {
    phone: string;
    evolutionPlainText: string;
    variables: Record<string, string>;
  },
): Promise<ProactiveMessageResult> {
  if (connection.provider !== 'meta_cloud_api') {
    const provider = getWhatsAppProvider(connection.provider);
    const result = await provider.sendMessage(connection, {
      phone: args.phone,
      text: args.evolutionPlainText,
    });
    return {
      success: result.success,
      externalMessageId: result.externalMessageId,
      error: result.error,
    };
  }

  if (!template || template.metaTemplateStatus !== 'approved' || !template.metaTemplateName) {
    return {
      success: false,
      code: OUTBOUND_ERRORS.META_APPROVED_TEMPLATE_REQUIRED,
      error: POST_TREATMENT_MISSING_TEMPLATE_ERROR,
    };
  }

  return sendProactiveWhatsAppMessageWithConnection(connection, template, {
    phone: args.phone,
    text: args.evolutionPlainText,
    variables: args.variables,
  });
}

/**
 * Send a post-treatment follow-up WhatsApp message for a clinic.
 *
 * For Meta Cloud clinics: selects the first active approved MessageTemplate
 * with purpose = post_treatment_followup (ordered by createdAt asc for determinism).
 * Fails with META_APPROVED_TEMPLATE_REQUIRED if none found.
 *
 * For Evolution / legacy clinics: sends plain text via sendMessage.
 */
export async function sendPostTreatmentWhatsApp(args: {
  clinicId: string;
  phone: string;
  evolutionPlainText: string;
  variables: Record<string, string>;
} & WhatsAppConsentCheckArgs): Promise<ProactiveMessageResult> {
  const { clinicId, phone, evolutionPlainText, variables } = args;

  if (!clinicId || clinicId === 'all') {
    return {
      success: false,
      error: 'Mesaj göndermek için bir klinik seçilmelidir.',
      code: OUTBOUND_ERRORS.NO_CONNECTION,
    };
  }

  const consentBlock = await checkWhatsAppConsent(clinicId, args);
  if (consentBlock) return consentBlock;

  const connection = await resolveConnectionForClinic(clinicId);
  if (!connection) {
    return {
      success: false,
      error: 'Bu klinik için aktif bir WhatsApp bağlantısı bulunamadı.',
      code: OUTBOUND_ERRORS.NO_CONNECTION,
    };
  }

  let template: MetaTemplateSnapshot | null = null;
  if (connection.provider === 'meta_cloud_api') {
    const candidate = await prisma.messageTemplate.findFirst({
      where: {
        clinicId,
        channel: 'whatsapp',
        purpose: 'post_treatment_followup',
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
      select: META_TEMPLATE_SNAPSHOT_SELECT,
    });
    if (candidate && isTemplateUsableForConnection(candidate, connection)) {
      template = candidate;
    }
  }

  return sendPostTreatmentWhatsAppWithConnection(connection, template, {
    phone,
    evolutionPlainText,
    variables,
  });
}
