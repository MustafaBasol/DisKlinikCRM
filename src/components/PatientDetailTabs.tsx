import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface PatientDetailTabItem {
  key: string;
  label: string;
}

interface Props {
  tabs: PatientDetailTabItem[];
  activeTab: string;
  onSelect: (key: string) => void;
}

/**
 * KVKK-HIGH-008 F-2: accessible, responsive tab bar for PatientDetail.
 *
 * Single mechanism across every breakpoint — a horizontally scrollable
 * `role="tablist"` with visible left/right scroll-chevron buttons (rendered
 * only when overflow actually exists) plus an edge fade, instead of the
 * previous `overflow-x-auto scrollbar-hide` which removed the only affordance
 * signaling more tabs exist off-screen. Native wheel/trackpad scroll and
 * touch swipe keep working via the underlying `overflow-x-auto` container; no
 * separate mobile dropdown is introduced.
 *
 * `activeTab` is NOT owned here — the parent derives it from the URL and is
 * the single source of truth (see PatientDetail.tsx). This component only
 * ever calls `onSelect`; it never maintains its own notion of "which tab is
 * selected" to avoid a second, competing state writer.
 */
const PatientDetailTabs: React.FC<Props> = ({ tabs, activeTab, onSelect }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

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
  }, [updateScrollState, tabs.length]);

  // Auto-scroll the active tab into view whenever it changes — including on
  // initial mount, so a direct link to a right-side tab is immediately
  // visible rather than requiring the user to discover it by scrolling.
  useEffect(() => {
    tabRefs.current[activeTab]?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [activeTab]);

  const scrollByAmount = (delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  };

  const activateByIndex = (index: number) => {
    const clamped = Math.max(0, Math.min(tabs.length - 1, index));
    const target = tabs[clamped];
    if (!target) return;
    onSelect(target.key);
    tabRefs.current[target.key]?.focus();
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
        activateByIndex(tabs.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onSelect(tabs[index]!.key);
        break;
      default:
        break;
    }
  };

  return (
    <div className="relative flex items-center border-b border-gray-200 -mx-4 px-4 sm:mx-0 sm:px-0">
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
        role="tablist"
        aria-label="Hasta detay sekmeleri"
        className="flex gap-1 sm:gap-4 overflow-x-auto scrollbar-hide scroll-smooth"
      >
        {tabs.map((tab, index) => (
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
  );
};

export default PatientDetailTabs;
