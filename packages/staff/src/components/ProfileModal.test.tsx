import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ProfileModal } from './ProfileModal';
import { useAuthStore } from '@/stores/auth';
import { getTelegramStatus, createTelegramLinkToken } from '@/lib/telegramClient';

// The Profile sheet carries a PERMANENT Telegram entry point — unlike the
// clock-page banner it never consults the 14-day snooze key. These tests pin
// the two states (unlinked → Connect button, linked → Connected line), the
// snooze-key independence, and the connect → deep-link navigation.
vi.mock('@/lib/telegramClient', () => ({
  getTelegramStatus: vi.fn(),
  createTelegramLinkToken: vi.fn(),
}));

const mockedStatus = vi.mocked(getTelegramStatus);
const mockedLinkToken = vi.mocked(createTelegramLinkToken);

const testUser = {
  id: 'u1',
  name: 'Ama Serwaa',
  email: 'ama@ohcs.gov.gh',
  role: 'staff',
  staff_id: '1334685',
  pin_acknowledged: true,
};

function stubLocationAssign() {
  const assignMock = vi.fn();
  const original = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...original, assign: assignMock },
  });
  return assignMock;
}

describe('ProfileModal — Telegram reminders section', () => {
  beforeEach(() => {
    localStorage.clear();
    mockedStatus.mockReset();
    mockedLinkToken.mockReset();
    useAuthStore.setState({ user: testUser });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: window.location,
    });
    useAuthStore.setState({ user: null });
  });

  it('shows the Connect button when unlinked — even with the banner snooze key set', async () => {
    localStorage.setItem('ohcs.telegram.connect.dismissed_at', new Date().toISOString());
    mockedStatus.mockResolvedValue({ linked: false, entityAbbr: 'RSIMD' });
    render(<ProfileModal onClose={() => {}} />);
    expect(await screen.findByText('Telegram reminders')).toBeTruthy();
    expect(screen.getByText(/works even with the app closed/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeTruthy();
    expect(screen.queryByText(/Connected/)).toBeNull();
  });

  it('shows the Connected line when linked, with no Connect button', async () => {
    mockedStatus.mockResolvedValue({ linked: true, entityAbbr: 'RSIMD' });
    render(<ProfileModal onClose={() => {}} />);
    expect(await screen.findByText(/Connected/)).toBeTruthy();
    expect(screen.getByText(/reminders arrive on Telegram/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect Telegram' })).toBeNull();
  });

  it('Connect mints a link token and navigates to the t.me deep link', async () => {
    mockedStatus.mockResolvedValue({ linked: false, entityAbbr: null });
    mockedLinkToken.mockResolvedValue({ url: 'https://t.me/ohcsbot?start=abc123' });
    const assignMock = stubLocationAssign();
    render(<ProfileModal onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
    await waitFor(() => expect(mockedLinkToken).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('https://t.me/ohcsbot?start=abc123'));
  });

  it('re-fetches status on window focus and flips to Connected once linked', async () => {
    mockedStatus.mockResolvedValueOnce({ linked: false, entityAbbr: null });
    render(<ProfileModal onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Connect Telegram' })).toBeTruthy();

    mockedStatus.mockResolvedValueOnce({ linked: true, entityAbbr: 'RSIMD' });
    fireEvent(window, new Event('focus'));
    expect(await screen.findByText(/reminders arrive on Telegram/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect Telegram' })).toBeNull();
  });
});
