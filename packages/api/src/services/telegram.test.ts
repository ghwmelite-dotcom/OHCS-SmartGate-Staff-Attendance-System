import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendTelegramMessage, parseCommand, BOT_COMMANDS, buildArrivalKeyboard, parseArrivalCallback, ARRIVAL_ACTIONS } from './telegram';

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

describe('buildArrivalKeyboard', () => {
  it('builds one row with the three arrival actions in order', () => {
    const kb = buildArrivalKeyboard('visit123');
    expect(kb.inline_keyboard).toHaveLength(1);
    const row = kb.inline_keyboard[0]!;
    expect(row).toHaveLength(3);
    expect(row.map((b) => b.callback_data)).toEqual([
      'va:visit123:coming_down',
      'va:visit123:waiting_area',
      'va:visit123:reschedule',
    ]);
    expect(row.map((b) => b.text)).toEqual([
      `${ARRIVAL_ACTIONS.coming_down.emoji} ${ARRIVAL_ACTIONS.coming_down.label}`,
      `${ARRIVAL_ACTIONS.waiting_area.emoji} ${ARRIVAL_ACTIONS.waiting_area.label}`,
      `${ARRIVAL_ACTIONS.reschedule.emoji} ${ARRIVAL_ACTIONS.reschedule.label}`,
    ]);
  });
  it('keeps callback_data within Telegram’s 64-byte limit for real visit ids', () => {
    const visitId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'; // lower(hex(randomblob(16)))
    for (const btn of buildArrivalKeyboard(visitId).inline_keyboard[0]!) {
      expect(btn.callback_data.length).toBeLessThanOrEqual(64);
    }
  });
});

describe('parseArrivalCallback', () => {
  it('parses each of the three valid actions', () => {
    expect(parseArrivalCallback('va:abc:coming_down')).toEqual({ visitId: 'abc', action: 'coming_down' });
    expect(parseArrivalCallback('va:abc:waiting_area')).toEqual({ visitId: 'abc', action: 'waiting_area' });
    expect(parseArrivalCallback('va:abc:reschedule')).toEqual({ visitId: 'abc', action: 'reschedule' });
  });
  it('rejects a bad prefix', () => {
    expect(parseArrivalCallback('vb:abc:coming_down')).toBeNull();
    expect(parseArrivalCallback('abc:coming_down')).toBeNull();
  });
  it('rejects an unknown action', () => {
    expect(parseArrivalCallback('va:abc:on_my_way')).toBeNull();
  });
  it('rejects malformed payloads', () => {
    expect(parseArrivalCallback('')).toBeNull();
    expect(parseArrivalCallback('va')).toBeNull();
    expect(parseArrivalCallback('va:abc')).toBeNull();
    expect(parseArrivalCallback('va::coming_down')).toBeNull();
    expect(parseArrivalCallback('va:abc:coming_down:extra')).toBeNull();
  });
});
