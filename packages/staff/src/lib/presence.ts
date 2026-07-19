/** Extract a presence token from a scanned QR payload — accepts a raw UUID or
 *  the display URL (...?presence=<uuid>); anything else → null (keep scanning). */
export function parsePresenceToken(data: string): string | null {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const t = data.trim();
  if (UUID.test(t)) return t.toLowerCase();
  try {
    const p = new URL(t).searchParams.get('presence');
    return p && UUID.test(p) ? p.toLowerCase() : null;
  } catch { return null; }
}
