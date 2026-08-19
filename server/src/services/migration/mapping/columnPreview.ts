/**
 * columnPreview.ts — F3-DATA-MIG-TODAY-001-UI-002
 *
 * Sanitized, per-column SAMPLE VALUE previews for the mapping screen, so a
 * Platform Admin operator can visually verify "source column -> sample
 * values -> NoraMedi target" before approving a mapping — the judgment call
 * `SourceColumnProfile` (canonicalParser.ts) deliberately refuses to support
 * ("safe: counts only, never sample values"). This module is the one
 * deliberate, policy-gated exception to that rule: every value it returns
 * has already been classified and masked HERE, server-side, before it ever
 * reaches the client. The mapping DTO layer's "nothing here carries
 * PII/PHI" invariant (platformMigrationApi.ts) holds only because of this.
 *
 * Never log, persist, cache across runs/tenants, or otherwise let a sample
 * value escape the single HTTP response it was computed for.
 */

import type { CanonicalHeader, CanonicalRow, DestinationValueType, MappingState } from '../contracts.js';
import { normalizeHeader } from './normalizeHeader.js';

/** First N data rows only — "representative", not exhaustive, and bounded
 * regardless of workbook size (14,890 rows in the real first-customer file). */
const MAX_SAMPLES_PER_COLUMN = 3;

/** Low-risk values are still capped, so one oversized cell can't blow up the response. */
const LOW_RISK_MAX_CHARS = 60;

/** A column with no keyword match but very long values is treated as free text anyway. */
const FREETEXT_LENGTH_HINT = 80;

const BLANK_LABEL = 'boş';
const HIDDEN_FREETEXT_LABEL = '[Hassas içerik — önizleme gizlendi]';
const HIDDEN_ADDRESS_LABEL = '[Adres içeriği — önizleme gizlendi]';
/**
 * Distinct from HIDDEN_FREETEXT_LABEL on purpose: this is not a heuristic
 * guess about content shape, it is a decided legal/policy exclusion
 * (mapping state LEGAL_BLOCKED — see validateMapping.ts's
 * NON_WRITING_DECIDED_STATES). A reviewer reading the label should be able
 * to tell "we masked this because it looks sensitive" apart from "this
 * column is under a KVKK Art. 6 legal hold and is never written".
 */
const HIDDEN_LEGAL_BLOCKED_LABEL = '[KVKK Madde 6 — hukuki gerekçeyle gizlendi]';

export type ColumnSensitivity = 'tckn' | 'phone' | 'email' | 'address' | 'freetext' | 'low' | 'legalBlocked';

export interface ColumnPreview {
  index: number;
  samples: string[];
}

/**
 * Header-keyword + profile-shape classifier. Deliberately biased toward
 * over-masking: an unrecognized header whose values LOOK like free text
 * (long strings) is hidden, not guessed safe. Matched against the
 * vendor-neutral `normalizeHeader` form, so it degrades safely for a header
 * this program has never seen before — not just the first customer's 91
 * named columns (see firstCustomerMatrix.ts, which this module intentionally
 * does NOT depend on: sample masking must hold for every future source,
 * not only the one profile already reviewed).
 *
 * `mappingState` is checked FIRST and short-circuits every other signal: a
 * column the mapping layer has already decided is LEGAL_BLOCKED (a policy
 * decision, not a guess) must never be un-hidden by a destination type, a
 * header keyword miss, or a short value — fail closed, not "usually safe".
 */
export function classifyColumnSensitivity(
  headerOriginal: string,
  destinationType: DestinationValueType | undefined,
  maxLength: number,
  mappingState?: MappingState,
): ColumnSensitivity {
  if (mappingState === 'LEGAL_BLOCKED') return 'legalBlocked';
  if (destinationType === 'identity') return 'tckn';
  if (destinationType === 'phone') return 'phone';
  if (destinationType === 'email') return 'email';

  const h = normalizeHeader(headerOriginal);
  if (h.includes('TCKN') || h.includes('TC_NO') || h.includes('TCNO') || h.includes('KIMLIK')) return 'tckn';
  if (h.includes('TELEFON') || h.includes('GSM') || h.includes('CEP') || /(^|_)TEL(_|$)/.test(h)) return 'phone';
  if (h.includes('EMAIL') || h.includes('EPOSTA') || h.includes('MAIL')) return 'email';
  if (h.includes('ADRES') || h.includes('ADDRESS') || h.includes('MAHALLE')) return 'address';
  if (
    h.includes('NOT') ||
    h.includes('ACIKLAMA') ||
    h.includes('KLINIK') ||
    h.includes('TANI') ||
    h.includes('ALERJI') ||
    h.includes('HASTALIK') ||
    h.includes('RAPOR')
  ) {
    return 'freetext';
  }
  if (maxLength > FREETEXT_LENGTH_HINT) return 'freetext';
  return 'low';
}

function maskDigitsKeepLast(digits: string, keep: number): string {
  if (digits.length <= keep) return '*'.repeat(digits.length);
  return '*'.repeat(digits.length - keep) + digits.slice(-keep);
}

function maskTckn(text: string): string {
  const digits = text.replace(/\D/g, '');
  if (digits === '') return BLANK_LABEL;
  if (digits.length < 4) return maskDigitsKeepLast(digits, digits.length);
  return `*******${digits.slice(-4)}`;
}

function maskPhone(text: string): string {
  const digits = text.replace(/\D/g, '');
  if (digits === '') return BLANK_LABEL;
  return maskDigitsKeepLast(digits, Math.min(4, digits.length));
}

function maskEmail(text: string): string {
  const at = text.indexOf('@');
  if (at <= 0) return HIDDEN_FREETEXT_LABEL; // not shaped like an e-mail; treat as opaque sensitive text
  const local = text.slice(0, at);
  const domain = text.slice(at + 1).trim();
  return `${local[0]}***@${domain || '***'}`;
}

function formatSample(text: string, sensitivity: ColumnSensitivity): string {
  const trimmed = text.trim();
  if (trimmed === '') return BLANK_LABEL;
  switch (sensitivity) {
    case 'tckn':
      return maskTckn(trimmed);
    case 'phone':
      return maskPhone(trimmed);
    case 'email':
      return maskEmail(trimmed);
    case 'address':
      return HIDDEN_ADDRESS_LABEL;
    case 'freetext':
      return HIDDEN_FREETEXT_LABEL;
    case 'legalBlocked':
      return HIDDEN_LEGAL_BLOCKED_LABEL;
    case 'low':
    default:
      return trimmed.length > LOW_RISK_MAX_CHARS ? `${trimmed.slice(0, LOW_RISK_MAX_CHARS)}…` : trimmed;
  }
}

/**
 * Build one sanitized preview per header: the first `MAX_SAMPLES_PER_COLUMN`
 * data rows, masked according to the column's classified sensitivity. Blank
 * cells are shown as "boş" — sequential (not "first N non-empty") is
 * deliberate: a column's blank rate is itself something the operator should
 * see in the preview, not something the preview hides.
 */
export function buildColumnPreviews(
  headers: readonly CanonicalHeader[],
  rows: readonly CanonicalRow[],
  destinationTypeByIndex: ReadonlyMap<number, DestinationValueType | undefined>,
  maxLengthByIndex: ReadonlyMap<number, number>,
  mappingStateByIndex: ReadonlyMap<number, MappingState | undefined> = new Map(),
): ColumnPreview[] {
  const sampleRows = rows.slice(0, MAX_SAMPLES_PER_COLUMN);

  return headers.map((header) => {
    const sensitivity = classifyColumnSensitivity(
      header.original,
      destinationTypeByIndex.get(header.index),
      maxLengthByIndex.get(header.index) ?? 0,
      mappingStateByIndex.get(header.index),
    );
    const samples = sampleRows.map((row) => {
      const cell = row.cells[header.index];
      return formatSample(cell?.text ?? '', sensitivity);
    });
    return { index: header.index, samples };
  });
}
