import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { submitClock } from './api';

// Regression: the liveness (multipart) submit path used to post to
// `/api/clock/` — Hono's strict routing 404s the trailing-slash form with a
// plain-text "404 Not Found" body, which then surfaced to staff as the raw
// V8 error "Unexpected non-whitespace character after JSON at position 4".
// These tests pin the exact URL and the non-JSON response handling.

const OK_ENVELOPE = JSON.stringify({
  data: {
    id: 'rec-1', type: 'clock_in', timestamp: '2026-07-27T08:00:00.000Z',
    user_name: 'Test User', staff_id: '123456', within_geofence: true,
    distance_meters: 0, streak: 1, longest_streak: 1,
  },
  error: null,
});

function mockFetchOnce(status: number, body: string) {
  const spy = vi.fn().mockResolvedValue(new Response(body, { status }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('submitClock', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the liveness multipart submit to /api/clock (no trailing slash)', async () => {
    const spy = mockFetchOnce(200, OK_ENVELOPE);
    const frame = new Blob(['x'], { type: 'image/jpeg' });
    await submitClock({
      type: 'clock_in',
      latitude: 5.5526,
      longitude: -0.1975,
      accuracy: 10,
      livenessBurst: { frame0: frame, frame1: frame, frame2: frame, claimedCompleted: true },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/clock');
    expect(url.endsWith('/')).toBe(false);
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('posts the JSON submit to /api/clock (no trailing slash)', async () => {
    const spy = mockFetchOnce(200, OK_ENVELOPE);
    await submitClock({ type: 'clock_out', latitude: 5.5526, longitude: -0.1975, accuracy: 12 });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/clock');
    expect(typeof init.body).toBe('string');
  });

  it('turns a non-JSON response (e.g. plain-text 404) into a clear error, not a raw SyntaxError', async () => {
    mockFetchOnce(404, '404 Not Found');
    const frame = new Blob(['x'], { type: 'image/jpeg' });
    const err = await submitClock({
      type: 'clock_in',
      latitude: 5.5526,
      longitude: -0.1975,
      livenessBurst: { frame0: frame, frame1: frame, frame2: frame, claimedCompleted: false },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const e = err as Error & { code?: string };
    expect(e.code).toBe('BAD_RESPONSE');
    expect(e.message).toContain('HTTP 404');
    expect(e.message).not.toContain('JSON');
  });
});
