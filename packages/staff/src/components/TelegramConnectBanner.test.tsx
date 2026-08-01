import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { TelegramConnectBanner } from './TelegramConnectBanner';
import { getTelegramStatus } from '@/lib/telegramClient';

// The banner is the proactive Telegram-linking nudge on the clock page. These
// tests pin the gating logic: linked → never shown, unlinked → shown unless
// snoozed within the 14-day window, "Not now" writes the snooze timestamp.
vi.mock('@/lib/telegramClient', () => ({
  getTelegramStatus: vi.fn(),
  createTelegramLinkToken: vi.fn(),
}));

const mockedStatus = vi.mocked(getTelegramStatus);

describe('TelegramConnectBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    mockedStatus.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders nothing when the account is already linked', async () => {
    mockedStatus.mockResolvedValue({ linked: true, entityAbbr: 'RSIMD' });
    const { container } = render(<TelegramConnectBanner />);
    await waitFor(() => expect(mockedStatus).toHaveBeenCalledTimes(1));
    expect(container.firstChild).toBeNull();
  });

  it('shows the banner with the entity abbr when not linked and not snoozed', async () => {
    mockedStatus.mockResolvedValue({ linked: false, entityAbbr: 'RSIMD' });
    render(<TelegramConnectBanner />);
    expect(await screen.findByText('RSIMD Attendance Alerts')).toBeTruthy();
    expect(screen.getByText('Connect')).toBeTruthy();
    expect(screen.getByText('Not now')).toBeTruthy();
  });

  it('falls back to "OHCS" in the heading when entityAbbr is null', async () => {
    mockedStatus.mockResolvedValue({ linked: false, entityAbbr: null });
    render(<TelegramConnectBanner />);
    expect(await screen.findByText('OHCS Attendance Alerts')).toBeTruthy();
  });

  it('renders nothing when snoozed within the last 14 days', async () => {
    localStorage.setItem('ohcs.telegram.connect.dismissed_at', new Date().toISOString());
    mockedStatus.mockResolvedValue({ linked: false, entityAbbr: null });
    const { container } = render(<TelegramConnectBanner />);
    await waitFor(() => expect(mockedStatus).toHaveBeenCalledTimes(1));
    expect(container.firstChild).toBeNull();
  });

  it('re-asks when the snooze is older than 14 days', async () => {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem('ohcs.telegram.connect.dismissed_at', fifteenDaysAgo);
    mockedStatus.mockResolvedValue({ linked: false, entityAbbr: null });
    render(<TelegramConnectBanner />);
    expect(await screen.findByText('OHCS Attendance Alerts')).toBeTruthy();
  });

  it('"Not now" hides the banner and writes the dismiss timestamp', async () => {
    mockedStatus.mockResolvedValue({ linked: false, entityAbbr: null });
    const { container } = render(<TelegramConnectBanner />);
    fireEvent.click(await screen.findByText('Not now'));
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(localStorage.getItem('ohcs.telegram.connect.dismissed_at')).toBeTruthy();
  });

  it('renders nothing when the status fetch fails', async () => {
    mockedStatus.mockRejectedValue(new Error('network down'));
    const { container } = render(<TelegramConnectBanner />);
    await waitFor(() => expect(mockedStatus).toHaveBeenCalledTimes(1));
    expect(container.firstChild).toBeNull();
  });
});
