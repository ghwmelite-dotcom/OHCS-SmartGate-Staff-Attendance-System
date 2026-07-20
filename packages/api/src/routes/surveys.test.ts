import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KioskSurveySchema } from '../lib/validation';
import { mintSurveyToken, consumeSurveyToken } from '../services/survey-token';
import type { Env } from '../types';

const ROUTES_DIR = dirname(fileURLToPath(import.meta.url));

function fakeEnv() {
  const store = new Map<string, string>();
  return {
    KV: {
      put: async (k: string, v: string) => { store.set(k, v); },
      get: async (k: string) => store.get(k) ?? null,
      delete: async (k: string) => { store.delete(k); },
    },
  } as unknown as Env;
}

describe('KioskSurveySchema', () => {
  const token = crypto.randomUUID();

  it('accepts a full payload and a rating-only one', () => {
    expect(KioskSurveySchema.safeParse({ token, rating: 5, comment: 'Swift service' }).success).toBe(true);
    expect(KioskSurveySchema.safeParse({ token, rating: 1 }).success).toBe(true);
  });

  it('rejects out-of-range ratings and non-uuid tokens', () => {
    expect(KioskSurveySchema.safeParse({ token, rating: 0 }).success).toBe(false);
    expect(KioskSurveySchema.safeParse({ token, rating: 6 }).success).toBe(false);
    expect(KioskSurveySchema.safeParse({ token, rating: 2.5 }).success).toBe(false);
    expect(KioskSurveySchema.safeParse({ token: 'not-a-uuid', rating: 4 }).success).toBe(false);
    expect(KioskSurveySchema.safeParse({ rating: 4 }).success).toBe(false);
  });

  it('rejects comments over 500 chars', () => {
    expect(KioskSurveySchema.safeParse({ token, rating: 4, comment: 'A'.repeat(501) }).success).toBe(false);
    expect(KioskSurveySchema.safeParse({ token, rating: 4, comment: 'A'.repeat(500) }).success).toBe(true);
  });
});

describe('survey-token', () => {
  it('round-trips a minted token', async () => {
    const env = fakeEnv();
    const t = await mintSurveyToken(env, 'visit-1');
    expect(await consumeSurveyToken(env, t)).toBe('visit-1');
  });

  it('is single-use — a second consume returns null', async () => {
    const env = fakeEnv();
    const t = await mintSurveyToken(env, 'visit-2');
    await consumeSurveyToken(env, t);
    expect(await consumeSurveyToken(env, t)).toBeNull();
  });

  it('returns null for unknown tokens', async () => {
    expect(await consumeSurveyToken(fakeEnv(), crypto.randomUUID())).toBeNull();
  });
});

// Source-scan guards (same idiom as visitors-flag.test.ts): the survey read
// endpoints serve the Client Service tier and must stay role-gated; the kiosk
// checkout handlers are the only minters of survey tokens; the migration must
// stay LAST in the index (additive-only convention).
describe('survey wiring guards', () => {
  const surveysSrc = readFileSync(join(ROUTES_DIR, 'surveys.ts'), 'utf8');
  const kioskSrc = readFileSync(join(ROUTES_DIR, 'kiosk.ts'), 'utf8');

  it('guards list and summary with reception-tier requireRole', () => {
    const guards = surveysSrc.match(/requireRole\(c, \.\.\.SURVEY_ROLES\)/g) ?? [];
    expect(guards.length).toBe(2);
    expect(surveysSrc).toContain("'superadmin', 'admin', 'receptionist'");
  });

  it('mints a survey_token in both kiosk checkout handlers', () => {
    const mints = kioskSrc.match(/mintSurveyToken\(c\.env/g) ?? [];
    expect(mints.length).toBe(2);
  });

  it('exposes the token-gated submit endpoint', () => {
    expect(kioskSrc).toContain("kioskRoutes.post('/survey'");
    expect(kioskSrc).toContain('consumeSurveyToken(c.env, body.token)');
  });

  it('registers the visitor-surveys migration LAST', () => {
    const idx = readFileSync(join(ROUTES_DIR, '../db/migrations-index.ts'), 'utf8');
    expect(idx).toMatch(/\{ filename: 'migration-visitor-surveys\.sql', sql: visitorSurveys \},\s*\];/);
  });
});
