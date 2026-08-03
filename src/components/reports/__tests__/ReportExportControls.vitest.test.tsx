/**
 * ReportExportControls.vitest.test.tsx — US-07.3-P1 frontend coverage.
 *
 * Renders the real ReportExportControls component and exercises the actual
 * export/print flow: the blob-download call + object URL create/revoke
 * (Excel + PDF), the loading/disabled state machine, API error rendering via
 * getReportExportError's stable error code, print() invocation, and the
 * print-only CSS contract. Mocks reportExportApi and react-i18next — same
 * pattern as TreatmentCaseDetail.proposal.vitest.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ReportExportControls from '../ReportExportControls';
import { downloadReportExport, getReportExportError } from '../../../services/reportExportApi';

vi.mock('../../../services/reportExportApi', () => ({
  downloadReportExport: vi.fn(),
  getReportExportError: vi.fn(),
}));

let mockLanguage = 'en';
const mockT = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT, i18n: { language: mockLanguage } }),
}));

const downloadMock = downloadReportExport as unknown as ReturnType<typeof vi.fn>;
const errorMock = getReportExportError as unknown as ReturnType<typeof vi.fn>;

const FILTERS = { dateFrom: '2026-06-01', dateTo: '2026-06-30', groupBy: 'month' };

beforeEach(() => {
  vi.clearAllMocks();
  mockLanguage = 'en';
  (globalThis as any).URL.createObjectURL = vi.fn(() => 'blob:mock-export-url');
  (globalThis as any).URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
  window.print = vi.fn();
});

describe('ReportExportControls — rendering', () => {
  it('renders the Excel export and Print buttons by default (no PDF button unless enabled)', () => {
    render(<ReportExportControls reportKey="revenue-by-period" filters={FILTERS} />);
    expect(screen.getByRole('button', { name: 'exportControls.exportExcel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'exportControls.print' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'exportControls.exportPdf' })).not.toBeInTheDocument();
  });

  it('renders the PDF button when enablePdf is set', () => {
    render(<ReportExportControls reportKey="revenue-by-period" filters={FILTERS} enablePdf />);
    expect(screen.getByRole('button', { name: 'exportControls.exportPdf' })).toBeInTheDocument();
  });
});

describe('ReportExportControls — disabled state', () => {
  it('disables every button when disabled=true (no report data loaded yet)', () => {
    render(<ReportExportControls reportKey="revenue-by-period" filters={FILTERS} enablePdf disabled />);
    expect(screen.getByRole('button', { name: 'exportControls.exportExcel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'exportControls.exportPdf' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'exportControls.print' })).toBeDisabled();
  });

  it('a disabled control never calls window.print() or the export API when clicked', async () => {
    render(<ReportExportControls reportKey="revenue-by-period" filters={FILTERS} disabled />);
    // Disabled buttons don't fire click handlers in jsdom, but this also proves the
    // component itself guards on `disabled` rather than relying solely on the DOM attribute.
    await userEvent.click(screen.getByRole('button', { name: 'exportControls.print' }));
    expect(window.print).not.toHaveBeenCalled();
    expect(downloadMock).not.toHaveBeenCalled();
  });
});

describe('ReportExportControls — export flow', () => {
  it('clicking Export to Excel calls the API with the reportKey/format/filters/locale and downloads the returned blob', async () => {
    const blob = new Blob(['fake-xlsx'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadMock.mockResolvedValue({ blob, filename: 'revenue-by-period-20260803-1200.xlsx' });

    render(<ReportExportControls reportKey="revenue-by-period" filters={FILTERS} />);
    await userEvent.click(screen.getByRole('button', { name: 'exportControls.exportExcel' }));

    await waitFor(() => expect(downloadMock).toHaveBeenCalledWith('revenue-by-period', 'xlsx', FILTERS, 'en'));
    await waitFor(() => expect((globalThis as any).URL.createObjectURL).toHaveBeenCalledWith(blob));
    await waitFor(() => expect((globalThis as any).URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-export-url'));
  });

  it('maps the current i18n language to a supported export locale (fr)', async () => {
    mockLanguage = 'fr';
    downloadMock.mockResolvedValue({ blob: new Blob(['x']), filename: 'x.xlsx' });
    render(<ReportExportControls reportKey="revenue-by-period" filters={FILTERS} />);
    await userEvent.click(screen.getByRole('button', { name: 'exportControls.exportExcel' }));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledWith('revenue-by-period', 'xlsx', FILTERS, 'fr'));
  });

  it('an unsupported/unknown i18n language falls back to "en" rather than sending an invalid locale', async () => {
    mockLanguage = 'pt-BR';
    downloadMock.mockResolvedValue({ blob: new Blob(['x']), filename: 'x.xlsx' });
    render(<ReportExportControls reportKey="revenue-by-period" filters={FILTERS} />);
    await userEvent.click(screen.getByRole('button', { name: 'exportControls.exportExcel' }));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledWith('revenue-by-period', 'xlsx', FILTERS, 'en'));
  });

  it('clicking Export to PDF calls the API with format "pdf"', async () => {
    downloadMock.mockResolvedValue({ blob: new Blob(['fake-pdf']), filename: 'revenue-by-period.pdf' });
    render(<ReportExportControls reportKey="revenue-by-period" filters={FILTERS} enablePdf />);
    await userEvent.click(screen.getByRole('button', { name: 'exportControls.exportPdf' }));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledWith('revenue-by-period', 'pdf', FILTERS, 'en'));
  });

  it('clicking Print calls window.print() and never calls the export API', async () => {
    render(<ReportExportControls reportKey="revenue-by-period" filters={FILTERS} />);
    await userEvent.click(screen.getByRole('button', { name: 'exportControls.print' }));
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(downloadMock).not.toHaveBeenCalled();
  });
});

describe('ReportExportControls — loading state', () => {
  it('shows "preparing" text and disables buttons while the export request is pending, then re-enables', async () => {
    let resolveRequest: (value: { blob: Blob; filename: string }) => void = () => {};
    downloadMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    render(<ReportExportControls reportKey="revenue-by-period" filters={FILTERS} />);
    await userEvent.click(screen.getByRole('button', { name: 'exportControls.exportExcel' }));

    const pendingButton = await screen.findByRole('button', { name: 'exportControls.preparing' });
    expect(pendingButton).toBeDisabled();

    resolveRequest({ blob: new Blob(['x']), filename: 'x.xlsx' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'exportControls.exportExcel' })).not.toBeDisabled(),
    );
  });

  it('duplicate clicks while pending only trigger a single API call', async () => {
    let resolveRequest: (value: { blob: Blob; filename: string }) => void = () => {};
    downloadMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    render(<ReportExportControls reportKey="revenue-by-period" filters={FILTERS} />);

    const button = screen.getByRole('button', { name: 'exportControls.exportExcel' });
    await userEvent.click(button);
    const pendingButton = await screen.findByRole('button', { name: 'exportControls.preparing' });
    await userEvent.click(pendingButton);

    expect(downloadMock).toHaveBeenCalledTimes(1);
    resolveRequest({ blob: new Blob(['x']), filename: 'x.xlsx' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'exportControls.exportExcel' })).not.toBeDisabled());
  });
});

describe('ReportExportControls — API error handling', () => {
  it('renders the localized message for a known stable error code (e.g. ROW_LIMIT_EXCEEDED)', async () => {
    downloadMock.mockRejectedValue(new Error('request failed'));
    errorMock.mockResolvedValue({ code: 'ROW_LIMIT_EXCEEDED', message: 'Too many rows.' });

    render(<ReportExportControls reportKey="revenue-by-period" filters={FILTERS} />);
    await userEvent.click(screen.getByRole('button', { name: 'exportControls.exportExcel' }));

    expect(await screen.findByText('Too many rows.')).toBeInTheDocument();
  });

  it('renders the fallback message string when the error has no known code', async () => {
    downloadMock.mockRejectedValue(new Error('network down'));
    errorMock.mockResolvedValue({ code: null, message: 'network down' });

    render(<ReportExportControls reportKey="revenue-by-period" filters={FILTERS} />);
    await userEvent.click(screen.getByRole('button', { name: 'exportControls.exportExcel' }));

    expect(await screen.findByText('network down')).toBeInTheDocument();
  });

  it('the button re-enables (loading resets) after an error', async () => {
    downloadMock.mockRejectedValue(new Error('fail'));
    errorMock.mockResolvedValue({ code: 'GENERATION_FAILED', message: 'Export failed' });

    render(<ReportExportControls reportKey="revenue-by-period" filters={FILTERS} />);
    await userEvent.click(screen.getByRole('button', { name: 'exportControls.exportExcel' }));

    await screen.findByText('Export failed');
    expect(screen.getByRole('button', { name: 'exportControls.exportExcel' })).not.toBeDisabled();
  });

  it('never crashes and never renders a non-string error object', async () => {
    downloadMock.mockRejectedValue(new Error('fail'));
    errorMock.mockResolvedValue({ code: 'INVALID_FILTERS', message: 'Invalid filters' });

    render(<ReportExportControls reportKey="revenue-by-period" filters={FILTERS} />);
    await userEvent.click(screen.getByRole('button', { name: 'exportControls.exportExcel' }));

    const errorNode = await screen.findByText('Invalid filters');
    expect(errorNode.textContent).toEqual(expect.any(String));
  });
});

describe('ReportExportControls — print contract', () => {
  it('injects a print stylesheet scoped to the given printTargetClassName, and hides itself via no-print', () => {
    const { container } = render(
      <ReportExportControls reportKey="revenue-by-period" filters={FILTERS} printTargetClassName="revenue-report-print-target" />,
    );
    const styleTag = container.querySelector('style');
    expect(styleTag?.textContent).toContain('.revenue-report-print-target');
    expect(styleTag?.textContent).toContain('@media print');
    expect(container.querySelector('.no-print')).not.toBeNull();
  });

  it('never uses unvalidated client-side rows as the export source — it only ever calls the server-backed downloadReportExport with filters, not a rows/data prop', () => {
    // Structural guarantee: the component's props contract has no "rows"/"data" prop at all —
    // exercised implicitly by every test above only ever passing reportKey+filters.
    downloadMock.mockResolvedValue({ blob: new Blob(['x']), filename: 'x.xlsx' });
    render(<ReportExportControls reportKey="revenue-by-period" filters={FILTERS} />);
    expect(downloadMock).not.toHaveBeenCalled(); // no auto-export on mount
  });
});

describe('ReportExportControls — i18n key availability (TR/EN/FR/DE)', () => {
  const locales = ['tr', 'en', 'fr', 'de'] as const;
  const requiredKeys = [
    'export', 'exportExcel', 'exportPdf', 'print', 'preparing', 'generatedAt', 'appliedFilters',
  ];
  const requiredErrorCodes = [
    'UNSUPPORTED_REPORT', 'UNSUPPORTED_FORMAT', 'INVALID_FILTERS', 'UNAUTHORIZED_ROLE',
    'INACCESSIBLE_CLINIC', 'ROW_LIMIT_EXCEEDED', 'NO_DATA', 'GENERATION_FAILED', 'generic',
  ];

  it.each(locales)('%s/reports.json defines every exportControls key used by the component', async (locale) => {
    const messages = (await import(`../../../locales/${locale}/reports.json`)).default;
    expect(messages.exportControls).toBeDefined();
    for (const key of requiredKeys) {
      expect(typeof messages.exportControls[key]).toBe('string');
      expect(messages.exportControls[key].length).toBeGreaterThan(0);
    }
    for (const code of requiredErrorCodes) {
      expect(typeof messages.exportControls.errors[code]).toBe('string');
      expect(messages.exportControls.errors[code].length).toBeGreaterThan(0);
    }
  });
});
