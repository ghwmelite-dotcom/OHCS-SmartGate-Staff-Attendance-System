import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AbsenceNoticeButton } from './AbsenceNoticeButton';
import { api } from '@/lib/api';

// Retract flow: when a notice covers today the static chip gains a Withdraw
// action with an inline confirm step; confirming DELETEs the notice and
// invalidates the `absence-notice-today` query so the normal clock UI returns.
// A 404 from DELETE means the notice is already gone — same end state.
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    del: vi.fn(),
  },
  apiErrorStatus: (err: unknown) =>
    err instanceof Error && typeof (err as { status?: unknown }).status === 'number'
      ? (err as { status: number }).status
      : null,
}));

const mockedGet = vi.mocked(api.get);
const mockedDel = vi.mocked(api.del);

const NOTICE = {
  id: 'n1',
  reason: 'sick',
  note: 'clinic visit',
  notice_date: '2026-08-02',
  expected_return_date: '2026-08-03',
};

function renderButton() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AbsenceNoticeButton />
    </QueryClientProvider>,
  );
}

describe('AbsenceNoticeButton withdraw', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedDel.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it('confirm step: Withdraw → confirm → DELETE → chip un-reports', async () => {
    mockedGet
      .mockResolvedValueOnce({ data: NOTICE, error: null } as never)
      .mockResolvedValue({ data: null, error: null } as never);
    mockedDel.mockResolvedValue({ data: { deleted: true }, error: null } as never);

    renderButton();
    fireEvent.click(await screen.findByRole('button', { name: /withdraw/i }));

    expect(screen.getByText(/you can then clock in normally/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^withdraw$/i }));

    await waitFor(() => expect(mockedDel).toHaveBeenCalledWith('/attendance/absence-notice/today'));
    expect(await screen.findByText(/can't make it today/i)).toBeTruthy();
  });

  it('Cancel backs out of the confirm step without calling DELETE', async () => {
    mockedGet.mockResolvedValue({ data: NOTICE, error: null } as never);

    renderButton();
    fireEvent.click(await screen.findByRole('button', { name: /withdraw/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(mockedDel).not.toHaveBeenCalled();
    expect(screen.getByText(/reported absence today/i)).toBeTruthy();
  });

  it('a 404 from DELETE still un-reports (notice already gone)', async () => {
    mockedGet
      .mockResolvedValueOnce({ data: NOTICE, error: null } as never)
      .mockResolvedValue({ data: null, error: null } as never);
    mockedDel.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));

    renderButton();
    fireEvent.click(await screen.findByRole('button', { name: /withdraw/i }));
    fireEvent.click(screen.getByRole('button', { name: /^withdraw$/i }));

    expect(await screen.findByText(/can't make it today/i)).toBeTruthy();
  });
});
