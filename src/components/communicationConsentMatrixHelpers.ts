/**
 * communicationConsentMatrixHelpers.ts — Pure helpers for the KVKK-HIGH-007
 * Communication Preferences matrix UI (CommunicationPreferencesPanel.tsx).
 *
 * Technical control only — this module contains no legal conclusions. The
 * channel/purpose/status vocabulary mirrors
 * server/src/services/communicationConsent/taxonomy.ts exactly; keep both
 * lists in sync if either changes.
 */

export const COMMUNICATION_CHANNELS = ['sms', 'email', 'whatsapp', 'phone_call', 'push'] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export const COMMUNICATION_PURPOSES = [
  'transactional',
  'appointment_reminder',
  'appointment_followup',
  'clinical_followup',
  'recall',
  'no_show_recovery',
  'operational',
  'marketing',
  'campaign',
  'survey',
  'legal_notice',
  'security_notice',
] as const;
export type CommunicationPurpose = (typeof COMMUNICATION_PURPOSES)[number];

export const POLICY_EXCEPTION_PURPOSES: readonly CommunicationPurpose[] = [
  'transactional',
  'legal_notice',
  'security_notice',
];

export const COMMUNICATION_PREFERENCE_STATUSES = ['granted', 'denied', 'withdrawn', 'unknown', 'not_required'] as const;
export type CommunicationPreferenceStatus = (typeof COMMUNICATION_PREFERENCE_STATUSES)[number];

export type MatrixCellVariant = 'allowed' | 'denied' | 'withdrawn' | 'unknown' | 'not_required';

export type MatrixPreference = {
  id: string;
  status: CommunicationPreferenceStatus;
  effectiveAt: string;
  grantedAt: string | null;
  withdrawnAt: string | null;
  source: string;
  evidenceType: string | null;
  noticeVersion: string | null;
  actorUserId: string | null;
  actorPlatformAdminId: string | null;
  updatedAt: string;
};

export type LegacyConflict = { detected: true; reasonCode: 'legacy_central_conflict' } | null;

export type MatrixEntry = {
  channel: string;
  purpose: string;
  isPolicyException: boolean;
  decision: { allowed: boolean; reasonCode: string };
  preference: MatrixPreference | null;
  /** KVKK-HIGH-007 reconciliation: a stale legacy restrictive signal (e.g. smsOptOut) disagreeing with an explicit central grant. Always read-only ground truth, never gated by rollout flags. */
  legacyConflict?: LegacyConflict;
};

export type MatrixCellVariantWithConflict = MatrixCellVariant | 'conflict';

/**
 * Never infers "allowed" visually from anything but an explicit granted/not_required row — unknown always renders as unknown, never as a default allow.
 * The `conflict` variant is checked FIRST and is never merged visually with denied/withdrawn/unknown/granted — a legacy/central disagreement is its own distinct, actionable state ("manual review required"), not a garden-variety status.
 */
export function resolveCellVariant(entry: Pick<MatrixEntry, 'isPolicyException' | 'preference' | 'legacyConflict'>): MatrixCellVariantWithConflict {
  if (entry.legacyConflict?.detected) return 'conflict';
  if (entry.isPolicyException) return 'not_required';
  const status = entry.preference?.status ?? 'unknown';
  switch (status) {
    case 'granted':
      return 'allowed';
    case 'denied':
      return 'denied';
    case 'withdrawn':
      return 'withdrawn';
    case 'not_required':
      return 'not_required';
    case 'unknown':
    default:
      return 'unknown';
  }
}

export const CELL_VARIANT_STYLE: Record<MatrixCellVariantWithConflict, { badgeClass: string; dotClass: string }> = {
  allowed: { badgeClass: 'bg-green-50 text-green-700 border-green-200', dotClass: 'bg-green-500' },
  denied: { badgeClass: 'bg-red-50 text-red-700 border-red-200', dotClass: 'bg-red-500' },
  withdrawn: { badgeClass: 'bg-amber-50 text-amber-700 border-amber-200', dotClass: 'bg-amber-500' },
  unknown: { badgeClass: 'bg-gray-100 text-gray-500 border-gray-200', dotClass: 'bg-gray-400' },
  not_required: { badgeClass: 'bg-blue-50 text-blue-600 border-blue-200', dotClass: 'bg-blue-400' },
  conflict: { badgeClass: 'bg-orange-50 text-orange-700 border-orange-300', dotClass: 'bg-orange-500' },
};

/** The 6 required purpose categories (KVKK-HIGH-007 UX redesign) — grouping the 12 purposes so staff scan by meaning, not a flat list. */
export const PURPOSE_GROUPS = [
  { key: 'essential', purposes: ['transactional', 'operational', 'legal_notice', 'security_notice'] as const },
  { key: 'appointment', purposes: ['appointment_reminder', 'appointment_followup'] as const },
  { key: 'treatmentFollowup', purposes: ['clinical_followup'] as const },
  { key: 'recall', purposes: ['recall', 'no_show_recovery'] as const },
  { key: 'marketing', purposes: ['marketing', 'campaign'] as const },
  { key: 'survey', purposes: ['survey'] as const },
] as const;
export type PurposeGroupKey = (typeof PURPOSE_GROUPS)[number]['key'];

export type ConsentSummary = {
  allowed: number;
  deniedOrWithdrawn: number;
  unknown: number;
  notRequired: number;
  conflict: number;
};

/** Data source for the panel's top summary bar — the one authoritative count staff need without reading the whole matrix. */
export function computeConsentSummary(matrix: MatrixEntry[]): ConsentSummary {
  const summary: ConsentSummary = { allowed: 0, deniedOrWithdrawn: 0, unknown: 0, notRequired: 0, conflict: 0 };
  for (const entry of matrix) {
    const variant = resolveCellVariant(entry);
    switch (variant) {
      case 'conflict':
        summary.conflict += 1;
        break;
      case 'allowed':
        summary.allowed += 1;
        break;
      case 'denied':
      case 'withdrawn':
        summary.deniedOrWithdrawn += 1;
        break;
      case 'not_required':
        summary.notRequired += 1;
        break;
      case 'unknown':
      default:
        summary.unknown += 1;
        break;
    }
  }
  return summary;
}

export function matrixKey(channel: string, purpose: string): string {
  return `${channel}:${purpose}`;
}

/** O(1) lookup index built once per matrix API response. */
export function buildMatrixIndex(matrix: MatrixEntry[]): Map<string, MatrixEntry> {
  return new Map(matrix.map((entry) => [matrixKey(entry.channel, entry.purpose), entry]));
}

/** Legacy signal disclosure only ever renders for canManage roles when data is present — never a second "current state" surface for anyone else, never an empty section. */
export function shouldShowLegacySignals(canManage: boolean, legacySignals: unknown): boolean {
  return canManage && legacySignals != null;
}

/** Not-required (policy-exception) cells stay non-actionable regardless of role — a manage control must never appear on them, only on genuinely actionable cells. */
export function isCellActionable(canManage: boolean, entry: Pick<MatrixEntry, 'isPolicyException'>): boolean {
  return canManage && !entry.isPolicyException;
}

// ── Consent-action modal validation — single source of truth ─────────────────
//
// KVKK-HIGH-008 UX fix. Mirrors the backend notice-version/evidence matrix in
// communicationConsentAdmin.ts (DIGITAL_GRANT_SOURCES / the `source === 'staff'`
// check) — client-side hints only, the server remains authoritative. Every
// consumer (submit-eligibility, inline field errors, the modal-level summary,
// and focus-first-invalid) reads from this ONE function so the "is this valid"
// answer can never diverge between what's displayed and what's enforced.
//
// Important, previously-mis-stated distinction: the notes requirement is keyed
// on `source === 'staff'` (a grant recorded by staff on the patient's behalf),
// NOT on the selected `evidenceType`. They default together in the UI
// (evidenceType defaults to 'verbal_staff_record', source defaults to
// 'staff'), which is why the underlying bug reads as "picking that evidence
// type requires notes" — but changing evidenceType alone while leaving source
// at 'staff' still requires notes, and changing source away from 'staff'
// while leaving evidenceType at 'verbal_staff_record' does not.
export const DIGITAL_GRANT_SOURCES = ['patient_portal', 'public_booking', 'whatsapp', 'sms_keyword', 'email_unsubscribe'];

export type ConsentActionValidationField = 'noticeVersion' | 'notes';

export type ConsentActionValidationState = {
  action: 'grant' | 'deny' | 'withdraw' | 'reset' | null;
  source: string;
  noticeVersion: string;
  notes: string;
};

export type ConsentActionValidationResult = {
  noticeVersionRequired: boolean;
  notesRequired: boolean;
  /** Fields currently failing their requirement, in field (top-to-bottom) order. */
  invalidFields: ConsentActionValidationField[];
  firstInvalidField: ConsentActionValidationField | null;
  /** True only when an action is selected and no required field is empty. */
  canSubmit: boolean;
};

export function computeConsentActionValidation(state: ConsentActionValidationState): ConsentActionValidationResult {
  const isGrant = state.action === 'grant';
  const noticeVersionRequired = isGrant && DIGITAL_GRANT_SOURCES.includes(state.source);
  const notesRequired = isGrant && state.source === 'staff';

  const invalidFields: ConsentActionValidationField[] = [];
  if (noticeVersionRequired && !state.noticeVersion.trim()) invalidFields.push('noticeVersion');
  if (notesRequired && !state.notes.trim()) invalidFields.push('notes');

  return {
    noticeVersionRequired,
    notesRequired,
    invalidFields,
    firstInvalidField: invalidFields[0] ?? null,
    canSubmit: state.action != null && invalidFields.length === 0,
  };
}

export type BulkSelectionItem = { channel: string; purpose: string; action: 'grant' | 'deny' | 'withdraw' | 'reset' };

/**
 * Guards against an accidental one-click "grant everything for every
 * channel" action: a bulk grant must name each channel/purpose pair
 * explicitly (no wildcard/select-all-channels shortcut that defaults to
 * grant) and must not exceed the API's per-request item cap.
 */
export function validateBulkSelection(items: BulkSelectionItem[]): { ok: true } | { ok: false; reason: string } {
  if (items.length === 0) return { ok: false, reason: 'empty' };
  if (items.length > 50) return { ok: false, reason: 'too_many' };
  const seen = new Set<string>();
  for (const item of items) {
    const key = matrixKey(item.channel, item.purpose);
    if (seen.has(key)) return { ok: false, reason: 'duplicate' };
    seen.add(key);
  }
  return { ok: true };
}
