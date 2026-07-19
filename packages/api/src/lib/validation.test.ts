import { describe, it, expect } from 'vitest';
import { CheckInSchema, KioskCreateVisitorSchema, KioskCheckInSchema, UpdateAvailabilitySchema } from './validation';

describe('KioskCreateVisitorSchema', () => {
  const ok = { first_name: 'Ama', last_name: 'B', phone: '0241234567' };
  it('accepts a valid payload (id_type, organisation, id_number all optional)', () => {
    expect(KioskCreateVisitorSchema.safeParse(ok).success).toBe(true);
  });
  it('accepts a payload with an id_type', () => {
    expect(KioskCreateVisitorSchema.safeParse({ ...ok, id_type: 'ghana_card' }).success).toBe(true);
  });
  it('rejects missing phone', () => {
    expect(KioskCreateVisitorSchema.safeParse({ first_name: 'Ama', last_name: 'B' }).success).toBe(false);
  });
  it('rejects empty phone', () => {
    expect(KioskCreateVisitorSchema.safeParse({ ...ok, phone: '' }).success).toBe(false);
  });
  it('rejects a malformed phone', () => {
    expect(KioskCreateVisitorSchema.safeParse({ ...ok, phone: '12345' }).success).toBe(false);
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

describe('CheckInSchema — delegation party fields', () => {
  const base = { visitor_id: 'v1', host_name_manual: 'Mr X' };

  it('defaults party_size to 1 and party_names to undefined when omitted', () => {
    const r = CheckInSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.party_size).toBe(1);
      expect(r.data.party_names).toBeUndefined();
    }
  });

  it('accepts a full party payload', () => {
    const r = CheckInSchema.safeParse({ ...base, party_size: 4, party_names: ['Ama B', 'Kofi C', 'Esi D'] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.party_size).toBe(4);
      expect(r.data.party_names).toEqual(['Ama B', 'Kofi C', 'Esi D']);
    }
  });

  it('trims member names and drops empties', () => {
    const r = CheckInSchema.safeParse({ ...base, party_size: 3, party_names: ['  Ama B  ', '   ', ''] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.party_names).toEqual(['Ama B']);
  });

  it('rejects party_size outside 1–20 and non-integers', () => {
    expect(CheckInSchema.safeParse({ ...base, party_size: 0 }).success).toBe(false);
    expect(CheckInSchema.safeParse({ ...base, party_size: 21 }).success).toBe(false);
    expect(CheckInSchema.safeParse({ ...base, party_size: 2.5 }).success).toBe(false);
  });

  it('rejects more than 19 member names', () => {
    const names = Array.from({ length: 20 }, (_, i) => `Member ${i + 1}`);
    expect(CheckInSchema.safeParse({ ...base, party_size: 20, party_names: names }).success).toBe(false);
  });

  it('rejects a member name over 80 chars (after trimming)', () => {
    expect(CheckInSchema.safeParse({ ...base, party_size: 2, party_names: [`  ${'A'.repeat(81)}  `] }).success).toBe(false);
    expect(CheckInSchema.safeParse({ ...base, party_size: 2, party_names: [`  ${'A'.repeat(80)}  `] }).success).toBe(true);
  });
});

describe('UpdateAvailabilitySchema', () => {
  it('accepts each contract status', () => {
    for (const status of ['available', 'in_meeting', 'out_of_office']) {
      expect(UpdateAvailabilitySchema.safeParse({ status }).success).toBe(true);
    }
  });
  it('rejects an unknown status', () => {
    expect(UpdateAvailabilitySchema.safeParse({ status: 'busy' }).success).toBe(false);
  });
  it('rejects a missing status', () => {
    expect(UpdateAvailabilitySchema.safeParse({}).success).toBe(false);
  });
});
