import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendTelegramMessage } from './telegram';

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
