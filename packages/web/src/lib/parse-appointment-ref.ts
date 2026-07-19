// An appointment confirmation QR encodes the bare 6-character reference code
// (see packages/api/src/services/qr-html.ts). Accept that bare code, or a URL
// carrying `ref=<code>` (forward-compatible if the payload ever becomes a
// link). Anything else → null.
// Charset mirrors REF_CHARSET in packages/api/src/routes/appointments-public.ts
// — no I/L/O or 0/1, so ambiguous glyphs are never issued.
const REF_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const REF_PARAM_RE = /[?&]ref=([A-Za-z0-9]{6})(?:[&#]|$)/;

export function parseAppointmentRef(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  const bare = trimmed.toUpperCase();
  if (REF_RE.test(bare)) return bare;

  const match = trimmed.match(REF_PARAM_RE);
  if (match && match[1]) {
    const code = match[1].toUpperCase();
    if (REF_RE.test(code)) return code;
  }
  return null;
}
