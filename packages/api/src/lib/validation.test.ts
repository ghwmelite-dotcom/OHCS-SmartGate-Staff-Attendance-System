import { describe, it, expect } from 'vitest';
import { KioskCreateVisitorSchema, KioskCheckInSchema } from './validation';

describe('KioskCreateVisitorSchema', () => {
  const ok = { first_name: 'Ama', last_name: 'B', phone: '0241234567', id_type: 'ghana_card' };
  it('accepts a valid payload (organisation + id_number optional)', () => {
    expect(KioskCreateVisitorSchema.safeParse(ok).success).toBe(true);
  });
  it('rejects missing phone', () => {
    expect(KioskCreateVisitorSchema.safeParse({ first_name: 'Ama', last_name: 'B', id_type: 'ghana_card' }).success).toBe(false);
  });
  it('rejects empty phone', () => {
    expect(KioskCreateVisitorSchema.safeParse({ ...ok, phone: '' }).success).toBe(false);
  });
  it('rejects a malformed phone', () => {
    expect(KioskCreateVisitorSchema.safeParse({ ...ok, phone: '12345' }).success).toBe(false);
  });
  it('rejects missing id_type', () => {
    expect(KioskCreateVisitorSchema.safeParse({ first_name: 'Ama', last_name: 'B', phone: '0241234567' }).success).toBe(false);
  });
});

describe('KioskCheckInSchema', () => {
  const base = { visitor_id: 'v1', directorate_id: 'd1', host_name_manual: 'Mr X', purpose_raw: 'meeting' };
  it('accepts a complete payload', () => {
    expect(KioskCheckInSchema.safeParse(base).success).toBe(true);
  });
  it('rejects missing directorate_id', () => {
    expect(KioskCheckInSchema.safeParse({ visitor_id: 'v1', host_name_manual: 'Mr X', purpose_raw: 'meeting' }).success).toBe(false);
  });
  it('accepts a missing host_name_manual (host is optional; server derives the receiver)', () => {
    expect(KioskCheckInSchema.safeParse({ visitor_id: 'v1', directorate_id: 'd1', purpose_raw: 'meeting' }).success).toBe(true);
  });
  it('rejects missing purpose_raw', () => {
    expect(KioskCheckInSchema.safeParse({ visitor_id: 'v1', directorate_id: 'd1', host_name_manual: 'Mr X' }).success).toBe(false);
  });
});
