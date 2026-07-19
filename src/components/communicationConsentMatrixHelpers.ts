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

export type MatrixEntry = {
  channel: string;
  purpose: string;
  isPolicyException: boolean;
  decision: { allowed: boolean; reasonCode: string };
  preference: MatrixPreference | null;
};

/** Never infers "allowed" visually from anything but an explicit granted/not_required row — unknown always renders as unknown, never as a default allow. */
export function resolveCellVariant(entry: Pick<MatrixEntry, 'isPolicyException' | 'preference'>): MatrixCellVariant {
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

export const CELL_VARIANT_STYLE: Record<MatrixCellVariant, { badgeClass: string; dotClass: string }> = {
  allowed: { badgeClass: 'bg-green-50 text-green-700 border-green-200', dotClass: 'bg-green-500' },
  denied: { badgeClass: 'bg-red-50 text-red-700 border-red-200', dotClass: 'bg-red-500' },
  withdrawn: { badgeClass: 'bg-amber-50 text-amber-700 border-amber-200', dotClass: 'bg-amber-500' },
  unknown: { badgeClass: 'bg-gray-100 text-gray-500 border-gray-200', dotClass: 'bg-gray-400' },
  not_required: { badgeClass: 'bg-blue-50 text-blue-600 border-blue-200', dotClass: 'bg-blue-400' },
};

export function matrixKey(channel: string, purpose: string): string {
  return `${channel}:${purpose}`;
}

/** O(1) lookup index built once per matrix API response. */
export function buildMatrixIndex(matrix: MatrixEntry[]): Map<string, MatrixEntry> {
  return new Map(matrix.map((entry) => [matrixKey(entry.channel, entry.purpose), entry]));
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
