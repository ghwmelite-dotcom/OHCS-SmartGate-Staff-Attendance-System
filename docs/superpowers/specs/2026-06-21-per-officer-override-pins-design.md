# Per-Officer Override PINs — Design Spec

**Date:** 2026-06-21  **Status:** Approved (build)

## Goal

Give kiosk reception overrides individual accountability. Today a single shared
`app_settings.reception_override_pin` (plaintext) clears the ID gate and the
office-closed gate, and the audit log can only say "reception (shared PIN)". Add
per-officer override PINs so the audit entry names *who* approved — without
exposing any officer directory on the public kiosk.

## Decision

Keep the shared PIN as a **fallback** (checked after per-officer PINs; logged as
the anonymous "reception (shared PIN)"). Per-officer PINs roll out gradually with
zero downtime; the audit makes anonymous shared-PIN use visible so it can be
phased out later.

## Mechanism

- New column **`officers.override_pin_hash TEXT`** (nullable) — hashed with the
  existing PBKDF2 `hashPin` (an upgrade over the plaintext shared PIN).
- **`services/override.ts` `resolveOverride(env, pin)`** → `{ ok, officerId, label }`:
  1. empty pin → `{ ok:false }`.
  2. For each officer with `override_pin_hash` set (small set — the desk officers),
     `verifyPin(pin, hash)`; first match → `{ ok:true, officerId, label: officer.name }`.
  3. Fallback: if it equals `app_settings.reception_override_pin` (constant-time)
     → `{ ok:true, officerId:null, label:'reception (shared PIN)' }`.
  4. else `{ ok:false }`.
- **`kiosk.ts` check-in:** resolve the override **once** (one entered PIN clears
  both gates). ID gate → 422 unless `override.ok`; office-closed gate → 423 unless
  `override.ok`. The `override.use` audit entries set **actor label = the officer's
  name** (or "reception (shared PIN)"); the `id_photo_check` override annotation
  records `{ by: label, officer_id, at }`.

## Admin

- Officer create/update accept `override_pin` (4–8 digits, or `''` to clear, or
  omitted to keep). Hashed; never returned. Officer reads expose only
  `has_override_pin` (boolean). Audit: officer.update shows `override_pin` as
  changed-and-redacted, never the value.
- Officer edit form (`DirectoratesTab`): an **Override PIN** field (placeholder
  reflects whether one is set; blank = keep) + a **Remove** toggle when one exists.

## Notes / non-goals

- Verify-against-all is bounded to officers with a PIN set (expected handful);
  PBKDF2 cost is fine for an infrequent, rate-limited override path.
- Admins should assign **distinct** PINs (collisions → first match wins; not
  enforced because hashes are salted).
- Migration is deploy-safe: `resolveOverride` tolerates a missing column (falls
  back to the shared PIN only) until the migration is applied.

## Test plan

- Set an override PIN on officer A. At the kiosk, trigger the ID/office gate, enter
  A's PIN → check-in proceeds; audit `override.use` names **A**. Enter the shared
  PIN → proceeds; audit says "reception (shared PIN)". Wrong PIN → blocked.
