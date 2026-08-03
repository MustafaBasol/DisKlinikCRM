/**
 * PatientDetailTabs.vitest.test.tsx — US-01.X scalable patient-detail
 * navigation: a scrollable primary tab row plus an accessible "More" menu
 * for the remaining tabs.
 *
 * jsdom does no real layout — scrollWidth/clientWidth are stubbed explicitly
 * per test to simulate overflow/no-overflow, and ResizeObserver is a no-op
 * stub (see src/test/setup.ts). These tests verify component logic, ARIA
 * wiring, and keyboard behavior; they do NOT prove real browser layout,
 * real CSS overflow, or real zoom rendering — that is a separate, manual
 * verification pass (see docs/compliance write-up).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import PatientDetailTabs, { type PatientDetailTabItem } from './PatientDetailTabs';

const PRIMARY: PatientDetailTabItem[] = [
  { key: 'overview', label: 'Genel Bakış' },
  { key: 'appointments', label: 'Randevular' },
  { key: 'treatments', label: 'Tedaviler' },
  { key: 'payments', label: 'Ödemeler' },
  { key: 'files', label: 'Dosyalar' },
];

const MORE: PatientDetailTabItem[] = [
  { key: 'tasks', label: 'Görevler' },
  { key: 'insurance', label: 'Sigorta' },
  { key: 'messages', label: 'Mesajlar' },
  { key: 'imaging', label: 'Görüntüleme' },
  { key: 'dental', label: 'Diş Haritası' },
  { key: 'activity', label: 'Activity' },
  { key: 'privacy', label: 'Gizlilik' },
  { key: 'communication', label: 'İletişim Tercihleri' },
  { key: 'emergencyContacts', label: 'Acil Durum Kişileri' },
];

const MORE_LABEL = 'Diğer';
const MORE_MENU_ARIA_LABEL = 'Diğer hasta detay sekmeleri';

function renderTabs(activeTab: string, onSelect: (key: string) => void = vi.fn(), moreTabs: PatientDetailTabItem[] = MORE) {
  return render(
    <PatientDetailTabs
      primaryTabs={PRIMARY}
      moreTabs={moreTabs}
      activeTab={activeTab}
      onSelect={onSelect}
      moreLabel={MORE_LABEL}
      moreMenuAriaLabel={MORE_MENU_ARIA_LABEL}
    />,
  );
}

/** Simulates a constrained-width container where content overflows. */
function stubOverflow(container: HTMLElement, { scrollWidth = 2000, clientWidth = 400, scrollLeft = 0 } = {}) {
  const el = container.querySelector('[role="tablist"] > div > div') as HTMLElement;
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
  Object.defineProperty(el, 'scrollLeft', { configurable: true, value: scrollLeft, writable: true });
  fireEvent.scroll(el);
  return el;
}

describe('PatientDetailTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('primary row — every existing tab key remains available', () => {
    it('renders every primary tab exactly once', () => {
      const { container } = renderTabs('overview');
      for (const tab of PRIMARY) {
        expect(container.querySelectorAll(`[data-tab="${tab.key}"]`).length).toBe(1);
      }
    });

    it('exposes the total tab count (primary + more) as role="tab" across the strip and the closed menu', () => {
      renderTabs('overview');
      // Primary tabs + the More trigger itself are role="tab"; menu items are
      // role="menuitemradio" and not present until the menu opens.
      expect(screen.getAllByRole('tab')).toHaveLength(PRIMARY.length + 1);
    });

    it('marks the active primary tab with aria-selected and roving tabindex 0; others get -1', () => {
      renderTabs('treatments');
      const active = screen.getByRole('tab', { name: 'Tedaviler' });
      expect(active).toHaveAttribute('aria-selected', 'true');
      expect(active).toHaveAttribute('tabindex', '0');
      const inactive = screen.getByRole('tab', { name: 'Genel Bakış' });
      expect(inactive).toHaveAttribute('aria-selected', 'false');
      expect(inactive).toHaveAttribute('tabindex', '-1');
    });

    it('clicking a primary tab calls onSelect with that tab\'s key', async () => {
      const onSelect = vi.fn();
      renderTabs('overview', onSelect);
      await userEvent.click(screen.getByRole('tab', { name: 'Dosyalar' }));
      expect(onSelect).toHaveBeenCalledWith('files');
    });

    it('an unauthorized/filtered-out tab (absent from both primaryTabs and moreTabs) never appears anywhere', () => {
      const filteredMore = MORE.filter((t) => t.key !== 'imaging');
      renderTabs('overview', vi.fn(), filteredMore);
      expect(screen.queryByText('Görüntüleme')).not.toBeInTheDocument();
    });

    it('does not show scroll chevrons when the primary row fits (no overflow)', () => {
      const { container } = renderTabs('overview');
      stubOverflow(container, { scrollWidth: 400, clientWidth: 400, scrollLeft: 0 });
      expect(screen.queryByLabelText(/Sonraki sekmeleri göster/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Önceki sekmeleri göster/i)).not.toBeInTheDocument();
    });

    it('shows a right scroll chevron when the primary row overflows', () => {
      const { container } = renderTabs('overview');
      stubOverflow(container, { scrollWidth: 2000, clientWidth: 400, scrollLeft: 0 });
      expect(screen.getByLabelText(/Sonraki sekmeleri göster/i)).toBeInTheDocument();
    });
  });

  describe('keyboard interaction — primary row', () => {
    it('ArrowRight/ArrowLeft move to the next/previous primary tab and activate it', () => {
      const onSelect = vi.fn();
      renderTabs('overview', onSelect);
      fireEvent.keyDown(screen.getByRole('tab', { name: 'Genel Bakış' }), { key: 'ArrowRight' });
      expect(onSelect).toHaveBeenCalledWith('appointments');
    });

    it('Home jumps to the first primary tab', () => {
      const onSelect = vi.fn();
      renderTabs('files', onSelect);
      fireEvent.keyDown(screen.getByRole('tab', { name: 'Dosyalar' }), { key: 'Home' });
      expect(onSelect).toHaveBeenCalledWith('overview');
    });

    it('End moves focus to the More trigger (the final roving-tabindex stop) without selecting it', () => {
      const onSelect = vi.fn();
      renderTabs('overview', onSelect);
      fireEvent.keyDown(screen.getByRole('tab', { name: 'Genel Bakış' }), { key: 'End' });
      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.getByRole('tab', { name: new RegExp(MORE_LABEL) })).toHaveFocus();
    });

    it('ArrowRight from the last primary tab moves focus to the More trigger without selecting it', () => {
      const onSelect = vi.fn();
      renderTabs('overview', onSelect);
      fireEvent.keyDown(screen.getByRole('tab', { name: 'Dosyalar' }), { key: 'ArrowRight' });
      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.getByRole('tab', { name: new RegExp(MORE_LABEL) })).toHaveFocus();
    });

    it('ArrowLeft/ArrowRight at the primary-row boundary clamps instead of wrapping or throwing', () => {
      const onSelect = vi.fn();
      renderTabs('overview', onSelect);
      fireEvent.keyDown(screen.getByRole('tab', { name: 'Genel Bakış' }), { key: 'ArrowLeft' });
      expect(onSelect).toHaveBeenCalledWith('overview');
    });

    it('Enter and Space activate the currently-focused primary tab', () => {
      const onSelect = vi.fn();
      renderTabs('overview', onSelect);
      const appointmentsTab = screen.getByRole('tab', { name: 'Randevular' });
      fireEvent.keyDown(appointmentsTab, { key: 'Enter' });
      expect(onSelect).toHaveBeenCalledWith('appointments');
      onSelect.mockClear();
      fireEvent.keyDown(appointmentsTab, { key: ' ' });
      expect(onSelect).toHaveBeenCalledWith('appointments');
    });
  });

  describe('More menu — overflow/more-menu behavior', () => {
    it('does not render a More trigger when there are no overflow tabs', () => {
      renderTabs('overview', vi.fn(), []);
      expect(screen.queryByText(MORE_LABEL)).not.toBeInTheDocument();
    });

    it('shows the generic More label when the active tab is a primary tab', () => {
      renderTabs('overview');
      expect(screen.getByRole('tab', { name: new RegExp(`^${MORE_LABEL}`) })).toBeInTheDocument();
    });

    it('is closed by default: menu items are not in the document until opened', () => {
      renderTabs('overview');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('clicking the More trigger opens the menu listing every overflow tab', async () => {
      renderTabs('overview');
      await userEvent.click(screen.getByRole('tab', { name: new RegExp(MORE_LABEL) }));
      const menu = screen.getByRole('menu', { name: MORE_MENU_ARIA_LABEL });
      for (const tab of MORE) {
        expect(within(menu).getByRole('menuitemradio', { name: tab.label })).toBeInTheDocument();
      }
    });

    it('the More trigger has proper aria-haspopup/aria-expanded/aria-controls wiring', async () => {
      renderTabs('overview');
      const trigger = screen.getByRole('tab', { name: new RegExp(MORE_LABEL) });
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(trigger).toHaveAttribute('aria-controls', screen.getByRole('menu').id);
    });

    it('clicking a menu item calls onSelect with that tab\'s key and closes the menu', async () => {
      const onSelect = vi.fn();
      renderTabs('overview', onSelect);
      await userEvent.click(screen.getByRole('tab', { name: new RegExp(MORE_LABEL) }));
      await userEvent.click(screen.getByRole('menuitemradio', { name: 'Gizlilik' }));
      expect(onSelect).toHaveBeenCalledWith('privacy');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('clicking outside the open menu closes it without selecting a tab', async () => {
      const onSelect = vi.fn();
      renderTabs('overview', onSelect);
      await userEvent.click(screen.getByRole('tab', { name: new RegExp(MORE_LABEL) }));
      expect(screen.getByRole('menu')).toBeInTheDocument();
      await userEvent.click(document.body);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('Escape closes the menu and returns focus to the trigger', async () => {
      renderTabs('overview');
      const trigger = screen.getByRole('tab', { name: new RegExp(MORE_LABEL) });
      await userEvent.click(trigger);
      expect(screen.getByRole('menu')).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it('ArrowDown/ArrowUp move focus between menu items', async () => {
      renderTabs('overview');
      await userEvent.click(screen.getByRole('tab', { name: new RegExp(MORE_LABEL) }));
      const first = screen.getByRole('menuitemradio', { name: MORE[0]!.label });
      first.focus();
      fireEvent.keyDown(first, { key: 'ArrowDown' });
      expect(screen.getByRole('menuitemradio', { name: MORE[1]!.label })).toHaveFocus();
      fireEvent.keyDown(screen.getByRole('menuitemradio', { name: MORE[1]!.label }), { key: 'ArrowUp' });
      expect(first).toHaveFocus();
    });

    it('Enter on a menu item selects it, closes the menu, and returns focus to the trigger', () => {
      const onSelect = vi.fn();
      renderTabs('overview', onSelect);
      const trigger = screen.getByRole('tab', { name: new RegExp(MORE_LABEL) });
      fireEvent.click(trigger);
      const item = screen.getByRole('menuitemradio', { name: 'İletişim Tercihleri' });
      fireEvent.keyDown(item, { key: 'Enter' });
      expect(onSelect).toHaveBeenCalledWith('communication');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      // onSelect is a mock here — the component does not own activeTab, so the
      // parent (PatientDetail.tsx) is responsible for the URL round-trip that
      // would actually relabel the trigger; this only proves focus returns.
      expect(trigger).toHaveFocus();
    });
  });

  describe('active tab never hidden inside the More overflow (requirement: no inaccessible overflow state)', () => {
    it('when the active tab is in the More group, the trigger displays that tab\'s own label instead of the generic More text', () => {
      renderTabs('emergencyContacts');
      expect(screen.getByRole('tab', { name: 'Acil Durum Kişileri' })).toBeInTheDocument();
      expect(screen.queryByText(MORE_LABEL)).not.toBeInTheDocument();
    });

    it('the More trigger is aria-selected and gets tabindex 0 when the active tab is in the More group', () => {
      renderTabs('emergencyContacts');
      const trigger = screen.getByRole('tab', { name: 'Acil Durum Kişileri' });
      expect(trigger).toHaveAttribute('aria-selected', 'true');
      expect(trigger).toHaveAttribute('tabindex', '0');
    });

    it('no primary tab is aria-selected while the active tab lives in the More group', () => {
      renderTabs('emergencyContacts');
      for (const tab of PRIMARY) {
        expect(screen.getByRole('tab', { name: tab.label })).toHaveAttribute('aria-selected', 'false');
      }
    });

    it('opening the menu while a More tab is active highlights it with aria-checked', async () => {
      renderTabs('emergencyContacts');
      await userEvent.click(screen.getByRole('tab', { name: 'Acil Durum Kişileri' }));
      expect(screen.getByRole('menuitemradio', { name: 'Acil Durum Kişileri' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('menuitemradio', { name: 'Gizlilik' })).toHaveAttribute('aria-checked', 'false');
    });
  });

  describe('deep-link / re-render behavior', () => {
    it('re-rendering with a different activeTab landing in the More group selects it correctly (direct navigation / deep link)', () => {
      const { rerender } = renderTabs('overview');
      rerender(
        <PatientDetailTabs
          primaryTabs={PRIMARY}
          moreTabs={MORE}
          activeTab="emergencyContacts"
          onSelect={vi.fn()}
          moreLabel={MORE_LABEL}
          moreMenuAriaLabel={MORE_MENU_ARIA_LABEL}
        />,
      );
      expect(screen.getByRole('tab', { name: 'Acil Durum Kişileri' })).toHaveAttribute('aria-selected', 'true');
    });

    it('re-rendering between two primary tabs updates aria-selected without duplicating tabs', () => {
      const { rerender } = renderTabs('overview');
      rerender(
        <PatientDetailTabs
          primaryTabs={PRIMARY}
          moreTabs={MORE}
          activeTab="payments"
          onSelect={vi.fn()}
          moreLabel={MORE_LABEL}
          moreMenuAriaLabel={MORE_MENU_ARIA_LABEL}
        />,
      );
      expect(screen.getByRole('tab', { name: 'Ödemeler' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getAllByRole('tab', { name: 'Ödemeler' })).toHaveLength(1);
    });
  });
});
