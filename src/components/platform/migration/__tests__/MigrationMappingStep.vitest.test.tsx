/**
 * MigrationMappingStep.vitest.test.tsx — F3-DATA-MIG-TODAY-001-FINAL-R7
 *
 * The mapping screen shipped without ever rendering the operator's OWN
 * workbook header: `GET /migrations/runs/:id/mappings` echoed raw persisted
 * rows, which carry no `sourceLabel`, so the primary identity line rendered
 * empty and "Excel sütunu: 43 / AQ" was the only thing left on screen. R7
 * makes the server send the authoritative `sourceHeader`/`sourceLabel` and
 * makes this screen consume them.
 *
 * These tests pin the operator-facing outcome:
 *  - a named column shows its real header, prominently, plus the single
 *    coordinate convention `AQ (43)` — and never the technical `COLUMN_<n>`;
 *  - a headerless column says so in words, and still never shows `COLUMN_<n>`;
 *  - the sparse sample list keeps its true source row number (PART 13 C);
 *  - a validation issue is a real navigation control: clicking it reveals a
 *    row that the active filter was hiding, scrolls to it, and changes NO
 *    mapping state (no save call).
 *
 * Mocking follows the sibling MigrationDryRunStep.vitest.test.tsx, with one
 * difference: `t` resolves against the REAL tr/platform.json and interpolates
 * `{{...}}`, because half of what is under test here is the rendered text
 * (`Excel sütunu: AQ (43)`), not a key name.
 *
 * All fixture data is SYNTHETIC. No real patient values, no realistic
 * identity/phone/e-mail data; sample cell values are placeholders only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import MigrationMappingStep from '../MigrationMappingStep';
import trPlatform from '../../../../locales/tr/platform.json';
import type {
  DestinationFieldDto,
  MappingDto,
  MappingValidationDto,
  MappingsResponse,
  MigrationAnalysisDto,
  MigrationRunDto,
  SourceColumnProfileDto,
} from '../../../../services/platformMigrationApi';

// ── i18n: resolve real Turkish strings, and interpolate ──────────────────────

/**
 * Walks the locale tree. Keys such as `destinationLabels.patient.notes`
 * contain dots inside a single key, so each level tries progressively longer
 * prefixes rather than blindly splitting on '.'.
 */
function lookup(node: unknown, path: string): string | undefined {
  if (node == null) return undefined;
  if (typeof node === 'string') return path === '' ? node : undefined;
  if (typeof node !== 'object') return undefined;
  const parts = path.split('.');
  for (let i = 1; i <= parts.length; i++) {
    const head = parts.slice(0, i).join('.');
    if (!Object.prototype.hasOwnProperty.call(node, head)) continue;
    const next = (node as Record<string, unknown>)[head];
    const rest = parts.slice(i).join('.');
    if (rest === '') {
      if (typeof next === 'string') return next;
      continue;
    }
    const found = lookup(next, rest);
    if (found !== undefined) return found;
  }
  return undefined;
}

const mockT = (key: string, options?: Record<string, unknown>): string => {
  const bare = key.replace(/^platform:/, '');
  const resolved =
    lookup(trPlatform as unknown, bare) ??
    (typeof options?.defaultValue === 'string' ? (options.defaultValue as string) : key);
  return resolved.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    options && options[name] !== undefined ? String(options[name]) : whole,
  );
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT, i18n: { language: 'tr' } }),
}));

// ── Synthetic fixtures ───────────────────────────────────────────────────────

const RUN: MigrationRunDto = {
  id: 'run-r7-1',
  status: 'MAPPING_REQUIRED',
  organizationId: 'org-1',
  clinicId: 'clinic-1',
  sheetIndex: 0,
};

/** Column AQ (index 42) — a real, named vendor header. */
const NAMED: MappingDto = {
  sourceField: 'EK_ACIKLAMA',
  sourceHeader: 'EK_ACIKLAMA',
  sourceLabel: 'EK_ACIKLAMA',
  sourceIndex: 42,
  sourceNormalized: 'EKACIKLAMA',
  destinationField: null,
  destinationLabel: null,
  transform: null,
  composeOrder: null,
  confidence: 0,
  reason: 'UNKNOWN_HEADER',
  state: 'MANUAL_REQUIRED',
};

/** Column H (index 7) — the workbook's header cell was blank. */
const HEADERLESS: MappingDto = {
  ...NAMED,
  sourceField: 'COLUMN_7',
  sourceHeader: null,
  sourceLabel: 'COLUMN_7',
  sourceIndex: 7,
  sourceNormalized: 'COLUMN7',
};

/** A legally gated column, used to filter the others off screen. */
const LEGAL: MappingDto = {
  ...NAMED,
  sourceField: 'ORNEK_YASAL',
  sourceHeader: 'ORNEK_YASAL',
  sourceLabel: 'ORNEK_YASAL',
  sourceIndex: 3,
  sourceNormalized: 'ORNEKYASAL',
  reason: 'LEGAL_GATE',
  state: 'LEGAL_BLOCKED',
  policyNote: 'Synthetic policy note.',
};

const DESTINATIONS: DestinationFieldDto[] = [
  {
    key: 'patient.notes',
    label: 'Clinical note',
    group: 'clinical',
    type: 'string',
    required: false,
    allowedTransforms: ['compose_notes', 'trim'],
    allowsComposition: true,
  },
  {
    key: 'patient.firstName',
    label: 'First name',
    group: 'name',
    type: 'string',
    required: true,
    allowedTransforms: ['trim'],
    allowsComposition: false,
  },
];

const VALIDATION: MappingValidationDto = {
  valid: false,
  issues: [
    {
      code: 'MAPPING_REQUIRED',
      message: 'Bu sütun için hâlâ bir eşleme kararı gerekiyor.',
      sourceField: 'EK_ACIKLAMA',
    },
    { code: 'MAPPING_INVALID', message: 'Genel bir sorun (sütunu yok).' },
  ],
  unresolvedCount: 2,
  blockedCount: 0,
  legalBlockedCount: 1,
  ignoredCount: 0,
  mappedCount: 0,
  sensitiveReviewCount: 0,
};

function profile(index: number, filledCount: number): SourceColumnProfileDto {
  return {
    index,
    header: `col-${index}`,
    filledCount,
    totalRows: 10,
    fillRate: filledCount / 10,
    distinctCount: filledCount,
    typeCounts: { empty: 10 - filledCount, string: filledCount, number: 0, date: 0, boolean: 0, error: 0 },
    maxLength: 12,
  };
}

const ANALYSIS: MigrationAnalysisDto = {
  sheetName: 'Sheet1',
  sheetIndex: 0,
  sheets: [{ name: 'Sheet1', index: 0, hidden: false, rowCount: 10, columnCount: 43 }],
  totalSourceRows: 10,
  headerColumnCount: 43,
  format: 'xlsx',
  warnings: [],
  headers: [],
  profiles: [profile(42, 5), profile(7, 2), profile(3, 1)],
  // PART 13 C: the first MEANINGFUL value lives far down the sheet — the row
  // number an operator would search for must survive verbatim.
  columnPreviews: [
    { index: 42, samples: [{ rowNumber: 14889, value: 'ORNEK-***' }] },
    { index: 7, samples: [] },
    { index: 3, samples: [] },
  ],
};

function makeApi(mappings: MappingDto[] = [NAMED, HEADERLESS, LEGAL]) {
  const mappingsResponse: MappingsResponse = {
    mappings,
    destinations: DESTINATIONS,
    validation: VALIDATION,
  };
  return {
    getMappings: vi.fn().mockResolvedValue(mappingsResponse),
    analyze: vi.fn().mockResolvedValue({ run: RUN, analysis: ANALYSIS }),
    saveMappings: vi.fn().mockResolvedValue({ mappings, validation: VALIDATION }),
    acceptAutoMappings: vi.fn().mockResolvedValue({ mappings, validation: VALIDATION, accepted: 0 }),
    validateMappings: vi.fn().mockResolvedValue(VALIDATION),
    getRun: vi.fn().mockResolvedValue({ run: RUN, reconciliation: null, dryRun: null }),
  } as unknown as import('../../../../services/platformMigrationApi').MigrationApiClient & {
    saveMappings: ReturnType<typeof vi.fn>;
    acceptAutoMappings: ReturnType<typeof vi.fn>;
  };
}

const noop = () => undefined;

function renderStep(api: ReturnType<typeof makeApi>) {
  return render(
    <MigrationMappingStep run={RUN} api={api} onRunUpdated={noop} onNext={noop} nextStep={5} onBack={noop} />,
  );
}

describe('MigrationMappingStep — source column identity (R7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sanity: the mocked t resolves real tr keys and interpolates placeholders', () => {
    expect(mockT('platform:migration.mapping.headerless')).toBe('Başlık yok');
    expect(mockT('platform:migration.mapping.excelColumn', { letter: 'AQ', n: 43 })).toBe(
      'Excel sütunu: AQ (43)',
    );
    expect(mockT('platform:migration.mapping.destinationLabels.patient.notes', { defaultValue: 'x' })).toBe(
      'Klinik Not / Önemli Not',
    );
    expect(mockT('platform:migration.mapping.filters.unmappedWithData')).toBe('Verisi olan eşleşmemişler');
  });

  it('A. a named column renders its ORIGINAL header as the prominent primary line, with "AQ (43)" beneath it', async () => {
    const api = makeApi();
    renderStep(api);

    const header = await screen.findByText('EK_ACIKLAMA');
    expect(header.tagName).toBe('P');
    // The header must visually dominate the coordinate (was text-xs).
    expect(header.className).toContain('text-sm');
    expect(header.className).toContain('font-semibold');
    // The technical name stays available for support, as a tooltip only.
    expect(header).toHaveAttribute('title', 'EK_ACIKLAMA');

    expect(screen.getByText('Excel sütunu: AQ (43)')).toBeInTheDocument();
    // The old two-way convention must be gone.
    expect(screen.queryByText(/Excel sütunu: 43 \/ AQ/)).not.toBeInTheDocument();
    // A synthesized name must never be rendered as if it were a real header.
    expect(screen.queryByText(/COLUMN_42/)).not.toBeInTheDocument();
  });

  it('B. a headerless column says "Başlık yok" and never shows COLUMN_<n> as text', async () => {
    const api = makeApi();
    renderStep(api);

    const blank = await screen.findByText('Başlık yok');
    expect(blank.tagName).toBe('P');
    expect(blank.className).toContain('italic');
    expect(screen.getByText('Excel sütunu: H (8)')).toBeInTheDocument();

    expect(screen.queryByText(/COLUMN_7/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sütun 8/)).not.toBeInTheDocument();
  });

  it('C. a sparse sample keeps its true source row number', async () => {
    const api = makeApi();
    renderStep(api);

    expect(await screen.findByText('Satır 14889: ORNEK-***')).toBeInTheDocument();
  });

  it('D. clicking a validation issue reveals a row the active filter had hidden, scrolls to it, and saves nothing', async () => {
    const user = userEvent.setup();
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    const api = makeApi();
    renderStep(api);

    await screen.findByText('EK_ACIKLAMA');

    // Filter the target column off screen.
    await user.click(screen.getByRole('button', { name: 'Sadece yasal engelliler' }));
    await waitFor(() => expect(screen.queryByText('EK_ACIKLAMA')).not.toBeInTheDocument());
    expect(scrollSpy).not.toHaveBeenCalled();

    // The issue that names a column is a real, keyboard-reachable button.
    const jump = screen.getByRole('button', { name: /Bu sütuna git/ });
    expect(jump).toHaveAttribute('type', 'button');
    await user.click(jump);

    // The row is back, was scrolled into view and is marked as the target.
    const header = await screen.findByText('EK_ACIKLAMA');
    expect(scrollSpy).toHaveBeenCalled();
    const row = header.closest('tr')!;
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(row.className).toContain('ring-2');

    // NAVIGATION ONLY: no mapping was written, no bulk call fired.
    expect(api.saveMappings).not.toHaveBeenCalled();
    expect(api.acceptAutoMappings).not.toHaveBeenCalled();

    // An issue with no sourceField has nowhere to go and stays plain text.
    expect(screen.queryByRole('button', { name: /Genel bir sorun/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Genel bir sorun/)).toBeInTheDocument();
  });
});
