import { z } from 'zod';

// Issuing formats change; keep only the size bound also used by sign-in.
export const nssNumberSchema = z.string().trim().toUpperCase()
  .min(1, 'NSS number is required')
  .max(32, 'NSS number must be at most 32 characters')
  .regex(/^[^\u0000-\u001F\u007F]+$/, 'NSS number cannot contain control characters');
