import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectFanoutReceivers, sendTypedNotification } from './notifier';
import { sendTelegramMessage } from './telegram';
import type { Env } from '../types';

vi.mock('./telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./telegram')>();
  return { ...actual, sendTelegramMessage: vi.fn(async () => true) };
});

const sendTelegramMessageMock = vi.mocked(sendTelegramMessage);

beforeEach(() => sendTelegramMessageMock.mockClear());

function makeEnv(kvStore: Map<string, string> = new Map()) {
  return {
    TELEGRAM_BOT_TOKEN: 't',
    STAFF_APP_URL: 'https://staff-attendance.ohcsghana.org',
    DB: {
      prepare: (sql: string) => ({
        bind: () => ({
          run: async () => ({}),
          first: async () => (sql.includes('directorates') ? { abbr: 'FIN' } : null),
          all: async () => ({ results: [] }),
        }),
      }),
    },
    KV: {
      get: async (k: string) => kvStore.get(k) ?? null,
      put: async (k: string, v: string) => { kvStore.set(k, v); },
      delete: async (k: string) => { kvStore.delete(k); },
    },
  } as unknown as Env;
}

describe('selectFanoutReceivers', () => {
  it('excludes the host/primary', () => {
    expect(selectFanoutReceivers([{ officer_id: 'a' }, { officer_id: 'b' }], 'a')).toEqual(['b']);
  });
  it('dedupes officer ids', () => {
    expect(selectFanoutReceivers([{ officer_id: 'b' }, { officer_id: 'b' }, { officer_id: 'c' }], 'a')).toEqual(['b', 'c']);
  });
  it('returns empty when only the host is a receiver', () => {
    expect(selectFanoutReceivers([{ officer_id: 'a' }], 'a')).toEqual([]);
  });
});

describe('sendTypedNotification — telegram delivery arm', () => {
  const base = { userId: 'u1', title: 'Clock in reminder', body: 'You have not clocked in.', url: '/' };

  it('sends Telegram for a whitelisted type with a KV-linked chat', async () => {
    const env = makeEnv(new Map([['telegram-user:u1', 'chat-123']]));
    await sendTypedNotification(env, { ...base, type: 'clock_reminder' });
    expect(sendTelegramMessageMock).toHaveBeenCalledTimes(1);
    const arg = sendTelegramMessageMock.mock.calls[0][0] as { chatId: string; text: string; token: string };
    expect(arg.chatId).toBe('chat-123');
    expect(arg.text).toContain('<b>Clock in reminder</b>');
    expect(arg.text).toContain('You have not clocked in.');
    expect(arg.text).toContain('https://staff-attendance.ohcsghana.org/');
    expect(arg.text).toContain('FIN Attendance');
  });

  it('does NOT send Telegram for visitor_arrival (already sent via its own path)', async () => {
    const env = makeEnv(new Map([['telegram-user:u1', 'chat-123']]));
    await sendTypedNotification(env, { ...base, type: 'visitor_arrival' });
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it('does not send (and does not throw) for a whitelisted type with no KV link', async () => {
    const env = makeEnv();
    await expect(sendTypedNotification(env, { ...base, type: 'clock_out_reminder' })).resolves.toBeUndefined();
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });
});
