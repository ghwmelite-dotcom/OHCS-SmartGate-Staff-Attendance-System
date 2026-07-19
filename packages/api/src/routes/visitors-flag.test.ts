import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visitorFlagSchema } from './visitors';

const ROUTES_DIR = dirname(fileURLToPath(import.meta.url));

describe('visitorFlagSchema', () => {
  it('accepts vip, banned, and null (clear)', () => {
    expect(visitorFlagSchema.safeParse({ flag: 'vip' }).success).toBe(true);
    expect(visitorFlagSchema.safeParse({ flag: 'banned', note: 'reason' }).success).toBe(true);
    expect(visitorFlagSchema.safeParse({ flag: null }).success).toBe(true);
  });

  it('rejects unknown flag values and missing flag', () => {
    expect(visitorFlagSchema.safeParse({ flag: 'watchlist' }).success).toBe(false);
    expect(visitorFlagSchema.safeParse({ flag: '' }).success).toBe(false);
    expect(visitorFlagSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a note over 200 chars', () => {
    expect(visitorFlagSchema.safeParse({ flag: 'vip', note: 'A'.repeat(201) }).success).toBe(false);
  });
});

// Source-scan guard (same idiom as admin-authz-guard.test.ts): the flag
// endpoint mutates the watchlist, so it must stay superadmin-only AND audited.
describe('PUT /visitors/:id/flag is superadmin-only and audited', () => {
  const src = readFileSync(join(ROUTES_DIR, 'visitors.ts'), 'utf8');

  it('registers the flag route', () => {
    expect(src).toMatch(/visitorRoutes\.put\(\s*'\/:id\/flag'/);
  });

  it('guards the handler with requireRole superadmin', () => {
    const handlerStart = src.indexOf("visitorRoutes.put('/:id/flag'");
    const handler = src.slice(handlerStart);
    expect(handler).toContain("requireRole(c, 'superadmin')");
  });

  it('records a visitor.flag audit entry', () => {
    const handlerStart = src.indexOf("visitorRoutes.put('/:id/flag'");
    const handler = src.slice(handlerStart);
    expect(handler).toContain('recordAudit(');
    expect(handler).toContain("'visitor.flag'");
  });
});
