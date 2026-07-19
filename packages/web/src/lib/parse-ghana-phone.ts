// Ghana phone normalization for the kiosk returning-visitor fast lane.
// Accepts the local (`0XXXXXXXXX`) or international (`+233XXXXXXXXX`) form,
// tolerating spaces/dashes/parens — the same shapes kiosk registration
// validates (packages/api/src/lib/validation.ts). Returns the canonical LOCAL
// form (what the full registration form prefills), or null when the input is
// not a recognizable Ghana number.
const GHANA_PHONE_RE = /^(?:\+233|0)(\d{9})$/;

export function parseGhanaPhone(raw: string): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s\-()]/g, '');
  const match = GHANA_PHONE_RE.exec(cleaned);
  return match && match[1] ? `0${match[1]}` : null;
}
