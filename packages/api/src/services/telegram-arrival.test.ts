import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  sendTelegramMessageWithId, sendTelegramPhoto,
  recordArrivalMessages, closeArrivalThread, formatDurationMinutes,
} from './telegram';
import type { Env } from '../types';

afterEach(() => vi.unstubAllGlobals());

function kvEnv(store: Map<string, string> = new Map()) {
  return {
    TELEGRAM_BOT_TOKEN: 't',
    KV: {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => { store.set(k, v); },
      delete: async (k: string) => { store.delete(k); },
    },
  } as unknown as Env;
}

const okJson = (messageId = 42) => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: messageId } }) });

describe('sendTelegramMessageWithId', () => {
  it('returns the message_id on a normal OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson(7)));
    expect(await sendTelegramMessageWithId({ chatId: '1', text: 'x', token: 't' })).toEqual({ ok: true, messageId: 7 });
  });
  it('treats a 2xx with an unparseable body as sent-but-untracked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));
    expect(await sendTelegramMessageWithId({ chatId: '1', text: 'x', token: 't' })).toEqual({ ok: true, messageId: null });
  });
  it('fails closed on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));
    expect(await sendTelegramMessageWithId({ chatId: '1', text: 'x', token: 't' })).toEqual({ ok: false, messageId: null });
  });
});

describe('sendTelegramPhoto', () => {
  it('posts multipart to sendPhoto and returns the message_id', async () => {
    const fetchMock = vi.fn(async () => okJson(9));
    vi.stubGlobal('fetch', fetchMock);
    const r = await sendTelegramPhoto({ chatId: '1', photo: new ArrayBuffer(8), caption: 'hi', token: 't' });
    expect(r).toEqual({ ok: true, messageId: 9 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/sendPhoto');
    expect(init.body).toBeInstanceOf(FormData);
  });
  it('fails closed on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 413 })));
    expect(await sendTelegramPhoto({ chatId: '1', photo: new ArrayBuffer(8), caption: 'hi', token: 't' })).toEqual({ ok: false, messageId: null });
  });
});

describe('formatDurationMinutes', () => {
  it('formats minutes, hours and edge cases', () => {
    expect(formatDurationMinutes(38)).toBe('38m');
    expect(formatDurationMinutes(98)).toBe('1h 38m');
    expect(formatDurationMinutes(60)).toBe('1h');
    expect(formatDurationMinutes(null)).toBe('');
  });
});

describe('arrival thread tracking', () => {
  it('recordArrivalMessages writes refs; closeArrivalThread edits text vs caption and deletes the key', async () => {
    const store = new Map<string, string>();
    const env = kvEnv(store);
    await recordArrivalMessages(env, 'v1', [
      { c: 'chatA', m: 10, p: 0 },
      { c: 'chatB', m: 11, p: 1 },
    ]);
    expect(store.get('tg-arrival:v1')).toBeTruthy();

    const fetchMock = vi.fn(async () => okJson());
    vi.stubGlobal('fetch', fetchMock);
    await closeArrivalThread(env, {
      id: 'v1', first_name: 'Ama', last_name: 'Serwaa', organisation: 'Ghana Ent',
      check_out_at: '2026-07-20T11:20:00Z', duration_minutes: 98,
    });

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('/editMessageText'))).toHaveLength(1);
    expect(urls.filter((u) => u.includes('/editMessageCaption'))).toHaveLength(1);
    expect(store.has('tg-arrival:v1')).toBe(false);
  });

  it('closeArrivalThread is a no-op when no thread was recorded', async () => {
    const fetchMock = vi.fn(async () => okJson());
    vi.stubGlobal('fetch', fetchMock);
    await closeArrivalThread(kvEnv(), { id: 'nope', first_name: 'A', last_name: 'B' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
