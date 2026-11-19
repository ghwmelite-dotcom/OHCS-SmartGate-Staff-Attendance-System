import { z } from 'zod';

// Match the API and the 32-character PIN/passkey sign-in limit.
export const nssNumberSchema = z.string().trim().toUpperCase()
  .min(1, 'NSS number is required')
  .max(32, 'NSS number must be at most 32 characters')
  .regex(/^[^\u0000-\u001F\u007F]+$/, 'NSS number cannot contain control characters');
