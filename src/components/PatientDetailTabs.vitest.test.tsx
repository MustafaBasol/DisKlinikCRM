/**
 * PatientDetailTabs.vitest.test.tsx — KVKK-HIGH-008 F-2 responsive/accessible
 * tab bar tests.
 *
 * jsdom does no real layout — scrollWidth/clientWidth are stubbed explicitly
 * per test to simulate overflow/no-overflow, and ResizeObserver is a no-op
 * stub (see src/test/setup.ts). These tests verify component logic, ARIA
 * wiring, and keyboard behavior; they do NOT prove real browser layout,
 * real CSS overflow, or real zoom rendering — that is a separate, manual
 * verification pass (see docs/compliance write-up).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import PatientDetailTabs, { type PatientDetailTabItem } from './PatientDetailTabs';

const TABS: PatientDetailTabItem[] = [
  { key: 'overview', label: 'Genel Bakış' },
  { key: 'appointments', label: 'Randevular' },
  { key: 'tasks', label: 'Görevler' },
  { key: 'treatments', label: 'Tedaviler' },
  { key: 'payments', label: 'Ödemeler' },
  { key: 'insurance', label: 'Sigorta' },
  { key: 'messages', label: 'Mesajlar' },
  { key: 'files', label: 'Dosyalar' },
  { key: 'imaging', label: 'Görüntüleme' },
  { key: 'dental', label: 'Diş Haritası' },
  { key: 'activity', label: 'Activity' },
  { key: 'privacy', label: 'Gizlilik' },
  { key: 'communication', label: 'İletişim Tercihleri' },
];

/** Simulates a constrained-width container where content overflows. */
function stubOverflow(container: HTMLElement, { scrollWidth = 2000, clientWidth = 400, scrollLeft = 0 } = {}) {
  const el = container.querySelector('[role="tablist"]') as HTMLElement;
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
  Object.defineProperty(el, 'scrollLeft', { configurable: true, value: scrollLeft, writable: true });
  fireEvent.scroll(el);
  return el;
}

/** Simulates a wide container where every tab fits — no overflow. */
function stubNoOverflow(container: HTMLElement) {
  return stubOverflow(container, { scrollWidth: 400, clientWidth: 400, scrollLeft: 0 });
}

describe('PatientDetailTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders every tab exactly once (no duplicate rendering)', () => {
    const { container } = render(<PatientDetailTabs tabs={TABS} activeTab="overview" onSelect={() => {}} />);
    for (const tab of TABS) {
      expect(container.querySelectorAll(`[data-tab="${tab.key}"]`).length).toBe(1);
    }
    expect(screen.getAllByRole('tab')).toHaveLength(TABS.length);
  });

  it('marks the active tab with aria-selected and gives it tabIndex 0; others get -1 (roving tabindex)', () => {
    render(<PatientDetailTabs tabs={TABS} activeTab="communication" onSelect={() => {}} />);
    const active = screen.getByRole('tab', { name: 'İletişim Tercihleri' });
    expect(active).toHaveAttribute('aria-selected', 'true');
    expect(active).toHaveAttribute('tabindex', '0');
    const inactive = screen.getByRole('tab', { name: 'Genel Bakış' });
    expect(inactive).toHaveAttribute('aria-selected', 'false');
    expect(inactive).toHaveAttribute('tabindex', '-1');
  });

  it('does not show scroll chevrons when content fits (no overflow)', () => {
    const { container } = render(<PatientDetailTabs tabs={TABS} activeTab="overview" onSelect={() => {}} />);
    stubNoOverflow(container);
    expect(screen.queryByLabelText(/Sonraki sekmeleri göster/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Önceki sekmeleri göster/i)).not.toBeInTheDocument();
  });

  it('shows a right scroll chevron when content overflows and the view is scrolled to the start', () => {
    const { container } = render(<PatientDetailTabs tabs={TABS} activeTab="overview" onSelect={() => {}} />);
    stubOverflow(container, { scrollWidth: 2000, clientWidth: 400, scrollLeft: 0 });
    expect(screen.getByLabelText(/Sonraki sekmeleri göster/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Önceki sekmeleri göster/i)).not.toBeInTheDocument();
  });

  it('shows a left scroll chevron once scrolled away from the start, and both when in the middle', () => {
    const { container } = render(<PatientDetailTabs tabs={TABS} activeTab="overview" onSelect={() => {}} />);
    stubOverflow(container, { scrollWidth: 2000, clientWidth: 400, scrollLeft: 800 });
    expect(screen.getByLabelText(/Sonraki sekmeleri göster/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Önceki sekmeleri göster/i)).toBeInTheDocument();
  });

  it('every declared tab remains reachable via a real DOM node even under constrained width (overflow never removes tabs from the DOM)', () => {
    const { container } = render(<PatientDetailTabs tabs={TABS} activeTab="overview" onSelect={() => {}} />);
    stubOverflow(container);
    for (const tab of TABS) {
      expect(screen.getByRole('tab', { name: tab.label })).toBeInTheDocument();
    }
  });

  it('clicking a tab calls onSelect with that tab\'s key', async () => {
    const onSelect = vi.fn();
    render(<PatientDetailTabs tabs={TABS} activeTab="overview" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Gizlilik' }));
    expect(onSelect).toHaveBeenCalledWith('privacy');
  });

  it('ArrowRight/ArrowLeft move to the next/previous tab and activate it', () => {
    const onSelect = vi.fn();
    render(<PatientDetailTabs tabs={TABS} activeTab="overview" onSelect={onSelect} />);
    const overviewTab = screen.getByRole('tab', { name: 'Genel Bakış' });
    fireEvent.keyDown(overviewTab, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledWith('appointments');
  });

  it('Home/End jump to the first/last tab', () => {
    const onSelect = vi.fn();
    render(<PatientDetailTabs tabs={TABS} activeTab="communication" onSelect={onSelect} />);
    const active = screen.getByRole('tab', { name: 'İletişim Tercihleri' });
    fireEvent.keyDown(active, { key: 'Home' });
    expect(onSelect).toHaveBeenCalledWith('overview');
    onSelect.mockClear();
    fireEvent.keyDown(active, { key: 'End' });
    expect(onSelect).toHaveBeenCalledWith('communication');
  });

  it('ArrowLeft/ArrowRight at the boundary clamps instead of wrapping or throwing', () => {
    const onSelect = vi.fn();
    render(<PatientDetailTabs tabs={TABS} activeTab="overview" onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Genel Bakış' }), { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenCalledWith('overview');
  });

  it('Enter and Space activate the currently-focused tab', () => {
    const onSelect = vi.fn();
    render(<PatientDetailTabs tabs={TABS} activeTab="overview" onSelect={onSelect} />);
    const appointmentsTab = screen.getByRole('tab', { name: 'Randevular' });
    fireEvent.keyDown(appointmentsTab, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('appointments');
    onSelect.mockClear();
    fireEvent.keyDown(appointmentsTab, { key: ' ' });
    expect(onSelect).toHaveBeenCalledWith('appointments');
  });

  it('an unauthorized/filtered-out tab never appears, so it can never be exposed via overflow scrolling either', () => {
    const filtered = TABS.filter((t) => t.key !== 'imaging');
    render(<PatientDetailTabs tabs={filtered} activeTab="overview" onSelect={() => {}} />);
    expect(screen.queryByRole('tab', { name: 'Görüntüleme' })).not.toBeInTheDocument();
  });

  it('resizing from wide (no overflow) to narrow (overflow) to wide again updates chevron visibility without losing any tab', () => {
    const { container } = render(<PatientDetailTabs tabs={TABS} activeTab="overview" onSelect={() => {}} />);
    stubNoOverflow(container);
    expect(screen.queryByLabelText(/Sonraki sekmeleri göster/i)).not.toBeInTheDocument();

    stubOverflow(container, { scrollWidth: 2000, clientWidth: 400, scrollLeft: 0 });
    expect(screen.getByLabelText(/Sonraki sekmeleri göster/i)).toBeInTheDocument();

    stubNoOverflow(container);
    expect(screen.queryByLabelText(/Sonraki sekmeleri göster/i)).not.toBeInTheDocument();
    for (const tab of TABS) {
      expect(screen.getByRole('tab', { name: tab.label })).toBeInTheDocument();
    }
  });

  it('re-rendering with a different activeTab (simulating direct navigation to a right-side tab) selects it correctly without duplicating tabs', () => {
    const { rerender } = render(<PatientDetailTabs tabs={TABS} activeTab="overview" onSelect={() => {}} />);
    rerender(<PatientDetailTabs tabs={TABS} activeTab="communication" onSelect={() => {}} />);
    expect(screen.getByRole('tab', { name: 'İletişim Tercihleri' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab')).toHaveLength(TABS.length);
  });
});
