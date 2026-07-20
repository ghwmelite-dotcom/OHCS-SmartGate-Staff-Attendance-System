import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatVisitorMessage, partyLine, sendArrivalAlert, arrivalPhotoKey } from './notifier';
import type { Env } from '../types';

afterEach(() => vi.unstubAllGlobals());

const BASE = {
  visit_id: 'v1',
  host_officer_id: 'o1',
  first_name: 'Ama',
  last_name: 'Serwaa',
  organisation: 'Ghana Ent',
  purpose_raw: 'Contract discussion',
  purpose_category: null,
  badge_code: 'OHCS-X7K2P9',
  check_in_at: '2026-07-20T09:42:00Z',
  directorate_id: 'd1',
  directorate_abbr: 'CSU',
};

describe('partyLine', () => {
  it('is null for solo visits (absent, null, or 1)', () => {
    expect(partyLine({ ...BASE })).toBeNull();
    expect(partyLine({ ...BASE, party_size: 1, party_names: '[]' })).toBeNull();
  });
  it('names the accompanying members when present', () => {
    expect(partyLine({ ...BASE, party_size: 3, party_names: '["Kofi D","Efua M"]' }))
      .toBe('With 2 others: Kofi D, Efua M');
  });
  it('falls back to count-only when names are missing or malformed', () => {
    expect(partyLine({ ...BASE, party_size: 2, party_names: null })).toBe('With 1 other');
    expect(partyLine({ ...BASE, party_size: 2, party_names: '{bad json' })).toBe('With 1 other');
  });
  it('escapes HTML in names', () => {
    expect(partyLine({ ...BASE, party_size: 2, party_names: '["<b>X</b>"]' })).toBe('With 1 other: &lt;b&gt;X&lt;/b&gt;');
  });
});

describe('formatVisitorMessage', () => {
  it('host format: action wording, no status line', () => {
    const msg = formatVisitorMessage({ ...BASE, host_name: 'Nana Adjei', host_availability: 'in_meeting' }, 'host');
    expect(msg).toContain('You have a visitor');
    expect(msg).toContain('<b>Ama Serwaa</b> (Ghana Ent)');
    expect(msg).toContain('Purpose: Contract discussion');
    expect(msg).toContain('Badge: <code>OHCS-X7K2P9</code>');
    expect(msg).not.toContain('Host status');
  });

  it('fanout format: names the host and shows the cover status when not available', () => {
    const msg = formatVisitorMessage({ ...BASE, host_name: 'Nana Adjei', host_availability: 'in_meeting' }, 'fanout');
    expect(msg).toContain('<b>Visitor for Nana Adjei</b>');
    expect(msg).toContain("Host status: In a meeting — you're receiving this as cover");
  });

  it('fanout format: no status line when the host is available or status is null', () => {
    expect(formatVisitorMessage({ ...BASE, host_name: 'Nana Adjei', host_availability: 'available' }, 'fanout')).not.toContain('Host status');
    expect(formatVisitorMessage({ ...BASE, host_name: 'Nana Adjei', host_availability: null }, 'fanout')).not.toContain('Host status');
  });

  it('fanout format: falls back to a generic header without a host name', () => {
    expect(formatVisitorMessage({ ...BASE, host_name: null }, 'fanout')).toContain('<b>Visitor for your directorate</b>');
  });

  it('party line appears in every format for delegations', () => {
    const party = { party_size: 2, party_names: '["Kofi D"]' };
    expect(formatVisitorMessage({ ...BASE, ...party }, 'host')).toContain('With 1 other: Kofi D');
    expect(formatVisitorMessage({ ...BASE, ...party }, 'fanout')).toContain('With 1 other: Kofi D');
    expect(formatVisitorMessage({ ...BASE, ...party }, 'director')).toContain('With 1 other: Kofi D');
  });

  it('director format stays FYI with the directorate line', () => {
    const msg = formatVisitorMessage(BASE, 'director');
    expect(msg).toContain('Directorate Visitor');
    expect(msg).toContain('Directorate: CSU');
    expect(msg).not.toContain('Host status');
  });
});


function arrivalEnv(storageGet: (key: string) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> } | null>) {
  const store = new Map<string, string>();
  return {
    TELEGRAM_BOT_TOKEN: 't',
    KV: {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => { store.set(k, v); },
      delete: async (k: string) => { store.delete(k); },
    },
    STORAGE: { get: storageGet },
  } as unknown as Env;
}

const okJson = (messageId: number) => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: messageId } }) });

describe('arrivalPhotoKey', () => {
  it('derives the object key from the visitor id, never from photo_url', () => {
    expect(arrivalPhotoKey({ ...BASE, visitor_id: 'v123', photo_url: '/api/kiosk/visitors/v123/photo' }))
      .toBe('photos/visitors/v123.jpg');
    expect(arrivalPhotoKey({ ...BASE, visitor_id: 'v123', photo_url: null })).toBeNull();
    expect(arrivalPhotoKey({ ...BASE, visitor_id: null, photo_url: '/api/kiosk/visitors/v123/photo' })).toBeNull();
  });
});

describe('sendArrivalAlert', () => {
  it('fetches the R2 object by key and sends a photo message', async () => {
    const keys: string[] = [];
    const fetchMock = vi.fn(async () => okJson(5));
    vi.stubGlobal('fetch', fetchMock);
    const env = arrivalEnv(async (key) => { keys.push(key); return { arrayBuffer: async () => new ArrayBuffer(8) }; });
    const r = await sendArrivalAlert(env, { chatId: 'c1', text: 'hello', photoKey: 'photos/visitors/v123.jpg' });
    expect(r).toEqual({ messageId: 5, photo: true });
    expect(keys).toEqual(['photos/visitors/v123.jpg']);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/sendPhoto');
  });

  it('falls back to plain text when the object is missing', async () => {
    const fetchMock = vi.fn(async () => okJson(6));
    vi.stubGlobal('fetch', fetchMock);
    const env = arrivalEnv(async () => null);
    const r = await sendArrivalAlert(env, { chatId: 'c1', text: 'hello', photoKey: 'photos/visitors/none.jpg' });
    expect(r).toEqual({ messageId: 6, photo: false });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/sendMessage');
  });
});
