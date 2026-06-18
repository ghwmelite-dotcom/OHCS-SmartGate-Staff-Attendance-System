import { describe, it, expect } from 'vitest';
import { createInternSchema } from './admin-interns';

describe('createInternSchema', () => {
  const base = {
    name: 'Ama Mensah', email: 'ama@example.com',
    directorate_id: 'dir_rsimd', nss_start_date: '2026-01-01', nss_end_date: '2026-06-30',
  };
  it('accepts a valid payload and lowercases the email', () => {
    const r = createInternSchema.safeParse({ ...base, email: 'AMA@Example.com' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe('ama@example.com');
  });
  it('requires name, email, directorate_id and dates', () => {
    expect(createInternSchema.safeParse({ ...base, name: '' }).success).toBe(false);
    expect(createInternSchema.safeParse({ ...base, directorate_id: '' }).success).toBe(false);
    expect(createInternSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
  });
  it('rejects a non-ISO date', () => {
    expect(createInternSchema.safeParse({ ...base, nss_start_date: '01/01/2026' }).success).toBe(false);
  });
  it('allows optional institution/programme/supervisor to be omitted or empty', () => {
    expect(createInternSchema.safeParse({ ...base, institution: '', programme: '', supervisor_user_id: '' }).success).toBe(true);
  });
});
