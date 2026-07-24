import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const profileUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: z.string().max(20).trim().optional().or(z.literal('')),
    email: z.string().email().max(255).toLowerCase().trim().optional(),
    current_pin: z.string().regex(/^\d{4,6}$/).optional(),
  })
  .refine(
    (v) => !(v.email || v.name) || !!v.current_pin,
    { message: 'current_pin is required when changing name or email', path: ['current_pin'] }
  );

describe('profileUpdateSchema', () => {
  it('accepts phone-only update without PIN', () => {
    expect(profileUpdateSchema.safeParse({ phone: '0241234567' }).success).toBe(true);
  });

  it('accepts empty string to clear phone', () => {
    expect(profileUpdateSchema.safeParse({ phone: '' }).success).toBe(true);
  });

  it('rejects email change without current_pin', () => {
    const r = profileUpdateSchema.safeParse({ email: 'new@ohcs.gov.gh' });
    expect(r.success).toBe(false);
  });

  it('accepts email change with current_pin', () => {
    expect(
      profileUpdateSchema.safeParse({ email: 'new@ohcs.gov.gh', current_pin: '1234' }).success
    ).toBe(true);
  });

  it('rejects invalid PIN format', () => {
    expect(
      profileUpdateSchema.safeParse({ email: 'new@ohcs.gov.gh', current_pin: 'abcd' }).success
    ).toBe(false);
  });

  it('rejects email that is not an email', () => {
    expect(
      profileUpdateSchema.safeParse({ email: 'not-an-email', current_pin: '1234' }).success
    ).toBe(false);
  });

  it('rejects name change without current_pin', () => {
    expect(profileUpdateSchema.safeParse({ name: 'Ama Serwaa' }).success).toBe(false);
  });

  it('accepts name change with current_pin', () => {
    expect(
      profileUpdateSchema.safeParse({ name: 'Ama Serwaa', current_pin: '1234' }).success
    ).toBe(true);
  });

  it('accepts combined name + email + phone change with one PIN', () => {
    expect(
      profileUpdateSchema.safeParse({
        name: 'Ama Serwaa', email: 'ama@ohcs.gov.gh', phone: '0241234567', current_pin: '123456',
      }).success
    ).toBe(true);
  });

  it('rejects a name that is too short', () => {
    expect(
      profileUpdateSchema.safeParse({ name: 'A', current_pin: '1234' }).success
    ).toBe(false);
  });

  it('rejects a name over 120 characters', () => {
    expect(
      profileUpdateSchema.safeParse({ name: 'A'.repeat(121), current_pin: '1234' }).success
    ).toBe(false);
  });
});
