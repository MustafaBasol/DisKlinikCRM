/**
 * templateBinding.ts — WABA/connection binding checks for WhatsApp MessageTemplates.
 *
 * A MessageTemplate submitted to Meta stores a snapshot of the connection/WABA it
 * was submitted against (metaTemplateConnectionId, metaWabaIdSnapshot). If a clinic
 * later switches to a different WhatsApp connection or WABA, a previously-approved
 * template must not be silently trusted for the new one.
 */

export type TemplateBindingStatus = 'matched' | 'unbound' | 'mismatched';

export type TemplateBindingSnapshot = {
  metaTemplateConnectionId?: string | null;
  metaWabaIdSnapshot?: string | null;
};

export type ConnectionBindingInfo = {
  id: string;
  metaWabaId?: string | null;
};

/**
 * Compare a template's stored connection/WABA snapshot against a connection.
 *
 * - 'unbound'    — template has no stored binding (legacy, or never submitted).
 * - 'matched'    — stored binding matches the given connection's id and WABA.
 * - 'mismatched' — stored binding points to a different connection/WABA.
 */
export function evaluateTemplateBinding(
  template: TemplateBindingSnapshot,
  connection: ConnectionBindingInfo,
): TemplateBindingStatus {
  if (!template.metaTemplateConnectionId || !template.metaWabaIdSnapshot) {
    return 'unbound';
  }
  if (
    template.metaTemplateConnectionId === connection.id &&
    template.metaWabaIdSnapshot === connection.metaWabaId
  ) {
    return 'matched';
  }
  return 'mismatched';
}
