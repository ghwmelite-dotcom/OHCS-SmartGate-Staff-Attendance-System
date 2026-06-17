// A badge QR encodes the full badge URL (e.g. https://host/badge/SG-ABC123).
// The scanner may also receive a bare code. Extract a canonical SG-code from
// either, or null if none is present.
const BADGE_CODE_RE = /SG-[0-9A-Z]+/i;

export function parseBadgeCode(scanned: string): string | null {
  if (!scanned) return null;
  const match = scanned.match(BADGE_CODE_RE);
  return match ? match[0].toUpperCase() : null;
}
