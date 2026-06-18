import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendTelegramMessage, parseStartToken } from './telegram';

afterEach(() => vi.unstubAllGlobals());

describe('sendTelegramMessage', () => {
  it('returns true on an OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));
    expect(await sendTelegramMessage({ chatId: '1', text: 'x', token: 't' })).toBe(true);
  });
  it('returns false and warns on a non-OK response', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));
    expect(await sendTelegramMessage({ chatId: '1', text: 'x', token: 't' })).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it('returns false when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    expect(await sendTelegramMessage({ chatId: '1', text: 'x', token: 't' })).toBe(false);
  });
});

describe('parseStartToken', () => {
  it('extracts the token after /start', () => {
    expect(parseStartToken('/start abc123')).toBe('abc123');
  });
  it('takes only the first whitespace-delimited token', () => {
    expect(parseStartToken('/start abc def')).toBe('abc');
  });
  it('returns null for bare /start', () => {
    expect(parseStartToken('/start')).toBeNull();
    expect(parseStartToken('/start   ')).toBeNull();
  });
  it('returns null for non-start text', () => {
    expect(parseStartToken('/link 123')).toBeNull();
  });
});
