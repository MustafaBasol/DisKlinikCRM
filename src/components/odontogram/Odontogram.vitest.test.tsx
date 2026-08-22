/**
 * Odontogram.vitest.test.tsx — DENTAL-CHART-ASSET-R3
 *
 * The odontogram had no component-level test at all: `odontogramAnatomy.test.ts`
 * and `odontogramProportions.test.ts` both cover the pure artwork layer and
 * deliberately never import React, so nothing verified that the chart actually
 * MOUNTS — that both dentitions render every tooth, that both views are
 * emitted per tooth, that the seven clinical statuses still reach the DOM, or
 * that selecting a tooth marks both of its views. R3 rewrites all 52 artwork
 * entries and the renderer underneath them, which is precisely when that gap
 * stops being theoretical.
 *
 * These assertions are deliberately written against the component's PUBLIC
 * SURFACE — the `data-*` attributes and ARIA the chart already exposed — and
 * not against class names or path data. A visual refresh must be free to
 * change how a tooth looks; it must not be free to silently drop a tooth, a
 * view, a surface region or a status.
 *
 * jsdom does no layout and applies no Tailwind CSS. Nothing here proves the
 * chart LOOKS right; that is what the screenshot evidence in
 * design/dental-chart/evidence/ is for. This proves it is STRUCTURALLY intact.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Matches the repo's established vitest i18n pattern: a stable `t` identity
// returning the caller's defaultValue (or the raw key), so these tests assert
// structure rather than translated copy — locale parity has its own suites.
const mockT = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

import Odontogram from './Odontogram';
import {
  PERMANENT_FDI,
  PRIMARY_FDI,
  TOOTH_STATUSES,
  type ToothRecord,
  type ToothStatus,
} from '../dentalChart.types';
import { OCCLUSAL_SURFACE_NAMES } from './anatomy.types';

const NO_RECORDS = new Map<number, ToothRecord>();
const NO_PROCEDURES = new Map<number, never[]>();

function toothRecord(fdi: number, status: ToothStatus): ToothRecord {
  return {
    id: `rec-${fdi}`,
    toothFdi: fdi,
    status,
    note: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderChart(options: {
  dentition: 'permanent' | 'primary';
  records?: Map<number, ToothRecord>;
  selectedTooth?: number | null;
  onSelect?: (fdi: number) => void;
}) {
  const { dentition, records = NO_RECORDS, selectedTooth = null, onSelect = vi.fn() } = options;
  return render(
    <Odontogram
      dentition={dentition}
      records={records}
      procedureMap={NO_PROCEDURES as unknown as Map<number, never[]>}
      selectedTooth={selectedTooth}
      onSelect={onSelect}
      size="regular"
      patientMode={false}
    />,
  );
}

function fdisRendered(container: HTMLElement, view: 'lateral' | 'occlusal'): number[] {
  return Array.from(container.querySelectorAll(`svg[data-view="${view}"][data-tooth-fdi]`))
    .map((el) => Number(el.getAttribute('data-tooth-fdi')))
    .sort((a, b) => a - b);
}

describe('Odontogram — both dentitions render every tooth in both views', () => {
  it('renders all 32 permanent teeth, each with a lateral and an occlusal view', () => {
    const { container } = renderChart({ dentition: 'permanent' });
    const expected = [...PERMANENT_FDI].sort((a, b) => a - b);

    expect(expected).toHaveLength(32);
    expect(fdisRendered(container, 'lateral')).toEqual(expected);
    expect(fdisRendered(container, 'occlusal')).toEqual(expected);
  });

  it('renders all 20 primary teeth, each with a lateral and an occlusal view', () => {
    const { container } = renderChart({ dentition: 'primary' });
    const expected = [...PRIMARY_FDI].sort((a, b) => a - b);

    expect(expected).toHaveLength(20);
    expect(fdisRendered(container, 'lateral')).toEqual(expected);
    expect(fdisRendered(container, 'occlusal')).toEqual(expected);
  });

  it('never renders a permanent-only FDI on the primary chart', () => {
    const { container } = renderChart({ dentition: 'primary' });
    const rendered = new Set(fdisRendered(container, 'lateral'));
    // Positions 6/7/8 and every permanent quadrant digit must be absent —
    // a paediatric chart showing an FDI 16 is the loudest possible bug.
    for (const fdi of PERMANENT_FDI) {
      expect(rendered.has(fdi)).toBe(false);
    }
  });

  it('emits a single button per tooth, so the arch is one control per tooth and not two', () => {
    const { container } = renderChart({ dentition: 'permanent' });
    const buttons = container.querySelectorAll('button[data-tooth-fdi]');
    expect(buttons).toHaveLength(32);
  });
});

describe('Odontogram — the per-surface charting hook survives', () => {
  it('every occlusal view exposes all five addressable surface regions', () => {
    const { container } = renderChart({ dentition: 'permanent' });
    const occlusals = container.querySelectorAll('svg[data-view="occlusal"]');
    expect(occlusals).toHaveLength(32);

    for (const svg of Array.from(occlusals)) {
      const surfaces = Array.from(svg.querySelectorAll('[data-surface]')).map((el) =>
        el.getAttribute('data-surface'),
      );
      expect(new Set(surfaces)).toEqual(new Set(OCCLUSAL_SURFACE_NAMES));
    }
  });

  it('surface regions carry their own tooth FDI, so a future click handler can identify them without walking the DOM', () => {
    const { container } = renderChart({ dentition: 'primary' });
    const surfaces = container.querySelectorAll('svg[data-view="occlusal"] [data-surface]');
    expect(surfaces.length).toBe(20 * OCCLUSAL_SURFACE_NAMES.length);
    for (const el of Array.from(surfaces)) {
      expect(el.getAttribute('data-tooth-fdi')).toBeTruthy();
    }
  });
});

describe('Odontogram — clinical status still reaches the DOM', () => {
  it('renders every one of the seven stored statuses without dropping a tooth', () => {
    // One tooth per status, spread across quadrants so arch flips and side
    // mirrors are all exercised at once.
    const targets = [11, 16, 24, 27, 33, 38, 45];
    expect(targets).toHaveLength(TOOTH_STATUSES.length);

    const records = new Map<number, ToothRecord>();
    TOOTH_STATUSES.forEach((status, index) => {
      records.set(targets[index], toothRecord(targets[index], status));
    });

    const { container } = renderChart({ dentition: 'permanent', records });

    // Nothing is dropped: a status must never remove a tooth from the arch.
    expect(fdisRendered(container, 'lateral')).toHaveLength(32);
    expect(fdisRendered(container, 'occlusal')).toHaveLength(32);

    for (const fdi of targets) {
      const button = container.querySelector(`button[data-tooth-fdi="${fdi}"]`);
      expect(button, `tooth ${fdi} is missing from the arch`).not.toBeNull();
      expect(button!.getAttribute('data-tooth-status')).toBe(records.get(fdi)!.status);
    }
  });

  it('a tooth with no record carries no status, which is how "no record" is stored', () => {
    const { container } = renderChart({ dentition: 'permanent' });
    const button = container.querySelector('button[data-tooth-fdi="11"]');
    expect(button).not.toBeNull();
    const status = button!.getAttribute('data-tooth-status');
    expect(status === null || status === '').toBe(true);
  });

  it('a missing tooth still renders both of its views rather than disappearing', () => {
    const records = new Map<number, ToothRecord>([[18, toothRecord(18, 'missing')]]);
    const { container } = renderChart({ dentition: 'permanent', records });

    expect(container.querySelector('svg[data-view="lateral"][data-tooth-fdi="18"]')).not.toBeNull();
    expect(container.querySelector('svg[data-view="occlusal"][data-tooth-fdi="18"]')).not.toBeNull();
  });
});

describe('Odontogram — selection and interaction', () => {
  it('selecting a tooth marks that tooth and no other', () => {
    const { container } = renderChart({ dentition: 'permanent', selectedTooth: 26 });
    const selected = container.querySelectorAll('button[aria-pressed="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute('data-tooth-fdi')).toBe('26');
  });

  it('the selected tooth spans BOTH of its views, not just the lateral one', () => {
    const { container } = renderChart({ dentition: 'permanent', selectedTooth: 26 });
    const button = container.querySelector('button[data-tooth-fdi="26"]')!;
    // Both views live inside the one selected button, which is the mechanism
    // by which selection covers the lateral/occlusal pair.
    expect(button.querySelector('svg[data-view="lateral"]')).not.toBeNull();
    expect(button.querySelector('svg[data-view="occlusal"]')).not.toBeNull();
  });

  it('clicking a tooth reports that tooth’s FDI', () => {
    const onSelect = vi.fn();
    const { container } = renderChart({ dentition: 'permanent', onSelect });
    fireEvent.click(container.querySelector('button[data-tooth-fdi="47"]')!);
    expect(onSelect).toHaveBeenCalledWith(47);
  });

  it('the arch is a single tab stop with a roving tabindex, not 32 of them', () => {
    const { container } = renderChart({ dentition: 'permanent', selectedTooth: 11 });
    const focusable = Array.from(container.querySelectorAll('button[data-tooth-fdi]')).filter(
      (el) => el.getAttribute('tabindex') === '0',
    );
    expect(focusable.length).toBeLessThanOrEqual(2);
    expect(focusable.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Odontogram — orientation cues a clinician reads the chart by', () => {
  it('renders the R and L side markers', () => {
    renderChart({ dentition: 'permanent' });
    expect(screen.getAllByText('R').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('L').length).toBeGreaterThanOrEqual(1);
  });

  it('labels every tooth with its FDI number', () => {
    const { container } = renderChart({ dentition: 'primary' });
    const text = container.textContent ?? '';
    for (const fdi of PRIMARY_FDI) {
      expect(text).toContain(String(fdi));
    }
  });
});
