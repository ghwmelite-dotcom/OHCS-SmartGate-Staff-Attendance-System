import { z } from 'zod';

export const ghanaPhoneSchema = z.string()
  .regex(/^(\+233|0)\d{9}$/, 'Invalid Ghana phone number (e.g. 0241234567 or +233241234567)')
  .optional()
  .or(z.literal(''));

export const idTypeSchema = z.enum(['ghana_card', 'passport', 'drivers_license', 'staff_id', 'other']);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const CreateVisitorSchema = z.object({
  first_name: z.string().min(1).max(100).trim(),
  last_name: z.string().min(1).max(100).trim(),
  phone: ghanaPhoneSchema,
  email: z.string().email().max(255).optional().or(z.literal('')),
  organisation: z.string().max(200).optional().or(z.literal('')),
  id_type: idTypeSchema.optional().or(z.literal('')),
  id_number: z.string().max(50).optional().or(z.literal('')),
});

export const UpdateVisitorSchema = CreateVisitorSchema.partial();

export const KioskCreateVisitorSchema = z.object({
  first_name: z.string().min(1).max(100).trim(),
  last_name: z.string().min(1).max(100).trim(),
  phone: z.string().regex(/^(\+233|0)\d{9}$/, 'Invalid Ghana phone number (e.g. 0241234567 or +233241234567)'),
  organisation: z.string().max(200).optional().or(z.literal('')),
  id_type: idTypeSchema,
  id_number: z.string().max(50).optional().or(z.literal('')),
});

export const CheckInSchema = z.object({
  visitor_id: z.string().min(1),
  host_officer_id: z.string().optional(),
  host_name_manual: z.string().max(100).optional(),
  directorate_id: z.string().optional(),
  purpose_raw: z.string().max(500).optional(),
  purpose_category: z.string().optional(),
  notes: z.string().max(500).optional(),
  idempotency_key: z.string().min(1).max(100).optional(),
});

export const LoginSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
});

export const VerifyOtpSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  code: z.string().length(6),
});

export const KioskCheckOutSchema = z.object({
  badge_code: z.string().min(1).max(40),
});

// Mirrors IdCheckVerdict (lib/id-check.ts). Echoed back from the id-photo
// response so the verdict survives even if the visitor lingers past the
// idcheck:* KV TTL (900s). Non-blocking and best-effort — fields are loose.
export const IdCheckVerdictSchema = z.object({
  verdict: z.enum(['document', 'not_document', 'indeterminate']),
  detected_type: z.enum(['ghana_card', 'passport', 'drivers_license', 'staff_id', 'other', 'none']).optional(),
  confidence: z.number().min(0).max(1).optional(),
  model: z.string().max(120).optional(),
  checked_at: z.string().max(40).optional(),
});

export const KioskCheckInSchema = z.object({
  visitor_id: z.string().min(1),
  directorate_id: z.string().min(1),
  host_name_manual: z.string().max(100).optional(),
  purpose_raw: z.string().min(1).max(500),
  idempotency_key: z.string().min(1).max(100).optional(),
  // Optional: the AI ID-document verdict echoed back from the id-photo step so
  // it persists even when the KV-stashed copy has expired. Preferred over KV
  // when present; otherwise we fall back to the KV read.
  id_check: IdCheckVerdictSchema.optional(),
});
