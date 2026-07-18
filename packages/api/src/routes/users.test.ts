import { describe, it, expect } from 'vitest';
import { z } from 'zod';

describe('GET /users/unprovisioned-count response shape', () => {
  it('count is a non-negative integer', () => {
    const schema = z.object({ count: z.number().int().min(0) });
    expect(schema.safeParse({ count: 0 }).success).toBe(true);
    expect(schema.safeParse({ count: 42 }).success).toBe(true);
    expect(schema.safeParse({ count: -1 }).success).toBe(false);
    expect(schema.safeParse({ count: 'bad' }).success).toBe(false);
  });
});
