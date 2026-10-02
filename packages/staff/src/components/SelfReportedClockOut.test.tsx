import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SelfReportedClockOut } from './SelfReportedClockOut';
import { api, fetchClockPrompt } from '@/lib/api';

vi.mock('@/lib/api', () => ({ api: { post: vi.fn() }, fetchClockPrompt: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => ({ startAuthentication: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchClockPrompt).mockResolvedValue({ promptId: 'prompt', challengeAction: 'blink', expiresAt: Date.now() + 60000 });
  vi.mocked(api.post).mockResolvedValue({ data: {}, error: null });
});
afterEach(cleanup);

function open() {
  const recorded = vi.fn();
  render(<SelfReportedClockOut attendanceDate="2026-10-02" onRecorded={recorded} />);
  fireEvent.click(screen.getByRole('button', { name: 'Already left the office?' }));
  fireEvent.change(screen.getByLabelText('Your 6-digit PIN'), { target: { value: '123456' } });
  return recorded;
}

describe('SelfReportedClockOut', () => {
  it('sends Just left without client time, GPS or camera evidence', async () => {
    const recorded = open();
    fireEvent.submit(screen.getByRole('form', { name: 'Record your departure' }));
    await waitFor(() => expect(recorded).toHaveBeenCalledOnce());
    expect(api.post).toHaveBeenCalledWith('/clock/self-report-out', { idempotency_key: expect.any(String), prompt_id: 'prompt', pin: '123456' });
  });
  it('uses Ghana date/time for an earlier departure', async () => {
    const recorded = open();
    fireEvent.click(screen.getByLabelText('Left earlier today'));
    fireEvent.change(screen.getByLabelText('Departure time (Ghana time)'), { target: { value: '14:15' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Record your departure' }));
    await waitFor(() => expect(recorded).toHaveBeenCalledOnce());
    expect(api.post).toHaveBeenCalledWith('/clock/self-report-out', expect.objectContaining({ departure_at: '2026-10-02T14:15:00.000Z' }));
  });
  it('keeps retry identity and never claims success on a network error', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('Network unavailable'));
    const recorded = open();
    fireEvent.submit(screen.getByRole('form', { name: 'Record your departure' }));
    expect(await screen.findByText('Network unavailable')).toBeTruthy();
    expect(recorded).not.toHaveBeenCalled();
    const first = vi.mocked(api.post).mock.calls[0]?.[1];
    fireEvent.submit(screen.getByRole('form', { name: 'Record your departure' }));
    await waitFor(() => expect(recorded).toHaveBeenCalledOnce());
    expect(vi.mocked(api.post).mock.calls[1]?.[1]).toEqual(first);
  });
  it('cancels without a mutation', () => {
    open(); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Your 6-digit PIN')).toBeNull();
  });
});
