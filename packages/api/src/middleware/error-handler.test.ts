import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { authRoutes } from '../routes/auth';
import { errorHandler } from './error-handler';
import { alertAdminError } from '../lib/error-alert';

vi.mock('../lib/error-alert', () => ({ alertAdminError: vi.fn(async () => {}) }));

const env = { ENVIRONMENT: 'production' };
const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe('errorHandler', () => {
  for (const path of ['/api/auth/login', '/api/auth/pin-login']) {
    for (const body of ['{', '']) {
      it(`returns 400 without alerting for ${path}, body=${JSON.stringify(body)}`, async () => {
        const app = new Hono().onError(errorHandler).route('/api/auth', authRoutes);
        const res = await app.request(path, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        }, env, ctx);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ data: null, error: { code: 'BAD_REQUEST', message: 'Invalid request body or parameters' } });
        expect(alertAdminError).not.toHaveBeenCalled();
        expect(console.error).not.toHaveBeenCalled();
        expect(ctx.waitUntil).not.toHaveBeenCalled();
      });
    }
  }

  it('preserves a client error status and headers without exposing its details', async () => {
    const app = new Hono().onError(errorHandler);
    app.get('/', () => { throw new HTTPException(429, {
      message: 'private internal detail',
      res: new Response('private body', { status: 429, headers: { 'Retry-After': '60', 'Content-Length': '12' } }),
    }); });
    const res = await app.request('/', {}, env, ctx);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(res.headers.get('Content-Length')).toBeNull();
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(await res.text()).not.toContain('private');
    expect(alertAdminError).not.toHaveBeenCalled();
  });

  it.each([new Error('database unavailable'), new HTTPException(503, { message: 'upstream unavailable' }), new SyntaxError('internal parsing bug')])(
    'still alerts and hides details for unexpected/server errors: %s', async (err) => {
      const app = new Hono().onError(errorHandler);
      app.get('/', () => { throw err; });
      const res = await app.request('/', {}, env, ctx);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ data: null, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
      expect(alertAdminError).toHaveBeenCalledWith(env, 'GET /', err);
      expect(ctx.waitUntil).toHaveBeenCalledOnce();
    },
  );
});
