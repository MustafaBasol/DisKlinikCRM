/**
 * SetupChecklist.vitest.test.tsx — UX-001C: the onboarding checklist must
 * stop permanently occupying dashboard space once every step is done,
 * without introducing a second "onboarding complete" source of truth (it
 * still reads/writes only its existing localStorage-backed done[] list).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import SetupChecklist from './SetupChecklist';

const mockT = (key: string, opts?: any) => opts?.defaultValue ?? key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

let mockUser: { role: string; canAccessAllClinics?: boolean } | null = null;
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock('../context/ClinicContext', () => ({
  useClinic: () => ({ selectedClinicId: 'clinic-test' }),
}));

const STORAGE_KEY = 'noramedi:setup-checklist:clinic-test';
const ALL_STEPS = ['clinic', 'team', 'services', 'patient', 'appointment'];

beforeEach(() => {
  window.localStorage.clear();
  mockUser = { role: 'owner', canAccessAllClinics: true };
});

describe('SetupChecklist', () => {
  it('renders for OWNER when steps are incomplete', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ dismissed: false, done: ['clinic'] }));
    render(<MemoryRouter><SetupChecklist /></MemoryRouter>);
    expect(screen.getByText('setup.title')).toBeTruthy();
  });

  it('hides once every step is marked done — no longer occupies dashboard space', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ dismissed: false, done: ALL_STEPS }));
    const { container } = render(<SetupChecklist />);
    expect(container.firstChild).toBeNull();
  });

  it('stays hidden once dismissed, regardless of progress', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ dismissed: true, done: [] }));
    const { container } = render(<SetupChecklist />);
    expect(container.firstChild).toBeNull();
  });

  it('is never shown to a RECEPTIONIST, complete or not', () => {
    mockUser = { role: 'receptionist', canAccessAllClinics: false };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ dismissed: false, done: [] }));
    const { container } = render(<SetupChecklist />);
    expect(container.firstChild).toBeNull();
  });
});
