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
          first: async () => (sql.includes('directorates') ? { abbr: 'FIN', name: 'Kwame Mensah' } : null),
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
    expect(arg.text).toContain('Hi <b>Kwame</b>');
  });

  it('omits the greeting line when the user has no name', async () => {
    const env = makeEnv(new Map([['telegram-user:u1', 'chat-123']]));
    // name-less user row
    (env.DB as { prepare: unknown }).prepare = (sql: string) => ({
      bind: () => ({
        run: async () => ({}),
        first: async () => (sql.includes('directorates') ? { abbr: null, name: null } : null),
        all: async () => ({ results: [] }),
      }),
    });
    await sendTypedNotification(env, { ...base, type: 'clock_reminder' });
    const arg = sendTelegramMessageMock.mock.calls[0][0] as { text: string };
    expect(arg.text).not.toContain('Hi <b>');
    expect(arg.text).toContain('OHCS Attendance');
  });

  it('sends Telegram for a clock confirmation with a KV-linked chat', async () => {
    const env = makeEnv(new Map([['telegram-user:u1', 'chat-123']]));
    await sendTypedNotification(env, { ...base, type: 'clock_in_confirmation', title: 'Clocked in ✅' });
    expect(sendTelegramMessageMock).toHaveBeenCalledTimes(1);
    const arg = sendTelegramMessageMock.mock.calls[0][0] as { chatId: string; text: string };
    expect(arg.chatId).toBe('chat-123');
    expect(arg.text).toContain('Hi <b>Kwame</b>');
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

  it('sends via the attendance bot token when TELEGRAM_ATTENDANCE_BOT_TOKEN is set', async () => {
    const env = makeEnv(new Map([['telegram-user:u1', 'chat-123']]));
    env.TELEGRAM_ATTENDANCE_BOT_TOKEN = 'att-tok';
    await sendTypedNotification(env, { ...base, type: 'clock_reminder' });
    expect(sendTelegramMessageMock).toHaveBeenCalledTimes(1);
    const arg = sendTelegramMessageMock.mock.calls[0][0] as { chatId: string; token: string };
    expect(arg.chatId).toBe('chat-123');
    expect(arg.token).toBe('att-tok');
  });

  it('falls back to the main bot token when the attendance token is unset', async () => {
    const env = makeEnv(new Map([['telegram-user:u1', 'chat-123']]));
    await sendTypedNotification(env, { ...base, type: 'clock_out_reminder' });
    expect(sendTelegramMessageMock).toHaveBeenCalledTimes(1);
    const arg = sendTelegramMessageMock.mock.calls[0][0] as { token: string };
    expect(arg.token).toBe('t');
  });
});
