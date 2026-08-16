/**
 * ClinicKvkkPublicPage.website.vitest.test.tsx — F3-SEC-004 / R-076.
 *
 * The clinic website value is typed by a clinic user and rendered on an
 * unauthenticated page. Until this fix it went straight into an `href`, so a
 * `javascript:` URL persisted by a privileged user became stored XSS for every
 * anonymous visitor.
 *
 * The API now refuses to write unsafe values and nulls unsafe legacy ones on
 * the public endpoint, but these tests deliberately feed the page a raw legacy
 * API fixture — a cached response, or a browser talking to a server that has
 * not been redeployed yet, can still deliver one. The render sink has to hold
 * on its own.
 *
 * i18n is mocked to echo keys — same pattern as
 * src/pages/platform/__tests__/PlatformBackups.recovery.vitest.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'tr' } }),
}));

// Not under test, and it reaches for matchMedia which jsdom does not implement.
vi.mock('../../../components/landing/PublicThemeToggle', () => ({
  default: () => null,
}));

const axiosGet = vi.fn();
vi.mock('axios', () => ({
  default: { get: (...args: unknown[]) => axiosGet(...args) },
}));

import ClinicKvkkPublicPage from '../ClinicKvkkPublicPage';
import { SAFE_URL_PROTOCOLS, getSafeHttpUrl } from '../../../utils/safeUrl';

/** Minimum published profile the page needs in order to render the info table. */
function apiResponse(website: string | null) {
  return {
    data: {
      clinic: { name: 'Test Klinik', legalName: 'Test Klinik A.S.' },
      legalProfile: {
        dataControllerTitle: 'Test Klinik A.S.',
        address: 'Istanbul',
        website,
        privacyNoticeText: 'Aydinlatma metni',
        privacyNoticeVersion: '1.0',
        isPublished: true,
      },
    },
  };
}

async function renderWithWebsite(website: string | null) {
  axiosGet.mockResolvedValueOnce(apiResponse(website));
  render(
    <MemoryRouter initialEntries={['/klinik/test-klinik/kvkk']}>
      <Routes>
        <Route path="/klinik/:clinicSlug/kvkk" element={<ClinicKvkkPublicPage />} />
      </Routes>
    </MemoryRouter>,
  );
  // Resolves once the axios promise has settled and the table has rendered.
  return screen.findByTestId('legal-profile-website');
}

beforeEach(() => {
  axiosGet.mockReset();
});

describe('ClinicKvkkPublicPage — website link (R-076)', () => {
  it('renders an https website as a clickable link', async () => {
    const cell = await renderWithWebsite('https://clinic.example');
    const link = cell.querySelector('a');
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute('href', 'https://clinic.example');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders an http website as a clickable link', async () => {
    const cell = await renderWithWebsite('http://clinic.example');
    expect(cell.querySelector('a')).toHaveAttribute('href', 'http://clinic.example');
  });

  // Each of these is a value that could already be sitting in the database,
  // written before F3-SEC-004 existed.
  const legacyUnsafe: Array<[string, string]> = [
    ['javascript:', 'javascript:alert(1)'],
    ['mixed-case javascript:', 'JaVaScRiPt:alert(1)'],
    ['tab-obfuscated javascript:', 'java\tscript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['file:', 'file:///etc/passwd'],
    ['protocol-relative', '//evil.example'],
    ['relative path', '/relative'],
    ['malformed', 'not a url at all'],
  ];

  it.each(legacyUnsafe)('never puts a %s legacy value in an href', async (_label, value) => {
    const cell = await renderWithWebsite(value);
    expect(cell.querySelector('a')).toBeNull();
  });

  it('renders an unsafe legacy value as inert text rather than dropping it', async () => {
    // Keeping the text visible tells the clinic something is wrong with the
    // row; React escapes it, and with no anchor there is nothing to click.
    const cell = await renderWithWebsite('javascript:alert(1)');
    expect(cell).toHaveTextContent('javascript:alert(1)');
    expect(cell.querySelector('a')).toBeNull();
  });

  it('renders no website row at all when the API suppressed the value', async () => {
    axiosGet.mockResolvedValueOnce(apiResponse(null));
    render(
      <MemoryRouter initialEntries={['/klinik/test-klinik/kvkk']}>
        <Routes>
          <Route path="/klinik/:clinicSlug/kvkk" element={<ClinicKvkkPublicPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Test Klinik');
    expect(screen.queryByTestId('legal-profile-website')).toBeNull();
  });

  it('puts no javascript: URL anywhere in the rendered document', async () => {
    // Backstop against a second, unnoticed sink for the same value.
    const { container } = { container: (await renderWithWebsite('javascript:alert(1)')).ownerDocument.body };
    for (const el of Array.from(container.querySelectorAll('[href], [src]'))) {
      const value = el.getAttribute('href') ?? el.getAttribute('src') ?? '';
      expect(value.toLowerCase()).not.toContain('javascript:');
    }
  });
});

describe('getSafeHttpUrl — security property', () => {
  it('allows exactly http: and https:', () => {
    // Mutation guard: widening the allowlist, or replacing the guard with
    // unconditional acceptance, must fail here rather than silently reopening
    // R-076.
    expect([...SAFE_URL_PROTOCOLS]).toEqual(['http:', 'https:']);
    expect(getSafeHttpUrl('https://clinic.example')).toBe('https://clinic.example');
    expect(getSafeHttpUrl('http://clinic.example')).toBe('http://clinic.example');
    for (const unsafe of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x', 'blob:https://x/1', '//e', '/r', '', '   ', 'nope']) {
      expect(getSafeHttpUrl(unsafe)).toBeNull();
    }
    expect(getSafeHttpUrl(null)).toBeNull();
    expect(getSafeHttpUrl(undefined)).toBeNull();
  });

  it('stays behaviourally identical to the server-side copy', () => {
    // server/src/utils/safeUrl.ts and src/utils/safeUrl.ts are duplicated
    // because the two builds share no package. Drift between them would mean
    // the API and the render sink disagree about what is safe, so pin them.
    const extract = (path: string) => {
      const src = readFileSync(path, 'utf8');
      const start = src.indexOf('export function isSafeHttpUrl');
      const end = src.indexOf('\n}', start);
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      return {
        allowlist: src.split('\n').find((line) => line.startsWith('export const SAFE_URL_PROTOCOLS')),
        body: src.slice(start, end),
      };
    };
    expect(extract('src/utils/safeUrl.ts')).toEqual(extract('server/src/utils/safeUrl.ts'));
  });
});
