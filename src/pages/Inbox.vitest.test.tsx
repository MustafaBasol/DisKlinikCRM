/**
 * Inbox.vitest.test.tsx — UX-001: unified inbox navigation shell.
 *
 * Covers the tab bar / permission / redirect logic in Inbox.tsx only.
 * WhatsAppInbox and InstagramInbox are large, already-tested real pages
 * with their own network calls — they're stubbed out here so this test
 * exercises the shell, not their internals.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import Inbox from './Inbox';

const mockT = (key: string, opts?: any) => opts?.defaultValue ?? key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

let mockUser: { role: string; canAccessAllClinics?: boolean } | null = null;
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock('./WhatsAppInbox', () => ({
  default: () => <div>whatsapp-inbox-stub</div>,
}));

vi.mock('./InstagramInbox', () => ({
  default: () => <div>instagram-inbox-stub</div>,
}));

// canViewWhatsAppInbox and canViewInstagramInbox currently resolve to the
// exact same role set in ../utils/permissions (both: OWNER, ORG_ADMIN,
// CLINIC_MANAGER, RECEPTIONIST), so no real role can have one without the
// other today. To exercise the "only one channel permitted" branch of
// Inbox.tsx's own logic (independent of whatever permissions.ts happens to
// return), these two functions are mocked per-test below; all other
// exports pass through to the real, unmodified module.
let mockCanViewWhatsAppInbox = true;
let mockCanViewInstagramInbox = true;
vi.mock('../utils/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/permissions')>();
  return {
    ...actual,
    canViewWhatsAppInbox: (...args: unknown[]) => mockCanViewWhatsAppInbox,
    canViewInstagramInbox: (...args: unknown[]) => mockCanViewInstagramInbox,
  };
});

beforeEach(() => {
  mockUser = null;
  mockCanViewWhatsAppInbox = true;
  mockCanViewInstagramInbox = true;
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/inbox/:channel" element={<Inbox />} />
        <Route path="/dashboard" element={<div>dashboard-stub</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Inbox', () => {
  it('shows both WhatsApp and Instagram tabs for a user with both permissions, with All disabled', () => {
    mockUser = { role: 'owner', canAccessAllClinics: true };
    renderAt('/inbox/whatsapp');

    const whatsappTab = screen.getByText('inbox:tabs.whatsapp');
    const instagramTab = screen.getByText('inbox:tabs.instagram');
    const allTab = screen.getByText('inbox:tabs.all');

    expect(whatsappTab).toBeTruthy();
    expect(instagramTab).toBeTruthy();
    expect(allTab).toBeTruthy();
    expect((allTab.closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not show an Instagram tab for a user with only WhatsApp permission, and /inbox lands on WhatsApp', () => {
    mockUser = { role: 'receptionist', canAccessAllClinics: false };
    mockCanViewInstagramInbox = false;
    renderAt('/inbox');

    expect(screen.getByText('whatsapp-inbox-stub')).toBeTruthy();
    expect(screen.queryByText('inbox:tabs.instagram')).toBeNull();
  });

  it('redirects a user with neither permission to /dashboard', () => {
    mockUser = { role: 'dentist', canAccessAllClinics: false };
    mockCanViewWhatsAppInbox = false;
    mockCanViewInstagramInbox = false;
    renderAt('/inbox');

    expect(screen.getByText('dashboard-stub')).toBeTruthy();
  });

  it('redirects an invalid channel to the first permitted channel', () => {
    mockUser = { role: 'owner', canAccessAllClinics: true };
    renderAt('/inbox/sms');

    expect(screen.getByText('whatsapp-inbox-stub')).toBeTruthy();
  });
});
