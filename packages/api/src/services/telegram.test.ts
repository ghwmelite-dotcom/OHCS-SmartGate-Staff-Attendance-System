import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendTelegramMessage, parseCommand, BOT_COMMANDS } from './telegram';

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

describe('parseCommand', () => {
  it('splits command and args', () => {
    expect(parseCommand('/link 123')).toEqual({ command: 'link', args: '123' });
  });
  it('returns empty args for a bare command', () => {
    expect(parseCommand('/help')).toEqual({ command: 'help', args: '' });
  });
  it('keeps the full remainder as args', () => {
    expect(parseCommand('/start tok')).toEqual({ command: 'start', args: 'tok' });
  });
  it('strips a @BotName suffix and lowercases', () => {
    expect(parseCommand('/Start@ohcs_smartgate_bot tok')).toEqual({ command: 'start', args: 'tok' });
  });
  it('trims surrounding whitespace', () => {
    expect(parseCommand('   /status  ')).toEqual({ command: 'status', args: '' });
  });
  it('returns null for non-commands and a lone slash', () => {
    expect(parseCommand('hello')).toBeNull();
    expect(parseCommand('/')).toBeNull();
  });
});

describe('BOT_COMMANDS', () => {
  it('every entry is a valid Telegram command + non-empty description', () => {
    expect(BOT_COMMANDS.length).toBeGreaterThan(0);
    for (const c of BOT_COMMANDS) {
      expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.description.length).toBeLessThanOrEqual(256);
    }
  });
});
