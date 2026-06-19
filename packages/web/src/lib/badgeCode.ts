// A badge QR encodes the full badge URL (e.g. https://host/badge/OHCS-ABC123).
// The scanner may also receive a bare code. Extract a canonical badge code from
// either, or null if none is present. Accepts the current `OHCS-` prefix AND the
// legacy `SG-` prefix so badges issued before the rename still scan.
const BADGE_CODE_RE = /(?:OHCS|SG)-[0-9A-Z]+/i;

export function parseBadgeCode(scanned: string): string | null {
  if (!scanned) return null;
  const match = scanned.match(BADGE_CODE_RE);
  return match ? match[0].toUpperCase() : null;
}
