import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AbsenceNoticeModal } from './AbsenceNoticeModal';
import { api } from '@/lib/api';

// Premium absence form: note + expected-back are now REQUIRED (server 400s
// otherwise). These tests pin the client-side validity gate (submit disabled
// until reason + note (2-200) + return date are all set), the Other → "Please
// specify" label swap, the quick-pick chip date math, and the exact POST body.
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    del: vi.fn(),
  },
}));

const mockedPost = vi.mocked(api.post);

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
}
function readable(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AbsenceNoticeModal onClose={() => {}} />
    </QueryClientProvider>,
  );
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /send notice/i }) as HTMLButtonElement;
}

describe('AbsenceNoticeModal', () => {
  beforeEach(() => {
    mockedPost.mockReset();
    mockedPost.mockResolvedValue({ data: { id: 'n1' }, error: null } as never);
  });
  afterEach(() => {
    cleanup();
  });

  it('keeps submit disabled until reason, note (2+ chars) and return date are all valid', () => {
    renderModal();
    expect(submitButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /sick/i }));
    expect(submitButton().disabled).toBe(true);

    const note = screen.getByPlaceholderText(/clinic visit/i);
    fireEvent.change(note, { target: { value: 'a' } });
    expect(submitButton().disabled).toBe(true);

    fireEvent.change(note, { target: { value: 'ab' } });
    expect(submitButton().disabled).toBe(true); // still no date

    fireEvent.click(screen.getByRole('button', { name: /^tomorrow$/i }));
    expect(submitButton().disabled).toBe(false);
  });

  it('switches the note label to "Please specify" for Other and requires it', () => {
    renderModal();
    expect(screen.getByText(/brief detail/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /other/i }));
    expect(screen.getByText(/please specify/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/tell us briefly/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^tomorrow$/i }));
    expect(submitButton().disabled).toBe(true); // note still empty

    fireEvent.change(screen.getByPlaceholderText(/tell us briefly/i), { target: { value: 'x' } });
    expect(submitButton().disabled).toBe(true); // 1 char < min 2
  });

  it('quick-pick chips compute +1d / +2d / +7d and show the resolved date', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^tomorrow$/i }));
    expect(screen.getByText(`Back on ${readable(addDays(1))}`)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^2 days$/i }));
    expect(screen.getByText(`Back on ${readable(addDays(2))}`)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^1 week$/i }));
    expect(screen.getByText(`Back on ${readable(addDays(7))}`)).toBeTruthy();
  });

  it('"Pick a date" reveals the native date input bounded to tomorrow..today+30d', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /pick a date/i }));
    const input = screen.getByLabelText(/pick a return date/i) as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input.min).toBe(addDays(1));
    expect(input.max).toBe(addDays(30));
  });

  it('posts the exact required body when the form is valid', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /sick/i }));
    fireEvent.change(screen.getByPlaceholderText(/clinic visit/i), { target: { value: 'clinic visit' } });
    fireEvent.click(screen.getByRole('button', { name: /^2 days$/i }));
    fireEvent.click(submitButton());

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(mockedPost).toHaveBeenCalledWith('/attendance/absence-notice', {
      reason: 'sick',
      note: 'clinic visit',
      expected_return_date: addDays(2),
    });
    expect(await screen.findByText(/your director has been notified/i)).toBeTruthy();
  });
});
