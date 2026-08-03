import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';

export interface PatientDetailTabItem {
  key: string;
  label: string;
}

interface Props {
  /** Always-visible tabs, rendered in a scrollable strip. */
  primaryTabs: PatientDetailTabItem[];
  /** Collapsed into the accessible "More" menu; may be empty. */
  moreTabs: PatientDetailTabItem[];
  activeTab: string;
  onSelect: (key: string) => void;
  /** Label for the More trigger when no `moreTabs` entry is active. */
  moreLabel: string;
  /** Accessible name for the More popup menu. */
  moreMenuAriaLabel: string;
}

/**
 * US-01.X: scalable patient-detail tab navigation — a short, always-visible
 * primary row (horizontally scrollable with chevron affordances, same
 * mechanism as before) plus an accessible "More" menu for the remaining
 * tabs, so the row does not grow unboundedly as further patient modules are
 * added. `activeTab` is NOT owned here — the parent derives it from the URL
 * and is the single source of truth (see PatientDetail.tsx). This component
 * only ever calls `onSelect`; it never maintains its own notion of "which
 * tab is selected".
 *
 * When the active tab lives in `moreTabs`, the trigger displays that tab's
 * own label (instead of the generic "More" text) and is marked
 * `aria-selected` — the active tab is never buried inside an unlabeled
 * overflow control.
 */
const PatientDetailTabs: React.FC<Props> = ({
  primaryTabs,
  moreTabs,
  activeTab,
  onSelect,
  moreLabel,
  moreMenuAriaLabel,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const menuItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  const activeMoreTab = moreTabs.find((tab) => tab.key === activeTab) ?? null;
  const isMoreActive = activeMoreTab !== null;

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    updateScrollState();
    const el = scrollRef.current;
    if (!el) return undefined;
    el.addEventListener('scroll', updateScrollState, { passive: true });
    window.addEventListener('resize', updateScrollState);
    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => updateScrollState());
      resizeObserver.observe(el);
    }
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
      resizeObserver?.disconnect();
    };
  }, [updateScrollState, primaryTabs.length]);

  // Auto-scroll the active primary tab into view whenever it changes —
  // including on initial mount, so a direct link to a right-side primary tab
  // is immediately visible rather than requiring the user to discover it by
  // scrolling. Tabs collapsed into the More menu are not part of this strip,
  // so nothing to scroll to for those.
  useEffect(() => {
    tabRefs.current[activeTab]?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [activeTab]);

  // Close the More menu on outside click and on Escape.
  useEffect(() => {
    if (!isMoreOpen) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (moreMenuRef.current?.contains(target) || moreTriggerRef.current?.contains(target)) return;
      setIsMoreOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMoreOpen(false);
        moreTriggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMoreOpen]);

  // Focus the active (or first) menu item when the menu opens via keyboard
  // or click, so keyboard users land somewhere useful immediately.
  useEffect(() => {
    if (!isMoreOpen) return;
    const target = (activeMoreTab && menuItemRefs.current[activeMoreTab.key]) || menuItemRefs.current[moreTabs[0]?.key ?? ''];
    target?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMoreOpen]);

  const scrollByAmount = (delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  };

  const closeMore = () => setIsMoreOpen(false);

  /**
   * Roving tabindex across the primary row PLUS the More trigger as its
   * final stop. Landing on a primary tab activates it (matches prior
   * behavior); landing on the More trigger only moves focus there — opening
   * the menu is a separate, explicit action (Enter/Space/click), since the
   * trigger does not represent a single tab to auto-select.
   */
  const activateByIndex = (index: number) => {
    const lastIndex = primaryTabs.length + (moreTabs.length > 0 ? 1 : 0) - 1;
    const clamped = Math.max(0, Math.min(lastIndex, index));
    if (clamped < primaryTabs.length) {
      const target = primaryTabs[clamped];
      if (!target) return;
      onSelect(target.key);
      tabRefs.current[target.key]?.focus();
    } else {
      moreTriggerRef.current?.focus();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        activateByIndex(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        activateByIndex(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        activateByIndex(0);
        break;
      case 'End':
        event.preventDefault();
        activateByIndex(primaryTabs.length + (moreTabs.length > 0 ? 1 : 0) - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onSelect(primaryTabs[index]!.key);
        break;
      default:
        break;
    }
  };

  const handleMoreTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        activateByIndex(primaryTabs.length - 1);
        break;
      case 'Home':
        event.preventDefault();
        activateByIndex(0);
        break;
      case 'ArrowDown':
      case 'Enter':
      case ' ':
        event.preventDefault();
        setIsMoreOpen(true);
        break;
      default:
        break;
    }
  };

  const handleMenuItemKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const next = moreTabs[Math.min(moreTabs.length - 1, index + 1)];
        if (next) menuItemRefs.current[next.key]?.focus();
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const prev = moreTabs[Math.max(0, index - 1)];
        if (prev) menuItemRefs.current[prev.key]?.focus();
        break;
      }
      case 'Home': {
        event.preventDefault();
        const first = moreTabs[0];
        if (first) menuItemRefs.current[first.key]?.focus();
        break;
      }
      case 'End': {
        event.preventDefault();
        const last = moreTabs[moreTabs.length - 1];
        if (last) menuItemRefs.current[last.key]?.focus();
        break;
      }
      case 'Enter':
      case ' ':
        event.preventDefault();
        onSelect(moreTabs[index]!.key);
        closeMore();
        moreTriggerRef.current?.focus();
        break;
      default:
        break;
    }
  };

  return (
    <div role="tablist" aria-label="Hasta detay sekmeleri" className="relative flex items-stretch border-b border-gray-200 -mx-4 px-4 sm:mx-0 sm:px-0">
      <div className="relative flex-1 min-w-0 flex items-center">
        {canScrollLeft && (
          <button
            type="button"
            aria-label="Önceki sekmeleri göster"
            onClick={() => scrollByAmount(-160)}
            className="absolute left-0 z-10 h-full w-8 flex items-center justify-center bg-gradient-to-r from-white via-white to-transparent"
          >
            <ChevronLeft size={16} className="text-gray-500" />
          </button>
        )}
        <div
          ref={scrollRef}
          className="flex gap-1 sm:gap-4 overflow-x-auto scrollbar-hide scroll-smooth"
        >
          {primaryTabs.map((tab, index) => (
            <button
              key={tab.key}
              ref={(el) => { tabRefs.current[tab.key] = el; }}
              role="tab"
              type="button"
              id={`patient-tab-${tab.key}`}
              aria-selected={activeTab === tab.key}
              aria-controls={`patient-tabpanel-${tab.key}`}
              tabIndex={activeTab === tab.key ? 0 : -1}
              data-tab={tab.key}
              onClick={() => onSelect(tab.key)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={`flex-shrink-0 px-2 sm:px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 rounded-t ${
                activeTab === tab.key ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {canScrollRight && (
          <button
            type="button"
            aria-label="Sonraki sekmeleri göster"
            onClick={() => scrollByAmount(160)}
            className="absolute right-0 z-10 h-full w-8 flex items-center justify-center bg-gradient-to-l from-white via-white to-transparent"
          >
            <ChevronRight size={16} className="text-gray-500" />
          </button>
        )}
      </div>
      {moreTabs.length > 0 && (
        <div className="relative flex-shrink-0 flex items-center">
          <button
            ref={moreTriggerRef}
            role="tab"
            type="button"
            id="patient-tab-more"
            aria-selected={isMoreActive}
            aria-haspopup="menu"
            aria-expanded={isMoreOpen}
            aria-controls="patient-tabs-more-menu"
            tabIndex={isMoreActive ? 0 : -1}
            data-tab="more"
            onClick={() => setIsMoreOpen((open) => !open)}
            onKeyDown={handleMoreTriggerKeyDown}
            className={`flex-shrink-0 flex items-center gap-1 px-2 sm:px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 rounded-t ${
              isMoreActive ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {isMoreActive ? activeMoreTab!.label : moreLabel}
            <ChevronDown size={14} className={`transition-transform ${isMoreOpen ? 'rotate-180' : ''}`} />
          </button>
          {isMoreOpen && (
            <div
              ref={moreMenuRef}
              role="menu"
              id="patient-tabs-more-menu"
              aria-label={moreMenuAriaLabel}
              className="absolute right-0 top-full z-20 mt-1 min-w-[10rem] rounded-md border border-gray-200 bg-white py-1 shadow-lg"
            >
              {moreTabs.map((tab, index) => (
                <button
                  key={tab.key}
                  ref={(el) => { menuItemRefs.current[tab.key] = el; }}
                  role="menuitemradio"
                  type="button"
                  aria-checked={activeTab === tab.key}
                  data-tab={tab.key}
                  onClick={() => {
                    onSelect(tab.key);
                    closeMore();
                    moreTriggerRef.current?.focus();
                  }}
                  onKeyDown={(e) => handleMenuItemKeyDown(e, index)}
                  className={`block w-full text-left px-4 py-2 text-sm whitespace-nowrap focus:outline-none focus-visible:bg-gray-100 ${
                    activeTab === tab.key ? 'font-semibold text-primary-600 bg-primary-50' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PatientDetailTabs;
